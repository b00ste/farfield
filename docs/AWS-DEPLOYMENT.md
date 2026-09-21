# Farfield AWS deployment — 21 September 2026

## Resources

The first Terraform apply created **19 resources, changed zero existing resources and destroyed none**. Farfield has a dedicated VPC, subnet, routing, security group, instance profile, server, encrypted disk, public IP and private backup bucket in the existing AWS account. Phlox resources were not modified.

| Item | Value |
| --- | --- |
| Region | `us-east-1` (N. Virginia) |
| Game | `https://farfield.fun` |
| API | `https://api.farfield.fun` |
| Instance | `i-010e2ab090e588b1d`, `t3a.medium`, Amazon Linux 2023 |
| VPC | `vpc-0892987923db0d8dd`, `10.84.0.0/16` |
| Elastic IP | `3.221.59.167` |
| Storage | 40 GiB encrypted gp3; retained on instance termination |
| Backup bucket | `farfield-production-backups-427297225374`, private, versioned, encrypted |
| Initial infrastructure plan commit | `2922abd8e9b4512b84be9f3c8bc33a646ce0b6b3` |
| Initial application release | `f6ffe31fa92d2e1667574d86918c090a50561d0c` |
| Initial browser build | `cef6275969e26014` |
| Initial runtime image | `sha256:f15e0f5ba2fd61011baab172402bb772a2602cf784d4d1cab7309a57d349f97b` |
| Node runtime | `v24.21.0` |

Cloudflare owns both DNS records, currently **DNS only** with 300-second TTL. Caddy terminates HTTPS on the instance. Cloudflare CDN/proxy protection is not enabled. Only ports 80/TCP, 443/TCP and 443/UDP are public; administration uses SSM. The game container runs as UID 1000, uses a private persistent volume and cannot obtain instance credentials through IMDSv2.

The owner confirmed that `https://farfield.fun` was added to the Reown/WalletConnect project's domain allowlist. This configuration confirmation does not replace a physical-device wallet connection test.

The runtime role has SSM registration/channel permissions and can write only the Farfield `backups/*` prefix. Its only Parameter Store read is the exact private RPC parameter described below; it cannot read/delete backups. Bootstrap used an existing operator credential without changing its policies; Farfield does not reuse the Phlox runtime role or network.

## Bootstrap correction

Amazon Linux's package is named `awscli-2`, not `awscli2`. The original package transaction stopped before Docker installation. The corrected bootstrap was rerun only on the new Farfield VM, and Docker, Compose's published checksum and SSM were verified. The original cloud-init failure record is preserved. No instance recreation was needed.

The infrastructure workspace owns private Terraform state at `/home/coder/farfield-infrastructure`; it is not in Git. A mode-0600 state backup is also kept privately there, and an encrypted copy is in the dedicated bucket's `infrastructure/` prefix, outside the runtime role's access. The first-apply state records the original user data: review future plans carefully, because changing EC2 user data can stop/restart the instance. Application releases use SSM and `deploy-release.sh`, not Terraform user-data updates.

## Operations

Use the [AWS runbook](../deploy/aws/README.md) for release, backup and restore commands, the [self-hosting guide](SELF-HOSTING.md) for application configuration, and the [hosting comparison](CLOUD-HOSTING.md) for provider options and cost assumptions.

Budget **$40–60/month for light beta traffic**. The approximate compute/IP/disk baseline is $34.30/month; internet transfer, S3, monitoring, tax and domain costs are extra. This is a single-server beta, not automatic failover. CloudWatch status and CPU-credit alarms exist but have no notification recipient configured.

The cold dependency build ran with essentially zero starting CPU credits and therefore took several minutes in standard mode. It completed without an out-of-memory failure or a switch to chargeable unlimited credits. A five-minute window spanning the end of the build and initial playtests averaged 9.26% instance CPU; this small sample is not a concurrent-player capacity guarantee. Continue monitoring credits before scaling invitations.

Daily private room backups are scheduled for 04:00 UTC with up to five minutes of jitter. Local match checkpoints run every five seconds and during graceful shutdown. RF deposits and payouts remain disabled. The first backup succeeded at 12:20 UTC; its S3 object was confirmed encrypted and versioned. The live snapshot has mode `0600` and UID/GID `1000:1000`. Farfield, Docker, SSM and the backup timer were all active after deployment.

A second backup at 12:23 UTC included one active test room: `backups/rooms-20260921T122315Z.json`, 51,649 bytes, encrypted with AES256 and versioned. Validation inspected counts and metadata only, without publishing room access tokens. This confirms backup creation; an off-instance disaster restore drill remains outstanding.

## Validation status

Actual Chrome verified HTTP 200 and trusted TLS 1.3 on both public domains through normal DNS, without certificate bypass. API health and the real chain-ID RPC passed. The frontend cannot serve API routes, and the API hostname cannot serve frontend assets. Real browser CORS permits the frontend and rejects an unapproved origin.

A **120-second four-browser production run passed** with 57 buildings, 76 workers, 133 commands and 2,380 state updates: zero API, page or gameplay errors. Five streams include the replacement after same-seat reload; there was one presence sync. Command p95 was approximately 250 ms from the remote test workspace, with mean browser frame intervals of 16.6–17.4 ms. Queue cancellation, reconnect, online pairing/results, submission mode and 390×844 touch controls also passed. Wallet/NFT data uses test fixtures; the game server, HTTPS, command processing and clocks are real.

The submission test's coordinate-click helper initially clicked a temporarily disabled control before the previous command completed. It now waits for enabled, stable controls like an ordinary browser automation click; the actual scaled mouse placement/dismantling checks passed afterward. No application change was needed.

A final instrumented run confirmed the control became enabled after the inspection command completed and one scaled mouse click removed the building. A separate 20-second four-client check confirmed all five event-stream requests, including reload, used `https://api.farfield.fun`; it delivered 738 updates without errors. Sanitized JSON evidence is retained under the primary checkout's ignored `artifacts/` directory.

Real MacBook/iPhone/iPad wallet switching remains a separate [device check](DEVICE-PLAYTEST.md). Physical-device performance, larger concurrency, alert delivery and a disaster restore drill are not established by these tests.

## Private RPC configuration

The private Friend RPC endpoint is stored as an AWS SSM `SecureString` at `/farfield/production/friend-rpc-url`. The value is absent from Git, Terraform state, build arguments and browser assets. A targeted Terraform plan added one Farfield inline policy allowing only `ssm:GetParameter` for this exact parameter; no existing resource was changed or deleted. Terraform's non-secret `friend_rpc_parameter` setting is retained for subsequent plans.

The release process reads the parameter on the VM after building the public image and writes `/opt/farfield/runtime.env` with mode `0600`. Docker Compose passes it only to the running game server. The parameter path is remembered across releases. Provider transport/JSON errors and JSON-RPC diagnostics are replaced with safe errors; successful replies contain only expected RPC data. The browser continues using `https://api.farfield.fun/api/friend-rpc`. Read-only method/contract restrictions and request/concurrency limits remain enabled.

The new provider passed private preflight checks for the expected chain, NFT ownership and both owner-filtered transfer histories from block zero to the current head. Provider plan quotas still apply. See the [private RPC runbook](../deploy/aws/README.md) for rotation and deployment.

Current RPC release: `f791fab56a9d8f701d4448eef7680d80849d8326`, browser build `4eceda9bc4e71fb2`, runtime image `sha256:10bff4114e9d23fb75a61408837126c033452e1d87738b02347cfee86b433ca3`. Inside-VM checks confirmed that both the running container setting and the mode-0600 runtime file match the SecureString, without printing any values. The post-deployment backup succeeded. [CI passed](https://github.com/b00ste/farfield/actions/runs/35601278436), including five RPC tests covering successful ownership/history reads, metadata stripping, provider/network/JSON failures and credential-bearing error text.

The unmocked production browser test found **42 eligible Friends and one hidden Friend** through the actual FriendSDK ownership flow. Both filtered histories spanned block zero to head; ownership, generation and canonical 64-word artwork frames succeeded. Six served HTML/JS/CSS resources and RPC responses contained no private-provider markers; there were no direct Alchemy browser requests. Five conventional source-map routes and both `/.env` and `/runtime.env` on each domain returned 404. A nonexistent-token error was sanitized. The reproducible test is `tests/production-rpc-browser.mjs`; sanitized local evidence is `artifacts/production-rpc.json`.

## PWA and HUD release

Application release `e7aa83ee81726db54edabf56239b537ad75a85e2`, browser build `f997b7f56218d829`, adds title-menu installation, app icons/manifest, offline reconnect handling and the compact HUD corrections. Deployment reused the existing Farfield VM, network, storage and runtime role. No infrastructure resources or Phlox configuration changed. Both containers and public HTTPS endpoints passed health checks; installation assets returned the expected MIME types and PNG dimensions. [Release CI passed](https://github.com/b00ste/farfield/actions/runs/35604542684), including repeated builds and production-image PWA packaging checks.

Runtime image: `sha256:aff3287ad6b505f821ede97a27de07ce91eb627995c8870d54b3d15382d78662`. The private RPC parameter was retained and safe inside-VM comparisons confirmed that both the container and mode-0600 runtime file match it. The service/backup timer remain active and the post-release backup succeeded. Wagers remain disabled. Sanitized operational evidence: `artifacts/aws-release-e7aa83ee.json`.

Post-deployment Chrome checks passed on the public domains: real installability reported zero errors; five responsive title layouts, install-event handling, offline fallback, standalone presentation, blocked storage and live match/SSE checks passed. Compact HUD checks passed contextual construction/mining icons, consistent worker glyphs, removal of clipped cost captions and hint separation across dock settings. Unmocked SDK discovery again found 42 eligible Friends plus one hidden Friend; canonical artwork, sanitized errors and private-provider secrecy checks passed. Reports: `artifacts/pwa-production.json`, `artifacts/compact-hud-production.json`, `artifacts/production-rpc-pwa-release.json`. Physical-device OS installation and external-wallet handoff remain unverified.

## Direct wallet selection release

Release `6ac15964435a99135db5964d86b56d40aca4b9a6`, browser build `f8a6f994086d2a2a`, replaces the configured Rainbow choice with Zerion and adds MetaMask. Both use the standard RainbowKit connectors; Browser Wallet, WalletConnect, the theme and private RPC remain. Existing Farfield services and public HTTPS health checks passed after the release. Both source CI runs passed before deployment. No new infrastructure or Phlox changes.

Image `sha256:3c4c99da67dae7659869a4c700301233f2e209c8d60863477396140117732e72`; safe runtime comparisons confirmed the private RPC still matches its parameter and the runtime file remains mode `0600`. Post-release backup succeeded and wagers remain disabled. Operational evidence: `artifacts/aws-release-6ac15964.json`.

Public desktop/iPad/iPhone connector checks passed direct entries and real QR/mobile-link generation. No wallet connection was approved; physical Safari handoff remains a device check, including a mobile Chromium native-launch user-gesture warning noted in VALIDATION. Evidence: `artifacts/wallet-options-production.json`.
