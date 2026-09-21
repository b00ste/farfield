#!/bin/bash
# Staging only: stop the writer while copying the SQLite database and journals.
set -euo pipefail
bucket=${1:?Usage: backup.sh FARFIELD_STAGING_BUCKET REGION}
region=${2:-us-east-1}
[[ "$bucket" =~ ^farfield-staging-backups-[0-9]{12}$ ]] || exit 1
root=/opt/farfield-staging
compose=(docker compose --project-name farfield-staging --env-file "$root/staging.env" -f "$root/current/deploy/aws/staging/compose.yaml")
umask 077
workdir=$(mktemp -d /tmp/farfield-staging-backup.XXXXXXXX)
restart_needed=0
cleanup() {
  if [[ "$restart_needed" == 1 ]]; then "${compose[@]}" start farfield; fi
  rm -rf "$workdir"
}
trap cleanup EXIT
"${compose[@]}" stop --timeout 30 farfield
restart_needed=1
mkdir "$workdir/data"
"${compose[@]}" cp farfield:/data/. "$workdir/data/"
# The writer is stopped, so a database plus any WAL/SHM files is a consistent set.
python3 - "$workdir/data" <<'PY'
import json, pathlib, sqlite3, sys
root = pathlib.Path(sys.argv[1])
json.loads((root / 'rooms.json').read_text())
db = root / 'rankings.sqlite'
if db.exists():
    con = sqlite3.connect(db)
    assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    con.close()
PY
"${compose[@]}" start farfield
restart_needed=0
tar -C "$workdir/data" -czf "$workdir/state.tar.gz" .
AWS_PAGER="" aws s3 cp "$workdir/state.tar.gz" \
  "s3://$bucket/backups/state-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" \
  --region "$region" --sse AES256 --only-show-errors
printf 'Private staging state backup succeeded\n'
