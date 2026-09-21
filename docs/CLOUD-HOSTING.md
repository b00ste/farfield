# Hosting options

Farfield needs a continuously running Node game server. For a first deployment, use **one Linux VM with Docker Compose, Caddy HTTPS and persistent storage**. Start with the [self-hosting guide](SELF-HOSTING.md); the same commands work on a cloud VM or a server you own.

The production addresses are **`https://farfield.fun` for the game** and **`https://api.farfield.fun` for its API and event stream**. Separate domains do not require separate machines: both can point at one dedicated VM. The browser loads the FriendSDK host and sandbox from the game domain; the trusted host talks to the API domain. Wallet signing remains in the browser.

## Choose a deployment

| Option                                               | Setup                                                                          | Tradeoff / support status                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local development                                    | Node 24, `npm ci`, `npm run dev`                                               | Fastest way to try or modify the game. Not a persistent public service.                                                                                 |
| Your own Linux server / home server                  | Docker Compose, domain, public address, forwarded 80/443                       | Uses the supplied deployment. You manage power, connectivity, updates and backups. Carrier-grade NAT may prevent inbound access.                        |
| AWS Lightsail                                        | Linux VM, static IP, snapshots, supplied Compose                               | Straightforward beta option with bundled pricing. One server remains one failure boundary.                                                              |
| AWS EC2                                              | Dedicated VPC/security group, VM, Elastic IP, EBS, supplied Compose            | More control over networking, IAM and monitoring; more components and separately billed items.                                                          |
| GCP Compute Engine                                   | Dedicated project/network, VM, reserved IP, persistent disk, supplied Compose  | Equivalent VM architecture; use Google's pricing calculator for the chosen region and traffic.                                                          |
| Other Linux VPS providers                            | Ubuntu/Debian VM, persistent disk, fixed IP, supplied Compose                  | The application is provider-neutral. Check CPU, transfer allowance, backups and support terms.                                                          |
| Managed container host                               | One always-on service, persistent `/data`, public HTTPS, streaming HTTP        | Possible with suitable plans, but no provider-specific deployment manifest is supplied. Verify restart/deploy behavior and SSE before inviting players. |
| Static frontend + separate Node backend              | Publish the complete built frontend to a CDN; keep one persistent Node service | Supported origin configuration; requires explicit API CORS and deployment coordination. CDN caching helps assets, not simulation latency.               |
| Multiple game replicas / automatic regional failover | Shared state, match ownership and routing redesign                             | **Not supported by the current server.** A load balancer or shared snapshot file cannot make independent room processes consistent.                     |
| Static-only hosting or request-scoped functions      | No continuously running simulation                                             | **Not sufficient.** GitHub Pages alone, for example, cannot run matches.                                                                                |

The supplied Docker image and single-host Compose restart/recovery setup passed [container CI](https://github.com/b00ste/farfield/actions/runs/35593772662). This does not mean every provider in this table has been deployed or capacity-tested. The split-domain deployment must also pass public DNS, TLS, CORS, event-stream and real-device checks.

## AWS plan for farfield.fun

The dedicated AWS deployment and its operational details are recorded in [AWS-DEPLOYMENT.md](AWS-DEPLOYMENT.md). The guidance below also applies to preparing a new installation.

Use **US East (N. Virginia), `us-east-1`**, as an initial single-region choice for the expected North American and European audience. This is a starting assumption, not a latency measurement. Measure both audiences after launch; moving the single server changes latency for all matches. Do not run independent copies in NA and EU until players and rooms can be assigned to an authoritative region.

Provision Farfield separately from Phlox:

- Dedicated Farfield VM, disk, public IP, firewall/security group and backup schedule; dedicated VPC when using EC2.
- Dedicated DNS records for the two Farfield hostnames; no changes to Phlox records, services or shared ingress rules.
- Farfield-specific resource names/tags, deployment identity, runtime permissions and cost tracking. The game container needs no AWS credentials.
- Dedicated private backup destination and narrowly scoped access. Keep snapshots, wallet configuration and cloud credentials separate.
- A deployment record naming the region, instance, public IP, commit and backup/restore procedure. Record verified live status after deployment, not merely after resource creation.

A shared AWS account with separate resources is **resource isolation**, not an account-level security or billing boundary. A separate AWS account provides a stronger boundary if that becomes necessary. See [AWS account isolation guidance](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/benefits-of-using-multiple-aws-accounts.html).

### Budget

The supplied [dedicated EC2 stack](../deploy/aws/README.md) targets **$40–60/month** for light beta traffic. Its approximate fixed baseline in `us-east-1`, using 730 hours per month, is:

| Item                                                | Monthly estimate |
| --------------------------------------------------- | ---------------: |
| Linux `t3a.medium`, 2 vCPU / 4 GiB, at $0.0376/hour |           $27.45 |
| One public IPv4 address at $0.005/hour              |            $3.65 |
| 40 GiB gp3 storage at $0.08/GiB-month               |            $3.20 |
| Compute, IPv4 and disk subtotal                     |       **$34.30** |

S3 storage/requests, monitoring, internet egress, domain registration and taxes are additional. **EC2 does not include Lightsail's bundled transfer allowance.** Check account-wide transfer use and the current regional quote; sustained SSE traffic can make bandwidth significant. The stack uses standard CPU credits, so it cannot incur unlimited-credit surcharges, but it can throttle under sustained load. See official [T3/T3a prices](https://aws.amazon.com/ec2/instance-types/t3/), [IPv4 pricing](https://aws.amazon.com/vpc/pricing/), [EBS pricing](https://aws.amazon.com/ebs/pricing/) and [EC2 transfer pricing](https://aws.amazon.com/ec2/pricing/on-demand/).

For an alternative Lightsail deployment, a Linux bundle with 2 vCPUs, 4 GB RAM, 80 GB storage and public IPv4 is listed at **$24/month**; a **$35–60/month** total allowance leaves room for backups and monitoring. See [Lightsail bundles](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html). Neither machine size is a measured concurrent-player guarantee.

A future **$150–200/month** allowance could cover two such instances ($48), a load balancer ($18), an encrypted HA managed database ($60), small staging capacity, backups and monitoring. This is a planning estimate using [AWS pricing](https://aws.amazon.com/lightsail/pricing/), **not a supported redundant Farfield deployment today**. Match ownership, shared storage and failover tests must come first. Region, traffic and overages affect costs; estimates exclude domain registration and taxes. EC2/GCP configurations need their own quotes rather than inheriting Lightsail's bundled price.

### VM provider setup

**Lightsail:** create a dedicated Linux instance, attach a [static IP](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html), configure its firewall and [snapshots](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-snapshots-in-amazon-lightsail.html), then follow the self-hosting guide. Never reuse a production instance belonging to another application.

**EC2:** use the supplied [dedicated Terraform deployment](../deploy/aws/README.md), or follow the [EC2 launch guide](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EC2_GetStarted.html) manually. The supplied stack creates its own VPC, encrypted persistent EBS, Elastic IP and SSM administration role; it exposes only HTTP/HTTPS and keeps SSH and port 4173 closed. Account for EBS, public IPv4, data transfer and backups separately.

**Compute Engine:** [create a Linux VM](https://docs.cloud.google.com/compute/docs/instances/create-start-instance) in the chosen region with persistent storage, a reserved external IP and Farfield-specific firewall rules. Configure disk snapshots and a private backup destination, install Docker/Compose and follow the same guide. A dedicated GCP project helps separate ownership, permissions and costs.

## Managed containers

A host must provide a continuously running process, persistent writable storage, graceful SIGTERM handling, custom-domain HTTPS and unbuffered long-lived HTTP responses. Use one replica; disable automatic scale-to-zero. Deployments must stop the old authoritative process before a replacement writes the same room store. A generic rolling deployment may temporarily create two inconsistent servers.

For example, [Render persistent disks](https://render.com/docs/disks) have single-instance and deployment constraints that must be considered, while [Fly machine counts](https://fly.io/docs/launch/scale-count/) must be deliberately kept at one. These are deployment candidates, not configurations validated by this repository. Managed service prices are not included in the VM estimate.

Cloud Run's connection timeouts and best-effort affinity require reconnect and external state coordination; it is not a drop-in multi-instance host for this in-memory simulation. See [Google's long-lived connection guidance](https://docs.cloud.google.com/run/docs/triggering/websockets). SSE transport does not remove the same underlying match-ownership problem.

## Static frontend with a separate backend

This can use a static CDN/object-storage site for the game and a VM or suitable managed service for the backend. Keep **all** of `games/farfield/.friendsdk/` together: it contains the trusted host, SDK sandbox HTML, scripts, styles and assets.

Build with your API origin and WalletConnect project ID:

```sh
PUBLIC_API_ORIGIN=https://api.example.com \
WALLETCONNECT_PROJECT_ID=your-public-project-id \
npm run build
```

Publish the contents of `games/farfield/.friendsdk/` at the frontend's root, with correct MIME types and HTTPS. Keep `game.html` and its assets accessible on that same frontend origin; do not move the sandbox to the API domain. Avoid a blanket SPA fallback that rewrites missing script requests to HTML. Set a short/no-cache policy on HTML so releases do not keep booting old builds; the bundled files are not content-hashed filenames, so do not use year-long immutable caching without a version-aware cache policy.

Run `dist/server.mjs` as a continuously running service with `FARFIELD_ALLOWED_ORIGINS=https://game.example.com`, `FARFIELD_STATE_PATH` pointing at private persistent storage. Keep the generated game directory available to the server as well, or use the supplied image. Route backend HTTPS to its configured `PORT` (4173 by default), and forward `/api/*` plus `/health` without caching or buffering `/api/events`.

The frontend API origin is a **build-time setting**; changing only the server environment does not update a published client. Deploy matching frontend and server revisions together. The server allowlist uses exact origins, including scheme and any nonstandard port. Never use a wildcard to make a configuration mistake disappear. See the [self-hosting configuration and verification steps](SELF-HOSTING.md#configuration).

## Capacity and operations

Monitor HTTP health, process restarts, CPU, memory, disk space, event-stream disconnects, command latency and snapshot failures. The server has bounded room/request limits; those are protective ceilings, not advertised player capacity. Public four-browser tests establish a regression baseline, not an unlimited-user or multi-region SLA.

Follow the [backup, restore and upgrade procedure](SELF-HOSTING.md#backups-restore-and-upgrades). Retain off-instance backups and periodically restore to an isolated instance before trusting recovery. A Docker volume survives container replacement but cannot survive deletion of its underlying disk without a backup.
