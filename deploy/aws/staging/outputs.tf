output "instance_id" { value = aws_instance.game.id }
output "outbound_public_ip" { value = aws_instance.game.public_ip }
output "vpc_id" { value = aws_vpc.game.id }
output "security_group_id" { value = aws_security_group.game.id }
output "backup_bucket" { value = aws_s3_bucket.backups.id }
output "preview_url" { value = "https://preview.farfield.fun" }
