# Private ranked preview — 21 September 2026

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
