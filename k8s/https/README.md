# HTTPS for app.asteriq.ai and api.asteriq.ai

Implemented with **AWS ACM and AWS Load Balancer Controller**. This is locally
validated configuration for the account-free demo; no certificates have been
issued, DNS changed or listeners deployed.

| Public hostname | Route | Private destination |
| --- | --- | --- |
| `app.asteriq.ai` | `/` | Frontend/Nginx `:8080` |
| `api.asteriq.ai` | `/api/v1` | Nginx proxies to API Service `:3000` |
| `api.asteriq.ai` | `/socket.io` | Nginx proxies WebSocket traffic to API |

One Ingress owns both hosts. API and AI Services remain ClusterIP and AI has no
public Ingress. Keeping both HTTP routes behind Nginx preserves the existing
ALB-to-frontend and frontend-to-API NetworkPolicies and the proxy trust chain.
`api.asteriq.ai` is not an additional React SPA hostname; its root has no Ingress
route. Existing API paths retain their `/api/v1` prefix.

## Select the traffic profile

The existing EKS architecture uses CloudFront/WAF. Its HTTPS profile is:

```text
Browser -> CloudFront with app/API aliases -> HTTPS ALB -> Nginx -> private API
```

Merge `acm/values.yaml` and then `cloudfront/values.yaml` after production Helm
values, or use the `cloudfront/` Kustomize overlay. CloudFront redirects HTTP
viewers to HTTPS; its ALB origin exposes HTTPS 443 only. Use the foundation's
CloudFront-only security group and retain the regional origin-verification WAF
and global viewer WAF. Configure `TRUST_PROXY_HOPS=3` for this chain.

Public static-asset cache keys include the viewer Host, which is also forwarded
to the ALB. This preserves host routing and separates caches between app/API.
Asset requests omit session cookies; authenticated dynamic requests remain
uncached and forward their required viewer context.

For an ALB deployment serving browsers directly, use `acm/values.yaml` or `acm/`
Kustomize. It exposes HTTP 80 **only for the controller's HTTPS redirect**, plus
HTTPS 443. The controller manages ALB/backend security groups and HTTPS host
rules. Use `TRUST_PROXY_HOPS=2` for ALB -> Nginx -> API. The supplied direct mode
does not provision a new WAF association; associate a reviewed regional WAF for
production. The two profiles are choices for one application Ingress, not two
Ingresses to deploy simultaneously.

## Certificates and DNS validation

The EKS foundation Terraform now accepts `additional_domain_names`. Merge
`foundation.tfvars.example` with the selected foundation inputs:

```hcl
domain_name             = "app.asteriq.ai"
additional_domain_names = ["api.asteriq.ai"]
```

It requests one Amazon-issued, DNS-validated regional certificate covering:

- `app.asteriq.ai`
- `api.asteriq.ai`
- `origin.app.asteriq.ai`, for the existing CloudFront origin

Foundation creates the three ACM validation CNAME records in the supplied
Route 53 hosted zone and waits for issuance. Obtain the issued
`alb_certificate_arn` output and replace
`REPLACE_ISSUED_REGIONAL_ACM_CERTIFICATE_ARN` in the chosen profile. The ALB
certificate must be in the **same AWS Region** as the ALB. Do not put private
keys into Kubernetes Secrets for ACM termination; ACM retains the keys.

For CloudFront, merge `edge.tfvars.example` into edge inputs. The edge root
creates a separate viewer certificate in **us-east-1**, adds both aliases to
CloudFront, and creates A/AAAA Route 53 aliases for both names. Pass the
foundation-owned validation FQDNs for app and API; `certificate_validation_records`
maps hostnames to those records. Foundation is their sole DNS owner, because
ACM reuses same-account/domain validation tokens across Regions.

For direct ALB mode, populate `acm/dns-records.example.json` with the actual
controller-created ALB hostname and its **ALB hosted-zone ID**, then review the
two A aliases before applying the Route 53 change. That ID differs from the
public `asteriq.ai` hosted-zone ID used for the change request. A-only records
match this IPv4 ALB profile. Existing DNS records require a reviewed cutover;
do not have direct-mode changes and edge Terraform own the same names.

## Renewal and secure ingress

ACM manages renewal for Amazon-issued DNS-validated certificates while they
remain associated with a supported AWS service and their validation CNAMEs are
publicly resolvable. Keep every CNAME after initial validation. Renewal updates
the existing certificate in place; normal renewal does not require changing the
Ingress ARN or restarting pods. Removing validation records or detaching an
unused certificate can make renewal ineligible.
[AWS managed renewal](https://docs.aws.amazon.com/acm/latest/userguide/dns-renewal-validation.html)

The foundation includes a regional `DaysToExpiry <= 30` CloudWatch alarm routed
to its operations SNS topic. Connect and confirm its approved subscribers.
Also monitor the CloudFront viewer certificate in us-east-1, AWS Health and ACM
EventBridge renewal/expiry events. Missing certificate metrics are unknown, not
proof of successful renewal; investigate INSUFFICIENT_DATA. Verify renewal
eligibility and certificate status after listeners are attached.

Ingress settings include TLS 1.2/1.3 using
`ELBSecurityPolicy-TLS13-1-2-2021-06`, HTTP-to-HTTPS redirect, IP pod targets,
host-specific routing, invalid-header dropping, bounded draining and ALB deletion
protection. HTTPS listeners inject `Strict-Transport-Security: max-age=31536000`.
Use a controller version with listener-attribute support and matching IAM
permissions; the EKS demo pins its controller policy to v3.6.0. HSTS avoids
preload/includeSubDomains so it does not commit unconfigured hostnames.
[Controller redirect behavior](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/tasks/ssl_redirect/)

The browser configuration must be rebuilt with:

```dotenv
VITE_API_URL=https://api.asteriq.ai/api/v1
```

Use `acm/web-build.env.example` as public build-time input. Changing a runtime
pod environment variable does not rewrite an already built Vite bundle. API
CORS and authentication links are set to `https://app.asteriq.ai`; refresh
requests already include credentials. Socket.IO uses the API origin, producing
secure WebSockets. Confirm production Secure/HttpOnly cookies, CORS preflight
and WebSocket authentication in staging.

TLS terminates at ACM-backed listeners. This change secures Internet traffic;
private ALB/Nginx/API/AI links retain their existing HTTP listeners. Internal
mTLS is covered separately in the security review and is not supplied by ACM
Ingress termination.

## Render and validate locally

```powershell
# Direct ALB profile
helm template asteriq helm/asteriq-platform -f helm/asteriq-platform/values-production.yaml -f k8s/https/acm/values.yaml
kubectl kustomize k8s/https/acm

# Existing CloudFront/WAF profile
helm template asteriq helm/asteriq-platform -f helm/asteriq-platform/values-production.yaml -f k8s/https/acm/values.yaml -f k8s/https/cloudfront/values.yaml
kubectl kustomize k8s/https/cloudfront

python -m pytest scripts/kubernetes/tests/test_https.py -q
terraform -chdir=infrastructure/eks/foundation test
terraform -chdir=infrastructure/eks/edge test
```

Tests check both domains, private services, host paths, redirect/listener settings,
HSTS, CORS/proxy trust and Kyverno admission compatibility when `KYVERNO_BIN` is
set. Mock Terraform tests check regional/viewer SANs, DNS coverage and the expiry
alarm without contacting AWS. Existing demo image digests, IAM/network placeholders
and fake ARNs still need real deployment inputs before a live rollout.

After deploying from an explicitly selected context, verify:

```powershell
curl.exe -I http://app.asteriq.ai/
curl.exe -I http://api.asteriq.ai/api/v1/health
curl.exe -I https://app.asteriq.ai/
curl.exe -I https://api.asteriq.ai/api/v1/health
```

Expect HTTP redirects to the same HTTPS host/path, trusted certificates covering
both names, the HSTS header and successful HTTPS health responses. API root `/`
is intentionally not a health endpoint. Test CORS, login/refresh and authenticated
WebSockets, and ensure direct origin access stays blocked in CloudFront mode.
No live DNS, certificate, redirect or handshake result is claimed by this demo.
