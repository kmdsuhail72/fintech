# Asteriq AI mobile

Expo SDK 53, React Native, TypeScript, and React Navigation. The app uses the same JWT-authenticated REST and Socket.IO services as the web client. All prices and trades are simulated.

## Run locally

1. Apply backend migrations 001 through 006 and start the API, PostgreSQL, and Redis.
2. Copy `.env.example` to `.env` in this folder. Set `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_SOCKET_URL` to addresses reachable from the device. A physical phone cannot use the computer's localhost. Android emulator defaults to 10.0.2.2 when no URL is supplied.
3. From the repository root: `npm ci`, then `npm run dev:mobile`.
4. Sign in with a verified backend account. Registration creates a pending account and requires email verification. Configure SMTP or use the backend's development verification workflow; the registration screen can submit a verification token.
5. Set a local PIN after first sign-in. Enable biometrics and notifications in Settings when supported.

## Native builds

- `npm run export:check --workspace @asteriq/mobile` validates Android and iOS JavaScript/Hermes bundles in `dist/`; it does not produce an APK or IPA.
- `npm run typecheck --workspace @asteriq/mobile` and `npm run test --workspace @asteriq/mobile` validate types and the session/API/trade core.
- EAS profiles in `eas.json` support development clients, internal Android APK previews, and production builds. To create a signed native build, configure your Expo/EAS project, platform credentials, and use `npx eas-cli build --profile development --platform android` (or ios). Cloud builds, credentials, and store publication are separate operations.
- Face ID and remote push require a development/native build and device testing. Remote push cannot be verified through the Android Expo Go client for this SDK.

## Organization

`index.ts` is an explicit Expo entry point so the hoisted workspace dependency does not resolve the repository root as the app.

`src/auth` contains device unlock and the testable session state machine; `src/services` contains typed REST transport, models, and exact decimal trade checks; `src/hooks` contains queries and live prices; `src/navigation` contains typed stacks and tabs; `src/components` contains reusable UI, symbol selection, and interactive SVG charts; `src/screens` groups auth, markets, trading, account, and insight features; `src/notifications` contains enrollment and restricted response routing.

Screens: Splash, Login, Register, Biometric Unlock, Dashboard, Markets, Stock Detail, Trade, Portfolio, Watchlist, AI Research, Alerts, Profile, and Settings.

## Session and device security

Refresh tokens and salted PIN verifiers use SecureStore with device-only unlocked-keychain accessibility. Access tokens remain in memory. PIN derivation uses PBKDF2-SHA256 with 310,000 iterations and random salts; failed attempts use persisted escalating cooldowns. PIN reset requires the old PIN, or a new server password login after local sign-out. Biometrics use the system prompt and do not transmit biometric data.

Cold starts remain locked until device verification. Missing PIN metadata never permits restoring a stored session. Background/inactive transitions lock the UI, discard the in-memory access token, stop sockets, and clear private query caches. Refresh is serialized, rotating refresh tokens are preserved when a background lock interrupts a request, and late responses cannot restore credentials after logout. Local unlock never substitutes for server authentication.

## Markets, charts, and orders

Live quotes use authenticated `market:subscribe` / `market:unsubscribe` subscriptions by symbol UUID and `market:quote` events. Screen blur/lock disconnects subscriptions. REST snapshots provide a five-second fallback and reconnect restores subscriptions. Quotes are batched before rendering; native SVG charts support candle/line views, drag inspection, seven time windows, volume when available, and SMA overlays. Chart history is sampled backend OHLCV, not an exchange tick feed.

Trade review captures an immutable order and idempotency key. Retrying an unknown response reuses that key; the server validates the final quote, funds, and holdings. Portfolio and order queries refresh after execution or cancellation. Client money checks use decimal BigInt arithmetic matching the ledger's four-decimal rounding. Market orders fill immediately; cancelled pending orders require the backend to have an open order.

## Push notification architecture

Enrollment is opt-in on a physical native device and requires a public EAS project ID plus APNs/FCM credentials. POST `/notifications/devices` registers an Expo token and installation UUID against the active server session; DELETE `/notifications/devices/:installationId` disables it. Tokens are not printed in logs. Logout/revocation makes devices ineligible without relying on successful client cleanup. Another account cannot take over a token attached to an active session.

Incoming notifications only navigate to Alerts, Portfolio, Watchlist, or AI Research after authentication/unlock. Payloads never automatically submit trades or open arbitrary URLs. The server gateway uses generic message text; balances, holdings, and detailed content stay behind authentication in GET `/notifications`.

Server components: `PushDeviceRepository` selects eligible sessions; `ExpoPushGateway` batches sends, obtains tickets, and fetches receipts. Production dispatch needs a durable outbox/worker with a unique notification/device job key, leases, retry backoff, ticket persistence, receipt checks, and removal of DeviceNotRegistered tokens. Keep Expo access credentials only on the server. A successful ticket is acceptance, not proof of delivery. No dispatch scheduler is started by this implementation.

## Backend boundaries and release checks

AI Research reads stored reports; model generation and alert evaluation use the existing backend worker boundaries. Remote delivery needs the dispatch worker and provider credentials. Test PIN/biometric/background flows, chart gestures, cold-launch notification routing, offline recovery, and signed builds on real devices before release.

The inherited Expo SDK 53 / React Native 0.79 toolchain currently has 41 npm audit advisories (20 moderate, 21 high). The compatible shell-quote override removes the critical advisory. Plan a coordinated Expo SDK upgrade and repeat native/device tests before a production release; an automatic forced audit fix would change incompatible SDK dependencies.
