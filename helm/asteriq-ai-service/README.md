# Asteriq FastAPI chart

Runs the existing AI runtime image as UID 10001 with read-only root storage and
bounded writable `/tmp` / artifact volumes. Default port is 8000; Uvicorn follows
`service.containerPort`. Its graceful shutdown timeout is configurable.

Provide `ai-service-secrets` with `RAG_DATABASE_URL` and `OPENAI_API_KEY`.
`env.RESEARCH_BACKEND_URL` points at the owner-scoped API `/api/v1` base URL.
News-model downloads remain disabled by default. Readiness/liveness currently
check process availability, not provider/database research readiness.

Choose the environment values file and configure existing CA trust when needed.
AI Ingress remains disabled in supplied profiles; the API calls its private Service.

```powershell
helm lint helm/asteriq-ai-service --strict -f helm/asteriq-ai-service/values-production.yaml
helm template ai helm/asteriq-ai-service -f helm/asteriq-ai-service/values-production.yaml
```

Use the source repository's `helm/README.md` for platform requirements, resource
tuning, values, rollout order and Secret rotation.
