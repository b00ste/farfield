#!/bin/bash
set -euo pipefail
dnf install -y docker git awscli-2 python3
systemctl enable --now docker amazon-ssm-agent
install -d -m 0755 /usr/local/lib/docker/cli-plugins /opt/farfield
# Pinned upstream release and its published checksum; no unpinned install script.
compose_version=v2.39.4
compose_url="https://github.com/docker/compose/releases/download/$compose_version"
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
cd "$workdir"
curl --fail --location --silent --show-error "$compose_url/docker-compose-linux-x86_64" -o docker-compose-linux-x86_64
curl --fail --location --silent --show-error "$compose_url/docker-compose-linux-x86_64.sha256" -o docker-compose-linux-x86_64.sha256
sha256sum --check docker-compose-linux-x86_64.sha256
install -m 0755 docker-compose-linux-x86_64 /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version
# No repository credentials, wallet keys or application state enter user data.
# Deploy a reviewed immutable commit through SSM after provisioning and DNS setup.
