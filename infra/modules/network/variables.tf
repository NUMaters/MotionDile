variable "name" {
  type        = string
  description = "Base name for the VPC."
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR block."
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "Public subnet CIDR blocks."
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "Private subnet CIDR blocks."
}

variable "azs" {
  type        = list(string)
  description = "Availability zones to use."
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply."
  default     = {}
}
