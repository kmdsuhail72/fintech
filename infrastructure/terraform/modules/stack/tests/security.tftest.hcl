mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_region" {
    defaults = { region = "ap-south-1" }
  }
}

variables {
  environment        = "production"
  region             = "ap-south-1"
  account_id         = "123456789012"
  vpc_cidr           = "10.22.0.0/16"
  azs                = ["ap-south-1a", "ap-south-1b"]
  zone_id            = "Z0123456789"
  domain_name        = "production.example.com"
  auth_email_from    = "notifications@example.com"
  log_retention_days = 90
  redis_auth_token   = "TestOnlyNotARealSecret123456789012"
  images = {
    web        = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/asteriq-production/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    api        = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/asteriq-production/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    ai-service = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/asteriq-production/ai-service@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}

run "production_plan" {
  command = plan
  assert {
    condition     = module.ecs.cluster_name == "asteriq-production"
    error_message = "Production resources must be namespaced."
  }
  assert {
    condition     = length(output.observability.dashboards) == 2 && output.observability.slos["api-availability"].goal == 0.999
    error_message = "Production must expose operations/SLO dashboards and the API availability objective."
  }
}

run "reject_single_nat_production" {
  command = plan
  variables {
    nat_per_az = false
  }
  expect_failures = [terraform_data.guardrails]
}

run "reject_wrong_account_images" {
  command = plan
  variables {
    images = {
      web        = "999999999999.dkr.ecr.ap-south-1.amazonaws.com/asteriq-production/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      api        = "999999999999.dkr.ecr.ap-south-1.amazonaws.com/asteriq-production/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      ai-service = "999999999999.dkr.ecr.ap-south-1.amazonaws.com/asteriq-production/ai-service@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }
  expect_failures = [terraform_data.guardrails]
}
