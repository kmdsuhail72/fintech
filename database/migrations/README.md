# PostgreSQL migrations

Migration files are numbered, append-only SQL changes. Apply each migration once, in order, using the team's selected migration runner and its migration-history/locking mechanism. Run schema changes through CI against a disposable PostgreSQL instance before merge.

`001_initial_schema.sql` is a baseline migration and must be applied to an empty database. It uses PostgreSQL transactions and `pgcrypto` for UUID generation. `002_authentication.sql` adds one-time email/password tokens and refresh-token rotation history; apply it after `001`. `003_api_rbac.sql` adds database-backed roles, assigns the baseline `user` role to existing accounts, and installs a trigger that assigns that role to every subsequently inserted user; apply it after `002`. `004_simulated_market_symbols.sql` adds the initial simulated market instruments and quote snapshots without overwriting existing provider assignments; apply it after `003`. `005_market_quote_snapshots.sql` adds OHLC, previous close, change, and volume fields to quote observations; apply it after `004`. Run the files using a PostgreSQL-aware migration runner or `psql -v ON_ERROR_STOP=1 -f <migration-file>`; production should use a migration runner that records applied versions and prevents concurrent deploys.

Do not edit a migration after it has been applied to any shared environment. Add a new numbered migration. For destructive or large-table changes, use an expand-and-contract rollout: add compatible structures, deploy code that supports both forms, backfill in bounded batches, switch reads/writes, then remove obsolete structures in a later release.

Rollback strategy is forward-fix by default. Test restore from encrypted point-in-time backups before production releases; do not rely on reversing financial ledger migrations by deleting data.

Seed records in `database/seeds/001_demo_data.sql` are synthetic and idempotent for local/demo use only. The demo account password hash is intentionally unusable. Never enable a demo identity in a publicly reachable environment.

Docker API startup runs `scripts/migrate.mjs` before starting the service. The runner uses a database advisory lock, per-migration transactions, and normalized-content checksums recorded in `schema_migrations`. Existing untracked databases require an explicit, verified baseline; see the [Docker migration guide](../../docs/docker.md). Outside Docker, `npm run db:migrate` reads the root `.env` and applies pending tracked migrations. Keep migrations append-only.

`006_push_devices.sql` adds the mobile session-scoped Expo push device registry. Apply it before enabling mobile notification enrollment.

`007_research_documents.sql` requires pgvector and adds owner-scoped research documents and 1,536-dimensional chunk embeddings. Apply after `006`, before using document RAG. The migration role must be allowed to install the `vector` extension. Docker Compose uses the pgvector PostgreSQL 16 image; existing databases still require the numbered migration to be applied explicitly. See the AI service's [RAG setup](../../apps/ai-service/RAG.md).

`008_price_alert_engine.sql` adds price/percentage alert rules, channel preferences, matching indexes, and a leased notification outbox. Apply before enabling alert workers. See [price alert setup and architecture](../../docs/price-alerts.md).
