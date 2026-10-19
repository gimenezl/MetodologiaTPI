#!/usr/bin/env python3
"""Bound a POSIX process group; never log argv or unredacted provider output."""
import argparse
from collections import deque
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import sys
import threading
import time


def redact(text, preserve_structure=False):
    for name, value in sorted(os.environ.items(), key=lambda pair: len(pair[1]), reverse=True):
        if value and re.search(r"(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|EMAIL|AUTHORIZATION)(?:$|_)|_URL$|^MAESTRO_RECUPERACION_NUEVA2?$", name, re.I):
            text = text.replace(value, "[REDACTED]")
    text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text)
    # CLI table/JSON output can contain newly minted keys absent from the environment.
    text = re.sub(r"(?<![A-Za-z0-9_-])sb_(?:secret|publishable)_[A-Za-z0-9_-]+(?![A-Za-z0-9_-])", "[REDACTED_SUPABASE_KEY]", text)
    text = re.sub(r"\beyJ[\w-]+\.[\w-]+\.[\w-]+\b", "[REDACTED_TOKEN]", text)
    text = re.sub(r"\b(?:Bearer\s+\S+|[A-Za-z][\w+.-]*://\S+)", "[REDACTED]", text)
    text = re.sub(r"/(?:Users|home|tmp|private|var/folders)/[^\s\"'<>]+", "[REDACTED_PATH]", text)
    return "[REDACTED_SENSITIVE_LINE]" if not preserve_structure and re.search(r"(?:secret|token|password|credential|anon.key|service.role(?:.key)?|authorization)\s*[\"']?\s*[:=]", text, re.I) else text


def group_has_live_members(pid):
    # XNU can return EPERM for zombie-only groups; verify states, not permissions.
    result = subprocess.run(["ps", "-axo", "pgid=,stat="], capture_output=True, text=True, timeout=2)
    if result.returncode:
        raise RuntimeError("Owned group state unavailable")
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) != 2 or not fields[0].isdigit():
            raise RuntimeError("Owned group state invalid")
        if int(fields[0]) == pid and not fields[1].startswith("Z"):
            return True
    return False


def terminate_group(pid, emit=lambda _message: None):
    # Always address the original group, including when its leader already exited.
    # A nested supervisor must KILL its own group before an ancestor's 3s TERM grace ends.
    nested = int(os.environ.get("EPT_STAGE_DEPTH", "0")) > 0
    for sig, grace in ((signal.SIGTERM, .5 if nested else 3), (signal.SIGKILL, .5 if nested else 2)):
        try:
            os.killpg(pid, sig)
        except ProcessLookupError:
            return
        except PermissionError:
            emit(f"owned group signal denied signal={sig.name}")
            if sig == signal.SIGTERM:
                continue  # Still attempt the bounded KILL; do not call the group gone.
            if group_has_live_members(pid):
                raise
            return
        until = time.monotonic() + grace
        while time.monotonic() < until:
            try:
                os.killpg(pid, 0)
            except ProcessLookupError:
                return
            except PermissionError:
                # An inconclusive TERM probe cannot stop cleanup before KILL.
                if sig == signal.SIGTERM:
                    break
                if not group_has_live_members(pid):
                    return
            time.sleep(.05)
    if group_has_live_members(pid):
        raise RuntimeError("Owned group still has live members after KILL")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage")
    parser.add_argument("--seconds", type=float)
    parser.add_argument("--sanitize-directory", type=Path)
    parser.add_argument("--capture", action="store_true", help="Return raw stdout only to the caller; diagnostics stay on stderr.")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.sanitize_directory:
        for file in args.sanitize_directory.rglob("*"):
            if file.is_file() and not file.is_symlink() and file.suffix in {".log", ".txt", ".xml", ".yaml", ".yml", ".json"}:
                file.write_text("\n".join(redact(line, preserve_structure=True) for line in file.read_text(errors="replace").splitlines()) + "\n", encoding="utf-8")
        return 0
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    try:
        depth = int(os.environ.get("EPT_STAGE_DEPTH", "0"))
    except ValueError:
        parser.error("Invalid supervisor depth")
    # Supported topology: an outer stage and one inner CLI/status supervisor.
    # A third session could outlive equal nested TERM grace, so refuse before Popen.
    if depth not in (0, 1):
        parser.error("At most two supervisor levels are supported; refusing before spawn")
    if os.name != "posix" or not command or not args.seconds or args.seconds <= 0 or not re.fullmatch(r"[a-z0-9-]+", args.stage or ""):
        parser.error("POSIX, a positive deadline, a safe stage label and a command are required")
    # CI sets a single monotonic wall budget at job setup; cleanup has separate limits.
    deadline = time.monotonic() + args.seconds
    budget = os.environ.get("EPT_NATIVE_DEADLINE")
    if budget and not args.stage.startswith("cleanup-"):
        deadline = min(deadline, time.monotonic() + max(0, float(budget) - time.time()))
    output_dir = Path(os.environ.get("EPT_STAGE_LOG_DIR", os.environ.get("RUNNER_TEMP", "/tmp")))
    output_dir.mkdir(parents=True, exist_ok=True)
    log = output_dir / (args.stage + "-redacted.log")
    tail = deque(maxlen=30)
    raw = bytearray()
    started = time.monotonic()
    stopped = threading.Event()
    def emit(text):
        safe = redact(text.rstrip())
        tail.append(safe)
        with log.open("a", encoding="utf-8") as handle:
            handle.write(safe + "\n")
        print(safe, file=sys.stderr, flush=True)
    log.write_text("", encoding="utf-8")
    log.chmod(0o600)
    emit(f"stage={args.stage} architecture={platform.machine()} budget_s={max(0, deadline-time.monotonic()):.0f}")
    if deadline <= time.monotonic():
        emit(f"stage={args.stage} total budget exhausted before launch")
        return 124
    child_env = {**os.environ, "EPT_STAGE_DEPTH": str(depth + 1)}
    child = subprocess.Popen(command, env=child_env, start_new_session=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    def consume(pipe, stdout=False):
        while True:
            line = pipe.readline(16384)
            if not line:
                break
            if args.capture and stdout:
                raw.extend(line)
                if len(raw) > 4 * 1024 * 1024:
                    stopped.set()
            # Provider status contains credentials: only the caller receives raw stdout.
            if not args.capture or not stdout:
                emit(line.decode("utf-8", errors="replace"))
    readers = [threading.Thread(target=consume, args=(child.stdout, True), daemon=True), threading.Thread(target=consume, args=(child.stderr,), daemon=True)]
    for reader in readers:
        reader.start()
    def interrupted(_signal, _frame):
        stopped.set()
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    heartbeat = started
    timed_out = False
    while child.poll() is None or any(reader.is_alive() for reader in readers):
        now = time.monotonic()
        if stopped.is_set() or now >= deadline:
            timed_out = True
            emit(f"stage={args.stage} deadline/interruption elapsed_s={now-started:.1f}; terminating owned group")
            break
        if now - heartbeat >= 30:
            heartbeat = now
            emit(f"stage={args.stage} elapsed_s={now-started:.0f} load={os.getloadavg()} free_disk_gb={os.statvfs(output_dir).f_bavail * os.statvfs(output_dir).f_frsize / 1e9:.1f}")
            # Names/resources only, never argv or environment. This probe is independently bounded.
            try:
                snapshot = subprocess.run(["ps", "-axo", "pid,ppid,pcpu,rss,comm"], capture_output=True, text=True, timeout=2)
                for line in snapshot.stdout.splitlines():
                    if re.search(r"qemu|colima|xcode|clang|swift|maestro|java|docker", line, re.I):
                        emit(line)
            except (OSError, subprocess.TimeoutExpired):
                emit("resource-probe unavailable")
            if args.stage == "supabase-start":
                try:
                    snapshot = subprocess.run(["docker", "ps", "--filter", "name=ept105-", "--format", "{{.Names}} {{.Image}} {{.Status}}"], capture_output=True, text=True, timeout=2)
                    for line in snapshot.stdout.splitlines():
                        emit(line)
                except (OSError, subprocess.TimeoutExpired):
                    emit("container-readiness probe unavailable")
        time.sleep(.1)
    # Clean remaining descendants even if the leader failed/exited before the deadline.
    try:
        terminate_group(child.pid, emit)
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        emit(f"stage={args.stage} owned group cleanup failed or could not be verified")
        return 125
    try:
        child.wait(timeout=2)
    except subprocess.TimeoutExpired:
        emit("owned group could not be reaped")
        return 125
    for reader in readers:
        reader.join(timeout=1)
    result = 124 if timed_out else (child.returncode if child.returncode >= 0 else 128-child.returncode)
    emit(f"stage={args.stage} elapsed_s={time.monotonic()-started:.1f} exit={result}")
    if result:
        print("\n".join(tail), file=sys.stderr)
    elif args.capture:
        sys.stdout.buffer.write(raw)
    return result


if __name__ == "__main__":
    sys.exit(main())
