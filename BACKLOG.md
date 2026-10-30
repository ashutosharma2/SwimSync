# Backlog (ideas parked so they don't hijack a session)

<!-- - [ ] One idea per line. Tick it when done. -->

- [ ] Run drill C, the rolling update and the forced pod kill, once the prediction is written ([drills/03](drills/03-rolling-update.md)).
- [ ] Clean up old idempotency keys. The table grows by one row per booking request and nothing deletes them ([ADR-002](docs/adr/002-idempotency-keys.md)).
- [ ] Have the app read the database password from the RDS-managed secret at start-up; today it only takes `DATABASE_URL` ([ADR-010](docs/adr/010-rds-managed-secret.md)).
- [ ] Split the test dependencies out of `backend/requirements.txt`, so the backend image doesn't carry pytest and httpx ([ADR-014](docs/adr/014-docker-compose-beside-native.md)).
- [ ] Add a NetworkPolicy so only the app's pods can reach the database in the kind cluster ([ADR-015](docs/adr/015-local-kubernetes-with-kind.md)).
- [ ] Watch the outbox: flag it when pending notices build up, since drill B's dead worker only showed in the numbers ([ADR-003](docs/adr/003-notification-outbox.md)).
- [ ] Replace the shared operator token with real operator sign-in, so the audit log names a person ([ADR-007](docs/adr/007-operator-shared-token.md)).
- [ ] HTTPS, which needs a domain and a certificate, so it waits for a real deployment.
- [ ] A waitlist for full sessions (deferred from the MVP).
