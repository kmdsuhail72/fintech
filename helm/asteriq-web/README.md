# Asteriq frontend chart

Runs the existing React runtime image using non-root Nginx, a read-only filesystem,
and a generated configuration in `/tmp`. Default container/Service port is 8080.
`env.API_UPSTREAM` selects the private API Service. Build the image with
`VITE_API_URL=/api/v1`; runtime values cannot rewrite an already compiled Vite URL.

Choose `values-dev.yaml`, `values-staging.yaml` or `values-production.yaml`.
Staging/production enable frontend ALB Ingress; configure its domain and ACM ARN.
The chart packages its Nginx template and supports custom container ports.

```powershell
helm lint helm/asteriq-web --strict -f helm/asteriq-web/values-production.yaml
helm template web helm/asteriq-web -f helm/asteriq-web/values-production.yaml
```

Use the source repository's `helm/README.md` for the configuration reference,
platform prerequisites, release ordering and ownership migration instructions.
