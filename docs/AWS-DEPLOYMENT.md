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
| Application release | `f6ffe31fa92d2e1667574d86918c090a50561d0c` |
| Browser build | `cef6275969e26014` |
| Runtime image | `sha256:f15e0f5ba2fd61011baab172402bb772a2602cf784d4d1cab7309a57d349f97b` |
| Node runtime | `v24.21.0` |

Cloudflare owns both DNS records, currently **DNS only** with 300-second TTL. Caddy terminates HTTPS on the instance. Cloudflare CDN/proxy protection is not enabled. Only ports 80/TCP, 443/TCP and 443/UDP are public; administration uses SSM. The game container runs as UID 1000, uses a private persistent volume and cannot obtain instance credentials through IMDSv2.

The owner confirmed that `https://farfield.fun` was added to the Reown/WalletConnect project's domain allowlist. This configuration confirmation does not replace a physical-device wallet connection test.

The runtime role has SSM registration/channel permissions and can write only the Farfield `backups/*` prefix. It has no Parameter Store access and cannot read/delete backups. Bootstrap used an existing operator credential without changing its policies; Farfield does not reuse the Phlox runtime role or network.

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
