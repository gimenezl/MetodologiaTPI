#!/usr/bin/env python3
"""Ownership/cleanup contract tests; no simulator or native acceptance is mocked."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import sys
sys.dont_write_bytecode = True
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ios_simulator", Path(__file__).with_name("ios-simulator.py"))
ios = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ios)
UDID = "00000000-0000-0000-0000-000000000001"
RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-18-5"


class SimulatorOwnership(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = patch.dict(os.environ, {"RUNNER_TEMP": str(Path(self.tmp.name).resolve()), "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.uid = patch.object(ios.os, "getuid", return_value=42, create=True)
        self.uid.start()
        self.addCleanup(self.uid.stop)
        self.record = {**ios.identity(), "runtime": RUNTIME, "udid": UDID}
        self.listing = {RUNTIME: [{"name": self.record["name"], "udid": UDID, "state": "Booted"}]}

    def test_installed_runtime_requires_available_compatible_phone(self):
        runtime = {"identifier": RUNTIME, "isAvailable": True, "version": "18.5"}
        phone = {"identifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-16", "productFamily": "iPhone", "minRuntimeVersionString": "18.0", "maxRuntimeVersionString": "65535.255.255"}
        self.assertEqual(ios.select([runtime], [phone]), (RUNTIME, phone["identifier"]))
        for changed in ({**phone, "productFamily": "iPad"}, {**phone, "minRuntimeVersionString": "19.0"}):
            with self.assertRaises(RuntimeError): ios.select([runtime], [changed])
        with self.assertRaises(RuntimeError): ios.select([{**runtime, "isAvailable": False}], [phone])

    def test_foreign_name_udid_runtime_and_ambiguous_never_admitted(self):
        self.assertEqual(ios.owned_device(self.record, self.listing)["udid"], UDID)
        cases = [{RUNTIME: []}, {RUNTIME: [{**self.listing[RUNTIME][0], "name": "foreign"}]},
                 {RUNTIME: [{**self.listing[RUNTIME][0], "udid": "foreign"}]}, {"foreign": self.listing[RUNTIME]},
                 {RUNTIME: self.listing[RUNTIME] * 2}]
        for listing in cases:
            with self.assertRaises(RuntimeError): ios.owned_device(self.record, listing)

    def test_marker_foreign_attempt_uid_and_permissions_rejected(self):
        ios.marker_path().write_text(json.dumps(self.record), encoding="utf8")
        metadata = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=42)
        with patch.object(Path, "lstat", return_value=metadata):
            self.assertEqual(ios.load(), self.record)
            with patch.dict(os.environ, {"EPT_IOS_UDID": "foreign"}):
                with self.assertRaises(RuntimeError): ios.load()
            for key, value in (("run", "999"), ("attempt", "999"), ("uid", 99)):
                ios.marker_path().write_text(json.dumps({**self.record, key: value}), encoding="utf8")
                with self.assertRaises(RuntimeError): ios.load()
        for mode, uid in ((stat.S_IFLNK | 0o600, 42), (stat.S_IFREG | 0o644, 42), (stat.S_IFREG | 0o600, 99)):
            with patch.object(Path, "lstat", return_value=SimpleNamespace(st_mode=mode, st_uid=uid)):
                with self.assertRaises(RuntimeError): ios.load()

    def test_foreign_cleanup_sends_no_commands(self):
        ios.marker_path().touch()
        with patch.object(ios, "load", side_effect=RuntimeError("foreign")), patch.object(ios, "command") as command:
            with self.assertRaises(RuntimeError): ios.cleanup()
            command.assert_not_called()

    def test_owned_shutdown_then_delete_and_readback(self):
        ios.marker_path().touch()
        shutdown = {RUNTIME: [{**self.listing[RUNTIME][0], "state": "Shutdown"}]}
        with patch.object(ios, "load", return_value=self.record), patch.object(ios, "devices", side_effect=[self.listing, shutdown, {}]), patch.object(ios, "command") as command:
            ios.cleanup()
            calls = [c.args for c in command.call_args_list]
            self.assertEqual([c[4] for c in calls], ["terminate", "terminate", "shutdown", "delete"])
            self.assertTrue(all(c[5] == UDID for c in calls))
            self.assertEqual([calls[0][6], calls[1][6]], [ios.APP, ios.DRIVER])
            self.assertFalse(ios.marker_path().exists())

    def test_failed_shutdown_readback_never_deletes(self):
        ios.marker_path().touch()
        with patch.object(ios, "load", return_value=self.record), patch.object(ios, "devices", return_value=self.listing), patch.object(ios, "command") as command:
            with self.assertRaises(RuntimeError): ios.cleanup()
            self.assertFalse(any(c.args[4] == "delete" for c in command.call_args_list))
            self.assertTrue(ios.marker_path().exists())

    def test_port_preflight_foreign_listener_warning_and_error_fail_closed(self):
        for result in (SimpleNamespace(returncode=0, stdout="123\n", stderr=""), SimpleNamespace(returncode=1, stdout="", stderr="warning"), SimpleNamespace(returncode=2, stdout="", stderr="")):
            with patch.object(ios, "load"), patch.object(ios.subprocess, "run", return_value=result) as run:
                with self.assertRaises(RuntimeError): ios.driver_preflight()
                self.assertEqual(run.call_args.args[0][-2:], ["-t", "+w"])
        with patch.object(ios, "load"), patch.object(ios.subprocess, "run", return_value=SimpleNamespace(returncode=1, stdout="", stderr="")):
            ios.driver_preflight()

    def test_owned_app_processes_only_normalized_exact_bundle_labels(self):
        text = f"PID Status Label\n123 0 UIKitApplication:{ios.APP}[opaque]\n- 0 {ios.DRIVER}\n999 0 foreign.secret\n"
        self.assertEqual(ios.app_processes(text), {ios.APP: True, ios.DRIVER: False})
        self.assertEqual(ios.app_processes(f"123 0 {ios.APP}.foreign"), {ios.APP: False, ios.DRIVER: False})

    def test_status_body_never_logged_and_endpoint_pinned(self):
        with patch.object(ios, "load", return_value=self.record), patch.object(ios, "devices", return_value=self.listing), patch.object(ios, "command", return_value=""), patch.object(ios.http.client, "HTTPConnection") as http:
            response = http.return_value.getresponse.return_value
            response.status = 200
            ios.status()
            http.assert_called_once_with("127.0.0.1", 22087, timeout=1)
            http.return_value.request.assert_called_once_with("GET", "/status")
            response.read.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
