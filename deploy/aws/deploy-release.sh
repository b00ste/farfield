#!/bin/bash
# Run as root on the dedicated Farfield VM, through SSM. No cloud keys needed.
set -euo pipefail
commit=${1:?Usage: deploy-release.sh FULL_COMMIT GAME_DOMAIN API_DOMAIN BACKUP_BUCKET REGION}
game_domain=${2:?}
api_domain=${3:?}
backup_bucket=${4:?}
region=${5:-us-east-1}
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "Expected a full Git commit" >&2; exit 1; }
for domain in "$game_domain" "$api_domain"; do
  [[ "$domain" =~ ^[a-zA-Z0-9.-]+$ ]] || { echo "Invalid hostname" >&2; exit 1; }
done
[[ "$backup_bucket" =~ ^farfield-[a-z0-9.-]+$ ]] || { echo "Expected a dedicated Farfield bucket" >&2; exit 1; }
[[ "$region" =~ ^[a-z]+-[a-z]+-[0-9]+$ ]] || exit 1
root=/opt/farfield
release="$root/releases/$commit"
install -d -m 0755 "$root/releases"
if [[ ! -d "$release/.git" ]]; then
  git init "$release"
  git -C "$release" remote add origin https://github.com/b00ste/farfield.git
  git -C "$release" fetch --depth 1 origin "$commit"
  git -C "$release" checkout --detach FETCH_HEAD
fi
[[ "$(git -C "$release" rev-parse HEAD)" == "$commit" ]] || exit 1
umask 077
cat > "$root/production.env" <<EOF
GAME_DOMAIN=$game_domain
API_DOMAIN=$api_domain
PUBLIC_API_ORIGIN=https://$api_domain
FARFIELD_ALLOWED_ORIGINS=https://$game_domain
FARFIELD_IMAGE_TAG=$commit
EOF
compose=(docker compose --project-name farfield --env-file "$root/production.env" -f "$release/deploy/compose.yaml" -f "$release/deploy/compose.split.yaml")
"${compose[@]}" config --quiet
"${compose[@]}" build --pull
# Only replace the current release link after the immutable build succeeds.
ln -sfn "$release" "$root/current"
cat > /etc/systemd/system/farfield.service <<'EOF'
[Unit]
Description=Farfield game and HTTPS proxy
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/farfield/current
ExecStart=/usr/bin/docker compose --project-name farfield --env-file /opt/farfield/production.env -f deploy/compose.yaml -f deploy/compose.split.yaml up -d --wait --wait-timeout 180
ExecStop=/usr/bin/docker compose --project-name farfield --env-file /opt/farfield/production.env -f deploy/compose.yaml -f deploy/compose.split.yaml stop --timeout 30
TimeoutStartSec=240
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
EOF
install -m 0755 "$release/deploy/aws/backup.sh" /usr/local/bin/farfield-backup
cat > /etc/systemd/system/farfield-backup.service <<EOF
[Unit]
Description=Private Farfield room checkpoint backup
After=farfield.service

[Service]
Type=oneshot
UMask=0077
ExecStart=/usr/local/bin/farfield-backup $backup_bucket $region
EOF
cat > /etc/systemd/system/farfield-backup.timer <<'EOF'
[Unit]
Description=Daily Farfield room backup

[Timer]
OnCalendar=*-*-* 04:00:00 UTC
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable farfield.service farfield-backup.timer
# Compose drains the previous application before replacing it; saved rooms survive.
"${compose[@]}" up -d --wait --wait-timeout 180
systemctl start farfield.service farfield-backup.timer
systemctl start farfield-backup.service
printf 'Deployed Farfield commit %s\n' "$commit"
