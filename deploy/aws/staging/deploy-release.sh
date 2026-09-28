#!/bin/bash
# Run through SSM on the dedicated STAGING instance only. No public ports.
set -euo pipefail
commit=${1:?Usage: deploy-release.sh FULL_COMMIT STAGING_BACKUP_BUCKET REGION}
bucket=${2:?}
region=${3:-us-east-1}
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ "$bucket" =~ ^farfield-staging-backups-[0-9]{12}$ ]] || exit 1
[[ "$region" =~ ^[a-z]+-[a-z]+-[0-9]+$ ]] || exit 1
# Refuse to run on the production host even if invoked with staging arguments.
[[ ! -e /opt/farfield/production.env ]] || { echo 'Refusing staging release on production host' >&2; exit 1; }
root=/opt/farfield-staging
release="$root/releases/$commit"
install -d -m 0700 "$root"
install -d -m 0755 "$root/releases"
if [[ ! -d "$release/.git" ]]; then
  git init "$release"
  git -C "$release" remote add origin https://github.com/b00ste/farfield.git
  git -C "$release" fetch --depth 1 origin "$commit"
  git -C "$release" checkout --detach FETCH_HEAD
fi
[[ "$(git -C "$release" rev-parse HEAD)" == "$commit" ]] || exit 1
umask 077
candidate_env="$root/release-$commit.env"
printf 'FARFIELD_IMAGE_TAG=%s\n' "$commit" > "$candidate_env"
compose=(docker compose --project-name farfield-staging --env-file "$candidate_env" -f "$release/deploy/aws/staging/compose.yaml")
# Secure runtime files are mandatory; fetch without printing values.
python3 - "$root" "$region" <<'PY'
import json, os, pathlib, subprocess, sys, urllib.parse
root, region = pathlib.Path(sys.argv[1]), sys.argv[2]
def parameter(name):
    try:
        return json.loads(subprocess.check_output(['aws','ssm','get-parameter','--name',name,'--with-decryption','--region',region,'--output','json'], stderr=subprocess.DEVNULL))['Parameter']['Value']
    except Exception:
        sys.exit('Could not read private staging configuration')
rpc = parameter('/farfield/staging/friend-rpc-url')
token = parameter('/farfield/staging/tunnel-token')
if urllib.parse.urlsplit(rpc).scheme != 'https' or any(ord(c) < 33 for c in rpc) or not token.strip():
    sys.exit('Invalid private staging configuration')
for filename, value, mode, owner in [('runtime.env','FRIEND_RPC_URL='+rpc+'\n',0o600,0),('tunnel-token',token.strip(),0o400,65532)]:
    path = root / filename
    fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, mode)
    with os.fdopen(fd,'w') as stream: stream.write(value)
    os.chmod(path, mode)
    os.chown(path, owner, owner)
PY
"${compose[@]}" config --quiet
"${compose[@]}" build --pull farfield
install -m 0600 "$candidate_env" "$root/staging.env"
ln -sfn "$release" "$root/current"
cat > /etc/systemd/system/farfield-staging.service <<'UNIT'
[Unit]
Description=Private Farfield staging through Cloudflare Tunnel
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/farfield-staging/current
ExecStart=/usr/bin/docker compose --project-name farfield-staging --env-file /opt/farfield-staging/staging.env -f deploy/aws/staging/compose.yaml up -d --wait --wait-timeout 180
ExecStop=/usr/bin/docker compose --project-name farfield-staging --env-file /opt/farfield-staging/staging.env -f deploy/aws/staging/compose.yaml stop --timeout 30
TimeoutStartSec=240
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
UNIT
install -m 0755 "$release/deploy/aws/staging/backup.sh" /usr/local/bin/farfield-staging-backup
cat > /etc/systemd/system/farfield-staging-backup.service <<UNIT
[Unit]
Description=Private Farfield staging snapshot and SQLite backup
After=farfield-staging.service

[Service]
Type=oneshot
UMask=0077
ExecStart=/usr/local/bin/farfield-staging-backup $bucket $region
UNIT
cat > /etc/systemd/system/farfield-staging-backup.timer <<'UNIT'
[Unit]
Description=Daily private staging backup

[Timer]
OnCalendar=*-*-* 04:30:00 UTC
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable farfield-staging.service farfield-staging-backup.timer
"${compose[@]}" up -d --wait --wait-timeout 180
systemctl start farfield-staging.service farfield-staging-backup.timer
systemctl start farfield-staging-backup.service
printf 'Private Farfield staging deployed at %s\n' "$commit"
