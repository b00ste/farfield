# Private ranked-play staging

This is a separate AWS stack for `https://preview.farfield.fun`, with the game and API on the **same origin**. It does not deploy to `farfield.fun` or `api.farfield.fun` and does not share production match/ranking storage, instance roles, networks or backups.

The staging EC2 security group has **no inbound rules**. The Node service publishes no host port. A dedicated outbound Cloudflare Tunnel reaches it over Docker's private network. Cloudflare Access protects the entire preview hostname, including the API, health endpoint and game assets; the tunnel additionally validates Access JWTs before forwarding requests. The instance's public address supports outbound downloads/SSM only and cannot bypass the private access gate.

## Cost and isolation

Default: one `t3a.medium`, 40 GiB encrypted gp3, public IPv4 for outbound connectivity, and a private versioned backup bucket in `us-east-1`. Allow approximately **$35–50/month** at light test traffic, separate from production. The approximate compute/IP/disk baseline is $34.30/month; S3 retention, transfer, monitoring, taxes and any Cloudflare plan charges are additional. See [EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/). No NAT gateway, load balancer, Elastic IP or managed database is required.

Terraform's `farfield-staging` prefix is fixed deliberately. Use a **separate working directory and state** from production; never copy production state into this stack. All infrastructure mutations should be new staging resources. Destruction protection and retained data disks are intentional; teardown requires an explicit review of exact targets.

## Prepare access before connecting the tunnel

1. Create a dedicated self-hosted Cloudflare Access application for `preview.farfield.fun`, without path exclusions. Leave it deny-all until the approved tester-domain allowlist is configured. Use the existing organization and email one-time-PIN provider; do not change other applications' policies.
2. Enable iframe support for the FriendSDK sandbox. Validate Access session-cookie behavior with its sandboxed assets; use a secure `SameSite=None` cookie when required. Keep the API same-origin so trusted-host requests send the same Access session cookie.
3. Add an Allow policy containing only the explicitly approved `kethalia.com` email domain. This permits verified email addresses ending in `@kethalia.com`; do not add Everyone, a public bypass, or additional domains. For automation, use a dedicated preview-only service token and Service Auth policy; keep its credentials outside source and test reports.
4. Create a dedicated remotely managed tunnel named `farfield-staging`. Configure only this ingress, followed by a catch-all `http_status:404`:

```json
{
  "hostname": "preview.farfield.fun",
  "service": "http://farfield:4173",
  "originRequest": {
    "access": {
      "required": true,
      "teamName": "YOUR_ZERO_TRUST_TEAM",
      "audTag": ["THE_PREVIEW_APPLICATION_AUD"]
    }
  }
}
```

5. Route only the new `preview` DNS name to that tunnel; leave production DNS untouched. Protect the Access application **before** enabling the public hostname.
6. Store the tunnel token as `/farfield/staging/tunnel-token` in AWS SSM Parameter Store (`SecureString`). Store the private RPC URL independently at `/farfield/staging/friend-rpc-url`. Values never belong in Terraform, shell arguments, Git, logs or browser bundles. The staging instance role can read only these two exact parameter paths.

Cloudflare documents [origin JWT enforcement](https://developers.cloudflare.com/tunnel/reference/origin-parameters/#access) and [email OTP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/). Access plus the zero-ingress firewall are both required: obscuring a URL alone does not make the preview private.

## Provision a dedicated staging VM

Use the Infrastructure workspace or your infrastructure administration environment. Keep state in a private directory, outside the public checkout.

```sh
cd deploy/aws/staging
cp staging.tfvars.example staging.tfvars
terraform init
terraform fmt -check
terraform validate
terraform plan -var-file=staging.tfvars -out=staging.tfplan
terraform show -json staging.tfplan | python3 ../check-plan.py
```

Review the plan: all resources must be new `farfield-staging` resources, no ingress rules, no production resource references or mutations. Apply only the reviewed plan:

```sh
terraform apply staging.tfplan
terraform output
```

Wait for the new instance's SSM agent and bootstrap to finish. No SSH port is opened. The existing production release script is **not** used here.

## Deploy a reviewed application commit

On the dedicated staging instance, through SSM, run the staging release script from the exact reviewed public commit:

```sh
bash deploy/aws/staging/deploy-release.sh FULL_40_CHARACTER_COMMIT \
  farfield-staging-backups-ACCOUNT_ID us-east-1
```

The script rejects the production host, retrieves only staging SSM parameters, builds a staging-tagged image, and installs independent `farfield-staging` and backup services. The tunnel token is a private file mounted into the connector, never a command-line argument or Docker image layer. App/room/ranking state lives in the `farfield-staging_state` volume.

The release enables:

```dotenv
FARFIELD_RANKED_ENABLED=1
FARFIELD_RANKINGS_PATH=/data/rankings.sqlite
FARFIELD_RANKED_ORIGIN=https://preview.farfield.fun
FARFIELD_STATE_PATH=/data/rooms.json
FARFIELD_ALLOWED_ORIGINS=https://preview.farfield.fun
```

`PUBLIC_API_ORIGIN` stays empty at build time. The public production server must not receive these staging settings. Add the preview frontend origin to the WalletConnect project's allowed origins before real mobile-wallet testing.

## Verify privacy and gameplay

Before sharing the preview:

- Unauthenticated requests to the menu, scripts, API and event stream must hit Access rather than game content. An invalid Access credential must fail too.
- Connect directly to the VM address on 80, 443 and 4173: none should expose the game. Confirm the AWS ingress-rule list is empty and Docker publishes no ports.
- Authenticate an approved email; verify the menu, SDK sandbox, wallet artwork and same-origin API/event stream. An unapproved email must not gain access.
- Check the tunnel's `access.required`, team and application audience settings. The catch-all ingress must return 404.
- Play ranked matches between separate verified identities, then reconnect and restart staging to verify match/rating persistence. Test four-player custom play separately.
- Confirm production DNS, image, API health and room state were not changed.

Do not publish Access tokens, wallet signatures, private RPC endpoints, room capabilities or ranking backup contents as test artifacts. Record sanitized counts, release/build IDs, policy IDs and assertion outcomes instead.

## Backups and recovery

A separate daily backup runs at 04:30 UTC (with up to five minutes of scheduling jitter). This private-preseason maintenance interrupts active matches: ranked matches are voided on restart and do not change ratings. Finish test matches before the maintenance window. It briefly **stops the staging game writer**, copies the whole state volume, validates JSON and SQLite integrity, restarts the server and uploads an encrypted archive to the staging-only bucket. This includes the database and any WAL/SHM files together; never copy a live SQLite database alone. The Access tunnel stays private throughout.

```sh
systemctl status farfield-staging farfield-staging-backup.timer
systemctl start farfield-staging-backup.service
journalctl -u farfield-staging-backup.service --since today
```

For recovery, preserve the current staging state, stop only `farfield-staging`, restore a compatible complete archive to its state volume with UID/GID 1000 and private permissions, then start and verify room/rating continuity. Use an operator role for reading the private backup bucket; the instance role writes backups but cannot read or delete them. Do not restore staging rankings into production, prune persistent volumes, or delete backup history as part of an update.
