"""Drill A: kill one of two API instances under load, restart it, and record what happened.

Local experiment, not proof of AWS high availability. It uses its own database, swimsync_drill,
and resets it at the start. Results go to drills/results/a-<timestamp>/.

Timeline: load runs for 60 s; instance a1 gets kill -9 at 20 s and is restarted at 40 s.

Run: .venv/bin/python drills/a/run.py
"""

import json
import os
import pathlib
import shutil
import signal
import socket
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

import httpx
import psycopg

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent
VENV_BIN = pathlib.Path(sys.executable).parent
DRILL_DB = "swimsync_drill"
DB_URL = f"postgresql:///{DRILL_DB}"

DURATION, KILL_AT, RESTART_AT = 60, 20, 40
SESSIONS, CAPACITY = 3, 10


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


def port_is_free(port):
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0


def start_api(name, port, out):
    env = dict(os.environ, DATABASE_URL=DB_URL, SWIMSYNC_INSTANCE=name)
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


def main():
    for port in (8001, 8002, 8080):
        if not port_is_free(port):
            raise SystemExit(f"port {port} is in use; stop whatever is running there first")
    haproxy_bin = shutil.which("haproxy")
    if haproxy_bin is None:
        raise SystemExit("haproxy not found (brew install haproxy)")

    out = ROOT / "drills" / "results" / f"a-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    out.mkdir(parents=True)
    reset_database()

    events = {}
    a1, a2 = start_api("a1", 8001, out), start_api("a2", 8002, out)
    wait_for("http://127.0.0.1:8001/health")
    wait_for("http://127.0.0.1:8002/health")
    haproxy = subprocess.Popen([haproxy_bin, "-f", str(HERE / "haproxy.cfg"), "-db"],
                               stdout=open(out / "haproxy.log", "w"), stderr=subprocess.STDOUT)
    wait_for("http://127.0.0.1:8080/health")
    time.sleep(3)  # let HAProxy's health checks mark both instances up

    events["load_start"] = time.time()
    load = subprocess.Popen([sys.executable, str(HERE / "load.py"), "--out", str(out / "attempts.jsonl"),
                             "--duration", str(DURATION)])
    print(f"load running for {DURATION}s; killing a1 at {KILL_AT}s, restarting at {RESTART_AT}s")

    sleep_until(events["load_start"] + KILL_AT)
    a1.send_signal(signal.SIGKILL)
    events["kill_a1"] = time.time()
    a1.wait()
    print("a1 killed (SIGKILL)")

    sleep_until(events["load_start"] + RESTART_AT)
    a1 = start_api("a1", 8001, out)
    events["restart_a1"] = time.time()
    print("a1 restarted")

    load.wait()
    events["load_end"] = time.time()
    for process in (haproxy, a1, a2):
        process.terminate()
        process.wait()

    (out / "events.json").write_text(json.dumps(events, indent=2))
    print(f"results in {out.relative_to(ROOT)}")
    result = subprocess.run([sys.executable, str(HERE / "analyse.py"), str(out), "--db", DB_URL])
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
