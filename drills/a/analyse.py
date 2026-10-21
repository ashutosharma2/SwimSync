"""Check drill A's hard limits against the database, and report the recorded measurements.

Hard limits (any breach fails the drill), set before the first run:
  1. Zero duplicates: no idempotency key produced more than one booking, and no swimmer holds two
     confirmed places in one session.
  2. Zero false successes: every final "booked" answer has that booking in the database, and every
     final "cancelled" answer has the booking cancelled.
  3. Consistency: each session's counter equals its confirmed bookings, and none exceeds capacity.

Everything else is recorded with no pass mark.

Run (normally via run.py): python drills/a/analyse.py drills/results/a-<timestamp> --db postgresql:///swimsync_drill
"""

import argparse
import json
import pathlib
import re
import sys
from datetime import datetime

import psycopg
from psycopg.rows import dict_row


def percentile(values, p):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(p / 100 * (len(ordered) - 1)))]


def haproxy_events(path):
    """Timestamps of a1 going DOWN and coming back UP, from HAProxy's own log."""
    found = {}
    for line in path.read_text().splitlines():
        # HAProxy also prints each change as an untimestamped [WARNING]; use only the timestamped log line.
        match = re.match(r"(\S+) Server api/a1 is (DOWN|UP)", line)
        if match and line[:1].isdigit():
            found.setdefault(match.group(2), datetime.fromisoformat(match.group(1)).timestamp())
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("results")
    parser.add_argument("--db", default="postgresql:///swimsync_drill")
    args = parser.parse_args()
    out = pathlib.Path(args.results)

    events = json.loads((out / "events.json").read_text())
    records = [json.loads(line) for line in (out / "attempts.jsonl").read_text().splitlines()]
    attempts = [r for r in records if r["type"] == "attempt"]
    finals = [r for r in records if r["type"] == "final"]
    kill, restart = events["kill_a1"], events["restart_a1"]

    def phase(ts):
        return "before" if ts < kill else "during" if ts < restart else "after"

    with psycopg.connect(args.db, row_factory=dict_row) as conn:
        bookings = {r["id"]: r for r in conn.execute("SELECT id, session_id, swimmer_id, status FROM bookings")}
        keys = {r["key"]: r for r in conn.execute("SELECT key, status_code, response FROM idempotency_keys")}
        key_per_booking = conn.execute(
            "SELECT b.id, count(k.key) AS n FROM bookings b LEFT JOIN idempotency_keys k"
            " ON k.status_code = 201 AND (k.response->>'booking_id')::bigint = b.id"
            " GROUP BY b.id HAVING count(k.key) <> 1"
        ).fetchall()
        double_holders = conn.execute(
            "SELECT session_id, swimmer_id, count(*) AS n FROM bookings WHERE status = 'confirmed'"
            " GROUP BY session_id, swimmer_id HAVING count(*) > 1"
        ).fetchall()
        sessions = conn.execute(
            "SELECT s.id, s.capacity, s.booked, (SELECT count(*) FROM bookings b"
            " WHERE b.session_id = s.id AND b.status = 'confirmed') AS confirmed FROM sessions s ORDER BY s.id"
        ).fetchall()

    # Hard limit 2: false successes.
    false_successes = []
    for f in finals:
        if f["op"] == "book" and f["status"] in (200, 201):
            row = bookings.get(f["body"]["booking_id"])
            if row is None or row["swimmer_id"] != f["swimmer"] or row["session_id"] != f["session"]:
                false_successes.append(f)
        if f["op"] == "cancel" and f["status"] == 200:
            row = bookings.get(f["booking_id"])
            if row is None or row["status"] != "cancelled":
                false_successes.append(f)

    # Recorded: operations whose outcome the client never learned, and what the database says.
    unknown = [f for f in finals if f["status"] is None]
    unknown_committed = sum(1 for f in unknown if f["op"] == "book" and keys.get(f["key"], {}).get("status_code") == 201)
    # Recorded: the client was told "no" but the database says the booking was made.
    false_failures = [f for f in finals if f["op"] == "book" and f["status"] == 409
                      and keys.get(f["key"], {}).get("status_code") == 201]

    inconsistent = [s for s in sessions if s["booked"] != s["confirmed"] or s["confirmed"] > s["capacity"]]

    failed = [a for a in attempts if a["status"] is None or a["status"] >= 500]
    after_kill = [a for a in failed if a["ts"] >= kill]
    proxy = haproxy_events(out / "haproxy.log")

    by_phase = {}
    for name in ("before", "during", "after"):
        in_phase = [a for a in attempts if phase(a["ts"]) == name]
        ok = [a["latency_ms"] for a in in_phase if a["status"] is not None and a["status"] < 500]
        instances = {}
        for a in in_phase:
            if a["instance"]:
                instances[a["instance"]] = instances.get(a["instance"], 0) + 1
        by_phase[name] = {
            "attempts": len(in_phase),
            "failed": sum(1 for a in in_phase if a in failed),
            "p50_ms": percentile(ok, 50),
            "p95_ms": percentile(ok, 95),
            "answered_by": instances,
        }

    summary = {
        "label": "Local experiment on one machine, not proof of AWS high availability",
        "hard_limits": {
            "duplicates": {"keys_not_one_to_one": len(key_per_booking), "double_holders": len(double_holders),
                           "pass": not key_per_booking and not double_holders},
            "false_successes": {"count": len(false_successes), "pass": not false_successes},
            "consistency": {"sessions": [dict(s) for s in sessions], "pass": not inconsistent},
        },
        "recorded": {
            "operations": len(finals),
            "attempts": len(attempts),
            "retries": sum(1 for a in attempts if a["attempt"] > 1),
            "failed_attempts": len(failed),
            "failed_attempts_after_kill": len(after_kill),
            "detection_s": round(proxy["DOWN"] - kill, 2) if "DOWN" in proxy else None,
            "errors_stopped_after_s": round(max(a["ts"] for a in after_kill) - kill, 2) if after_kill else 0,
            "rejoin_s": round(proxy["UP"] - restart, 2) if "UP" in proxy and proxy["UP"] > restart else None,
            "outcome_unknown_to_client": len(unknown),
            "outcome_unknown_but_committed": unknown_committed,
            "told_no_but_booked": len(false_failures),
            "by_phase": by_phase,
        },
    }
    passed = all(v["pass"] for v in summary["hard_limits"].values())
    summary["result"] = "PASS" if passed else "FAIL"
    (out / "summary.json").write_text(json.dumps(summary, indent=2))

    r = summary["recorded"]
    print(f"\nDrill A: {summary['result']}  ({summary['label']})")
    for name, limit in summary["hard_limits"].items():
        print(f"  hard limit {name:16} {'pass' if limit['pass'] else 'FAIL'}")
    print(f"  operations {r['operations']}, attempts {r['attempts']}, retries {r['retries']}, "
          f"failed attempts {r['failed_attempts']} ({r['failed_attempts_after_kill']} after the kill)")
    print(f"  detection {r['detection_s']} s, errors stopped {r['errors_stopped_after_s']} s after the kill, "
          f"rejoin {r['rejoin_s']} s after restart")
    print(f"  outcome unknown to client: {r['outcome_unknown_to_client']} "
          f"({r['outcome_unknown_but_committed']} committed); told no but booked: {r['told_no_but_booked']}")
    for name, p in r["by_phase"].items():
        print(f"  {name:6} attempts {p['attempts']:5} failed {p['failed']:3} "
              f"p50 {p['p50_ms']} ms p95 {p['p95_ms']} ms answered by {p['answered_by']}")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
