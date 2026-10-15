# REST API and real-time contract

The Node API uses `/api/v1` for versioned HTTP resources and JSON responses. It is a
paper-trading API; orders use the most recent eligible quote and never reach a broker.
Amounts and quantities are returned as decimal strings to avoid JavaScript floating-point
rounding at the client boundary.

## Response and errors

Successful responses use `{ "ok": true, "data": ..., "requestId": "..." }`. Errors use
`{ "ok": false, "error": { "code": "...", "message": "...", "details": [...] }, "requestId": "..." }`.
Validation details contain field paths and Zod issue codes, but never echo submitted values.
Every HTTP response has an `X-Request-Id`; structured request logs include that ID, method,
path, status, and duration.

List endpoints accept `limit` (1-100, default 25) and `offset` (default 0). Unknown JSON
properties are rejected by strict validators.

## HTTP routes

Unless marked public, routes require `Authorization: Bearer <access-token>` and an active
server-side session. Web refresh-token cookie behavior is documented in
[authentication.md](./authentication.md).

| Method          | Path                                                                            | Access                       | Purpose                                                                           |
| --------------- | ------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| POST/GET/DELETE | `/auth/...` and `/auth/*`                                                       | Public or session, per route | POST registration/login/logout/verification/recovery/refresh; GET/DELETE sessions |
| GET             | `/users/me`                                                                     | User                         | Current account profile                                                           |
| PATCH           | `/users/me`                                                                     | User                         | Update display name, locale, or time zone                                         |
| GET             | `/market/symbols`                                                               | Public                       | Search active symbols and latest quotes                                           |
| GET             | `/market/quotes/:symbol`                                                        | Public                       | Latest quote                                                                      |
| GET             | `/market/snapshots?symbols=AAPL,MSFT`                                           | Public                       | Batch latest quote snapshots (up to 50 symbols)                                   |
| GET             | `/market/quotes/:symbol/candles?interval=5m&limit=100`                          | Public                       | UTC interval OHLC aggregated from stored price samples                            |
| GET             | `/market/quotes/:symbol/history`                                                | Public                       | Paginated quote observations                                                      |
| GET             | `/market/news`                                                                  | Public                       | Paginated articles with latest available sentiment                                |
| POST            | `/market/symbols`                                                               | Admin                        | Register an active symbol                                                         |
| POST            | `/market/symbols/:symbolId/quotes`                                              | Admin                        | Append a complete simulated quote snapshot                                        |
| GET, POST       | `/watchlists`                                                                   | User                         | List or create the caller's watchlists                                            |
| PATCH, DELETE   | `/watchlists/:watchlistId`                                                      | Owner                        | Rename or delete an owned watchlist                                               |
| POST, DELETE    | `/watchlists/:watchlistId/items` and `/watchlists/:watchlistId/items/:symbolId` | Owner                        | Add or remove a symbol                                                            |
| GET, POST       | `/orders`                                                                       | User                         | List orders or submit an immediately simulated market order                       |
| DELETE          | `/orders/:orderId`                                                              | Owner                        | Cancel an unfilled order                                                          |
| GET             | `/trades`                                                                       | User                         | List simulated executions                                                         |
| GET             | `/portfolio`                                                                    | User                         | Paper cash, holdings, cost basis, and P/L                                         |
| GET             | `/portfolio/analytics`                                                          | User                         | Dashboard valuations, returns, leaders, and chart-ready allocations               |
| GET             | `/transactions`                                                                 | User                         | Read-only append-only virtual cash ledger                                         |
| GET, POST       | `/alerts`                                                                       | User                         | List or create price alerts                                                       |
| PATCH           | `/alerts/:alertId`                                                              | Owner                        | Activate, pause, or cancel an untriggered alert                                   |
| GET             | `/notifications`                                                                | User                         | List in-app and email notification records                                        |
| PATCH           | `/notifications/:notificationId/read`                                           | Owner                        | Mark a notification read                                                          |
| GET             | `/ai/research`                                                                  | User                         | List the caller's retained AI research                                            |
| GET             | `/ai/news-sentiment`                                                            | Public                       | Read stored sentiment analysis                                                    |
| GET             | `/ai/market-summary`                                                            | Public                       | Aggregate stored sentiment from the prior 24 hours                                |
| GET             | `/health`, `/ready`                                                             | Public                       | Liveness and dependency readiness                                                 |

Order requests require `symbolId`, `side` (`BUY` or `SELL`), positive decimal-string
`quantity`, and an `idempotencyKey` of 8-128 allowed characters. An optional `portfolioId`
selects the caller's portfolio. The API locks the paper account and wallet/position, verifies
quote freshness and funds or holdings, then writes the order, trade, position, and ledger
entry in a single PostgreSQL transaction. Repeated account-scoped idempotency keys return
the existing execution rather than booking it twice. Cross-currency trading is rejected
until currency conversion is explicitly implemented.

The portfolio analytics response is available per paper portfolio. `investedAmount` is the
open positions' cost basis; total P/L combines realized and unrealized P/L, with its percentage
measured against that open cost basis (null when no open cost basis exists but realized P/L
remains). Daily P/L marks current holdings against each latest
quote's previous close; its percentage uses aggregate previous-close value. Position allocation
is relative to invested holdings, while portfolio allocation includes available cash and each
position relative to total portfolio value. Quotes missing either current price or previous
close, or positions requiring unsupported currency conversion, cause an explicit unavailable
response rather than a misleading partial valuation. Best and worst performers are ranked by
position P/L percentage. Allocation and P/L breakdown arrays are returned as chart-ready
label/value/percentage data.

BUY execution debits virtual cash and updates the weighted-average position cost. SELL
execution requires sufficient available shares, credits virtual cash, and realizes P/L
against that average cost; the portfolio response includes cash, market value, total value,
cost basis, realized P/L, and unrealized P/L. Failed validation or insufficient funds/shares
rolls back the complete order and ledger transaction. Concurrent orders for one account are
serialized with row locks, and the account-scoped idempotency constraint protects retries.

Administrative routes require an `admin` role in `user_roles`; a client cannot grant itself
roles. Migration `003_api_rbac.sql` grants existing accounts the baseline `user` role and
installs a trigger to grant that role to newly created users. Admin assignment is an
operator-controlled database action, not a public API operation.

## Socket.IO

The API shares its HTTP server with Socket.IO and uses the Redis adapter for multi-instance
room fanout. Clients authenticate the handshake with an access token in `auth.token` or a
Bearer authorization header. The server validates the JWT and active session, joins the
private `user:<userId>` room, and accepts `market:subscribe` / `market:unsubscribe` events
with a symbol UUID. A socket can subscribe to at most 50 market rooms. Clients cannot
publish quote events; `market:quote` is server-published only.

The current market service emits `market:quote` to room `market:<symbolId>` only while a
fresh Redis subscriber lease exists for the symbol. Leases are heartbeat-refreshed and stale
memberships are pruned, allowing a simulator on one API instance to reach clients connected
to another instance through the Socket.IO Redis adapter.

## Simulated market data

Apply migrations `001` through `006` before startup. Migration `004` adds synthetic AAPL,
MSFT, NVDA, AMZN, GOOGL, META, TSLA, and SPY instruments with starting prices. The
background simulator generates a bounded random-walk price every 3 seconds by default.
`MARKET_SIMULATION_INTERVAL_MS` tunes the tick interval (1-60 seconds), and
`MARKET_HISTORY_INTERVAL_MS` tunes historical sampling (5 seconds-1 hour). These are
simulated educational prices, not exchange prices.

Every snapshot contains `symbol`, `price`, `open`, `high`, `low`, `previousClose`, `change`,
`changePercent`, `volume`, and `timestamp`, together with `currency`, `quoteStatus`, and
`source`. Day open, high/low, and volume reset at UTC date boundaries. Latest snapshots are
cached per instrument in Redis. Historical OHLCV quote observations are sampled into
PostgreSQL at the configured interval; tick-rate REST reads do not add a database row per tick.

`GET /market/quotes/:symbol` returns one current snapshot.
`GET /market/snapshots?symbols=AAPL,MSFT` returns snapshots in requested unique-symbol order
and accepts at most 50 tickers. `GET /market/quotes/:symbol/history` returns sampled
historical snapshots with `limit` and `offset`.

The candle endpoint accepts `interval` values `1m`, `5m` (default), `15m`, `1h`, and `1d`, plus `limit` (1-2000, default 100). It returns `{ interval, source: "sampled-quotes", candles: [{ timestamp, open, high, low, close, samples, volume }] }` in ascending UTC bucket order. The window ends at the current bucket; limit bounds the number of time buckets, including empty ones. Empty buckets are omitted, never filled with synthetic prices. Open/close are the first/last recorded prices, and high/low are the extrema of recorded prices in each bucket. Per-bar volume is summed from sampled UTC session-counter deltas, including a preceding observation as a baseline. Missing baselines or an unexpected same-session counter decrease yield null volume rather than invented data. The current candle is still forming. These are OHLC bars of stored samples, not complete tick-level or exchange OHLC; prices between historical samples are not recoverable. Session-wide snapshot open/high/low are deliberately not reused as intrabar values.

The market service depends on an asynchronous `MarketDataProvider` interface and a
provider-neutral instrument contract. Instruments are selected by their `data_provider` value,
which must match the configured provider name; an adapter can map an external feed to the shared
quote contract while retaining the same Redis, PostgreSQL history, and Socket.IO paths. No
external provider or live price feed is enabled by default.

## Security and operational behavior

- Express Helmet headers, explicit CORS origins, JSON body size limit, request IDs, structured
  request logging, Redis-backed API rate limits, and stricter existing auth route limits.
- User profile, watchlist, trading, portfolio, ledger, alert, notification, and research
  queries are scoped to the authenticated user in SQL; opaque resource IDs do not grant access.
- RBAC uses database-backed `user` and `admin` roles. Database role checks happen after JWT
  session verification.
- SQL values are parameterized. User-provided sort expressions/identifiers are not accepted.
- PostgreSQL-backed financial state is authoritative; Redis is used for throttling, session
  revocation, and Socket.IO fanout, not as the cash ledger.
- Errors are centralized; unexpected exceptions are logged with request context and mapped
  to a generic 500 response. Validation errors are 400, ownership misses are 404, order
  conflicts are 409, and unavailable quotes are 503.

## Deliberate integration boundaries

The routes expose stored AI research and sentiment; model inference, external licensed
market-data provider integration, alert evaluation, notification delivery, and email
dispatch require their respective workers/providers. The API reports readiness for
PostgreSQL and Redis. Run migrations in order before startup; the service intentionally does
not mutate the production schema on boot.

## Mobile push registration

Migration `006_push_devices.sql` adds a session-scoped Expo device registry. Authenticated POST `/notifications/devices` accepts `{ installationId, token, platform }`; DELETE `/notifications/devices/:installationId` is idempotent and owner-scoped. Active token conflicts return 409, and expired/revoked sessions are excluded from delivery eligibility. Mobile refresh/login requests use `x-client-type: mobile` and refresh tokens in JSON bodies rather than web cookies. The push gateway exposes send/receipt operations, but dispatch scheduling, credential provisioning, receipt persistence, and alert/research generation workers remain explicit integration boundaries. See `apps/mobile/README.md`.
