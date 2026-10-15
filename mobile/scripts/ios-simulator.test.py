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
        self.env = patch.dict(os.environ, {"RUNNER_TEMP": str(Path(self.tmp.name).resolve()), "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2", "EPT_IOS_DIAGNOSTIC_PHASE": "full"})
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
            self.assertEqual(error_output.getvalue().splitlines()[-1], 'SDK_CHECKCODE=' + expected)
            self.assertNotIn('private', output.getvalue() + error_output.getvalue())
            self.assertNotIn('secret', output.getvalue() + error_output.getvalue())
        private = ios.InventoryContractError({'private': 'secret'})
        private.reason_code = 'private-secret'
        with redirect_stderr(io.StringIO()) as output: ios.report_inventory_failure(private)
        self.assertEqual(output.getvalue(), 'SDK_CHECKCODE=INVENTORY_UNIDENTIFIED\n')

    def test_enumerated_iphone_identifier_is_opaque_and_selected_summary_is_private(self):
        identifier = 'com.apple.CoreSimulator.SimDeviceType.iPhone-opaque(variant);$(literal)-private-secret'
        fixture = self.selection_fixture()
        fixture['devicetypes'][0]['identifier'] = identifier
        self.assertEqual(ios.selection_inventory(json.dumps(fixture))['devicetypes'][0]['identifier'], identifier)
        self.assertEqual(ios.select(fixture['runtimes'], fixture['devicetypes'], '18.5')[1], identifier)
        def command(label, _seconds, *args, **kwargs):
            if label == 'ios-sdk-selection': return '18.5'
            if label == 'ios-inventory-json': return json.dumps(fixture)
            if label == 'ios-create':
                self.assertEqual(args[-2], identifier)
                return UDID
            self.fail('Unexpected operation')
        output = io.StringIO()
        with patch.dict(os.environ, {'EPT_IOS_DIAGNOSTIC_PHASE': 'full', 'GITHUB_ENV': str(Path(self.tmp.name) / 'env')}), patch.object(ios, 'command', side_effect=command), patch.object(ios, 'devices', return_value=self.listing), redirect_stdout(output):
            ios.create()
        self.assertNotIn(identifier, output.getvalue())
        self.assertNotIn('private-secret', output.getvalue())
        self.assertEqual(json.loads(ios.marker_path().read_text(encoding='utf8'))['type'], identifier)

    def test_opaque_type_namespace_empty_bounds_controls_and_duplicates_fail_closed(self):
        prefix = 'com.apple.CoreSimulator.SimDeviceType.'
        for identifier in ('foreign.iPhone-16', prefix, prefix + 'x' * 256, prefix + 'two words', prefix + 'tab\t', prefix + 'line\n', prefix + '\x00', prefix + '\x7f', prefix + '\u200b'):
            fixture = self.selection_fixture()
            fixture['devicetypes'][0]['identifier'] = identifier
            with self.assertRaises(ios.InventoryContractError) as error: ios.selection_inventory(json.dumps(fixture))
            self.assertEqual(error.exception.reason_code, 'TYPE_ID')
        fixture = self.selection_fixture()
        fixture['devicetypes'] *= 2
        with self.assertRaises(ios.InventoryContractError) as error: ios.selection_inventory(json.dumps(fixture))
        self.assertEqual(error.exception.reason_code, 'TYPE_DUPLICATE')

    def test_shell_like_identifier_is_one_argv_argument_without_shell_execution(self):
        identifier = 'com.apple.CoreSimulator.SimDeviceType.iPhone-$(literal);not-executed'
        with patch.object(ios.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=UDID)) as run:
            self.assertEqual(ios.command('ios-create', 30, 'xcrun', 'simctl', 'create', 'owned', identifier, RUNTIME, capture=True), UDID)
        self.assertEqual(run.call_args.args[0][-6:], ['xcrun', 'simctl', 'create', 'owned', identifier, RUNTIME])
        self.assertFalse(run.call_args.kwargs.get('shell', False))

    def test_apple_opaque_identifier_family_is_data_not_derived_from_name(self):
        fixture = self.selection_fixture()
        identifier = 'com.apple.CoreSimulator.SimDeviceType.opaque-vendor-variant'
        fixture['devicetypes'][0]['identifier'] = identifier
        inventory = ios.selection_inventory(json.dumps(fixture))
        self.assertEqual(ios.select(inventory['runtimes'], inventory['devicetypes'], '18.5')[1], identifier)
        fixture['devicetypes'][0]['identifier'] = 'com.apple.CoreSimulator.SimDeviceType.iPhone-looking-name'
        fixture['devicetypes'][0]['productFamily'] = 'iPad'
        inventory = ios.selection_inventory(json.dumps(fixture))
        with self.assertRaises(ios.InventoryContractError) as error: ios.select(inventory['runtimes'], inventory['devicetypes'], '18.5')
        self.assertEqual(error.exception.reason_code, 'NO_COMPATIBLE_IPHONE')

    def test_type_id_flags_are_exact_booleans_with_base_namespace_admission(self):
        prefix = 'com.apple.CoreSimulator.SimDeviceType.'
        cases = [prefix, 'private-secret', prefix + '16', prefix + 'opaque();$', prefix + 'x' * 256]
        cases += [prefix + left + right for left in ('a', ' ', '\x00', '\n', '\u200b', '(third)') for right in ('', 'b', '\t', '\x7f')]
        for identifier in cases:
            expected = identifier.startswith(prefix) and len(identifier) > len(prefix) and len(identifier) <= 256 and not any(c.isspace() or not c.isprintable() for c in identifier)
            flags = ios.type_id_conditions(identifier)
            self.assertEqual(set(flags), {'namespace_iPhone', 'nonempty', 'bounded', 'no_control', 'no_whitespace', 'base_apple_namespace'})
            self.assertTrue(all(type(value) is bool for value in flags.values()))
            self.assertEqual(ios.type_id_accepted(flags), expected)
            self.assertNotIn(identifier, json.dumps(flags))
        self.assertTrue(ios.type_id_conditions(prefix)['base_apple_namespace'])
        self.assertFalse(ios.type_id_conditions(prefix)['nonempty'])

    def test_type_id_failure_logs_only_boolean_vector_and_closed_code(self):
        fixture = self.selection_fixture()
        fixture['devicetypes'][0]['identifier'] = 'private-secret-password-newline\nnot-an-identifier'
        output = io.StringIO()
        with redirect_stderr(output):
            try: ios.selection_inventory(json.dumps(fixture))
            except ios.InventoryContractError as error: ios.report_inventory_failure(error)
            else: self.fail('Negative must reject')
        lines = output.getvalue().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith('SDK_TYPE_ID_FLAGS='))
        flags = json.loads(lines[0].split('=', 1)[1])
        self.assertFalse(flags['base_apple_namespace'])
        self.assertFalse(flags['namespace_iPhone'])
        self.assertFalse(flags['no_control'])
        self.assertFalse(flags['no_whitespace'])
        self.assertEqual(lines[1], 'SDK_CHECKCODE=TYPE_ID')
        for private in ('private', 'password', 'identifier'):
            self.assertNotIn(private, output.getvalue())

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
            with patch.dict(os.environ, {"EPT_IOS_DIAGNOSTIC_PHASE": 'runtime', 'GITHUB_ENV': str(envfile)}), patch.object(ios, 'command', side_effect=command), patch.object(ios, 'toolchain_preflight', side_effect=AssertionError('duplicate preflight query')), patch.object(ios.subprocess, 'run', side_effect=run), redirect_stdout(output):
                self.assertEqual(ios.inventory_probe(), code)
            self.assertEqual(len(queries), 1)
            self.assertEqual(queries[0][-4:], ['xcrun', 'simctl', 'list', '-j'])
            self.assertEqual(queries[0][queries[0].index('--seconds') + 1], '65')
            self.assertNotIn('private', output.getvalue())
            self.assertNotIn('password', output.getvalue())
            self.assertFalse(ios.marker_path().exists())
            self.assertEqual(envfile.read_text(encoding="utf8"), "untouched\n")

    def test_toolchain_phase_caps_single_queries_and_fail_before_any_command(self):
        responses = [str(Path(ios.PINNED_DEVELOPER_DIR) / 'usr/bin/swift'), 'Xcode 26.1.1\nBuild version 17B100', 'Apple Swift version 6.2.1']
        for phase, seconds in [('full', 20), ('runtime', 20)]:
            with patch.dict(os.environ, {'EPT_IOS_DIAGNOSTIC_PHASE': phase, 'DEVELOPER_DIR': ios.PINNED_DEVELOPER_DIR}), patch.object(Path, 'is_dir', return_value=True), patch.object(ios, 'command', side_effect=responses) as command, redirect_stdout(io.StringIO()):
                ios.toolchain_preflight()
                self.assertEqual(command.call_count, 3)
                self.assertEqual([c.args[0] for c in command.call_args_list], ['ios-toolchain-path', 'ios-toolchain-xcode', 'ios-toolchain-swift'])
                self.assertTrue(all(c.args[1] == seconds and c.kwargs['capture'] for c in command.call_args_list))
        with patch.dict(os.environ, {'EPT_IOS_DIAGNOSTIC_PHASE': 'private-invalid'}), patch.object(ios, 'command') as command:
            with self.assertRaises(RuntimeError): ios.toolchain_preflight()
            command.assert_not_called()
        with patch.dict(os.environ, {'EPT_IOS_DIAGNOSTIC_PHASE': 'runtime', 'DEVELOPER_DIR': ios.PINNED_DEVELOPER_DIR}), patch.object(Path, 'is_dir', return_value=True), patch.object(ios, 'command', side_effect=RuntimeError('private-provider')) as command:
            with self.assertRaises(RuntimeError): ios.toolchain_preflight()
            self.assertEqual(command.call_count, 1)

    def test_pinned_xcode_and_swift_contract_versions_fail_closed(self):
        xcode = 'Xcode 26.1.1\nBuild version 17B100\n'
        result = ios.checked_toolchain_versions(xcode, 'Apple Swift version 6.2.1 (swiftlang-public)\nTarget: arm64-apple-macosx\n')
        self.assertEqual(result['xcode_version'], '26.1.1')
        self.assertEqual(result['swift_version'], '6.2.1')
        for bad in ('Xcode 16.4\nBuild version 16F6', xcode + 'private-secret', 'private-provider-object'):
            with self.assertRaises(ios.InventoryContractError) as error: ios.checked_toolchain_versions(bad, 'Apple Swift version 6.2.1')
            self.assertEqual(error.exception.reason_code, 'TOOLCHAIN_XCODE')
        for bad in ('Apple Swift version 6.1.0', 'private-secret', 'Apple Swift version unknown'):
            with self.assertRaises(ios.InventoryContractError) as error: ios.checked_toolchain_versions(xcode, bad)
            self.assertEqual(error.exception.reason_code, 'TOOLCHAIN_SWIFT')

    def test_toolchain_unavailable_or_foreign_config_stops_before_provider_commands(self):
        with patch.dict(os.environ, {'DEVELOPER_DIR': 'private-foreign'}), patch.object(ios, 'command') as command:
            with self.assertRaises(ios.InventoryContractError) as error: ios.toolchain_preflight()
            self.assertEqual(error.exception.reason_code, 'TOOLCHAIN_CONFIG')
            command.assert_not_called()
        with patch.dict(os.environ, {'DEVELOPER_DIR': ios.PINNED_DEVELOPER_DIR}), patch.object(Path, 'is_dir', return_value=False), patch.object(ios, 'command') as command:
            with self.assertRaises(ios.InventoryContractError) as error: ios.toolchain_preflight()
            self.assertEqual(error.exception.reason_code, 'TOOLCHAIN_UNAVAILABLE')
            command.assert_not_called()

    def test_toolchain_xcrun_provenance_and_public_summary_without_paths(self):
        swift_path = str(Path(ios.PINNED_DEVELOPER_DIR) / 'Toolchains/XcodeDefault.xctoolchain/usr/bin/swift')
        calls = []
        def command(label, seconds, *args, **kwargs):
            calls.append((label, seconds, args, kwargs))
            return {'ios-toolchain-path': swift_path, 'ios-toolchain-xcode': 'Xcode 26.1.1\nBuild version 17B100', 'ios-toolchain-swift': 'Apple Swift version 6.2.1 (private-provider-text)'}[label]
        output = io.StringIO()
        with patch.dict(os.environ, {'EPT_IOS_DIAGNOSTIC_PHASE': 'full', 'DEVELOPER_DIR': ios.PINNED_DEVELOPER_DIR}), patch.object(Path, 'is_dir', return_value=True), patch.object(ios, 'command', side_effect=command), redirect_stdout(output):
            self.assertTrue(ios.toolchain_preflight()['selected'])
        self.assertEqual(calls[0][2], ('xcrun', '--find', 'swift'))
        self.assertTrue(all(c[1] == 20 and c[3]['capture'] is True for c in calls))
        for private in ('/Applications', 'private', 'Toolchains'):
            self.assertNotIn(private, output.getvalue())
        with patch.dict(os.environ, {'EPT_IOS_DIAGNOSTIC_PHASE': 'full', 'DEVELOPER_DIR': ios.PINNED_DEVELOPER_DIR}), patch.object(Path, 'is_dir', return_value=True), patch.object(ios, 'command', return_value='/private/foreign/swift') as command:
            with self.assertRaises(ios.InventoryContractError) as error: ios.toolchain_preflight()
            self.assertEqual(error.exception.reason_code, 'TOOLCHAIN_PATH')
            self.assertEqual(command.call_count, 1)

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
