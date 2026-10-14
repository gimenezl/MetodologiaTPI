#!/usr/bin/env python3
"""Experimental, loopback-only iOS backend from pinned official ARM archives."""
import base64
import ctypes
import hashlib
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import secrets
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
from urllib.request import urlopen

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SERVICES = ('postgres', 'auth', 'storage', 'postgrest', 'proxy')
spec = importlib.util.spec_from_file_location('stage', HERE / 'run-stage.py')
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


def private_json(path, value):
    with open(path, 'x', encoding='utf-8') as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream)


def read_private(path):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError('Private state missing or symlinked')
    stat = path.stat()
    if os.name == 'posix' and (stat.st_uid != os.getuid() or stat.st_mode & 0o077):
        raise RuntimeError('Private state ownership or permissions invalid')
    return json.loads(path.read_text(encoding='utf-8'))


def owned_root(value):
    path = Path(value)
    base = Path(os.environ['RUNNER_TEMP']).resolve()
    if path.is_symlink() or path.resolve().parent != base or not path.name.startswith('ept105-native-'):
        raise RuntimeError('Native state outside owned runner directory')
    if os.name == 'posix' and (path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077):
        raise RuntimeError('Native directory ownership or permissions invalid')
    owner = read_private(path / 'owner.json')
    if owner != {'run': os.environ['GITHUB_RUN_ID'], 'attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'uid': getattr(os, 'getuid', lambda: 0)()}:
        raise RuntimeError('Native state belongs to another run')
    return path.resolve()


def runtime_executable(pid):
    # Kernel executable identity, never infer it from an arbitrary argv[0].
    if platform.system() == 'Darwin':
        library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        function = library.proc_pidpath
        function.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
        function.restype = ctypes.c_int
        buffer = ctypes.create_string_buffer(4096)  # PROC_PIDPATHINFO_MAXSIZE.
        if function(pid, buffer, len(buffer)) <= 0 or not buffer.value:
            raise RuntimeError('Owned executable identity unavailable')
        value = os.fsdecode(buffer.value)
    elif platform.system() == 'Linux':
        value = os.readlink(f'/proc/{pid}/exe')
    else:
        raise RuntimeError('Owned executable identity unsupported')
    return str(Path(value).resolve(strict=True))


def process_identity(pid):
    result = subprocess.run(['ps', '-ww', '-p', str(pid), '-o', 'uid=,pgid=,lstart=,args='], capture_output=True, text=True, timeout=2)
    if result.returncode == 1 and not result.stdout.strip():
        return None
    if result.returncode:
        raise RuntimeError('Owned process identity unavailable')
    fields = result.stdout.strip().split(None, 7)
    if len(fields) != 8:
        raise RuntimeError('Owned process identity invalid')
    return {'pid': pid, 'uid': int(fields[0]), 'pgid': int(fields[1]), 'start': ' '.join(fields[2:7]), 'args': fields[7], 'exe': runtime_executable(pid)}


def verify_worker(path, service, record, identity):
    if identity is None:
        raise RuntimeError('Worker disappeared; group ownership cannot be re-established')
    trusted_exe = runtime_executable(os.getpid())
    suffix = f' {Path(__file__).resolve()} worker {path} {service}'
    args = identity.get('args', '')
    # CPython framework launcher rewrites argv[0] to Python.app, preserving PID.
    # Only the supervisor's actual interpreter or its exact launcher is accepted,
    # and the independently read kernel executable must match the supervisor.
    checks = {'pid': identity.get('pid') == record['pid'],
              'uid': identity.get('uid') == record['uid'],
              'pgid': identity.get('pgid') == record['pid'],
              'start': identity.get('start') == record['start'],
              'executable': identity.get('exe') == trusted_exe,
              'arguments': args.endswith(suffix) and args[:-len(suffix)] in (sys.executable, trusted_exe),
              'owner': record['uid'] == os.getuid()}
    mismatches = [name for name, matches in checks.items() if not matches]
    if mismatches:
        # Field names only: no argv, executable paths, UID values or environment.
        raise RuntimeError('Stale PID or foreign process: refusing signals; mismatch=' + ','.join(mismatches))


def cleanup(path):
    failures = []
    for service in reversed(SERVICES):
        pidfile = path / f'{service}.pid.json'
        if not pidfile.exists() and not pidfile.is_symlink():
            continue
        try:
            record = read_private(pidfile)
            if record.get('stopped'):
                if stage.group_has_live_members(record['pid']):
                    raise RuntimeError('Stopped ownership witness has live group members')
                continue
            verify_worker(path, service, record, process_identity(record['pid']))
            stage.terminate_group(record['pid'], lambda message: print(f'cleanup {service}: {message}', flush=True))
            pidfile.unlink()
            private_json(pidfile, {**record, 'stopped': True})
            print(f'cleanup {service}: no live owned group', flush=True)
        except Exception:
            failures.append(service)
    if failures:
        raise RuntimeError('Owned cleanup unverified: ' + ','.join(failures))


def extract_archive(archive, destination):
    """Preserve portable relative library links, never permit archive escapes."""
    destination.mkdir(mode=0o700)
    with tarfile.open(archive) as bundle:
        members = bundle.getmembers()
        for member in members:
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise RuntimeError('Unsafe archive entry')
            if member.issym() or member.islnk():
                target = destination / member.name
                link = PurePosixPath(member.linkname)
                linked = target.parent / member.linkname if member.issym() else destination / member.linkname
                if link.is_absolute() or not linked.resolve().is_relative_to(destination.resolve()):
                    raise RuntimeError('Archive link escapes bundle')
        for member in members:
            if not (member.isfile() or member.isdir()):
                continue
            target = destination / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
            else:
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with open(target, 'xb') as output, bundle.extractfile(member) as source:
                    while chunk := source.read(1024 * 1024):
                        output.write(chunk)
                target.chmod(member.mode & 0o755)
        for member in members:
            target = destination / member.name
            if member.issym():
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                if target.parent.resolve() != target.parent.absolute():
                    raise RuntimeError('Link ancestor is not a directory')
                target.symlink_to(member.linkname)
            elif member.islnk():
                os.link(destination / member.linkname, target)


def jwt(secret, role):
    encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b'=').decode()
    header = encode(b'{"alg":"HS256","typ":"JWT"}')
    body = encode(json.dumps({'role': role, 'iss': 'supabase', 'iat': int(time.time()), 'exp': int(time.time()) + 3600}).encode())
    message = f'{header}.{body}'
    return message + '.' + encode(hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest())


def upstream_route(path):
    for prefix, port in (('/auth/v1', 8010), ('/rest/v1', 3010), ('/storage/v1', 5010)):
        if path == prefix or path.startswith(prefix + '/') or path.startswith(prefix + '?'):
            return port, path[len(prefix):] or '/'
    return None


def serve_proxy(config):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never persist request paths, headers or bodies.

        def forward(self):
            route = upstream_route(self.path)
            if not route:
                self.send_error(404)
                return
            if self.headers.get('apikey') not in (config['status']['ANON_KEY'], config['status']['SERVICE_ROLE_KEY']):
                self.send_error(401)
                return
            try:
                length = int(self.headers.get('content-length', '0'))
                if length < 0 or length > 2 * 1024 * 1024 or self.headers.get('transfer-encoding'):
                    self.send_error(413)
                    return
                headers = {key: value for key, value in self.headers.items() if key.lower() not in {'host', 'connection', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-connection'}}
                # In particular, never replace Authorization with a service-role token.
                upstream = http.client.HTTPConnection('127.0.0.1', route[0], timeout=15)
                try:
                    upstream.request(self.command, route[1], self.rfile.read(length), headers)
                    response = upstream.getresponse()
                    body = response.read(4 * 1024 * 1024 + 1)
                    if len(body) > 4 * 1024 * 1024:
                        raise RuntimeError('Upstream response exceeds bound')
                    self.send_response(response.status)
                    for key, value in response.getheaders():
                        if key.lower() not in {'connection', 'transfer-encoding', 'content-length'}:
                            self.send_header(key, value)
                    self.send_header('content-length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                finally:
                    upstream.close()
            except Exception:
                self.send_error(502)

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = forward

    server = ThreadingHTTPServer(('127.0.0.1', 54321), Handler)
    server.daemon_threads = True
    server.serve_forever(poll_interval=.2)


def worker(path, service):
    config = read_private(path / 'config.json')
    os.environ.update(config['secret_env'])  # Redaction sees every generated secret.
    identity = process_identity(os.getpid())
    private_json(path / f'{service}.pid.json', {'pid': os.getpid(), 'uid': identity['uid'], 'start': identity['start']})
    terminating = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_args: terminating.set())

    def watchdog():
        until = config['deadline']
        while time.time() < until and not terminating.wait(.2):
            pass
        # Service binaries are foreground children in this worker's group.
        # Retain the owner witness through TERM; KILL includes this supervisor.
        os.killpg(os.getpid(), signal.SIGTERM)
        time.sleep(3)
        os.killpg(os.getpid(), signal.SIGKILL)

    threading.Thread(target=watchdog, daemon=True).start()
    log_path = Path(os.environ['EPT_STAGE_LOG_DIR']) / f'native-{service}-redacted.log'
    try:
        if service == 'proxy':
            serve_proxy(config)
            code = 0
        else:
            info = config['services'][service]
            process = subprocess.Popen(info['command'], cwd=info.get('cwd', str(path)), env={**os.environ, **info['env']}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace')
            with open(log_path, 'a', encoding='utf-8') as log:
                for line in process.stdout:
                    log.write(stage.redact(line) + ('' if line.endswith('\n') else '\n'))
                    log.flush()
            code = process.wait()
    except Exception as error:
        code = 125
        with open(log_path, 'a', encoding='utf-8') as log:
            log.write(stage.redact(f'Native worker startup/output failure: {error}') + '\n')
    private_json(path / f'{service}.exit.json', {'code': code})
    # Keep the identity alive even if the service exits before teardown.
    while True:
        time.sleep(.2)


def bounded(name, seconds, command, env=None, cwd=None):
    result = subprocess.run([sys.executable, str(HERE / 'run-stage.py'), '--stage', name, '--seconds', str(seconds), '--', *map(str, command)], env={**os.environ, **(env or {})}, cwd=cwd or ROOT)
    if result.returncode:
        raise RuntimeError(f'Native stage failed: {name}; exit={result.returncode}')


def spawn_worker(path, config, service):
    process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'worker', str(path), service], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    until = time.monotonic() + 5
    while not (path / f'{service}.pid.json').exists():
        if process.poll() is not None:
            # No service is spawned before the witness. Never signal a reaped PID.
            raise RuntimeError(f'Worker exited before ownership: {service}')
        if time.monotonic() > until:
            identity = process_identity(process.pid)
            verify_worker(path, service, {'pid': process.pid, 'uid': os.getuid(), 'start': identity['start']}, identity)
            stage.terminate_group(process.pid)
            raise RuntimeError(f'Worker did not publish ownership: {service}')
        time.sleep(.05)
    verify_worker(path, service, read_private(path / f'{service}.pid.json'), process_identity(process.pid))


def ready(path, service, seconds, check):
    started = time.monotonic()
    deadline = min(time.time() + seconds, float(os.environ['EPT_NATIVE_DEADLINE']))
    last = 0
    while time.time() < deadline:
        if (path / f'{service}.exit.json').exists():
            raise RuntimeError(f'Native service exited: {service}; inspect redacted artifact')
        try:
            if check():
                print(f'native {service} ready; seconds={time.monotonic() - started:.1f}', flush=True)
                return
        except (OSError, http.client.HTTPException):
            pass
        if time.monotonic() - last > 15:
            print(f'native {service} readiness; elapsed={time.monotonic() - started:.1f}s', flush=True)
            last = time.monotonic()
        time.sleep(.2)
    raise RuntimeError(f'Native readiness deadline: {service}')


def http_ready(port, route):
    with urlopen(f'http://127.0.0.1:{port}{route}', timeout=2) as response:
        return response.status == 200


def publish_public_environment(config):
    # Only after readiness. The private status also has service_role: never export it.
    with open(os.environ['GITHUB_ENV'], 'a', encoding='utf-8') as output:
        output.write('EPT_MOBILE_AUTH_INTEGRATION=1\n')
        output.write('EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n')
        output.write(f"EXPO_PUBLIC_SUPABASE_ANON_KEY={config['status']['ANON_KEY']}\n")


class MigrationFailure(RuntimeError):
    def __init__(self, filename, code):
        self.code = code
        super().__init__(f'Project migration failed: {filename}; exit={code}')


def migration_uses_implicit_transaction(file):
    text = file.read_text(encoding='utf-8')
    # Inspect top-level statements, ignoring comments/literals/function bodies.
    # This is a bounded project contract, not a general migration engine.
    noncode = r'--[^\n]*|/\*.*?\*/|\$(?P<tag>[A-Za-z_][A-Za-z0-9_]*|)\$.*?\$(?P=tag)\$|\'(?:\'\'|[^\'])*\'|"(?:""|[^"])*"'
    code = re.sub(noncode, ' ', text, flags=re.S)
    statements = [statement.strip() for statement in code.split(';') if statement.strip()]
    controls = [statement for statement in statements if re.match(r'^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION)\b', statement, re.I)]
    if any(re.match(r'^(?:VACUUM|ALTER\s+SYSTEM|CLUSTER)\b|^(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b|^REINDEX\b.*\bCONCURRENTLY\b', statement, re.I) for statement in statements):
        raise RuntimeError(f'Unsupported nontransactional migration: {file.name}')
    if not controls:
        return True
    if [value.upper() for value in controls] != ['BEGIN', 'COMMIT'] or statements[0].upper() != 'BEGIN' or statements[-1].upper() != 'COMMIT':
        raise RuntimeError(f'Unsupported explicit migration transaction: {file.name}')
    return False


def run_project_migrations(psql, migrations):
    # One psql connection per file: never turn all 37 into a global transaction.
    # The outer native-project-migrations stage owns this helper and its children.
    plans = [(file, migration_uses_implicit_transaction(file)) for file in migrations]
    for file, implicit in plans:
        print(f'migration begin: {file.name}; transaction={"implicit" if implicit else "explicit"}', flush=True)
        command = [str(psql), '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'AUTOCOMMIT=on', '--no-password']
        if implicit:
            command.append('--single-transaction')
        result = subprocess.run([*command, '-f', str(file)])
        if result.returncode:
            print(f'migration failed: {file.name}; exit={result.returncode}; subsequent files not executed', flush=True)
            raise MigrationFailure(file.name, result.returncode)
        print(f'migration committed: {file.name}', flush=True)


def prove_transaction_contract(path, psql):
    # Actual portable PG proof, not Windows mocks: only isolated CI probe objects.
    help_result = subprocess.run([str(psql), '--help'], capture_output=True, text=True)
    if help_result.returncode or '--single-transaction' not in help_result.stdout:
        raise RuntimeError('Portable psql lacks required single-transaction support')
    schema = 'ept105_tx_probe_' + secrets.token_hex(6)
    positive = path / 'transaction-positive.sql'
    positive.write_text('CREATE TEMP TABLE ept105_tx_lifetime (value integer) ON COMMIT DROP;\nINSERT INTO ept105_tx_lifetime VALUES (1);\nDO $$ BEGIN IF (SELECT count(*) FROM ept105_tx_lifetime) <> 1 THEN RAISE EXCEPTION \'TEMP lifetime failed\'; END IF; END $$;\n', encoding='utf-8')
    run_project_migrations(psql, [positive])
    explicit_positive = path / 'transaction-explicit-positive.sql'
    explicit_positive.write_text('BEGIN;\n' + positive.read_text(encoding='utf-8') + 'COMMIT;\n', encoding='utf-8')
    run_project_migrations(psql, [explicit_positive])
    print('native transaction probe: TEMP ON COMMIT lifetime passed', flush=True)
    negative = path / 'transaction-rollback.sql'
    negative.write_text(f'CREATE SCHEMA {schema};\nCREATE TABLE {schema}.probe (value integer);\nSELECT 1/0;\n', encoding='utf-8')
    try:
        run_project_migrations(psql, [negative])
    except MigrationFailure as error:
        if error.code != 3:
            raise
        print('native transaction probe: expected SQL error propagated exit=3', flush=True)
    else:
        raise RuntimeError('Rollback probe unexpectedly succeeded')
    check = f"DO $$ BEGIN IF EXISTS (SELECT FROM pg_namespace WHERE nspname='{schema}') THEN RAISE EXCEPTION 'Rollback left schema behind'; END IF; END $$;"
    result = subprocess.run([str(psql), '-X', '-v', 'ON_ERROR_STOP=1', '--no-password', '-c', check])
    if result.returncode:
        raise MigrationFailure('transaction-rollback-readback', result.returncode)
    print('native transaction probe: rollback readback passed', flush=True)
    explicit_negative = path / 'transaction-explicit-rollback.sql'
    explicit_negative.write_text('BEGIN;\n' + negative.read_text(encoding='utf-8') + 'COMMIT;\n', encoding='utf-8')
    try:
        run_project_migrations(psql, [explicit_negative])
    except MigrationFailure as error:
        if error.code != 3:
            raise
    else:
        raise RuntimeError('Explicit rollback probe unexpectedly succeeded')
    result = subprocess.run([str(psql), '-X', '-v', 'ON_ERROR_STOP=1', '--no-password', '-c', check])
    if result.returncode:
        raise MigrationFailure('transaction-explicit-rollback-readback', result.returncode)
    print('native transaction probe: explicit rollback readback passed', flush=True)


def start():
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise RuntimeError('Native iOS requires macOS ARM64')
    for port in (54321, 54322, 8010, 3010, 5010, 5001):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', port))  # Fail closed rather than touching another stack.
    path = Path(tempfile.mkdtemp(prefix='ept105-native-', dir=os.environ['RUNNER_TEMP'])).resolve()
    private_json(path / 'owner.json', {'run': os.environ['GITHUB_RUN_ID'], 'attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'uid': os.getuid()})
    with open(os.environ['GITHUB_ENV'], 'a', encoding='utf-8') as output:
        output.write(f'EPT_MOBILE_NATIVE_BACKEND=1\nEPT_MOBILE_NATIVE_WORKDIR={path}\n')
    log_dir = Path(os.environ['EPT_STAGE_LOG_DIR'])
    log_dir.mkdir(parents=True, exist_ok=True)
    artifact = path / 'archives'
    bounded('native-archives', 240, ['node', HERE / 'install-native.mjs'], {'EPT_NATIVE_ARTIFACT_DIR': str(artifact)})
    bounded('native-extract', 60, [sys.executable, Path(__file__).resolve(), 'extract', path])
    bundles = path / 'bundles'
    password = secrets.token_hex(32)
    secret = secrets.token_hex(32)
    os.environ.update({'EPT_NATIVE_PASSWORD': password, 'EPT_NATIVE_SECRET': secret})
    pg = bundles / 'postgres' / 'bin'
    psql = [pg / 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '--no-password']
    db = lambda role: f'postgres://{role}:{password}@127.0.0.1:54322/postgres?sslmode=disable'
    pg_env = {'PGHOST': '127.0.0.1', 'PGPORT': '54322', 'PGDATABASE': 'postgres', 'PGUSER': 'supabase_admin', 'PGPASSWORD': password, 'PGOPTIONS': '-c search_path=public,extensions -c statement_timeout=15000 -c lock_timeout=5000'}
    init = path / 'init'
    init.mkdir(mode=0o700)
    # Consumer config only. All Auth/Storage/application tables come from upstream migrations.
    (init / '01-runtime.sql').write_text('\n'.join(f"ALTER ROLE {role} PASSWORD '{password}';" for role in ('supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin', 'authenticator', 'postgres')) + '\nALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;\nALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;\nALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;\n', encoding='utf-8')
    (init / '02-hba.sh').write_text('printf "local all all trust\\nhost all all 127.0.0.1/32 scram-sha-256\\nhost all all ::1/128 reject\\n" > "$PGDATA/pg_hba.conf"\n', encoding='utf-8')
    socket_dir = path / 'socket'
    socket_dir.mkdir(mode=0o700)
    storage_env = {'DATABASE_URL': db('supabase_storage_admin'), 'AUTH_JWT_SECRET': secret, 'PGRST_JWT_SECRET': secret, 'STORAGE_BACKEND': 'file', 'FILE_STORAGE_BACKEND_PATH': str(path / 'objects'), 'DB_INSTALL_ROLES': 'false', 'DB_SUPER_USER': 'supabase_storage_admin', 'DB_ALLOW_MIGRATION_REFRESH': 'false', 'TENANT_ID': 'ept105-local', 'REGION': 'local', 'GLOBAL_S3_BUCKET': 'local', 'SERVER_HOST': '127.0.0.1', 'SERVER_PORT': '5010', 'SERVER_ADMIN_PORT': '5001', 'LOG_LEVEL': 'error'}
    config = {'deadline': float(os.environ['EPT_NATIVE_DEADLINE']), 'secret_env': {'EPT_NATIVE_PASSWORD': password, 'EPT_NATIVE_SECRET': secret}, 'status': {'API_URL': 'http://127.0.0.1:54321', 'ANON_KEY': jwt(secret, 'anon'), 'SERVICE_ROLE_KEY': jwt(secret, 'service_role')}, 'services': {
        'postgres': {'command': [str(pg / 'supabase-postgres-start'), '-c', 'listen_addresses=127.0.0.1', '-c', 'port=54322', '-c', f'unix_socket_directories={socket_dir}', '-c', 'unix_socket_permissions=0700'], 'env': {'PGDATA': str(path / 'data'), 'POSTGRES_USER': 'supabase_admin', 'POSTGRES_DB': 'postgres', 'POSTGRES_PASSWORD': password, 'SUPABASE_POSTGRES_INITDB_DIR': str(init)}},
        'auth': {'command': [str(bundles / 'auth/bin/auth')], 'env': {'GOTRUE_API_HOST': '127.0.0.1', 'PORT': '8010', 'API_EXTERNAL_URL': 'http://127.0.0.1:54321/auth/v1', 'GOTRUE_SITE_URL': 'http://localhost', 'GOTRUE_DB_DRIVER': 'postgres', 'GOTRUE_DB_DATABASE_URL': db('supabase_auth_admin'), 'GOTRUE_JWT_SECRET': secret, 'GOTRUE_JWT_AUD': 'authenticated', 'GOTRUE_JWT_ADMIN_ROLES': 'service_role', 'GOTRUE_JWT_EXP': '120', 'GOTRUE_MAILER_AUTOCONFIRM': 'true', 'GOTRUE_EXTERNAL_EMAIL_ENABLED': 'true', 'GOTRUE_LOG_LEVEL': 'error'}},
        'storage': {'command': [str(bundles / 'storage/bin/storage')], 'env': storage_env},
        'postgrest': {'command': [str(bundles / 'postgrest/bin/postgrest')], 'env': {'PGRST_DB_URI': db('authenticator'), 'PGRST_DB_SCHEMAS': 'public', 'PGRST_DB_EXTRA_SEARCH_PATH': 'public,extensions', 'PGRST_DB_ANON_ROLE': 'anon', 'PGRST_JWT_SECRET': secret, 'PGRST_SERVER_HOST': '127.0.0.1', 'PGRST_SERVER_PORT': '3010', 'PGRST_LOG_LEVEL': 'crit'}},
    }}
    private_json(path / 'config.json', config)
    try:
        spawn_worker(path, config, 'postgres')
        ready(path, 'postgres', 120, lambda: subprocess.run([pg / 'pg_isready', '-t', '1'], env={**os.environ, **pg_env}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2).returncode == 0)
        spawn_worker(path, config, 'auth')
        ready(path, 'auth', 60, lambda: http_ready(8010, '/health'))
        # The pinned v1.72.1 artifact owns this genuine tenant migration entrypoint.
        bounded('native-storage-migrations', 90, [bundles / 'storage/node/bin/node', 'dist/scripts/migrate-call.js'], {**storage_env, 'DATABASE_URL': db('supabase_admin')}, bundles / 'storage/app')
        bounded('native-storage-ownership', 15, [*psql, '-c', 'ALTER TABLE storage.objects OWNER TO supabase_storage_admin; ALTER TABLE storage.buckets OWNER TO supabase_storage_admin; ALTER TABLE storage.migrations OWNER TO supabase_storage_admin; GRANT ALL ON ALL TABLES IN SCHEMA storage TO supabase_storage_admin; GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO supabase_storage_admin;'], pg_env)
        migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
        if len(migrations) != 37:
            raise RuntimeError('Project migration count changed; native contract needs explicit review')
        bounded('native-project-migrations', 90, [sys.executable, Path(__file__).resolve(), 'migrate-project', path], pg_env)
        print(f'native project migrations applied: {len(migrations)}', flush=True)
        spawn_worker(path, config, 'storage')
        ready(path, 'storage', 30, lambda: http_ready(5010, '/status'))
        spawn_worker(path, config, 'postgrest')
        ready(path, 'postgrest', 30, lambda: http_ready(3010, '/'))
        spawn_worker(path, config, 'proxy')
        ready(path, 'proxy', 10, lambda: socket.create_connection(('127.0.0.1', 54321), timeout=1).close() is None)
        publish_public_environment(config)
        print('native backend healthy; real Auth/REST assertions still required', flush=True)
    except Exception:
        cleanup(path)
        raise


def main():
    action = sys.argv[1]
    if action == 'start':
        start()
    elif action == 'worker':
        path = owned_root(sys.argv[2])
        if sys.argv[3] not in SERVICES:
            raise RuntimeError('Unknown native worker')
        worker(path, sys.argv[3])
    elif action == 'extract':
        path = owned_root(sys.argv[2])
        bundles = path / 'bundles'
        bundles.mkdir(mode=0o700)
        for service in SERVICES[:-1]:
            extract_archive(path / 'archives' / f'{service}.tar', bundles / service)
    elif action == 'migrate-project':
        path = owned_root(sys.argv[2])
        psql = path / 'bundles/postgres/bin/psql'
        prove_transaction_contract(path, psql)
        migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
        if len(migrations) != 37:
            raise RuntimeError('Project migration count changed')
        run_project_migrations(psql, migrations)
    elif action in ('stop', 'status'):
        value = os.environ.get('EPT_MOBILE_NATIVE_WORKDIR')
        if not value and action == 'stop':
            return
        path = owned_root(value)
        if action == 'stop':
            cleanup(path)
        else:
            print(json.dumps(read_private(path / 'config.json')['status']))  # Private pipe only.
    else:
        raise RuntimeError('Unknown native lifecycle action')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(stage.redact(f'Native backend failure: {error}'), file=sys.stderr)
        sys.exit(error.code if isinstance(error, MigrationFailure) else 1)
