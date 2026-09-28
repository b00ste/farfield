# Local ranked preview

Use a local preview for changes before merging and deploying production. This runs the real ranked sign-in, matchmaking and leaderboard backend with separate local data. It does not deploy anything to AWS or read production state.

## Start

Use Node 24 (minimum 22.18), then run from the repository:

```sh
npm ci --ignore-scripts
npm run preview:local
```

Open **http://localhost:4180** after the ready message. Connect a wallet that owns an eligible Rare Friend to use ranked matchmaking. Two different wallets and Friends are needed for a ranked match. Custom matches can include AI opponents. Local sign-in checks real Friend ownership through the configured blockchain RPC.

The runner builds a temporary copy of the current sources, using the installed dependencies. It forces same-origin API requests and leaves the regular `dist/` and `games/farfield/.friendsdk/` builds untouched. There is no hot reload: stop with **Ctrl+C**, then rerun after edits. Shutdown saves local rooms; interrupted ranked matches are cancelled without rating changes on restart. Completed ratings survive restarts.

Local data is stored in **`.farfield/local-preview/4180/`**, outside the public game files and already ignored by Git. The directory is private, and the server writes private room snapshots and a SQLite ratings database. Temporary build files are removed when the runner stops; local saves are retained. Do not copy production saves into this directory.

## Configuration

| Variable                   | Default                    | Purpose                                                                                                  |
| -------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `LOCAL_PREVIEW_PORT`       | `4180`                     | Local server port and the matching local save directory. Port 4173 is reserved for the existing preview. |
| `LOCAL_PREVIEW_ORIGIN`     | `http://localhost:<port>`  | Exact browser origin used for ranked signatures and allowed browser requests. No trailing slash or path. |
| `FRIEND_RPC_URL`           | Public Robinhood Chain RPC | Optional server-only RPC endpoint for Friend reads and ownership verification.                           |
| `WALLETCONNECT_PROJECT_ID` | Existing app project ID    | Public WalletConnect project ID used when building this preview.                                         |

Example of another local port:

```sh
LOCAL_PREVIEW_PORT=4181 npm run preview:local
```

This uses `.farfield/local-preview/4181/`. The runner checks for an occupied port before building or opening the saves. It does not read `.env` files, inherit production state paths/origins, or copy provider credentials from deployment configuration. Supply any optional `FRIEND_RPC_URL` explicitly in your shell or local secret manager; it is passed only to the server, never embedded in the browser build. Public RPC capacity may limit ownership checks; use a separate development provider endpoint if needed. Do not paste private RPC URLs into screenshots, reports or source files.

## Phones and other devices

`localhost` on a phone refers to the phone, not the computer running Farfield. The Node server listens on all interfaces; restrict access with the computer's firewall. For same-network testing, choose the origin you will actually open:

```sh
LOCAL_PREVIEW_ORIGIN=http://192.168.1.50:4180 npm run preview:local
```

Replace the address with the computer's LAN address. HTTP LAN addresses are not secure browser contexts; mobile wallets and PWA installation may require HTTPS. For wallet/device testing, put an HTTPS reverse proxy or development tunnel you control in front of `localhost:4180`, then restart with that exact public origin:

```sh
LOCAL_PREVIEW_ORIGIN=https://preview.your-domain.example npm run preview:local
```

The runner does not provision the proxy, certificate or tunnel. Proxy the whole origin, including `/api/events`, and preserve long-lived SSE responses. Open the configured HTTPS origin on both devices and allow it in your WalletConnect project's origin settings where required. Browser requests from other origins are rejected; changing the origin requires restarting and signing in again. Avoid exposing the raw HTTP port to the public internet. Local ratings remain separate from production even when a tunnel is used.

## Smoke check

```sh
npm run preview:local -- --smoke
```

This builds and starts the actual local server, checks `/health` and `/api/ranked/config`, then shuts it down gracefully. It retains the local save directory. A passing smoke check confirms startup and ranked configuration; it does not verify a real wallet signature, Friend ownership, browser rendering or a complete multiplayer match.
