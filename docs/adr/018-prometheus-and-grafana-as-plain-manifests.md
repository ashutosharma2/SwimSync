# ADR-018: Monitor the kind cluster with Prometheus and Grafana as plain manifests

- Status: Accepted
- Date: 2026-11-10

## Scenario

Drills A and C each left something unexplained: every swimmer timing out at once before the fault, and a 9 s outage in drill C's second kill ([drill 03](../../drills/03-rolling-update.md)). The evidence for those runs came from the client's own record, pod events and log lines collected afterwards. Nothing showed the API, the database and the pods side by side while it was happening. Drill B's dead worker had the same problem: it only showed up when someone counted the outbox rows ([ADR-003](003-notification-outbox.md)).

Ashu asked (2026-11-10) for Prometheus and Grafana on the local kind cluster, with dashboards for four things: the database during a stall, the outbox backlog, the API per pod, and the pods during drill C. Ashu chose to have the API serve its own metrics, and to install the monitoring with the kube-prometheus-stack Helm chart.

## Obstacle

- Everything has to cost ₹0, so no hosted monitoring and no paid alert delivery.
- The cluster runs inside Docker's virtual machine, which has 3.8 GiB of this Mac's 8 GB and its 8 cores, shared with SwimSync and the cluster's own control plane ([ADR-015](015-local-kubernetes-with-kind.md)).
- nginx forwards everything under `/api/` to the API's port 8000 ([frontend/nginx.conf](../../frontend/nginx.conf)). A `/metrics` route on that port would be readable by anyone who can reach the site.
- The outbox worker can't report its own backlog: in drill B it was the worker that died.
- postgres_exporter can run custom SQL, but in v0.20.1 its `--help` marks `--extend.query-path` as deprecated.

## Action

**What SwimSync reports**

- [backend/app/metrics.py](../../backend/app/metrics.py), with prometheus-client 0.26.0:
  - a histogram of answer times by method, route pattern and status. It uses the route pattern, never the raw path, so session ids don't make a new series each. Its bucket edges include 0.5 s (the database's statement and lock timeout) and 2 s (the client's timeout);
  - a gauge of requests in progress;
  - a counter of what each booking and cancel was told: booked, replayed (a retry that got the stored answer, [ADR-002](002-idempotency-keys.md)), refused, not found, key reused, and the two 503s by name ([ADR-004](004-two-kinds-of-503.md)).
- The metrics are served on a port of their own, 9000, started by the app's lifespan hook when `SWIMSYNC_METRICS_PORT` is set. Neither the Service nor nginx ever sends traffic there. `/metrics` on port 8000 answers 404; a test checks that, and so does the kind smoke test, through nginx.
- [backend/app/db_metrics.py](../../backend/app/db_metrics.py) reads PostgreSQL each time Prometheus asks: outbox rows by status, the age of the oldest pending notice, and sessions waiting for a lock. It runs as its own small Deployment, `db-metrics`, apart from the worker. If it can't read the database it reports `swimsync_db_reachable 0` and leaves the other numbers out rather than repeating old ones.
- Both db-metrics and the PostgreSQL exporter connect as `monitor`, a role that can read the statistics views (`pg_monitor`) and the tables, and can't write. [k8s/db.yaml](../../k8s/db.yaml) creates it when the database is first initialised.

**What runs the monitoring.** Everything is in [k8s/monitoring/](../../k8s/monitoring/), applied by [scripts/monitoring-up.sh](../../scripts/monitoring-up.sh) with `kubectl apply -k`:

- Prometheus v3.16.0 as one Deployment. Its scrape config ([prometheus.yml](../../k8s/monitoring/prometheus.yml)) finds pods by label and keeps:
  - the API and db-metrics every 5 s, since a drill's fault lasts seconds;
  - kube-state-metrics every 5 s;
  - the PostgreSQL exporter every 15 s, because each of its scrapes runs about a dozen queries against the database under test;
  - two cAdvisor metrics from the kubelet every 30 s.

  It may list nodes and read the kubelet's metrics, and find pods in the two namespaces it scrapes, nothing else. Data lives in the pod for at most two days.
- Grafana 13.3.0 with one data source and the SwimSync dashboard ([dashboards/swimsync.json](../../k8s/monitoring/dashboards/swimsync.json)): 22 panels in four rows, API per pod, outbox, database and pods. Editing it in Grafana is refused, so the committed JSON stays the source.
- kube-state-metrics v2.20.0, limited to pods and deployments in the `swimsync` namespace and to the five metrics the dashboard and alerts read.
- postgres_exporter v0.20.1 with its checkpoint collector turned on, since PostgreSQL 17 moved checkpoints to `pg_stat_checkpointer`.
- Two alert rules ([alerts.yml](../../k8s/monitoring/alerts.yml)):
  - **SwimSyncOutboxBacklog:** the oldest pending notice is over 60 s old. A working worker settles every notice within about 15 s, even when every delivery fails, because it gives up after five tries.
  - **SwimSyncNoReadyApi:** no API pod available for 10 s.
- Kustomize builds each ConfigMap from its file and puts a hash of the contents in its name, so changing `prometheus.yml` restarts Prometheus and an unchanged file doesn't.
- The script checks the config and rules with `promtool` first. CI runs the same checks and builds the manifests, but doesn't install the monitoring.
- Grafana's admin password is generated into a Secret on the first run. Grafana and Prometheus are reached with `kubectl port-forward`, on 127.0.0.1 only.

Alternatives considered:

- **kube-prometheus-stack (Helm), Ashu's first choice.** Installed and measured on 2026-11-10, and it overloaded the cluster (see Troubleshooting). After seeing the numbers, Ashu chose plain manifests.
- **The same chart with most of it switched off.** It would keep the Helm workflow, but the operator and its CRDs stay, and it wasn't measured.
- **`/metrics` on port 8000, blocked in nginx.** One port fewer, but the metrics would stay public if the nginx rule were ever lost. A separate port isn't routed at all.
- **The outbox numbers from the worker.** Simpler, but a dead worker reports nothing, which is exactly drill B's failure.
- **postgres_exporter custom queries.** Deprecated in the version used, so the outbox and lock-wait queries are SwimSync's own, with tests.
- **Alertmanager.** It sends alerts somewhere, and at ₹0 there's nowhere to send them. Firing alerts show in Prometheus.

## Result

Checked on 2026-11-10 on the kind cluster:

- **Targets and rules:** all six scrape targets were up, and both rules loaded without errors.
- **Grafana:** it provisioned the dashboard from the file, and its data source check said "Successfully queried the Prometheus API".
- **Counters against the client:** 60 s of drill A's load through nginx made 3,809 attempts. The API's counters matched the client's record exactly: 1,144 booked, 1,595 refused, 1,070 cancelled, plus the one booking and one replay from the smoke test. Each pod's request count matched the client's count of answers from it, give or take the smoke test's few requests.
- **The outbox alert:** with the worker scaled to zero, three bookings left three pending notices. SwimSyncOutboxBacklog fired 70 s later, when the oldest was 69.8 s old. The 60 s threshold, plus up to 5 s each for the scrape, the rule check and the test's own polling, accounts for the difference. 18 s after the worker was back, all three were delivered and the alert had cleared.
- **Size:** Prometheus held 1,071 series, against 48,642 under the Helm chart. Memory was about 94 MiB for Prometheus, 431 MiB for Grafana, and 17 MiB and 15 MiB for kube-state-metrics and the PostgreSQL exporter. A later reading of all of it, db-metrics included, came to 506 MiB.
- **Stability:** for three minutes after the install, both API pods stayed ready with no restarts, `/health` answered 200 in under 23 ms, and the node's load average fell from 7.8 to 2.7.
- **Backend tests:** 60 passed, 8 of them new.

The cost to SwimSync isn't settled. The same 60 s load was run six times:

| Monitoring | Attempts | Failed | p50 | p95 | p99 |
|---|---|---|---|---|---|
| On, about 10 minutes after the install | 3,809 | 0 | 12.4 ms | 67.9 ms | 284.9 ms |
| Off | 4,708 | 0 | 10.4 ms | 48.7 ms | 246.2 ms |
| On, 1 minute after it restarted | 2,520 | 168 | 54.7 ms | 1,390.8 ms | 1,865.1 ms |
| On, about 5 minutes after it restarted | 1,899 | 662 | 13.3 ms | 1,083.3 ms | 1,430.4 ms |
| Grafana off, the rest on | 3,924 | 101 | 17.6 ms | 257.8 ms | 1,320.3 ms |
| Off again | 4,020 | 15 | 20.0 ms | 499.1 ms | 1,209.9 ms |

- **The failures:** they were client timeouts and `database_unavailable` answers. During the fourth run, both API pods failed their liveness probes and were restarted.
- **Why they can't be pinned on the monitoring:** the last run, with all of it off, had 15 failures. Meanwhile the Mac itself had 6.17 GB of swap in use and `kernel_task` at 96% CPU. Inside the virtual machine, a task was waiting for CPU about 30% of the time.
- **What that means:** on this machine the monitoring's overhead couldn't be told apart from the host's own noise. It may also matter for the stalls in drills A and C, which ran on the same Mac. That's inferred, not shown.
- **The rule for drills:** before comparing drill runs, check the host. Run the drill with and without monitoring, and compare those two runs.

Residual risks:

- Prometheus doesn't scrape the Kubernetes API server or etcd, so their CPU and memory aren't on the dashboard.
- A stall shorter than 5 s can fall between two scrapes.
- Prometheus's data is lost whenever its pod restarts.
- Prometheus doesn't verify the kubelet's certificate. kind's kubelet serves a self-signed one, so its identity isn't checked; Prometheus still authenticates to the kubelet with its token.
- The `monitor` role can read every SwimSync table, swimmer ids included, not only the outbox.
- Grafana is the heaviest piece, at about 430 MiB.

Nothing runs on AWS, and every part is open source: Prometheus, kube-state-metrics and postgres_exporter under Apache 2.0, prometheus-client under Apache 2.0 and BSD 2-clause, and Grafana under AGPL 3.0 (checked on GitHub and PyPI, 2026-11-10).

## Troubleshooting

- **The newest chart's operator wouldn't start.** kube-prometheus-stack 93.1.1 left the operator pod in `ImagePullBackOff` with "no match for platform in manifest". `docker buildx imagetools inspect` showed every image in the v0.95.1 release labelled `linux/amd64`, and this Mac is ARM. Release v0.94.2 (chart 92.22.0) has `linux/arm64` images, and it started.
- **Lesson:** a multi-platform tag can still be missing your platform, so check the manifest before pinning a version.
- **Grafana never started under a 400Mi limit.** That limit went into the chart's values without anything being measured. The chart set `GOMEMLIMIT=360MiB` from it, and Grafana 13.3 ran at about 700% CPU without ever listening, until the liveness probe restarted it. With 768Mi it was ready in under a minute. The chart's link between the limit and Go's memory target makes a too-small limit a likely cause, but Grafana used 297 MiB once running, so that isn't proven.
- **Lesson:** a memory limit can also change how a Go program runs, not only when it's killed.
- **The full chart overloaded the cluster.**
  - **Measured:** the Kubernetes API server rose to 728 to 877 MiB, Grafana with its sidecars to 485 MiB, and Prometheus to 251 MiB. Of Prometheus's 48,642 series, 38,132 came from scraping the API server.
  - **What it did to SwimSync:** both API pods failed liveness probes and were restarted six times, `/api/health` returned 502, and the database's readiness check timed out.
  - **What it did to the cluster:** the API server, controller-manager and scheduler restarted. The operator, kube-state-metrics and node-exporter crash-looped. The node peaked near 1,270% CPU with a load average of 53.
  - **One attempt that didn't fix it:** turning off the API server scrape and its rules. The overload went on, and the next upgrade, to also turn off `KubeAPIDown` (which fires when that scrape is missing), failed because the API server didn't answer.
  - **What did:** removing the chart, its CRDs and its namespace. Two minutes later the load average was 2.7 and `/health` answered 200.
- **Lesson:** measure what the monitoring costs on the machine it runs on. A monitor that causes stalls can't be used to explain them.
- **promtool rejected a valid config.** `promtool check config` failed because the service account token file only exists inside a pod. `--syntax-only` skips files the config refers to, and it still rejected a deliberately broken config.
- **The load was counted twice.** At first the API's counters came to exactly half of the count taken from the client's record. The record writes two lines per operation, an `attempt` and a `final`, and both had been counted. Counting only `attempt` lines gave an exact match.
- **Lesson:** read how a record is written before counting it.
- **The first alert check could never fire.** By then the load runs had filled every session, so the three test bookings were refused, and a refused booking queues no notice. The database was reseeded and the check run again.
