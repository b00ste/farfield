#!/bin/bash
# Run as root on the dedicated Farfield VM, through SSM. No cloud keys needed.
set -euo pipefail
commit=${1:?Usage: deploy-release.sh FULL_COMMIT GAME_DOMAIN API_DOMAIN BACKUP_BUCKET REGION [FRIEND_RPC_PARAMETER]}
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
friend_rpc_parameter=${6-}
if [[ $# -lt 6 && -f "$root/friend-rpc-parameter" ]]; then
  friend_rpc_parameter=$(cat "$root/friend-rpc-parameter")
fi
if [[ -n "$friend_rpc_parameter" && ! "$friend_rpc_parameter" =~ ^/farfield/[a-z0-9-]+/friend-rpc-url$ ]]; then
  echo "Expected a Farfield-specific Friend RPC parameter path" >&2
  exit 1
fi
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
candidate_env="$root/release-$commit.env"
cat > "$candidate_env" <<EOF
GAME_DOMAIN=$game_domain
API_DOMAIN=$api_domain
PUBLIC_API_ORIGIN=https://$api_domain
FARFIELD_ALLOWED_ORIGINS=https://$game_domain
FARFIELD_IMAGE_TAG=$commit
FARFIELD_RUNTIME_ENV_FILE=$root/runtime.env
EOF
compose=(docker compose --project-name farfield --env-file "$candidate_env" -f "$release/deploy/compose.yaml" -f "$release/deploy/compose.split.yaml")
"${compose[@]}" config --quiet
"${compose[@]}" build --pull
# Fetch only on the host after the public image is built. Neither the parameter
# value nor this private env file can enter Docker's build context or build args.
if [[ -n "$friend_rpc_parameter" ]]; then
  rpc_candidate=$(mktemp "$root/runtime-candidate.XXXXXXXX.env")
  trap 'rm -f "$rpc_candidate"' EXIT
  AWS_PAGER="" aws ssm get-parameter --name "$friend_rpc_parameter" \
    --with-decryption --region "$region" --output json | python3 -c '
import json, os, sys, urllib.parse
try:
    value = json.load(sys.stdin)["Parameter"]["Value"]
    if not isinstance(value, str) or any(ord(char) < 33 or ord(char) == 127 for char in value):
        raise ValueError()
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError()
    with open(sys.argv[1], "w", encoding="utf8") as stream:
        stream.write("FRIEND_RPC_URL=" + value + "\n")
    os.chmod(sys.argv[1], 0o600)
except Exception:
    sys.exit("Could not prepare the private Friend RPC configuration")
' "$rpc_candidate"
  install -m 0600 "$rpc_candidate" "$root/runtime.env"
elif [[ $# -ge 6 || ! -f "$root/runtime.env" ]]; then
  # An explicit empty sixth argument disables this override; omission preserves
  # an existing manually managed runtime file when no parameter was configured.
  install -m 0600 /dev/null "$root/runtime.env"
fi
printf '%s\n' "$friend_rpc_parameter" > "$root/friend-rpc-parameter"
chmod 0600 "$root/friend-rpc-parameter"
# Only replace the current release link after the immutable build succeeds.
install -m 0600 "$candidate_env" "$root/production.env"
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
