# ADR-015: Run SwimSync on a local Kubernetes cluster with kind

- Status: Accepted
- Date: 2026-10-29

## Scenario

SwimSync's guarantees were tested against failures made by hand: drill A killed an app instance behind HAProxy, and drill B broke the database connection with Toxiproxy ([ADR-011](011-local-fault-drills.md)). Kubernetes produces similar events as part of normal running. It deletes and replaces pods, moves traffic between replicas, and swaps versions during a rolling update while requests are in flight. Running SwimSync on Kubernetes shows whether the guarantees hold under those events, and it's practice with a platform used in cloud and DevOps work.

## Obstacle

- Scale isn't the reason: one pool's bookings fit on one small server, so the case for Kubernetes here is testing and learning, and it has to be argued that way.
- A managed cluster on AWS (EKS) bills by the hour for the cluster, plus its nodes; check the EKS pricing page for the current rate. The project costs ₹0 ([ADR-008](008-aws-designed-not-applied.md)).
- There's no image registry, and pushing to one would put images somewhere outside this machine.
- Docker's virtual machine on the Mac has 3.8 GiB of memory, shared with everything else running in Docker.

## Action

Ashu chose (2026-10-29) to install kind 0.33.0 with Homebrew (it's free, under the Apache 2.0 licence), run a one-node cluster, add a smoke test in CI, and document it in the README.

- [k8s/kind-cluster.yaml](../../k8s/kind-cluster.yaml) creates a one-node cluster named `swimsync` and publishes the web Service's node port on 127.0.0.1:8089, clear of every port the other setups use.
- The manifests run the same two images that Docker Compose builds ([ADR-014](014-docker-compose-beside-native.md)):
  - [db.yaml](../../k8s/db.yaml): PostgreSQL 18.6 with data in the pod, behind a ClusterIP Service, trusting connections, so no password exists.
  - [seed.yaml](../../k8s/seed.yaml): a Job that reseeds, with the time zone from a ConfigMap.
  - [app.yaml](../../k8s/app.yaml): the API with two replicas (like drill A's two instances), the outbox worker, and the web frontend behind a NodePort Service, using the same nginx config as compose. The API's readiness and liveness probes use `/health`, which deliberately doesn't check the database, so a database outage doesn't pull every pod out of the Service at once. Each pod reports its own name in `X-Instance`.
- [scripts/k8s-up.sh](../../scripts/k8s-up.sh) creates the cluster if needed, builds the images with compose and copies them into the cluster, so nothing is pushed to a registry. It then starts PostgreSQL, runs the seed Job, starts the rest and waits until everything is ready. It creates the operator token as a Secret from the shell's `SWIMSYNC_OPERATOR_TOKEN`, and never writes it to a file. Every `kubectl` call names the `kind-swimsync` context, so the script can't act on another cluster in the kubeconfig.
- [scripts/k8s-smoke.sh](../../scripts/k8s-smoke.sh) checks it end to end, and CI runs both scripts on a throwaway cluster on every push ([tests.yml](../../.github/workflows/tests.yml)). CI downloads kind 0.33.0 and checks it against the published checksum.

Alternatives considered:

- **minikube or k3d.** Either would work. kind runs each node as a Docker container, needs nothing beyond Docker, and runs the same way in CI.
- **Docker Desktop's built-in Kubernetes.** No extra install, but it only exists inside Docker Desktop, so CI couldn't run the same cluster.
- **A Helm chart.** Templating that SwimSync's five workloads don't need yet. Plain manifests are easier to read and to explain.
- **A StatefulSet with a persistent volume for PostgreSQL.** The right shape for data that must survive, but every start reseeds anyway, so the data can live in the pod.
- **EKS.** The real managed service, but it bills by the hour, so at most it stays a design.

## Result

- Checked on 2026-10-29 with kind 0.33.0 (Kubernetes v1.37.0) on Docker Desktop: the script brought everything up, and the smoke test passed. The page loaded, a booking returned 201, its retry with the same key returned 200 with the same booking, and the worker delivered the notice. Twelve requests were answered by both API pods (7 and 5). An operator request without a token got 403, and the first session showed at 06:30 local time.
- **Deleting a pod during bookings** (a demonstration, not a recorded drill): 40 swimmers booked Morning lane swim (20 places) over about 8 seconds, and one API pod was deleted partway through. Every request got an answer with no retries: 20 confirmed and 20 told the session was full. Afterwards the counter was 20, there were 20 confirmed rows, no swimmer had two bookings, and Kubernetes had already replaced the deleted pod.
- A rolling restart of the API and web pods, with about 12 requests a second through nginx for 25 s, answered all 291 with 200 once the pods had a 5 s `preStop` pause (see Troubleshooting).
- That deletion was graceful. Kubernetes stopped sending the pod traffic and let it finish its requests, which is why nothing failed. A forced kill seemed closer to drill A's `kill -9`. Drill C later showed it isn't (below).
- Trade-offs: the images keep the `latest` tag with `imagePullPolicy: Never`, so the script restarts the deployments to pick up a rebuild. The database's data is lost whenever its pod restarts. No NetworkPolicy is set, so the trust rule relies on the database being reachable only from inside the cluster.
- Nothing runs on AWS, so the AWS cost doesn't change.
- Drill C, 2026-10-30 ([drill 03](../../drills/03-rolling-update.md)): a rolling restart under booking load had no failed attempts in 3,872 operations, and three forced kills kept every hard limit. A force delete still gets the preStop hook, SIGTERM and 2 s before SIGKILL on this cluster. Two kills had no failures around the fault, and one had a 9 s outage that's only partly explained.

## Troubleshooting

- **The images wouldn't load into the cluster.** The first run of the script failed at `kind load docker-image` with `ctr: content digest sha256:f4b419e3...: not found`. Docker Desktop keeps each image as a multi-platform index with only this Mac's platform on disk, and kind imports every platform the index lists. The fix saves each image for the local platform only (`docker save --platform`) and loads that archive with `kind load image-archive`. All three images then loaded.
- **Lesson:** a multi-platform image in Docker Desktop may have only one platform's layers on disk, so export the platform you need rather than the whole index.
- **A rolling restart refused a booking.** Rerunning the script on the existing cluster restarts the deployments, and the smoke test straight afterwards got `502 Bad Gateway`. nginx's log showed `connect() failed (111: Connection refused)` to the API Service. When its pod is told to stop, the API refuses new connections at once, but the cluster keeps routing new connections to it for a moment while the change spreads. The fix is a 5 s `preStop` pause on the API and web pods, so they keep answering until traffic has moved. During a rolling restart of both, with about 12 requests a second through nginx for 25 s, all 291 got 200 with the pause; without it, 4 of 308 got 502 and 2 timed out. In the app a 502 counts as an uncertain answer, so the booking flow would have retried with the same key ([ADR-005](005-no-answer-without-evidence.md)), but the pause removes the error instead of relying on the retry.
- **Lesson:** a pod that's stopping still gets traffic for a moment, so it needs time to drain before it closes.
- **CI's first run got a 502 on a brand-new cluster.** The smoke test sent its first booking 0.25 s after the API's rollout finished, and nginx answered 502. Most likely the Service hadn't started routing to the new pods yet: a pod that's ready isn't reachable at the same instant. The deploy script now waits until the API answers through the web frontend before it says SwimSync is up.
- **Lesson:** a rollout that reports success means the pods are ready, not that traffic reaches them yet.
