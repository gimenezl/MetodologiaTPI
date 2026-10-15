#!/usr/bin/env python3
"""Create and retire only this Actions attempt's disposable iOS simulator."""
import argparse
from contextlib import contextmanager
import http.client
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import platform
import threading
import time
import math

ROOT = Path(__file__).resolve().parents[2]
APP = "org.educarparatransformar.app"
DRIVER = "dev.mobile.maestro-driver-iosUITests.xctrunner"
PINNED_DEVELOPER_DIR = "/Applications/Xcode_26.5.app/Contents/Developer"


INVENTORY_CODES = frozenset({"INVENTORY_JSON", "INVENTORY_SHAPE", "RUNTIME_FIELDS", "RUNTIME_DUPLICATE", "RUNTIME_ID", "RUNTIME_AVAILABILITY", "RUNTIME_VERSION", "RUNTIME_VERSION_ID", "TYPE_FIELDS", "TYPE_DUPLICATE", "TYPE_ID", "TYPE_RANGE_VERSION", "TYPE_RANGE_ORDER", "DEVICE_GROUPS", "SDK_VERSION", "NO_SDK_RUNTIME", "NO_COMPATIBLE_IPHONE", "INVENTORY_UNIDENTIFIED", "TOOLCHAIN_CONFIG", "TOOLCHAIN_UNAVAILABLE", "TOOLCHAIN_PATH", "TOOLCHAIN_XCODE", "TOOLCHAIN_SWIFT"})


class InventoryContractError(RuntimeError):
    def __init__(self, code):
        self.reason_code = code if isinstance(code, str) and code in INVENTORY_CODES else "INVENTORY_UNIDENTIFIED"
        super().__init__(self.reason_code)


def report_inventory_failure(error):
    code = error.reason_code if isinstance(error.reason_code, str) and error.reason_code in INVENTORY_CODES else "INVENTORY_UNIDENTIFIED"
    print("SDK_CHECKCODE=" + code, file=sys.stderr, flush=True)


def identity():
    run, attempt = os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_RUN_ATTEMPT"]
    if not run.isdigit() or not attempt.isdigit():
        raise RuntimeError("Invalid Actions identity")
    return {"run": run, "attempt": attempt, "uid": os.getuid(), "name": f"ept105-{run}-{attempt}"}


def marker_path():
    return Path(os.environ["RUNNER_TEMP"]).resolve() / "ept105-ios-simulator.json"


def save(record):
    path = marker_path()
    with path.open("x", encoding="utf8") as handle:
        os.chmod(path, 0o600)
        json.dump(record, handle)


def load():
    path = marker_path()
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o600:
        raise RuntimeError("Simulator owner marker rejected")
    record = json.loads(path.read_text(encoding="utf8"))
    if any(record.get(k) != v for k, v in identity().items()):
        raise RuntimeError("Foreign simulator attempt rejected")
    expected = os.environ.get("EPT_IOS_UDID")
    if expected and record.get("udid") != expected:
        raise RuntimeError("Simulator environment identity rejected")
    return record


def command(label, seconds, *args, capture=False, allow_failure=False):
    if os.environ.get("EPT_IOS_CLEANUP") == "1" and not label.startswith("cleanup-"):
        label = "cleanup-" + label
    cmd = [sys.executable, str(ROOT / "scripts/ci/run-stage.py"), "--stage", label, "--seconds", str(seconds)]
    if capture:
        cmd += ["--capture"]
    result = subprocess.run(cmd + ["--", *args], stdout=subprocess.PIPE if capture else None, text=True, timeout=seconds + 12)
    if result.returncode and not allow_failure:
        raise RuntimeError(f"Simulator operation failed; stage={label}; exit={result.returncode}")
    return result.stdout if capture else result.returncode


def devices():
    return json.loads(command("ios-owner-list", 10, "xcrun", "simctl", "list", "devices", "-j", capture=True))["devices"]


def owned_device(record, listing):
    matches = [(runtime, device) for runtime, group in listing.items() for device in group if device.get("name") == record["name"]]
    if len(matches) != 1:
        raise RuntimeError("Owned simulator missing or ambiguous")
    runtime, device = matches[0]
    if runtime != record["runtime"] or (record.get("udid") and device.get("udid") != record["udid"]):
        raise RuntimeError("Foreign simulator identity rejected")
    if not re.fullmatch(r"[0-9A-Fa-f-]{36}", device.get("udid", "")):
        raise RuntimeError("Invalid simulator identifier")
    return device


def version(text):
    if not isinstance(text, str) or not re.fullmatch(r"\d+(?:\.\d+){0,2}", text):
        raise RuntimeError("Invalid installed runtime version")
    return tuple(int(v) for v in text.split(".")) + (0,) * (3 - len(text.split(".")))


def select(runtime_data, type_data, sdk_version=None):
    try:
        sdk = version(sdk_version) if sdk_version is not None else None
    except RuntimeError:
        raise InventoryContractError("SDK_VERSION") from None
    runtimes = sorted((r for r in runtime_data if r.get("isAvailable") and r["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")), key=lambda r: version(r["version"]), reverse=True)
    matching = [r for r in runtimes if sdk is None or version(r["version"]) == sdk]
    if not matching:
        raise InventoryContractError("NO_SDK_RUNTIME")
    for runtime in matching:
        compatible = [d for d in type_data if d.get("productFamily") == "iPhone" and version(d["minRuntimeVersionString"]) <= version(runtime["version"]) <= version(d["maxRuntimeVersionString"])]
        if compatible:
            return runtime["identifier"], sorted(compatible, key=lambda d: d["identifier"])[-1]["identifier"]
    raise InventoryContractError("NO_COMPATIBLE_IPHONE")


def type_id_conditions(identifier):
    # Closed booleans only: never return the value, length or character samples.
    prefix = "com.apple.CoreSimulator.SimDeviceType.iPhone-"
    base = "com.apple.CoreSimulator.SimDeviceType."
    string = isinstance(identifier, str)
    return {
        "namespace_iPhone": string and identifier.startswith(prefix),
        "nonempty": string and len(identifier) > len(base),
        "bounded": string and len(identifier) <= 256,
        "no_control": string and all(character.isprintable() for character in identifier),
        "no_whitespace": string and not any(character.isspace() for character in identifier),
        "base_apple_namespace": string and identifier.startswith(base),
    }


def type_id_accepted(conditions):
    return all(conditions[key] for key in ("base_apple_namespace", "nonempty", "bounded", "no_control", "no_whitespace"))


def selection_inventory(text):
    try:
        shape = inventory_shape(text)
        data = json.loads(text)
    except ValueError:
        raise InventoryContractError("INVENTORY_JSON") from None
    except RuntimeError:
        raise InventoryContractError("INVENTORY_SHAPE") from None
    print("SDK_SHAPE_COUNTS=" + json.dumps(shape, sort_keys=True), flush=True)
    runtime_ids = set()
    type_ids = set()
    for runtime in data["runtimes"]:
        if not isinstance(runtime, dict) or not isinstance(runtime.get("identifier"), str):
            raise InventoryContractError("RUNTIME_FIELDS")
        if runtime["identifier"] in runtime_ids:
            raise InventoryContractError("RUNTIME_DUPLICATE")
        runtime_ids.add(runtime["identifier"])
        if runtime["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-"):
            if not re.fullmatch(r"com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]+", runtime["identifier"]):
                raise InventoryContractError("RUNTIME_ID")
            if type(runtime.get("isAvailable")) is not bool:
                raise InventoryContractError("RUNTIME_AVAILABILITY")
            try:
                version(runtime.get("version", ""))
            except RuntimeError:
                raise InventoryContractError("RUNTIME_VERSION") from None
    for device_type in data["devicetypes"]:
        if not isinstance(device_type, dict) or not isinstance(device_type.get("productFamily"), str) or not isinstance(device_type.get("identifier"), str):
            raise InventoryContractError("TYPE_FIELDS")
        if device_type["identifier"] in type_ids:
            raise InventoryContractError("TYPE_DUPLICATE")
        type_ids.add(device_type["identifier"])
        if device_type["productFamily"] == "iPhone":
            identifier = device_type["identifier"]
            conditions = type_id_conditions(identifier)
            if not type_id_accepted(conditions):
                print("SDK_TYPE_ID_FLAGS=" + json.dumps(conditions, sort_keys=True), file=sys.stderr, flush=True)
                raise InventoryContractError("TYPE_ID")
            try:
                minimum = version(device_type.get("minRuntimeVersionString", ""))
                maximum = version(device_type.get("maxRuntimeVersionString", ""))
            except RuntimeError:
                raise InventoryContractError("TYPE_RANGE_VERSION") from None
            if minimum > maximum:
                raise InventoryContractError("TYPE_RANGE_ORDER")
    for runtime, group in data["devices"].items():
        if not isinstance(runtime, str) or not isinstance(group, list) or any(not isinstance(device, dict) or not isinstance(device.get("name"), str) for device in group):
            raise InventoryContractError("DEVICE_GROUPS")
    return data


def create():
    if diagnostic_phase() != "full":
        raise RuntimeError("Simulator creation requires full phase")
    if marker_path().exists() or marker_path().is_symlink():
        raise RuntimeError("Simulator marker already exists")
    sdk = command("ios-sdk-selection", 20, "xcrun", "--sdk", "iphonesimulator", "--show-sdk-version", capture=True).strip()
    try:
        version(sdk)
    except RuntimeError:
        raise InventoryContractError("SDK_VERSION") from None
    print("ios sdk_version=" + sdk, flush=True)
    # One aggregate query; calibrated after a65.1s timeout, not a cause diagnosis.
    with inventory_monitor():
        inventory = selection_inventory(command("ios-inventory-json", 120, "xcrun", "simctl", "list", "-j", capture=True))
    runtime, device_type = select(inventory["runtimes"], inventory["devicetypes"], sdk)
    selected_version = next(r["version"] for r in inventory["runtimes"] if r["identifier"] == runtime)
    print(f"owned simulator selection sdk={sdk} runtime_version={selected_version} family=iPhone identity=enumerated", flush=True)
    record = {**identity(), "runtime": runtime, "type": device_type, "sdk": sdk}
    if any(d.get("name") == record["name"] for group in inventory["devices"].values() for d in group):
        raise RuntimeError("Attempt simulator name already occupied")
    # Persist the intent before create, so a timed-out create remains attributable.
    save(record)
    udid = command("ios-create", 30, "xcrun", "simctl", "create", record["name"], device_type, runtime, capture=True).strip()
    device = owned_device({**record, "udid": udid}, devices())
    record["udid"] = device["udid"]
    marker_path().write_text(json.dumps(record), encoding="utf8")
    with Path(os.environ["GITHUB_ENV"]).open("a", encoding="utf8") as env:
        env.write(f"EPT_IOS_UDID={record['udid']}\nEPT_IOS_ARCH=arm64\n")
    print("owned simulator created; architecture=arm64", flush=True)


def require_booted(expected_record=None):
    record = load()
    if expected_record is not None and record != expected_record:
        raise RuntimeError("Owned simulator marker changed during boot")
    device = owned_device(record, devices())
    if device.get("state") != "Booted":
        raise RuntimeError("Owned simulator is not Booted")
    print("owned simulator same_identity=True state=Booted", flush=True)


def boot():
    if diagnostic_phase() != "full":
        raise RuntimeError("Simulator boot requires full phase")
    record = load()
    device = owned_device(record, devices())
    if device.get("state") == "Shutdown":
        command("ios-boot", 30, "xcrun", "simctl", "boot", device["udid"], capture=True)
    elif device.get("state") != "Booted":
        raise RuntimeError("Owned simulator boot state rejected")
    command("ios-bootstatus", 120, "xcrun", "simctl", "bootstatus", device["udid"], "-b", capture=False)
    require_booted(record)
    print("owned simulator boot_readiness=True", flush=True)


def driver_preflight():
    load()
    result = subprocess.run(["lsof", "-nP", "-a", "-iTCP:22087", "-sTCP:LISTEN", "-t", "+w"], capture_output=True, text=True, timeout=5)
    if result.returncode != 1 or result.stdout.strip() or result.stderr.strip():
        raise RuntimeError("Maestro driver port not exclusively available")
    print("maestro driver port=22087 available before launch", flush=True)


def app_processes(text):
    # Same launchctl label normalization as pinned XCRunnerCLIUtils; no argv/PIDs emitted.
    result = {APP: False, DRIVER: False}
    for line in text.splitlines():
        fields = line.split()
        if len(fields) == 3:
            label = fields[2].split("[", 1)[0].removeprefix("UIKitApplication:")
            if label in result and fields[0].isdigit():
                result[label] = True
    return result


def status():
    record = load()
    device = owned_device(record, devices())
    print(f"owned simulator state={device.get('state') if device.get('state') in ('Booted', 'Shutdown') else 'OTHER'}", flush=True)
    if device.get("state") == "Booted":
        processes = app_processes(command("ios-own-app-processes", 5, "xcrun", "simctl", "spawn", device["udid"], "launchctl", "list", capture=True))
        print(f"owned simulator app_running={processes[APP]} driver_running={processes[DRIVER]}", flush=True)
    # Pinned Maestro2.11 source: localhost22087/status, HTTP success, never body.
    connection = http.client.HTTPConnection("127.0.0.1", 22087, timeout=1)
    try:
        connection.request("GET", "/status")
        response = connection.getresponse()
        print(f"maestro driver probe port=22087 status={response.status}", flush=True)
    except (OSError, http.client.HTTPException):
        print("maestro driver probe port=22087 status=unavailable", flush=True)
    finally:
        connection.close()
    command("ios-driver-listener", 5, "lsof", "-nP", "-a", "-iTCP:22087", "-sTCP:LISTEN", "-Fpgufn", allow_failure=True)


def cleanup():
    os.environ["EPT_IOS_CLEANUP"] = "1"
    if not marker_path().exists() and not marker_path().is_symlink():
        print("simulator cleanup: no owner marker", flush=True)
        return
    record = load()
    device = owned_device(record, devices())
    udid = device["udid"]
    if device.get("state") == "Booted":
        for bundle in (APP, DRIVER):
            command("cleanup-ios-app", 5, "xcrun", "simctl", "terminate", udid, bundle, allow_failure=True)
        command("cleanup-ios-shutdown", 20, "xcrun", "simctl", "shutdown", udid)
    after = owned_device(record, devices())
    if after.get("state") != "Shutdown":
        raise RuntimeError("Owned simulator shutdown not verified")
    command("cleanup-ios-delete", 10, "xcrun", "simctl", "delete", udid)
    if any(d.get("udid") == udid for group in devices().values() for d in group):
        raise RuntimeError("Owned simulator deletion not verified")
    marker_path().unlink()
    print("owned simulator cleanup: shutdown/deletion verified", flush=True)


def diagnostic_phase():
    phase = os.environ.get("EPT_IOS_DIAGNOSTIC_PHASE", "full")
    if phase not in ("runtime", "full"):
        raise RuntimeError("Invalid iOS diagnostic phase")
    return phase


def inventory_shape(text):
    data = json.loads(text)
    if not isinstance(data, dict) or not isinstance(data.get("runtimes"), list) or not isinstance(data.get("devicetypes"), list) or not isinstance(data.get("devices"), dict):
        raise RuntimeError("Unexpected SDK inventory shape")
    ios = [r for r in data["runtimes"] if isinstance(r, dict) and isinstance(r.get("identifier"), str) and r["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]
    return {"ios_runtime_count": len(ios), "available_ios_count": sum(r.get("isAvailable") is True for r in ios),
            "device_type_count": len(data["devicetypes"]), "device_group_count": len(data["devices"])}


def resource_summary(text):
    classes = {name: {"count": 0, "cpu": 0.0, "rss_kb": 0, "states": {}} for name in ("CoreSimulatorService", "simctl", "Simulator", "simdiskimaged")}
    for line in text.splitlines():
        fields = line.split(maxsplit=3)
        if len(fields) != 4:
            continue
        name = fields[3].rsplit("/", 1)[-1]
        if name not in classes:
            continue
        try:
            cpu, rss = float(fields[0]), int(fields[1])
            if not math.isfinite(cpu) or cpu < 0 or cpu > 10000 or rss < 0 or rss > 10**10:
                continue
        except ValueError:
            continue
        classes[name]["count"] += 1
        classes[name]["cpu"] += cpu
        classes[name]["rss_kb"] += rss
        state = fields[2][0] if fields[2] and fields[2][0] in "RSDTZUI" else "OTHER"
        classes[name]["states"][state] = classes[name]["states"].get(state, 0) + 1
    return classes


def checked_toolchain_versions(xcode_text, swift_text):
    xcode = re.fullmatch(r"Xcode ([0-9.]+)\s+Build version ([A-Za-z0-9]+)\s*", xcode_text.strip())
    if not xcode or xcode.groups() != ("26.5", "17F42"):
        raise InventoryContractError("TOOLCHAIN_XCODE")
    swift = re.search(r"^Apple Swift version ([0-9]+(?:\.[0-9]+){1,2})(?:\s|$)", swift_text)
    if not swift or version(swift.group(1)) < (6, 3, 0):
        raise InventoryContractError("TOOLCHAIN_SWIFT")
    return {"xcode_version": xcode.group(1), "xcode_build": xcode.group(2), "swift_version": swift.group(1), "swift_minimum": "6.3", "selected": True}


def toolchain_preflight():
    diagnostic_phase()  # Reject unknown phases before any provider command.
    seconds = 20
    if os.environ.get("DEVELOPER_DIR") != PINNED_DEVELOPER_DIR:
        raise InventoryContractError("TOOLCHAIN_CONFIG")
    developer = Path(PINNED_DEVELOPER_DIR).resolve()
    if not developer.is_dir():
        raise InventoryContractError("TOOLCHAIN_UNAVAILABLE")
    # xcrun honors the job-local override; global xcode-select would be misleading here.
    swift_path = command("ios-toolchain-path", seconds, "xcrun", "--find", "swift", capture=True).strip()
    if not Path(swift_path).resolve().is_relative_to(developer):
        raise InventoryContractError("TOOLCHAIN_PATH")
    xcode = command("ios-toolchain-xcode", seconds, "xcodebuild", "-version", capture=True)
    swift = command("ios-toolchain-swift", seconds, "xcrun", "swift", "--version", capture=True)
    result = checked_toolchain_versions(xcode, swift)
    print("ios toolchain=" + json.dumps(result, sort_keys=True), flush=True)
    return result


@contextmanager
def inventory_monitor():
    stopped = threading.Event()
    def sample(phase):
        try:
            result = subprocess.run(["ps", "-axo", "pcpu=,rss=,stat=,comm="], capture_output=True, text=True, timeout=2)
            if result.returncode:
                raise RuntimeError("Resource sample unavailable")
            print("sdk process_sample=" + phase + " " + json.dumps(resource_summary(result.stdout), sort_keys=True), flush=True)
        except (OSError, RuntimeError, subprocess.TimeoutExpired):
            print("sdk process_sample=" + phase + " unavailable", flush=True)
    def heartbeat():
        while not stopped.wait(10):
            sample("during")
    sample("before")
    monitor = threading.Thread(target=heartbeat, daemon=True)
    monitor.start()
    try:
        yield
    finally:
        stopped.set()
        monitor.join(timeout=2)
        sample("after")


def inventory_probe():
    if diagnostic_phase() != "runtime":
        raise RuntimeError("SDK inventory requires explicit runtime phase")
    print("sdk inventory architecture=" + ("arm64" if platform.machine() == "arm64" else "OTHER"), flush=True)
    sdk = command("sdk-version", 20, "xcrun", "--sdk", "iphonesimulator", "--show-sdk-version", capture=True).strip()
    print("sdk simulator_version=" + (sdk if re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,2}", sdk) else "OTHER"), flush=True)
    started = time.monotonic()
    with inventory_monitor():
        # One read-only query. Pinned Maestro LocalSimulatorUtils uses this exact list -j command.
        result = subprocess.run([sys.executable, str(ROOT / "scripts/ci/run-stage.py"), "--capture", "--stage", "sdk-inventory-query", "--seconds", "120", "--", "xcrun", "simctl", "list", "-j"], capture_output=True, text=True, timeout=132)
        # Inner supervisor retains redacted stderr in its own artifact; never reprint provider data.
        print(f"sdk query elapsed_s={time.monotonic()-started:.1f} exit={result.returncode}", flush=True)
        if result.returncode:
            print("sdk query failure_class=" + ("deadline" if result.returncode == 124 else "cleanup" if result.returncode == 125 else "provider_exit"), flush=True)
            return result.returncode
        inventory = selection_inventory(result.stdout)
        runtime, _device_type = select(inventory["runtimes"], inventory["devicetypes"], sdk)
        runtime_version = next(r["version"] for r in inventory["runtimes"] if r["identifier"] == runtime)
        print("sdk dry_run_selection=" + json.dumps({"sdk_version": sdk, "runtime_version": runtime_version, "family": "iPhone", "passed": True}, sort_keys=True), flush=True)
        return 0



if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("create", "status", "driver-preflight", "cleanup", "inventory", "toolchain", "boot", "require-booted"))
    action = parser.parse_args().action
    try:
        result = {"create": create, "status": status, "driver-preflight": driver_preflight, "cleanup": cleanup, "inventory": inventory_probe, "toolchain": toolchain_preflight, "boot": boot, "require-booted": require_booted}[action]()
        sys.exit(result if isinstance(result, int) else 0)
    except InventoryContractError as error:
        report_inventory_failure(error)
        sys.exit(1)
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired):
        print(f"owned simulator action={action} failed; private details withheld", file=sys.stderr)
        sys.exit(1)
