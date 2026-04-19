terraform {
  backend "s3" {
    bucket         = "waniar-terraform-state-749023336797"
    key            = "dev/terraform.tfstate"
    region         = "ap-northeast-1"
    dynamodb_table = "waniar-terraform-lock"
    encrypt        = true
  }
}
