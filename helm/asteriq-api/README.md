# Asteriq Node API chart

Runs the existing Node runtime image as UID 1000 with read-only root storage.
Default container/Service port is 3000. `API_PORT` follows `service.containerPort`.
Startup/liveness use `/api/v1/health`; readiness uses `/api/v1/ready`.

Provide the existing `api-secrets` Secret with `DATABASE_URL`, `REDIS_URL`,
`JWT_ACCESS_SECRET`, and `SMTP_URL`. Set a verified `env.AUTH_EMAIL_FROM` and
matching public auth/CORS URLs. Enable/mount the public RDS CA when applicable.
`env.AI_SERVICE_URL` selects the private AI Service; ingress stays disabled by default.

Choose the environment values file. Runtime migration execution is disabled:
run the existing isolated migration Job before promotion, with separate credentials.

```powershell
helm lint helm/asteriq-api --strict -f helm/asteriq-api/values-production.yaml
helm template api helm/asteriq-api -f helm/asteriq-api/values-production.yaml
```

Use the source repository's `helm/README.md` for release ordering, Secret handling,
proxy trust, configurable values and ownership handoff.
