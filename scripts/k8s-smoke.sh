#!/usr/bin/env bash
# A quick end-to-end check of SwimSync on the kind cluster, through the web Service as a browser
# would reach it: the page loads, a booking is confirmed, its retry with the same key gets the same
# booking, and the outbox worker delivers the confirmation. Run after scripts/k8s-up.sh.
set -euo pipefail

WEB=http://127.0.0.1:8089
SWIMMER=smoke-$RANDOM
KEY=$(python3 -c "import uuid; print(uuid.uuid4())")
fail() { echo "FAIL: $1"; exit 1; }

page=$(curl -s -o /dev/null -w '%{http_code}' "$WEB/")
[ "$page" = 200 ] || fail "the page returned $page"

book() { curl -s -w '\n%{http_code}' -X POST "$WEB/api/sessions/1/bookings" -H "X-Swimmer-Id: $SWIMMER" -H "Idempotency-Key: $KEY"; }
first=$(book); second=$(book)
[ "$(tail -n1 <<<"$first")" = 201 ] || fail "the booking returned: $first"
[ "$(tail -n1 <<<"$second")" = 200 ] || fail "the retry returned: $second"
# The two answers list their fields in different orders, so compare the booking ids, not the text.
same=$(python3 -c "import json, sys; print(json.loads(sys.argv[1])['booking_id'] == json.loads(sys.argv[2])['booking_id'])" \
  "$(head -n1 <<<"$first")" "$(head -n1 <<<"$second")")
[ "$same" = True ] || fail "the retry got a different booking"

for _ in $(seq 1 20); do
  if curl -s "$WEB/api/me/notifications" -H "X-Swimmer-Id: $SWIMMER" | grep -q "is confirmed"; then
    echo "PASS: page, booking 201, retry 200 with the same booking, notice delivered"
    exit 0
  fi
  sleep 1
done
fail "no notice was delivered within 20 s"
