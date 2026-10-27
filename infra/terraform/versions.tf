# SwimSync AWS design, step 1: network and security.
#
# Designed and validated only (terraform fmt, terraform validate). Never applied: the account is on
# the Paid plan, and the load balancer, instances, database and endpoints all bill by the hour.
# Before any apply, follow the cost check in docs/research/initial-research.md, section 12.

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  # No credentials here, ever. A plan would use your own AWS SSO profile from the environment.
  default_tags {
    tags = {
      Project = "SwimSync"
    }
  }
}
