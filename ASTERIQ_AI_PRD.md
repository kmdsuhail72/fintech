# Asteriq AI — Product Requirements Document

**Status:** Draft  
**Version:** 1.0  
**Product type:** Educational investing and paper-trading SaaS  
**Platforms:** Responsive web application and React Native mobile application  
**Important boundary:** Asteriq AI is not a brokerage and does not accept, route, execute, or custody real-money orders or assets.

## 1. Project objective

Asteriq AI helps people learn about global public markets by combining market discovery, simulated trading, portfolio tracking, and AI-assisted financial research in one product. Users can explore supported instruments, practice market-order decisions using virtual funds, monitor simulated portfolios, and understand market information without risking real capital.

The product should make it easy to distinguish:

- Simulated trades and balances from real market activity and real money.
- Observed or delayed market data from generated or simulated prices.
- Factual market information from AI-generated analysis and educational content.

The initial release is an educational paper-trading product. Any future move toward live brokerage services, personalized investment advice, or financial-product distribution requires a separate product, legal, compliance, and operational review; it is not implied by this PRD.

## 2. Goals and success measures

### Product goals

1. Enable a new user to create an account, understand the simulated-money model, and place a first paper trade with minimal friction.
2. Provide reliable portfolio, order, and transaction records that remain internally consistent.
3. Make market context understandable through charts, summaries, news sentiment, and clearly labeled AI research.
4. Support web and mobile clients through one authenticated API and shared domain model.
5. Provide a secure, observable, and scalable foundation for adding instruments and users.

### Initial success measures

Targets below are initial product hypotheses and should be confirmed against launch analytics and operating budgets.

| Measure | Initial target |
|---|---:|
| New users completing onboarding and viewing a portfolio | At least 70% |
| Onboarded users placing a first paper trade within 7 days | At least 40% |
| Successful valid simulated order requests | At least 99.5%, excluding client/network failures |
| Portfolio and order ledger consistency | 100% reconciliation in automated checks |
| Web API availability | At least 99.9% monthly, excluding announced maintenance |
| Connected-client market update delivery latency | p95 under 2 seconds after a price update is accepted by the platform |
| User-reported or detected AI output safety incidents | Tracked, triaged, and reviewed; no unsupported guarantee of zero |

## 3. Target users

- **Investment beginners:** People learning market terminology and basic portfolio concepts.
- **Self-directed learners:** Users who want a safe environment to practice order and portfolio decisions.
- **Market-curious users:** People who want a convenient way to follow instruments, news, and price movements.
- **Educators and learning groups (later phase):** Instructors who may want structured exercises or cohort-level learning tools.

The initial product is for adults and is not designed for institutional trading, professional portfolio management, financial advisers acting for clients, or minors.

## 4. User personas

### Maya — First-time investor

- Wants to understand stocks and portfolio risk without depositing money.
- Needs plain-language definitions, onboarding guidance, and clear virtual-money labels.
- Success means understanding how a simulated order affects cash and holdings.

### Jordan — Active learner

- Follows a small set of companies and checks market movement regularly.
- Needs watchlists, charts, alerts, transaction history, and a responsive mobile experience.
- Success means quickly noticing a price move and reviewing its effect on a paper portfolio.

### Sam — Data-oriented hobbyist

- Uses indicators and news to form and compare hypotheses.
- Needs chart time ranges, indicator controls, sourced research context, and transparent AI limitations.
- Success means exploring a thesis without being led to believe that a prediction is guaranteed.

### Riley — Product support / operations administrator

- Handles account and service issues and monitors platform health.
- Needs auditable administrative actions, operational dashboards, and privacy-conscious support tooling.
- Success means resolving an issue without gaining unnecessary access to sensitive user data.

## 5. Product principles and assumptions

1. **Paper only:** Every order, balance, holding, return, and notification is simulated. No real-money functionality is included.
2. **Honest market-data labeling:** Each displayed quote or chart identifies its source and whether it is real-time, delayed, or simulated.
3. **No implied returns:** Simulated returns are not evidence of expected or achievable real-world performance.
4. **AI is assistive, not authoritative:** AI output is educational, sourced where possible, timestamped, and not individualized investment advice.
5. **Ledger-backed accounting:** Order execution and portfolio updates are transactional and auditable.
6. **Global discovery is a product ambition, not a promise of universal coverage:** Instrument availability depends on licensed or otherwise approved data sources, exchange calendars, symbol mappings, and regional restrictions.
7. **Initial order type:** Market orders only. Limit, stop, fractional-share, short-sale, margin, derivatives, and crypto trading are out of initial scope unless separately approved.
8. **Virtual account funding:** The product assigns a disclosed virtual starting balance. Resetting or replenishing it must be an explicit, auditable product policy; it must never be presented as a cash deposit.

## 6. Functional requirements

Priorities: **P0** = required for MVP; **P1** = important follow-up; **P2** = later phase.

### 6.1 Account and onboarding

- **FR-001 (P0):** A user can register with email and password and verify the email address.
- **FR-002 (P0):** A user can sign in, sign out, request a password reset, and manage active sessions.
- **FR-003 (P0):** Onboarding explains virtual funds, simulated execution, market-data status, and the educational-only nature of AI features.
- **FR-004 (P0):** A paper account is created with a configurable virtual starting balance and a defined base currency.
- **FR-005 (P1):** Users can manage profile preferences, locale, time zone, and notification preferences.
- **FR-006 (P0):** Users can request account deletion and data export in accordance with the published retention and privacy policy.

### 6.2 Market discovery and instruments

- **FR-010 (P0):** Users can search and browse supported instruments by name, ticker/symbol, exchange, asset category, and supported region.
- **FR-011 (P0):** Instrument detail pages display identity, exchange, currency, quote status, last update time, and applicable market-data attribution.
- **FR-012 (P0):** The product clearly labels quote freshness and market session status; stale or unavailable data is not represented as current.
- **FR-013 (P1):** Users can browse curated discovery lists, such as most followed or notable movers, with definitions and data timestamps.
- **FR-014 (P1):** Search supports pagination, sorting, and safe handling of ambiguous or duplicate symbols.

### 6.3 Simulated prices and charts

- **FR-020 (P0):** The platform supplies chartable price series for supported instruments and time ranges.
- **FR-021 (P0):** Where the platform generates prices for simulation, those prices are unmistakably labeled as simulated and are not conflated with exchange quotes.
- **FR-022 (P0):** The web and mobile clients render interactive price charts with selectable time ranges and basic price/volume views when available.
- **FR-023 (P1):** Users can add and remove technical indicators such as simple/exponential moving averages and RSI.
- **FR-024 (P1):** Chart points and indicators identify their time zone, sampling interval, and calculation basis.
- **FR-025 (P0):** Live or simulated updates are delivered over Socket.IO to authorized clients, with REST resynchronization after reconnect.
- **FR-026 (P0):** The client indicates connection state and does not silently present an old cached value as a live update.

### 6.4 Watchlists and price alerts

- **FR-030 (P0):** Users can create, rename, and delete watchlists and add or remove supported instruments.
- **FR-031 (P0):** Watchlists are private to their owning user unless a future sharing feature is explicitly introduced.
- **FR-032 (P1):** Users can create, edit, pause, and delete alerts based on supported price thresholds.
- **FR-033 (P1):** Alert evaluation records the triggering quote, source/status, condition, and event time; repeated delivery is deduplicated.
- **FR-034 (P1):** Users can choose email and in-app alert delivery and configure relevant notification preferences.

### 6.5 Paper orders and portfolio

- **FR-040 (P0):** An authenticated user can submit a buy or sell market order for an eligible instrument using their virtual account.
- **FR-041 (P0):** The order preview shows side, quantity, indicative price and timestamp, estimated notional, estimated fees if any, available virtual cash or holdings, and a paper-trading disclaimer.
- **FR-042 (P0):** The server validates instrument eligibility, positive quantity, available virtual funds for buys, and available sellable holdings for sells.
- **FR-043 (P0):** Order acceptance and simulated execution are performed by a server-side execution policy using a documented quote source and price timestamp. The client cannot choose the fill price.
- **FR-044 (P0):** The system records order lifecycle states (at minimum accepted, filled, rejected, and cancelled where cancellation is supported) with reason codes and timestamps.
- **FR-045 (P0):** Portfolio cash, holdings, average cost, realized profit/loss, and unrealized profit/loss are computed from the authoritative transaction ledger and current eligible price data.
- **FR-046 (P0):** Buy/sell execution and the corresponding ledger entries are atomic and protected against duplicate submissions.
- **FR-047 (P0):** Users can view holdings, virtual cash, total portfolio value, and a clearly defined performance view.
- **FR-048 (P0):** Users can view searchable, paginated transaction and order history with side, instrument, quantity, execution price, status, and time.
- **FR-049 (P0):** Users can distinguish unrealized from realized profit/loss and see the currency and calculation assumptions.
- **FR-050 (P1):** Users can configure supported portfolio display preferences, such as base currency, without altering historical execution records.
- **FR-051 (P1):** A paper account reset or virtual cash replenishment is only available if product policy allows it; every reset is explicitly confirmed, clearly disclosed, and auditable.

### 6.6 AI research, news, and insights

- **FR-060 (P0):** A user can request an AI-generated market or instrument summary from approved available data.
- **FR-061 (P0):** AI summaries include generation time, input-data time range, source references when available, and a notice that generated content can be inaccurate.
- **FR-062 (P1):** The platform can classify available financial news for sentiment and relevant instruments, displaying source, publication time, and model/output status.
- **FR-063 (P1):** Portfolio insights summarize exposures, concentration, diversification observations, and historical simulated performance using disclosed calculations.
- **FR-064 (P0):** AI outputs must not claim certainty, guarantee returns, execute trades, or present themselves as personalized professional advice.
- **FR-065 (P0):** If source data is missing, stale, contradictory, or the AI service fails, the client shows a clear unavailable state rather than fabricating or silently substituting an answer.
- **FR-066 (P1):** Users can provide feedback on AI outputs and report a safety or factuality concern.

### 6.7 Notifications and support

- **FR-070 (P0):** Email is used for account verification and password reset using expiring, single-use tokens.
- **FR-071 (P1):** Email notifications can be sent for triggered alerts and selected account events subject to user preferences.
- **FR-072 (P0):** Notification delivery is retriable, idempotent where practical, and observable; secret tokens and unnecessary financial data are excluded from email content.
- **FR-073 (P0):** Users can access a support or feedback channel and report incorrect data, AI output, or simulated-order issues.

## 7. Major features

1. **Global market explorer:** Search, instrument profiles, quote state, and curated discovery.
2. **Paper account:** Virtual cash balance and a paper-only order experience.
3. **Portfolio dashboard:** Holdings, cash, portfolio value, and realized/unrealized performance.
4. **Watchlists and alerts:** Personal instrument lists and threshold notifications.
5. **Interactive charts:** Historical series, simulated live updates, and a foundation for indicators.
6. **Activity ledger:** Orders, executions, and transaction history.
7. **AI research workspace:** Summaries, news sentiment, and educational portfolio observations with provenance.
8. **Cross-platform clients:** Responsive React web application and React Native/Expo mobile application using common backend services.
9. **Operational console (restricted):** Service health, job and delivery status, and privacy-controlled support operations.

## 8. User journeys

### Journey A — Start learning

1. User registers with email and password.
2. User verifies email and signs in.
3. Onboarding explains paper-only trading, simulated funds, data status, and AI limitations.
4. The system creates a paper account with its disclosed starting balance.
5. User lands on a portfolio overview showing cash and an empty-state learning prompt.

### Journey B — Discover and follow an instrument

1. User searches by company name or ticker.
2. User opens an instrument page and checks the exchange, currency, quote status, and update time.
3. User adds the instrument to a private watchlist.
4. User reviews its chart and, where available, an AI summary with sources and timestamp.

### Journey C — Place a paper market order

1. User selects buy or sell, enters a valid quantity, and opens an order preview.
2. The server revalidates the account, instrument, quantity, cash or holdings, and current execution quote.
3. The system accepts or rejects the request with a clear reason.
4. Accepted orders are simulated and written atomically to the order and transaction ledger.
5. The portfolio refreshes from the ledger; the user can inspect the completed activity.

### Journey D — Monitor a paper portfolio

1. User opens the portfolio on web or mobile.
2. Holdings and cash are retrieved over REST; market updates arrive through Socket.IO.
3. The client shows update timestamps and connection state.
4. User reviews realized and unrealized P/L separately and inspects the transactions underlying a position.

### Journey E — Create and receive a price alert

1. User chooses an instrument and enters a supported threshold condition.
2. The system validates and stores the alert.
3. An alert evaluator checks eligible price updates and records a unique trigger event.
4. The user receives an in-app or email notification according to preferences.
5. The user opens the instrument page, where the triggering price and timestamp are available.

### Journey F — Ask for an AI market summary

1. User requests a summary from an instrument or market page.
2. The API checks authorization, rate limits, data availability, and AI usage policy.
3. The AI service receives only the minimum required approved data and prompt context.
4. The UI displays the result, data and generation timestamps, source references, and educational disclaimer.
5. User can provide feedback or report a concern.

## 9. System components

### Client applications

- **Web:** React, TypeScript, Vite, Tailwind CSS. Responsive design, accessible forms, REST API integration, Socket.IO client, and explicit data freshness states.
- **Mobile:** React Native, Expo, TypeScript. Shares API contracts and domain terminology with web; protects session credentials using platform-appropriate secure storage.
- **Shared contracts:** Versioned OpenAPI REST specification and shared generated TypeScript types where practical. Do not couple mobile and web to server implementation internals.

### Backend and data services

- **API service:** Node.js, Express, TypeScript. REST endpoints, authentication, input validation, authorization, rate limiting, orchestration, and API documentation.
- **Realtime gateway:** Socket.IO, integrated with authenticated sessions and room-level authorization. Redis adapter/pub-sub may be used for multi-instance fan-out.
- **Trading domain:** Server-side paper order validation, execution policy, idempotency, ledger posting, and portfolio projection.
- **Market-data adapter:** Normalizes licensed or approved upstream data and simulated-price generation behind a provider interface.
- **AI service:** Python, FastAPI, scikit-learn, Hugging Face, LangChain, and OpenAI API integrations behind a separately deployable service boundary.
- **PostgreSQL:** Authoritative store for identities, accounts, instruments, orders, ledger entries, portfolio snapshots, watchlists, alerts, and audit events.
- **Redis:** Cache, rate-limit counters, ephemeral Socket.IO coordination, and background-job coordination where appropriate. Redis is not the authoritative financial ledger.
- **Email provider adapter:** Sends verification, reset, and opt-in notification email through a replaceable provider integration.
- **Background workers:** Alert evaluation, email delivery, market-data ingestion, news processing, AI summarization jobs, and reconciliation tasks.

### Delivery and operations

- **Docker / Docker Compose:** Consistent local development and integration-test environment for API, AI service, PostgreSQL, Redis, and required workers.
- **GitHub Actions:** Lint, type-check, unit/integration tests, dependency and image scanning, build, and deployment workflows with protected secrets and environment approvals.
- **AWS:** Target cloud. Specific services and network topology are selected during infrastructure design; production should use managed, multi-AZ-capable database/cache and secret-management services where justified.

## 10. APIs required

All REST endpoints are versioned under `/api/v1`. JSON requests and responses use UTC ISO-8601 timestamps, stable error codes, pagination, request IDs, and schema validation. API responses must not expose secrets or internal provider credentials.

| Area | Example endpoints | Purpose |
|---|---|---|
| Authentication | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `POST /auth/verify-email`, `POST /auth/password/forgot`, `POST /auth/password/reset` | Account creation and session lifecycle |
| Profile | `GET /me`, `PATCH /me`, `DELETE /me`, `GET /me/export` | Profile, preferences, deletion, export |
| Instruments | `GET /instruments`, `GET /instruments/{id}`, `GET /instruments/search` | Browse/search instrument catalog |
| Quotes and series | `GET /instruments/{id}/quote`, `GET /instruments/{id}/prices?range=&interval=` | Quote state and chart series |
| Watchlists | `GET /watchlists`, `POST /watchlists`, `PATCH /watchlists/{id}`, `DELETE /watchlists/{id}`, `PUT/DELETE /watchlists/{id}/instruments/{instrumentId}` | Manage private watchlists |
| Paper accounts | `GET /paper-accounts`, `GET /paper-accounts/{id}/portfolio`, `GET /paper-accounts/{id}/holdings` | Account cash and portfolio |
| Paper orders | `POST /paper-accounts/{id}/orders`, `GET /paper-accounts/{id}/orders`, `GET /paper-accounts/{id}/orders/{orderId}` | Submit and inspect simulated orders |
| Transactions | `GET /paper-accounts/{id}/transactions` | Ledger-backed transaction history |
| Alerts | `GET /alerts`, `POST /alerts`, `PATCH /alerts/{id}`, `DELETE /alerts/{id}` | Configure user price alerts |
| AI research | `POST /research/summaries`, `GET /research/summaries/{id}`, `POST /research/feedback` | Generate and review educational AI content |
| News | `GET /news`, `GET /instruments/{id}/news` | Retrieve approved news and sentiment metadata |
| Notifications | `GET /notifications`, `PATCH /notification-preferences` | In-app notifications and preferences |
| Health/operations | `GET /health/live`, `GET /health/ready` | Liveness/readiness probes (no sensitive diagnostics) |

### API behavior requirements

- Order submission accepts an `Idempotency-Key`; retries with the same key cannot create duplicate executions.
- Order and money-like quantities use decimal-safe representations (for example integer minor units where suitable or PostgreSQL `NUMERIC` with explicit precision), never binary floating-point for ledger arithmetic.
- Mutating requests enforce authentication, object-level authorization, CSRF protections where cookie-based sessions are used, and request validation.
- Errors use stable codes such as `INSUFFICIENT_VIRTUAL_CASH`, `INSUFFICIENT_HOLDINGS`, `STALE_QUOTE`, `INSTRUMENT_UNAVAILABLE`, and `IDEMPOTENCY_CONFLICT`.
- Rate limits are stricter for authentication, order submission, alert creation, and AI generation than for ordinary read operations.
- OpenAPI documentation is version-controlled and contract-tested.

### Socket.IO events

- Client-to-server: authenticated connection, subscription request for authorized instrument/account updates, and unsubscribe request.
- Server-to-client: `quote:update`, `portfolio:update`, `order:update`, `alert:triggered`, and connection/resynchronization status.
- Events contain identifiers, values, currency, source/status, and event timestamp as appropriate; they must not contain another user's private account information.
- A client reconnects by fetching a REST snapshot and then resumes updates; delivery is not assumed to be exactly once.

## 11. Database requirements

PostgreSQL is the system of record. A relational schema should include, at minimum:

- `users`: normalized email identity, verification state, account status, timestamps.
- `sessions` or refresh-token records: hashed token material, expiry, revocation, device/session metadata.
- `user_preferences`: locale, time zone, notification settings, and consent/version records where required.
- `paper_accounts`: user ownership, base currency, virtual cash state/projection, account status, and creation policy.
- `instruments`: canonical ID, symbol, name, asset type, exchange, region, quote currency, provider mapping, and eligibility state.
- `price_observations`: instrument, price, currency, source, quote status, observed time, and ingestion time; retention/partitioning policy required.
- `paper_orders`: account, idempotency key, side, quantity, status, execution details, validation result, and timestamps.
- `ledger_entries`: immutable debit/credit-style postings linked to order/event and account; corrections use compensating entries rather than silent rewriting.
- `holdings` and `portfolio_snapshots`: rebuildable projections for efficient reads, with reconciliation against ledger entries.
- `watchlists` and `watchlist_instruments`: ownership, names, unique membership, and ordering.
- `price_alerts` and `alert_events`: condition, state, trigger identity, evaluated price, and delivery status.
- `news_items` and `news_sentiment`: provider/source attribution, publication time, instrument links, model/version, confidence or classification, and processing time.
- `ai_research_outputs`: user/request reference, model and prompt/version metadata, input-data references, generation time, safety status, and output retention controls.
- `notifications`: type, owner, delivery channel/state, retry count, and deduplication key.
- `audit_events`: security-sensitive and financial-domain actions with actor, action, target, outcome, request correlation ID, and timestamp.

### Data integrity and lifecycle

- Use foreign keys, uniqueness constraints, check constraints, and appropriate indexes for ownership, time-based history, idempotency, and search.
- Order acceptance, execution, ledger posting, and projection updates must be transactionally coordinated or driven through a reliable outbox/event pattern.
- Maintain a durable audit trail for order lifecycle transitions, account resets, administrative actions, and sensitive account changes.
- Define retention and deletion rules for identity, financial simulation records, AI prompts/outputs, telemetry, and security logs; meet applicable legal obligations.
- Use migrations with review, backups, restore testing, and forward/backward compatibility planning.
- Avoid storing payment-card, brokerage, bank-account, or real-money funding data because those capabilities are outside product scope.

## 12. Security, privacy, and compliance requirements

- **Authentication:** Use established password hashing (Argon2id or bcrypt with current secure parameters), verified email, expiring single-use recovery tokens, session revocation, and optional MFA in a later release.
- **Authorization:** Enforce server-side user/account ownership on every account, portfolio, watchlist, alert, research, and transaction operation. Never rely on client-supplied ownership IDs.
- **Transport and storage:** TLS in transit; encryption at rest for databases, backups, and object storage; secrets in AWS Secrets Manager or an equivalent managed secret store, not source control or images.
- **API protection:** Validate and normalize all input; use parameterized SQL; apply secure headers, CORS allowlists, request size limits, abuse controls, and rate limits.
- **Realtime protection:** Authenticate Socket.IO handshakes, authorize every subscription, expire/revoke sessions, and prevent room-name guessing from granting access.
- **Financial correctness:** Revalidate funds and holdings at execution; serialize or otherwise safely coordinate concurrent orders; use idempotency and reconciliation; ensure ledger writes are atomic.
- **Web protections:** Apply an appropriate Content Security Policy, output encoding, secure cookie attributes if cookies are used, and CSRF defenses for cookie-authenticated state changes.
- **Mobile protections:** Store tokens using platform secure storage; do not embed service secrets in the app; protect sensitive local caches and avoid logging credentials or account data.
- **Privacy:** Collect the minimum personal data; explain AI/data processing; constrain data sent to third-party AI and news providers; provide account deletion/export processes; restrict internal access by role.
- **Audit and response:** Record administrative and security-sensitive actions; define incident response, breach escalation, access review, and backup recovery procedures.
- **AI safety:** Do not request or return unnecessary personally identifiable or account data to a model provider. Treat news and retrieved documents as untrusted input; protect against prompt injection; apply output validation and abuse controls.
- **Regulatory posture:** Before launch, obtain qualified legal/compliance review for target markets, age policy, privacy, consumer disclosures, financial-promotion rules, market-data licensing, AI disclosures, email consent, and record retention. The product must not imply that paper-trading results predict real investment outcomes.

## 13. AI features and controls

### Initial AI capabilities

- **Market summaries:** Summarize recent approved market and price context, identify relevant time windows, and cite available source items.
- **Instrument research:** Explain company/news context in accessible language, separating retrieved facts from generated interpretation.
- **News sentiment:** Classify approved news items using scikit-learn or Hugging Face models; show the classification, timestamp, and model status rather than treating sentiment as ground truth.
- **Portfolio insights:** Describe observable simulated-portfolio characteristics such as concentration and historical drawdown. The product must not make individualized buy/sell recommendations.

### AI service requirements

- The FastAPI service exposes authenticated internal endpoints with request schemas, timeouts, health probes, quotas, and structured errors.
- Use LangChain only where it adds traceable orchestration; maintain explicit prompt templates and version them.
- OpenAI API and Hugging Face integrations are provider adapters so providers/models can be changed without altering the client contract.
- Persist model/provider version, prompt version, source references, input-data timestamps, safety result, and generation time for outputs where retention is permitted.
- Apply retrieval allowlists, source freshness checks, prompt-injection defenses, content moderation appropriate to the use case, and output checks for unsupported guarantees or advice.
- AI output must be labeled as generated and educational. Show source links when licensing and provider terms allow.
- Define AI quality evaluation before release: factuality sampling, citation validity, latency, refusal/fallback behavior, sentiment validation, and incident review.
- If AI is unavailable, core discovery, account, and paper-trading functionality remains usable.

## 14. Non-functional requirements

### Performance and reliability

- Common read APIs: p95 under 500 ms at launch load, excluding upstream-provider latency.
- Order validation/execution API: p95 under 1 second under normal operating conditions, excluding explicitly asynchronous processing.
- AI summary generation: return within a defined product SLA or switch to an explicit pending/unavailable state; do not block ordinary portfolio access.
- Web/mobile portfolio and instrument screens should use bounded pagination and cache only data whose freshness is visible.
- Define service-level objectives, error budgets, maintenance communication, and disaster-recovery objectives before production. Initial targets: RPO no more than 15 minutes and RTO no more than 4 hours, subject to infrastructure and cost validation.

### Accessibility and usability

- Meet WCAG 2.2 AA for core web journeys where practicable.
- Support keyboard navigation, screen readers, meaningful chart alternatives, readable contrast, and non-color-only status indicators.
- Use plain-language explanations for simulated balances, order status, quote staleness, P/L, and AI limitations.
- Localize date/time and number presentation while keeping API values canonical and explicit about currency.

### Maintainability and compatibility

- TypeScript strict mode and Python typing/linting are expected in CI.
- Maintain automated unit, integration, API contract, and end-to-end tests for money/order flows and authentication.
- Keep REST contracts versioned; support mobile app compatibility with prior API versions during a defined rollout window.
- Make market and AI providers replaceable behind explicit adapters.

## 15. Scalability requirements

- Keep API and AI workloads independently deployable and horizontally scalable.
- Use stateless API instances where possible; externalize session/realtime coordination to managed shared services.
- Partition or archive high-volume price and event data based on measured write/read patterns and retention needs.
- Use read replicas or materialized/projection tables for portfolio reads only after correctness and load measurements justify them.
- Apply bounded queues and backpressure for news ingestion, alerts, email, and AI jobs.
- Define per-user and per-provider quotas to control cost and prevent abuse.
- Scale Socket.IO with a Redis adapter or equivalent shared pub/sub; load-test reconnect storms and fan-out behavior.
- Avoid promising global real-time market coverage until provider licensing, latency, exchange coverage, and operating costs have been validated.

## 16. Monitoring and operations requirements

- Collect structured application logs with correlation/request IDs; redact tokens, passwords, sensitive user data, and AI prompts where unnecessary.
- Export metrics for API latency/error rate, authentication failures, order acceptance/rejection, execution-to-ledger reconciliation, quote freshness, Socket.IO connections/drops, queue depth, email outcomes, AI latency/errors/cost, and database/cache health.
- Trace requests across API, workers, database, realtime gateway, and AI service using OpenTelemetry-compatible instrumentation.
- Provide dashboards and actionable alerts for availability, elevated 5xx, stale market feeds, failed email queues, order/ledger inconsistencies, AI provider failures, and resource saturation.
- Define runbooks for database restore, credential rotation, upstream data outage, AI provider outage, message backlog, and security incident response.
- Keep readiness checks distinct from liveness checks; health endpoints must not disclose secrets, internal topology, or sensitive diagnostics.
- Perform backup restore drills, dependency/image vulnerability scanning, and capacity/load tests before major launch milestones.

## 17. MVP scope

### Included

- Responsive React web client and initial Expo mobile client covering core account, discovery, watchlist, portfolio, and paper-order journeys.
- Secure email/password registration, verification, sign-in, sign-out, and password reset.
- A single paper account per user with a disclosed virtual starting balance and one base currency.
- Curated, explicitly bounded initial instrument universe based on data availability and rights.
- Market data with visible source/freshness labels and a clearly identified simulated-price mode where generated prices are used.
- Search, instrument detail, basic historical interactive chart, private watchlists.
- Buy and sell market orders with server-side validation, idempotency, simulated execution, and immutable transaction records.
- Cash, holdings, average cost, portfolio value, and realized/unrealized P/L.
- Order/transaction history and basic portfolio refresh via REST; Socket.IO price updates for supported instruments.
- Email verification and password reset.
- One AI-generated educational market/instrument summary with source/time metadata, clear limitations, and graceful failure behavior.
- Docker Compose local environment, PostgreSQL migrations, Redis, CI checks, baseline monitoring, and security controls.

### Excluded from MVP

- Live brokerage, real-money funding, custody, or external order routing.
- Personalized financial advice or promises/guarantees of investment returns.
- Options, futures, crypto, forex execution, margin, shorting, limit/stop orders, and social/copy trading.
- Universal global instrument coverage or guaranteed exchange-real-time data.
- Automated AI trade execution, AI-generated portfolio rebalancing, or trading signals presented as recommendations.
- Public/shared watchlists, leaderboards, competitions, and educator cohort administration.
- Paid subscriptions or payments unless separately scoped.

## 18. Phase 2 features

- User-configurable threshold alerts with email and in-app delivery.
- News ingestion and sentiment classification with source attribution and instrument linking.
- Expanded chart ranges, volume, and user-selectable technical indicators such as SMA, EMA, and RSI.
- AI portfolio insights focused on descriptive exposure, concentration, and historical risk observations.
- Improved mobile push notifications, biometric re-entry where appropriate, and deeper native interaction.
- Additional supported exchanges/instruments subject to data licensing and quality validation.
- Optional simulated account reset/replenishment controls governed by transparent product policy.
- Multi-factor authentication and enhanced account/session security controls.
- Operational support console with tightly scoped roles and auditable access.
- Formal AI evaluation suite, user feedback workflows, and model/provider comparison.

## 19. Phase 3 features

- Educational learning paths, guided simulations, and scenario-based paper-trading exercises.
- Educator or cohort tools with privacy-preserving group administration, if market research supports them.
- Extended instrument coverage and carefully scoped asset classes, subject to licensing, compliance, and model validation.
- Advanced portfolio analytics and benchmark comparisons with clear methodology and simulation disclaimers.
- Additional languages, regions, and localization.
- Optional subscription tiers and enterprise/education offerings after business-model validation.
- More sophisticated market-event and risk analytics; any predictive AI capability requires separate risk, compliance, and evidence review.
- Formal high-availability multi-region strategy if growth, regulatory obligations, and recovery targets require it.

## 20. MVP acceptance criteria

1. A user can register, verify email, sign in, reset a password, and see a paper account without entering payment or brokerage details.
2. Every account balance, order, holding, chart quote, and return is identified as simulated, observed, delayed, or otherwise accurately labeled.
3. A valid buy order decreases virtual cash and increases holdings once; a valid sell order decreases holdings and credits virtual cash once.
4. Insufficient virtual cash or holdings produces a stable error and no partial ledger mutation.
5. Repeating an order request with the same idempotency key does not create a duplicate fill.
6. Concurrent submissions cannot overspend virtual cash or sell more holdings than available.
7. Portfolio values and P/L can be reconciled to the transaction ledger and the stated price basis.
8. A user cannot read or mutate another user's accounts, orders, watchlists, alerts, or research records through REST or Socket.IO.
9. Stale data, disconnected realtime state, unavailable AI, and email delivery failures are visible or operationally surfaced rather than hidden.
10. Core web and mobile journeys pass automated tests, and production deployment has monitored health checks, backup/restore procedures, and documented incident runbooks.

## 21. Key risks and dependencies

- **Market-data rights and coverage:** Global discovery and quote display depend on licensing, provider terms, exchange coverage, and permitted redistribution.
- **Simulation credibility:** Users may misunderstand generated prices or paper performance; prominent labels and consistent product language are mandatory.
- **AI factuality and advice boundary:** Generated interpretations can be wrong or appear prescriptive; source provenance, evaluations, disclaimers, and product/legal review are required.
- **Financial state correctness:** Race conditions, duplicate requests, precision errors, or broken projections could undermine trust; ledger invariants and reconciliation are launch blockers.
- **Email deliverability:** Verification, recovery, and alert emails depend on provider configuration, domain reputation, and retry handling.
- **Third-party cost/availability:** AI, news, market-data, and email providers require budgets, quotas, fallback behavior, and outage monitoring.
- **Regional compliance and privacy:** Launch geographies, data residency, retention, age eligibility, and consumer disclosures must be validated before public release.

## 22. Decisions required before production launch

- Launch countries, age eligibility, and supported currencies/exchanges.
- Initial instrument universe and market-data provider/licensing model.
- Whether initial price updates are live provider data, simulated data, or a deliberately labeled combination.
- Virtual starting balance, replenishment/reset policy, and any simulation fees/slippage model.
- Exact definitions for average cost, realized/unrealized P/L, valuation time, and currency conversion.
- Hosting region, AWS service selection, availability targets, RPO/RTO, and budget.
- AI provider/model selection, output retention, user consent/disclosure, and evaluation thresholds.
- Email provider, notification consent policy, data-retention schedule, and account-deletion obligations.

