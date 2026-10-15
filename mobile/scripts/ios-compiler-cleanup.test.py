#!/usr/bin/env python3
"""Ownership and privacy contracts; real Darwin kernel proof runs on macOS only."""
import errno
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import signal
import struct
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("compiler", Path(__file__).with_name("ios-compiler-cleanup.py"))
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


class Ownership(unittest.TestCase):
    def setUp(self):
        self.record = {"pid": 987654, "uid": 123, "birth": [100, 2], "exe": "/selected/ibtoold"}
        self.owner = {"uid": 123}
        self.token = b"fixture-private-token"
        patcher = patch.object(signal, 'SIGKILL', 9, create=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def api(self, records, tracking=None):
        class Fake:
            def candidates(_): return list(records)
            def identity(_, pid): return records.get(pid)
            def tracking(_, pid): return self.token if tracking is None else tracking
        return Fake()

    def low_level_api(self, bsd_events, path_result=20, path_error=0):
        api = compiler.Darwin.__new__(compiler.Darwin)
        events = iter(bsd_events)
        calls = []
        class Proc:
            def proc_pidinfo(_, pid, flavor, arg, output, size):
                self.assertEqual(compiler.ctypes.get_errno(), 0)
                calls.append('bsd')
                event = next(events)
                if 'result' in event:
                    compiler.ctypes.set_errno(event.get('errno', 0))
                    return event['result']
                info = compiler.BsdInfo()
                info.pid, info.uid, info.status = event.get('pid', pid), event.get('uid', 123), event.get('status', 1)
                info.birth_sec, info.birth_usec = event.get('birth', [100, 2])
                compiler.ctypes.memmove(output, compiler.ctypes.byref(info), size)
                return size
            def proc_pidpath(_, pid, output, size):
                self.assertEqual(compiler.ctypes.get_errno(), 0)
                calls.append('path')
                compiler.ctypes.set_errno(path_error)
                output.value = b'/private/fixture/ibtoold' if path_result > 0 else b''
                return path_result
        api.proc = Proc()
        return api, calls

    def test_bsd_only_verified_esrch_or_zombie_retire_and_stale_errno_never_does(self):
        for event in [{'result': 0}, {'result': 8, 'errno': errno.ESRCH}, {'result': 0, 'errno': errno.EPERM}, {'result': -1, 'errno': errno.ESRCH}]:
            api, calls = self.low_level_api([event])
            compiler.ctypes.set_errno(errno.ESRCH)
            with self.assertRaises(compiler.OwnershipUnknown): api.identity(987654)
            self.assertEqual(calls, ['bsd'])
        for event in [{'result': 0, 'errno': errno.ESRCH}, {'status': 5}]:
            api, calls = self.low_level_api([event])
            self.assertIsNone(api.identity(987654))
            self.assertEqual(calls, ['bsd'])

    def test_path_failure_fresh_bsd_retired_only_live_reused_or_denied_unknown(self):
        for event in [{'result': 0, 'errno': errno.ESRCH}, {'status': 5}, {}, {'birth': [101, 1]}, {'uid': 2}, {'result': 0, 'errno': errno.EPERM}, {'result': 0}]:
            api, calls = self.low_level_api([{}, event], path_result=0, path_error=errno.ESRCH)
            if event.get('status') == 5 or event.get('errno') == errno.ESRCH:
                self.assertIsNone(api.identity(987654))
            else:
                with self.assertRaises(compiler.OwnershipUnknown): api.identity(987654)
            self.assertEqual(calls, ['bsd', 'path', 'bsd'])

    def test_successful_path_requires_fresh_same_pid_uid_birth_and_live_kernel(self):
        for event in [{}, {'pid': 987655}, {'uid': 2}, {'birth': [101, 1]}, {'status': 5}, {'result': 0, 'errno': errno.ESRCH}, {'result': 0, 'errno': errno.EPERM}]:
            api, calls = self.low_level_api([{}, event], path_error=errno.ESRCH)
            with patch.object(Path, 'resolve', return_value=Path('/canonical/ibtoold')):
                if event == {}:
                    result = api.identity(987654)
                    self.assertEqual(result['birth'], [100, 2])
                    self.assertEqual(result['uid'], 123)
                elif event.get('status') == 5 or event.get('errno') == errno.ESRCH:
                    self.assertIsNone(api.identity(987654))
                else:
                    with self.assertRaises(compiler.OwnershipUnknown): api.identity(987654)
            self.assertEqual(calls, ['bsd', 'path', 'bsd'])

    def test_canonical_path_failure_requires_fresh_kernel_retirement(self):
        for event in [{'status': 5}, {'result': 0, 'errno': errno.ESRCH}, {}, {'birth': [101, 1]}, {'result': 0, 'errno': errno.EPERM}]:
            api, calls = self.low_level_api([{}, event])
            with patch.object(Path, 'resolve', side_effect=PermissionError('private-unavailable')):
                if event.get('status') == 5 or event.get('errno') == errno.ESRCH:
                    self.assertIsNone(api.identity(987654))
                else:
                    with self.assertRaises(compiler.OwnershipUnknown): api.identity(987654)
            self.assertEqual(calls, ['bsd', 'path', 'bsd'])

    def test_both_sysctl_calls_clear_stale_errno_without_exposing_raw_environment(self):
        api = compiler.Darwin.__new__(compiler.Darwin)
        raw = struct.pack('=i', 1) + b'/private/executable\0\0argv\0RUNNER_TRACKING_ID=private-fixture\0'
        calls = []
        class Libc:
            def sysctl(_, mib, count, output, size, new, newsize):
                self.assertEqual(compiler.ctypes.get_errno(), 0)
                calls.append(output is not None)
                compiler.ctypes.cast(size, compiler.ctypes.POINTER(compiler.ctypes.c_size_t)).contents.value = len(raw)
                if output is not None: compiler.ctypes.memmove(output, raw, len(raw))
                compiler.ctypes.set_errno(errno.ESRCH)
                return 0
        api.libc = Libc()
        compiler.ctypes.set_errno(errno.EPERM)
        self.assertEqual(api.tracking(987654), b'private-fixture')
        self.assertEqual(calls, [False, True])

    def test_native_argc_environment_framing_and_private_values(self):
        prefix = struct.pack("=i", 2) + b"/private/executable\0\0arg0\0secret-arg\0"
        self.assertEqual(compiler.tracking_from_args(prefix + b"SECRET=private-password\0RUNNER_TRACKING_ID=job-token\0"), b"job-token")
        for raw in [b"", struct.pack("=i", -1), prefix, prefix + b"BROKEN\0", prefix + b"RUNNER_TRACKING_ID=truncated", prefix + b"RUNNER_TRACKING_ID=\0", prefix + b"RUNNER_TRACKING_ID=a\0RUNNER_TRACKING_ID=b\0"]:
            with self.assertRaises(compiler.OwnershipUnknown): compiler.tracking_from_args(raw)

    def test_foreign_uid_executable_token_and_baseline_untouched(self):
        for records, token, baseline in [({987654: {**self.record, "uid": 2}}, None, []), ({987654: {**self.record, "exe": "/foreign/ibtoold"}}, b"foreign", []), ({987654: self.record}, b"foreign", []), ({987654: self.record}, None, [self.record])]:
            with patch.object(compiler.os, "kill") as kill, redirect_stdout(io.StringIO()):
                result = compiler.cleanup_records(self.api(records, token), self.owner, self.token, baseline, lambda exe: exe == self.record['exe'])
                kill.assert_not_called()
                self.assertEqual(result['eligible'], 0)

    def test_exact_birth_executable_uid_changed_before_signal_fail_unknown(self):
        for change in ({"birth": [101, 1]}, {"uid": 2}, {"exe": "/foreign/ibtoold"}):
            api = self.api({987654: self.record})
            original = api.identity
            calls = 0
            def identity(pid):
                nonlocal calls
                calls += 1
                return original(pid) if calls == 1 else {**self.record, **change}
            api.identity = identity
            with patch.object(compiler.os, "kill") as kill:
                with self.assertRaises(compiler.OwnershipUnknown): compiler.cleanup_records(api, self.owner, self.token, [], lambda _: True)
                kill.assert_not_called()

    def test_inaccessible_tracking_and_missing_token_fail_without_signals(self):
        api = self.api({987654: self.record})
        api.tracking = lambda _: (_ for _ in ()).throw(compiler.OwnershipUnknown())
        with patch.object(compiler.os, "kill") as kill:
            with self.assertRaises(compiler.OwnershipUnknown): compiler.cleanup_records(api, self.owner, self.token, [], lambda _: True)
            kill.assert_not_called()
        with patch.dict(os.environ, {"RUNNER_TRACKING_ID": ""}):
            with self.assertRaises(compiler.OwnershipUnknown): compiler.context()

    def test_death_between_kernel_and_tracking_read_retires_without_more_signals(self):
        records = {987654: self.record}
        api = self.api(records)
        sent = []
        def tracking(pid):
            if sent:
                records.pop(pid, None)
                raise compiler.OwnershipUnknown()
            return self.token
        api.tracking = tracking
        with patch.object(compiler.os, 'kill', side_effect=lambda pid, sig: sent.append((pid, sig))) as kill, redirect_stdout(io.StringIO()):
            result = compiler.cleanup_records(api, self.owner, self.token, [], lambda _: True)
            kill.assert_called_once_with(987654, signal.SIGTERM)
        self.assertEqual(result['retired'], 1)
        self.assertEqual(result['kill'], 0)

    def test_native_sysctl_permission_denied_stays_unknown_while_kernel_is_live(self):
        api = compiler.Darwin.__new__(compiler.Darwin)
        class Denied:
            def sysctl(self, *args):
                compiler.ctypes.set_errno(1)  # Darwin EPERM; no output or fallback.
                return -1
        api.libc = Denied()
        api.candidates = lambda: [self.record['pid']]
        api.identity = lambda _: self.record
        with patch.object(compiler.os, 'kill') as kill:
            with self.assertRaises(compiler.OwnershipUnknown): compiler.cleanup_records(api, self.owner, self.token, [], lambda _: True)
            kill.assert_not_called()

    def test_tracking_error_live_permission_reused_and_inaccessible_never_retire(self):
        for fresh in [self.record, {**self.record, 'birth': [101, 1]}, compiler.OwnershipUnknown()]:
            api = self.api({987654: self.record})
            signaled = []
            identity_reads_after_signal = []
            def identity(pid):
                if signaled:
                    identity_reads_after_signal.append(pid)
                    if len(identity_reads_after_signal) > 1:
                        if isinstance(fresh, Exception): raise fresh
                        return fresh
                return self.record
            def tracking(pid):
                if signaled: raise compiler.OwnershipUnknown()
                return self.token
            api.identity, api.tracking = identity, tracking
            with patch.object(compiler.os, 'kill', side_effect=lambda pid, sig: signaled.append((pid, sig))) as kill:
                with self.assertRaises(compiler.OwnershipUnknown): compiler.cleanup_records(api, self.owner, self.token, [], lambda _: True)
                kill.assert_called_once_with(987654, signal.SIGTERM)
            self.assertEqual(len(identity_reads_after_signal), 2)

    def test_gone_process_safe_and_readback_requires_retired(self):
        with patch.object(compiler.os, "kill") as kill, redirect_stdout(io.StringIO()):
            result = compiler.cleanup_records(self.api({987654: None}), self.owner, self.token, [], lambda _: True)
            kill.assert_not_called()
            self.assertEqual(result['retired'], 0)
        with patch.object(compiler.os, "kill"):
            with self.assertRaises(compiler.OwnershipUnknown): compiler.cleanup_records(self.api({987654: self.record}), self.owner, self.token, [], lambda _: True, seconds=0)

    def test_marker_private_shape_and_foreign_attempt_rejected(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {"RUNNER_TEMP": temp}), patch.object(compiler.os, 'getuid', return_value=123, create=True):
            directory = Path(temp) / 'ept105-ios-compiler-owner'
            directory.mkdir()
            marker = directory / 'baseline.json'
            marker.write_text('{}')
            with self.assertRaises(compiler.OwnershipUnknown): compiler.secure_read()
        with patch.object(compiler, 'context', return_value=(self.owner, self.token)), patch.object(compiler, 'secure_read', return_value={'owner': {'uid': 2}, 'baseline': []}):
            with self.assertRaises(compiler.OwnershipUnknown): compiler.cleanup(self.api({}))

    def test_owned_signals_recheck_tracking_and_safe_aggregate_readback(self):
        records = {987654: self.record}
        api = self.api(records)
        output = io.StringIO()
        with patch.object(compiler.os, 'kill', side_effect=lambda pid, _: records.pop(pid, None)) as kill, redirect_stdout(output):
            result = compiler.cleanup_records(api, self.owner, self.token, [], lambda _: True)
            kill.assert_called_once_with(987654, signal.SIGTERM)
        self.assertEqual(result['retired'], 1)
        for private in ('987654', '/selected', self.token.decode(), '100'): self.assertNotIn(private, output.getvalue())
        api = self.api({987654: self.record})
        tokens = iter([self.token, b'foreign'])
        api.tracking = lambda _: next(tokens)
        with patch.object(compiler.os, 'kill') as kill:
            with self.assertRaises(compiler.OwnershipUnknown): compiler.cleanup_records(api, self.owner, self.token, [], lambda _: True)
            kill.assert_not_called()
        with patch.object(compiler.os, 'kill') as kill:
            with self.assertRaises(compiler.OwnershipUnknown): compiler.cleanup_records(self.api({987654: self.record}), self.owner, self.token, [], lambda _: False)
            kill.assert_not_called()

    @unittest.skipUnless(os.name == 'posix', 'POSIX permissions and no-follow open required')
    def test_real_private_marker_and_symlink_malformed_state_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RUNNER_TEMP': temp, 'GITHUB_RUN_ID': '1', 'GITHUB_RUN_ATTEMPT': '2', 'RUNNER_TRACKING_ID': 'private-fixture', 'DEVELOPER_DIR': str(compiler.DEVELOPER)}):
            api = self.api({})
            api.tracking = lambda _: b'private-fixture'
            compiler.baseline(api)
            self.assertEqual(compiler.secure_read()['baseline'], [])
            marker = compiler.state_dir() / 'baseline.json'
            original = marker.read_text()
            marker.chmod(0o644)
            with self.assertRaises(compiler.OwnershipUnknown): compiler.secure_read()
            marker.chmod(0o600)
            marker.write_text('{"owner":{},"baseline":"private-malformed"}')
            with self.assertRaises(compiler.OwnershipUnknown): compiler.cleanup(api)
            marker.unlink()
            target = Path(temp) / 'foreign-state'
            target.write_text(original)
            marker.symlink_to(target)
            with self.assertRaises(compiler.OwnershipUnknown): compiler.secure_read()
            marker.unlink()
            compiler.state_dir().rmdir()
            foreign_dir = Path(temp) / 'foreign-directory'
            foreign_dir.mkdir(mode=0o700)
            compiler.state_dir().symlink_to(foreign_dir, target_is_directory=True)
            with self.assertRaises(compiler.OwnershipUnknown): compiler.secure_read()

    @unittest.skipUnless(platform.system() == 'Darwin', 'Darwin kernel birth/environment/native signals require hosted macOS')
    def test_darwin_real_kernel_tracking_birth_term_kill_and_foreign_fixture(self):
        api = compiler.Darwin()
        token = b'fixture-owned-token'
        env = {**os.environ, 'RUNNER_TRACKING_ID': token.decode()}
        processes = []
        try:
            for ignore in (False, True):
                code = 'import signal,time; ' + ('signal.signal(signal.SIGTERM,signal.SIG_IGN); ' if ignore else '') + 'print("ready",flush=True); time.sleep(30)'
                child = subprocess.Popen([sys.executable, '-c', code], env=env, stdout=subprocess.PIPE, text=True)
                processes.append(child)
                self.assertEqual(child.stdout.readline().strip(), 'ready')
                record = api.identity(child.pid)
                self.assertEqual(api.tracking(child.pid), token)
                self.assertEqual(record, api.identity(child.pid))
                self.assertEqual(record['uid'], os.getuid())
                with patch.object(api, 'candidates', return_value=[child.pid]), redirect_stdout(io.StringIO()) as output:
                    result = compiler.cleanup_records(api, {'uid': os.getuid()}, token, [], lambda exe: exe == record['exe'])
                child.wait(timeout=2)
                self.assertEqual(result['retired'], 1)
                self.assertEqual(result['kill'], int(ignore))
                for secret in (token.decode(), record['exe'], str(child.pid)): self.assertNotIn(secret, output.getvalue())
            foreign = subprocess.Popen([sys.executable, '-c', 'import time;print("ready",flush=True);time.sleep(30)'], env={**env, 'RUNNER_TRACKING_ID': 'foreign-fixture'}, stdout=subprocess.PIPE, text=True)
            processes.append(foreign)
            self.assertEqual(foreign.stdout.readline().strip(), 'ready')
            record = api.identity(foreign.pid)
            with patch.object(api, 'candidates', return_value=[foreign.pid]), patch.object(compiler.os, 'kill') as kill, redirect_stdout(io.StringIO()):
                compiler.cleanup_records(api, {'uid': os.getuid()}, token, [], lambda exe: exe == record['exe'])
                kill.assert_not_called()
            self.assertIsNone(foreign.poll())
        finally:
            # Direct Popen handles own these fixtures even when metadata assertions fail.
            for child in processes:
                if child.poll() is None: child.kill()
                child.wait(timeout=2)
                if child.stdout: child.stdout.close()


if __name__ == '__main__': unittest.main(verbosity=2)
