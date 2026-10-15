# Data Architecture & Persistence Layer

Asteriq AI's planned persistence layer uses PostgreSQL for 20 relational entities covering identity, simulated accounts, trading records, market observations, and AI/news metadata. The repository uses the Node.js `pg` driver directly; SQL migrations in `database/migrations` define the intended schema and are not yet executed automatically by the API.

## Database Configuration

| Service/Module | DB Type        | Profile           | Driver       | Connection                          | Migration Tool                                          |
| -------------- | -------------- | ----------------- | ------------ | ----------------------------------- | ------------------------------------------------------- |
| API            | PostgreSQL     | Local development | Node `pg`    | `DATABASE_URL` environment variable | Numbered SQL migration; API does not yet run migrations |
| API            | Redis          | Local development | Node `redis` | `REDIS_URL` environment variable    | Not applicable                                          |
| AI service     | None currently | All               | None         | No database connection implemented  | Not applicable                                          |

The root environment template provides a local PostgreSQL and Redis connection. No production profile, pool sizing, ORM, or migration runner is configured in the current application. The database design and exact connection/migration guidance are documented in [database-design.md](../../../../docs/database-design.md).

## Data Ownership per Service

| Service              | Tables Owned                                              | ORM Framework            | Caching                                                | Notes                                                         |
| -------------------- | --------------------------------------------------------- | ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------- |
| Identity             | `users`, `user_profiles`, `sessions`                      | None; planned direct SQL | Redis connection exists; session cache not implemented | Password/session handling is not implemented                  |
| Paper trading        | `accounts`, `wallets`, `orders`, `trades`, `transactions` | None; planned direct SQL | Redis connection exists; no business cache implemented | Paper-only. Transactions are the virtual cash ledger          |
| Portfolio            | `portfolios`, `positions`                                 | None; planned direct SQL | Not implemented                                        | Position records are projections derived from simulated fills |
| Market data          | `symbols`, `market_quotes`                                | None; planned direct SQL | Redis connection exists; quote cache not implemented   | Quote state must distinguish simulated/delayed/realtime/stale |
| Discovery and alerts | `watchlists`, `watchlist_items`, `price_alerts`           | None; planned direct SQL | Not implemented                                        | User-owned preferences                                        |
| Notifications        | `notifications`                                           | None; planned direct SQL | Not implemented                                        | Delivery workers are not implemented                          |
| Research and news    | `ai_research`, `news_articles`, `news_sentiment`          | None; planned direct SQL | Not implemented                                        | AI service currently exposes health checks only               |
| Platform security    | `audit_logs`                                              | None; planned direct SQL | Not applicable                                         | Audit writes and access controls are not yet wired            |

## Entity Model

<!-- mermaid-checked: every attribute is `<type> <name> [<key>] ["<description>"]` with at most one of PK/FK/UK, no \n in descriptions, no {} in descriptions, every relationship label is double-quoted -->

```mermaid
erDiagram
    users ||--o| user_profiles : "has profile"
    users ||--o{ accounts : "owns"
    users ||--o{ watchlists : "owns"
    users ||--o{ price_alerts : "creates"
    users ||--o{ notifications : "receives"
    users ||--o{ ai_research : "requests"
    users ||--o{ sessions : "opens"
    users o|--o{ audit_logs : "acts"
    accounts ||--o{ wallets : "has"
    accounts ||--o{ portfolios : "contains"
    accounts ||--o{ orders : "submits"
    accounts ||--o{ transactions : "owns"
    portfolios ||--o{ orders : "receives"
    portfolios ||--o{ positions : "tracks"
    symbols ||--o{ market_quotes : "has history"
    symbols ||--o{ watchlist_items : "listed"
    watchlists ||--o{ watchlist_items : "contains"
    symbols ||--o{ orders : "ordered"
    orders ||--o{ trades : "fills"
    symbols ||--o{ trades : "traded"
    wallets ||--o{ transactions : "records"
    orders o|--o{ transactions : "accounts for"
    trades o|--o{ transactions : "settles"
    symbols ||--o{ positions : "held"
    symbols ||--o{ price_alerts : "monitored"
    news_articles ||--o{ news_sentiment : "analyzed"
    symbols o|--o{ news_sentiment : "classified for"
    symbols o|--o{ ai_research : "researched"
    portfolios o|--o{ ai_research : "reviewed"
    users {
        uuid id PK
        text email UK
        text password_hash
        user_status status
    }
    user_profiles {
        uuid user_id PK "also FK to users"
        text display_name
        text locale
    }
    accounts {
        uuid id PK
        uuid user_id FK
        numeric initial_virtual_capital
        varchar base_currency
    }
    wallets {
        uuid id PK
        uuid account_id FK
        numeric balance
        varchar currency
    }
    symbols {
        uuid id PK
        text symbol
        text exchange_code
        varchar quote_currency
    }
    market_quotes {
        uuid id PK
        uuid symbol_id FK
        numeric price
        quote_status quote_status
        timestamptz observed_at
    }
    watchlists {
        uuid id PK
        uuid user_id FK
        text name
    }
    watchlist_items {
        uuid id PK
        uuid watchlist_id FK
        uuid symbol_id FK
    }
    orders {
        uuid id PK
        uuid account_id FK
        uuid portfolio_id FK
        uuid symbol_id FK
        order_side side
        order_status status
        numeric quantity
    }
    trades {
        uuid id PK
        uuid order_id FK
        uuid symbol_id FK
        numeric quantity
        numeric price
    }
    positions {
        uuid id PK
        uuid portfolio_id FK
        uuid symbol_id FK
        numeric quantity
        numeric average_cost
    }
    portfolios {
        uuid id PK
        uuid account_id FK
        text name
    }
    transactions {
        uuid id PK
        uuid account_id FK
        uuid wallet_id FK
        uuid order_id FK
        uuid trade_id FK
        transaction_type transaction_type
        numeric amount
    }
    price_alerts {
        uuid id PK
        uuid user_id FK
        uuid symbol_id FK
        alert_condition condition
        numeric target_price
    }
    notifications {
        uuid id PK
        uuid user_id FK
        notification_channel channel
        notification_status status
    }
    ai_research {
        uuid id PK
        uuid user_id FK
        uuid symbol_id FK
        uuid portfolio_id FK
        text provider
        text model_name
    }
    news_articles {
        uuid id PK
        text source
        text canonical_url UK
        text headline
    }
    news_sentiment {
        uuid id PK
        uuid article_id FK
        uuid symbol_id FK
        sentiment_label label
        numeric score
    }
    sessions {
        uuid id PK
        uuid user_id FK
        text token_hash UK
        timestamptz expires_at
    }
    audit_logs {
        bigint id PK
        uuid actor_user_id FK
        text action
        text entity_type
        timestamptz occurred_at
    }
```

The complete column-level catalog, constraints, and relationship descriptions are in [database-design.md](../../../../docs/database-design.md). SQL source is [001_initial_schema.sql](../../../../database/migrations/001_initial_schema.sql).

## Key Repository Methods

| Service    | Repository     | Notable Methods                                 | Purpose                                                     |
| ---------- | -------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| API        | None currently | No repository interfaces or queries implemented | `apps/api` currently connects PostgreSQL for readiness only |
| AI service | None currently | No database repository implemented              | `apps/ai-service` currently provides health endpoints only  |

Recommended query patterns when repositories are introduced: retrieve quote history by `(symbol_id, observed_at)`; load account orders by `(account_id, submitted_at)`; fetch portfolio positions by `portfolio_id`; and load notifications by `(user_id, created_at)`. Keep cross-domain writes within owning service transactions.

## Caching Strategy

The API opens a Redis client and uses it for readiness checks only; production cache behavior is not implemented. The intended use is cache-aside for current market quotes and instrument metadata, short-lived portfolio read projections, and ephemeral rate-limit/session coordination. Durable order idempotency remains enforced by PostgreSQL uniqueness. Quote cache TTL must reflect provider freshness, and a cached quote must preserve source/status/timestamp. Redis must never be authoritative for virtual cash, positions, fills, or audit history.

## Data Ownership Boundaries

The proposed schema is a shared PostgreSQL database with table ownership boundaries by domain, not database-per-service. The starter API is one Node.js service using `pg`; separate service roles, repository layers, and cross-service APIs have not yet been implemented. The Trading domain should own writes to accounts, orders, fills, and ledger rows. Portfolio positions are projections built from durable simulated trades. Market data owns symbols and observations. Read replicas must not be used for order validation where replication lag could affect correctness. For reliable asynchronous side effects, order/ledger records and an outbox event should commit atomically; the current schema does not yet include an outbox table.

### Data Classification & Sensitivity

| Entity                              | Sensitive Fields                               | Classification (PII/PHI/PCI/None)      | Controls in Place                                                                                |
| ----------------------------------- | ---------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `users`                             | Email, password hash                           | PII and credential material            | Hash field modeled; encryption-at-rest and field masking are not configured by schema            |
| `user_profiles`                     | Display name, locale, time zone                | PII/preferences                        | User key; no field-level encryption or masking implemented                                       |
| `sessions`                          | Token hash, IP, user agent                     | Security-sensitive personal data       | Token hash modeled; retention and field-level protections not implemented                        |
| `audit_logs`                        | Actor, IP, metadata                            | Security-sensitive and potentially PII | Immutable rows and restricted actor deletion; access controls and masking not implemented        |
| `ai_research`                       | User question and output                       | User content, potentially sensitive    | User FK and retention field; PII minimization and field encryption not implemented               |
| Paper account/trading tables        | Account, simulated trades, balances, positions | Sensitive simulation records; not PCI  | Ownership-aware FK design; production authorization and encryption configuration remain required |
| Market/news tables                  | Provider content and sentiment                 | Licensed data, not PII by default      | Provenance fields; provider licensing/retention controls remain external                         |
| Watchlist/alert/notification tables | User interests and messages                    | User activity data                     | User ownership relations; access controls are not implemented                                    |

No PHI or PCI cardholder data is modeled. Encryption at rest, transport encryption, KMS policies, backups, access controls, data masking, and retention enforcement must be configured operationally; the schema alone does not provide them.
