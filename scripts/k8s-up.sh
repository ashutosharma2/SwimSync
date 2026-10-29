#!/usr/bin/env bash
# SwimSync on a local Kubernetes cluster (kind). Nothing leaves this machine: the images are built
# here and copied into the cluster with kind load, never pushed to a registry.
#
# Start (or update):  scripts/k8s-up.sh        then open http://127.0.0.1:8089
# Remove everything:  kind delete cluster --name swimsync
#
# Optional settings, read from your shell:
#   SWIMSYNC_TZ               time zone for the seeded sessions (default Asia/Kolkata)
#   SWIMSYNC_OPERATOR_TOKEN   enables the operator endpoints; without it they refuse every request
#
# Every start reseeds the database, so the sessions are always for tomorrow.
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER=swimsync
NS=swimsync
# Always name the kind context, so this script can never act on another cluster in your kubeconfig.
K=(kubectl --context "kind-$CLUSTER")

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  kind create cluster --config k8s/kind-cluster.yaml
fi

echo "Building the images and copying them into the cluster..."
docker compose build
docker image inspect postgres:18.6 >/dev/null 2>&1 || docker pull postgres:18.6
# Save each image for this machine's platform only, then load the archive. Docker Desktop keeps
# images as multi-platform indexes with only the local platform's layers on disk, and
# "kind load docker-image" fails on the platforms that aren't there.
platform=$(docker version -f '{{.Server.Os}}/{{.Server.Arch}}')
archive=$(mktemp -t swimsync-image.XXXXXX)
trap 'rm -f "$archive"' EXIT
for image in swimsync-backend:latest swimsync-web:latest postgres:18.6; do
  docker save --platform "$platform" -o "$archive" "$image"
  kind load image-archive --name "$CLUSTER" "$archive"
done

"${K[@]}" apply -f k8s/namespace.yaml
"${K[@]}" -n "$NS" create configmap settings --from-literal=TZ="${SWIMSYNC_TZ:-Asia/Kolkata}" \
  --dry-run=client -o yaml | "${K[@]}" apply -f -
if [ -n "${SWIMSYNC_OPERATOR_TOKEN:-}" ]; then
  "${K[@]}" -n "$NS" create secret generic operator --from-literal=token="$SWIMSYNC_OPERATOR_TOKEN" \
    --dry-run=client -o yaml | "${K[@]}" apply -f -
else
  "${K[@]}" -n "$NS" delete secret operator --ignore-not-found >/dev/null
fi

echo "Starting PostgreSQL and reseeding..."
"${K[@]}" apply -f k8s/db.yaml
"${K[@]}" -n "$NS" rollout status deployment/db --timeout=180s
"${K[@]}" -n "$NS" delete job seed --ignore-not-found >/dev/null # a Job runs once, so replace it
"${K[@]}" apply -f k8s/seed.yaml
"${K[@]}" -n "$NS" wait --for=condition=complete job/seed --timeout=180s

echo "Starting the API, the worker and the web frontend..."
existed=$("${K[@]}" -n "$NS" get deployment api --ignore-not-found -o name)
"${K[@]}" apply -f k8s/app.yaml
if [ -n "$existed" ]; then
  # Same image tag as before, so restart the pods to pick up a rebuild or a changed token.
  "${K[@]}" -n "$NS" rollout restart deployment/api deployment/worker deployment/web
fi
for d in api worker web; do
  "${K[@]}" -n "$NS" rollout status "deployment/$d" --timeout=180s
done

# Ready pods aren't reachable straight away: the Service starts routing to them a moment later. In
# CI a booking sent 0.25 s after the rollout finished got a 502. Wait until the API answers through
# the web frontend, the way a browser reaches it.
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8089/api/health)" = 200 ]; then
    echo "SwimSync is up: http://127.0.0.1:8089"
    exit 0
  fi
  sleep 1
done
echo "The pods are running, but the API didn't answer through http://127.0.0.1:8089 within 60 s." >&2
exit 1
