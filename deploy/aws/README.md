# Dedicated AWS deployment

This Terraform stack creates a separate Farfield VPC, public subnet, routing,
security group, EC2 instance, encrypted EBS volume, static public address, private
backup bucket, instance role and two CloudWatch alarms. It does not attach to an
existing application's network or role. No NAT gateway, load balancer or database
is required for the current single-process match server.

The default is `us-east-1`, a compromise for North America and Europe, with a
4 GiB `t3a.medium`. Budget roughly **$40–60/month** for light beta traffic,
including instance, 40 GiB gp3 disk, public IPv4, modest S3 backups and basic
metrics. Traffic, snapshot growth and taxes can increase this. Standard CPU credits
avoid unlimited-credit fees but sustained CPU load can throttle the server; watch
the CPU credit alarm and load-test before increasing player capacity.

## Provision

Use Terraform 1.6+ and an AWS identity allowed to provision **new Farfield-only**
EC2 networking, IAM roles/profiles, S3 and CloudWatch resources. Existing EC2-only
credentials may authenticate successfully without these permissions. Do not reuse
another application's role as a workaround.

```sh
cd deploy/aws
cp terraform.tfvars.example production.tfvars
# Edit source_commit to the full reviewed public commit; adjust domains/region.
terraform init
terraform fmt -check
terraform validate
terraform plan -var-file=production.tfvars -out=production.tfplan
# Review: every resource should be a new Farfield resource.
terraform show -json production.tfplan | python3 check-plan.py
terraform apply production.tfplan
terraform output
```

Store Terraform state privately with restricted access and backups. The local
state, plans and `production.tfvars` are ignored by Git. Use an isolated remote
state backend if more than one operator manages the stack. Do not commit AWS
credentials or place them in user data. The instance's own role grants SSM access
and writes only to its Farfield backup prefix; the app container cannot access
instance metadata because IMDSv2 is required with a hop limit of one.

## DNS and release

Create DNS `A` records for your game domain and API domain pointing at the
`public_ip` output. For Cloudflare, begin **DNS only** so Caddy can obtain publicly
trusted HTTPS certificates for both names. Keep the API DNS only unless the proxy
configuration has been tested with long-lived event streams. No port 4173 or SSH
port is public; administrative commands use AWS Systems Manager.

Wait for the instance to appear in Systems Manager and for
`cloud-init status --wait` to finish. On that instance, using Session Manager or
Run Command, fetch the pinned release's `deploy/aws/deploy-release.sh`, review it,
and run it as root:

```sh
bash deploy-release.sh FULL_40_CHARACTER_COMMIT \
  farfield.fun api.farfield.fun farfield-production-backups-ACCOUNT_ID us-east-1
```

It fetches only the public source repository, builds a commit-tagged image, keeps
room data in the persistent `farfield_rooms` Docker volume, starts Caddy, and
installs boot/start and daily backup services. The source commit needs the split
game/API configuration in `deploy/compose.yaml`. No wallet or cloud private keys
are needed inside the application.

Check both HTTPS names, `/health` on the API hostname, a four-browser match,
reconnection, and a real iPhone/iPad wallet switch before announcing a release.
Do not treat a Terraform apply or a green container health check as a gameplay
test. CloudWatch alarms have **no notification destination by default**; connect
your own alert recipient. Backups record a successful systemd run or a failure in
the journal; monitor them separately.

## Private Friend RPC provider

An optional server-only RPC URL can be kept in AWS Systems Manager Parameter Store
as a **SecureString** at `/farfield/production/friend-rpc-url`. Create or rotate its
value through an authorized operator's private input, using the default AWS-managed
SSM encryption key. Do not put the URL in Terraform, command arguments, public
environment examples, Docker build arguments or browser configuration.

Set this **path, not its value**, in your ignored `production.tfvars`:

```hcl
friend_rpc_parameter = "/farfield/production/friend-rpc-url"
```

Terraform then adds one inline permission to the dedicated Farfield instance role:
`ssm:GetParameter` on that exact parameter ARN. It does not grant parameter listing,
path enumeration, writes or access to other applications' parameters. A custom KMS
key needs a separately reviewed permission on that exact key; broad KMS access is
not included.

For an existing deployment, add only this policy with a reviewed targeted plan so
unrelated bootstrap/user-data changes cannot restart the live server:

```sh
terraform plan -var-file=production.tfvars \
  -target='aws_iam_role_policy.friend_rpc[0]' -out=friend-rpc.tfplan
terraform show -json friend-rpc.tfplan | python3 check-plan.py
# Confirm exactly one new Farfield policy, no changes or deletions.
terraform apply friend-rpc.tfplan
```

On the VM, pass the parameter path as the sixth release-script argument:

```sh
bash deploy-release.sh FULL_40_CHARACTER_COMMIT \
  farfield.fun api.farfield.fun farfield-production-backups-ACCOUNT_ID us-east-1 \
  /farfield/production/friend-rpc-url
```

After building the public image, the instance retrieves the SecureString without
printing it, validates that it is an HTTPS URL, and writes
`/opt/farfield/runtime.env` with mode `0600`. Compose loads this file only into the
game server at runtime, using raw env-file parsing. The file stays outside the Git
checkout and image build context. Operators must not dump the resolved Compose
configuration, container environment or parameter value into shared logs.

The script remembers the parameter **path** for subsequent releases. Omit the
sixth argument to reuse it; explicitly pass `""` to disable the override. Rotating
the SecureString requires rerunning deployment to refresh the runtime file and
replace the container environment. Keep `friend_rpc_parameter` configured in
Terraform for as long as the override is used. Public RPC remains the default
when no private override is configured.

## Operate and recover

```sh
sudo systemctl status farfield farfield-backup.timer
sudo journalctl -u farfield-backup.service --since yesterday
sudo docker compose --project-name farfield \
  --env-file /opt/farfield/production.env \
  -f /opt/farfield/current/deploy/compose.yaml \
  -f /opt/farfield/current/deploy/compose.split.yaml logs --tail 100
```

The server checkpoints free rooms every five seconds and on graceful shutdown.
Daily S3 backup is a disaster-recovery copy, **not high availability**. Backups
contain private room access tokens: restrict access and never publish them.
The instance role cannot list, read or delete backup objects; an operator identity
needs those permissions to restore. S3 versioning is enabled; automatic deletion
is not configured. Choose and explicitly approve a retention policy as usage grows.

To restore, first stop the Farfield service and preserve its current room file.
Download the chosen object using an authorized operator identity, validate the
JSON, replace `rooms.json` in the Farfield room volume with mode `0600`, owner
`1000:1000`, then start the service and verify reconnecting players. Never replace
a running server's checkpoint. Use the same procedure on a replacement VM for
host loss, then move DNS to its address.

For an application rollback, rerun `deploy-release.sh` with the previous reviewed
commit after checking that its snapshot schema can read the current state. Keep
old release directories and images until rollback is no longer needed; the
deployment script never prunes Docker volumes or release data.

Termination protection, retained EBS and Terraform `prevent_destroy` guard the
stateful resources. Teardown and retention changes require an operator to inspect
and explicitly confirm exact targets. Do not run a broad `terraform destroy` or
copy a production state file into a disposable test environment.
