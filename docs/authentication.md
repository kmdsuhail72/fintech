# Authentication implementation

The API authentication module lives in `apps/api/src/auth/`; schema additions are in
`database/migrations/002_authentication.sql`. Apply migrations `001`, `002`, and `003` before
starting API routes. Migration `003` creates roles; new registrations receive the baseline
`user` role. The API does not run migrations automatically.

## Routes

All routes are mounted under `/api/v1/auth`.

| Method and path                   | Purpose                                                                                                   | Client behavior                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `POST /register`                  | Create pending user, paper account, virtual wallet, portfolio, funding ledger row, and verification token | `x-client-type: web` or `mobile`; returns generic 202              |
| `POST /login`                     | Verify email/password and create a tracked session                                                        | Web receives refresh cookie; mobile receives refresh token in JSON |
| `POST /email/verify`              | Consume single-use email verification token                                                               | Token sent in request body                                         |
| `POST /email/verification/resend` | Resend verification without exposing account status                                                       | Always generic 202                                                 |
| `POST /password/forgot`           | Create a short-lived reset token and send email                                                           | Always generic 202                                                 |
| `POST /password/reset`            | Set new password and revoke all active sessions                                                           | Single-use reset token and new password                            |
| `POST /refresh`                   | Rotate refresh token and issue new access JWT                                                             | Web uses cookie; mobile sends refresh token in body                |
| `POST /logout`                    | Revoke current session and clear refresh cookie                                                           | Requires a refresh token or authenticated access token             |
| `POST /logout-all`                | Revoke every account session                                                                              | Requires bearer access token                                       |
| `GET /sessions`                   | List current user's active device/session records                                                         | Requires bearer access token                                       |
| `DELETE /sessions/:sessionId`     | Revoke one of the current user's sessions                                                                 | Requires bearer access token                                       |

Login, register, recovery, and refresh endpoints are rate-limited through Redis-backed
`express-rate-limit`. Five failed password attempts set a 15-minute per-normalized-email
lock key in Redis. Login messages do not reveal whether the email exists or is verified.

## Token and cookie handling

- Passwords use bcrypt with cost 12. Consider Argon2id if the deployment platform can support and
  benchmark its memory-hard parameters consistently. Passwords have a 12-character minimum and
  are capped at bcrypt's 72-byte UTF-8 input limit.
- Access tokens are HS256 JWTs with issuer, audience, subject, session ID, unique token ID, and
  a 10-minute expiry. Set `JWT_ACCESS_SECRET` to a random value of at least 32 characters; use
  a managed secret store in production and rotate signing keys via a planned `kid`/key-ring
  change before rotation.
- Refresh tokens are random 256-bit opaque values. Only SHA-256 hashes are stored in
  `sessions` and `refresh_tokens`. A successful refresh consumes the old hash and records a
  new hash transactionally. Reuse of a consumed token revokes its session.
- Browser refresh tokens are `HttpOnly`, `Secure` in production, `SameSite=Strict`, and path
  scoped to `/api/v1/auth`. Access JWTs are returned for the client to keep in memory. Allowed
  browser origins are explicit and credentials are enabled only for that allowlist.
- Mobile refresh tokens should be stored with Expo SecureStore and never in AsyncStorage or
  logs. The mobile client sends `x-client-type: mobile` and submits the refresh token only to
  the refresh/logout routes.
- The protected middleware verifies JWT signature/issuer/audience/expiry, checks Redis
  revocation, and checks active session state in PostgreSQL. Redis or PostgreSQL outage fails
  closed for protected requests.
- Browser state-changing auth requests require an allowlisted origin in production. Native mobile
  clients identify with `x-client-type: mobile`; they do not rely on browser cookies or CORS.

## Email configuration

Configure `SMTP_URL` and `AUTH_EMAIL_FROM` for real email delivery. Production startup rejects
missing SMTP configuration. In development, `DEV_AUTH_TOKEN_OUTPUT=true` may return one-time
tokens in the response to simplify local testing; this is disabled by default and must never be
enabled in production. Tokens are not written to logs. Verification/reset tokens are random,
hashed in PostgreSQL, expire, and are single-use.

## Mobile PIN and biometrics

`apps/mobile/src/auth/localUnlock.ts` provides device-only PIN and biometric unlock helpers.
The PIN verifier uses PBKDF2-HMAC-SHA256 with a random salt and 310,000 iterations; verifier and
refresh token storage use Expo SecureStore. Biometric prompts use Expo LocalAuthentication.

These checks only gate local UI access. They do not issue or refresh server credentials, do not
replace the API's JWT/session checks, and must not authorize trades or other sensitive server
operations. Mobile API calls still require a valid server-issued access JWT; local biometric/PIN
unlock can only reveal the app and locally stored session state.

## Security boundaries and operational notes

- Registration creates a paper account and virtual capital atomically with the user record.
  It is not a deposit and cannot be withdrawn.
- All SQL uses parameterized values. Tokens are not logged; audit records capture authentication
  events without passwords or token material.
- Account lockout and request-rate limits are Redis-backed. Redis is required for login/rate
  limit operation; authentication fails closed when it is unavailable.
- Password reset revokes all active sessions. Logout and per-device revocation update
  PostgreSQL and Redis; active-token checks also consult PostgreSQL to avoid Redis-only
  revocation correctness.
- Configure TLS, secret rotation, SMTP deliverability, retention/cleanup for expired token
  records, monitoring for lockouts and email failures, and an account recovery/support policy
  before launch.
- The database migration should be applied with a migration runner in deployment. Direct SQL
  in the runtime service does not auto-create auth tables.
