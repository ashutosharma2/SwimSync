"""Check drill B's hard limits against the database, and report the recorded measurements.

Hard limits (any breach fails the drill), set before the first run:
  1. Zero duplicates: no idempotency key produced more than one booking, and no swimmer holds two
     confirmed places in one session.
  2. Zero false successes: every final "booked" answer has that booking in the database, and every
     final "cancelled" answer has the booking cancelled.
  3. Consistency: each session's counter equals its confirmed bookings, and none exceeds capacity.
  4. No false "not booked": no key was answered only with "booked": false (or "full") and yet saved.
  5. Outbox matches committed changes: every booking has exactly one booking_confirmed row, every
     cancelled booking exactly one booking_cancelled row, and nothing else.
Victim rule: the victim's first answer must be 503 outcome_unknown, the database must hold exactly one
victim booking, and the retry must return 200 with that booking. If the first answer was anything else,
the ambiguous commit didn't happen and the run is INCONCLUSIVE.

Run (normally via run.py): python drills/b/analyse.py drills/results/b-<timestamp>
"""

import argparse
import json
import pathlib
import sys

import psycopg
from psycopg.rows import dict_row


def percentile(values, p):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(p / 100 * (len(ordered) - 1)))]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("results")
    parser.add_argument("--db", default="postgresql:///swimsync_drill")
    args = parser.parse_args()
    out = pathlib.Path(args.results)

    events = json.loads((out / "events.json").read_text())
    victim_record = json.loads((out / "victim.json").read_text())
    records = [json.loads(line) for line in (out / "attempts.jsonl").read_text().splitlines()]
    attempts = [r for r in records if r["type"] == "attempt"]
    finals = [r for r in records if r["type"] == "final"]

    with psycopg.connect(args.db, row_factory=dict_row) as conn:
        bookings = {r["id"]: r for r in conn.execute("SELECT id, session_id, swimmer_id, status FROM bookings")}
        keys = {r["key"]: r for r in conn.execute("SELECT key, status_code, response FROM idempotency_keys")}
        key_per_booking = conn.execute(
            "SELECT b.id FROM bookings b LEFT JOIN idempotency_keys k"
            " ON k.status_code = 201 AND (k.response->>'booking_id')::bigint = b.id"
            " GROUP BY b.id HAVING count(k.key) <> 1"
        ).fetchall()
        double_holders = conn.execute(
            "SELECT session_id, swimmer_id FROM bookings WHERE status = 'confirmed'"
            " GROUP BY session_id, swimmer_id HAVING count(*) > 1"
        ).fetchall()
        sessions = conn.execute(
            "SELECT s.id, s.capacity, s.booked, (SELECT count(*) FROM bookings b"
            " WHERE b.session_id = s.id AND b.status = 'confirmed') AS confirmed FROM sessions s ORDER BY s.id"
        ).fetchall()
        outbox_mismatch = conn.execute(
            "SELECT b.id, b.status,"
            " count(*) FILTER (WHERE o.kind = 'booking_confirmed') AS confirmed_rows,"
            " count(*) FILTER (WHERE o.kind = 'booking_cancelled') AS cancelled_rows"
            " FROM bookings b LEFT JOIN outbox o ON o.booking_id = b.id GROUP BY b.id, b.status"
            " HAVING count(*) FILTER (WHERE o.kind = 'booking_confirmed') <> 1"
            " OR count(*) FILTER (WHERE o.kind = 'booking_cancelled') <> (CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END)"
        ).fetchall()
        outbox_status = {r["status"]: r["n"] for r in conn.execute("SELECT status, count(*) AS n FROM outbox GROUP BY status")}

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
        resolved = f.get("resolved") or {}
        if f["op"] == "book" and resolved.get("booking_id") is not None:
            row = bookings.get(resolved["booking_id"])
            if row is None or row["swimmer_id"] != f["swimmer"] or row["session_id"] != f["session"]:
                false_successes.append(f)

    # Hard limit 4: a key answered only with definite "no" answers that was in fact saved.
    by_key = {}
    for a in attempts:
        if a["op"] == "book":
            by_key.setdefault(a["key"], []).append(a)
    false_nos = []
    for key, tries in by_key.items():
        if keys.get(key, {}).get("status_code") != 201:
            continue  # not saved: any "no" was true
        definite_no = all((t["status"] == 503 and t.get("booked") is False) or t["status"] == 409 for t in tries)
        if definite_no:
            false_nos.append(key)

    inconsistent = [s for s in sessions if s["booked"] != s["confirmed"] or s["confirmed"] > s["capacity"]]

    # Victim.
    first, last = victim_record["attempts"][0], victim_record["attempts"][-1]
    victim_rows = [b for b in bookings.values() if b["swimmer_id"] == "drill-victim"]
    exercised = first["status"] == 503 and (first.get("body") or {}).get("error") == "outcome_unknown"
    victim_ok = (len(victim_rows) == 1 and victim_rows[0]["status"] == "confirmed" and last["status"] == 200
                 and (last.get("body") or {}).get("booking_id") == victim_rows[0]["id"])

    # Recorded: each phase.
    t0 = events["load_start"]
    windows = [
        ("normal before", t0, events["down_start"]),
        ("down", events["down_start"], events["down_end"]),
        ("between", events["down_end"], events["slow_start"]),
        ("slow", events["slow_start"], events["slow_end"]),
        ("after", events["slow_end"], events["load_end"]),
    ]
    by_phase = {}
    for name, start, end in windows:
        in_phase = [a for a in attempts if start <= a["ts"] < end]
        kinds = {}
        for a in in_phase:
            if a["status"] is not None and a["status"] < 500:
                kind = "answered"
            elif a["status"] == 503:
                kind = a.get("answer") or "503"
            else:
                kind = a["error"] or str(a["status"])
            kinds[kind] = kinds.get(kind, 0) + 1
        ok = [a["latency_ms"] for a in in_phase if a["status"] is not None and a["status"] < 500]
        failed = [a["latency_ms"] for a in in_phase if a["status"] is None or a["status"] >= 500]
        by_phase[name] = {"attempts": len(in_phase), "outcomes": kinds,
                          "answered_p50_ms": percentile(ok, 50), "answered_p95_ms": percentile(ok, 95),
                          "failed_p50_ms": percentile(failed, 50), "failed_max_ms": max(failed) if failed else None}

    def first_answer_after(t):
        later = [a["ts"] for a in attempts if a["ts"] >= t and a["status"] is not None and a["status"] < 500]
        return round(min(later) - t, 2) if later else None

    hard = {
        "duplicates": {"keys_not_one_to_one": len(key_per_booking), "double_holders": len(double_holders),
                       "pass": not key_per_booking and not double_holders},
        "false_successes": {"count": len(false_successes), "pass": not false_successes},
        "consistency": {"sessions": [dict(s) for s in sessions], "pass": not inconsistent},
        "no_false_not_booked": {"count": len(false_nos), "pass": not false_nos},
        "outbox_matches_changes": {"mismatched_bookings": [dict(r) for r in outbox_mismatch], "pass": not outbox_mismatch},
    }
    passed = all(v["pass"] for v in hard.values()) and (victim_ok or not exercised)
    summary = {
        "label": "Local experiment on one machine, not proof of how a cloud database would behave",
        "result": "FAIL" if not passed else "PASS" if exercised else "INCONCLUSIVE",
        "hard_limits": hard,
        "victim": {"first": {k: first.get(k) for k in ("status", "body", "error")},
                   "last": {k: last.get(k) for k in ("status", "body", "error")},
                   "attempts": len(victim_record["attempts"]),
                   "victim_bookings_in_database": len(victim_rows),
                   "ambiguous_commit_happened": exercised, "pass": victim_ok},
        "recorded": {
            "operations": len(finals),
            "attempts": len(attempts),
            "first_answer_after_down_ends_s": first_answer_after(events["down_end"]),
            "first_answer_after_slow_ends_s": first_answer_after(events["slow_end"]),
            "outcome_unknown_to_client": sum(1 for f in finals if f["status"] is None),
            "outbox_by_status_at_end": outbox_status,
            "outbox_settle_s_after_load": round(events["outbox_settled"] - events["load_end"], 1),
            "by_phase": by_phase,
        },
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2, default=str))

    r = summary["recorded"]
    print(f"\nDrill B: {summary['result']}  ({summary['label']})")
    for name, limit in hard.items():
        print(f"  hard limit {name:24} {'pass' if limit['pass'] else 'FAIL'}")
    v = summary["victim"]
    print(f"  victim: first {v['first']['status']} {(v['first']['body'] or {}).get('error')}, "
          f"last {v['last']['status']}, bookings in DB {v['victim_bookings_in_database']}, pass {v['pass']}")
    print(f"  operations {r['operations']}, attempts {r['attempts']}, unknown to client {r['outcome_unknown_to_client']}")
    print(f"  first answer after down ends {r['first_answer_after_down_ends_s']} s, after slow ends "
          f"{r['first_answer_after_slow_ends_s']} s; outbox {r['outbox_by_status_at_end']} "
          f"(settled {r['outbox_settle_s_after_load']} s after load)")
    for name, p in r["by_phase"].items():
        print(f"  {name:13} attempts {p['attempts']:5} {p['outcomes']} answered p50 {p['answered_p50_ms']} "
              f"p95 {p['answered_p95_ms']} ms; failed p50 {p['failed_p50_ms']} max {p['failed_max_ms']} ms")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
