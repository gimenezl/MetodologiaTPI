#!/usr/bin/env python3
"""Retire only newly created ibtoold processes carrying this Actions job token."""
import argparse
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import stat
import struct
import subprocess
import sys
import time

DEVELOPER = Path("/Applications/Xcode_26.1.1.app/Contents/Developer")
KEY = b"RUNNER_TRACKING_ID"


class OwnershipUnknown(RuntimeError):
    def __init__(self):
        super().__init__("cleanup_ownership_unknown")


def tracking_from_args(raw):
    # Darwin KERN_PROCARGS2: argc, executable, alignment NULs, argc argv, env.
    if len(raw) < 5 or not raw.endswith(b"\0"):
        raise OwnershipUnknown()
    argc = struct.unpack_from("=i", raw)[0]
    if not 1 <= argc <= 65536:
        raise OwnershipUnknown()
    end = raw.find(b"\0", 4)
    if end <= 4:
        raise OwnershipUnknown()
    pos = end + 1
    while pos < len(raw) and raw[pos] == 0:
        pos += 1
    for _ in range(argc):
        end = raw.find(b"\0", pos)
        if end < pos:
            raise OwnershipUnknown()
        pos = end + 1
    matches = []
    for item in raw[pos:].split(b"\0"):
        if not item:
            continue
        key, separator, value = item.partition(b"=")
        if not separator or not key:
            raise OwnershipUnknown()
        if key == KEY:
            matches.append(value)
    if len(matches) != 1 or not matches[0]:
        raise OwnershipUnknown()
    return matches[0]


class BsdInfo(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint32) for name in (
        "flags", "status", "xstatus", "pid", "ppid", "uid", "gid", "ruid", "rgid", "svuid", "svgid", "reserved")]
    _fields_ += [("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32)]
    _fields_ += [(name, ctypes.c_uint32) for name in ("nfiles", "pgid", "pjobc", "tdev", "tpgid")]
    _fields_ += [("nice", ctypes.c_int32), ("birth_sec", ctypes.c_uint64), ("birth_usec", ctypes.c_uint64)]


class Darwin:
    def __init__(self):
        if platform.system() != "Darwin":
            raise OwnershipUnknown()
        self.proc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        self.libc = ctypes.CDLL(None, use_errno=True)
        self.proc.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
        self.proc.proc_pidinfo.restype = ctypes.c_int
        self.proc.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
        self.proc.proc_pidpath.restype = ctypes.c_int
        self.libc.sysctl.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_uint, ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p, ctypes.c_size_t]
        self.libc.sysctl.restype = ctypes.c_int

    def _fresh_bsd(self, pid):
        info = BsdInfo()
        ctypes.set_errno(0)
        result = self.proc.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
        error = ctypes.get_errno()
        if result != ctypes.sizeof(info):
            if result == 0 and error == errno.ESRCH:
                return None
            raise OwnershipUnknown()
        if info.pid != pid or not info.birth_sec:
            raise OwnershipUnknown()
        return None if info.status == 5 else info  # SZOMB: no living daemon.

    @staticmethod
    def _bsd_identity(info):
        return info.pid, info.uid, info.birth_sec, info.birth_usec

    def identity(self, pid):
        before = self._fresh_bsd(pid)
        if before is None:
            return None
        path = ctypes.create_string_buffer(4096)
        try:
            ctypes.set_errno(0)
            if self.proc.proc_pidpath(pid, path, len(path)) <= 0 or not path.value:
                raise OwnershipUnknown()
            executable = str(Path(os.fsdecode(path.value)).resolve(strict=True))
        except (OSError, RuntimeError):
            # A path read may race exit; only a NEW BSD gone/zombie result retires.
            if self._fresh_bsd(pid) is None:
                return None
            raise OwnershipUnknown() from None
        after = self._fresh_bsd(pid)
        if after is None:
            return None
        if self._bsd_identity(before) != self._bsd_identity(after):
            raise OwnershipUnknown()
        return {"pid": pid, "uid": after.uid, "birth": [after.birth_sec, after.birth_usec], "exe": executable}

    def tracking(self, pid):
        mib = (ctypes.c_int * 3)(1, 49, pid)  # CTL_KERN / KERN_PROCARGS2.
        size = ctypes.c_size_t()
        ctypes.set_errno(0)
        if self.libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0) or not 4 < size.value <= 1048576:
            raise OwnershipUnknown()
        raw = ctypes.create_string_buffer(size.value)
        ctypes.set_errno(0)
        if self.libc.sysctl(mib, 3, raw, ctypes.byref(size), None, 0):
            raise OwnershipUnknown()
        return tracking_from_args(raw.raw[:size.value])

    def candidates(self):
        # Only names/PIDs privately inspected here; no argv or environment output.
        result = subprocess.run(["/bin/ps", "-axo", "pid=,comm="], capture_output=True, text=True, timeout=2)
        if result.returncode or result.stderr:
            raise OwnershipUnknown()
        found = []
        for line in result.stdout.splitlines():
            parts = line.strip().split(None, 1)
            if len(parts) == 2 and Path(parts[1]).name == "ibtoold":
                if not parts[0].isdigit():
                    raise OwnershipUnknown()
                found.append(int(parts[0]))
        return found


def context():
    token = os.environ.get("RUNNER_TRACKING_ID", "")
    run, attempt = os.environ.get("GITHUB_RUN_ID", ""), os.environ.get("GITHUB_RUN_ATTEMPT", "")
    if not token or len(token) > 256 or not token.isascii() or any(c.isspace() or not c.isprintable() for c in token) or not run.isdigit() or not attempt.isdigit():
        raise OwnershipUnknown()
    if os.environ.get("DEVELOPER_DIR") != str(DEVELOPER):
        raise OwnershipUnknown()
    return {"run": run, "attempt": attempt, "uid": os.getuid(), "token_hash": hashlib.sha256(token.encode()).hexdigest()}, token.encode()


def eligible(record, owner, executable_allowed):
    return record is not None and record["uid"] == owner["uid"] and executable_allowed(record["exe"])


def compiler_executable(executable):
    path = Path(executable)
    return path.name == "ibtoold" and path.is_relative_to(DEVELOPER.resolve(strict=True))


def state_dir():
    root = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    return root / "ept105-ios-compiler-owner"


def secure_read():
    directory = state_dir()
    for path, mode, regular in [(directory, 0o700, False), (directory / "baseline.json", 0o600, True)]:
        info = path.lstat()
        valid_type = stat.S_ISREG(info.st_mode) if regular else stat.S_ISDIR(info.st_mode)
        if not valid_type or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != mode:
            raise OwnershipUnknown()
    directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        descriptor = os.open("baseline.json", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
        with os.fdopen(descriptor, "r", encoding="utf8") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 1048576:
                raise OwnershipUnknown()
            return json.load(handle)
    finally:
        os.close(directory_fd)



def baseline(api):
    owner, token = context()
    if api.tracking(os.getpid()) != token:
        raise OwnershipUnknown()
    records = []
    for pid in api.candidates():
        record = api.identity(pid)
        if record is not None:
            records.append(record)
    directory = state_dir()
    directory.mkdir(mode=0o700)
    descriptor = os.open(directory / "baseline.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf8") as handle:
        json.dump({"owner": owner, "baseline": records}, handle)
    print("compiler baseline_count=" + str(len(records)), flush=True)


def cleanup_records(api, owner, token, baseline_records, executable_allowed=compiler_executable, seconds=14):
    deadline = time.monotonic() + seconds
    candidates = []
    counts = {"eligible": 0, "baseline": 0, "foreign": 0, "term": 0, "kill": 0, "retired": 0}
    def tracking_or_retired(record):
        try:
            return api.tracking(record["pid"])
        except OwnershipUnknown:
            # A process can exit between kernel identity and environment reads.
            # Only a fresh kernel gone/zombie result is retirement, never an access error.
            if api.identity(record["pid"]) is None:
                return None
            raise OwnershipUnknown() from None
    def live(record):
        current = api.identity(record["pid"])
        if current is None:
            return False
        if current != record or not eligible(current, owner, executable_allowed):
            raise OwnershipUnknown()
        tracking = tracking_or_retired(record)
        if tracking is None:
            return False
        if tracking != token:
            raise OwnershipUnknown()
        return True
    for pid in api.candidates():
        if time.monotonic() >= deadline:
            raise OwnershipUnknown()
        record = api.identity(pid)
        if record is None:
            continue
        if record in baseline_records:
            counts["baseline"] += 1
            continue
        if record["uid"] != owner["uid"]:
            counts["foreign"] += 1
            continue
        tracking = tracking_or_retired(record)
        if tracking is None:
            continue
        if tracking != token:
            counts["foreign"] += 1
            continue
        if not executable_allowed(record["exe"]):
            # A tracked compiler outside the allowed kernel executable scope is not retired.
            raise OwnershipUnknown()
        candidates.append(record)
    counts["eligible"] = len(candidates)
    for sig, wait in [(signal.SIGTERM, 3), (signal.SIGKILL, 2)]:
        for record in candidates:
            if time.monotonic() >= deadline:
                raise OwnershipUnknown()
            if live(record):
                try:
                    os.kill(record["pid"], sig)
                except ProcessLookupError:
                    if live(record):
                        raise OwnershipUnknown()
                counts["term" if sig == signal.SIGTERM else "kill"] += 1
        until = min(deadline, time.monotonic() + wait)
        while time.monotonic() < until:
            if not any(live(record) for record in candidates):
                break
            time.sleep(0.05)
    if any(live(record) for record in candidates):
        raise OwnershipUnknown()
    # A newly spawned matching daemon after the snapshot cannot turn cleanup green.
    for pid in api.candidates():
        if time.monotonic() >= deadline:
            raise OwnershipUnknown()
        record = api.identity(pid)
        if record is not None and record not in baseline_records and record["uid"] == owner["uid"] and tracking_or_retired(record) == token:
            raise OwnershipUnknown()
    counts["retired"] = len(candidates)
    print("compiler cleanup=" + json.dumps(counts, sort_keys=True), flush=True)
    return counts


def cleanup(api):
    owner, token = context()
    record = secure_read()
    if not isinstance(record, dict) or record.get("owner") != owner or not isinstance(record.get("baseline"), list):
        raise OwnershipUnknown()
    for item in record["baseline"]:
        if not isinstance(item, dict) or set(item) != {"pid", "uid", "birth", "exe"} or type(item["pid"]) is not int or item["pid"] <= 0 or type(item["uid"]) is not int or not isinstance(item["exe"], str) or not isinstance(item["birth"], list) or len(item["birth"]) != 2 or any(type(v) is not int or v < 0 for v in item["birth"]):
            raise OwnershipUnknown()
    cleanup_records(api, owner, token, record["baseline"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("baseline", "cleanup"))
    args = parser.parse_args()
    try:
        {"baseline": baseline, "cleanup": cleanup}[args.action](Darwin())
    except Exception:
        print("COMPILER_CHECKCODE=cleanup_ownership_unknown", file=sys.stderr, flush=True)
        sys.exit(1)
