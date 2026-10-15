# Asteriq AI CI/CD

The pipeline publishes to AWS ECR and deploys the React web, Node.js API, and
FastAPI AI service to three existing AWS ECS Fargate services. Images use
`linux/amd64`; deployment promotes scanned image digests without rebuilding.

## Workflows

| Workflow           | Trigger                                   | Behavior                                                                                                                                                                   |
| ------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pull-request.yml` | Pull request targeting `main`             | Shared quality gates, then Docker builds and Trivy container scans for all three services. No cloud authentication or image publication.                                   |
| `main.yml`         | Push to `main`                            | Same quality gates, build and scan, assume ECR publisher role through OIDC, push images, and upload a complete `release-manifest`.                                         |
| `production.yml`   | Manual dispatch from `main` with `run_id` | Production environment approval, verify successful Main run and manifest identity, assume deploy role through OIDC, rescan digests, migrate, then deploy AI, API, and web. |

`_quality.yml` installs npm and Python dependencies, runs ESLint, Prettier,
TypeScript checks, JavaScript tests, Python tests, database integration tests,
Docker configuration tests, production builds, and Trivy dependency/secret scans.
PostgreSQL with pgvector and Redis run as isolated CI services. HIGH and CRITICAL
findings fail repository and container scans, including unfixed vulnerabilities.
Reports are retained as workflow artifacts. Actions are pinned to commit SHAs;
Dependabot proposes weekly action updates.

## AWS setup

1. Add the IAM OIDC provider `https://token.actions.githubusercontent.com` with
   audience `sts.amazonaws.com` in your AWS account.
2. Create ECR repositories `asteriq/web`, `asteriq/api`, and
   `asteriq/ai-service`. Enable immutable tags, registry scanning, encryption,
   and lifecycle retention sufficient for your rollback window.
3. Create separate publisher and production deploy roles using the policies and
   trust templates in `infrastructure/iam/`. Replace every `REPLACE_*` value.
   The publisher subject must be `repo:OWNER/REPOSITORY:ref:refs/heads/main`;
   the deploy subject must be `repo:OWNER/REPOSITORY:environment:production`.
   These templates assume GitHub's default OIDC subject format.
4. Provision three ECS Fargate services with X86_64 task definitions, ECS rolling
   deployment, `awsvpc` networking, positive desired counts, and health checks.
   The dedicated migration task uses the API service's subnet/security group settings.
   Set `ECS_MIGRATION_TASK_DEFINITION` to the Terraform deployment output. Its
   database secret, task role and execution role must differ from the API runtime.
   Populate `migration-database-url` with a migration-only database identity;
   runtime identities must not own tables or have DDL privileges.
   Give task execution roles ECR pull, CloudWatch Logs, and required secret-read
   permissions. Keep runtime secrets in Secrets Manager or SSM task definition
   `secrets`; do not place them in repository variables or Docker build arguments.
5. Configure application database, Redis, SMTP, OpenAI, and authentication
   settings in the ECS task definitions. Use managed PostgreSQL with pgvector
   and managed Redis. Configure HTTPS and service discovery/routing; web's
   `/api/v1` URL must route to the API through its Nginx upstream configuration.

No `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` GitHub secrets are needed.
OIDC grants short-lived credentials only to publishing and deployment jobs.
See [GitHub's AWS OIDC setup guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

## GitHub configuration

Set these repository Actions variables:

| Variable                   | Value                                                              |
| -------------------------- | ------------------------------------------------------------------ |
| `AWS_REGION`               | AWS region, for example `us-east-1`                                |
| `AWS_ACCOUNT_ID`           | Twelve-digit account ID                                            |
| `AWS_ECR_PUBLISH_ROLE_ARN` | Publisher role ARN                                                 |
| `ECR_PREFIX`               | Optional repository prefix; default `asteriq`                      |
| `INSTALL_NEWS_NLP`         | Optional `true` to include local NLP dependencies; default `false` |

Create the **production** GitHub environment, require reviewers, prevent
self-review, and restrict deployment branches to `main`. Set its variables:

| Variable                                                     | Value                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| `AWS_DEPLOY_ROLE_ARN`                                        | Production deploy role ARN                                    |
| `ECS_CLUSTER`                                                | Existing ECS cluster name                                     |
| `ECS_MIGRATION_TASK_DEFINITION`                              | Dedicated migration task definition ARN from Terraform        |
| `ECS_WEB_SERVICE`, `ECS_API_SERVICE`, `ECS_AI_SERVICE`       | Three distinct ECS service names                              |
| `ECS_WEB_CONTAINER`, `ECS_API_CONTAINER`, `ECS_AI_CONTAINER` | Optional container names; defaults `web`, `api`, `ai-service` |
| `SITE_URL`                                                   | Public HTTPS application URL                                  |

Account, region, and ECR prefix must match the Main run. Protect `main` with
required PR checks and review of changes to `.github/`, `scripts/ci/`, Docker,
and IAM files. Select the actual generated job names as required checks after
the first PR run. Cloud resources and environment protection are configured
outside these workflow files.

## Release and rollback

After a successful Main run, open **Production Deployment**, select `main`, and
enter that Main run's numeric ID. Approve the production environment deployment.
The release artifact expires after 30 days. Image tags include commit, run ID,
and attempt; the manifest records immutable digests and requires all services
to come from the same run attempt.

Deployment runs one dedicated migration task with the scanned API digest before changing services. A failed
migration halts deployment. Failed rollouts restore previously recorded task
definitions for services already changed; inspect `deployment-result.json`
for rollback failures and CloudWatch for application diagnostics. A prior
successful Main run can also be promoted through the same workflow while its
artifact and images remain available. Database changes are not reverted:
use backward-compatible expand/contract migrations and maintain backups.

Local verification of release validation helpers:

```sh
python -m pytest scripts/ci/tests -q -p no:cacheprovider
```

The full pipeline requires GitHub-hosted runners, registry access, and provisioned
AWS resources. This repository does not provision or deploy those resources itself.
