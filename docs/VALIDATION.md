# Farfield validation

Farfield is a free, server-authoritative strategy game with online one-versus-one matchmaking and custom matches for up to four Friends or AI commanders. The public game is [farfield.fun](https://farfield.fun/), with its backend at [api.farfield.fun](https://api.farfield.fun/health).

Implementation stays in the primary software workspace. Chrome, touch emulation, screenshots and network checks run in Browser Testing; production container/AWS work runs in Infrastructure. Browser wallets and artwork use fixtures unless a check is explicitly described as unmocked. No native wallet approval is automated.

## Core checks

```sh
npm test
npm run typecheck
npm run check
npm run build
```

FriendSDK validation checks the game definition and sandbox boundary. Its required game-definition metadata is scaffolding; Farfield's alloy, food and energy are simulation resources. CI also builds twice to verify SDK output isolation, checks real process restart/crash recovery, sustains four independent event streams, validates Compose/Caddy configuration, builds the production image and verifies nonroot startup, private snapshots and same-seat restoration.

## Gameplay and controls

Logic and browser checks cover:

- Core-only starts; selected tetromino shapes; first-click/tap placement; connected blueprint queues; actual on-site construction and resource production.
- Completed-path movement, visibility-filtered rival information, random balanced objectives, fixed corner spawns and a four-commander limit.
- Shared monolith capture/contesting, Friend/guard combat, core destruction, healing/respawn, explicit results and simultaneous outcomes.
- Alloy-only building costs, Shield/EMP costs and cooldowns, turret balance, worker housing capacity and job assignment.
- Free-worker aggression without pulling assigned specialists from buildings; direct Friend orders take priority.
- Blueprint cancellation returns 100% alloy; completed dismantling returns 75%, evacuates occupants and removes floor while preserving station connectivity.
- B/W shortcuts, block/building numeric keys, rotation, Backspace/Escape, pointer focus, pan/zoom and pinch cancellation.
- Full-window and scaled 960×640 submission layouts, movable compact docks, contextual action icons, consistent worker glyphs, clear camera hints and no clipped recruitment captions.

Meaningful touch runs cover 320×568, 360×852, 390×844, 852×393 and tablet layouts. These are Chromium emulation checks, not proof of physical iOS gestures, battery use or native wallet switching.

## Multiplayer, performance and hosting

A seven-minute four-browser streaming run reached 230 buildings, 256 workers and 486 commands with zero game, page or HTTP errors; four persistent connections delivered 7,069 updates without sync polling. A public AWS run used four clients for 120 seconds with 57 buildings, 76 workers, 133 commands and 2,380 updates, also without errors. See [live playtest](LIVE-PLAYTEST.md), [specialist report](PLAYTEST-2026-09-21.md) and [deployment record](AWS-DEPLOYMENT.md).

A synthetic four-commander benchmark with 480 modules and 256 workers improved mean server update time from 67.64ms to 8.29ms after shared navigation indexes and render culling. These measurements are not physical-phone or large-launch capacity guarantees. The backend remains a single authoritative process; alert delivery and off-instance restore drills still need operational validation.

## PWA and storage

Real Chrome installability reports no errors. Connected/disconnected title menus fit five phone/tablet layouts. The install action supports native prompts or platform-specific instructions and disappears in standalone mode. Actual offline startup shows a reconnect page; the worker caches only six public offline/icon files, never match/API/RPC data or game bundles.

A genuinely changed worker remained waiting while the same player's match clock and event stream continued. No forced reload occurred. Blocked local storage initially exposed wallet-library startup failures; page-only memory fallback and guarded persistence resolve them. Synthetic install events cover dismissal/retry/acceptance, and simulated iOS/standalone signals cover presentation. Native Home Screen/Add to Dock installation and wallet round trips still require [device checks](DEVICE-PLAYTEST.md).

## Wallet and private RPC

The themed first connection screen offers Browser Wallet, Zerion, MetaMask and WalletConnect. Six real-connector cases cover each named wallet on desktop, simulated iPad standalone and simulated iPhone. Desktop generates unpaired QR codes; mobile generates the appropriate app link. The initial MetaMask harness missed its native protocol; corrected capture confirms the standard connector works. Chromium's mobile native-launch gesture warning means physical Safari launch/approval remains unverified.

Unmocked production FriendSDK discovery returned 42 eligible Friends plus one hidden Friend. Ownership, both filtered transfer histories and canonical artwork reads passed. There were no direct private-provider browser requests or credential-bearing asset/error responses; conventional source-map and environment-file paths returned 404. Provider credentials remain server-only.

## Evidence and limitations

Reproducible suites live under `tests/`; sanitized reports and screenshots stay in ignored `artifacts/`. Useful reports include `wallet-options-production.json`, `pwa-production.json`, `compact-hud-production.json`, `production-rpc-pwa-release.json`, and the multiplayer reports referenced above. QR/pairing payloads and room capabilities must not appear in published evidence.

Human game balance, real Safari wallet handoff, physical-device performance and larger concurrent populations remain playtest items. Source history contains older behavior; the current README and the latest deployment/check results describe the public application.

## Free online release checks

The latest candidate passes 94 logic/server tests, TypeScript, FriendSDK validation and production build. Real browser checks confirm Online PvP, Friends & AI and Join friends appear in that order; free matchmaking starts two independent players and both receive the same result after forfeit. The disabled future-mode label has no action. No payment-route requests, wallet signatures or transactions occur during the tested flow. Graceful restart, forced-crash recovery and four live event streams sustained beyond 60 seconds also pass. Desktop, iPhone and iPad menus fit without document overflow.

Run `node tests/free-menu-browser.mjs` and `npm run test:online` in Browser Testing against an isolated server. Sanitized evidence is in `artifacts/free-menu-candidate.json` and `artifacts/online-free-candidate.json`.

The same checks passed against public build `e19f511263f52c83` after deployment of `fb46a89`: desktop/iPhone/iPad layouts, two-player online results and a scan of six served assets. Production reports are `free-menu-production.json`, `online-free-production.json` and `free-release-production.json` under ignored `artifacts/`. Both release CI workflows passed, including container recovery.

## Touch construction and economy follow-up

The touch construction candidate passed 104 automated checks before the economy pass. Real CDP input on iPad portrait/landscape, iPhone and 320px phone verifies immediate previews, dragging any preview tile with a preserved grab offset, no placement on drag release/cancel, blank-map panning, pinch handoff and pen input. Desktop single-click placement remains covered. A 64-tile adjacent-quarters render is pixel-identical when building order is reversed. Reproducible suites: `tests/touch-placement-browser.mjs` and `tests/dense-floor-browser.mjs`.

The optional scaled submission iframe has a Chromium limitation: pointer events hit the HUD, but synthesized touch clicks can land at incorrect coordinates. Its map gestures passed, with mouse input used for HUD actions. Full-window mobile passed touch controls; physical Safari remains a device check.

The subsequent economy benchmark (four commanders, 480 modules, 256 workers) measured 7.66ms mean and 11.86ms p95 for a server advance plus one filtered view. This is a synthetic server measurement, not a phone frame-rate claim.

Economy checks cover serial recruitment, reserved beds/workplace slots, cancellation refunds, lost housing/workplaces, old-save migration, paused queues, shortage recovery and reduced worker/turret damage. Bundled process restart/crash checks preserve a queued recruit exactly once; container CI compares the paused queue as part of restored state. A real-time tablet browser run with normal resources verified five queued recruits, cancellation/requeue, reload to the same seat, serial arrivals, shortage warnings and Friend farming recovery (five workers consume 0.65 food/s; the Friend farming supplies 1.6/s, for +0.95/s net).

Final release candidate `92b0818` passed all 120 automated tests and both [push](https://github.com/b00ste/farfield/actions/runs/35619742773) and [PR](https://github.com/b00ste/farfield/actions/runs/35619747121) workflows. These include repeated production builds, sustained four-seat event streams, process/crash recovery and nonroot container recovery with a queued recruit. The final 320px browser check measured a 6px gap below the resource bar and no horizontal worker-drawer overflow. Candidate reports: `artifacts/economy-tablet-candidate.json` and `artifacts/touch-placement-candidate.json`.

Public verification passed on exact build `c3fad9100bb38e60` after deployment: real-time tablet recruitment/refunds/reload/shortage recovery, 320px HUD bounds, and iPad-emulated touch/pen placement, rotation, cancellation and pinch safety. No page errors; test rooms were left. Production reports are `artifacts/economy-tablet-production.json`, `artifacts/touch-placement-production.json` and `artifacts/touch-economy-release-production.json`.
