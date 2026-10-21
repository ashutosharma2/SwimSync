"""Drill A load: fictional swimmers booking and cancelling through the load balancer.

Each logical operation is retried after a 5xx or a network error, up to 5 times, 200 ms apart.
A booking retry reuses the same Idempotency-Key. Every attempt and every final outcome is
written as one JSON line, which analyse.py checks against the database afterwards.

Run (normally via run.py): python drills/a/load.py --out attempts.jsonl --duration 60
"""

import argparse
import json
import random
import threading
import time
import uuid

import httpx

RETRIES = 5
RETRY_DELAY = 0.2
FINAL_STATUSES = {200, 201, 404, 409, 422}


class Recorder:
    def __init__(self, path):
        self.file = open(path, "w")
        self.lock = threading.Lock()

    def write(self, **record):
        record["ts"] = time.time()
        with self.lock:
            self.file.write(json.dumps(record) + "\n")

    def close(self):
        self.file.close()


def attempt(client, recorder, op, key, swimmer, method, path, headers):
    """Run one logical operation with retries. Returns the final status and body (or None)."""
    for number in range(1, RETRIES + 2):
        started = time.time()
        try:
            response = client.request(method, path, headers=headers)
            status, instance = response.status_code, response.headers.get("X-Instance")
            body = response.json() if response.headers.get("content-type", "").startswith("application/json") else None
            error = None
        except httpx.HTTPError as exc:
            status, instance, body, error = None, None, None, type(exc).__name__
        recorder.write(type="attempt", op=op, key=key, swimmer=swimmer, attempt=number, status=status,
                       error=error, instance=instance, latency_ms=round((time.time() - started) * 1000, 1))
        if status in FINAL_STATUSES:
            return status, body
        time.sleep(RETRY_DELAY)
    return None, None  # gave up: the outcome is unknown to the client


def swimmer_loop(base_url, swimmer, sessions, deadline, recorder):
    held = {}  # session id -> booking id this swimmer believes is confirmed
    with httpx.Client(base_url=base_url, timeout=2.0) as client:
        while time.time() < deadline:
            session = random.choice(sessions)
            if session in held and random.random() < 0.5:
                booking_id = held.pop(session)
                status, body = attempt(client, recorder, "cancel", None, swimmer, "POST",
                                       f"/bookings/{booking_id}/cancel", {"X-Swimmer-Id": swimmer})
                recorder.write(type="final", op="cancel", swimmer=swimmer, session=session,
                               booking_id=booking_id, status=status, body=body)
            elif session not in held:
                key = str(uuid.uuid4())
                status, body = attempt(client, recorder, "book", key, swimmer, "POST",
                                       f"/sessions/{session}/bookings",
                                       {"X-Swimmer-Id": swimmer, "Idempotency-Key": key})
                recorder.write(type="final", op="book", key=key, swimmer=swimmer, session=session,
                               status=status, body=body)
                if status in (200, 201):
                    held[session] = body["booking_id"]
            time.sleep(random.uniform(0.2, 0.5))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8080")
    parser.add_argument("--swimmers", type=int, default=30)
    parser.add_argument("--duration", type=float, default=60)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    sessions = [s["id"] for s in httpx.get(f"{args.url}/sessions", timeout=5).json()]
    recorder = Recorder(args.out)
    deadline = time.time() + args.duration
    threads = [
        threading.Thread(target=swimmer_loop, args=(args.url, f"swimmer-{i:02d}", sessions, deadline, recorder))
        for i in range(args.swimmers)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    recorder.close()


if __name__ == "__main__":
    main()
