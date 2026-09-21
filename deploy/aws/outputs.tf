output "instance_id" { value = aws_instance.game.id }
output "public_ip" { value = aws_eip.game.public_ip }
output "vpc_id" { value = aws_vpc.game.id }
output "backup_bucket" { value = aws_s3_bucket.backups.id }
output "game_url" { value = "https://${var.game_domain}" }
output "api_url" { value = "https://${var.api_domain}" }
output "source_commit" { value = var.source_commit }
