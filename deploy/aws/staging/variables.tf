variable "region" {
  type    = string
  default = "us-east-1"
}
variable "name" {
  type    = string
  default = "farfield-staging"
  validation {
    condition     = var.name == "farfield-staging"
    error_message = "This isolated stack must use the farfield-staging namespace."
  }
}
variable "instance_type" {
  type    = string
  default = "t3a.medium"
}
variable "vpc_cidr" {
  type    = string
  default = "10.85.0.0/16"
}
