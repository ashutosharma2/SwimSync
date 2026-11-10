# Backlog (ideas parked so they don't hijack a session)

<!-- - [ ] One idea per line. Tick it when done. -->

- [x] Run drill C, the rolling update and the forced pod kill, once the prediction is written ([drills/03](drills/03-rolling-update.md)).
- [ ] Find what stalls the database: every swimmer timing out at once before the fault in drill A and drill C, and the 9 s outage in drill C's second kill. Turn on `log_lock_waits` and sample `pg_stat_activity` during the runs ([drills/03](drills/03-rolling-update.md)).
- [ ] Measure what the monitoring costs a drill on a quiet Mac: the same load with it on and off, several times each. On 2026-11-10 the Mac's own load hid the difference ([ADR-018](docs/adr/018-prometheus-and-grafana-as-plain-manifests.md)).
- [ ] Check whether the Mac's load explains the stalls in drills A and C: record swap and CPU pressure, on the Mac and inside Docker's VM, during each run ([ADR-018](docs/adr/018-prometheus-and-grafana-as-plain-manifests.md)).
- [ ] Clean up old idempotency keys. The table grows by one row per booking request and nothing deletes them ([ADR-002](docs/adr/002-idempotency-keys.md)).
- [ ] Have the app read the database password from the RDS-managed secret at start-up; today it only takes `DATABASE_URL` ([ADR-010](docs/adr/010-rds-managed-secret.md)).
- [ ] Split the test dependencies out of `backend/requirements.txt`, so the backend image doesn't carry pytest and httpx ([ADR-014](docs/adr/014-docker-compose-beside-native.md)).
- [ ] Add a NetworkPolicy so only the app's pods can reach the database in the kind cluster ([ADR-015](docs/adr/015-local-kubernetes-with-kind.md)).
- [x] Watch the outbox: flag it when pending notices build up, since drill B's dead worker only showed in the numbers ([ADR-003](docs/adr/003-notification-outbox.md)). Done with the `SwimSyncOutboxBacklog` alert ([ADR-018](docs/adr/018-prometheus-and-grafana-as-plain-manifests.md)).
- [ ] Replace the shared operator token with real operator sign-in, so the audit log names a person ([ADR-007](docs/adr/007-operator-shared-token.md)).
- [ ] Have the operator change log name the swimmers affected, not only booking ids. The audit endpoint would have to return them ([ADR-017](docs/adr/017-operator-token-in-session-storage.md)).
- [ ] A drill for an operator change during a database outage, so the screen's "not confirmed" path is tested against a real lost reply; only unit tests cover it today.
- [ ] HTTPS, which needs a domain and a certificate, so it waits for a real deployment.
- [ ] A waitlist for full sessions (deferred from the MVP).
