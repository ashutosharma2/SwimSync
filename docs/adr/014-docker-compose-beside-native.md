# ADR-014: Run SwimSync with Docker Compose, beside the native setup

- Status: Accepted
- Date: 2026-10-29

## Scenario

Running SwimSync locally means installing PostgreSQL 18 with Homebrew, a Python virtual environment and Node, then starting the API, the outbox worker and the frontend in three terminals ([README, local setup](../../README.md#local-setup)). Anyone who wants to try it, such as a reviewer or an interviewer, has to match that Mac setup first.

## Obstacle

- The project costs ₹0, so the containers run locally only. Nothing is pushed to a registry or deployed ([ADR-008](008-aws-designed-not-applied.md)).
- No secret may be committed, and that includes a database password.
- The native setup and the drills must keep working as they are. Drills A and B were measured on native processes, and their numbers shouldn't be mixed with runs in a different environment.
- The seed script creates "tomorrow" in the machine's local time zone, and containers run in UTC.

## Action

Ashu chose (2026-10-29) a compose file for running SwimSync, with the frontend built and served by nginx, a fresh seed on every start, and an image build in CI.

- One backend image ([backend/Dockerfile](../../backend/Dockerfile)) on `python:3.14.10-slim` runs the API, the outbox worker and the seed step with different commands, as an unprivileged user (uid 10001).
- The frontend image ([frontend/Dockerfile](../../frontend/Dockerfile)) builds the app on `node:26.13.0-alpine` and serves it from `nginx:1.31.8-alpine`. nginx forwards `/api/` to the API container, the same path the Vite dev server proxies, so the app's code is the same in both setups ([nginx.conf](../../frontend/nginx.conf)).
- [compose.yaml](../../compose.yaml) starts PostgreSQL 18.6 (the version the drills ran on), then the seed, then the API and the worker once the seed has finished, then the web container once the API is healthy.
- The database port isn't published, and PostgreSQL trusts connections from the compose network, so no database password exists anywhere. The operator token comes from the shell's `SWIMSYNC_OPERATOR_TOKEN`, and without it the operator endpoints refuse every request ([ADR-007](007-operator-shared-token.md)).
- Ports are bound to 127.0.0.1 and avoid the native setup and the drills: the web app is on 8088 and the API on 8002.
- The seed runs with `TZ` taken from `SWIMSYNC_TZ`, which defaults to `Asia/Kolkata`.
- [.dockerignore](../../.dockerignore) is an allowlist. Only `backend`, `scripts`, `db` and `frontend` (without `node_modules` and `dist`) reach a build.
- A CI job runs `docker compose build` on every push ([tests.yml](../../.github/workflows/tests.yml)).

Alternatives considered:

- **Keep the native setup only.** Nothing new to maintain, but every reader has to match a Mac with Homebrew first.
- **Vite's dev server in a container.** It has live reload, but it's a development tool, and file watching through Docker on a Mac can be slow.
- **Seed only when asked.** The data survives restarts, but the sessions are stale a day later.
- **Move the drills into compose as well.** `docker kill` would make a clean fault, but every drill would need fresh runs under different timing, so that's left for later.
- **Kubernetes.** A local cluster could run the same images, and a rolling update during bookings would make a good drill, but for one small app it's more than running SwimSync needs. If it comes, it'll be a later step and local only.

## Result

- Checked on 2026-10-29 with Docker Desktop (engine 29.8.2, Apple silicon): `docker compose up --build` brought all five services up. The seed exited with 0, and the API and the database reported healthy.
- Through the web container, the page and an unknown path both returned the app, and the browser showed the six sessions at 06:30, 07:00, 10:00 and so on. A booking returned 201, and its retry with the same key returned 200 with the same booking. The worker delivered the confirmation notice. An operator request got 403 without a token, and 200 with one set in the shell.
- A restart reseeds: the earlier booking was gone and Early lanes was back to 24 of 24 places.
- The backend image is 287 MB and the web image 93.6 MB. The backend image includes pytest and httpx, because `backend/requirements.txt` mixes app and test dependencies. Splitting them would make it smaller.
- Inside containers the API returns times in UTC (`+00:00`); natively it returns local time (`+05:30`). They are the same instants, and the browser shows local time either way.
- Docker Desktop is free for personal use and education (initial-research.md, 2026-10-21). Nothing runs on AWS, so the AWS cost doesn't change.
- Follow-up: the README doesn't describe the Docker setup yet.

## Troubleshooting

- **Session times would have been five and a half hours out.** While planning the seed step, it turned out that `seed.py` makes "tomorrow at 06:30" in the machine's local time zone. Containers run in UTC, so the browser in India would have shown 12:00. The seed container now gets `TZ` from `SWIMSYNC_TZ`, and a check that the slim image has time-zone data printed `+05:30` for `Asia/Kolkata`.
