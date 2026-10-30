"""Check drill C's hard limits against the cluster's database, and report the recorded measurements.

Hard limits (any breach fails the drill), the same checks as drill A:
  1. Zero duplicates: no idempotency key produced more than one booking, and no swimmer holds two
     confirmed places in one session.
  2. Zero false successes: every final "booked" answer has that booking in the database, and every
     final "cancelled" answer has the booking cancelled. A "booked" from checking My bookings after
     giving up counts too.
  3. Consistency: each session's counter equals its confirmed bookings, and none exceeds capacity.

Evidence rule: the run counts only if the fault happened while swimmers were booking.
  rollout  attempts were answered by an old pod and by a new pod
  kill     the killed pod answered before the kill, and its replacement answered after it
Otherwise the result is INCONCLUSIVE. Everything else is recorded with no pass mark.

Run (normally via run.py): python drills/c/analyse.py drills/results/c-<mode>-<timestamp> --db <url>
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
    parser.add_argument("--db", required=True)
    args = parser.parse_args()
    out = pathlib.Path(args.results)

    events = json.loads((out / "events.json").read_text())
    records = [json.loads(line) for line in (out / "attempts.jsonl").read_text().splitlines()]
    attempts = [r for r in records if r["type"] == "attempt"]
    finals = [r for r in records if r["type"] == "final"]
    mode = events["mode"]
    fault, done = events.get("fault_at"), events.get("old_pods_gone", events.get("fault_done"))

    def phase(ts):
        if fault is None:
            return "no fault"
        return "before" if ts < fault else "during" if ts < done else "after"

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
    unknown = [f for f in finals if f["status"] is None]
    for f in unknown:
        if f["op"] == "book" and (f.get("resolved") or {}).get("booking_id") is not None:
            row = bookings.get(f["resolved"]["booking_id"])
            if row is None or row["swimmer_id"] != f["swimmer"] or row["session_id"] != f["session"]:
                false_successes.append(f)
    false_failures = [f for f in finals if f["op"] == "book" and f["status"] == 409
                      and keys.get(f["key"], {}).get("status_code") == 201]
    inconsistent = [s for s in sessions if s["booked"] != s["confirmed"] or s["confirmed"] > s["capacity"]]

    # Evidence that the fault happened under load.
    answered_by = {}
    for a in attempts:
        if a["instance"]:
            answered_by.setdefault(a["instance"], []).append(a["ts"])
    before = set(events.get("pods_before", []))
    if mode == "rollout":
        new = set(answered_by) - before
        exercised = bool(before & set(answered_by)) and bool(new)
        evidence = {"old_pods_answered": sorted(before & set(answered_by)), "new_pods_answered": sorted(new)}
    elif mode == "kill":
        victim = events["killed_pod"]
        replacements = [p for p in answered_by if p not in before]
        exercised = any(ts < fault for ts in answered_by.get(victim, [])) and any(
            ts > fault for p in replacements for ts in answered_by[p])
        evidence = {"killed_pod": victim, "killed_pod_answers_before_kill": sum(1 for ts in answered_by.get(victim, []) if ts < fault),
                    "replacement_pods_answered": replacements}
    else:
        exercised, evidence = False, {}

    failed = [a for a in attempts if a["status"] is None or a["status"] >= 500]
    by_phase = {}
    for name in (["no fault"] if fault is None else ["before", "during", "after"]):
        in_phase = [a for a in attempts if phase(a["ts"]) == name]
        ok = [a["latency_ms"] for a in in_phase if a["status"] is not None and a["status"] < 500]
        kinds = {}
        for a in in_phase:
            if a in failed:
                kind = str(a["status"]) if a["status"] is not None else a["error"]
                kinds[kind] = kinds.get(kind, 0) + 1
        by_phase[name] = {"attempts": len(in_phase), "failed": kinds, "p50_ms": percentile(ok, 50),
                          "p95_ms": percentile(ok, 95)}

    summary = {
        "label": "Local experiment on one machine (kind), not proof of how a cloud cluster behaves",
        "mode": mode,
        "evidence": evidence,
        "fault_exercised": exercised,
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
            "fault_to_handled_s": round(events["fault_done"] - fault, 2) if fault else None,
            "fault_to_old_pods_gone_s": round(events["old_pods_gone"] - fault, 2) if "old_pods_gone" in events else None,
            "outcome_unknown_to_client": len(unknown),
            "told_no_but_booked": len(false_failures),
            "answered_by": {p: len(ts) for p, ts in sorted(answered_by.items())},
            "by_phase": by_phase,
        },
    }
    passed = all(v["pass"] for v in summary["hard_limits"].values())
    summary["result"] = "FAIL" if not passed else "PASS" if exercised else "INCONCLUSIVE"
    (out / "summary.json").write_text(json.dumps(summary, indent=2))

    r = summary["recorded"]
    print(f"\nDrill C, mode {mode}: {summary['result']}  ({summary['label']})")
    print(f"  evidence: {evidence}")
    for name, limit in summary["hard_limits"].items():
        print(f"  hard limit {name:16} {'pass' if limit['pass'] else 'FAIL'}")
    print(f"  operations {r['operations']}, attempts {r['attempts']}, retries {r['retries']}, failed attempts {r['failed_attempts']}")
    print(f"  fault handled after {r['fault_to_handled_s']} s; old pods gone after {r['fault_to_old_pods_gone_s']} s")
    print(f"  outcome unknown to client: {r['outcome_unknown_to_client']}; told no but booked: {r['told_no_but_booked']}")
    print(f"  answered by: {r['answered_by']}")
    for name, p in r["by_phase"].items():
        print(f"  {name:8} attempts {p['attempts']:5} failed {p['failed']} p50 {p['p50_ms']} ms p95 {p['p95_ms']} ms")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
