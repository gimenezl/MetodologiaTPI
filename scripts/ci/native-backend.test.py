#!/usr/bin/env python3
"""Harness safety tests, not a substitute for native Auth/RLS acceptance."""
import importlib.util
from contextlib import redirect_stdout
import http.client
from http.server import BaseHTTPRequestHandler, HTTPServer
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import signal
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('native', HERE / 'native-backend.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class NativeSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name).resolve()
        self.path = self.base / 'ept105-native-test'
        self.path.mkdir(mode=0o700)
        self.env = patch.dict(os.environ, {'RUNNER_TEMP': str(self.base), 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'EPT_STAGE_LOG_DIR': str(self.base), 'EPT_NATIVE_DEADLINE': str(int(time.time()) + 60)})
        self.env.start()
        native.private_json(self.path / 'owner.json', {'run': '123', 'attempt': '1', 'uid': getattr(os, 'getuid', lambda: 0)()})

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_owned_marker_and_foreign_run(self):
        self.assertEqual(native.owned_root(str(self.path)), self.path)
        with patch.dict(os.environ, {'GITHUB_RUN_ID': 'foreign'}):
            with self.assertRaisesRegex(RuntimeError, 'another run'):
                native.owned_root(str(self.path))

    def test_outside_root_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'outside'):
            native.owned_root(str(self.base))

    @unittest.skipUnless(os.name == 'posix', 'POSIX symlink/mode proof runs in diagnostics')
    def test_symlink_state_and_loose_permissions_rejected(self):
        link = self.base / 'ept105-native-link'
        link.symlink_to(self.path, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'outside'):
            native.owned_root(str(link))
        (self.path / 'owner.json').chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, 'permissions'):
            native.owned_root(str(self.path))

    def test_stale_and_foreign_pid_rejected_without_signal(self):
        record = {'uid': 10, 'pid': 100, 'start': 'old'}
        identity = {'uid': 10, 'pgid': 100, 'start': 'new', 'args': 'another stack'}
        with patch.object(native.stage, 'terminate_group') as kill, patch.object(native, 'runtime_executable', return_value='/synthetic/python'), patch.object(native.os, 'getuid', return_value=10, create=True):
            for evidence in (None, identity):
                with self.assertRaises(RuntimeError):
                    native.verify_worker(self.path, 'auth', record, evidence)
            kill.assert_not_called()

    def test_framework_interpreter_identity_and_safe_negative_fields(self):
        record = {'uid': 10, 'pid': 100, 'start': 'synthetic-start'}
        interpreter = '/synthetic/Python.app/Python'
        suffix = f' {Path(native.__file__).resolve()} worker {self.path} auth'
        identity = {'pid': 100, 'uid': 10, 'pgid': 100, 'start': 'synthetic-start', 'exe': interpreter, 'args': interpreter + suffix}
        with patch.object(native, 'runtime_executable', return_value=interpreter), patch.object(native.os, 'getuid', return_value=10, create=True), patch.object(native.stage, 'terminate_group') as kill:
            # Reproduces CPython's argv[0] rewrite; old literal sys.executable rejected it.
            self.assertNotEqual(identity['args'], sys.executable + suffix)
            native.verify_worker(self.path, 'auth', record, identity)
            native.verify_worker(self.path, 'auth', record, {**identity, 'args': sys.executable + suffix})
            for field, value, diagnostic in (('exe', '/foreign/python', 'executable'), ('uid', 11, 'uid'), ('pgid', 101, 'pgid'), ('pid', 101, 'pid'), ('start', 'stale', 'start'), ('args', interpreter + suffix.replace(str(self.path), '/foreign/stack'), 'arguments'), ('args', '/foreign/executable' + suffix, 'arguments')):
                with self.assertRaises(RuntimeError) as failure:
                    native.verify_worker(self.path, 'auth', record, {**identity, field: value})
                message = str(failure.exception)
                self.assertIn('mismatch=' + diagnostic, message)
                self.assertNotIn('/foreign', message)
                self.assertNotIn(str(self.path), message)
                self.assertNotIn(interpreter, message)
            with self.assertRaisesRegex(RuntimeError, 'mismatch=owner'):
                native.verify_worker(self.path, 'auth', {**record, 'uid': 11}, {**identity, 'uid': 11})
            kill.assert_not_called()

    def test_unavailable_executable_identity_fails_closed(self):
        with patch.object(native, 'runtime_executable', side_effect=RuntimeError('Owned executable identity unavailable')), patch.object(native.stage, 'terminate_group') as kill:
            with self.assertRaisesRegex(RuntimeError, 'identity unavailable'):
                native.verify_worker(self.path, 'auth', {'uid': 10, 'pid': 100, 'start': 'old'}, {'args': 'not trusted'})
            kill.assert_not_called()

    def test_darwin_pidpath_uses_kernel_binding_and_fails_closed(self):
        binary = self.path / 'synthetic-interpreter'
        binary.write_text('unit fixture', encoding='utf-8')
        function = unittest.mock.Mock()
        def pidpath(pid, buffer, size):
            self.assertEqual(pid, 12345)
            self.assertEqual(size, 4096)
            buffer.value = os.fsencode(str(binary))
            return len(buffer.value)
        function.side_effect = pidpath
        library = unittest.mock.Mock(proc_pidpath=function)
        with patch.object(native.platform, 'system', return_value='Darwin'), patch.object(native.ctypes, 'CDLL', return_value=library) as load:
            self.assertEqual(native.runtime_executable(12345), str(binary.resolve()))
            load.assert_called_once_with('/usr/lib/libproc.dylib', use_errno=True)
            function.side_effect = None
            function.return_value = 0
            with self.assertRaisesRegex(RuntimeError, 'identity unavailable'):
                native.runtime_executable(12345)

    @unittest.skipUnless(os.name == 'posix', 'POSIX UID proof')
    def test_cleanup_preserves_foreign_stack(self):
        native.private_json(self.path / 'auth.pid.json', {'pid': os.getpid(), 'uid': os.getuid(), 'start': 'foreign'})
        with patch.object(native.stage, 'terminate_group') as kill:
            with self.assertRaisesRegex(RuntimeError, 'cleanup unverified'):
                native.cleanup(self.path)
            kill.assert_not_called()

    def archive(self, name, kind=tarfile.REGTYPE, link=''):
        source = self.base / 'test.tar'
        with tarfile.open(source, 'w') as bundle:
            entry = tarfile.TarInfo(name)
            entry.type = kind
            entry.linkname = link
            entry.mode = 0o755
            entry.size = 3 if kind == tarfile.REGTYPE else 0
            bundle.addfile(entry, io.BytesIO(b'bin') if entry.size else None)
        return source

    def test_extraction_rejects_traversal_absolute_and_special(self):
        for number, (name, kind, link) in enumerate((('../escape', tarfile.REGTYPE, ''), ('/escape', tarfile.REGTYPE, ''), ('bin/tool', tarfile.SYMTYPE, '../../escape'), ('fifo', tarfile.FIFOTYPE, ''))):
            with self.assertRaisesRegex(RuntimeError, 'Unsafe|escapes'):
                native.extract_archive(self.archive(name, kind, link), self.base / f'reject-{number}')
        self.assertFalse((self.base.parent / 'escape').exists())

    def test_extract_regular_file(self):
        target = self.base / 'bundle'
        native.extract_archive(self.archive('./bin/tool'), target)
        self.assertEqual((target / 'bin/tool').read_bytes(), b'bin')

    def test_proxy_routes_cannot_change_upstream_or_elevate(self):
        self.assertEqual(native.upstream_route('/auth/v1/token?grant_type=password'), (8010, '/token?grant_type=password'))
        self.assertEqual(native.upstream_route('/rest/v1/perfiles'), (3010, '/perfiles'))
        for path in ('https://remote/auth/v1', '/auth/v10/token', '/foreign', '//remote/rest/v1'):
            self.assertIsNone(native.upstream_route(path))
        source = (HERE / 'native-backend.py').read_text(encoding='utf-8')
        self.assertNotIn("headers['authorization'] =", source)

    def test_port_probe_uses_only_reuseaddr_and_safe_telemetry(self):
        with patch.object(native, 'os', SimpleNamespace(name='posix', environ=os.environ)), patch.object(native, 'existing_tcp_listener', return_value=False), patch.object(native.socket, 'socket') as socket, redirect_stdout(io.StringIO()) as trace:
            native.check_port_available(54321)
            probe = socket.return_value.__enter__.return_value
            probe.setsockopt.assert_called_once_with(native.socket.SOL_SOCKET, native.socket.SO_REUSEADDR, 1)
            probe.bind.assert_called_once_with(('127.0.0.1', 54321))
            probe.listen.assert_called_once_with(1)
            self.assertIn('port=54321; result=available', trace.getvalue())
            probe.bind.side_effect = OSError(native.errno.EADDRINUSE, 'private-url-secret')
            with self.assertRaisesRegex(RuntimeError, 'errno_class=address_in_use') as failure:
                native.check_port_available(54321)
            self.assertNotIn('private-url-secret', str(failure.exception))
        for code, output, expected in [(1, '', False), (0, '123\n456\n', True), (0, 'private-secret\n', None), (2, '', None), (0, '', None)]:
            with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], code, stdout=output, stderr='')) as run:
                if expected is None:
                    with self.assertRaisesRegex(RuntimeError, 'readback unavailable'):
                        native.existing_tcp_listener(54321)
                else:
                    self.assertEqual(native.existing_tcp_listener(54321), expected)
                self.assertIn('-sTCP:LISTEN', run.call_args.args[0])
                self.assertIn('-a', run.call_args.args[0])
                self.assertEqual(run.call_args.args[0][-2:], ['-t', '+w'])  # -t suppresses warnings; restore afterward.
        with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout='123\n', stderr='private-permission-warning')):
            with self.assertRaisesRegex(RuntimeError, 'readback unavailable') as failure:
                native.existing_tcp_listener(54321)
            self.assertNotIn('private-permission-warning', str(failure.exception))

    @unittest.skipUnless(os.name == 'posix', 'POSIX TIME_WAIT reuse semantics; Windows SO_REUSEADDR differs')
    def test_port_probe_reuses_active_close_timewait_without_wait_or_retry(self):
        with native.socket.socket() as listener:
            listener.setsockopt(native.socket.SOL_SOCKET, native.socket.SO_REUSEADDR, 1)
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
            listener.listen(1)
            with native.socket.create_connection(('127.0.0.1', port), timeout=1) as client:
                accepted, _address = listener.accept()
                with accepted:
                    accepted.settimeout(1)
                    accepted.shutdown(native.socket.SHUT_WR)  # Server active close first.
                    self.assertEqual(client.recv(1), b'')
                    client.shutdown(native.socket.SHUT_WR)
                    self.assertEqual(accepted.recv(1), b'')  # FIN exchange completed.
        self.assertFalse(native.existing_tcp_listener(port))
        with native.socket.socket() as old_probe:
            with self.assertRaises(OSError) as failure:
                old_probe.bind(('127.0.0.1', port))
            self.assertEqual(failure.exception.errno, native.errno.EADDRINUSE)
        native.check_port_available(port)  # No sleeps, retries or foreign signals.

    @unittest.skipUnless(os.name == 'posix', 'POSIX live unrelated loopback/wildcard listener protection')
    def test_port_probe_rejects_live_unrelated_listener_and_preserves_health(self):
        for host in ('127.0.0.1', '0.0.0.0'):
            with native.socket.socket() as foreign:
                foreign.setsockopt(native.socket.SOL_SOCKET, native.socket.SO_REUSEADDR, 1)
                foreign.bind((host, 0))
                port = foreign.getsockname()[1]
                foreign.listen(1)
                foreign.settimeout(1)
                with patch.object(native.os, 'killpg') as signal:
                    with self.assertRaisesRegex(RuntimeError, 'occupied by live listener'):
                        native.check_port_available(port)
                    signal.assert_not_called()
                with native.socket.create_connection(('127.0.0.1', port), timeout=1) as client:
                    accepted, _address = foreign.accept()
                    with accepted:
                        accepted.sendall(b'ok')
                        self.assertEqual(client.recv(2), b'ok')

    def test_fixed_loopback_server_binds_and_listens_without_reverse_dns(self):
        # Actual stdlib HTTPServer demonstrates the unwanted lookup contract.
        with patch.object(native.socket, 'getfqdn', side_effect=RuntimeError('Synthetic unavailable DNS')) as dns:
            with self.assertRaisesRegex(RuntimeError, 'unavailable DNS'):
                HTTPServer(('127.0.0.1', 0), BaseHTTPRequestHandler)
            dns.assert_called_once_with('127.0.0.1')
            dns.reset_mock()
            with native.LoopbackHTTPServer(('127.0.0.1', 0), BaseHTTPRequestHandler) as server:
                self.assertEqual(server.server_name, '127.0.0.1')
                self.assertEqual(server.server_port, server.socket.getsockname()[1])
                with native.socket.create_connection(('127.0.0.1', server.server_port), timeout=1):
                    pass  # Real TCP bind/listen, no lookup.
                dns.assert_not_called()
            with self.assertRaisesRegex(RuntimeError, 'fixed IPv4 loopback'):
                native.LoopbackHTTPServer(('0.0.0.0', 0), BaseHTTPRequestHandler)

    def test_proxy_worker_exception_records_safe_phase_and_private_exit(self):
        native.private_json(self.path / 'config.json', {'deadline': time.time() + 10, 'secret_env': {}, 'status': {}})
        with patch.object(native, 'process_identity', return_value={'uid': 0, 'start': 'synthetic'}), patch.object(native.signal, 'signal'), patch.object(native.threading.Thread, 'start'), patch.object(native, 'serve_proxy', side_effect=ValueError('private-url-secret')), patch.object(native.time, 'sleep', side_effect=StopIteration):
            with self.assertRaises(StopIteration):
                native.worker(self.path, 'proxy')
        self.assertEqual(native.read_private(self.path / 'proxy.exit.json')['code'], 125)
        log = (self.base / 'native-proxy-redacted.log').read_text(encoding='utf-8')
        self.assertIn('phase=owned-worker-enter', log)
        self.assertIn('Native proxy worker failure: internal_error', log)
        self.assertNotIn('private-url-secret', log)

    @unittest.skipUnless(os.name == 'posix', 'Actual owned proxy startup/readiness/listener/teardown in Linux/macOS before backend downloads')
    def test_real_owned_proxy_http_ready_headers_listener_and_teardown(self):
        # Local synthetic upstream is transport proof only, never Auth/RLS acceptance.
        requests = []
        class Upstream(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.path, self.headers.get('apikey'), self.headers.get('authorization')))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{}')
            def log_message(self, *_args):
                pass
        config = {'deadline': time.time() + 20, 'secret_env': {}, 'services': {}, 'status': {'ANON_KEY': 'synthetic-anon', 'SERVICE_ROLE_KEY': 'synthetic-service'}}
        native.private_json(self.path / 'config.json', config)
        handles = []
        popen = native.subprocess.Popen
        def retain_handle(*args, **kwargs):
            handle = popen(*args, **kwargs)
            if kwargs.get('start_new_session'):
                handles.append(handle)
            return handle
        with native.LoopbackHTTPServer(('127.0.0.1', 8010), Upstream) as upstream:
            thread = threading.Thread(target=upstream.serve_forever, daemon=True)
            thread.start()
            try:
                with patch.object(native.subprocess, 'Popen', side_effect=retain_handle):
                    native.spawn_worker(self.path, config, 'proxy')
                native.ready(self.path, 'proxy', 10, lambda: native.proxy_ready(config))
                native.verify_loopback_listeners(self.path, 'proxy', 54321)
                for key, token, status in [('synthetic-anon', 'Bearer synthetic-user', 200), ('foreign', None, 401)]:
                    connection = http.client.HTTPConnection('127.0.0.1', 54321, timeout=2)
                    try:
                        connection.request('GET', '/auth/v1/health', headers={'apikey': key, **({'authorization': token} if token else {})})
                        response = connection.getresponse()
                        self.assertEqual(response.status, status)
                        response.read()
                    finally:
                        connection.close()
                self.assertEqual(requests, [('/health', 'synthetic-anon', None), ('/health', 'synthetic-anon', 'Bearer synthetic-user')])
                log = (self.base / 'native-proxy-redacted.log').read_text(encoding='utf-8')
                for phase in ['owned-worker-enter', 'bind-enter', 'bind-complete', 'listen-complete', 'serve-enter', 'http-request', 'upstream-response']:
                    self.assertIn('phase=' + phase, log)
                self.assertNotIn('synthetic-', log)
                native.cleanup(self.path)
                self.assertFalse(native.stage.group_has_live_members(handles[0].pid))
            finally:
                for handle in handles:
                    if handle.poll() is None:
                        self.assertEqual(os.getpgid(handle.pid), handle.pid)
                        native.stage.terminate_group(handle.pid)
                    handle.wait(timeout=2)
                    self.assertFalse(native.stage.group_has_live_members(handle.pid))
                upstream.shutdown()
                thread.join(timeout=2)
                self.assertFalse(thread.is_alive())

    def test_proxy_forwards_actual_authorization_without_service_elevation(self):
        # Synthetic transport unit only: hosted real Auth/RLS assertions remain mandatory.
        requests = []
        class Upstream(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.path, self.headers.get('authorization')))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{}')
            def log_message(self, *_args):
                pass
        backend = native.LoopbackHTTPServer(('127.0.0.1', 0), Upstream)
        threading.Thread(target=backend.serve_forever, daemon=True).start()
        real_server = native.LoopbackHTTPServer
        proxy = real_server(('127.0.0.1', 0), native.BaseHTTPRequestHandler)
        port = proxy.server_port
        proxy.server_close()
        servers = []
        def capture_server(address, handler, **kwargs):
            server = real_server(('127.0.0.1', port), handler, **kwargs)
            servers.append(server)
            return server
        with patch.object(native, 'LoopbackHTTPServer', side_effect=capture_server), patch.object(native, 'upstream_route', return_value=(backend.server_port, '/actual')):
            thread = threading.Thread(target=native.serve_proxy, args=({'status': {'ANON_KEY': 'synthetic-anon', 'SERVICE_ROLE_KEY': 'synthetic-service'}},), daemon=True)
            thread.start()
            until = time.monotonic() + 3
            while not servers and time.monotonic() < until:
                time.sleep(.01)
            try:
                for token in (None, 'Bearer synthetic-user'):
                    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
                    connection.request('GET', '/rest/v1/actual', headers={'apikey': 'synthetic-service', **({'authorization': token} if token else {})})
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    response.read()
                    connection.close()
                self.assertEqual(requests, [('/actual', None), ('/actual', 'Bearer synthetic-user')])
                connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
                connection.request('GET', '/rest/v1/actual', headers={'apikey': 'foreign'})
                response = connection.getresponse()
                self.assertEqual(response.status, 401)
                response.read()
                connection.close()
                self.assertEqual(len(requests), 2)
            finally:
                if servers:
                    servers[0].shutdown()
                    servers[0].server_close()
                backend.shutdown()
                backend.server_close()

    def test_no_placeholder_storage_and_all_project_sql_order(self):
        source = (HERE / 'native-backend.py').read_text(encoding='utf-8')
        self.assertLess(source.index("bounded('native-storage-migrations'"), source.index("bounded('native-project-migrations'"))
        self.assertIn('dist/scripts/migrate-call.js', source)
        for schema in ('storage', 'auth', 'public'):
            self.assertNotIn(f'CREATE TABLE {schema}.', source)
        self.assertIn("if len(migrations) != 37", source)

    def test_project_migrations_are_separate_atomic_files_and_preserve_bytes(self):
        files = sorted((native.ROOT / 'supabase/migrations').glob('*.sql'))
        before = {file: file.read_bytes() for file in files}
        self.assertEqual(len(files), 37)
        explicit = [file.name for file in files if not native.migration_uses_implicit_transaction(file)]
        self.assertEqual(explicit, ['20260926154000_ept_58_privacidad_perfiles.sql', '20260926190000_ept_59_usuarios_permisos.sql'])
        with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run, redirect_stdout(io.StringIO()):
            native.run_transaction_probe_files('synthetic-psql', files)
        self.assertEqual(run.call_count, 37)
        for file, call in zip(files, run.call_args_list):
            command = call.args[0]
            self.assertEqual(command[-2:], ['-f', str(file)])
            self.assertEqual(command.count('-f'), 1)
            self.assertIn('ON_ERROR_STOP=1', command)
            self.assertIn('AUTOCOMMIT=on', command)
            self.assertEqual('--single-transaction' in command, file.name not in explicit)
            self.assertEqual(file.read_bytes(), before[file])

    def test_sql_failure_stops_later_files_and_propagates_exit(self):
        files = [self.path / f'{number}.sql' for number in range(3)]
        for file in files:
            file.write_text('SELECT 1;', encoding='utf-8')
        with patch.object(native.subprocess, 'run', side_effect=[subprocess.CompletedProcess([], 0), subprocess.CompletedProcess([], 3)]) as run, redirect_stdout(io.StringIO()) as trace:
            with self.assertRaises(native.MigrationFailure) as failure:
                native.run_transaction_probe_files('synthetic-psql', files)
            self.assertEqual(failure.exception.code, 3)
            self.assertEqual(run.call_count, 2)
            self.assertIn('subsequent files not executed', trace.getvalue())

    def test_unsupported_transaction_control_is_rejected_before_any_sql(self):
        first = self.path / 'first.sql'
        second = self.path / 'second.sql'
        first.write_text('SELECT 1;', encoding='utf-8')
        with patch.object(native.subprocess, 'run') as run:
            for body in ('BEGIN; SELECT 1;', 'COMMIT;', 'SELECT 1; BEGIN; SELECT 2; COMMIT;', 'BEGIN WORK; SELECT 1; COMMIT;', 'BEGIN; SELECT 1; ROLLBACK;', 'VACUUM;', 'CREATE INDEX CONCURRENTLY x ON y(z);'):
                second.write_text(body, encoding='utf-8')
                with self.assertRaisesRegex(RuntimeError, 'Unsupported'):
                    native.run_transaction_probe_files('synthetic-psql', [first, second])
            run.assert_not_called()

    def test_transaction_probe_checks_rollback_readback_and_rejects_wrong_error(self):
        def result(code=0, help=False):
            return subprocess.CompletedProcess([], code, stdout='--single-transaction' if help else '')
        with patch.object(native.subprocess, 'run', side_effect=[result(help=True), result(), result(), result(3), result(), result(3), result()]) as run, redirect_stdout(io.StringIO()) as trace:
            native.prove_transaction_contract(self.path, 'synthetic-psql')
            self.assertEqual(run.call_count, 7)
            self.assertIn('TEMP ON COMMIT lifetime passed', trace.getvalue())
            self.assertIn('explicit rollback readback passed', trace.getvalue())
            self.assertIn('ON COMMIT DROP', (self.path / 'transaction-positive.sql').read_text(encoding='utf-8'))
            self.assertIn('SELECT 1/0', (self.path / 'transaction-rollback.sql').read_text(encoding='utf-8'))
        with patch.object(native.subprocess, 'run', side_effect=[result(help=True), result(), result(), result(3), result(3)]), redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(native.MigrationFailure, 'rollback-readback'):
                native.prove_transaction_contract(self.path, 'synthetic-psql')
        with patch.object(native.subprocess, 'run', side_effect=[result(help=True), result(), result(), result(2)]), redirect_stdout(io.StringIO()):
            with self.assertRaises(native.MigrationFailure) as failure:
                native.prove_transaction_contract(self.path, 'synthetic-psql')
            self.assertEqual(failure.exception.code, 2)

    def test_official_cli_project_copy_preserves_all_sql_and_private_target(self):
        files = sorted((native.ROOT / 'supabase/migrations').glob('*.sql'))
        self.assertEqual(len(files), 37)
        project = native.copy_project_migrations(self.path, files)
        self.assertEqual(sorted(file.name for file in (project / 'supabase/migrations').iterdir()), [file.name for file in files])
        for file in files:
            self.assertEqual((project / 'supabase/migrations' / file.name).read_bytes(), file.read_bytes())
        self.assertFalse((project / 'supabase/config.toml').exists())
        with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)) as run:
            self.assertEqual(native.apply_cli_migrations('synthetic-cli', project), 1)
            args = run.call_args.args[0]
            self.assertEqual(args[:4], ['node', 'synthetic-cli', 'migration', 'up'])
            self.assertIn('--db-url', args)
            self.assertIn('postgresql://supabase_admin@127.0.0.1:54322/postgres?sslmode=disable&connect_timeout=5', args)
            self.assertNotIn('--linked', args)
            self.assertNotIn('--local', args)
            self.assertNotIn('--include-all', args)
            self.assertEqual(run.call_args.kwargs['stdin'], subprocess.DEVNULL)

    def test_project_history_readback_checks_every_actual_version_and_name(self):
        files = sorted((native.ROOT / 'supabase/migrations').glob('*.sql'))
        with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run, redirect_stdout(io.StringIO()) as trace:
            native.verify_project_history('synthetic-psql', files)
            sql = run.call_args.args[0][-1]
            self.assertIn(') <> 37', sql)
            self.assertIn('EXCEPT SELECT version,name', sql)
            self.assertIn('statements IS NULL OR cardinality(statements)=0', sql)
            for file in files:
                version, name = file.stem.split('_', 1)
                self.assertIn(json.dumps({'version': version, 'name': name}), sql)
            self.assertIn('37 versions/names verified', trace.getvalue())
        with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 3)):
            with self.assertRaisesRegex(native.MigrationFailure, 'project-history-readback'):
                native.verify_project_history('synthetic-psql', files)

    def test_cli_history_negatives_require_prior_and_no_failed_or_later_rows(self):
        with patch.object(native, 'apply_cli_migrations', return_value=1) as apply, patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run, redirect_stdout(io.StringIO()) as trace:
            native.prove_cli_history_contract(self.path, 'synthetic-psql', 'synthetic-cli')
            self.assertEqual(apply.call_count, 2)
            self.assertEqual(run.call_count, 3)
            for call in run.call_args_list[:2]:
                sql = call.args[0][-1]
                self.assertIn("name='probe' AND statements=ARRAY[", sql)
                self.assertIn("WHERE version IN", sql)
                self.assertIn(".failed') IS NOT NULL", sql)
                self.assertIn(".later') IS NOT NULL", sql)
                self.assertIn('DELETE FROM supabase_migrations.schema_migrations WHERE version=', sql)
            self.assertIn('Project history must start empty', run.call_args_list[-1].args[0][-1])
            self.assertIn('explicit prior retained', trace.getvalue())
        other = self.path / 'other'
        other.mkdir()
        with patch.object(native, 'apply_cli_migrations', return_value=0), patch.object(native.subprocess, 'run') as run:
            with self.assertRaises(native.MigrationFailure):
                native.prove_cli_history_contract(other, 'synthetic-psql', 'synthetic-cli')
            run.assert_not_called()  # Unexpected success cannot be cleaned into PASS.

    def test_cli_negative_error_cannot_mask_connection_or_unexpected_success(self):
        for code, output, accepted in [(1, 'ERROR: division by zero (SQLSTATE 22012)', True), (1, 'connection failed', False), (0, 'division by zero 22012', False), (3, 'division by zero 22012', False)]:
            with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], code, stdout=output, stderr='')), redirect_stdout(io.StringIO()):
                if accepted:
                    self.assertEqual(native.apply_cli_migrations('synthetic-cli', self.path, expected_sql_error=True), 1)
                else:
                    with self.assertRaises(native.MigrationFailure):
                        native.apply_cli_migrations('synthetic-cli', self.path, expected_sql_error=True)

    def test_lsof_process_file_sets_accept_mandatory_descriptors_and_multiple_sets(self):
        # Public source protocol fixture, not a captured private process listing.
        output = 'p124\ng123\nu5\nf9\nn127.0.0.1:8010\nf10\nn127.0.0.1:8011\np125\ng123\nu5\nf3\nn127.0.0.1:8010\n'
        with patch.object(native, 'process_identity', return_value={'uid': 5, 'pgid': 123}) as identity:
            ports = native.parse_owned_listeners(output, {'pid': 123, 'uid': 5}, 'auth')
            self.assertEqual(ports, {8010, 8011})
            self.assertEqual([call.args[0] for call in identity.call_args_list], [124, 125])

    def test_lsof_malformed_unknown_and_duplicate_fields_fail_without_private_values(self):
        prefix = 'p124\ng123\nu5\n'
        invalid = ['', prefix, prefix + 'n127.0.0.1:8010\n', prefix + 'f9\n', prefix + 'f9\nn127.0.0.1:8010\nn127.0.0.1:8011\n', prefix + 'u5\nf9\nn127.0.0.1:8010\n', prefix + 'f9\nn127.0.0.1:8010\nf9\nn127.0.0.1:8011\n', 'p124\nu5\nf9\nn127.0.0.1:8010\n', prefix + 'fmalformed-private-value\nn127.0.0.1:8010\n', prefix + 'cprivate-command-secret\n', prefix + '\x1bprivate-value\n', prefix + 'f9\nn127.0.0.1:99999\n', prefix + 'f9\nn127.0.0.1:8010', prefix + 'f9\nn127.0.0.1:8010\np124\n']
        with patch.object(native, 'process_identity', return_value={'uid': 5, 'pgid': 123}):
            for output in invalid:
                with self.subTest(output_shape=invalid.index(output)):
                    with self.assertRaises(RuntimeError) as failure:
                        native.parse_owned_listeners(output, {'pid': 123, 'uid': 5}, 'auth')
                    self.assertNotIn('private', str(failure.exception))
                    self.assertNotIn('124', str(failure.exception))
                    self.assertRegex(str(failure.exception), r'field_id=(?:[A-Za-z]|invalid)$')

    def test_lsof_process_metadata_foreign_uid_and_group_fail(self):
        with patch.object(native, 'process_identity', return_value={'uid': 5, 'pgid': 123}):
            for output in ['p124\ng999\nu5\nf9\nn127.0.0.1:8010\n', 'p124\ng123\nu99\nf9\nn127.0.0.1:8010\n']:
                with self.assertRaisesRegex(RuntimeError, 'Foreign'):
                    native.parse_owned_listeners(output, {'pid': 123, 'uid': 5}, 'auth')

    def test_owned_listener_readback_rejects_wildcard_foreign_and_missing_port(self):
        native.private_json(self.path / 'auth.pid.json', {'pid': 123, 'uid': 5, 'start': 'synthetic'})
        owned = {'uid': 5, 'pgid': 123}
        with patch.object(native, 'verify_worker'), patch.object(native, 'process_identity', return_value=owned), redirect_stdout(io.StringIO()):
            for output, code, expected in [('p124\ng123\nu5\nf9\nn127.0.0.1:8010\n', 0, None), ('p124\ng123\nu5\nf9\nn*:8010\n', 0, 'Non-loopback'), ('p124\ng123\nu5\nf9\nn[::]:8010\n', 0, 'Non-loopback'), ('p124\ng123\nu5\nf9\nn127.0.0.1:9999\n', 0, 'missing'), ('', 1, 'unavailable')]:
                with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], code, stdout=output, stderr='revision: 4.91')) as run:
                    if expected:
                        with self.assertRaisesRegex(RuntimeError, expected):
                            native.verify_loopback_listeners(self.path, 'auth', 8010)
                    else:
                        native.verify_loopback_listeners(self.path, 'auth', 8010)
                    self.assertIn('-g', run.call_args.args[0])
            for foreign in ({'uid': 6, 'pgid': 123}, {'uid': 5, 'pgid': 999}, None):
                with patch.object(native, 'process_identity', return_value=foreign), patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout='p124\ng123\nu5\nf9\nn127.0.0.1:8010\n', stderr='revision: 4.91')):
                    with self.assertRaisesRegex(RuntimeError, 'Foreign'):
                        native.verify_loopback_listeners(self.path, 'auth', 8010)

    def test_redactor_knows_generated_secrets_and_jwt(self):
        token = native.jwt('synthetic-secret', 'service_role')
        with patch.dict(os.environ, {'EPT_NATIVE_SECRET': 'synthetic-secret'}):
            result = native.stage.redact(f'synthetic-secret {token} sb_secret_syntheticvalue')
        self.assertNotIn('synthetic-secret', result)
        self.assertNotIn(token, result)
        self.assertNotIn('sb_secret_syntheticvalue', result)

    def consume_auth_startup(self, env, expect_success=True):
        # Execute the existing startup guard/status code, not Auth assertion mocks.
        source = (native.ROOT / 'mobile/scripts/integracion-auth-local.mjs').read_text(encoding='utf-8').split('let local\n')[0]
        source = source.replace("resolve(import.meta.dirname, '../..')", f'resolve({json.dumps(str(native.ROOT))})')
        source = source.replace("'./integracion-auth-utils.mjs'", json.dumps((native.ROOT / 'mobile/scripts/integracion-auth-utils.mjs').as_uri()))
        source = source.replace("import { execFileSync } from 'node:child_process'", "import { execFileSync as realExec } from 'node:child_process'; const execFileSync = (exe, args, options) => { assert.equal(exe, 'python3'); assert.ok(args[0].endsWith('native-backend.py')); return realExec(process.env.EPT_TEST_PYTHON, args, options) }")
        source += "\nrequireWorkdir(); const status = runStatus(); assert.equal(status.api, process.env.EXPO_PUBLIC_SUPABASE_URL); assert.equal(status.anon, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY); assert.notEqual(status.service, status.anon);"
        result = subprocess.run(['node', '--input-type=module', '--eval', source], env={**os.environ, **env, 'EPT_TEST_PYTHON': sys.executable}, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode == 0, expect_success, 'Existing Auth startup contract returned unexpected exit status')
        self.assertEqual(result.stdout, '')  # No status/JWT reaches output.

    def simulated_start(self, fail_ready=False):
        # Orchestration unit only. No native binary execution or backend PASS claim.
        output = self.path / 'github-env'
        events = []
        def readiness(path, service, seconds, check):
            events.append(service)
            text = output.read_text(encoding='utf-8')
            self.assertNotIn('EXPO_PUBLIC_', text)
            self.assertNotIn('EPT_MOBILE_AUTH_INTEGRATION', text)
            if fail_ready and service == 'proxy':
                raise RuntimeError('Synthetic readiness failure')
        uid = getattr(os, 'getuid', lambda: 0)()
        with patch.dict(os.environ, {'GITHUB_ENV': str(output)}), patch.object(native.os, 'getuid', return_value=uid, create=True), patch.object(native.platform, 'system', return_value='Darwin'), patch.object(native.platform, 'machine', return_value='arm64'), patch.object(native.socket, 'socket'), patch.object(native, 'check_port_available') as ports, patch.object(native, 'bounded'), patch.object(native, 'spawn_worker'), patch.object(native, 'ready', side_effect=readiness), patch.object(native, 'cleanup'), patch.object(native, 'verify_loopback_listeners'), patch.object(native, 'publish_public_environment', wraps=native.publish_public_environment) as publish, redirect_stdout(io.StringIO()):
            if fail_ready:
                with self.assertRaisesRegex(RuntimeError, 'readiness failure'):
                    native.start()
                publish.assert_not_called()
            else:
                native.start()
                publish.assert_called_once()
        self.assertEqual([call.args[0] for call in ports.call_args_list], list(native.NATIVE_PORTS))
        self.assertEqual(events, ['postgres', 'auth', 'storage', 'postgrest', 'proxy'])
        return dict(line.split('=', 1) for line in output.read_text(encoding='utf-8').splitlines())

    def test_startup_env_existing_auth_and_public_build_contract(self):
        env = self.simulated_start()
        self.assertEqual(set(env), {'EPT_MOBILE_NATIVE_BACKEND', 'EPT_MOBILE_NATIVE_WORKDIR', 'EPT_MOBILE_AUTH_INTEGRATION', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'})
        self.assertEqual(env['EPT_MOBILE_AUTH_INTEGRATION'], '1')
        self.assertEqual(env['EXPO_PUBLIC_SUPABASE_URL'], 'http://127.0.0.1:54321')
        path = Path(env['EPT_MOBILE_NATIVE_WORKDIR'])
        config = native.read_private(path / 'config.json')
        exported = '\n'.join(env.values())
        self.assertNotIn(config['status']['SERVICE_ROLE_KEY'], exported)
        for secret in config['secret_env'].values():
            self.assertNotIn(secret, exported)
        build_config = (native.ROOT / 'mobile/app.config.ts').read_text(encoding='utf-8')
        self.assertIn("process.env.EPT_MOBILE_AUTH_INTEGRATION === '1'", build_config)
        # Native-only pointer reaches real private status; no CLI workdir is present.
        self.assertNotIn('EPT_MOBILE_SUPABASE_WORKDIR', env)
        with patch.dict(os.environ, {'EPT_MOBILE_SUPABASE_WORKDIR': ''}):
            self.consume_auth_startup(env)
            # Neither backend may borrow the other backend's workdir.
            self.consume_auth_startup({**env, 'EPT_MOBILE_NATIVE_WORKDIR': '', 'EPT_MOBILE_SUPABASE_WORKDIR': 'foreign-cli'}, expect_success=False)
            self.consume_auth_startup({**env, 'EPT_MOBILE_NATIVE_BACKEND': '0'}, expect_success=False)
            self.consume_auth_startup({**env, 'GITHUB_RUN_ID': 'foreign-run'}, expect_success=False)

    def test_failed_readiness_cannot_publish_public_build_env(self):
        env = self.simulated_start(fail_ready=True)
        self.assertEqual(set(env), {'EPT_MOBILE_NATIVE_BACKEND', 'EPT_MOBILE_NATIVE_WORKDIR'})

    @unittest.skipUnless(os.name == 'posix', 'Real foreground worker tree proof in Linux/macOS diagnostics')
    def test_owned_worker_kills_blocked_parent_and_grandchild(self):
        self.exercise_owned_tree()

    @unittest.skipUnless(os.name == 'posix', 'Fixture failure teardown proof in Linux/macOS diagnostics')
    def test_owned_fixture_reaps_tree_even_if_identity_verification_fails(self):
        self.exercise_owned_tree(force_failure=True)

    def exercise_owned_tree(self, force_failure=False):
        ids = self.path / 'child-ids'
        child = 'import os,signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);print(os.getpid(),flush=True);time.sleep(60)'
        parent = f'import subprocess,sys,os,signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);p=subprocess.Popen([sys.executable,"-c",{child!r}],stdout=open({str(ids)!r},"w"));time.sleep(60)'
        config = {'deadline': time.time() + 60, 'secret_env': {}, 'services': {'postgres': {'command': [sys.executable, '-c', parent], 'env': {}}}}
        native.private_json(self.path / 'config.json', config)
        handles = []
        popen = native.subprocess.Popen
        def retain_handle(*args, **kwargs):
            process = popen(*args, **kwargs)
            if kwargs.get('start_new_session') and args[0][2:3] == ['worker']:
                handles.append(process)  # Retained before spawn_worker can raise.
            return process
        try:
            with patch.object(native.subprocess, 'Popen', side_effect=retain_handle):
                if force_failure:
                    # Fail only worker admission, after it has created its witness.
                    with patch.object(native, 'verify_worker', side_effect=RuntimeError('Synthetic identity failure')):
                        with self.assertRaisesRegex(RuntimeError, 'Synthetic identity failure'):
                            native.spawn_worker(self.path, config, 'postgres')
                else:
                    native.spawn_worker(self.path, config, 'postgres')
            process = handles[0].pid
            until = time.monotonic() + 5
            while (not ids.exists() or not ids.read_text().strip()) and time.monotonic() < until:
                time.sleep(.05)
            self.assertTrue(ids.exists(), 'Grandchild did not start')
            self.assertTrue(ids.read_text().strip().isdigit())
            self.assertTrue(native.stage.group_has_live_members(process))
            if force_failure:
                return  # finally must close/reap this already running blocked tree.
            native.cleanup(self.path)
            self.assertFalse(native.stage.group_has_live_members(process))
            native.cleanup(self.path)  # Confirm readback makes repeated cleanup harmless.
        finally:
            for handle in handles:
                # Only freshly created live Popen children, never a pid from metadata.
                if handle.poll() is None:
                    self.assertEqual(os.getpgid(handle.pid), handle.pid)
                    native.stage.terminate_group(handle.pid)
                handle.wait(timeout=2)
                self.assertFalse(native.stage.group_has_live_members(handle.pid))


if __name__ == '__main__':
    unittest.main(verbosity=2)
