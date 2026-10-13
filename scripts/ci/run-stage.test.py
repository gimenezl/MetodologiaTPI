import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
sys.dont_write_bytecode = True

SCRIPT = Path(__file__).with_name("run-stage.py")
spec = importlib.util.spec_from_file_location("stage", SCRIPT)
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


class StageTests(unittest.TestCase):
    def test_redaction(self):
        os.environ["TEST_PASSWORD"] = "private-example"
        self.assertNotIn("private-example", stage.redact("private-example"))
        self.assertNotIn("eyJ", stage.redact("eyJabcd.abcd.abcd"))
        self.assertNotIn("private", stage.redact("Bearer private"))
        self.assertNotIn("runner", stage.redact("/Users/runner/private.log"))
        self.assertEqual(stage.redact("service_role_key=private"), "[REDACTED_SENSITIVE_LINE]")
        os.environ["EPT_MOBILE_AUTH_INTEGRATION"] = "1"
        self.assertEqual(stage.redact("architecture=x86_64 elapsed_s=120"), "architecture=x86_64 elapsed_s=120")

    def test_artifact_structure(self):
        import xml.etree.ElementTree as ET
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "maestro.xml"
            artifact.write_text('<testsuite><system-out>private-example</system-out></testsuite>')
            result = subprocess.run([sys.executable, str(SCRIPT), "--sanitize-directory", directory], capture_output=True, timeout=5, env={**os.environ, "TEST_PASSWORD": "private-example"})
            self.assertEqual(result.returncode, 0)
            self.assertNotIn("private-example", artifact.read_text())
            ET.parse(artifact)

    def test_supabase_token_families_without_environment(self):
        import json
        tokens = ["sb_secret_synthetic-fixture-123-", "sb_publishable_synthetic-fixture-456_"]
        for token in tokens:
            for preserve in (False, True):
                for text in [f"│ Secret │ {token} │", f"Publishable: {token}", json.dumps({"unknown": token})]:
                    self.assertNotIn(token, stage.redact(text, preserve_structure=preserve))
            value = json.loads(stage.redact(json.dumps({"unknown": token}), preserve_structure=True))
            self.assertEqual(value, {"unknown": "[REDACTED_SUPABASE_KEY]"})
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "unknown-provider.json"
            artifact.write_text(json.dumps({"values": tokens}))
            result = subprocess.run([sys.executable, str(SCRIPT), "--sanitize-directory", directory], capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(json.loads(artifact.read_text()), {"values": ["[REDACTED_SUPABASE_KEY]"] * 2})

    def test_excess_depth_refuses_before_spawn(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "must-not-exist"
            command = f"from pathlib import Path;Path({str(marker)!r}).write_text('launched')"
            result = subprocess.run([sys.executable, str(SCRIPT), "--stage", "too-deep", "--seconds", "2", "--", sys.executable, "-c", command], capture_output=True, text=True, timeout=5, env={**os.environ, "EPT_STAGE_DEPTH": "2"})
            self.assertEqual(result.returncode, 2)
            self.assertIn("refusing before spawn", result.stderr)
            self.assertFalse(marker.exists())

    @unittest.skipUnless(os.name == "posix", "Native process-group proof requires Linux/macOS")
    def test_grandchildren_timeout_and_early_parent_exit(self):
        for exits_early in (False, True):
            with self.subTest(exits_early=exits_early), tempfile.TemporaryDirectory() as directory:
                pidfile = Path(directory) / "pids"
                # Grandchild ignores TERM. Its parent may exit without waiting for it.
                grandchild = "import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)"
                child_code = f"import subprocess,sys,time,signal,os;signal.signal(signal.SIGTERM,signal.SIG_IGN);p=subprocess.Popen([sys.executable,'-c',{grandchild!r}]);open({str(pidfile)!r},'w').write(str(os.getpid())+' '+str(p.pid));" + ("sys.exit(0)" if exits_early else "time.sleep(60)")
                unrelated = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(60)"], start_new_session=True)
                try:
                    start = time.monotonic()
                    result = subprocess.run([sys.executable, str(SCRIPT), "--stage", "blocked-parent", "--seconds", "1", "--", sys.executable, "-c", child_code], capture_output=True, text=True, timeout=12, env={**os.environ, "EPT_STAGE_LOG_DIR": directory})
                    self.assertEqual(result.returncode, 124, result.stderr)
                    self.assertLess(time.monotonic() - start, 10)
                    for pid in pidfile.read_text().split():
                        probe = subprocess.run(["ps", "-o", "stat=", "-p", pid], capture_output=True, text=True, timeout=2)
                        self.assertTrue(not probe.stdout.strip() or probe.stdout.strip().startswith("Z"), probe.stdout)
                    self.assertIsNone(unrelated.poll(), "Unrelated process must survive")
                    self.assertIn("terminating owned group", result.stderr)
                finally:
                    unrelated.kill()
                    unrelated.wait(timeout=2)

    @unittest.skipUnless(os.name == "posix", "Native process-group proof requires Linux/macOS")
    def test_nested_supervisor_deadline_kills_inner_group(self):
        with tempfile.TemporaryDirectory() as directory:
            pidfile = Path(directory) / "nested-pid"
            code = f"import os,signal,time;open({str(pidfile)!r},'w').write(str(os.getpid()));signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)"
            result = subprocess.run([sys.executable, str(SCRIPT), "--stage", "outer", "--seconds", "1", "--", sys.executable, str(SCRIPT), "--stage", "inner", "--seconds", "30", "--", sys.executable, "-c", code], capture_output=True, text=True, timeout=12, env={**os.environ, "EPT_STAGE_LOG_DIR": directory})
            self.assertEqual(result.returncode, 124, result.stderr)
            pid = pidfile.read_text()
            probe = subprocess.run(["ps", "-o", "stat=", "-p", pid], capture_output=True, text=True, timeout=2)
            self.assertTrue(not probe.stdout.strip() or probe.stdout.strip().startswith("Z"), probe.stdout)

    @unittest.skipUnless(os.name == "posix", "Native process-group proof requires Linux/macOS")
    def test_three_nested_supervisors_refuse_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "must-not-exist"
            command = [sys.executable, "-c", f"from pathlib import Path;Path({str(marker)!r}).write_text('launched')"]
            for name in ("third", "second", "first"):
                command = [sys.executable, str(SCRIPT), "--stage", name, "--seconds", "3", "--", *command]
            result = subprocess.run(command, capture_output=True, text=True, timeout=10, env={**os.environ, "EPT_STAGE_LOG_DIR": directory, "EPT_STAGE_DEPTH": "0"})
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("refusing before spawn", result.stderr)
            self.assertFalse(marker.exists())

    @unittest.skipUnless(os.name == "posix", "Native process-group proof requires Linux/macOS")
    def test_live_output_hides_unknown_supabase_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            tokens = ["sb_secret_synthetic-only-123", "sb_publishable_synthetic-only-456"]
            code = f"print('Secret | {tokens[0]}');print('Publishable | {tokens[1]}')"
            result = subprocess.run([sys.executable, str(SCRIPT), "--stage", "provider-output", "--seconds", "3", "--", sys.executable, "-c", code], capture_output=True, text=True, timeout=8, env={**os.environ, "EPT_STAGE_LOG_DIR": directory})
            self.assertEqual(result.returncode, 0)
            for token in tokens:
                self.assertNotIn(token, result.stderr)
                self.assertNotIn(token, (Path(directory) / "provider-output-redacted.log").read_text())
            self.assertIn("[REDACTED_SUPABASE_KEY]", result.stderr)

    @unittest.skipUnless(os.name == "posix", "Native process-group proof requires Linux/macOS")
    def test_failure_and_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {**os.environ, "EPT_STAGE_LOG_DIR": directory}
            base = [sys.executable, str(SCRIPT), "--stage", "capture", "--seconds", "3", "--capture", "--", sys.executable, "-c"]
            failed = subprocess.run(base + ["raise SystemExit(7)"], capture_output=True, env=env, timeout=8)
            self.assertEqual(failed.returncode, 7)
            result = subprocess.run(base + ["print('SERVICE_ROLE_KEY=private')"], capture_output=True, env=env, timeout=8)
            self.assertEqual(result.stdout, b"SERVICE_ROLE_KEY=private\n")
            self.assertNotIn(b"private", result.stderr)
            self.assertNotIn("private", (Path(directory) / "capture-redacted.log").read_text())


if __name__ == "__main__":
    unittest.main()
