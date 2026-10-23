"""Drill A: kill one of two API instances under load, restart it, and record what happened.

Local experiment, not proof of AWS high availability. It uses its own database, swimsync_drill,
and resets it at the start. Results go to drills/results/a-<timestamp>/.

Timeline: load runs for 60 s; instance a1 gets kill -9 at 20 s and is restarted at 40 s.

Modes:
  plain          the kill lands wherever it lands
  before-commit  a "victim" request is held for 2 s before its commit, inside the lock, and a1 is killed
                 during that hold: the booking rolls back (tests false successes)
  after-commit   the victim is held for 2 s after its commit and a1 is killed during that hold: the
                 booking is saved but the response is lost (tests duplicates)

Only the victim (swimmer drill-victim, on its own session) is delayed; the 30 load swimmers never are.
Earlier versions delayed everyone and relied on chance: 100 ms overloaded the run and 20 ms never
caught a request mid-flight. Choosing the moment makes the risky case certain to happen.

Run: .venv/bin/python drills/a/run.py --mode after-commit
"""

import argparse
import json
import os
import pathlib
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import psycopg

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent
VENV_BIN = pathlib.Path(sys.executable).parent
DRILL_DB = "swimsync_drill"
DB_URL = f"postgresql:///{DRILL_DB}"

DURATION, KILL_AT, RESTART_AT = 60, 20, 40
# Victim delays per mode, in ms: (before commit, after commit).
MODES = {"plain": (0, 0), "before-commit": (2000, 0), "after-commit": (0, 2000)}
SESSIONS, CAPACITY = 3, 10
VICTIM = "drill-victim"
VICTIM_KILL_AFTER = 0.5  # seconds after sending the victim's request: well inside its 2 s hold


def reset_database():
    with psycopg.connect("postgresql:///postgres", autocommit=True) as conn:
        if conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DRILL_DB,)).fetchone() is None:
            conn.execute(f"CREATE DATABASE {DRILL_DB}")
    starts_at = datetime.now(timezone.utc) + timedelta(days=1)
    with psycopg.connect(DB_URL) as conn:
        conn.execute((ROOT / "db" / "schema.sql").read_text())
        for i in range(1, SESSIONS + 1):
            conn.execute(
                "INSERT INTO sessions (name, starts_at, capacity) VALUES (%s, %s, %s)",
                (f"Drill session {i}", starts_at + timedelta(hours=i), CAPACITY),
            )
        # The victim's own session, so a held lock never blocks the load swimmers.
        return conn.execute(
            "INSERT INTO sessions (name, starts_at, capacity) VALUES ('Victim session', %s, %s) RETURNING id",
            (starts_at, CAPACITY),
        ).fetchone()[0]


def port_is_free(port):
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0


def start_api(name, port, out, mode):
    before, after = MODES[mode]
    env = dict(os.environ, DATABASE_URL=DB_URL, SWIMSYNC_INSTANCE=name, SWIMSYNC_DRILL_VICTIM=VICTIM,
               SWIMSYNC_DRILL_DELAY_BEFORE_COMMIT_MS=str(before),
               SWIMSYNC_DRILL_DELAY_AFTER_COMMIT_MS=str(after))
    log = open(out / f"{name}.log", "a")
    return subprocess.Popen(
        [str(VENV_BIN / "uvicorn"), "--app-dir", str(ROOT / "backend"), "app.main:app",
         "--port", str(port), "--log-level", "warning"],
        env=env, stdout=log, stderr=subprocess.STDOUT,
    )


def wait_for(url, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if httpx.get(url, timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.2)
    raise SystemExit(f"timed out waiting for {url}")


def sleep_until(t):
    time.sleep(max(0.0, t - time.time()))


def victim_booking(session_id, record):
    """Book straight on a1 (which gets killed mid-request), then retry through HAProxy with the same key."""
    key = str(uuid.uuid4())
    headers = {"X-Swimmer-Id": VICTIM, "Idempotency-Key": key}
    record.update(key=key, session_id=session_id, attempts=[])

    def call(url):
        started = time.time()
        try:
            response = httpx.post(f"{url}/sessions/{session_id}/bookings", headers=headers, timeout=10)
            entry = {"url": url, "status": response.status_code, "body": response.json(),
                     "instance": response.headers.get("X-Instance")}
        except httpx.HTTPError as exc:
            entry = {"url": url, "status": None, "error": type(exc).__name__}
        entry.update(sent=started, finished=time.time())
        record["attempts"].append(entry)
        return entry

    call("http://127.0.0.1:8001")
    for _ in range(20):  # a1 may still be in HAProxy's rotation for about 2 s: keep retrying, same key
        if call("http://127.0.0.1:8080")["status"] in (200, 201, 409):
            break
        time.sleep(0.3)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=sorted(MODES), default="plain")
    mode = parser.parse_args().mode

    for port in (8001, 8002, 8080):
        if not port_is_free(port):
            raise SystemExit(f"port {port} is in use; stop whatever is running there first")
    haproxy_bin = shutil.which("haproxy")
    if haproxy_bin is None:
        raise SystemExit("haproxy not found (brew install haproxy)")

    out = ROOT / "drills" / "results" / f"a-{mode}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    out.mkdir(parents=True)
    victim_session = reset_database()

    events = {"mode": mode}
    a1, a2 = start_api("a1", 8001, out, mode), start_api("a2", 8002, out, mode)
    wait_for("http://127.0.0.1:8001/health")
    wait_for("http://127.0.0.1:8002/health")
    haproxy = subprocess.Popen([haproxy_bin, "-f", str(HERE / "haproxy.cfg"), "-db"],
                               stdout=open(out / "haproxy.log", "w"), stderr=subprocess.STDOUT)
    wait_for("http://127.0.0.1:8080/health")
    time.sleep(3)  # let HAProxy's health checks mark both instances up

    events["load_start"] = time.time()
    load = subprocess.Popen([sys.executable, str(HERE / "load.py"), "--out", str(out / "attempts.jsonl"),
                             "--duration", str(DURATION), "--session-prefix", "Drill session"])
    print(f"mode {mode}: load running for {DURATION}s; killing a1 at {KILL_AT}s, restarting at {RESTART_AT}s")

    victim = {}
    if mode == "plain":
        sleep_until(events["load_start"] + KILL_AT)
    else:
        sleep_until(events["load_start"] + KILL_AT - VICTIM_KILL_AFTER)
        victim_thread = threading.Thread(target=victim_booking, args=(victim_session, victim))
        victim_thread.start()
        time.sleep(VICTIM_KILL_AFTER)  # the victim is now inside its hold on a1
    a1.send_signal(signal.SIGKILL)
    events["kill_a1"] = time.time()
    a1.wait()
    print("a1 killed (SIGKILL)")

    sleep_until(events["load_start"] + RESTART_AT)
    a1 = start_api("a1", 8001, out, mode)
    events["restart_a1"] = time.time()
    print("a1 restarted")

    load.wait()
    events["load_end"] = time.time()
    if mode != "plain":
        victim_thread.join()
        (out / "victim.json").write_text(json.dumps(victim, indent=2))
    for process in (haproxy, a1, a2):
        process.terminate()
        process.wait()

    (out / "events.json").write_text(json.dumps(events, indent=2))
    print(f"results in {out.relative_to(ROOT)}")
    result = subprocess.run([sys.executable, str(HERE / "analyse.py"), str(out), "--db", DB_URL])
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
