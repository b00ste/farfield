import { useState, useSyncExternalStore } from "react";
import { MenuDialog } from "./menu-dialog";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Listen when the host module loads, before asset loading mounts the title menu.
// This state belongs to the current browser session, never to localStorage:
// an old "installed" flag would hide installation after someone removes the app.
const standaloneMedia = window.matchMedia("(display-mode: standalone)");
const subscribers = new Set<() => void>();
let promptEvent: InstallPromptEvent | null = null;
let installedThisSession = false;
const isStandalone = () =>
  standaloneMedia.matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
let installed = isStandalone();
function notify() {
  installed = installedThisSession || isStandalone();
  for (const subscriber of subscribers) subscriber();
}
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  promptEvent = event as InstallPromptEvent;
  notify();
});
window.addEventListener("appinstalled", () => {
  promptEvent = null;
  installedThisSession = true;
  notify();
});
standaloneMedia.addEventListener("change", notify);
window.addEventListener("pageshow", notify);
const subscribe = (subscriber: () => void) => {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
};
const getInstalled = () => installed;

function InstallInstructions() {
  const appleMobile =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const macSafari =
    /Macintosh/.test(navigator.userAgent) &&
    /Safari/.test(navigator.userAgent) &&
    !/Chrome|Chromium|Edg|OPR/.test(navigator.userAgent);
  return (
    <div className="install-instructions">
      {appleMobile ? (
        <>
          <p>Add Farfield to your Home Screen.</p>
          <ol>
            <li>Open the browser’s Share menu.</li>
            <li>
              Choose <strong>Add to Home Screen</strong>.
            </li>
            <li>
              If shown, turn on <strong>Open as Web App</strong>, then tap{" "}
              <strong>Add</strong>.
            </li>
          </ol>
          <p className="install-note">
            Missing that option? Open farfield.fun in Safari.
          </p>
        </>
      ) : macSafari ? (
        <>
          <p>Add Farfield to your Dock.</p>
          <ol>
            <li>
              Open Safari’s <strong>File</strong> menu.
            </li>
            <li>
              Choose <strong>Add to Dock</strong>, then <strong>Add</strong>.
            </li>
          </ol>
          <p className="install-note">
            If unavailable, try a newer Safari or Chrome.
          </p>
        </>
      ) : (
        <>
          <p>
            Open your browser’s menu and choose <strong>Install app</strong> or{" "}
            <strong>Add to Home Screen</strong>.
          </p>
          <p className="install-note">
            On desktop, look for the install icon in the address bar. If
            unavailable, try Chrome or Edge.
          </p>
        </>
      )}
      <p className="install-note">An internet connection is needed to play.</p>
    </div>
  );
}

export function InstallGameButton({ number }: { number: string }) {
  const hidden = useSyncExternalStore(subscribe, getInstalled);
  const [help, setHelp] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const install = async () => {
    const event = promptEvent;
    if (!event) {
      setHelp(true);
      return;
    }
    // A captured event can only be used once, including after a dismissal.
    promptEvent = null;
    setPrompting(true);
    try {
      // Keep the native prompt inside the user's click activation.
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "dismissed") setHelp(true);
    } catch {
      setHelp(true);
    } finally {
      setPrompting(false);
    }
  };
  if (hidden) return null;
  return (
    <>
      <button
        aria-label="Install game"
        onClick={() => void install()}
        disabled={prompting}
      >
        {prompting ? "Installing…" : "Install game"}{" "}
        <span aria-hidden="true">{number}</span>
      </button>
      {help && (
        <MenuDialog title="Install Farfield" onClose={() => setHelp(false)}>
          <InstallInstructions />
        </MenuDialog>
      )}
    </>
  );
}
