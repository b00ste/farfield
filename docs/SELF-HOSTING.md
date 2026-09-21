# Self-host Farfield

The shortest public setup is **one Linux server, Docker Compose and a domain**. Caddy provides HTTPS; the Node service serves the game and runs matches. You can use one hostname or split the frontend and API across two hostnames on the same machine.

For provider comparisons and the Farfield AWS plan, see [hosting options](CLOUD-HOSTING.md). This guide runs **free practice/custom matches**; RF wagering stays disabled. Anyone can host the source, but playing through the normal UI still requires an eligible Rare Friend and wallet.

## Try it locally

Install Node 24 and npm, then:

```sh
git clone https://github.com/b00ste/farfield.git
cd farfield
npm ci
npm run dev
```

Open `http://localhost:4173`. This builds the game and starts the server; it does not hot-reload changes. Stop it with Ctrl+C, rebuild/restart after edits. Without a snapshot path, rooms live only until that process stops.

For local room recovery, use a private path outside the built web directory:

```sh
mkdir -p .farfield
chmod 700 .farfield
FARFIELD_STATE_PATH="$PWD/.farfield/rooms.json" npm run dev
```

Other devices on the LAN can use this computer's LAN address on port 4173 if the firewall permits it. Mobile wallets may reject non-HTTPS origins; use the public HTTPS setup for real wallet switching. Do not expose an unprotected development port to the internet.

## Prepare a public server

You need a Linux server with persistent storage, administrator access, a public IP and a domain you control. Start around 2 vCPUs/4 GB RAM, then measure your workload; this is not a player-capacity guarantee. Install Docker Engine with the Compose plugin using the [official installation guide](https://docs.docker.com/engine/install/).

1. Point your chosen hostname(s) at the server's fixed public IPv4 address with DNS A records. Add AAAA records only if IPv6 routing/firewall works too.
2. Permit inbound TCP 80 and 443, optionally UDP 443 for HTTP/3. Restrict SSH to administrators. Port 4173 stays private inside Docker.
3. Keep Docker's volume storage on a persistent disk. Configure disk snapshots and a private off-server backup location.
4. Create your own Reown/WalletConnect project and add the **frontend** origin to its [allowlist](https://docs.reown.com/cloud/relay#allowlist). The project ID is public, not a secret. Use your project for an independently hosted instance.
5. Clone the repository and choose **one** of the following setups. Run all commands from its root directory.

At home, forward 80/443 from your router to the server. If the ISP uses carrier-grade NAT or blocks inbound ports, use a public VM or a deliberately configured tunnel supporting long-lived streaming; router forwarding alone will not fix it. Test wallet access over your final HTTPS origin.

## One domain: easiest setup

Replace `game.example.com` and the project ID below. Save this local configuration in `deploy/selfhost.env` and keep it out of Git:

```dotenv
GAME_DOMAIN=game.example.com
WALLETCONNECT_PROJECT_ID=your-public-project-id
```

```sh
docker compose --env-file deploy/selfhost.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/selfhost.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/selfhost.env -f deploy/compose.yaml ps
curl --fail https://game.example.com/health
```

Open `https://game.example.com`. Browser API calls use the same origin. For submission framing, append `?submission=1`.

Caddy obtains and renews certificates when DNS resolves to this machine, ports 80/443 are reachable and its certificate volume is writable. See [automatic HTTPS](https://caddyserver.com/docs/automatic-https). A self-signed localhost certificate is not a replacement for public mobile-wallet HTTPS.

## Separate game and API domains

For the Farfield production layout, both DNS records initially point at the same dedicated server:

| Record             | Destination              | Purpose                                           |
| ------------------ | ------------------------ | ------------------------------------------------- |
| `farfield.fun`     | Server's fixed public IP | Game UI, wallet connection and SDK sandbox        |
| `api.farfield.fun` | Same fixed public IP     | Game API, RPC read proxy, event stream and health |

Copy the supplied production example:

```sh
cp deploy/production.env.example deploy/production.env
```

Edit `deploy/production.env`. For your own deployment, replace both hostnames and the public WalletConnect project ID:

```dotenv
GAME_DOMAIN=farfield.fun
API_DOMAIN=api.farfield.fun
PUBLIC_API_ORIGIN=https://api.farfield.fun
FARFIELD_ALLOWED_ORIGINS=https://farfield.fun
WALLETCONNECT_PROJECT_ID=your-public-project-id
```

Then build and start with **both** Compose files:

```sh
docker compose --env-file deploy/production.env -f deploy/compose.yaml -f deploy/compose.split.yaml config --quiet
docker compose --env-file deploy/production.env -f deploy/compose.yaml -f deploy/compose.split.yaml up -d --build
docker compose --env-file deploy/production.env -f deploy/compose.yaml -f deploy/compose.split.yaml ps
curl --fail https://api.farfield.fun/health
```

Use those same `--env-file` and `-f` arguments for every subsequent operation. The split override selects `Caddyfile.split` and supplies the API origin when building the frontend. If you change the API hostname or public WalletConnect ID, **rebuild the image**; restarting an old image cannot change settings compiled into its JavaScript.

Separate domains are an organization/deployment boundary, not two independent game servers. One authoritative process still owns all rooms. Do not scale the `farfield` service above one replica.

## Configuration

| Setting                    | When / where            | Meaning                                                                           |
| -------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `GAME_DOMAIN`              | Compose / Caddy         | Frontend hostname, without `https://` or a path                                   |
| `API_DOMAIN`               | Split Compose / Caddy   | API hostname, without scheme or path                                              |
| `PUBLIC_API_ORIGIN`        | Frontend build          | Full HTTPS API origin; blank uses same-origin requests                            |
| `FARFIELD_ALLOWED_ORIGINS` | Server runtime          | Comma-separated exact frontend origins for cross-origin API access                |
| `WALLETCONNECT_PROJECT_ID` | Frontend build          | Public Reown project ID; explicitly empty means installed-wallet-only connections |
| `FARFIELD_STATE_PATH`      | Server runtime          | Absolute private snapshot path; Compose sets `/data/rooms.json`                   |
| `PORT`                     | Server runtime          | Internal HTTP port; Compose uses `4173`                                           |
| `FRIEND_RPC_URL`           | Optional server runtime | Alternate upstream RPC provider for permitted ownership/artwork reads             |
| `RF_WAGERS_ENABLED`        | Server runtime          | Keep `false` for this deployment                                                  |

Compose does not pass arbitrary shell variables to the container. For an optional runtime setting such as `FRIEND_RPC_URL`, explicitly add it through a private Compose override or your host's secret/configuration mechanism. Do not commit provider credentials. A `.env` file is not encrypted storage.

The image runs as UID 1000. New named volumes inherit the owned `/data` directory; an existing manually created root-owned volume needs its ownership corrected for that UID. The state file must remain outside `games/farfield/.friendsdk`, and readable only by the service/operator. Saved room capabilities grant access to player seats: do not publish snapshots, logs containing authorization headers, or backup files.

The browser gets no referee key, cloud credential or signer from the server. Keep any future referee secret in a separate runtime secret store and follow [ESCROW.md](ESCROW.md), not the frontend build variables.

## Verify the installation

For convenient administration, define one shell function matching your setup. **Use only the applicable version**:

```sh
# One domain:
ff() { docker compose --env-file deploy/selfhost.env -f deploy/compose.yaml "$@"; }
```

```sh
# Split domains:
ff() { docker compose --env-file deploy/production.env -f deploy/compose.yaml -f deploy/compose.split.yaml "$@"; }
```

```sh
ff ps
ff logs --tail=100 farfield caddy
ff exec farfield node -e "fetch('http://127.0.0.1:4173/health').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(console.log)"
ff exec farfield node -e "require('node:fs').accessSync('/data',require('node:fs').constants.W_OK);console.log('State directory writable')"
```

Then validate through the public address:

1. Load the menu, connect a wallet and check Friend artwork/selection.
2. Create a private practice room, join from another browser, build and recruit. Both sessions should receive updates without refresh.
3. In browser Network tools, confirm `/api/events` remains an open streaming response. This is normal; snapshots should arrive while it remains pending. Commands are separate requests. Do not add proxy buffering/caching to this endpoint.
4. Reload the same browser tab and reconnect the same wallet/Friend. Your seat should recover.
5. After a snapshot, run `ff restart farfield` during a planned test and verify the same room/buildings/resources recover. The service gives surviving online seats a fresh 60-second reconnect window; it does not simulate downtime.
6. Test Safari/macOS, iPhone and iPad wallet switching, touch placement, pinch/pan, backgrounding and rotation before inviting those devices.

For split domains, the game's requests must go to the API hostname and return CORS headers allowing the frontend origin. An HTTP 200 healthcheck alone cannot establish that browser CORS, wallet handoff or event streaming works.

Rooms expire after two inactive hours. Practice seat credentials remain in the same browser tab/session; copying the room code to a different browser does not recover that player's capability. Snapshots save practice rooms every five seconds and during graceful shutdown. A crash loses changes since the last successful write, normally around five seconds but longer if storage stalls. Paid rooms are excluded from this store.

## Backups, restore and upgrades

Define `ff` as above. Take a consistent backup during a scheduled interruption: stopping the server completes a final snapshot, and starting resumes the service.

```sh
mkdir -p backups
chmod 700 backups
ff stop farfield
ff cp farfield:/data/rooms.json backups/rooms.json
chmod 600 backups/rooms.json
ff start farfield
```

On a brand-new deployment, create a practice room first and verify the state file exists. Preserve dated copies according to your retention policy; this short example overwrites `backups/rooms.json`. Copy backups to private storage outside the server and test restore on an isolated machine. Preserve Caddy's volumes for certificate state. **Do not run `docker compose down --volumes` during an update**; it removes persistent data.

Restore only a backup compatible with the deployed game revision. Keep the previous snapshot/image available:

```sh
ff stop farfield
ff run --rm --no-deps -T farfield node -e "require('node:fs').writeFileSync('/data/rooms.json',require('node:fs').readFileSync(0),{mode:0o600})" < backups/rooms.json
ff start farfield
ff logs --tail=50 farfield
```

The one-off restore runs as the image's normal UID. Do not edit a live state file while the server may overwrite it. Invalid/corrupt state fails startup rather than silently erasing matches; investigate the file and retain it before attempting recovery.

For an upgrade, fetch and check out a reviewed tag/commit, build with `ff build --pull farfield`, make the backup above, then run `ff up -d farfield`. Allow the configured graceful shutdown interval. Record the deployed commit and retain the prior image/commit; test schema compatibility before rolling back. Updating a single authoritative server causes a brief reconnect, not a zero-downtime rolling release.

Both services restart after unexpected process exit. An unhealthy Docker healthcheck does not itself trigger a restart; monitor health, logs, disk space, snapshot failures and restarts. Review host/package updates and backup retention regularly.

## Troubleshooting

| Symptom                                               | Check                                                                                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS certificate fails                               | Public A/AAAA records, TCP 80/443, another process already binding those ports, and Caddy logs. Start DNS-only if a CDN proxy obscures initial origin validation.                |
| Menu loads but cannot create/join a match             | Browser request destination, rebuilt `PUBLIC_API_ORIGIN`, API DNS/TLS, exact `FARFIELD_ALLOWED_ORIGINS`, and server health.                                                      |
| State updates arrive in bursts / repeatedly reconnect | Proxy buffering, response compression/buffering at an extra CDN, stream/idle timeouts, `/api/events` caching or rate limits. Keep API responses uncached and preserve streaming. |
| Wallet QR or mobile handoff fails                     | Your project ID and frontend-origin allowlist, HTTPS, wallet/network support, popup restrictions and a real-device test.                                                         |
| No Friends / artwork cannot load                      | Wallet ownership/eligibility and `/api/friend-rpc` availability/upstream RPC errors. An empty roster is not proof of wallet disconnection.                                       |
| Rooms reset after restart                             | Snapshot path enabled, mounted persistent volume, writable `/data`, successful writes, unchanged volume name and compatible state schema.                                        |
| Server exits while loading state                      | Preserve the original file; inspect logs for invalid/corrupt snapshots or permissions. Restore a compatible known-good backup; do not discard state to hide the problem.         |
| Health returns storage failure                        | Disk full/unwritable or checkpoint error. Restore writable storage before treating the server as healthy.                                                                        |
| Game lags under load                                  | CPU/tick latency, memory, stream delivery and disk writes. Reduce admitted load or increase the single instance's capacity; adding uncoordinated replicas breaks rooms.          |

For an existing reverse proxy, route the frontend and API hostnames to this server's private HTTP port and preserve streaming. Do not expose port 4173 publicly in addition to HTTPS. The supplied Caddy deployment handles TLS for itself; avoid starting it on ports already occupied by another proxy.
