# Farfield cloud hosting

The prepared deployment runs one authoritative game server and a Caddy HTTPS proxy on a cloud VM. It is intended for an AWS Lightsail/EC2 instance or Google Compute Engine instance. No cloud resources have been provisioned. The production image, Compose configuration, nonroot runtime and container restart recovery passed [GitHub Actions run 35593772662](https://github.com/b00ste/farfield/actions/runs/35593772662). The public TLS/domain setup still needs validation on the chosen host.

Start with one Linux VM near the first playtest group, a fixed public IP, and persistent SSD storage. A provisional 2-vCPU/4-GB allocation leaves room for building the image; measure actual CPU, memory, and tick latency before increasing player capacity. This is a sizing assumption, not a measured cloud capacity guarantee. Lightsail supports a [static IP](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html) and [instance/disk snapshots](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-snapshots-in-amazon-lightsail.html). Compute Engine provides [persistent block storage](https://docs.cloud.google.com/compute/docs/disks/persistent-disks).

Use **one Farfield process and one replica**. Rooms are authoritative in that process; the snapshot file is recovery storage, not a shared database or distributed lock. Do not scale this Compose service or place multiple copies behind a load balancer. Cloud Run and autoscaling container services need a different room ownership/routing design first.

## Budget and current access

Read-only STS checks on 21 September 2026 confirmed that the existing `aws-deploy` and `kethalia-deployer` profiles authenticate. This does not verify permission to provision every required service. No cloud resources have been created.

Plan **$35–60/month** for an initial single-region public beta: one 4-GB Lightsail VM ($24/month), snapshots/off-instance backups, DNS and a small monitoring allowance. HTTPS is provided by Caddy. This retains a single-server failure boundary and needs a tested restore procedure.

A later **$150–200/month** planning allowance can cover two 4-GB instances ($48), a load balancer ($18), an encrypted high-availability managed database ($60), small staging capacity, backups and monitoring. These component prices come from [AWS Lightsail pricing](https://aws.amazon.com/lightsail/pricing/); the totals are estimates, not quotes. Region, workload and bandwidth can change costs; domain registration, taxes and overages are excluded.

The redundant setup is a future design: the current game still needs shared match storage, authoritative match ownership, routing and failover tests before two servers can safely serve it. Start with the beta configuration and size from measured concurrent matches. The owner selected `farfield.fun`. AWS region and spending approval remain open before provisioning; domain ownership and DNS access still need verification.

## Prepare the VM

1. Install Docker Engine and its Compose plugin using the [official installation guide](https://docs.docker.com/engine/install/).
2. Point a DNS hostname you control at the VM's fixed public IP. Set only an A record unless IPv6 routing is also configured.
3. Allow inbound TCP 80/443 and optionally UDP 443 for HTTP/3. Restrict SSH to the intended administrator. Port 4173 stays private to the Compose network.
4. Keep Docker's volume storage on persistent VM storage, and include that disk in backups. A named Docker volume survives container replacement; it does not by itself survive deletion of its underlying cloud disk.
5. Add the final hostname to the existing WalletConnect/Reown project's allowed origins before checking mobile wallet handoff. No referee private key or cloud credential belongs in this image or Compose file.

## Build and start

Run these commands from the repository root on the VM. The configured public hostname is `farfield.fun`; it must point to the provisioned VM before HTTPS validation.

```sh
git clone https://github.com/b00ste/farfield.git
cd farfield
export GAME_DOMAIN=farfield.fun
docker compose -f deploy/compose.yaml config --quiet
docker compose -f deploy/compose.yaml build --pull farfield
docker compose -f deploy/compose.yaml up -d
docker compose -f deploy/compose.yaml ps
curl --fail "https://${GAME_DOMAIN}/health"
```

The `GAME_DOMAIN` variable is required for every Compose invocation. It can also be stored in a VM-local environment file and passed with `--env-file`; that file must remain outside source control. Caddy obtains and renews TLS certificates when public DNS and ports are reachable, following its [automatic HTTPS rules](https://caddyserver.com/docs/automatic-https). Its certificate data lives in a separate persistent volume.

The runtime image uses Node 24 as UID 1000, with only the bundled server and built game assets copied from the build stage. The new `rooms` volume receives an owned `/data` directory on first use through [Docker volume initialization](https://docs.docker.com/engine/storage/volumes/). Reusing a manually created root-owned volume requires correcting its ownership for UID 1000 before startup. The app never needs a root entrypoint.

The Compose configuration enables `FARFIELD_STATE_PATH=/data/rooms.json`, disables RF wagers, waits for the Node HTTP healthcheck before starting the proxy, and gives the server 30 seconds to finish its shutdown snapshot. The [Compose service reference](https://docs.docker.com/reference/compose-file/services/) documents these startup and stop settings. Both services restart after an unexpected process exit. Docker marking a process unhealthy does not itself restart it; monitor health and logs.

After deployment and DNS verification, play at `https://farfield.fun/`; submission mode is `https://farfield.fun/?submission=1`. These are planned URLs, not live deployment claims.

## Verify before inviting players

```sh
docker compose -f deploy/compose.yaml logs --tail=100 farfield caddy
docker compose -f deploy/compose.yaml exec farfield node -e "fetch('http://127.0.0.1:4173/health').then(r=>r.json()).then(console.log)"
docker compose -f deploy/compose.yaml exec farfield node -e "require('node:fs').accessSync('/data',require('node:fs').constants.W_OK);console.log('State directory writable')"
```

Create a private practice match, wait for its first snapshot, then restart only `farfield` and reconnect using the same browser tab and wallet. Verify the same room, commander, buildings, and resources recover. Recovery gives surviving online seats a fresh 60-second reconnect window; the server does not simulate offline time. Checkpoints are scheduled every five seconds; a crash can lose changes since the last successful checkpoint (normally about five seconds, longer if disk writes stall or fail). Snapshot schema compatibility and corruption handling must be checked whenever the game model changes. The snapshots contain room capabilities, so keep them private.

Repeat the real four-browser playtest through the new HTTPS address, then test Safari on the owner’s MacBook, iPhone and iPad for wallet switching and tab backgrounding. The local/public-development test results do not establish the capacity or TLS configuration of this new VM.

The `.github/workflows/validate.yml` checks the Node build and then builds the container on a GitHub-hosted runner. `tests/container-smoke.mjs` starts a disposable image with a fresh anonymous volume, checks UID 1000 and private snapshot permissions, creates a practice station and worker through ordinary API commands, then stops/starts the container and verifies exact match recovery. It saves only sanitized assertions as a CI artifact. This is an HTTP/container test, not a browser, wallet, TLS, or cloud-capacity test. The script refuses to run outside GitHub Actions or the Infrastructure workspace. Do not recreate a Docker environment in the primary development workspace to run it.

## Back up, restore, and update

For a consistent operator backup, stop the game server during a scheduled pause, copy its final snapshot, then start it again. This causes a brief interruption and must be planned around active matches.

```sh
mkdir -p backups
chmod 700 backups
docker compose -f deploy/compose.yaml stop farfield
docker compose -f deploy/compose.yaml cp farfield:/data/rooms.json backups/rooms.json
chmod 600 backups/rooms.json
docker compose -f deploy/compose.yaml start farfield
```

The copy needs an existing snapshot: create a practice room first on a brand-new deployment. Copy backups to private storage outside the VM and configure cloud disk snapshots as well. Do not commit backups. Preserve Caddy's named volumes to retain certificate state. Never use `docker compose down --volumes` as an update step.

To restore a reviewed backup, stop the server, write the file as its normal UID, then start it. Restore only a snapshot compatible with the deployed build, and keep the previous backup in case recovery fails.

```sh
docker compose -f deploy/compose.yaml stop farfield
docker compose -f deploy/compose.yaml run --rm --no-deps -T farfield node -e "require('node:fs').writeFileSync('/data/rooms.json',require('node:fs').readFileSync(0),{mode:0o600})" < backups/rooms.json
docker compose -f deploy/compose.yaml start farfield
```

For an update, select a reviewed commit, build it, take the backup above, and run `docker compose -f deploy/compose.yaml up -d farfield`. Allow graceful shutdown rather than force-killing the old container. Keep the preceding image/commit for rollback and test snapshot compatibility before switching back. Track deployment commit, health, disk space, and process restarts. Real-money matches remain disabled throughout these playtests.
