import { useRanked, RankSummary, RankedLeaderboard } from "./ranked";
import { readSeat } from "./session";
import { apiUrl } from "./api";
import { GameSelect } from "../games/farfield/GameSelect";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LaunchConfig } from "../games/farfield/launch";
import {
  ConnectButton,
  RainbowKitProvider,
  useAccountModal,
  useChainModal,
  useConnectModal,
} from "@rainbow-me/rainbowkit";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { WagmiProvider, useAccount } from "wagmi";
import { ConnectedGameHost } from "@rarefriends/friendsdk/runtime";

import { readOwnedFriends } from "@rarefriends/friendsdk/owned";
import { createFriendPublicClient } from "@rarefriends/friendsdk/wallet";
import { parseChanceGame } from "@rarefriends/friendsdk/game";
import { createGenerationSpriteReader } from "@rarefriends/friendsdk/sprites";
import { TitleScene } from "./title-scene";
import { MenuDialog } from "./menu-dialog";
import { InstallGameButton } from "./pwa-install";
import { CommanderScreen } from "./friend-cards";
import definitionJson from "../games/farfield/game.json";
import { robinhood, walletConfig, walletTheme } from "./wallet-config";
import "@rainbow-me/rainbowkit/styles.css";
import "./wallet.css";

const definition = parseChanceGame(definitionJson);
const queryClient = new QueryClient();
// Discovery verifies every held NFT. Batch those reads to avoid a burst of
// individual HTTP requests against the public RPC for larger collections.
export const publicClient = createFriendPublicClient({
  rpcUrl: apiUrl("/api/friend-rpc"),
  batch: true,
});
export const spriteReader = createGenerationSpriteReader(publicClient);
// Read by the room relay so a wallet modal suspends that commander's game actions.
export const walletUi = {
  blocked: false,
  rankedToken: null as (() => string | null) | null,
  invalidateRanked: null as (() => void) | null,
  account: null as string | null,
  chainId: null as number | null,
  friendId: null as string | null,
  launch: null as LaunchConfig | null,
};
function readPreferences() {
  try {
    return JSON.parse(localStorage.getItem("farfield-preferences") || "{}");
  } catch {
    return {};
  }
}
const connection = (
  <ConnectButton
    label="Connect wallet"
    showBalance={false}
    chainStatus="full"
    accountStatus="address"
  />
);

function WalletHost() {
  const { address, chainId, connector, status } = useAccount();
  const { accountModalOpen, openAccountModal } = useAccountModal();
  const { chainModalOpen, openChainModal } = useChainModal();
  const { connectModalOpen, openConnectModal } = useConnectModal();
  useEffect(() => {
    const account = () => openAccountModal?.();
    window.addEventListener("farfield-wallet", account);
    return () => window.removeEventListener("farfield-wallet", account);
  }, [openAccountModal]);
  const modalOpen = accountModalOpen || chainModalOpen || connectModalOpen;
  walletUi.blocked = modalOpen;
  const identityKey = `${connector?.uid ?? ""}:${address ?? ""}:${chainId ?? ""}`;
  const [assetsReady, setAssetsReady] = useState(false),
    [assetError, setAssetError] = useState("");
  const [launch, setLaunch] = useState<LaunchConfig | null>(null);
  const [playRequested, setPlayRequested] = useState(false),
    [picker, setPicker] = useState(false);
  const [mode, setMode] = useState<"custom" | "online">("custom");
  const [botCount, setBotCount] = useState(1),
    [difficulty, setDifficulty] = useState<"easy" | "normal" | "hard">(
      "normal",
    );
  const [code, setCode] = useState("");
  const [muted, setMuted] = useState(() => readPreferences().muted !== false);
  const [reduced, setReduced] = useState(
    () =>
      readPreferences().reduced ??
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState<"main" | "custom" | "online" | "join" | "leaderboard">(
    "main",
  );
  const menuRef = useRef(menu);
  menuRef.current = menu;
  useEffect(() => {
    let live = true;
    Promise.all(
      ["game.js", "game.css", "game-layout.css"].map(async (file) => {
        const r = await fetch(`./${file}?v=${__FARFIELD_BUILD__}`);
        if (!r.ok) throw new Error("Game assets could not load.");
        await r.arrayBuffer();
      }),
    )
      .then(() => {
        if (live) setAssetsReady(true);
      })
      .catch((e) => {
        if (live) setAssetError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const home = () => {
      setLaunch(null);
      setMenu("main");
      setPlayRequested(false);
      setPicker(false);
      const prefs = readPreferences();
      setMuted(prefs.muted !== false);
      setReduced(prefs.reduced ?? false);
      walletUi.launch = null;
    };
    window.addEventListener("farfield-home", home);
    return () => window.removeEventListener("farfield-home", home);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        "farfield-preferences",
        JSON.stringify({ ...readPreferences(), muted, reduced }),
      );
    } catch {
      // Private browsing or storage policy must not prevent opening the game.
    }
  }, [muted, reduced]);
  const [selection, setSelection] = useState<{
    key: string;
    id: bigint;
  } | null>(null);
  const connected =
    status === "connected" && !!address && chainId === robinhood.id;
  const discovery = useQuery({
    queryKey: ["owned-friends", identityKey],
    queryFn: ({ signal }) =>
      readOwnedFriends(publicClient, address!, { signal }),
    enabled: connected,
    staleTime: 0,
    gcTime: 0,
    // Restart discovery from a fresh block after a transient RPC failure.
    retry: 1,
    retryDelay: 1500,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // No previous account's selection or in-flight discovery can enable play.
  const friends =
    connected && !discovery.isFetching && !discovery.isError
      ? (discovery.data?.friends ?? [])
      : [];
  const friend =
    selection?.key === identityKey
      ? (friends.find((f) => f.id === selection.id) ?? null)
      : null;
  const rankedFriendId = friend ? String(friend.id) : friends[0] ? String(friends[0].id) : null;
  const ranked = useRanked(identityKey, address, rankedFriendId);
  walletUi.rankedToken = ranked.token;
  walletUi.invalidateRanked = ranked.invalidate;
  useEffect(() => {
    const refresh = () => void ranked.refresh();
    window.addEventListener("farfield-home", refresh);
    return () => window.removeEventListener("farfield-home", refresh);
  }, [identityKey, rankedFriendId]);
  walletUi.account = address ?? null;
  walletUi.chainId = chainId ?? null;
  walletUi.friendId = friend ? String(friend.id) : null;
  walletUi.launch = launch;
  useEffect(() => {
    if (
      !playRequested ||
      !connected ||
      discovery.isFetching ||
      discovery.isError ||
      !friends.length ||
      picker
    )
      return;
    if (!friend) {
      setSelection({ key: identityKey, id: friends[0].id });
      return;
    }
    let live = true;
    spriteReader
      .read(friend.id)
      .then(() => {
        if (live) {
          setLaunch({
            mode,
            dock: readPreferences().dock ?? "bottom",
            bots: Array.from({ length: botCount }, () => difficulty),
            code,
            muted,
            reduced,
          });
          setPlayRequested(false);
        }
      })
      .catch((e) => {
        if (live) {
          setAssetError(
            e instanceof Error
              ? e.message.split("\n")[0]
              : "Could not prepare your Friend. Try again.",
          );
          setPlayRequested(false);
        }
      });
    return () => {
      live = false;
    };
  }, [
    playRequested,
    connected,
    discovery.isFetching,
    discovery.isError,
    friend,
    friends,
    picker,
    identityKey,
    mode,
    botCount,
    difficulty,
    code,
    muted,
    reduced,
  ]);
  useEffect(() => {
    setLaunch(null);
    setPlayRequested(false);
  }, [identityKey]);
  const restored = useRef(false);
  useEffect(() => {
    if (
      restored.current ||
      launch ||
      !connected ||
      discovery.isFetching ||
      discovery.isError
    )
      return;
    const saved = readSeat();
    if (
      !saved ||
      saved.account.toLowerCase() !== address?.toLowerCase() ||
      saved.chainId !== chainId
    )
      return;
    const owned = friends.find((f) => String(f.id) === saved.friendId);
    if (!owned) return;
    if (friend?.id !== owned.id) {
      setSelection({ key: identityKey, id: owned.id });
      return;
    }
    restored.current = true;
    setLaunch({
      ...saved.launch,
      resume: { code: saved.code, token: saved.token },
    });
  }, [
    launch,
    connected,
    discovery.isFetching,
    discovery.isError,
    address,
    chainId,
    friend,
    identityKey,
    friends,
  ]);
  const submission =
    new URLSearchParams(location.search).get("submission") === "1";
  useLayoutEffect(() => {
    if (!submission) return;
    const resize = () =>
      document.documentElement.style.setProperty(
        "--submission-scale",
        String(Math.min(innerWidth / 960, innerHeight / 640)),
      );
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [submission]);
  const root = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const update = () =>
      setFrame(
        root.current?.querySelector<HTMLElement>(".rf-game-frame") ??
          root.current,
      );
    update();
    const observer = new MutationObserver(update);
    observer.observe(root.current!, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!frame) return;
    // RainbowKit's supported modal portal lives in the trusted document. Bound its
    // visual/focus surface to the game viewport without patching library internals.
    const measure = () => {
      const box = frame.getBoundingClientRect();
      for (const [name, value] of Object.entries({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      }))
        document.documentElement.style.setProperty(
          `--wallet-frame-${name}`,
          `${value}px`,
        );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [frame]);
  useEffect(() => {
    if (frame) frame.inert = modalOpen;
    return () => {
      if (frame) frame.inert = false;
    };
  }, [frame, modalOpen]);
  return (
    <div
      className={`farfield-host ${submission ? "submission-mode" : ""} ${launch && friend ? "is-playing" : "is-landing"}`}
      ref={root}
    >
      {launch && friend ? (
        <ConnectedGameHost
          key={identityKey}
          definition={definition}
          frameUrl={`./game.html?v=${__FARFIELD_BUILD__}`}
          selectedFriend={friend}
          account={address ?? null}
          chainId={chainId ?? null}
          publicClient={publicClient}
        />
      ) : !assetsReady ? (
        <div className="asset-loading">
          <span className="launch-star">✦</span>
          <h1>FARFIELD</h1>
          <p role={assetError ? "alert" : "status"}>
            {assetError || "Loading your corner of the universe…"}
          </p>
          {assetError && (
            <button onClick={() => location.reload()}>Retry loading</button>
          )}
        </div>
      ) : (
        <main
          className="game-landing"
          data-reduced={reduced}
          data-commander={picker}
        >
          <TitleScene reduced={reduced} />
          <header className="landing-header">
            <span className="landing-eyebrow">
              RARE FRIENDS · EXPEDITION 04
            </span>
            {connection}
          </header>
          {menu === "leaderboard" && !picker && ranked.config.data?.enabled && <RankedLeaderboard season={ranked.config.data.season} onBack={() => setMenu("online")} />}
          {!picker && menu !== "leaderboard" && (
            <div className="landing-content">
              <div className="title-lockup">
                <span aria-hidden="true">✦</span>
                <h1>FARFIELD</h1>
              </div>
              <p className="title-caption">BUILD. COMMAND. CONQUER.</p>
              {menu === "main" ? (
                <nav className="title-menu" aria-label="Main menu">
                  <button
                    onClick={() => {
                      setMode("online");
                      setCode("");
                      setMenu("online");
                    }}
                  >
                    Online PvP <span>{ranked.config.data?.enabled ? <RankSummary profile={ranked.profile} /> : "01"}</span>
                  </button>
                  <button
                    onClick={() => {
                      setMode("custom");
                      setCode("");
                      setMenu("custom");
                    }}
                  >
                    Friends & AI <span>02</span>
                  </button>
                  <button
                    onClick={() => {
                      setMode("custom");
                      setCode("");
                      setMenu("join");
                    }}
                  >
                    Join friends <span>03</span>
                  </button>
                  <button
                    aria-label="Landing settings"
                    onClick={() => setSettings(true)}
                  >
                    Settings <span>04</span>
                  </button>
                  {connected && (
                    <button
                      onClick={() => {
                        setPlayRequested(false);
                        setPicker(true);
                      }}
                    >
                      Change commander <span>05</span>
                    </button>
                  )}
                  <InstallGameButton number={connected ? "06" : "05"} />
                </nav>
              ) : (
                <section className="landing-setup" aria-label="Match setup">
                  <div className="setup-heading">
                    <button
                      className="menu-back"
                      aria-label="Back to main menu"
                      onClick={() => {
                        setMenu("main");
                        setPlayRequested(false);
                        setAssetError("");
                      }}
                    >
                      ←
                    </button>
                    <h2>
                      {menu === "custom"
                        ? "Friends & AI"
                        : menu === "join"
                          ? "Join friends"
                          : "Online PvP"}
                    </h2>
                  </div>
                  {menu === "custom" && (
                    <>
                      <div className="setup-row">
                        <label>
                          AI commanders
                          <GameSelect
                            label="AI commanders"
                            value={String(botCount)}
                            onChange={(value) => setBotCount(Number(value))}
                            options={[0, 1, 2, 3].map((n) => ({
                              value: String(n),
                              label: n === 0 ? "Friends only" : `${n} AI`,
                            }))}
                          />
                        </label>
                        <label>
                          Difficulty
                          <GameSelect
                            label="AI difficulty"
                            value={difficulty}
                            disabled={!botCount}
                            onChange={(value) =>
                              setDifficulty(value as typeof difficulty)
                            }
                            options={[
                              { value: "easy", label: "Easy" },
                              { value: "normal", label: "Normal" },
                              { value: "hard", label: "Hard" },
                            ]}
                          />
                        </label>
                      </div>
                      <p>4 seats. Invite friends inside.</p>
                    </>
                  )}
                  {menu === "join" && (
                    <label className="join-label">
                      Match code
                      <input
                        autoFocus
                        aria-label="Match code"
                        placeholder="XXXXXXXXXX"
                        maxLength={10}
                        value={code}
                        onChange={(e) =>
                          setCode(
                            e.target.value
                              .toUpperCase()
                              .replace(/[^A-F0-9]/g, ""),
                          )
                        }
                      />
                    </label>
                  )}
                  {menu === "online" && (
                    <div className="online-modes" aria-label="Online modes">
                      <span className="current-online-mode">Free{ranked.config.data?.enabled ? ` · ${ranked.config.data.season}` : ""}</span>
                      <button disabled>Wagered · Coming soon</button>
                    </div>
                  )}
                  {menu === "online" && ranked.config.data?.enabled && <div className="ranked-setup"><RankSummary profile={ranked.profile} /><button onClick={() => setMenu("leaderboard")}>Leaderboard ↗</button></div>}
                  {menu === "online" && ranked.config.isError && <p role="alert">Online service unavailable. <button onClick={() => void ranked.config.refetch()}>Retry</button></p>}
                  {menu === "online" && ranked.config.data?.enabled && !ranked.token() && <p>Verify your commander with a wallet signature.</p>}
                  {menu === "online" && ranked.error && <p role="alert">{ranked.error}</p>}
                  <button
                    className="play-button"
                    disabled={
                      connected &&
                      (playRequested || ranked.busy || (menu === "online" && !ranked.config.data) ||
                        discovery.isFetching ||
                        !friends.length ||
                        (menu === "join" && code.length !== 10))
                    }
                    onClick={async () => {
                      if (!connected) {
                        if (status === "connected") openChainModal?.();
                        else openConnectModal?.();
                        return;
                      }
                      setAssetError("");
                      if (menu === "online" && ranked.config.data?.enabled) {
                        if (!rankedFriendId) return;
                        if (!friend) setSelection({ key: identityKey, id: BigInt(rankedFriendId) });
                        if (!(await ranked.authenticate(rankedFriendId)) || menuRef.current !== "online") return;
                      }
                      setPlayRequested(true);
                    }}
                  >
                    {!connected
                      ? "Connect to play"
                      : discovery.isFetching
                        ? "Loading Friends…"
                        : ranked.busy
                          ? "Check your wallet…"
                        : playRequested
                          ? "Launching…"
                          : menu === "online"
                            ? ranked.config.data?.enabled && !ranked.token() ? "Sign in for ranked →" : "Find free match →"
                            : menu === "join"
                              ? "Join friends →"
                              : "Enter sector →"}
                  </button>
                </section>
              )}
              {menu === "main" && !connected && (
                <p className="connect-hint">Connect your wallet to play.</p>
              )}
              {discovery.isError && (
                <p role="alert">
                  Couldn’t verify your Friends.{" "}
                  <button onClick={() => void discovery.refetch()}>
                    Retry loading Friends
                  </button>
                </p>
              )}
              {connected && discovery.isSuccess && !friends.length && (
                <p role="alert">
                  No eligible Friends found. A hardwired Generations Friend,
                  generation 1 or higher, is required.
                </p>
              )}
              {assetError && <p role="alert">{assetError}</p>}
            </div>
          )}
          {picker && (
            <CommanderScreen
              key={identityKey}
              status={
                !connected
                  ? status === "connecting" || status === "reconnecting"
                    ? "loading"
                    : "disconnected"
                  : discovery.isFetching || discovery.isPending
                    ? "loading"
                    : discovery.isError
                      ? "error"
                      : "ready"
              }
              onRetry={() => void discovery.refetch()}
              onReconnect={() => {
                if (status === "connected") openChainModal?.();
                else openConnectModal?.();
              }}
              reduced={reduced}
              friends={friends}
              reader={spriteReader}
              selectedId={friend?.id}
              onBack={() => {
                setPicker(false);
                setMenu("main");
              }}
              onSelect={(id) => {
                setSelection({ key: identityKey, id });
                setPicker(false);
                setMenu("main");
              }}
            />
          )}
          {settings && (
            <MenuDialog title="Settings" onClose={() => setSettings(false)}>
              <label>
                Sound
                <input
                  type="checkbox"
                  checked={!muted}
                  onChange={(e) => setMuted(!e.target.checked)}
                />
              </label>
              <label>
                Reduce motion
                <input
                  type="checkbox"
                  checked={reduced}
                  onChange={(e) => setReduced(e.target.checked)}
                />
              </label>
            </MenuDialog>
          )}
          <footer className="landing-footer">
            <span>EARLY ACCESS · 0.1</span>
            <span>RARE FRIENDS</span>
          </footer>
        </main>
      )}
    </div>
  );
}

export function WalletApp() {
  return (
    <WagmiProvider config={walletConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          id="farfield"
          theme={walletTheme}
          modalSize="compact"
          initialChain={robinhood}
          showRecentTransactions={false}
          appInfo={{ appName: "Farfield" }}
        >
          <WalletHost />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
