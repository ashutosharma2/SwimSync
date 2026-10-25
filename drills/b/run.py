"""Drill B: break the API's connection to PostgreSQL in three ways, under load, and record what happened.

Local experiment, not proof of how a cloud database would behave. It uses its own database,
swimsync_drill, and resets it at the start. Results go to drills/results/b-<timestamp>/.

Setup: Toxiproxy sits between the API and PostgreSQL. The load (30 fictional swimmers, the same script
as drill A) and the outbox worker reach the database only through the proxy.

Timeline of the 60 s load:
  10-20 s  down     the proxy refuses connections
  30-40 s  slow     every reply from the database is delayed by 1 s
  50 s     victim   a separate API instance (:8003, its own proxy) holds one booking for 2 s before its
                    commit; 0.5 s in, that proxy starts swallowing replies, so the COMMIT reaches
                    PostgreSQL but the answer never comes back. The proxy closes the connection 3 s
                    later; the toxic is removed and the victim retries with the same key.

Run: .venv/bin/python drills/b/run.py
"""

import json
import os
import pathlib
import shutil
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
TOXIPROXY = "http://127.0.0.1:8474"
VIA_PROXY = f"postgresql://127.0.0.1:15432/{DRILL_DB}"
VIA_VICTIM_PROXY = f"postgresql://127.0.0.1:15433/{DRILL_DB}"

DURATION = 60
DOWN, SLOW, VICTIM_AT = (10, 20), (30, 40), 50
SESSIONS, CAPACITY = 3, 10
VICTIM = "drill-victim"


def reset_database():
    with psycopg.connect("postgresql:///postgres", autocommit=True) as conn:
        if conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DRILL_DB,)).fetchone() is None:
            conn.execute(f"CREATE DATABASE {DRILL_DB}")
    starts_at = datetime.now(timezone.utc) + timedelta(days=1)
    with psycopg.connect(f"postgresql:///{DRILL_DB}") as conn:
        conn.execute((ROOT / "db" / "schema.sql").read_text())
        for i in range(1, SESSIONS + 1):
            conn.execute("INSERT INTO sessions (name, starts_at, capacity) VALUES (%s, %s, %s)",
                         (f"Drill session {i}", starts_at + timedelta(hours=i), CAPACITY))
        return conn.execute("INSERT INTO sessions (name, starts_at, capacity) VALUES ('Victim session', %s, %s)"
                            " RETURNING id", (starts_at, CAPACITY)).fetchone()[0]


def port_is_free(port):
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0


def toxiproxy(method, path, **body):
    response = httpx.request(method, f"{TOXIPROXY}{path}", json=body or None, timeout=5)
    response.raise_for_status()


def start(name, cmd, env, out):
    return subprocess.Popen(cmd, env=dict(os.environ, **env), stdout=open(out / f"{name}.log", "a"),
                            stderr=subprocess.STDOUT)


def start_api(name, port, database_url, out, victim=False):
    env = {"DATABASE_URL": database_url, "SWIMSYNC_INSTANCE": name}
    if victim:
        env.update(SWIMSYNC_DRILL_VICTIM=VICTIM, SWIMSYNC_DRILL_DELAY_BEFORE_COMMIT_MS="2000")
    return start(name, [str(VENV_BIN / "uvicorn"), "--app-dir", str(ROOT / "backend"), "app.main:app",
                        "--port", str(port), "--log-level", "warning"], env, out)


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


def victim_booking(session_id, record, events):
    """Book on the victim instance; its commit's reply is swallowed. Then retry with the same key."""
    key = str(uuid.uuid4())
    headers = {"X-Swimmer-Id": VICTIM, "Idempotency-Key": key}
    record.update(key=key, session_id=session_id, attempts=[])

    def call():
        started = time.time()
        try:
            response = httpx.post(f"http://127.0.0.1:8003/sessions/{session_id}/bookings", headers=headers, timeout=15)
            entry = {"status": response.status_code, "body": response.json()}
        except httpx.HTTPError as exc:
            entry = {"status": None, "error": type(exc).__name__}
        entry.update(sent=started, finished=time.time())
        record["attempts"].append(entry)
        return entry

    call()
    while "victim_toxic_removed" not in events:  # retry only once the proxy works again
        time.sleep(0.1)
    for _ in range(10):
        if call()["status"] in (200, 201, 409):
            break
        time.sleep(0.5)


def sleep_until(t):
    time.sleep(max(0.0, t - time.time()))


def main():
    for port in (8001, 8003, 8474, 15432, 15433):
        if not port_is_free(port):
            raise SystemExit(f"port {port} is in use; stop whatever is running there first")
    if shutil.which("toxiproxy-server") is None:
        raise SystemExit("toxiproxy-server not found (brew install toxiproxy)")

    out = ROOT / "drills" / "results" / f"b-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    out.mkdir(parents=True)
    victim_session = reset_database()

    proxy = start("toxiproxy", ["toxiproxy-server", "-host", "127.0.0.1", "-port", "8474"], {}, out)
    wait_for(f"{TOXIPROXY}/version")
    toxiproxy("POST", "/proxies", name="pg", listen="127.0.0.1:15432", upstream="127.0.0.1:5432")
    toxiproxy("POST", "/proxies", name="pg_victim", listen="127.0.0.1:15433", upstream="127.0.0.1:5432")

    api = start_api("api", 8001, VIA_PROXY, out)
    victim_api = start_api("victim-api", 8003, VIA_VICTIM_PROXY, out, victim=True)
    worker = start("worker", [sys.executable, str(ROOT / "scripts" / "outbox_worker.py")],
                   {"DATABASE_URL": VIA_PROXY}, out)
    wait_for("http://127.0.0.1:8001/health")
    wait_for("http://127.0.0.1:8003/health")

    events = {}
    events["load_start"] = t0 = time.time()
    load = subprocess.Popen([sys.executable, str(ROOT / "drills" / "a" / "load.py"), "--url", "http://127.0.0.1:8001",
                             "--out", str(out / "attempts.jsonl"), "--duration", str(DURATION),
                             "--session-prefix", "Drill session"])
    print(f"load running for {DURATION}s: down {DOWN}, slow {SLOW}, victim at {VICTIM_AT}")

    sleep_until(t0 + DOWN[0])
    toxiproxy("POST", "/proxies/pg", enabled=False)
    events["down_start"] = time.time()
    sleep_until(t0 + DOWN[1])
    toxiproxy("POST", "/proxies/pg", enabled=True)
    events["down_end"] = time.time()
    print("phase down done")

    sleep_until(t0 + SLOW[0])
    toxiproxy("POST", "/proxies/pg/toxics", name="slow", type="latency", stream="downstream",
              attributes={"latency": 1000})
    events["slow_start"] = time.time()
    sleep_until(t0 + SLOW[1])
    toxiproxy("DELETE", "/proxies/pg/toxics/slow")
    events["slow_end"] = time.time()
    print("phase slow done")

    victim = {}
    sleep_until(t0 + VICTIM_AT)
    thread = threading.Thread(target=victim_booking, args=(victim_session, victim, events))
    thread.start()
    events["victim_sent"] = time.time()
    time.sleep(0.5)  # the victim is now held before its commit
    toxiproxy("POST", "/proxies/pg_victim/toxics", name="swallow", type="timeout", stream="downstream",
              attributes={"timeout": 3000})
    events["victim_toxic_added"] = time.time()
    time.sleep(4.5)  # the commit is sent at about 2 s; the proxy closes the connection at about 3.5 s
    toxiproxy("DELETE", "/proxies/pg_victim/toxics/swallow")
    events["victim_toxic_removed"] = time.time()
    print("phase victim done")

    load.wait()
    thread.join()
    events["load_end"] = time.time()

    # Give the outbox worker time to deliver what queued up during the outages.
    deadline = time.time() + 45
    with psycopg.connect(f"postgresql:///{DRILL_DB}") as conn:
        while time.time() < deadline:
            pending = conn.execute("SELECT count(*) FROM outbox WHERE status = 'pending'").fetchone()[0]
            if pending == 0:
                break
            time.sleep(1)
    events["outbox_settled"] = time.time()

    for process in (api, victim_api, worker, proxy):
        process.terminate()
        process.wait()
    (out / "events.json").write_text(json.dumps(events, indent=2))
    (out / "victim.json").write_text(json.dumps(victim, indent=2))
    print(f"results in {out.relative_to(ROOT)}")
    result = subprocess.run([sys.executable, str(HERE / "analyse.py"), str(out)])
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
