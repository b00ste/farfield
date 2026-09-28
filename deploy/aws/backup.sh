#!/bin/bash
set -euo pipefail
bucket=${1:?Usage: backup.sh FARFIELD_BUCKET REGION}
region=${2:-us-east-1}
[[ "$bucket" =~ ^farfield-[a-z0-9.-]+$ ]] || exit 1
umask 077
snapshot=$(mktemp /tmp/farfield-backup.XXXXXXXX.tar.gz)
trap 'rm -f "$snapshot"' EXIT
docker compose --project-name farfield --env-file /opt/farfield/production.env \
  -f /opt/farfield/current/deploy/compose.yaml \
  -f /opt/farfield/current/deploy/compose.split.yaml exec -T farfield \
  node --input-type=module - < /opt/farfield/current/deploy/aws/snapshot.mjs > "$snapshot"
# The helper validates JSON and SQLite before emitting this archive.
tar -tzf "$snapshot" >/dev/null
AWS_PAGER="" aws s3 cp "$snapshot" "s3://$bucket/backups/state-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" \
  --region "$region" --sse AES256 --only-show-errors
printf 'Farfield rooms and rankings backed up successfully\n'
