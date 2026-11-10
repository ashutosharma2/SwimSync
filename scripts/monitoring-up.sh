#!/usr/bin/env bash
# Prometheus and Grafana on the local kind cluster, watching SwimSync. Run scripts/k8s-up.sh first.
# Plain manifests in k8s/monitoring/, applied with kubectl apply -k: no Helm and no operator
# (ADR-018).
# Nothing is exposed outside this machine: Grafana and Prometheus are reached through
# kubectl port-forward, which listens on 127.0.0.1 only.
#
# Start (or update):  scripts/monitoring-up.sh
# Remove the monitoring and keep SwimSync:  kubectl --context kind-swimsync delete -k k8s/monitoring
# Remove everything:  kind delete cluster --name swimsync
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER=swimsync
# Always name the kind context, so this script can never act on another cluster in your kubeconfig.
K=(kubectl --context "kind-$CLUSTER")
PROMETHEUS_IMAGE=quay.io/prometheus/prometheus:v3.16.0 # the same version as k8s/monitoring/prometheus.yaml

if ! "${K[@]}" get namespace swimsync >/dev/null 2>&1; then
  echo "SwimSync isn't on the cluster yet: run scripts/k8s-up.sh first." >&2
  exit 1
fi

# Check the Prometheus config and rules before they reach the cluster, with the promtool that comes
# in the Prometheus image. --syntax-only skips files that only exist inside the pod, such as its
# service account token.
promtool() { docker run --rm --entrypoint promtool -v "$PWD/k8s/monitoring:/m:ro" "$PROMETHEUS_IMAGE" "$@"; }
promtool check config --syntax-only /m/prometheus.yml >/dev/null
promtool check rules /m/alerts.yml >/dev/null

"${K[@]}" create namespace monitoring --dry-run=client -o yaml | "${K[@]}" apply -f - >/dev/null

# Grafana's admin password: generated on the first run and kept in a Secret, never in the repository.
new_password=""
if ! "${K[@]}" -n monitoring get secret grafana-admin >/dev/null 2>&1; then
  new_password=$(openssl rand -base64 18)
  "${K[@]}" -n monitoring create secret generic grafana-admin \
    --from-literal=admin-user=admin --from-literal=admin-password="$new_password" >/dev/null
fi

existed=$("${K[@]}" -n swimsync get deployment db-metrics --ignore-not-found -o name)
"${K[@]}" apply -k k8s/monitoring >/dev/null
if [ -n "$existed" ]; then
  # db-metrics keeps the backend image's latest tag, so restart it to pick up a rebuild by
  # scripts/k8s-up.sh. Prometheus and Grafana restart by themselves when their config changes
  # (k8s/monitoring/kustomization.yaml).
  "${K[@]}" -n swimsync rollout restart deployment/db-metrics >/dev/null
fi

echo "Waiting for the monitoring to be ready..."
for d in prometheus grafana kube-state-metrics postgres-exporter; do
  "${K[@]}" -n monitoring rollout status "deployment/$d" --timeout=300s >/dev/null
done
"${K[@]}" -n swimsync rollout status deployment/db-metrics --timeout=120s >/dev/null

cat <<EOF

Monitoring is up. Each of these runs until you stop it with Ctrl-C:

  Grafana     ${K[*]} -n monitoring port-forward svc/grafana 3000
              then http://127.0.0.1:3000, dashboard "SwimSync", user admin
  Prometheus  ${K[*]} -n monitoring port-forward svc/prometheus 9090
              then http://127.0.0.1:9090 (Status > Target health, and Alerts)

EOF
if [ -n "$new_password" ]; then
  echo "Grafana's admin password, shown this once: $new_password"
else
  echo "Grafana's admin password: ${K[*]} -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d"
fi
