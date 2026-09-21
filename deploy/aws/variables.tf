variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  type    = string
  default = "farfield-production"
  validation {
    condition     = can(regex("^farfield-[a-z0-9-]+$", var.name))
    error_message = "Use a Farfield-specific resource prefix, such as farfield-production."
  }
}

variable "instance_type" {
  type    = string
  default = "t3a.medium"
}

variable "vpc_cidr" {
  type    = string
  default = "10.84.0.0/16"
}

variable "game_domain" {
  type    = string
  default = "farfield.fun"
}

variable "api_domain" {
  type    = string
  default = "api.farfield.fun"
}

variable "source_commit" {
  description = "Exact public b00ste/farfield Git commit to deploy; never a floating branch."
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.source_commit))
    error_message = "source_commit must be a full 40-character Git commit SHA."
  }
}
