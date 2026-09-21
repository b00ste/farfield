# Install Farfield

Open [farfield.fun](https://farfield.fun/) in a browser and choose **Install game** on the title screen. Connecting a wallet is not required to install.

- **Android, Chrome or Edge:** use the native install prompt when offered, or the browser's Install app / Add to Home Screen command.
- **iPhone and iPad:** Share → Add to Home Screen → enable Open as Web App if shown → Add. If the option is missing, open the address in Safari.
- **Mac Safari:** File → Add to Dock.

Launch the new icon to play in a standalone window. Installation help disappears when running standalone. A browser may keep the browser tab and installed app's storage separate; reconnect your wallet if asked. Installing does not transfer an active match to another window.

## Connectivity and updates

Matches, ownership checks and wallets require internet access. Offline startup shows a reconnect screen. There is no offline simulation, command replay or background matchmaking.

The service worker caches only the public offline page and application icons. Game bundles and HTML are fetched from the server; API, RPC, wallet, authorization and event-stream requests are never cached by the worker. The worker does not request immediate takeover or reload a page. A new version waits for old app windows to close before activation; ordinary first installation may claim existing windows without reloading them.

Preferences use local storage where available. Denied storage must not prevent loading; settings and wallet reconnection metadata may then be limited to the session. No persistent "installed" preference hides the button after uninstalling the app.

## Hosting

Installation requires HTTPS (localhost is allowed for development). Existing Docker and AWS builds include the manifest, PNG icons, offline page and worker automatically. Serve `/manifest.webmanifest` as `application/manifest+json` and `/service-worker.js` as JavaScript from the root scope. The supplied Node server does this and prevents HTTP caching of the worker script. Keep these paths on the game origin when the API uses another hostname.

`scripts/build-pwa.mjs` creates icons from original station geometry. The SDK builds in its own temporary output directory before the trusted host and PWA assets are assembled, so repeated builds remain valid without weakening the SDK's output checks.

## Validation

Run `npm run test:pwa` in the Browser Testing workspace against an isolated candidate server. The suite checks installation assets, responsive menus, install-event handling, offline fallback, storage restrictions and service-worker update behavior. Synthetic prompt and standalone events verify application behavior, not operating-system installation. Container CI separately verifies the packaged manifest, icon sizes and worker route.

Physical-device acceptance still requires iPhone/iPad Home Screen installation, Safari Add to Dock, launch from the installed icon, and an external-wallet round trip back to the installed game. Browser emulation cannot establish that those OS integrations work on a particular device.
