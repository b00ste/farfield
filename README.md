# Farfield

**A little further. Your frontier.** A browser space-strategy game built with FriendSDK, RainbowKit, React, Canvas 2D and an authoritative Node server. Your Rare Friend is the main character: gather resources, construct tetromino rooms, recruit helpers, fight rival stations and capture four shared monoliths.

[Play the preview](https://4173--main--ai-dev-01--daniel.kethalia.com/). Available while the development workspace and server are running. For the 960×640 submission viewport, use [submission mode](https://4173--main--ai-dev-01--daniel.kethalia.com/?submission=1); the normal URL keeps the responsive full-window layout.

## Play

The game preloads its assets and opens a fixed, full-screen title menu with an animated station backdrop. The page does not scroll; match setup appears only after choosing a mode. AI count, difficulty and control placement use themed custom selectors with keyboard and touch support. Connect an eligible Rare Friends wallet on Robinhood mainnet (4663). You do not need to pick a Friend immediately: pressing Play uses your first eligible Friend. **Change commander** opens a full-screen, unframed sprite roster with search and responsive pagination. Inspection shows the Friend type, generation, canonical idle/walk animation, explicit selection and Back. The SDK freshly verifies ownership and hardwired generation ≥1 before play.

- **Friends & AI:** enter directly into your full-screen sector. Up to **four commanders total**, any mix of humans and up to three AI. Set initial AI count/difficulty on the landing; use **Menu → Match & invitations** inside the game to share the 10-character invitation code and add/remove Easy, Normal or Hard bots. Friends select **Join friends** from the title menu and enter that code. The host begins once everyone is present. Each commander owns a separate station; no mid-match joining.
- **Online PvP:** automatic 1 vs 1 matchmaking. **Practice matchmaking is live**, with no deposit or payout. The requested token mode has a fixed **1 RF entry per player** and a **2 RF winner pool**, server-refereed results and timeout refunds. The code and local-chain integration are implemented, but **mainnet deposits are disabled pending escrow/referee deployment**. See [RF escrow and deployment](docs/ESCROW.md).

Custom matches are free. Start with your Friend, a command core, zero workers, 65 alloy, 45 energy and 40 food. A compact resource strip and two-button Build / Workers dock float above the full-screen map. Set **Menu → Controls position** to Bottom (default), Left or Right; this choice persists between matches. Build and worker drawers animate open without pausing play or resizing the map; the SDK preview toolbar is hidden during play, and wallet controls remain available in **Menu → Wallet & connection**.

## Controls

| Action              | Control                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Build | **B / Build** → choose a block with **1–7** or **I/O/T/L/J/S/Z** → choose a building with **1–8** → click/tap once to place. Backspace returns to block selection; R rotates; Escape clears placement. |
| Cancel / dismantle | Click your blueprint or building. Cancel unfinished work for **100%** of alloy; dismantle completed buildings for **75%**. Dismantling removes the tiles. Your units walk clear automatically before removal; a bridge that would disconnect your station must be replaced with another route before removal. Dependent orphaned blueprints also cancel with a full refund. |
| Work | Click an owned building. Your Friend walks there and operates it. |
| Recruit | **W / Workers** → Recruit worker (6 alloy + 8 food), then job +/− controls. Guards can follow the Friend or defend their current position. |
| Move | Click completed flooring or use arrow keys. Friends and workers cannot cross void or unfinished blueprints. Connected enemy and neutral flooring is walkable. |
| Explore | Drag to pan; pinch, scroll or +/− to zoom. ◎ centers your core; **Menu → Find my Friend** follows the commander. |
| Fight | Click a visible enemy unit or building. Your Friend walks into range and attacks. Following guards support building sieges. |
| Objectives | The four public monolith indicators locate objectives. Click a monolith on the level to approach and capture. |
| Settings / exit | **Menu** → sound, reduced motion, wallet, help or confirmed forfeit. Custom hosts may pause; online matches cannot. |

## Shared battlefield rules

- Everyone builds in one **81 × 81** sector. Each match seeds four random monolith locations with a separate landing platform around each. Two–four commanders use fixed corner slots, with opposite corners in two-player matches. Starting supplies are equal and players are shuffled among seats. Layouts have rotationally balanced objectives with equal distances from every corner. Bases start with only a core and no resource deposits. Objective locations remain fixed once play begins.
- Enemy bases have no map markers. The server filters unseen tiles and units. Discovered floor remains as last-known terrain; new construction outside sight remains hidden and moving enemies vanish outside current vision. Discovery never exposes a rival's complete live state or resource totals.
- Choose any of seven tetromino shapes. Blueprints attach to connected flooring or another queued blueprint, without overlap. Builders and the Friend finish reachable prerequisites in order. Maximum 180 commissioned modules per player.
- The core has two worker beds; Quarters add four each, with no separate 24-worker cap. Each specialist room has two slots. The Friend supplies two work power; workers supply one after reaching their workplace. Idle builders repair a damaged core using alloy.
- Alloy/second = `(0.12 + 0.55 × mining power + 0.35 × core salvage power) × food efficiency`. Energy/second = `0.25 + 0.7 × engineering power`. Food/second = `0.8 × farming power − 0.045 × (workers + 1)`. Food efficiency falls to 35% at zero food. Production caps at 300; refunds can overflow storage without being discarded.
- Blueprint progress/second = `0.16 × construction power × food efficiency`. No worker or Friend present means no progress.

Compact icon actions (with hover help and accessible names) stay in a shallow action strip beside the Build/Workers buttons; on narrow screens swipe the strip sideways for more actions. Two icon toggles beside Shield/EMP control the Friend (single figure) and free workers (group). Crossed swords mean Aggressive; a leaf means Peaceful. Click once to switch. **Aggressive** sends unassigned builders to fight nearby visible enemies over completed flooring; **Peaceful** returns them to general construction or idle. Assigned specialists and turret staff stay at their posts in either mode. Guards explicitly ordered to follow or hold are mobile combat units. Ordinary workers deal 3 DPS; guards deal 7. Workers begin peaceful, the Friend aggressive. New workers inherit the group's setting. Direct Friend movement/attack orders take priority; staffed turrets continue defending in either mode.

Buildings cost **alloy only**. Energy powers Friend abilities.

| Building | Alloy | Purpose |
| --- | ---: | --- |
| Passage | 4 | Extend walkable flooring |
| Reactor | 12 | Energy production for abilities |
| Garden | 10 | Food production |
| Foundry | 14 | Alloy production |
| Quarters | 14 | Four additional worker beds |
| Defense | 16 | Staffed turret: 5-tile range, fixed 8 damage/second |
| Research | 18 | +25% on-site decoding speed per science work power, capped at +100%; no remote captures |
| Infirmary | 16 | Staffed medic heals allies within four tiles |

| Ability | Control | Energy | Effect | Cooldown |
| --- | --- | ---: | --- | --- |
| Shield | Q / Shield button | 20 | 65% damage reduction for 6 seconds | 18 seconds |
| EMP | E / EMP button | 15 | Disable visible enemy turrets within 6 tiles for 6 seconds | 15 seconds |

Failed or out-of-range casts cost nothing. Red projectiles are hostile; friendly fire is green/gold. Turret range rings show danger, blue rings and a timer mark disabled turrets, and the Friend's shield and HP are visible on the map. Research accelerates a Friend physically decoding a monolith; it does not grant combat damage or capture remotely.

The Friend has 120 HP and deals 12 damage/second to units and 18 to selected buildings; workers have 60 HP and guards deal 7 damage/second within 2.2 tiles. Incoming unit damage resolves simultaneously. Enemy destruction pays no refund; destroyed buildings leave walkable wreckage. The core uses the displayed 100 hull as its health. Destroying it eliminates its commander. Core repairs cost 0.5 alloy/second per repair work power and restore 1.5 hull/second per power.

The core heals nearby units within three tiles; a staffed Infirmary heals within four. Healing restores 8 HP/second after four seconds without taking damage. A downed Friend respawns at their surviving core after 15 seconds. Lost workers must be replaced. Flying raids are disabled, including requests from old clients.

A living Friend within 2.5 tiles captures a monolith in **10 seconds**, reducible to five with staffed Research. Nearby rival Friends or guards contest it and pause capture. Ownership persists after leaving. Hold all four uncontested for **60 continuous seconds** to win; an enemy capture attempt or contest resets that countdown. The other victory condition is last core standing. Ownership, contests and the countdown are public. Full-screen results name the winner and cause.

AI uses the same costs, physical construction, paths, capture and combat rules. Easy/Normal/Hard decision intervals are 6/3/1.5 seconds. Bots build an economy, recruit guards, approach shared objectives, fight visible enemies, retreat when low on health, and use the same energy/cooldown-gated abilities. AI balance remains an early-access playtest item.

## Host your own game

Use the [self-hosting guide](docs/SELF-HOSTING.md) for local setup or a public Docker/Caddy deployment, including one-domain and separate game/API-domain configurations, HTTPS, backups, recovery and upgrades. The [hosting comparison](docs/CLOUD-HOSTING.md) covers AWS Lightsail/EC2, GCP Compute Engine, other VPS providers, managed containers and a static frontend with a separate backend.

Farfield's production layout uses **farfield.fun** for the game and **api.farfield.fun** for the API. Both can run on one dedicated machine. Self-hosters can instead use a single domain. Run **one authoritative game-server process**; multiple replicas and automatic failover require match ownership/routing work. RF deposits remain disabled in the supplied configuration.

## Run and check

Requires Node 22.18+ (Node 24 recommended) and npm. Solidity checks additionally require Foundry.

```sh
npm ci
npm run dev
```

Open `http://localhost:4173`. The server listens on `0.0.0.0`; another device on your network can use the machine’s LAN address where its wallet supports it. Public play should use HTTPS. Rebuild/restart after source changes; this is not a hot-reload server.

```sh
npm run typecheck
npm test
npm run check
npm run build
npm run test:contracts
```

Browser automation belongs in **Browser Testing**, using its installed Chrome:

```sh
TEST_URL=https://4173--main--ai-dev-01--daniel.kethalia.com npm run test:browser
TEST_URL=https://4173--main--ai-dev-01--daniel.kethalia.com npm run test:walletconnect
```

The current browser suites are `tests/submission-browser.mjs`, `tests/touch-browser.mjs`, `tests/combat-browser.mjs` and `tests/live-four-player.mjs`. Older dashboard-specific suites remain as historical fixtures and their selectors are superseded. Wallet/RPC/artwork mocks run only inside browser tests, never in the public application. See [validation](docs/VALIDATION.md) and [workspace handoff](docs/BROWSER_HANDOFF.md). RF integration uses a separate local Anvil test described in [ESCROW.md](docs/ESCROW.md).

## Architecture and limitations

FriendSDK v0.1.2 is packaged in `vendor/rarefriends-friendsdk-0.1.2.tgz` from upstream commit `762d6f58a73ace723f7f82dc1a61bfa036c21edc`. No SDK source modifications. Canonical idle/walk sprites are decoded through its sprite reader, including Colossus’s supported side-facing clips. The iframe retains `sandbox="allow-scripts"` and the SDK CSP.

The trusted host owns RainbowKit and wallet requests. The sandbox uses a bounded private MessageChannel for game commands, selected-Friend art, launch preferences and opening trusted wallet/escrow UI. It never receives a provider, signer or referee key. Only the exact current SDK iframe can use that relay. The room server ticks every 100ms; the trusted host receives authenticated server-sent events about every 250ms and relays monotonic revisions over a private port. The client interpolates character motion between snapshots; commands remain ordinary authenticated requests. Presence requests occur on menu/visibility changes, with heartbeat detection and bounded reconnect backoff. Canvas draws on animation frames.

The backend `/api/friend-rpc` read proxy avoids duplicate CORS headers observed from the public Robinhood RPC. It permits only required ownership/artwork reads, owner-filtered Transfer history, chain/block reads and native balance queries. No transaction submission, signing, arbitrary contract calls or collection-wide scans. Optional server-only `FRIEND_RPC_URL` selects an upstream provider. The trusted host uses same-origin API requests by default; set build-time `PUBLIC_API_ORIGIN` and server-side `FARFIELD_ALLOWED_ORIGINS` for a separate API hostname.

RainbowKit matches the game’s navy/sage theme. The public WalletConnect project ID is configured; override with `WALLETCONNECT_PROJECT_ID=your-id npm run build`. An explicitly empty value builds installed-wallet-only connections. Library compatibility pins for `cuer`/`qr`, `ws` and the `wagmi/chains` build alias are retained.

Rooms run in one authoritative process and expire after two inactive hours. Set `FARFIELD_STATE_PATH` to an absolute private file path outside the web root to enable practice-room snapshots every five seconds and on graceful shutdown. The prepared cloud deployment and current preview enable this; without it, rooms reset on restart. Recovery retains the same station and seat without simulating downtime; a crash loses changes since the last successful snapshot. Reloading the same tab restores your seat after reconnecting the same wallet and verifying the same Friend. Closing the tab or changing browsers does not preserve practice seat credentials. Paid rooms are excluded from this snapshot store. **Paid seats can be recovered by freshly signing in with the same wallet and Friend while the server retains the room.** If the referee server loses a funded match, on-chain timeout refunds remain available. Saved escrow match IDs appear in landing settings; users can also enter an ID manually or call the contract directly. Online disconnections longer than 60 seconds forfeit even when every tab is hidden; simultaneous expiry ends in a draw.

Practice API identities are displayed Friend IDs protected by unguessable room capabilities, without separate cryptographic wallet attestation. **Paid matchmaking separately requires a single-use signed challenge and fresh on-chain ownership**, never a practice identity. EOA signatures are supported; contract-wallet signature verification is not yet implemented. The escrow trusts the immutable referee’s winner report. Tests are not an independent contract audit. Mainnet deployment, funding and actual-wallet wager testing have not occurred.

This needs a Node backend; static GitHub Pages alone cannot host it. Shared-host rate limits, bounded rooms and request sizes are included. The private snapshot store supports one process; there is no multi-instance coordination, ranked rating system or ranked matchmaking. See [hosting options and cost estimates](docs/CLOUD-HOSTING.md) and the [self-hosting recovery procedure](docs/SELF-HOSTING.md). Human game balance and performance on physical phones remain playtest items.

## Attribution and submission

FriendSDK and canonical Rare Friends art: [spokesz/friendsdk](https://github.com/spokesz/friendsdk). See [third-party notices](THIRD_PARTY_NOTICES.md). Station graphics, UI, gameplay and multiplayer implementation are original; rymdkapsel supplies genre inspiration only. UI audio uses the SDK sound kit. Fonts use system fonts and Georgia.

The required SDK chance-game schema in `game.json` is unused scaffolding and **does not implement the PvP escrow**. No chance-game purchase or reward actions are exposed. All alloy, food and energy are simulated resources. RF wagering uses the separate fixed-entry escrow when deployed and enabled; custom and practice games remain free.

See [submission draft](docs/SUBMISSION.md). The builder has authorized submission after the live multiplayer readiness checks.
