# Active playtest fixes — 20 September 2026

This checklist tracks the current batch of user reports. Earlier features remain in README and VALIDATION.

- [x] Click/tap places a valid blueprint immediately; hover and drag do not build. Browser checked again with shape selection.
- [x] Friend stays on completed connected flooring; resource gathering requires adjacent floor; discovering rivals requires walking there. Unit tests pass.
- [x] Queue connected blueprints beside unfinished modules, without overlapping occupied tiles; construction follows reachable prerequisites. Unit tests pass.
- [x] Compact worker management: one recruit action, job counts and +/- assignment.
- [x] B toggles Build; W toggles Workers; avoid input/modal conflicts.
- [x] Match result clearly names winner and cause: core destruction, four monoliths, forfeit or disconnect; distinguish elimination while others keep playing.
- [x] Change commander is a normal main-menu button opening a dedicated screen with portraits, inspection, explicit selection and Back.
- [x] Player chooses any tetromino shape; no forced random piece; preview and server agree.
- [x] Validate desktop and phone in Browser Testing; rebuilt and refreshed live preview.

Still gated by earlier user instructions: paid 1 RF mainnet mode needs funded deployment and testing; vibeathon submission waits until the user is happy. Neither is enabled/submitted by this UI fix batch.

Evidence and exact coverage: [VALIDATION.md](VALIDATION.md), final playtest-fixes section. All 42 logic tests, typecheck, SDK check and build pass; desktop/phone browser checks cover the current batch.

## Follow-up menu feedback

- [x] Replace commander cards and inset panel with a full-viewport, unframed sprite roster.
- [x] Animate the inspected Friend with canonical idle/walk frames and show its type explicitly.
- [x] Replace native selects with themed custom selectors, including keyboard and touch support.
- [x] Victory/Defeat covers the full game viewport and hides gameplay controls.

## Roster loading feedback

- [x] Show loading while ownership discovery is pending; never label it an empty wallet.
- [x] Show an explicit load error with Retry, distinct from a successfully verified empty collection and search with no matches.
- [x] Automatically inspect the selected/first Friend when delayed discovery completes; reset inspection across wallet identities.

## Shared battlefield and construction controls

These rules supersede the earlier separate-sector, remote-research and deposit mechanics.

- [x] Four shared monoliths: Friend captures in 10 seconds; rival Friends/guards contest; holding all four uncontested for 60 seconds wins, with a visible countdown.
- [x] Remove flying raids. Friend and guards fight on connected completed flooring, including neutral/enemy flooring. Clicking enemy units/buildings orders an attack.
- [x] Core healing, staffed Infirmary, 15-second Friend respawn, worker losses, core elimination, and explicit simultaneous-destruction draws.
- [x] Guard follow, hold, and return-to-turret orders; idle builders repair the core with alloy.
- [x] Remove nearby bonus resource deposits. Equal opening supplies and identical objective path-distance sets for every spawn; spread and shuffle seats for 2–5 commanders.
- [x] Server-filtered fog: no enemy spawn markers or full rival-state disclosure; only current visible units and last-known terrain.
- [x] Build asks for block shape first, then building. Escape clears the full placement state.
- [x] Mouse/touch placement works on the first press; return focus to the level and queue commands rather than silently dropping clicks while a previous command finishes.
- [x] Remove the Rivals dock button. Build and Workers remain.
- [x] Cancel unfinished blueprints for **100%** alloy; dismantle completed modules for **75%**. Enemy destruction refunds nothing. Completed flooring remains; orphaned queued blueprints cancel with full refunds. Refunds are not lost at the production storage cap.
- [x] Desktop 2560×1440 and phone 360×852 browser checks cover the new controls, refunds, fog and compact worker panel. Physical-device balance remains a playtest item.

## Random objectives and predefined starts

- [x] Randomize the four monolith locations from a server-only match seed, with separate landing platforms.
- [x] Use predefined corner spawns (opposite corners for two players); cap all custom matches at four commanders in any mix of humans and AI.
- [x] Keep equal supplies, symmetric objective distances from every corner.
- [x] Preserve active-match positions, fog of war, and private spawn assignment; validate layout variation, spacing, and platform footprints across seeds.

- [x] Four-commander cap confirmed: at most three AI, server-enforced creation/join/add limits, corner spawns only.

## Touch controls
- [x] Add two-finger pinch zoom anchored under the gesture; suppress gameplay taps until every finger is lifted.
- [x] Keep one-finger drag and cancelled touches from placing buildings or moving the Friend.
- [x] Let the entire sector fit on phone screens by lowering the camera's minimum zoom.
- [x] Layer build/worker drawers above objective buttons; keep their close controls visible while scrolling and give them 44px touch targets.
- [x] Add a touch-only regression suite for phone portrait, phone landscape and tablet, including worker and guard orders. Native iOS/device testing remains separate from browser emulation.

## Crowded stations, combat clarity and resource roles
- [x] Reuse navigation topology and reachability per actor update; avoid a full BFS for every builder's repeated construction check.
- [x] Cull offscreen modules/workers, cache known fog tiles between snapshots, and avoid repeating floating job labels for every worker.
- [x] Remove the hard-coded 24-worker cap; completed Quarters provide capacity.
- [x] Buildings cost alloy only. Energy funds Shield and EMP, with server-enforced costs, duration, cooldown, range and visibility.
- [x] Fixed turret DPS instead of multiplying damage by crew. Explicit building targets remain selected; following guards join the siege.
- [x] Add turret range/disabled markers, brighter projectiles/impacts, hostile/friendly colors, shield effect, Friend HP and under-fire/target status.
- [x] Research accelerates on-site anomaly decoding rather than adding combat damage or remote captures.

## Compact building actions and combat modes
- [x] Move building inspection/placement actions beside Build/Workers at the same shallow height. Remove the large description popup; retain building descriptions in the build palette and title tooltip. Narrow screens swipe the action strip horizontally; left/right dock settings remain supported.
- [x] Add separate Friend and all-worker Aggressive/Peaceful controls at the top of Workers (W). Default Friend aggressive, workers peaceful; the Workers dock button shows its current mode.
- [x] Aggressive units interrupt jobs for nearby visible enemies, including enemy buildings, using completed-floor routes. Ordinary workers deal 3 DPS, guards 7, Friend retains 12/18 unit/siege damage.
- [x] Peaceful restores interrupted assignments or idle, cancels auto-attacks, and preserves worker job slots while away. Destroyed workplaces clear saved assignments. Staffed turrets still defend; direct Friend attack orders are allowed in either mode.
- [x] Explicit Friend movement/attack orders take priority. New workers inherit the group's mode; scans are throttled to once per second with per-player shared vision.

## Direct combat toggles and construction shortcuts
- [x] Replace the mode-selector rows in Workers with two icon-only toggles beside Shield/EMP. Single figure = Friend; group = workers; crossed swords = Aggressive; leaf = Peaceful. Accessible labels, pressed states and hover help explain each control.
- [x] Remove fixed blank label space and fix the centered dock's shrink-to-fit sizing so desktop actions are not unnecessarily clipped. Keep a shallow strip and horizontal scrolling on small screens.
- [x] Wire block shortcuts 1–7 and I/O/T/L/J/S/Z, then building shortcuts 1–8. Show key hints and support selecting after clicking HUD buttons. Escape clears the sequence; inputs/dialogs retain their normal keys.

## Assigned workers, compact actions and Backspace
- [x] Restrict the aggression toggle to free builders and explicitly mobilized guards. Specialists and turret staff keep working even with enemies in personal weapon range; staffed turrets still defend. Assigning a fighting builder to a post immediately cancels its attack. Rename toggle help to Free workers.
- [x] Remove the Command/building-name text from the action strip. Use compact 44px icon buttons for build, workers, rotate, place, dismantle/cancel, Friend work, repair, recruit and clear. Keep refund percentages/costs, descriptive accessible labels and hover help. Friend work is a pressed-state start/stop toggle.
- [x] Show total workers/capacity once in the header; recruitment row shows only unassigned count and availability.
- [x] Backspace returns from building selection to blocks without losing the selected shape; another Backspace closes the build drawer. Input fields/dialogs retain normal deletion behavior.


## Live four-session readiness pass

This section supersedes earlier implementation notes: voluntary dismantling removes flooring, the player cap is four, and aggression applies only to free workers.
- [x] Four independent live browser sessions, separate stations, real resource costs and construction: 240 modules / 256 workers after seven minutes, no API/page errors.
- [x] Correct dismantling: remove completed tiles, refund 75%, evacuate own occupants, reject enemy occupancy or station disconnections. Cancel dependent blueprints at 100%; enemy wreckage remains a separate combat rule.
- [x] Invalidate cached paths when removed flooring would leave a route over void.
- [x] Verify same-tab seat recovery through wallet/Friend ownership revalidation.
- [x] Verify optional fixed 960×640 logical submission viewport with uniform scaling.
- [x] Complete live four-Friend capture, contest, combat and shared victory checks.
- [x] Publish source to [b00ste/farfield](https://github.com/b00ste/farfield) and submission branch to [b00ste/rarefriends-vibeathon](https://github.com/b00ste/rarefriends-vibeathon/tree/codex/farfield-submission).
- [x] Upstream submission opened by b00ste: [vibeathon PR #27](https://github.com/spokesz/rarefriends-vibeathon/pull/27), ready for review.

- [x] Touch-confirmed automatic evacuation before dismantling; separate authenticated request budgets; live practice matchmaking and full-viewport results.

- [ ] Measure larger public concurrency on the chosen cloud host; four-browser streaming is verified, higher sustained capacity is not.

- [x] Live expired-seat test returns to the title menu and clears saved recovery data; fixed the banner button inheriting blocked pointer input.

## Specialist playtest — controls and reconnects, 21 September

- [x] Escape, opening the game menu, disconnects and match end cancel unsent commands. Rapid Friend orders retain only the latest destination behind the in-flight request. Commands already accepted by the server remain authoritative.
- [x] Add pending/accepted/rejected map markers, current Friend task text, and visible-target reticles. Resolve attack targets by owner and ID; do not reveal hidden targets. Correct the energy tooltip to Shield/EMP.
- [x] Clear recalled guards’ follow/hold orders when assigning them back to a workplace. Protect evacuation from reassignment or commands back onto the clearing building.
- [x] End pursuit when a target dies, disappears or leaves vision; automatic combat resumes the interrupted job.
- [x] Keep online simulation and disconnect expiry running when every tab is hidden. Resolve simultaneous expiry as a terminal draw.
- [x] Separate leaving a room from hiding a tab: preserve backgrounded opponents’ matches/results, invalidate departed capabilities and migrate host control.
- [x] Fit worker labels and controls on narrow screens; prevent vertical swipes from scrolling the worker drawer sideways.
- [x] Combined browser regression and seven-minute public streaming stress passed: 230 buildings / 256 workers / 486 commands, zero game/page/HTTP errors.
- [ ] Real Safari/device check on the owner’s MacBook, iPhone and iPad.
- [x] Prepare single-server Docker/Caddy deployment for AWS or GCP, private snapshots and a hosted CI container recovery check. Real process restart/crash recovery passes; cloud provisioning is pending domain, region and budget.
- [x] Replace four-times-per-second sync polling with an authenticated event stream. The latest long browser test exposed 512 requests/minute proxy limits even at four seats; earlier “no API errors” reports did not fully account for sync errors and are superseded by the fresh transport verification below.
- [x] Four streaming connections delivered 7,069 updates with zero sync polling. Complete HTTP error accounting is now required by the harness.
- [x] Hosted CI passed the production container build, nonroot runtime, private snapshot permissions and exact match recovery after restart. Four real HTTP streams also sustained 65 seconds with no polling.

See [the specialist report](PLAYTEST-2026-09-21.md) and [source PR #1](https://github.com/b00ste/farfield/pull/1). Physical Safari/wallet handoff and dense desktop building-label polish remain open.

## PWA installation and clearer HUD actions

- [x] Title-menu Install game action, native prompts where supported, and iPhone/iPad/Safari instructions; hide the action in standalone mode.
- [x] Manifest, normal/maskable icons, Apple touch icon, standalone launch and honest offline reconnect screen.
- [x] Cache only public offline/icon assets; never cache wallet, RPC, match state or game streams. No forced match reload for service-worker updates.
- [x] Handle denied browser storage without blocking startup; wallet UI uses page-only memory when persistence is unavailable.
- [x] Use the same worker-group icon in the action dock and the free-worker combat toggle.
- [x] Friend work action uses the appropriate hammer, swords, healing, mining, farming, energy or research icon.
- [x] Remove clipped recruitment cost text from the compact strip; keep costs in Workers and accessible help.
- [x] Move the camera hint above the ability controls.

Implementation is complete. Candidate browser validation and production rollout are recorded in the next validation entry; physical iOS installation/wallet switching remains a device check.
