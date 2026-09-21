#!/bin/bash
set -euo pipefail
bucket=${1:?Usage: backup.sh FARFIELD_BUCKET REGION}
region=${2:-us-east-1}
[[ "$bucket" =~ ^farfield-[a-z0-9.-]+$ ]] || exit 1
umask 077
snapshot=$(mktemp /tmp/farfield-backup.XXXXXXXX.json)
trap 'rm -f "$snapshot"' EXIT
docker compose --project-name farfield --env-file /opt/farfield/production.env \
  -f /opt/farfield/current/deploy/compose.yaml \
  -f /opt/farfield/current/deploy/compose.split.yaml exec -T farfield \
  node -e 'process.stdout.write(require("node:fs").readFileSync("/data/rooms.json"))' > "$snapshot"
# Check JSON without printing room capability tokens or player state to logs.
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$snapshot"
AWS_PAGER="" aws s3 cp "$snapshot" "s3://$bucket/backups/rooms-$(date -u +%Y%m%dT%H%M%SZ).json" \
  --region "$region" --sse AES256 --only-show-errors
printf 'Farfield room checkpoint backed up successfully\n'
