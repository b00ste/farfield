import {
  commandPoint,
  friendOrder,
  type OrderMarker,
} from "./order-feedback.ts";
import { ABILITIES, type Ability } from "./combat.ts";
import { GameSelect } from "./GameSelect.tsx";
import { matchResult } from "./results.ts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import {
  createFriendSoundKit,
  type FriendSoundKit,
} from "@rarefriends/friendsdk/sounds";
import {
  createState,
  nextObjective,
  MODULES,
  rotated,
  placementError,
  type BuildType,
  type Command,
  type Point,
} from "./engine.ts";
import {
  request,
  send,
  subscribe,
  type RoomView,
  type Session,
} from "./network.ts";
import { StationMap } from "./Map.tsx";
import { Crew } from "./Crew.tsx";
import { JOBS, TASK_LABELS, ROLE_NAMES, housing, workPower } from "./actors.ts";
import type { Ghost, Sprite, CharacterAnimation } from "./render.ts";
import type { LaunchConfig } from "./launch.ts";
import "./style.css";
import "./playfield.css";
const TYPES: BuildType[] = [
  "passage",
  "solar",
  "garden",
  "foundry",
  "habitat",
  "turret",
  "lab",
  "infirmary",
];
function ActionIcon({
  kind,
}: {
  kind:
    | "build"
    | "workers"
    | "rotate"
    | "place"
    | "remove"
    | "work"
    | "repair"
    | "recruit"
    | "close";
}) {
  const paths = {
    build: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 16h7m-3.5-3.5v7",
    workers:
      "M9 8a3 3 0 1 0 6 0 3 3 0 1 0-6 0M6 21v-4a6 6 0 0 1 12 0v4M3 10a2 2 0 1 0 0 4m18-4a2 2 0 1 1 0 4M2 21v-3m20 3v-3",
    rotate: "M19 9a8 8 0 1 0 1 7M19 3v6h-6",
    place: "m4 12 5 5L20 6",
    remove: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
    work: "M5 6a3 3 0 1 0 6 0 3 3 0 1 0-6 0M3 21v-6a5 5 0 0 1 9-3M15 4l6 6m-4-4-5 5m0 6 6-6m-3 9 6-6",
    repair:
      "M15 4a5 5 0 0 0-6 6L3 16a3 3 0 0 0 5 4l6-6a5 5 0 0 0 6-6l-4 3-3-3 3-4Z",
    recruit:
      "M5 7a3 3 0 1 0 6 0 3 3 0 1 0-6 0M3 21v-5a5 5 0 0 1 10 0v5M15 10h7m-3.5-3.5v7",
    close: "m6 6 12 12M6 18 18 6",
  };
  return (
    <svg
      className="action-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
const clock = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
function Piece({
  shape,
  rotation = 0,
  color = "#bccbd0",
}: {
  shape: number;
  rotation?: number;
  color?: string;
}) {
  return (
    <svg viewBox="0 0 44 36" aria-hidden="true">
      {rotated(shape, rotation).map((p, i) => (
        <rect
          key={i}
          x={p.x * 10 + 2}
          y={p.y * 10 + 2}
          width="8"
          height="8"
          rx="1"
          fill={color}
        />
      ))}
    </svg>
  );
}
function StationThumbnail({
  state,
  name,
}: {
  state: ReturnType<typeof createState>;
  name: string;
}) {
  const cells = state.modules.flatMap((m) => m.cells);
  const minX = Math.min(...cells.map((p) => p.x)),
    maxX = Math.max(...cells.map((p) => p.x));
  const minY = Math.min(...cells.map((p) => p.y)),
    maxY = Math.max(...cells.map((p) => p.y));
  const size = Math.max(8, maxX - minX + 5, maxY - minY + 5);
  return (
    <svg
      className="station-thumbnail"
      viewBox={`${(minX + maxX + 1 - size) / 2} ${(minY + maxY + 1 - size) / 2} ${size} ${size}`}
      aria-label={`${name} station layout`}
    >
      {state.modules.flatMap((module) =>
        module.cells.map((cell) => (
          <rect
            key={`${module.id}:${cell.x},${cell.y}`}
            x={cell.x}
            y={cell.y}
            width="0.9"
            height="0.9"
            fill={MODULES[module.type].color}
            opacity={module.progress < 1 ? 0.4 : 1}
          />
        )),
      )}
    </svg>
  );
}
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-title">
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="Close dialog">
          ×
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export default function Game(props: GameComponentProps) {
  return <Mission key={props.friendId.toString()} {...props} />;
}
function Mission({ friendId, client, paused }: GameComponentProps) {
  const [ready, setReady] = useState(false),
    [loadError, setLoadError] = useState(""),
    [retry, setRetry] = useState(0),
    [sprite, setSprite] = useState<Sprite | null>(null),
    [animation, setAnimation] = useState<CharacterAnimation | null>(null),
    [artError, setArtError] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null),
    [session, setSession] = useState<Session | null>(null);
  const [shape, setShape] = useState(1);
  const [choosingBuilding, setChoosingBuilding] = useState(false);
  const focusLevel = () =>
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLCanvasElement>(".map-wrap canvas")
        ?.focus({ preventScroll: true }),
    );
  const queued = useRef<Command[]>([]);
  const commandRef = useRef<((c: Command) => Promise<void>) | null>(null);
  const orderEpoch = useRef(0);
  const clearPendingOrders = () => {
    queued.current = [];
    orderEpoch.current++;
    setOrderMarker(null);
  };
  const [orderMarker, setOrderMarker] = useState<OrderMarker | null>(null);
  const [inspectedId, setInspectedId] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<"build" | "crew" | null>(null);
  const [dock, setDock] = useState<"bottom" | "left" | "right">("bottom");
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const resultScreen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (room?.state.phase === "won" || room?.state.phase === "lost")
      resultScreen.current?.focus();
  }, [room?.state.phase]);
  const booted = useRef(false);
  const [watchingId, setWatchingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [offline, setOffline] = useState(false),
    [selected, setSelected] = useState<BuildType | null>(null),
    [ghost, setGhost] = useState<Ghost>(null),
    [rotation, setRotation] = useState(0);
  const [panel, setPanel] = useState<
      "help" | "crew" | "signals" | "settings" | "match" | null
    >(null),
    [muted, setMuted] = useState(true),
    [reduced, setReduced] = useState(false);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest("input,textarea,select,[role=dialog],dialog")))
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        clearPendingOrders();
        setSelected(null);
        setGhost(null);
        setInspectedId(null);
        setChoosingBuilding(false);
        focusLevel();
        setDrawer(null);
        return;
      }
      if (panel || room?.state.phase !== "playing") return;
      if (drawer === "build" && event.key === "Backspace") {
        event.preventDefault();
        if (choosingBuilding) setChoosingBuilding(false);
        else setDrawer(null);
        focusLevel();
        return;
      }
      if (drawer === "build") {
        const digit = /^[1-8]$/.test(event.key) ? Number(event.key) - 1 : -1;
        const block =
          digit >= 0
            ? digit
            : ["i", "o", "t", "l", "j", "s", "z"].indexOf(
                event.key.toLowerCase(),
              );
        const choice = choosingBuilding ? digit : block;
        const selector = choosingBuilding
          ? `[data-building-index="${choice}"]`
          : `[data-shape-index="${choice}"]`;
        if (choice >= 0) {
          const button = document.querySelector<HTMLButtonElement>(selector);
          if (button) {
            event.preventDefault();
            button.click();
          }
          return;
        }
      }
      const ability =
        event.key.toLowerCase() === "q"
          ? "shield"
          : event.key.toLowerCase() === "e"
            ? "emp"
            : null;
      if (ability) {
        event.preventDefault();
        document
          .querySelector<HTMLButtonElement>(`[data-ability="${ability}"]`)
          ?.click();
        return;
      }
      const next =
        event.key.toLowerCase() === "b"
          ? "build"
          : event.key.toLowerCase() === "w"
            ? "crew"
            : null;
      if (next) {
        event.preventDefault();
        setSelected(null);
        setGhost(null);
        setInspectedId(null);
        setChoosingBuilding(false);
        setDrawer((current) => (current === next ? null : next));
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [panel, room?.state.phase, drawer, choosingBuilding]);
  const [focusPoint, setFocusPoint] = useState<
    (Point & { follow?: boolean }) | null
  >(null);
  const [empty] = useState(createState),
    sound = useRef<FriendSoundKit | null>(null),
    locked = useRef(false),
    alive = useRef(true),
    active = useRef(true),
    blocked = useRef(false);
  const watching = room?.opponents.find(
    (p) => p.id === watchingId && p.discovered && p.state,
  );
  const state = room?.state || empty,
    halted = paused || !!panel || offline;
  useEffect(() => {
    if (halted || state.paused || state.phase !== "playing")
      clearPendingOrders();
  }, [halted, state.paused, state.phase]);
  blocked.current = paused || !!panel;
  active.current = !blocked.current && !document.hidden;
  useEffect(() => {
    alive.current = true;
    const pref = matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(pref.matches);
    const change = () => setReduced(pref.matches);
    pref.addEventListener("change", change);
    sound.current = createFriendSoundKit({ muted: true });
    return () => {
      alive.current = false;
      queued.current = [];
      orderEpoch.current++;
      pref.removeEventListener("change", change);
      sound.current?.dispose();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setLoadError("");
    client
      .read()
      .then((s) => {
        if (!cancelled) {
          if (s.friendId !== friendId)
            setLoadError(
              "Friend session mismatch. Reconnect through the wallet menu.",
            );
          else setReady(true);
        }
      })
      .catch((e) => {
        if (!cancelled)
          setLoadError(e.message || "Could not load your Friend.");
      });
    return () => {
      cancelled = true;
    };
  }, [client, friendId, retry]);
  useEffect(() => {
    let cancelled = false;
    setArtError(false);
    request<{ rows: readonly string[]; animation: CharacterAnimation }>("art", {
      friendId: String(friendId),
    })
      .then((s) => {
        if (!cancelled) {
          setSprite(s.rows);
          setAnimation(s.animation);
        }
      })
      .catch(() => {
        if (!cancelled) setArtError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [friendId, retry]);
  const roomStream = useRef<ReturnType<typeof subscribe> | null>(null);
  useEffect(() => {
    roomStream.current?.presence(active.current);
  }, [paused, panel]);
  useEffect(() => {
    if (!session) return;
    let stopped = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      if (stopped) return;
      roomStream.current?.close();
      roomStream.current = subscribe(
        session,
        active.current,
        (view) => {
          if (stopped) return;
          attempts = 0;
          setRoom((previous) =>
            !previous ||
            previous.code !== view.code ||
            view.revision >= previous.revision
              ? view
              : previous,
          );
          setOffline(false);
        },
        (error) => {
          if (stopped) return;
          setOffline(true);
          if (error.message.includes("session expired")) {
            setError(
              "This match expired. Return to the main menu to start again.",
            );
            setSession(null);
            return;
          }
          // Reconnect without flooding a struggling proxy; never replay old commands.
          timer = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 10000));
        },
      );
    };
    connect();
    const hidden = () => {
      active.current = !document.hidden && !blocked.current;
      roomStream.current?.presence(active.current);
    };
    const disconnected = () => {
      clearTimeout(timer);
      roomStream.current?.close();
      setOffline(true);
    };
    const reconnected = () => {
      clearTimeout(timer);
      attempts = 0;
      connect();
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) reconnected();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("offline", disconnected);
    window.addEventListener("online", reconnected);
    window.addEventListener("pageshow", restored);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("offline", disconnected);
      window.removeEventListener("online", reconnected);
      window.removeEventListener("pageshow", restored);
      roomStream.current?.close();
      roomStream.current = null;
    };
  }, [session]);
  useEffect(() => {
    if (!ready || !sprite || booted.current) return;
    booted.current = true;
    let live = true;
    const boot = async () => {
      try {
        const config = await request<LaunchConfig>("setup", {});
        if (!config)
          throw new Error("Return to the landing screen to choose a match.");
        setDock(config.dock ?? "bottom");
        setMuted(config.muted);
        setReduced(config.reduced);
        sound.current?.setMuted(config.muted);
        const result = config.resume
          ? {
              ...(await request<RoomView>(
                "sync",
                { code: config.resume.code, active: true },
                config.resume.token,
              )),
              token: config.resume.token,
            }
          : await request<RoomView & { token: string }>(
              config.code
                ? "join"
                : config.mode === "online"
                  ? "matchmake"
                  : "create",
              {
                friendId: String(friendId),
                wager: config.wager,
                auth: config.auth,
                code: config.code,
                mode: config.mode,
                bots: config.bots,
                difficulty: config.bots[0] ?? "normal",
              },
            );
        if (live) {
          setRoom(result);
          setSession({ code: result.code, token: result.token });
        } else if (!config.resume)
          void request("leave", { code: result.code }, result.token).catch(
            () => {},
          );
      } catch (e) {
        if (live)
          setError(e instanceof Error ? e.message : "Could not enter sector.");
      }
    };
    void boot();
    return () => {
      live = false;
    };
  }, [ready, sprite, friendId]);
  const returnHome = async () => {
    if (session) {
      try {
        await request("leave", { code: session.code }, session.token);
      } catch (error) {
        if (
          !(error instanceof Error && error.message.includes("session expired"))
        ) {
          setError("Could not leave the match. Retry when connected.");
          return;
        }
      }
    }
    await request("home", {});
  };
  const command = async (c: Command) => {
    if (!session || halted || (state.paused && c.type !== "pause")) return;
    if (locked.current) {
      const friendOrders = [
        "direct",
        "attack",
        "capture",
        "gather",
        "stop-friend",
      ];
      if (friendOrders.includes(c.type))
        queued.current = queued.current.filter(
          (order) => !friendOrders.includes(order.type),
        );
      queued.current.push(c);
      return;
    }
    locked.current = true;
    const epoch = orderEpoch.current;
    const point = commandPoint(state, c);
    if (point)
      setOrderMarker({
        point,
        status: "pending",
        until: performance.now() + 10000,
      });
    setBusy(true);
    setError("");
    try {
      const view = await send(session, c);
      if (alive.current) {
        if (point && epoch === orderEpoch.current)
          setOrderMarker({
            point,
            status: "accepted",
            until: performance.now() + 1800,
          });
        setRoom((previous) =>
          !previous ||
          previous.code !== view.code ||
          view.revision >= previous.revision
            ? view
            : previous,
        );
        if (c.type === "build" && epoch === orderEpoch.current) {
          setGhost(null);
          setSelected(null);
          setInspectedId(view.state.modules.at(-1)?.id ?? null);
          sound.current?.play("purchase");
        }
      }
    } catch (e) {
      if (alive.current && epoch === orderEpoch.current) {
        if (point)
          setOrderMarker({
            point,
            status: "rejected",
            until: performance.now() + 2500,
          });
        setError(e instanceof Error ? e.message : "Command failed.");
      }
    } finally {
      locked.current = false;
      if (alive.current) {
        setBusy(false);
        const next = queued.current.shift();
        if (next) void commandRef.current?.(next);
      }
    }
  };
  commandRef.current = command;
  // Settings actions can submit while a personal modal blocks map input; worker drawers stay live.
  const crewCommand = async (c: Command) => {
    if (!session || locked.current || paused || offline) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const view = await send(session, c);
      if (alive.current)
        setRoom((previous) =>
          !previous ||
          previous.code !== view.code ||
          view.revision >= previous.revision
            ? view
            : previous,
        );
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Assignment failed.");
    } finally {
      locked.current = false;
      if (alive.current) {
        setBusy(false);
        const next = queued.current.shift();
        if (next) void commandRef.current?.(next);
      }
    }
  };
  const select = (type: BuildType) => {
    if (halted) return;
    setWatchingId(null);
    setSelected(type);
    setGhost(null);
    setError("");
  };
  const rotate = () => {
    if (halted) return;
    setRotation((r) => (r + 1) % 4);
    setGhost((g) => (g ? { ...g, rotation: (g.rotation + 1) % 4 } : null));
  };
  const build = (blueprint: Ghost = ghost) => {
    if (!blueprint) return;
    const invalid = placementError(
      state,
      blueprint.type,
      blueprint.shape,
      blueprint.rotation,
      blueprint.x,
      blueprint.y,
    );
    if (invalid) {
      setError(invalid);
      return;
    }
    void command({
      type: "build",
      room: blueprint.type,
      x: blueprint.x,
      y: blueprint.y,
      rotation: blueprint.rotation,
      shape: blueprint.shape,
    });
  };
  const canBuild = ghost
    ? placementError(
        state,
        ghost.type,
        ghost.shape,
        ghost.rotation,
        ghost.x,
        ghost.y,
      )
    : null;
  const inspected = state.modules.find((m) => m.id === inspectedId);
  const inspectedRole = inspected ? JOBS[inspected.type] : undefined;
  const inspect = (id: number) => {
    const module = state.modules.find((m) => m.id === id);
    if (!module) return;
    setWatchingId(null);
    setSelected(null);
    setGhost(null);
    setInspectedId(id);
    void command({ type: "direct", ...module.cells[0] });
  };
  const objective = nextObjective(state);
  const linked = state.monoliths.filter(
    (m) => m.ownerId === room?.selfId,
  ).length;
  const help = (
    <div className="help-content">
      <p>
        Build your station. Capture the four shared monoliths or destroy every
        enemy core.
      </p>
      <ul>
        <li>
          <strong>Build:</strong> B, choose a block, then a building. Click once
          to place. R rotates; Escape clears placement. Unfinished blueprints
          refund 100%; dismantling completed buildings returns 75% and removes
          flooring. Units walk clear first; keep a connected path to your core.
        </li>
        <li>
          <strong>Explore:</strong> Your Friend only walks on completed tiles.
          Connect passages to monolith platforms or discovered enemy flooring.
          Enemy bases are hidden until explored.
        </li>
        <li>
          <strong>Fight:</strong> Click a visible enemy or building to attack.
          Assign guards with W, then choose Follow Friend or Hold here. Staffed
          Defense buildings protect nearby approaches. Red rings show enemy
          turret range. Shield (Q): 20 energy, 65% damage reduction for 6s. EMP
          (E): 15 energy, disables visible turrets within 6 tiles for 6s.
        </li>
        <li>
          <strong>Recover:</strong> Retreat to your core, or an Infirmary with a
          medic. Healing starts after four seconds without taking damage. A
          downed Friend returns after 15 seconds; a destroyed core eliminates
          its commander.
        </li>
        <li>
          <strong>Capture:</strong> Click a monolith to approach. Your Friend
          must stay within range for 10 seconds. Staffed Research speeds
          decoding up to twice as fast. Enemy Friends or guards contest it. Hold
          all four uncontested for 60 seconds to win.
        </li>
      </ul>
    </div>
  );

  return (
    <section
      className={`game immersive-game ${selected || inspected ? "has-context" : ""}`}
      data-ended={state.phase === "won" || state.phase === "lost"}
      data-dock={dock}
      data-reduced={reduced}
      aria-label="Farfield station command"
    >
      <div className="flight-hud">
        <div className="flight-resources">
          <button
            title="Alloy builds rooms and workers, and repairs your core"
            onClick={() => setPanel("help")}
          >
            <span className="alloy">⬡</span>
            <strong data-testid="alloy">{Math.floor(state.alloy)}</strong>
            <small>ALLOY</small>
          </button>
          <button
            title="Energy powers Shield (Q) and EMP (E)"
            onClick={() => setPanel("help")}
          >
            <span className="energy">ϟ</span>
            <strong>{Math.floor(state.energy)}</strong>
            <small>ENERGY</small>
          </button>
          <button
            title="Food feeds and recruits workers"
            onClick={() => setPanel("help")}
          >
            <span className="food">♧</span>
            <strong>{Math.floor(state.food)}</strong>
            <small>FOOD</small>
          </button>
          <button
            title="Recruit workers"
            onClick={() => {
              setDrawer(drawer === "crew" ? null : "crew");
              focusLevel();
            }}
          >
            <span>♙</span>
            <strong>
              {state.crew}
              <i>/{housing(state)}</i>
            </strong>
            <small>WORKERS</small>
          </button>
        </div>
        <button
          className="menu-trigger"
          aria-label="Game menu"
          disabled={!room}
          onClick={() => setPanel("settings")}
        >
          ☰ <span>Menu</span>
        </button>
      </div>
      {state.phase === "playing" && (
        <div className="shared-objectives" aria-label="Shared monoliths">
          {state.monoliths.map((m, i) => (
            <button
              key={m.name}
              aria-label={`View ${m.name}`}
              title={`${m.name}: ${m.contested ? "Contested" : (m.ownerName ?? "Unclaimed")}`}
              data-owned={m.ownerId === room?.selfId}
              data-contested={m.contested}
              onClick={() => setFocusPoint({ ...m })}
            >
              ◇ {i + 1}
              <small>
                {m.contested
                  ? "CONTESTED"
                  : m.claimant
                    ? `${Math.floor(m.progress)}%`
                    : m.ownerId === room?.selfId
                      ? "YOURS"
                      : m.ownerId
                        ? "ENEMY"
                        : "FREE"}
              </small>
            </button>
          ))}
          {state.hold?.ownerId && (
            <strong role="status">
              {state.hold.name} · victory in{" "}
              {Math.ceil(60 - state.hold.seconds)}s
            </strong>
          )}
        </div>
      )}
      <div className="world-stage">
        <StationMap
          orderMarker={orderMarker}
          focusPoint={focusPoint}
          state={watching?.state ?? state}
          contacts={[]}
          ghost={watching ? null : ghost}
          sprite={watching ? null : sprite}
          animation={watching ? null : animation}
          inspectedId={watching ? null : inspectedId}
          reduced={reduced}
          placing={!!selected && !watching}
          disabled={
            halted || state.phase !== "playing" || state.paused || !!watching
          }
          onPreview={(p) => {
            if (selected) setGhost({ type: selected, shape, rotation, ...p });
          }}
          onPick={(p) => {
            if (selected) {
              const blueprint = { type: selected, shape, rotation, ...p };
              setGhost(blueprint);
              build(blueprint);
            } else {
              const objectiveIndex = state.monoliths.findIndex(
                (m) => Math.hypot(m.x - p.x, m.y - p.y) <= 1.5,
              );
              if (objectiveIndex >= 0) {
                setInspectedId(null);
                void command({ type: "capture", index: objectiveIndex });
                return;
              }
              const unit = state.visibleUnits?.find(
                (u) => Math.hypot(u.x - p.x, u.y - p.y) < 0.9,
              );
              if (unit) {
                void command({
                  type: "attack",
                  target: unit.playerId,
                  ...(!unit.hero
                    ? { unitId: Number(unit.id.split(":")[1]) }
                    : {}),
                });
                return;
              }
              const enemy = state.terrain?.find(
                (m) =>
                  m.owner !== "neutral" &&
                  m.cells.some((t) => t.x === p.x && t.y === p.y),
              );
              if (enemy && !enemy.wreck && enemy.type !== "passage") {
                void command({
                  type: "attack",
                  target: enemy.owner,
                  moduleId: enemy.id,
                });
                return;
              }
              const node = state.deposits.find(
                (n) => n.amount > 0 && n.x === p.x && n.y === p.y,
              );
              if (node) {
                setInspectedId(null);
                void command({ type: "gather", nodeId: node.id });
                return;
              }
              const module = state.modules.find((m) =>
                m.cells.some((c) => c.x === p.x && c.y === p.y),
              );
              if (module) {
                setInspectedId(module.id);
                void command({ type: "direct", ...p });
              } else {
                setInspectedId(null);
                void command({ type: "direct", ...p, task: "move" });
              }
            }
          }}
          onMove={(dx, dy) => {
            const point = {
              x: Math.round(state.friend.x) + dx,
              y: Math.round(state.friend.y) + dy,
            };
            void command({ type: "direct", ...point, task: "move" });
          }}
          onRotate={rotate}
          onPlace={build}
        />
      </div>
      {room && state.phase === "playing" && (
        <div className="sector-status">
          <span className={state.integrity < 30 ? "danger" : ""}>
            HULL {Math.ceil(state.integrity)}%
          </span>
          <span>
            {state.friend.hp <= 0
              ? `FRIEND RETURNS ${Math.ceil(state.friend.respawnAt - state.time)}s`
              : `FRIEND ${Math.ceil(state.friend.hp)}/${state.friend.maxHp}`}
          </span>
          <span>{clock(state.time)}</span>
        </div>
      )}
      {state.phase === "playing" && (
        <div
          className="combat-readout"
          role="status"
          data-testid="friend-order"
        >
          {state.friend.hp <= 0
            ? "Friend down — respawning at your core"
            : state.time - state.friend.lastHit < 1.5
              ? "UNDER FIRE · Shield or retreat to heal"
              : (state.abilities?.shieldUntil ?? 0) > state.time
                ? `Shield active · ${friendOrder(state)}`
                : friendOrder(state)}
        </div>
      )}
      <span className="sr-only" data-testid="friend-task">
        {TASK_LABELS[state.friend.task]}
      </span>
      {watching && (
        <div className="watching-banner">
          Observing {watching.name}
          <button
            onClick={() => {
              setWatchingId(null);
              setFocusPoint({ x: 0, y: 0 });
            }}
          >
            Return to your station
          </button>
        </div>
      )}
      {room && state.phase === "ready" && (
        <div className="launch-ribbon">
          <div>
            <strong>
              {room.mode === "online"
                ? room.economy.wager && room.players.length === 2
                  ? `Escrow · ${room.economy.wager.status}`
                  : "Searching for an opponent…"
                : "Your sector is ready"}
            </strong>
            <span>
              {room.mode === "online"
                ? room.economy.wager
                  ? "1 RF each · 2 RF winner pool · both deposits required"
                  : "Practice · no deposit or payout"
                : `${room.players.length} / ${room.maxPlayers} commanders · invite friends or add AI`}
            </span>
          </div>
          {room.mode === "online" ? (
            room.economy.wager && room.players.length === 2 ? (
              <button
                disabled={
                  !["funding", "active"].includes(room.economy.wager.status)
                }
                onClick={() =>
                  void request("escrow", { id: room.economy.wager!.id })
                }
              >
                Review & deposit 1 RF
              </button>
            ) : (
              <button onClick={() => void returnHome()}>Cancel search</button>
            )
          ) : (
            <>
              <button onClick={() => setPanel("match")}>Invite & AI</button>
              {room.isHost ? (
                <button
                  className="primary"
                  disabled={room.players.length < 2 || busy}
                  onClick={() => void command({ type: "start" })}
                >
                  Begin match →
                </button>
              ) : (
                <span>Waiting for host</span>
              )}
            </>
          )}
        </div>
      )}
      {!room && (
        <div className="launch-ribbon">
          <span role="status">{error || "Preparing your sector…"}</span>
          {error && (
            <button onClick={() => void returnHome()}>Main menu</button>
          )}
        </div>
      )}
      {state.paused && <div className="pause-badge">MATCH PAUSED</div>}
      {offline && (
        <div className="offline" role="alert">
          {session
            ? "Reconnecting… Commands are paused."
            : "Match no longer available."}
          {!session && (
            <button onClick={() => void returnHome()}>Main menu</button>
          )}
        </div>
      )}
      {error && room && (
        <div className="command-toast" role="alert">
          {error}
          <button aria-label="Dismiss message" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {room &&
        state.phase === "playing" &&
        !selected &&
        !inspected &&
        !drawer && (
          <button className="objective-hint" onClick={() => setPanel("help")}>
            <span>◇</span> {objective.title.replace(/^\d \/ 7 · /, "")}{" "}
            <small>?</small>
          </button>
        )}
      {drawer === "build" && (
        <div className="command-drawer build-palette">
          <div className="drawer-heading">
            <strong>
              {choosingBuilding
                ? "2 · Choose a building"
                : "1 · Choose a block"}
            </strong>
            {choosingBuilding && (
              <button
                onClick={() => setChoosingBuilding(false)}
                aria-keyshortcuts="Backspace"
                title="Choose a different block (Backspace)"
              >
                ← Block
              </button>
            )}

            <button
              aria-label="Close build panel"
              onClick={() => setDrawer(null)}
            >
              ×
            </button>
          </div>
          {!choosingBuilding && (
            <div
              className="shape-picker"
              role="group"
              aria-label="Choose tile shape"
            >
              {["I", "O", "T", "L", "J", "S", "Z"].map((name, index) => (
                <button
                  key={name}
                  aria-label={`${name} shape`}
                  aria-keyshortcuts={`${index + 1} ${name}`}
                  data-shape-index={index}
                  aria-pressed={shape === index}
                  onClick={() => {
                    setShape(index);
                    setChoosingBuilding(true);
                    setRotation(0);
                    setGhost(null);
                  }}
                >
                  <Piece shape={index} />
                  <small>
                    {name} <kbd>{index + 1}</kbd>
                  </small>
                </button>
              ))}
            </div>
          )}
          {choosingBuilding && (
            <nav aria-label="Station modules">
              {TYPES.map((type, index) => (
                <button
                  key={type}
                  aria-label={`Build ${MODULES[type].name}`}
                  aria-keyshortcuts={`${index + 1}`}
                  data-building-index={index}
                  aria-pressed={selected === type}
                  data-recommended={objective.module === type}
                  disabled={halted || state.phase !== "playing" || state.paused}
                  onClick={() => {
                    select(type);
                    setDrawer(null);
                    focusLevel();
                  }}
                >
                  <span style={{ color: MODULES[type].color }}>
                    {MODULES[type].glyph}
                  </span>
                  <strong>
                    {MODULES[type].name} <kbd>{index + 1}</kbd>
                  </strong>
                  <small>{MODULES[type].alloy} alloy</small>
                  <small>
                    {
                      {
                        passage: "Connect paths",
                        solar: "Energy for abilities",
                        garden: "Grow food",
                        foundry: "Produce alloy",
                        habitat: "Add worker beds",
                        turret: "Defend the station",
                        lab: "Decode faster",
                        infirmary: "Heal allies",
                      }[type]
                    }
                  </small>
                </button>
              ))}
            </nav>
          )}
        </div>
      )}

      {drawer === "crew" && (
        <div
          className="command-drawer worker-palette"
          role="region"
          aria-label="Workers"
        >
          <div className="drawer-heading">
            <strong>
              Workers · {state.crew}/{housing(state)}
            </strong>
            <button
              aria-label="Close workers panel"
              onClick={() => setDrawer(null)}
            >
              ×
            </button>
          </div>
          <Crew
            state={state}
            busy={busy || halted || state.paused || state.phase !== "playing"}
            onCommand={(c) => void crewCommand(c)}
          />
        </div>
      )}
      {state.phase === "playing" && (
        <div className="ability-bar" aria-label="Friend abilities">
          {(Object.keys(ABILITIES) as Ability[]).map((ability) => {
            const def = ABILITIES[ability],
              timers = state.abilities;
            const ready =
              ability === "shield" ? timers?.shieldReady : timers?.empReady;
            const cooldown = Math.max(0, Math.ceil((ready ?? 0) - state.time));
            const active =
              ability === "shield" && (timers?.shieldUntil ?? 0) > state.time;
            return (
              <button
                key={ability}
                data-ability={ability}
                aria-label={`${def.name} ability`}
                title={def.description}
                data-active={active}
                disabled={
                  halted ||
                  state.paused ||
                  state.friend.hp <= 0 ||
                  cooldown > 0 ||
                  state.energy < def.cost
                }
                onClick={() => void command({ type: "ability", ability })}
              >
                <strong>
                  {def.name} <kbd>{def.key}</kbd>
                </strong>
                <small>
                  {active
                    ? "ACTIVE"
                    : cooldown
                      ? `${cooldown}s`
                      : `${def.cost} ϟ`}
                </small>
              </button>
            );
          })}
          {(["friend", "workers"] as const).map((group) => {
            const aggressive =
              (state.combatModes?.[group] ??
                (group === "friend" ? "aggressive" : "peaceful")) ===
              "aggressive";
            const name = group === "friend" ? "Friend" : "Free workers";
            return (
              <button
                key={group}
                className="combat-mode-toggle"
                data-combat-group={group}
                aria-label={`${name}: ${aggressive ? "aggressive" : "peaceful"}`}
                aria-pressed={aggressive}
                title={`${name}: ${aggressive ? "Aggressive — click to resume work" : "Peaceful — click to fight"}`}
                disabled={busy || halted || state.paused}
                onClick={() => {
                  void crewCommand({
                    type: "combat-mode",
                    group,
                    mode: aggressive ? "peaceful" : "aggressive",
                  });
                  focusLevel();
                }}
              >
                <svg
                  viewBox="0 0 32 32"
                  aria-hidden="true"
                  className="mode-unit-icon"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="16" cy="9" r="4" />
                  <path d="M10 26v-7a6 6 0 0 1 12 0v7M13 26v-7m6 7v-7" />
                  {group === "workers" && (
                    <>
                      <circle cx="5" cy="13" r="3" />
                      <circle cx="27" cy="13" r="3" />
                      <path d="M1 26v-5a4 4 0 0 1 7-3m23 8v-5a4 4 0 0 0-7-3" />
                    </>
                  )}
                </svg>
                <svg
                  className="mode-state-icon"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  {aggressive ? (
                    <path d="m3 2 13 13m1-13L4 15M2 12l6 6m4 0 6-6M2 2l4 1-3 3m15-4-4 1 3 3" />
                  ) : (
                    <>
                      <path d="M4 15C-1 5 10 2 17 3c0 10-5 16-13 12Z" />
                      <path d="m2 18 11-11" />
                    </>
                  )}
                </svg>
              </button>
            );
          })}
        </div>
      )}
      <div className="action-dock">
        <nav className="command-bar" aria-label="Game actions">
          <button
            aria-label="Open build panel"
            aria-keyshortcuts="B"
            title="Build (B)"
            aria-expanded={drawer === "build"}
            aria-pressed={drawer === "build"}
            onClick={() => {
              setSelected(null);
              setGhost(null);
              setInspectedId(null);
              setChoosingBuilding(false);
              setDrawer(drawer === "build" ? null : "build");
            }}
          >
            <ActionIcon kind="build" />
            <kbd>B</kbd>
          </button>
          <button
            aria-label="Manage crew"
            aria-keyshortcuts="W"
            title="Workers (W)"
            aria-expanded={drawer === "crew"}
            aria-pressed={drawer === "crew"}
            onClick={() => {
              setDrawer(drawer === "crew" ? null : "crew");
              focusLevel();
            }}
          >
            <ActionIcon kind="workers" />
            <kbd>W</kbd>
          </button>
        </nav>
        {(selected || inspected) && !drawer && state.phase === "playing" && (
          <div
            className="context-command"
            aria-label={`${MODULES[selected ?? inspected!.type].name} actions`}
          >
            <div className="context-buttons">
              {selected ? (
                <>
                  <button
                    onClick={rotate}
                    aria-label="Rotate ↻"
                    title="Rotate block (R)"
                  >
                    <ActionIcon kind="rotate" />
                  </button>
                  <button
                    className="primary"
                    disabled={!ghost || !!canBuild || busy || halted}
                    onClick={() => build()}
                    aria-label="Build ↵"
                    title={canBuild || "Place building (Enter)"}
                  >
                    <ActionIcon kind="place" />
                  </button>
                </>
              ) : (
                <>
                  {inspected!.type !== "core" && !inspected!.wreck && (
                    <button
                      disabled={inspected!.dismantling || busy}
                      aria-label={
                        inspected!.progress < 1
                          ? "Cancel blueprint — 100% refund"
                          : "Dismantle — 75% refund"
                      }
                      title={
                        inspected!.progress < 1
                          ? "Cancel blueprint — 100% refund"
                          : inspected!.dismantling
                            ? "Clearing units before dismantling"
                            : "Dismantle building — 75% refund"
                      }
                      onClick={() => {
                        void command({
                          type: "demolish",
                          moduleId: inspected!.id,
                        });
                        focusLevel();
                      }}
                    >
                      <ActionIcon kind="remove" />
                      <small>{inspected!.progress < 1 ? "100%" : "75%"}</small>
                    </button>
                  )}
                  <button
                    disabled={halted || busy}
                    onClick={() => {
                      if (
                        state.friend.targetId === inspected!.id &&
                        state.friend.order === "work"
                      ) {
                        void command({ type: "stop-friend" });
                        focusLevel();
                      } else inspect(inspected!.id);
                    }}
                    aria-label={
                      inspected!.progress < 1
                        ? "Build with Friend"
                        : "Work with Friend"
                    }
                    title={
                      state.friend.targetId === inspected!.id &&
                      state.friend.order === "work"
                        ? "Stop Friend working here"
                        : inspected!.progress < 1
                          ? "Build with Friend"
                          : "Work with Friend"
                    }
                    aria-pressed={
                      state.friend.targetId === inspected!.id &&
                      state.friend.order === "work"
                    }
                  >
                    <ActionIcon kind="work" />
                    {inspected!.progress < 1 && (
                      <small>{Math.floor(inspected!.progress * 100)}%</small>
                    )}
                  </button>
                  {inspected!.type === "core" && (
                    <button
                      disabled={halted || busy || state.integrity >= 100}
                      onClick={() =>
                        void command({
                          type: "direct",
                          ...inspected!.cells[0],
                          task: "repair",
                        })
                      }
                      aria-label="Repair hull"
                      title="Repair hull with Friend"
                    >
                      <ActionIcon kind="repair" />
                    </button>
                  )}
                  {inspected!.progress >= 1 &&
                    (inspectedRole ||
                      ["core", "habitat"].includes(inspected!.type)) && (
                      <button
                        className="primary"
                        disabled={
                          halted ||
                          busy ||
                          state.crew >= housing(state) ||
                          state.alloy < 6 ||
                          state.food < 8
                        }
                        onClick={() =>
                          void command({
                            type: "recruit",
                            role: inspectedRole ?? "builders",
                            ...(inspectedRole
                              ? { moduleId: inspected!.id }
                              : {}),
                          })
                        }
                        aria-label={`Recruit ${ROLE_NAMES[inspectedRole ?? "builders"].toLowerCase()} — 6 alloy, 8 food`}
                        title={`Recruit ${ROLE_NAMES[inspectedRole ?? "builders"].toLowerCase()} — 6 alloy, 8 food`}
                      >
                        <ActionIcon kind="recruit" />
                        <small>6 ⬡ · 8 ♧</small>
                      </button>
                    )}
                </>
              )}
              <button
                aria-label="Close building details"
                title="Clear selection (Esc)"
                onClick={() => {
                  setSelected(null);
                  setGhost(null);
                  setInspectedId(null);
                }}
              >
                <ActionIcon kind="close" />
              </button>
            </div>
          </div>
        )}
      </div>
      {(state.phase === "won" || state.phase === "lost") && (
        <div
          className="lobby-layer result-screen"
          role="region"
          aria-label="Match result"
          tabIndex={-1}
          ref={resultScreen}
        >
          <div className="lobby-card">
            <div className="eyebrow">
              {room?.winnerId ? "MATCH COMPLETE" : "STATION ELIMINATED"}
            </div>
            <h1>
              {room
                ? matchResult(room).title
                : state.phase === "won"
                  ? "Victory"
                  : "Defeat"}
            </h1>
            <h2 data-testid="match-winner">
              {room ? matchResult(room).winner : "Your expedition ended"}
            </h2>
            <p data-testid="match-reason">
              {room ? matchResult(room).reason : "Your core was destroyed."}
            </p>
            <p>
              {linked}/4 signals · {state.placed} modules · {clock(state.time)}
            </p>
            {room?.economy.wager ? (
              <>
                <p>
                  Escrow: {room.economy.wager.status}.{" "}
                  {room.economy.wager.status === "refundable"
                    ? "The result window expired. Claim your refund."
                    : "The winner claims the full 2 RF once settlement confirms."}
                </p>
                <button
                  className="primary"
                  onClick={() =>
                    void request("escrow", { id: room.economy.wager!.id })
                  }
                >
                  Open payout / refund
                </button>
              </>
            ) : (
              <p>Practice match · no tokens deposited or paid out.</p>
            )}
            <button
              className="primary launch"
              onClick={() => void returnHome()}
            >
              Main menu →
            </button>
          </div>
        </div>
      )}
      {panel && state.phase !== "won" && state.phase !== "lost" && (
        <Dialog
          title={
            panel === "settings"
              ? "Game menu"
              : panel === "match"
                ? "Your match"
                : panel === "crew"
                  ? "Recruit workers"
                  : panel === "signals"
                    ? "The four signals"
                    : "Flight manual"
          }
          onClose={() => {
            setPanel(null);
            setConfirmForfeit(false);
            setError("");
          }}
        >
          {panel === "help" ? (
            <>
              <div className="next-objective">
                <strong>{objective.title}</strong>
                <p>{objective.detail}</p>
                <button
                  onClick={() => {
                    setPanel(null);
                    if (objective.module) {
                      setSelected(objective.module);
                      setGhost(null);
                    } else if (objective.inspectId) {
                      setInspectedId(objective.inspectId);
                    }
                  }}
                >
                  Follow objective →
                </button>
              </div>
              {help}
            </>
          ) : panel === "crew" ? (
            <>
              <Crew
                state={state}
                busy={
                  busy ||
                  paused ||
                  offline ||
                  state.paused ||
                  state.phase !== "playing"
                }
                onCommand={(c) => void crewCommand(c)}
              />
              {error && <p role="alert">{error}</p>}
            </>
          ) : panel === "match" ? (
            <>
              <p>
                Four commanders maximum. Mix friends and AI. Invite everyone
                before beginning the match.
              </p>
              <label className="invite-code">
                Invite code
                <input
                  aria-label="Invite code"
                  readOnly
                  value={room?.code ?? ""}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <p>
                Friends choose Join friends on the main menu, then enter this
                code.
              </p>
              <div className="match-roster">
                {room?.players.map((p) => (
                  <div key={p.id}>
                    <span style={{ color: p.color }}>●</span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.bot
                        ? p.difficulty
                        : p.host
                          ? "Host"
                          : p.online
                            ? "Connected"
                            : "Away"}
                    </small>
                    {p.bot && room.isHost && state.phase === "ready" && (
                      <button
                        aria-label={`Remove ${p.name}`}
                        onClick={() =>
                          void crewCommand({ type: "bot-remove", target: p.id })
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {room?.isHost && state.phase === "ready" && (
                <>
                  <fieldset className="difficulty-picker">
                    <legend>Add AI commander</legend>
                    {(["easy", "normal", "hard"] as const).map((d) => (
                      <button
                        key={d}
                        disabled={
                          busy || room.players.length >= room.maxPlayers
                        }
                        onClick={() =>
                          void crewCommand({ type: "bot-add", difficulty: d })
                        }
                      >
                        Add {d} AI
                      </button>
                    ))}
                  </fieldset>
                  <button
                    className="primary launch"
                    disabled={busy || room.players.length < 2}
                    onClick={() => {
                      setPanel(null);
                      void crewCommand({ type: "start" });
                    }}
                  >
                    Begin match →
                  </button>
                </>
              )}
              {error && <p role="alert">{error}</p>}
            </>
          ) : panel === "signals" ? (
            <>
              <p>
                Reach a shared monolith with your Friend to capture it. Build
                completed paths. Capture takes 10 seconds; enemies contest it.
                Hold all four for 60 seconds.
              </p>
              {state.monoliths.map((m) => (
                <div className="signal-detail" key={m.name}>
                  <button
                    onClick={() => {
                      setFocusPoint({ x: m.x, y: m.y });
                      setPanel(null);
                    }}
                  >
                    ◇ {m.name} ↗
                  </button>
                  <span>
                    {Math.floor(m.progress)}% ·{" "}
                    {m.contested ? "Contested" : (m.ownerName ?? "Unclaimed")}
                  </span>
                  <progress max="100" value={m.progress} />
                </div>
              ))}
            </>
          ) : (
            <>
              <label className="setting-row">
                <span>Controls position</span>
                <GameSelect
                  label="Controls position"
                  value={dock}
                  onChange={(value) => {
                    const next = value as typeof dock;
                    setDock(next);
                    void request("preferences", { muted, reduced, dock: next });
                  }}
                  options={[
                    { value: "bottom", label: "Bottom" },
                    { value: "left", label: "Left" },
                    { value: "right", label: "Right" },
                  ]}
                />
              </label>
              <button
                className="setting-row"
                onClick={() => setPanel("signals")}
              >
                Signals {linked}/4 →
              </button>
              {room?.mode === "custom" && (
                <button
                  className="setting-row"
                  aria-label="Match setup"
                  onClick={() => setPanel("match")}
                >
                  Match & invitations →
                </button>
              )}
              <button
                className="setting-row"
                aria-label="Follow your Friend"
                onClick={() => {
                  setPanel(null);
                  setFocusPoint({
                    x: state.friend.x,
                    y: state.friend.y,
                    follow: true,
                  });
                }}
              >
                Find my Friend →
              </button>
              <button
                className="setting-row"
                aria-label="Stop your Friend"
                disabled={busy || state.phase !== "playing"}
                onClick={() => void crewCommand({ type: "stop-friend" })}
              >
                Stop Friend
              </button>
              <button
                className="setting-row"
                onClick={() => void request("wallet", {})}
              >
                Wallet & connection →
              </button>
              {room?.economy.wager && (
                <button
                  className="setting-row"
                  onClick={() =>
                    void request("escrow", { id: room.economy.wager!.id })
                  }
                >
                  RF escrow / refunds →
                </button>
              )}
              <button
                className="setting-row"
                aria-pressed={!muted}
                onClick={() => {
                  setMuted(!muted);
                  sound.current?.setMuted(!muted);
                  if (muted) void sound.current?.unlock();
                  void request("preferences", { muted: !muted, reduced, dock });
                }}
              >
                <span>Sound</span>
                <strong>{muted ? "OFF" : "ON"}</strong>
              </button>
              <label className="setting-row">
                <span>Reduce motion</span>
                <input
                  type="checkbox"
                  checked={reduced}
                  onChange={(e) => {
                    setReduced(e.target.checked);
                    void request("preferences", {
                      muted,
                      reduced: e.target.checked,
                      dock,
                    });
                  }}
                />
              </label>
              <button className="setting-row" onClick={() => setPanel("help")}>
                How to play <span>→</span>
              </button>
              {room?.isHost &&
                room.mode !== "online" &&
                state.phase === "playing" && (
                  <button
                    className="setting-row"
                    onClick={() => void crewCommand({ type: "pause" })}
                  >
                    {state.paused ? "Resume match" : "Pause match"}
                    <span>{state.paused ? "▶" : "Ⅱ"}</span>
                  </button>
                )}
              {state.phase === "playing" ? (
                <div className="forfeit-section">
                  <button
                    className="danger"
                    onClick={() => setConfirmForfeit(true)}
                  >
                    Forfeit match
                  </button>
                  {confirmForfeit && (
                    <>
                      <p>
                        {room?.economy.wager
                          ? "Forfeiting awards the full 2 RF pool to your opponent."
                          : "Your station will lose immediately. The other commanders can continue."}
                      </p>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={async () => {
                          await crewCommand({ type: "forfeit" });
                          setPanel(null);
                        }}
                      >
                        Confirm forfeit
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <button
                  className="setting-row"
                  onClick={() => void returnHome()}
                >
                  Main menu →
                </button>
              )}
              <p className="note">
                {room?.mode === "online"
                  ? room.economy.wager
                    ? "1 RF online match · winner claims 2 RF. Disconnects longer than 60 seconds forfeit."
                    : "Online practice · 1 vs 1 · no deposit or payout. Disconnects longer than 60 seconds forfeit."
                  : "Custom match · no token entry fee."}{" "}
                Menu controls do not pause opponents. Reloading loses your seat.
              </p>
              {error && <p role="alert">{error}</p>}
            </>
          )}
        </Dialog>
      )}
    </section>
  );
}
