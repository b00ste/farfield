import { readSeat } from "./session";
import { GameSelect } from "../games/farfield/GameSelect";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EscrowPanel, wagerApi, type WagerConfig } from "./escrow-panel";
import type { Hex } from "viem";
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
import { WagmiProvider, useAccount, useWalletClient } from "wagmi";
import { ConnectedGameHost } from "@rarefriends/friendsdk/runtime";

import { readOwnedFriends } from "@rarefriends/friendsdk/owned";
import { createFriendPublicClient } from "@rarefriends/friendsdk/wallet";
import { parseChanceGame } from "@rarefriends/friendsdk/game";
import { createGenerationSpriteReader } from "@rarefriends/friendsdk/sprites";
import { TitleScene } from "./title-scene";
import { MenuDialog } from "./menu-dialog";
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
  rpcUrl: new URL("./api/friend-rpc", location.href).href,
  batch: true,
});
export const spriteReader = createGenerationSpriteReader(publicClient);
// Read by the room relay so a wallet modal suspends that commander's game actions.
export const walletUi = {
  blocked: false,
  account: null as string | null,
  chainId: null as number | null,
  friendId: null as string | null,
  launch: null as LaunchConfig | null,
};
function savedEscrows(address?: string): string[] {
  try {
    const list = JSON.parse(
      localStorage.getItem(`farfield-escrow-history-${address}`) || "[]",
    );
    return Array.isArray(list)
      ? list.filter(
          (id: unknown) =>
            typeof id === "string" && /^0x[0-9a-fA-F]{64}$/.test(id),
        )
      : [];
  } catch {
    return [];
  }
}
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
  const { data: walletClient } = useWalletClient();
  const [wagerConfig, setWagerConfig] = useState<WagerConfig | null>(null),
    [wagerRequested, setWagerRequested] = useState(false);
  const [escrowId, setEscrowId] = useState<Hex | null>(null),
    [recoveryId, setRecoveryId] = useState("");
  useEffect(() => {
    void wagerApi<WagerConfig>("config")
      .then(setWagerConfig)
      .catch(() => {});
  }, []);
  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent).detail;
      if (typeof id === "string" && /^0x[0-9a-fA-F]{64}$/.test(id)) {
        setEscrowId(id as Hex);
        localStorage.setItem(`farfield-escrow-${address}`, id);
        localStorage.setItem(
          `farfield-escrow-history-${address}`,
          JSON.stringify(
            [id, ...savedEscrows(address).filter((x) => x !== id)].slice(0, 50),
          ),
        );
      }
    };
    window.addEventListener("farfield-escrow", open);
    const account = () => openAccountModal?.();
    window.addEventListener("farfield-wallet", account);
    return () => {
      window.removeEventListener("farfield-escrow", open);
      window.removeEventListener("farfield-wallet", account);
    };
  }, [address, openAccountModal]);
  const modalOpen =
    accountModalOpen || chainModalOpen || connectModalOpen || !!escrowId;
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
  const [menu, setMenu] = useState<"main" | "custom" | "online" | "join">(
    "main",
  );
  const [recovery, setRecovery] = useState(false);
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
    localStorage.setItem(
      "farfield-preferences",
      JSON.stringify({ ...readPreferences(), muted, reduced }),
    );
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
      .then(async () => {
        let auth: string | undefined;
        if (wagerRequested) {
          if (!walletClient || !wagerConfig?.enabled)
            throw new Error("RF matches are not available yet.");
          const challenge = await wagerApi<{ nonce: string; message: string }>(
            "challenge",
            { address, friendId: String(friend.id) },
          );
          const signature = await walletClient.signMessage({
            message: challenge.message,
          });
          auth = (
            await wagerApi<{ auth: string }>("auth", {
              nonce: challenge.nonce,
              signature,
            })
          ).auth;
        }
        if (live) {
          setLaunch({
            wager: wagerRequested,
            auth,
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
    wagerRequested,
    walletClient,
    address,
    wagerConfig,
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
    setEscrowId(null);
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
      {escrowId && (
        <EscrowPanel
          key={`${escrowId}:${identityKey}`}
          id={escrowId}
          onClose={() => setEscrowId(null)}
        />
      )}
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
          {!picker && (
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
                      setMode("custom");
                      setCode("");
                      setMenu("custom");
                    }}
                  >
                    Friends & AI <span>01</span>
                  </button>
                  <button
                    onClick={() => {
                      setMode("online");
                      setCode("");
                      setMenu("online");
                    }}
                  >
                    Online PvP <span>02</span>
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
                    <>
                      <div className="wager-terms">
                        <span>
                          ENTRY<strong>1 RF</strong>
                        </span>
                        <span>
                          WINNER TAKES<strong>2 RF</strong>
                        </span>
                      </div>
                      <button
                        className="wager-disabled"
                        disabled={
                          !wagerConfig?.enabled ||
                          !connected ||
                          playRequested ||
                          discovery.isFetching ||
                          !friends.length
                        }
                        onClick={() => {
                          setWagerRequested(true);
                          setAssetError("");
                          setPlayRequested(true);
                        }}
                      >
                        {wagerConfig?.enabled
                          ? "Find 1 RF match →"
                          : "1 RF matches · coming soon"}
                      </button>
                    </>
                  )}
                  <button
                    className="play-button"
                    disabled={
                      connected &&
                      (playRequested ||
                        discovery.isFetching ||
                        !friends.length ||
                        (menu === "join" && code.length !== 10))
                    }
                    onClick={() => {
                      if (!connected) {
                        if (status === "connected") openChainModal?.();
                        else openConnectModal?.();
                        return;
                      }
                      setAssetError("");
                      setWagerRequested(false);
                      setPlayRequested(true);
                    }}
                  >
                    {!connected
                      ? "Connect to play"
                      : discovery.isFetching
                        ? "Loading Friends…"
                        : playRequested
                          ? "Launching…"
                          : menu === "online"
                            ? "Find practice match →"
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
            <MenuDialog
              title={recovery ? "RF recovery" : "Settings"}
              onClose={() => {
                setSettings(false);
                setRecovery(false);
              }}
            >
              {!recovery ? (
                <>
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
                  <button
                    className="settings-link"
                    onClick={() => setRecovery(true)}
                  >
                    RF matches & refunds <span>→</span>
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setRecovery(false)}>← Settings</button>
                  {savedEscrows(address).length > 0 && (
                    <label className="escrow-recovery">
                      Recent RF matches
                      <GameSelect
                        label="Recent escrow matches"
                        value={recoveryId}
                        onChange={setRecoveryId}
                        options={[
                          { value: "", label: "Select a match" },
                          ...savedEscrows(address).map((id) => ({
                            value: id,
                            label: `${id.slice(0, 10)}…${id.slice(-6)}`,
                          })),
                        ]}
                      />
                    </label>
                  )}
                  <label className="escrow-recovery">
                    Recover RF match
                    <input
                      aria-label="Escrow match ID"
                      placeholder="0x… match ID"
                      value={recoveryId}
                      onChange={(e) => setRecoveryId(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={
                      !/^0x[0-9a-fA-F]{64}$/.test(recoveryId) &&
                      !localStorage.getItem(`farfield-escrow-${address}`)
                    }
                    onClick={() =>
                      setEscrowId(
                        (recoveryId ||
                          localStorage.getItem(
                            `farfield-escrow-${address}`,
                          )) as Hex,
                      )
                    }
                  >
                    Open escrow / refunds
                  </button>
                </>
              )}
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
