# Validation — September 20, 2026

> Latest results: [21 September specialist playtest](PLAYTEST-2026-09-21.md) supersedes the older polling/error totals and in-memory-only restart limitations below.


**Current implementation:** full-screen playfield, four-commander mixed custom matches, practice matchmaking, shared contested monoliths and separately gated 1 RF escrow. See the latest section at the end; earlier sections record superseded UI/gameplay history.

Primary source: `/home/coder/rare-friends-vibeathon` in `daniel/ai-dev-01`. Browser checks: `daniel/rarefriends-browser` (Browser Testing profile), using its installed Google Chrome through Playwright.

## Passed

- `npm run typecheck` — game, trusted host, simulation, server and tests.
- `npm test` — 13 simulation/room tests: starting connectivity; tetromino rotations; collision/reach/resource validation; atomic co-op placement and charges; crew conservation; completed quarters; shared pause; attack/defense/loss; research/victory; repair costs; room capabilities and synchronization; seat limits/inactivity expiry; host failover.
- `npm run check` — FriendSDK game definition and source boundary validation. Its printed 1 RF expected/max outcome is unused required schema scaffolding, not a playable Farfield reward.
- `npm run build` — production child bundle, original SDK sandbox CSP, custom trusted co-op relay host and Node server.
- `npm run test:browser` — two independent browser contexts, desktop 1200 × 850 with a 960 × 640 game frame, touch phone 393 × 852. Passed through the public HTTPS URL after fixing the proxy's opaque-origin CORS incompatibility with a narrow host relay.
- A follow-up run uses a **360 × 852** phone viewport. The same interaction suite checks responsive controls, two-client room creation/join, phone placement visible on desktop, host-only shared pause/resume, crew reassignment, keyboard positioning/rotation, reduced motion, help/settings dialogs, no horizontal overflow, fresh SDK ownership reads, `allow-scripts` sandbox, and game removal after wallet disconnect.
- No JavaScript/browser errors or unexpected wallet-signing methods in passing automated runs.
- Public HTTPS preview returns 200 without a Coder login: `https://4173--main--ai-dev-01--daniel.kethalia.com/`.

## Evidence

- `artifacts/desktop-lobby.png`
- `artifacts/desktop-game.png`
- `artifacts/desktop-placement.png`
- `artifacts/mobile-game.png`
- `artifacts/mobile-help.png`

Artifacts remain local and are ignored by Git; they are reproducible with the browser command. The browser workspace holds a bounded validation copy, with authoritative implementation retained in the primary workspace.

## Scope and remaining playtest

The SDK's upstream wallet/RPC/artwork fixtures run only inside automated browser contexts. The actual public game still requires a real wallet and eligible Friend. The builder should now test real ownership/RPC availability, wallet in-app browser behavior, game balance, and co-op with another actual player. Automated tests verify the core win/loss transitions; they do not claim a complete human-balanced expedition or live-chain playtest.

No vibeathon submission PR, contract deployment, wallet signing or RF transfer has been performed. Submission is deferred until the builder is happy. Production hardening and server persistence limitations are documented in the root README.

## RainbowKit integration follow-up

RainbowKit 2.2.11 and wagmi 2 now own wallet connection/account/network management in the trusted host. The builder's WalletConnect project ID is configured. Friend discovery still uses exported SDK APIs and SDK picker UI, followed by fresh `ConnectedGameHost` eligibility checks. The existing game, economy and multiplayer protocols are unchanged.

Passed after integration:

- Typecheck, SDK game validation and production build.
- The existing desktop + 360px phone two-client co-op browser suite through the public HTTPS preview.
- `tests/wallet-browser.mjs`: Farfield theme values, desktop/360px modal placement, background input blocking, fresh eligibility rejecting a stale discovery result, unsupported-chain switching back to Robinhood, account-change invalidation, and RainbowKit disconnect.
- `tests/walletconnect-smoke.mjs`: an actual WalletConnect QR was generated using the supplied project ID, without wallet pairing, ownership mocks, signing or transactions. Actual end-to-end mobile pairing remains a user playtest.

Additional artifacts: `wallet-connect-1200.png`, `wallet-connect-360.png`, `wallet-account-360.png`, and `walletconnect-qr.png` (an ephemeral, unpaired session). Modal screenshot review caught and fixed a phone-width clipping issue.

Compatibility fixes are documented in README.md: the QR dependency is pinned to the last compatible release, a chain re-export initialization edge case is resolved in the host build, and ws 8.x is pinned to a patched release. `npm audit` reports 22 moderate transitive advisories (uuid/decode-uri-component and their dependents), no high or critical findings. No breaking wagmi major upgrade or forced audit fix was applied. esbuild reports a non-fatal unmatched optional MetaMask SDK entry glob from the connector dependency graph; Farfield uses injected/EIP-6963 wallets and WalletConnect/Rainbow, and the tested paths pass.

## PvP, AI and usability follow-up

The builder changed multiplayer to **separate competing stations** and selected **AI rival commanders** for solo. This supersedes the shared-base gameplay described in the earlier validation history.

- 19 local simulation/room/RPC tests pass, including station resource isolation, core-only opening, guided production, preparation restrictions, fleet costs/cooldowns, elimination victory, and AI construction/attacks under normal economy rules.
- `tests/browser.mjs` passes at **2560 × 1440** desktop and **360 × 852** touch phone: independent player bases, rival construction visible without changing the viewer's base, crew assignment, pause, keyboard/touch placement and account invalidation.
- `tests/arena-browser.mjs` passes: canonical portrait rendering/family label, search, viewport-filling desktop frame, readable controls, immediate mouse placement preview, solo AI construction, rival inspection, and preparation blocking fleet launch. Measured **53 canvas clears in one second** on Browser Testing's headless Chrome; this is a sample, not a guaranteed device frame rate.
- `tests/rpc-browser.mjs` passes: RPC outage produces a readable phone-width error, never mounts the game, and retry performs fresh ownership reads.
- Existing RainbowKit identity/theme/mobile modal regression checks pass after moving reads through the server.
- Live public-chain diagnostics reproduced duplicate `Access-Control-Allow-Origin: *,*` on direct RPC responses. Batched browser reads through the same-origin server relay subsequently discovered **42 eligible Friends**, one generation-0 exclusion, and decoded the reported Friend #20841's 16-row canonical Cellular portrait. One transport request retried during that run; the discovery completed. No signing or wallet transaction was performed.

New artifacts: `friend-portraits-2k.png`, `solo-ai-2k.png`, `wallet-rpc-error-360.png`; desktop/phone game captures now show the new layout and one-core opening.

Remaining playtest: AI balance, real human PvP strategy, actual mobile wallet pairing, and performance on the builder's devices. Solo AI currently uses deterministic heuristics and one rival station. Each rival sector can be inspected; there is no seamless camera spanning every station. Matches remain in memory with no reconnect after reload. No submission has been made.

Final rerun: arena UI and two-client PvP browser suites pass after the last layout adjustments. A 1280 × 720 laptop check confirms the footer remains inside the viewport. Repeated live discovery plus canonical portrait decoding completed with **zero failed network requests**. The live preview is running the rebuilt arena server. The prior shared-base rooms were reset during the update.

## Friend-led gameplay follow-up

The opening now has **one Friend, one core and zero workers**. This supersedes the earlier four-builder start. Canonical directional idle/walk clips animate the main character. Friend and worker positions, paths, construction and production are simulated by the server; workers only contribute after reaching their assigned workplace. Worker recruitment is explicit (6 alloy + 8 food); Quarters add four beds without spawning anybody.

- **26 local tests pass**, including seven actor tests covering physical movement and construction, every specialist job, independent helper production, builder automation, connected-floor routing, recruitment limits, personal combat, repair completion and pause. Existing PvP isolation, AI economy/attacks and RPC tests also pass.
- Typecheck, production build and FriendSDK validation pass. Child bundle: 130,209 bytes. The existing optional MetaMask entry-glob warning remains nonfatal.
- `tests/browser.mjs` passes again at 2560 × 1440 desktop and 360 × 852 touch phone: separate PvP bases, rival visibility, construction, worker recruitment, pause, keyboard placement and identity invalidation.
- `tests/arena-browser.mjs` passes again: portrait/search, 2K layout, immediate placement preview, AI construction, rival inspection and preparation restrictions. This run sampled 48 canvas frames in one second in Browser Testing; device performance can differ.
- `tests/friend-browser.mjs` passes the full opening on 1440 × 1000 desktop and 360 × 852 touch phone: Friend constructs and mines, scene animation changes between frames, a recruited miner travels from the core, the Friend walks back to salvage while the miner keeps working, a builder can be recruited separately, and instructions/footer fit both viewports.
- Screenshot review verified the larger Friend, task HUD, building explanations, recruitment menu and phone layout. Artifacts: `friend-working-1440.png`, `friend-working-360.png`, `worker-jobs-1440.png`, `worker-jobs-360.png`, `friend-and-helper-1440.png`, `friend-and-helper-360.png`.

The live server was restarted for the actor state changes; previous temporary rooms were reset. Refresh the preview and create a new match. Real-wallet device performance, strategy balance and human PvP remain builder playtest items. No vibeathon submission has been made.

## Current: landing, full-screen playfield, mixed matches and RF escrow

This replaces the dashboard layout and mandatory opening Friend picker. Assets load before the landing screen; selecting a commander is optional, and Play automatically uses an eligible Friend. The canvas occupies the full viewport. Build, Workers, Gather, Rivals, Signals and Menu open compact controls over the map. Three resource deposits are physical Friend destinations, collected at 2.5 units/second.

Custom games support **five commanders total**, mixing friends and up to four AI. Setup happens inside the sector. Online practice pairs two humans automatically. The fixed **1 RF each / 2 RF winner pool** mode is implemented separately and **disabled on mainnet pending deployment**. The selected model is server-refereed outcomes with 10-minute funding and 45-minute result timeout refunds.

Passed:

- **33 Node tests** covering simulation, physical actors/resources, mixed five-seat matches, matchmaking, disconnect/forfeit results, queue isolation, RPC validation and disabled escrow gates.
- **8 Solidity tests** covering exact deposits/payouts, repeated claims, authorization, ownership, direct forfeits, partial funding refunds and active-match timeout refunds.
- **Local Anvil integration** with test-only RF/Generations contracts: verified signed identity and single-use nonces; paid/practice separation; signed-owner seat recovery; no launch before two confirmed deposits; referee result transaction after forfeit; exact 2 RF claim; and server-independent recovery of an unmatched deposit. The test resets only its dedicated local Anvil instance between runs.
- Typecheck, production build and FriendSDK validation. Final child bundle: **146,310 bytes**. Existing optional MetaMask entry-glob warning remains nonfatal.
- `tests/playfield-browser.mjs` through the public HTTPS URL at **2560 × 1440** and **360 × 852**: no initial Friend picker or playable iframe before connection; automatic eligible commander; four initial AI and in-sector AI edits; full viewport canvas; physical resource collection; construction after returning from space; worker recruitment; menu forfeit; return to landing; no horizontal overflow; visible action bar.
- A separate two-client scenario combines **two humans + three AI**, then checks automatic online practice pairing, no online pause, and winner propagation after forfeit.
- Themed RainbowKit account menus open from the game menu, stay inside desktop/phone viewport bounds and make the background frame inert. Native wallet-balance reads now use the same read-only RPC relay.
- **Actual WalletConnect service** generated an unpaired QR with the configured project ID after the landing rewrite. No wallet paired and no transaction/signature was requested in that check.
- Browser wallet/RPC/artwork remain automation-only fixtures; passing UI runs report no JavaScript or fixture errors. Screenshot review after transition completion verified the full phone playfield and opaque account modal.

New evidence: `landing-2560.png`, `landing-360.png`, `fullscreen-gather-2560.png`, `fullscreen-gather-360.png`, `build-controls-360.png`, `fullscreen-play-360.png`, `game-wallet-2560.png`, `game-wallet-360.png`, and refreshed `walletconnect-qr.png`.

The public `/api/wager/config` reports `enabled:false`, entry `1`, pool `2`, with no deployed contract/referee configured. The server is live and healthy. Game changes reset earlier temporary rooms; refresh the page to load the landing screen.

Mainnet escrow deployment, referee funding/configuration, actual-wallet token transactions, physical-device performance and human balance remain unverified. The contract has local tests but no independent audit. No vibeathon submission has been made. Deployment terms and recovery procedures are documented in `docs/ESCROW.md`.


## Game title menu follow-up

Replaced the scrolling promotional landing with a fixed viewport title screen: Friends & AI, Online PvP, Join friends, Settings. Initial AI controls appear only after choosing custom play; code entry has its own screen. Settings and commander portraits use modal dialogs with focus restoration. RF recovery is nested under settings. The procedural station backdrop animates outside React and honors reduced motion. Layout reference: [Into the Breach main menu](https://interfaceingame.com/games/into-the-breach/).

`npm run test:menu` ran in `daniel/rarefriends-browser` against the public preview. All five sizes passed: 2560×1440, 1440×900, 360×852, 320×568, 852×393. Checks cover no document scrolling after wheel input, visible menu/setup controls, fewer than 50 words on the opening screen, all three play submenus, settings controls/Escape/focus restoration, and wallet connection entry. No page errors. Screenshots: `artifacts/title-<width>x<height>.png`. Desktop and phone screenshots were visually inspected. Typecheck and production build pass.

A dedicated referee wallet was generated and sign/recover verified locally. A read-only live RPC deployment estimate and public address are in `docs/referee-public.json`. The protected key lives outside the repository and was not sent to Browser Testing. Balance is zero; no deployment or mainnet transaction was broadcast; the running server still reports RF wagers disabled.

The updated `test:playfield` suite also passed: desktop 2560×1440 and phone 360×852 enter custom games with four AI, gather resources physically, build, recruit, forfeit and return; two clients join a mixed five-seat match and automatically pair into online practice. Winner/forfeit propagation passes, RF deposits remain unavailable, and no browser/fixture errors were reported.


## Compact HUD, versioned assets, and personal exploration

The screenshot report showed the obsolete second mode picker/dashboard. The host and child now use the same per-build version on HTML/JS/CSS URLs, including preload requests; static responses are `no-store`. Browser validation intercepts unversioned `game.js` with a failing legacy stub and verifies the playable frame uses a versioned URL with no second mode picker. Build metadata is outside the SDK-owned output directory at `dist/build.json` so repeat builds remain valid.

The in-game logo/header and duplicate commander card are removed. Resources are one compact strip. Build, Workers, and Rivals live in a three-button dock; settings stores Bottom/Left/Right placement through the trusted host. Build/Workers are animated nonmodal drawers: simulation and map input continue. Secondary actions moved into Menu. Reduced motion disables drawer animation.

The builder selected personal exploration. Pink rival signals appear in the level; tapping one or selecting Explore with Friend physically moves the main character there. Tapping empty space and arrows/WASD also allow bounded flight. A rival becomes visible only when that Friend gets within one tile. Enemy state is null in that commander's API responses until then. Stopping, pausing, or redirecting cannot complete discovery on a timer. Bots travel to discover opponents too. Live visibility persists after discovery; this is discovery gating, not continuous line-of-sight fog.

35 unit/server tests pass, including interrupted exploration, pause, per-commander isolation, return-to-work, bounds validation, discovery through free flight, and AI exploration before attacks. Typecheck and production build pass. Browser checks run in the existing Browser Testing workspace, not the software workspace.

Final public-preview browser run passed at 2560×1440 and 360×852: all three dock positions and drawer bounds, simulation advancing with Build open, nonmodal worker recruitment/assignment UI, asset versioning, no duplicate picker, physical Friend exploration, exactly one revealed base with three still hidden, inspection/return, dock persistence across new matches, wallet modal isolation, forfeit, mixed five-seat games, and automatic online practice pairing. No browser or wallet-fixture errors. Evidence: `artifacts/dock-{left,right,bottom}-{2560,360}.png`, `artifacts/discovered-base-{2560,360}.png`, `artifacts/fullscreen-play-{2560,360}.png`. The final desktop and phone views were visually inspected. Safari-specific browser automation was not available; the versioned preview link and no-store responses address reuse of older bundles on refresh.


## Immediate building placement

Pointer hover and keyboard positioning now update a preview separately from activation. A primary click or tap validates and submits the blueprint at that event's actual world coordinates, without waiting for React's ghost state update. Dragging, right-clicking, secondary pointers, and invalid tiles cannot submit a building. The optional Build button and Enter remain available; R rotates. In-game guidance and README match the new interaction.

`test:placement` passed in Browser Testing against the public preview at 1440×900 and 360×852. It covers hover-only preview, right-click and drag suppression, invalid placement, exactly one build command at the clicked coordinates, physical construction after placement, keyboard rotation/Enter, and touch placement. Typecheck and production build pass. This change does not alter movement: free-space flight remains enabled for personal exploration pending the builder's movement preference.

## Playtest fixes: floors, queued construction, controls and results

This section supersedes the earlier free-flight behavior above. Friend movement is now restricted to connected, completed station flooring. Deposits require a reachable adjacent floor; enemy signals require walking within one tile on connected floors. Bots obey the same rules. Blueprints can attach to other blueprints, while overlap remains invalid; the Friend and builders finish reachable prerequisites first. Users choose any of seven tetrominoes, retained after placement, and the server validates the selected shape.

Workers now have one recruitment button and six compact job counts with +/− allocation, instead of the repeated recruit/assign/recall cards and roster. B toggles Build, W toggles Workers; arrows move the Friend. Shortcuts ignore form fields and dialogs. Match results explicitly display Victory, Defeat or Eliminated, the winner (or an ongoing match), and authoritative reasons for core destruction, monolith victory, forfeit and disconnect. Fleet source names identify the commander who destroyed a core.

Change commander is a fifth standard title-menu action. It opens a dedicated screen with canonical portraits, paginated collection, search, an inspection pane, explicit selection, and Back. It does not open a modal or launch a match.

Validation: all 42 unit/server tests pass, including floor-only routing, interrupted exploration, bot discovery, queued construction by Friend and workers, arbitrary shape choice/invalid input/duplicate charging, and result attribution. Typecheck, SDK check, and production build pass. Browser Testing checks against the public preview pass at 2560×1440 and 360×852 for the playfield, worker recruitment and reassignment, floor-gated gathering/exploration, dock preferences, five-seat custom matches, automatic online practice matching, result propagation and wallet isolation. Commander screen tests pass at the same sizes. Placement checks at 1440×900 and 360×852 verify immediate mouse/touch placement, invalid/drag/right-click suppression, B/W toggles and choosing/rotating a different shape. Browser validation uses installed Chrome in the Browser Testing workspace; Safari was not automated.

Evidence: `artifacts/commander-screen-{2560,360}.png`, `artifacts/workers-final-{1440,360}.png`, `artifacts/result-clear-{2560,360}.png`. Paid RF remains disabled; no contract deployment, transfer or vibeathon submission was performed in this batch.

## Full-screen roster and custom selectors

Commander selection now uses the entire viewport, without an inset panel, card frames or portrait backgrounds. Its responsive roster shows up to 24 unframed Friends per page, with search and pagination. The inspection canvas plays the SDK's canonical idle or walk clips, displays the Friend type/family and generation, and respects reduced motion. Animation is isolated from the roster render tree, and its animation frame callback is canceled on cleanup.

All native application selects were replaced with a shared themed combobox/listbox component: AI count, difficulty, control placement and recent RF matches. The custom popup supports pointer/touch, arrows, Home/End, Enter, Escape and type-to-match. It positions within the viewport and renders inside a native dialog's top layer when used in game settings. Existing RF recovery selection behavior is preserved.

Browser Testing: 42-Friend synthetic collection checks pass at 2560×1440 and 360×852, including pagination, searching the last Friend, selection, Back, explicit type, changing canonical frames in both idle and walk modes, no card nodes, full viewport width and no page scroll. Custom selector tests cover pointer selection, keyboard Hard selection, Escape dismissal and disabled difficulty for Friends-only setup. No browser errors. Evidence: `artifacts/commander-screen-{2560,360}.png` and `artifacts/custom-select-{2560,360}.png`. The repeated Hoverer sprites in these screenshots belong to the synthetic collection fixture; production reads each Friend's own canonical artwork.

Victory/Defeat/Eliminated now use an inset-zero result screen; HUD, dock, drawers and map controls are hidden while the result is shown, with keyboard focus moved to the result. Desktop/phone playfield checks assert full viewport result bounds and hidden controls; the two-client online practice flow also checks the winner's full-screen result. Typecheck, SDK validation and production build pass.

## Roster discovery loading states

The host passes ownership discovery state explicitly to commander selection: loading, error, ready or disconnected. Pending reads show “Loading your Friends…” with a motion-preference-aware indicator, not a zero count, an empty-wallet claim or no-match pagination. Errors expose Retry inside the roster. A verified empty collection and a search without matches have distinct messages. Inspection derives a valid selected/first Friend when asynchronous data arrives, and the roster is keyed by wallet identity to avoid carrying inspection across accounts. Existing ownership validation and play gating are unchanged.

`test:roster-loading` passed in Browser Testing on the public preview at 2560×1440 and 360×852 with deliberately held RPC replies: no false empty message, disabled search during discovery, hidden pagination, automatic animated preview after release, and distinct search-no-match text. The same suite verifies RPC failure, Retry returning to loading, successful recovery, a genuinely empty wallet and Back navigation. No browser or fixture errors. Typecheck and production build pass. Evidence: `artifacts/friends-loading-{2560,360}.png`, `artifacts/friends-load-error.png`.

## Shared monoliths, ground combat and revised construction — build c4d86ae5feef8fa1

This section supersedes separate sectors, flying fleets, core-adjacent resource deposits and remote monolith research. Matches now share an 81×81 grid, with four central public monoliths and a neutral platform. Friend presence captures in 10 seconds; competing Friends/guards contest capture. All four must remain uncontested for 60 seconds. Unit combat, guarded turrets, base sieges, core elimination, simultaneous-destruction draws, healing, medic-staffed Infirmaries and Friend respawning are server-authoritative. Guards support follow, hold and return-to-turret orders. Bots use real costs, construction, pathfinding and physical capture.

Visibility is spatially filtered on the server. Opponent summaries never contain a full enemy state or spawn location; only observed tiles and currently visible actors appear in the map payload. Remembered terrain does not receive hidden updates. Shot data is reduced to visible endpoints, without actor paths or hidden target data. Spawn assignments are shuffled and spread for each player count; every core has the same sorted objective path distances and starting resources. Neighbor geometry is subject to integer-grid rounding; human balance remains unverified.

Build is now explicitly two steps: block, then building. Escape clears selection and preview. Primary pointer-down focuses the canvas without consuming placement, and pending commands queue rather than being silently discarded. The Rivals button and deposit controls are removed. Unfinished cancellation refunds 100%; completed dismantling refunds 75%; enemy destruction refunds nothing. Completed flooring remains walkable. Orphaned dependent blueprints receive full cancellation refunds, duplicate refunds are rejected, and refunded resources can exceed the normal production cap without being discarded.

50 logic/server tests pass. Coverage includes 2–5-player spawn distance equality, capture timing and contest interruption, no remote-research victory, visible-only discovery and updates, physical AI capture, simultaneous damage, Friend core siege, healing delay, respawn and permanent worker death, guard orders, all refund paths including storage overflow, old raid rejection, pause behavior, result causes, matchmaking and RF gating. Typecheck, FriendSDK check and production build pass. Existing pure-engine wave/research fixtures exercise legacy standalone behavior only; actual room states use shared battlefield rules.

The public-preview browser suite `tests/shared-battlefield-browser.mjs` passes at 2560×1440 and 360×852 in `daniel/rarefriends-browser`: exactly two dock buttons, no revealed enemy terrain at start, no deposits, shape-first navigation, Escape clearing placement, canvas focus after selection, one mouse click/touch tap per placement, construction completion, cancellation and dismantling, worker panel fitting without scrolling, and a fixed viewport. No browser or wallet-fixture errors. A phone overflow introduced by the extra medic row was fixed before the passing run. Final artifacts: `artifacts/shared-sector-{2560,360}.png`, `artifacts/shared-workers-{2560,360}.png`. Desktop/phone screenshots inspected. Safari and physical devices were not automated.

The preview server was rebuilt/restarted, clearing old in-memory rooms. No mainnet deposits, deployment, transfers or vibeathon submission. Combat values, longer human matches and physical-phone performance remain playtest items.

## Random monoliths and predefined spawns — build 73621f07f22695f3

Replaced the generated spawn ring with predefined corners at (±32, ±32); two-player matches use opposite corners. The five-player option is preserved pending the builder's preference, using the four corners and one of four predefined edge slots. Each match seeds a fresh four-monolith layout, with rotational balance for corner-only matches and bounded rejection sampling for five players. Five-player shortest objective approaches differ by at most four grid steps. A deterministic balanced fallback bounds generation time. Each monolith has a separate 16-tile landing ring; the central platform is removed. The placement seed stays server-side. Lobby setup is deterministic and live matches cannot relocate.

52 logic tests pass, including 64 seeds per player count for fixed spawn membership and opening distances, 128 seeds for layout variation/spacing, stable positions, hidden seed, and physical AI capture. Typecheck and production build pass. Targeted layout tests also assert separate nonoverlapping landing rings. Browser Testing passes on the public preview at desktop 2560×1440 with five commanders and phone 360×852 with two: predefined spawn coordinates, four neutral platforms, hidden enemies, first-click construction, refunds, focus, and no page scrolling. No browser/fixture errors. Updated full-sector screenshots are in artifacts/shared-sector-{2560,360}.png. Server restart cleared earlier in-memory matches.

## Four-commanders maximum — build 7cf5bb027634c1cc

User confirmed a four-player cap. Custom matches now permit the host plus up to three humans/AI; create, join and bot-add enforce the limit. Menus expose only 0–3 AI and four seats. Removed edge spawns and five-player objective generation; all supported counts use corner slots with rotationally balanced randomized monoliths. Two players still start in opposite corners. Current browser fixtures expect four commanders.

Typecheck, all 52 logic tests, and production build pass. Regression assertions reject a fourth AI on creation, a fifth human join, and adding a bot to a full custom lobby. The restarted preview API accepted three AI plus host, reported maxPlayers=4 and a corner spawn, and rejected four AI. Browser automation was not rerun for this limit-only update. Restart cleared earlier in-memory matches.

## Touch controls — build a2861b42edfc731c

Reproduced missing pinch zoom using Chromium touch input, then added two-finger pan/zoom anchored to the gesture midpoint. The remainder of a pinch cannot become a placement or movement tap when one finger lifts first. Pointer cancellation clears dragging. Reduced minimum map zoom from 25% to 10% so the sector overview fits a phone. Touch devices show a pinch hint.

The 320×568 run exposed objective buttons intercepting the worker drawer close control. Drawers now layer above the objective strip, with sticky headers and 44px close/back touch targets. No game pause or layout reflow is introduced.

`tests/touch-browser.mjs` uses taps and CDP touch gestures without mouse clicks or keyboard shortcuts. Passed 320×568, 360×852, 852×393 and 1024×768 against the preview in Browser Testing. Coverage: wallet-fixture connection; commander inspection/animation/pagination/selection; AI/difficulty selectors; four-player launch; pinch with staggered finger release; one-finger pan and touch cancellation; rotation and single-tap construction; blueprint refund and completed dismantling; building work orders; worker recruitment and assignment/removal; guard follow/hold/turret orders; swiping scrollable worker panels without map commands; all three dock positions; closing selection without Escape; overview zoom; objective navigation and unreachable capture feedback; sound toggle; pause/resume; follow/stop Friend; forfeit and return home. Screenshots are taken after input checks or with direct CDP capture because Playwright's mobile screenshot metric reset caused subsequent injected coordinates to halve at DPR 2.

Typecheck and 52 unit/server tests pass; production build passes. Existing desktop/phone battlefield regression also passes (mouse placement, keyboard shortcuts, refunds, hidden opponents). Browser tests use injected ownership/artwork fixtures and real game APIs. They do not verify native iOS Safari, physical-device gestures, audible playback, external mobile-wallet handoff, or a full touch-only combat match. Combat/capture server rules remain covered by the logic suite.

## Crowded stations, combat and ability economy — build d879acdcea4b34f1

Replaced per-builder repeated BFS reachability checks with a shared navigation/component index for each actor update. Module lookup is indexed during movement. Render work now culls offscreen modules/workers, caches known fog tiles between snapshots, and avoids drawing overlapping resource text for every worker.

Reproducible synthetic server benchmark (`npm run benchmark`): four commanders, 480 modules, 256 workers, 80 simulation/view updates. Before: mean 67.64ms, p95 85.18ms. After: mean 8.29ms, p95 10.24ms. Snapshot about 49KB. This is CPU work per update, not end-to-end mobile latency. Separate Chrome Canvas benchmark with 120 buildings/64 workers: mean 1.36ms → 1.12ms, p95 1.90ms → 1.70ms. Source fixture: tests/performance-fixture.ts; render script and before/after bundles retained in tests/render-benchmark.mjs and artifacts/. Render timing is synthetic, not a physical-phone FPS guarantee.

Buildings now cost alloy only; Shield costs 20 energy (65% reduction, 6s duration, 18s cooldown), EMP costs 15 (visible enemy turrets within 6 tiles, 6s disable, 15s cooldown). Invalid/no-target/cooldown casts do not charge. Turrets deal fixed 8 DPS regardless of staff count. Friend siege damage is 18 DPS and explicit building targets take priority over incidental guards. Following guards contribute once per tick. Research improves physical Friend decoding speed by 25% per work power, up to 2×, with no remote capture or damage buff. Quarters capacity replaces the hard-coded 24-worker ceiling. AI uses the same validated abilities.

Combat feedback includes hostile/friendly projectile colors, moving shots and impact rings, target highlights, turret danger/disabled rings and timers, a visible shield and Friend health bar, and combat status text. Browser combat tests caught and fixed a small negative animation delta causing Canvas arc errors at snapshot arrival; interpolation and EMP radius now clamp to zero.

57 logic tests, typecheck and production build pass. New regression cases cover >24 workers, zero-energy construction, costs/cooldowns/invalid ability names, EMP visibility/range/expiration, paused timers, fixed turret DPS, exact Shield reduction, on-site research speed, and a successful Friend assault on a two-guard turret. Browser Testing passed ability activation and turret destruction at 1440×900, 320×568, 852×393 using the production client and production Rooms logic with a deterministic isolated battlefield fixture. Existing touch suite passed 320×568, 360×852, 852×393, 1024×768 against the live preview. Final phone combat screenshot was visually inspected after moving combat text and hints away from controls: artifacts/combat-320.png. Other combat evidence: artifacts/combat-{1440,852}.png. These are Chromium emulation checks, not native iOS or physical-device testing. Mainnet wagering remains disabled. Server restart cleared earlier matches.

## Building action rail and combat modes — build 8c8812bc04f3a6b2

Replaced the large building detail popup with a same-height action strip beside Build/Workers. Long descriptions no longer obstruct the map; build choices include short purpose labels. Narrow screens scroll actions horizontally. Existing left/right dock settings remain supported. Browser checks caught and fixed a mobile block-layout override clipping buttons and a landscape overlap with camera controls.

Workers (W) now exposes separate Friend/all-worker Aggressive and Peaceful modes. Aggressive temporarily interrupts jobs to attack nearby visible units or buildings over completed-floor routes, with saved assignment slots. Ordinary workers deal 3 DPS; guards retain 7 DPS. Peaceful restores the saved job or idle, and destroyed workplaces invalidate saved jobs. Staffed turrets continue defending in either mode. Explicit Friend movement/attacks take priority; manual attack orders remain available in Peaceful. New workers inherit the group's setting. The dock shows worker mode. Auto-target acquisition is limited to once per second with vision reused per player.

60 logic tests, typecheck and build passed. New server regressions cover interrupt/return-to-work behavior, ordinary-worker damage, refusal to cross empty space, manual Friend movement priority, invalid mode input, explicit attacks while peaceful and mode inheritance. The siege-only regression now explicitly makes its defender peaceful to isolate the attack from the newly enabled automatic counter-siege.

Browser Testing passed the new mode toggles, action-rail alignment/height, ability buttons and turret combat at desktop 1440×900, phone 320×568 and landscape 852×393. Existing touch regression passed 320×568, 360×852, 852×393 and tablet 1024×768, including all dock positions, panel swipes, building/refunds, worker/guard controls and camera gestures. These are Chromium emulation checks, not physical iOS testing. Screenshots: artifacts/command-rail-{1440,320,852}.png. Synthetic crowded simulation remained at mean 8.08ms/p95 11.04ms for 480 modules and 256 workers; forcing every worker into Aggressive measured mean 11.28ms/p95 33.66ms. Mainnet wagering remains disabled; preview restart cleared prior matches.

## Icon combat toggles, dock spacing, block keys — build f101e4fe366c26ae

Removed the mode-selection rows from Workers. Two always-available icon buttons beside Shield/EMP toggle Friend/all-worker aggression with a single click or tap; unit/group silhouettes identify who changes, sword/leaf and color identify the state. Buttons retain accessible labels and pressed state. The abilities area uses two compact rows and remains separated from camera controls on small screens and side docks.

The selected-building strip now sizes to its contents instead of the available half-viewport, and its name no longer reserves 120px of empty width. Desktop actions, including recruit and close, fit without clipping. Phone actions remain horizontally scrollable. This change addresses HUD spacing; map zoom, world bounds and fog are unchanged.

Added global, context-aware block shortcuts: B, then 1–7 or I/O/T/L/J/S/Z; the building step uses 1–8. Key hints appear on desktop. The handler works with focus on a HUD button or the level, skips inputs/dialogs/modifiers and repeat events, and Escape clears selection.

Typecheck and production build passed. Browser combat/HUD checks passed 1440×900, 320×568 and 852×393, including icon-only one-tap mode changes, same-height building actions, no desktop rail overflow and touch abilities. Desktop keyboard checks exercise all seven numeric block selections, all seven letter selections and all eight buildings after HUD clicks, plus Escape. Screenshots: artifacts/command-rail-{1440,320}.png. Validation uses Chrome/Chromium in Browser Testing, not a physical phone.

## Staff stay at posts; compact action icons and navigation — build 39cd7bfe80c4f65d

Worker aggression now mobilizes unassigned builders and guards explicitly ordered into follow/hold duty. Assigned specialists and turret staff are excluded from both automatic pursuit and personal autoattacks, so close enemies do not interrupt production. Turrets still fire through staffed building combat. Assigning a fighting free builder to a specialist post cancels its attack immediately. An older interrupted specialist order is restored before the worker resumes post duty. Friend behavior is unchanged. Toggle help now says Free workers.

The action strip removes building/Command name text and uses 44px icons for the two main controls and contextual actions. Refund percentages and recruitment costs remain visible; names and descriptions remain accessible and in hover help. Friend work displays pressed state and toggles start/stop. Worker count/capacity appears once in the drawer heading; the recruit row shows unassigned count. Backspace returns to block selection and preserves the shape, then closes the drawer from the first step. Inputs/dialogs keep normal editing behavior.

Typecheck, build and all 61 logic tests passed. New regressions cover a miner continuing production with an enemy in personal range, free workers engaging, a fighting builder returning to an assigned foundry, turret staff staying put and firing, and explicitly mobilized guards responding. Browser Testing passed desktop 1440×900, portrait 320×568 and landscape 852×393 for modes, compact actions, all block/building shortcuts, Backspace preserving each shape, ability use and combat. The full 320×568 touch suite also passed recruitment/assignment, building/refunds, all dock positions, gestures and settings. Phone screenshot visually inspected: artifacts/command-rail-320.png. Tests use Chrome emulation, not a physical phone. Preview server restart cleared previous rooms.


## 21 September — live multiplayer readiness

See [the live playtest report](LIVE-PLAYTEST.md) for the final four-browser stress run (240 buildings, 256 workers, 496 commands), shared-objective/combat/victory evidence, matchmaking, touch and submission-mode checks. Dismantling now evacuates friendly occupants and removes flooring; same-tab reload restores the seat after wallet validation. 65 logic/server and 8 local contract tests pass, as do typecheck, SDK validation, production build and a fresh dependency install/build. Public preview build: `dba32947464e80e7`. Paid play remains disabled. The direct 16-seat HTTP load passes, but the public development proxy rate-limits that load; this is a small early-access playtest, not a large-launch signoff.
