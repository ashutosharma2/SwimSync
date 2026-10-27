variable "region" {
  description = "AWS region for the design."
  type        = string
  default     = "ap-south-1"
}

variable "azs" {
  description = "Two Availability Zones: one app instance and one subnet of each tier per zone. An ALB needs at least two."
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b"]

  validation {
    condition     = length(var.azs) == 2
    error_message = "This design uses exactly two Availability Zones."
  }
}

variable "vpc_cidr" {
  description = "Address range of the whole VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "subnet_cidrs" {
  description = "One /24 per tier per zone, in the same order as var.azs. /24 is well above the ALB's /27 minimum and leaves RDS spare addresses."
  type = object({
    public = list(string)
    app    = list(string)
    db     = list(string)
  })
  default = {
    public = ["10.20.0.0/24", "10.20.1.0/24"]
    app    = ["10.20.10.0/24", "10.20.11.0/24"]
    db     = ["10.20.20.0/24", "10.20.21.0/24"]
  }
}

variable "app_port" {
  description = "Port the API listens on inside the app instances."
  type        = number
  default     = 8000
}

variable "enable_ec2messages_endpoint" {
  description = "SSM Agent 3.3.40.0 and later use ssmmessages instead of ec2messages; only older agents need this endpoint."
  type        = bool
  default     = false
}

# Step 2: load balancer, instances, database.

variable "app_ami_id" {
  description = "Machine image for the app instances, with the API, the outbox worker and their dependencies already installed (the app subnets have no internet route, so nothing can be downloaded at boot). Required: there is no safe default."
  type        = string
}

variable "app_instance_type" {
  description = "Instance type for the two app instances. Must match the image's architecture (t4g is ARM)."
  type        = string
  default     = "t4g.micro"
}

variable "db_engine_version" {
  description = "RDS PostgreSQL major version. Check which versions RDS offers in the region before any plan."
  type        = string
  default     = "17"
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_multi_az" {
  description = "Keep a standby database in the second zone. Off by default for cost (goal 5): the database is then a known single point of failure if its zone fails."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "Days of automated backups."
  type        = number
  default     = 1
}
