# Private ranked preview — 21 September 2026

> **Retired on 28 September 2026.** The AWS preview and its Cloudflare route/access resources have been removed. The records below describe historical deployments. Future testing uses [local previews](LOCAL-PREVIEW.md).

## Retirement and production promotion

PR #6 was merged and deployed to production as source `d5f5170deebd871181ce4cdea6bb61414d600d29`, build `6bfed644fb6aff75`. Production started with fresh rankings and retained its existing room storage/private RPC. Desktop/phone live leaderboard checks and an isolated restore of the new online rooms/SQLite backup passed before teardown.

The reviewed Terraform teardown removed 19 dedicated staging resources, leaving zero managed resources. The retained data disk and two staging SSM parameters were also deleted. Final checks found no staging volumes, snapshots, Elastic IPs, alarms or log groups; the backup bucket, VPC, IAM role and instance profile are absent. Cloudflare preview DNS, Access application, service token and Tunnel were removed. Production remained healthy after teardown; Phlox and Coder workspaces were untouched.

All 12 preview backup versions were archived privately outside AWS on the primary and infrastructure workspaces, with file hashes, room JSON and SQLite integrity verified. These archives contain private state and are deliberately outside Git. No preview rankings were imported into production. Only provider deletion records and local archives remain; no billable preview resources were found.

Evidence: `artifacts/preview-retirement-complete.json`, `artifacts/aws-production-release-d5f5170.json` and `artifacts/leaderboard-production.json`.

## Historical deployment record

The app and game API share `https://preview.farfield.fun`. Cloudflare Access permits verified `@kethalia.com` email addresses. It also has a separate, expiring automation credential restricted to this preview. Production game/API DNS and application builds remain unchanged.

| Item | Deployed value |
| --- | --- |
| Application commit | `a1d38d7c76704c0aa0aa285fd5733b09668a6fb1` |
| Browser build | `cfb300e35fbd6f21` |
| Region / instance size | `us-east-1` / `t3a.medium` |
| Instance | `i-01d51f19d6d298cec` |
| VPC | `vpc-01d8bcc6eb50ceb1c` / `10.85.0.0/16` |
| State volume | `farfield-staging_state` |
| Backup bucket | `farfield-staging-backups-427297225374` |
| Unchanged public browser build | `0c0d663825e6c55f` |

The dedicated stack created 19 resources and changed/deleted no existing resources. It has zero security-group inbound rules and no published Docker ports. An outbound Cloudflare Tunnel requires the preview Access JWT before forwarding requests. Direct connections to the instance on ports 80, 443 and 4173 failed, as intended.

The deployed app is healthy with rankings enabled and its own room/SQLite storage. Its RPC runtime setting matches the separate staging Parameter Store value, verified without printing secrets. The initial private backup succeeded and the daily timer is active. A downloaded backup was restored into isolated scratch: room JSON parsed and SQLite integrity passed with all three ranking tables intact; live state was not replaced. See the [staging runbook](../deploy/aws/staging/README.md) for maintenance, recovery and approximate $35–50/month additional hosting cost.

## Validation and remaining device check

[CI passed](https://github.com/b00ste/farfield/actions/runs/35642446677): 170 tests, typecheck, FriendSDK validation, production image, durable container recovery, sustained four-seat streams and the ranked HTTP integration. The HTTP integration uses real test-wallet signatures with fixture chain ownership, including rating settlement, widened matchmaking and restart cancellation. Six browser layout/configuration cases passed with host-auth fixtures.

Live browser validation on the exact deployed build passed. Anonymous app, script and API requests redirected to Access; authenticated host, sandbox assets and four event streams worked. The live ranking server rejected an invalid signature, a valid signature without NFT ownership, and unsigned matchmaking. Four independent custom sessions built Foundries, recruited working miners and forfeited to one shared result. Custom state contained no ranking payload and the leaderboard was unchanged. There were zero page errors and no Access credentials on third-party requests. Browser wallet/NFT discovery was a fixture; custom simulation, streams and ranked rejection checks used the real server. All test seats were left. Run `tests/staging-browser.mjs` only in Browser Testing with preview-only credentials; sanitized evidence is `artifacts/staging-browser.json`.

An ordinary unauthenticated browser reached the email-code sign-in page with its Email input and Send login code action visible; no email was entered or code requested. Real email OTP delivery and approved-email login require a tester's mailbox. Two real eligible wallets still need to sign in, complete a ranked match and verify the rating result. Test this on physical Safari/PWA devices, including the wallet-app switch and return. The owner confirmed that `https://preview.farfield.fun` was added to the Reown project's allowed origins. Service-token automation and emulation do not prove these steps work on a physical device.

Sanitized operational evidence is retained locally in `artifacts/aws-staging-provisioning.json` and `artifacts/aws-staging-release-a1d38d7.json`. Private infrastructure state and credentials stay outside the repository.

## Online menu update — 22 September 2026

Current preview release is `a7c46d4f04c3611d13490c6d100b2489360baf23`, browser build `57d2ed168a7d2aa7`. It groups the mode choices, rank/leaderboard row and play action, with compact wallet guidance and a clean short-landscape error state. Six live desktop/phone/tablet menu checks passed; candidate coverage also included 320px portrait and wallet-signature rejection/retry. These menu checks use fixture wallet discovery and create no matches. Health, private runtime settings, storage and the post-release backup passed. Production remains `0c0d663825e6c55f`; no infrastructure changes were needed. See `artifacts/online-layout-preview.json` and `artifacts/aws-staging-release-a7c46d4.json` for sanitized evidence.

## Title leaderboard and division filters — 28 September 2026

Preview now runs `36612615cfb9bd634c6caccf9068953be54e3e06`, build `94494df55d15226e`, with title-menu leaderboard access and server-side division filters. The existing ranking database and state volume were retained; no schema migration or infrastructure changes were required. Health and post-release backup passed. Read-only live desktop and 320px phone checks confirmed all six filters, both Back destinations, empty states and invalid-filter rejection against the actual API. No live rank records were created; populated results are covered by automated server and browser fixture tests. Production is unchanged. Evidence: `artifacts/leaderboard-live.json` and `artifacts/aws-staging-release-3661261.json`.
