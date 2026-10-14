#!/usr/bin/env python3
"""Ownership/cleanup contract tests; no simulator or native acceptance is mocked."""
import importlib.util
import json
import io
from contextlib import redirect_stdout, redirect_stderr
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

    def selection_fixture(self):
        return {'runtimes': [{'identifier': RUNTIME, 'isAvailable': True, 'version': '18.5'}], 'devicetypes': [{'identifier': 'com.apple.CoreSimulator.SimDeviceType.iPhone-16', 'productFamily': 'iPhone', 'minRuntimeVersionString': '18.0', 'maxRuntimeVersionString': '65535.255.255'}], 'devices': {RUNTIME: []}}

    def test_full_creation_uses_one_aggregate_query_and_same_sdk_owned_udid(self):
        fixture = self.selection_fixture()
        calls = []
        def command(label, seconds, *args, **kwargs):
            calls.append((label, seconds, args))
            if label == 'ios-sdk-selection': return '18.5\n'
            if label == 'ios-inventory-json': return json.dumps(fixture)
            if label == 'ios-create': return UDID
            self.fail('Unexpected provider command')
        envfile = Path(self.tmp.name) / 'github-env'
        with patch.dict(os.environ, {'EPT_IOS_DIAGNOSTIC_PHASE': 'full', 'GITHUB_ENV': str(envfile)}), patch.object(ios, 'command', side_effect=command), patch.object(ios, 'devices', return_value=self.listing):
            ios.create()
        self.assertEqual([c for c in calls if c[2][:3] == ('xcrun', 'simctl', 'list')], [('ios-inventory-json', 65, ('xcrun', 'simctl', 'list', '-j'))])
        self.assertEqual(calls[-1][2][-2:], (fixture['devicetypes'][0]['identifier'], RUNTIME))
        record = json.loads(ios.marker_path().read_text(encoding='utf8'))
        self.assertEqual((record['sdk'], record['runtime'], record['udid']), ('18.5', RUNTIME, UDID))
        self.assertIn('EPT_IOS_UDID=' + UDID, envfile.read_text(encoding='utf8'))

    def test_runtime_identifier_is_opaque_and_numeric_version_drives_sdk_match(self):
        fixture = self.selection_fixture()
        # Independent fields per upstream model; synthetic values, not the withheld hosted payload.
        fixture['runtimes'][0]['version'] = '18.5.1'
        inventory = ios.selection_inventory(json.dumps(fixture))
        self.assertEqual(ios.select(inventory['runtimes'], inventory['devicetypes'], '18.5.1')[0], RUNTIME)
        with self.assertRaises(ios.InventoryContractError) as missing:
            ios.select(inventory['runtimes'], inventory['devicetypes'], '18.5')
        self.assertEqual(missing.exception.reason_code, 'NO_SDK_RUNTIME')
        fixture['runtimes'][0]['identifier'] = 'com.apple.CoreSimulator.SimRuntime.iOS-private'
        with self.assertRaises(ios.InventoryContractError) as invalid:
            ios.selection_inventory(json.dumps(fixture))
        self.assertEqual(invalid.exception.reason_code, 'RUNTIME_ID')

    def test_selection_inventory_rejects_conflicting_identity_and_field_types(self):
        for change in ('duplicate-runtime', 'duplicate-type', 'string-availability', 'invalid-version', 'invalid-range', 'invalid-device-group'):
            fixture = self.selection_fixture()
            if change == 'duplicate-runtime': fixture['runtimes'] *= 2
            if change == 'duplicate-type': fixture['devicetypes'] *= 2
            if change == 'string-availability': fixture['runtimes'][0]['isAvailable'] = 'true'
            if change == 'invalid-version': fixture['runtimes'][0]['version'] = 'private-secret'
            if change == 'invalid-range': fixture['devicetypes'][0]['maxRuntimeVersionString'] = '17.0'
            if change == 'invalid-device-group': fixture['devices'][RUNTIME] = [{'name': {'private': 'never print'}}]
            with self.assertRaises(RuntimeError): ios.selection_inventory(json.dumps(fixture))

    def test_discovery_error_or_malformed_never_creates_marker_or_simulator(self):
        for data in ('invalid-private', '{}', json.dumps({**self.selection_fixture(), 'devicetypes': [{}]})):
            with patch.dict(os.environ, {'EPT_IOS_DIAGNOSTIC_PHASE': 'full'}), patch.object(ios, 'command', side_effect=['18.5', data]) as command:
                with self.assertRaises((ValueError, RuntimeError)): ios.create()
                self.assertEqual(command.call_count, 2)
                self.assertFalse(ios.marker_path().exists())
        with patch.dict(os.environ, {'EPT_IOS_DIAGNOSTIC_PHASE': 'full'}), patch.object(ios, 'command', side_effect=['18.5', RuntimeError('query exit124')]) as command:
            with self.assertRaises(RuntimeError): ios.create()
            self.assertEqual(command.call_count, 2)
            self.assertFalse(ios.marker_path().exists())
        for phase in ('runtime', 'unknown'):
            with patch.dict(os.environ, {'EPT_IOS_DIAGNOSTIC_PHASE': phase}), patch.object(ios, 'command') as command:
                with self.assertRaises(RuntimeError): ios.create()
                command.assert_not_called()

    def test_selection_requires_sdk_runtime_and_compatible_available_iphone(self):
        fixture = self.selection_fixture()
        for runtime, types, sdk in ([{**fixture['runtimes'][0], 'isAvailable': False}], fixture['devicetypes'], '18.5'), (fixture['runtimes'], fixture['devicetypes'], '26.2'), (fixture['runtimes'], [{**fixture['devicetypes'][0], 'minRuntimeVersionString': '19.0'}], '18.5'):
            with self.assertRaises(RuntimeError): ios.select(runtime, types, sdk)
        with self.assertRaises(RuntimeError): ios.version({'private': 'never print'})
        fixture['runtimes'].append({'identifier': 'com.apple.CoreSimulator.SimRuntime.iOS-26-2', 'isAvailable': True, 'version': '26.2'})
        self.assertEqual(ios.select(fixture['runtimes'], fixture['devicetypes'], '18.5')[0], RUNTIME)

    def test_closed_parser_codes_keep_private_values_and_exception_objects_out(self):
        scenarios = [
            ('invalid-private-secret', 'INVENTORY_JSON'), ('{}', 'INVENTORY_SHAPE'),
            (json.dumps({**self.selection_fixture(), 'devicetypes': [{'identifier': 'private-secret', 'productFamily': 'iPhone'}]}), 'TYPE_ID'),
            (json.dumps({**self.selection_fixture(), 'devicetypes': [{**self.selection_fixture()['devicetypes'][0], 'minRuntimeVersionString': None}]}), 'TYPE_RANGE_VERSION'),
        ]
        for data, expected in scenarios:
            output, error_output = io.StringIO(), io.StringIO()
            with redirect_stdout(output), redirect_stderr(error_output):
                try: ios.selection_inventory(data)
                except ios.InventoryContractError as error: ios.report_inventory_failure(error)
                else: self.fail('Negative parser should fail')
            self.assertEqual(error_output.getvalue(), 'SDK_CHECKCODE=' + expected + '\n')
            self.assertNotIn('private', output.getvalue() + error_output.getvalue())
            self.assertNotIn('secret', output.getvalue() + error_output.getvalue())
        private = ios.InventoryContractError({'private': 'secret'})
        private.reason_code = 'private-secret'
        with redirect_stderr(io.StringIO()) as output: ios.report_inventory_failure(private)
        self.assertEqual(output.getvalue(), 'SDK_CHECKCODE=INVENTORY_UNIDENTIFIED\n')

    def test_current_identifier_hypothesis_is_reported_not_silently_relaxed(self):
        for identifier in ('com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation', 'com.apple.CoreSimulator.SimDeviceType.iPhone-SE-(3rd-generation)'):
            fixture = self.selection_fixture()
            fixture['devicetypes'][0]['identifier'] = identifier
            if '(' in identifier:
                with self.assertRaises(ios.InventoryContractError) as error: ios.selection_inventory(json.dumps(fixture))
                self.assertEqual(error.exception.reason_code, 'TYPE_ID')
            else:
                self.assertEqual(ios.selection_inventory(json.dumps(fixture))['devicetypes'][0]['identifier'], identifier)

    def test_select_reports_closed_missing_sdk_or_compatible_type(self):
        fixture = self.selection_fixture()
        for runtimes, types, sdk, code in (([], fixture['devicetypes'], '18.5', 'NO_SDK_RUNTIME'), (fixture['runtimes'], [], '18.5', 'NO_COMPATIBLE_IPHONE'), (fixture['runtimes'], fixture['devicetypes'], 'private-secret', 'SDK_VERSION')):
            with self.assertRaises(ios.InventoryContractError) as error: ios.select(runtimes, types, sdk)
            self.assertEqual(error.exception.reason_code, code)

    def test_sdk_phase_invalid_refuses_before_process_or_simulator_commands(self):
        for phase in ('invalid', 'full'):
            with patch.dict(os.environ, {"EPT_IOS_DIAGNOSTIC_PHASE": phase}), patch.object(ios, "command") as command, patch.object(ios.subprocess, "run") as run:
                with self.assertRaises(RuntimeError): ios.inventory_probe()
                command.assert_not_called()
                run.assert_not_called()
        with patch.dict(os.environ, {"EPT_IOS_DIAGNOSTIC_PHASE": 'runtime'}): self.assertEqual(ios.diagnostic_phase(), 'runtime')

    def test_sdk_shape_reports_counts_only_and_rejects_malformed(self):
        data = {"runtimes": [{"identifier": RUNTIME, "isAvailable": True, "private": "secret"}], "devicetypes": [{"name": "private"}], "devices": {"private": []}}
        self.assertEqual(ios.inventory_shape(json.dumps(data)), {"ios_runtime_count": 1, "available_ios_count": 1, "device_type_count": 1, "device_group_count": 1})
        for bad in ('private-invalid', '[]', '{"runtimes":[]}', '{"runtimes":{},"devicetypes":[],"devices":{}}'):
            with self.assertRaises((ValueError, RuntimeError)): ios.inventory_shape(bad)

    def test_sdk_resources_do_not_emit_foreign_paths_argv_or_ids(self):
        result = ios.resource_summary('2.0 100 S /private/secret/CoreSimulatorService\n3.0 200 R /Applications/Xcode.app/simctl\n99 999 S foreign-secret-password\nNaN 10 S /private/secret/Simulator')
        self.assertEqual(result['CoreSimulatorService']['count'], 1)
        self.assertEqual(result['simctl']['states'], {'R': 1})
        self.assertEqual(result['Simulator']['count'], 0)
        self.assertNotIn('private', json.dumps(result))
        self.assertNotIn('password', json.dumps(result))

    def test_sdk_probe_queries_once_bounds_and_keeps_private_json_stderr_hidden(self):
        for code in (0, 124, 125, 1):
            queries = []
            def run(args, **kwargs):
                if args[0] == 'ps': return SimpleNamespace(returncode=0, stdout='1 200 S /private/secret/CoreSimulatorService')
                queries.append(args)
                return SimpleNamespace(returncode=code, stdout=json.dumps({**self.selection_fixture(), 'private': 'private-secret-password'}), stderr='stage=sdk-inventory-query password=private-secret-password')
            def command(label, *_args, **kwargs):
                return '/private/secret/Xcode_16.4.app/Contents/Developer' if label == 'sdk-selected-xcode' else '18.5'
            output = io.StringIO()
            envfile = Path(self.tmp.name) / 'dry-run-env'
            envfile.write_text('untouched\n', encoding='utf8')
            with patch.dict(os.environ, {"EPT_IOS_DIAGNOSTIC_PHASE": 'runtime', 'GITHUB_ENV': str(envfile)}), patch.object(ios, 'command', side_effect=command), patch.object(ios.subprocess, 'run', side_effect=run), redirect_stdout(output):
                self.assertEqual(ios.inventory_probe(), code)
            self.assertEqual(len(queries), 1)
            self.assertEqual(queries[0][-4:], ['xcrun', 'simctl', 'list', '-j'])
            self.assertEqual(queries[0][queries[0].index('--seconds') + 1], '65')
            self.assertNotIn('private', output.getvalue())
            self.assertNotIn('password', output.getvalue())
            self.assertFalse(ios.marker_path().exists())
            self.assertEqual(envfile.read_text(encoding="utf8"), "untouched\n")

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
