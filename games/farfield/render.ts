import { attackTarget, type OrderMarker } from "./order-feedback.ts";
import { COMBAT } from "./combat.ts";
import {
  JOBS,
  workPower,
  visualPosition,
  type Actor,
  type Facing,
} from "./actors.ts";
import {
  MODULES,
  BOUND,
  rotated,
  placementError,
  type State,
  type Point,
  type BuildType,
} from "./engine.ts";
const fogCache = new WeakMap<
  State["modules"],
  {
    terrain: State["terrain"];
    vision: State["visibleCells"];
    known: Set<string>;
  }
>();
function knownTiles(s: State) {
  const previous = fogCache.get(s.modules);
  if (
    previous &&
    previous.terrain === s.terrain &&
    previous.vision === s.visibleCells
  )
    return previous.known;
  const known = new Set([
    ...(s.visibleCells ?? []),
    ...s.modules.flatMap((m) => m.cells.map((p) => `${p.x},${p.y}`)),
    ...(s.terrain ?? []).flatMap((m) => m.cells.map((p) => `${p.x},${p.y}`)),
  ]);
  for (const m of s.monoliths)
    for (let x = m.x - 3; x <= m.x + 3; x++)
      for (let y = m.y - 3; y <= m.y + 3; y++)
        if (Math.hypot(m.x - x, m.y - y) < 3) known.add(`${x},${y}`);
  fogCache.set(s.modules, {
    terrain: s.terrain,
    vision: s.visibleCells,
    known,
  });
  return known;
}
export type Contact = Point & { id: string; name: string; discovered: boolean };
export type Camera = { x: number; y: number; zoom: number };
export type Ghost = {
  type: BuildType;
  shape: number;
  x: number;
  y: number;
  rotation: number;
} | null;
export type Sprite = readonly string[];
export type CharacterAnimation = {
  familyId: number;
  clips: Record<"idle" | "walk", Record<Facing, readonly Sprite[]>>;
};
const stars = Array.from({ length: 180 }, (_, i) => ({
  x: ((i * 167 + 29) % 997) / 997,
  y: ((i * 293 + 61) % 991) / 991,
  size: i % 9 === 0 ? 1.6 : 0.7,
}));
export function screenToWorld(
  x: number,
  y: number,
  w: number,
  h: number,
  c: Camera,
): Point {
  const size = 24 * c.zoom;
  return {
    x: Math.floor((x - w / 2) / size + c.x),
    y: Math.floor((y - h / 2) / size + c.y),
  };
}
function path(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}
export function render(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: State,
  c: Camera,
  ghost: Ghost,
  sprite: Sprite | null,
  reduced: boolean,
  animation: CharacterAnimation | null = null,
  elapsed = 0,
  inspectedId: number | null = null,
  contacts: Contact[] = [],
  orderMarker: OrderMarker | null = null,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0c141f";
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(
    w * 0.45,
    h * 0.48,
    1,
    w * 0.45,
    h * 0.48,
    w * 0.7,
  );
  glow.addColorStop(0, "#172b354f");
  glow.addColorStop(1, "#0c141f00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  for (const star of stars) {
    ctx.fillStyle = star.size > 1 ? "#79909b88" : "#657b884c";
    ctx.fillRect(star.x * w, star.y * h, star.size, star.size);
  }
  const size = 24 * c.zoom,
    px = (x: number) => (x - c.x) * size + w / 2,
    py = (y: number) => (y - c.y) * size + h / 2;
  ctx.strokeStyle = "#8798a30b";
  ctx.lineWidth = 1;
  for (let i = -BOUND; i <= BOUND + 1; i++) {
    ctx.beginPath();
    ctx.moveTo(px(i), py(-BOUND));
    ctx.lineTo(px(i), py(BOUND + 1));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px(-BOUND), py(i));
    ctx.lineTo(px(BOUND + 1), py(i));
    ctx.stroke();
  }
  ctx.strokeStyle = "#69889222";
  ctx.setLineDash([3, 6]);
  ctx.strokeRect(
    px(-BOUND),
    py(-BOUND),
    (BOUND * 2 + 1) * size,
    (BOUND * 2 + 1) * size,
  );
  ctx.setLineDash([]);
  for (const contact of contacts) {
    const x = px(contact.x + 0.5),
      y = py(contact.y + 0.5);
    ctx.strokeStyle = contact.discovered ? "#cbdba1" : "#d392ad";
    ctx.fillStyle = "#12202a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = `${Math.max(13, size * 0.6)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(contact.discovered ? "⚑" : "?", x, y + size * 0.2);
    ctx.font = `${Math.max(9, 9 * c.zoom)}px monospace`;
    ctx.fillText(
      contact.discovered ? contact.name : "RIVAL SIGNAL",
      x,
      y + size * 1.2,
    );
  }
  for (const node of s.deposits) {
    if (node.amount <= 0) continue;
    const x = px(node.x + 0.5),
      y = py(node.y + 0.5);
    const color = { alloy: "#dfaf86", energy: "#e9d27e", food: "#92cdb3" }[
      node.resource
    ];
    const pulse = reduced ? 1 : 1 + Math.sin(s.time * 2 + node.x) * 0.07;
    ctx.fillStyle = color + "18";
    ctx.beginPath();
    ctx.arc(x, y, size * 0.95 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.fillStyle = "#172931";
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const nx = x + Math.cos(a) * size * 0.48,
        ny = y + Math.sin(a) * size * 0.48;
      if (i) ctx.lineTo(nx, ny);
      else ctx.moveTo(nx, ny);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.max(14, size * 0.6)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(
      { alloy: "⬡", energy: "ϟ", food: "♧" }[node.resource],
      x,
      y + size * 0.18,
    );
    ctx.font = `${Math.max(11, 8 * c.zoom)}px monospace`;
    ctx.fillText(
      `${node.resource.toUpperCase()} · ${Math.ceil(node.amount)}`,
      x,
      y + size * 0.95,
    );
  }
  ctx.textAlign = "left";
  const onScreen = (x: number, y: number, margin = size * 2) =>
    x >= -margin && y >= -margin && x <= w + margin && y <= h + margin;
  const activeModules = new Set(
    s.workers.filter((a) => a.working && !a.fighting).map((a) => a.targetId),
  );
  if (s.friend.working && !s.friend.fighting && s.friend.task !== "rest")
    activeModules.add(s.friend.targetId);
  const visibleModules = [...(s.terrain ?? []), ...s.modules].filter((mod) =>
    mod.cells.some((p) => onScreen(px(p.x), py(p.y), size * 6)),
  );
  // Draw every extrusion below every floor. Interleaving these per module
  // lets a later building's shadow cover the top of an adjacent earlier one.
  ctx.fillStyle = "#050b13";
  for (const mod of visibleModules)
    for (const p of mod.cells)
      ctx.fillRect(px(p.x) + 3 * c.zoom, py(p.y) + 6 * c.zoom, size - 1, size - 1);
  for (const mod of visibleModules) {
    const hostile =
      s.shared && mod.owner !== s.playerId && mod.owner !== "neutral";
    const targeted =
      s.friend.attack?.moduleId === mod.id &&
      s.friend.attack.playerId === mod.owner;
    if (
      mod.type === "turret" &&
      mod.progress >= 1 &&
      !mod.wreck &&
      (hostile || mod.id === inspectedId)
    ) {
      const disabled = (mod.disabledUntil ?? 0) > s.time;
      const staffed = hostile
        ? mod.staffed !== false
        : activeModules.has(mod.id);
      // Range is measured from every occupied tile, matching server damage checks.
      ctx.fillStyle = disabled || !staffed ? "#79cdec08" : "#f4868c0a";
      ctx.strokeStyle = disabled || !staffed ? "#79cdec77" : "#f4868c66";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      for (const p of mod.cells) {
        ctx.beginPath();
        ctx.arc(
          px(p.x + 0.5),
          py(p.y + 0.5),
          COMBAT.turretRange * size,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = disabled ? "#9aeaff" : "#ffadb0";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        disabled
          ? `EMP · ${Math.ceil(mod.disabledUntil! - s.time)}s`
          : staffed
            ? "TURRET RANGE"
            : "TURRET · UNSTAFFED",
        px(mod.cells[0].x + 0.5),
        py(mod.cells[0].y) - 12,
      );
    }
    if (targeted) {
      ctx.strokeStyle = "#ffb088";
      ctx.lineWidth = 3;
      for (const p of mod.cells)
        ctx.strokeRect(px(p.x) - 2, py(p.y) - 2, size + 4, size + 4);
    }

    const def = MODULES[mod.type],
      pending = mod.progress < 1;
    for (const p of mod.cells) {
      const x = px(p.x),
        y = py(p.y);
      ctx.globalAlpha = pending
        ? 0.3 + (reduced ? 0 : Math.sin(s.time * 4 + mod.id) * 0.08)
        : 0.95;
      if (mod.dismantling) ctx.globalAlpha = 0.45;
      ctx.fillStyle = mod.wreck ? "#4e626a" : def.color;
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      if (s.shared && mod.owner !== s.playerId && mod.owner !== "neutral") {
        ctx.strokeStyle = "#e79797";
        ctx.strokeRect(x + 2, y + 2, size - 4, size - 4);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = pending ? "#f4edd511" : "#ffffff15";
      ctx.fillRect(x + 2, y + 2, size - 4, 2 * c.zoom);
      if (pending) {
        ctx.strokeStyle = def.color + "77";
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x + 2, y + 2, size - 4, size - 4);
        ctx.setLineDash([]);
      }
      if (mod.type === "infirmary" && !pending) {
        ctx.fillStyle = "#daffe7";
        ctx.fillRect(
          x + size * 0.43,
          y + size * 0.22,
          size * 0.14,
          size * 0.56,
        );
        ctx.fillRect(
          x + size * 0.22,
          y + size * 0.43,
          size * 0.56,
          size * 0.14,
        );
      }
      if (mod.type === "solar" && !pending) {
        ctx.strokeStyle = "#65562c66";
        ctx.lineWidth = 1;
        for (let t = 1; t < 4; t++) {
          ctx.beginPath();
          ctx.moveTo(x + (t * size) / 4, y + 4);
          ctx.lineTo(x + (t * size) / 4, y + size - 4);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(x + 3, y + size / 2);
        ctx.lineTo(x + size - 3, y + size / 2);
        ctx.stroke();
      }
      if (mod.type === "garden" && !pending) {
        ctx.fillStyle = "#31544f88";
        for (let t = 0; t < 3; t++) {
          ctx.fillRect(
            x + size * 0.2,
            y + size * (0.2 + t * 0.25),
            size * 0.6,
            size * 0.1,
          );
        }
      }
      if (mod.type === "foundry" && !pending) {
        ctx.fillStyle = "#6c4d3b88";
        ctx.fillRect(x + size * 0.3, y + size * 0.3, size * 0.4, size * 0.4);
        ctx.fillStyle = "#f2d19a";
        ctx.fillRect(x + size * 0.4, y + size * 0.4, size * 0.2, size * 0.2);
      }
      if (mod.type === "habitat" && !pending) {
        ctx.fillStyle = "#53496688";
        ctx.fillRect(x + size * 0.2, y + size * 0.25, size * 0.6, size * 0.5);
        ctx.fillStyle = "#ded8f0";
        ctx.fillRect(x + size * 0.25, y + size * 0.3, size * 0.18, size * 0.4);
      }
      if (mod.type === "lab" && !pending) {
        ctx.strokeStyle = "#305b6b99";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + size * 0.3, y + size * 0.3, size * 0.4, size * 0.4);
      }
    }
    const active =
      mod.progress >= 1 && JOBS[mod.type] && activeModules.has(mod.id);
    if (active || mod.id === inspectedId || pending) {
      ctx.strokeStyle =
        mod.id === inspectedId
          ? "#eff6cb"
          : active
            ? `${def.color}bb`
            : "#d4dcbc66";
      ctx.lineWidth = mod.id === inspectedId ? 2.5 : 1;
      for (const p of mod.cells)
        ctx.strokeRect(px(p.x) + 2, py(p.y) + 2, size - 4, size - 4);
    }
    if (mod.id === inspectedId || (c.zoom > 1.3 && mod.type !== "passage")) {
      const bottom = mod.cells.reduce((a, b) => (a.y > b.y ? a : b));
      ctx.font = `${Math.max(10, 7 * c.zoom)}px monospace`;
      ctx.textAlign = "left";
      ctx.fillStyle = "#d9e4df";
      ctx.fillText(
        mod.dismantling ? "CLEARING…" : def.name.toUpperCase(),
        px(Math.min(...mod.cells.map((p) => p.x))),
        py(bottom.y + 1) + 12 * c.zoom,
      );
    }
    const mid = mod.cells[0],
      x = px(mid.x + 0.5),
      y = py(mid.y + 0.5);
    if (!pending && (mod.hp ?? 100) < 100 && !mod.wreck) {
      ctx.fillStyle = "#503238";
      ctx.fillRect(x - size * 0.4, y - size * 0.5, size * 0.8, 4);
      ctx.fillStyle = "#e7acaa";
      ctx.fillRect(
        x - size * 0.4,
        y - size * 0.5,
        (size *
          0.8 *
          (mod.type === "core" && mod.owner === s.playerId
            ? s.integrity
            : (mod.hp ?? 100))) /
          100,
        4,
      );
    }
    if (pending) {
      ctx.fillStyle = "#122230";
      ctx.fillRect(x - size * 0.3, y - 2, size * 0.6, 4);
      ctx.fillStyle = def.color;
      ctx.fillRect(x - size * 0.3, y - 2, size * 0.6 * mod.progress, 4);
    }
    if (mod.type === "turret") {
      ctx.fillStyle = "#70414d";
      ctx.beginPath();
      ctx.arc(x, y, size * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f5c8c7";
      ctx.lineWidth = size * 0.16;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + size * 0.35, y - size * 0.35);
      ctx.stroke();
    }
  }
  // Monolith geometry is original; their rings communicate reach and decoding progress.
  s.monoliths.forEach((m, i) => {
    const x = px(m.x + 0.5),
      y = py(m.y + 0.5),
      done = m.progress >= 100;
    ctx.strokeStyle = m.contested
      ? "#ed9e97"
      : m.ownerId === s.playerId
        ? "#bfe2bd"
        : m.ownerId
          ? "#ed9e97"
          : "#748d8f66";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, size * 2.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = done ? "#d8f2c2" : "#8cafb7";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(
      x,
      y,
      size * 2.1,
      -Math.PI / 2,
      -Math.PI / 2 + (Math.PI * 2 * m.progress) / 100,
    );
    ctx.stroke();
    const t = reduced ? 0 : Math.sin(s.time * 0.8 + i) * 2;
    ctx.fillStyle = "#294049";
    path(ctx, [
      { x: x - size * 0.45, y: y - size * 0.8 + t },
      { x: x + size * 0.1, y: y - size * 1.1 + t },
      { x: x + size * 0.45, y: y - size * 0.8 + t },
      { x: x + size * 0.45, y: y + size * 0.55 + t },
      { x: x, y: y + size * 0.85 + t },
      { x: x - size * 0.45, y: y + size * 0.55 + t },
    ]);
    ctx.fill();
    ctx.fillStyle = done ? "#c7e4bc" : "#7898a0";
    path(ctx, [
      { x: x - size * 0.45, y: y - size * 0.8 + t },
      { x: x, y: y - size * 0.55 + t },
      { x: x, y: y + size * 0.85 + t },
      { x: x - size * 0.45, y: y + size * 0.55 + t },
    ]);
    ctx.fill();
    ctx.strokeStyle = done ? "#e0f9cc" : "#b3d3d3";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - size * 0.23, y - size * 0.35 + t);
    ctx.lineTo(x - size * 0.23, y + size * 0.23 + t);
    ctx.stroke();
    if (c.zoom > 0.4) {
      ctx.font = `${Math.max(9, 10 * c.zoom)}px monospace`;
      ctx.textAlign = "center";
      ctx.fillStyle = done ? "#c7e4bc" : "#92a8ae";
      ctx.fillText(
        c.zoom < 0.9 ? `0${i + 1}` : `0${i + 1} / ${m.name.toUpperCase()}`,
        x,
        y + size * 3,
      );
      ctx.fillStyle = "#657d88";
      ctx.fillText(
        s.shared
          ? m.contested
            ? "CONTESTED"
            : m.claimant
              ? `CAPTURING ${Math.floor(m.progress)}%`
              : (m.ownerName ??
                (c.zoom < 0.9 ? "UNCLAIMED" : "UNCLAIMED · CLICK TO CAPTURE"))
          : done
            ? "SIGNAL LINKED"
            : "UNKNOWN SIGNAL",
        x,
        y + size * 3 + Math.max(15, 14 * c.zoom),
      );
    }
  });
  // Every visible actor has a real server-side position and job.
  const friendPosition = visualPosition(s.friend, elapsed, 3.5);
  if (s.friend.path.length) {
    ctx.strokeStyle = "#d6e9bb77";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(px(friendPosition.x + 0.5), py(friendPosition.y + 0.5));
    for (const p of s.friend.path) ctx.lineTo(px(p.x + 0.5), py(p.y + 0.5));
    ctx.stroke();
    ctx.setLineDash([]);
    const goal = s.friend.path.at(-1)!;
    ctx.strokeRect(px(goal.x) + 3, py(goal.y) + 3, size - 6, size - 6);
  }
  function workEffect(
    actor: Actor,
    x: number,
    y: number,
    color: string,
    label = false,
  ) {
    if (!actor.working || reduced) return;
    const phase = s.time * 5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y - size * 0.25, size * 0.44, phase, phase + 1.1);
    ctx.stroke();
    if (actor.task === "build" || actor.task === "repair") {
      for (let i = 0; i < 3; i++) {
        const t = (s.time * 1.5 + i / 3) % 1;
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = "#f7ce86";
        ctx.fillRect(
          x + size * (0.2 + t * 0.4),
          y - size * (0.2 + t * 0.5),
          2 * c.zoom,
          2 * c.zoom,
        );
      }
      ctx.globalAlpha = 1;
    } else if (
      label &&
      ["miners", "farmers", "engineers", "salvage", "scientists"].includes(
        actor.task,
      )
    ) {
      const t = (s.time * 0.65) % 1;
      const label =
        actor.task === "farmers" || actor.task === "gather-food"
          ? "+ food"
          : actor.task === "engineers" || actor.task === "gather-energy"
            ? "+ energy"
            : actor.task === "scientists"
              ? "decoding"
              : "+ alloy";
      ctx.fillStyle = color;
      ctx.globalAlpha = Math.min(1, (1 - t) * 2);
      ctx.font = `${Math.max(10, 8 * c.zoom)}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText(label, x, y - size * (0.8 + t * 0.7));
      ctx.globalAlpha = 1;
    }
  }
  const workerColors = {
    builders: "#f1d48e",
    miners: "#e6ad82",
    farmers: "#94d4a0",
    engineers: "#efd767",
    guards: "#ed9ba8",
    scientists: "#8dd2e0",
    medics: "#a8d9c5",
  };
  for (const worker of s.workers) {
    const p = visualPosition(worker, elapsed, 2),
      x = px(p.x + 0.5),
      y = py(p.y + 0.5);
    if (!onScreen(x, y)) continue;
    const stride =
      !reduced && worker.path.length
        ? Math.sin(s.time * 15 + worker.id) * size * 0.08
        : 0;
    ctx.fillStyle = "#030a1188";
    ctx.beginPath();
    ctx.ellipse(
      x,
      y + size * 0.18,
      size * 0.17,
      size * 0.08,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = "#314250";
    ctx.fillRect(x - size * 0.12, y - size * 0.1, size * 0.24, size * 0.3);
    ctx.fillStyle =
      s.time - worker.lastHit < 0.35 ? "#fff0e5" : workerColors[worker.role];
    ctx.fillRect(x - size * 0.11, y - size * 0.27, size * 0.22, size * 0.2);
    ctx.fillRect(
      x - size * 0.13,
      y + size * 0.14 + stride,
      size * 0.09,
      size * 0.13,
    );
    ctx.fillRect(
      x + size * 0.04,
      y + size * 0.14 - stride,
      size * 0.09,
      size * 0.13,
    );
    workEffect(worker, x, y, workerColors[worker.role]);
  }
  const heroX = px(friendPosition.x + 0.5),
    heroY = py(friendPosition.y + 0.5);
  if ((s.abilities?.shieldUntil ?? 0) > s.time) {
    ctx.fillStyle = "#73d8ff33";
    ctx.strokeStyle = "#98e8ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(heroX, heroY, size * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  if (s.abilities && s.time - s.abilities.empAt < 0.7) {
    const t = Math.max(0, (s.time - s.abilities.empAt) / 0.7);
    ctx.strokeStyle = `rgba(126,224,255,${1 - t})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(heroX, heroY, size * COMBAT.empRange * t, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (s.friend.hp > 0) {
    ctx.fillStyle = "#3e252e";
    ctx.fillRect(heroX - size * 0.55, heroY - size * 0.95, size * 1.1, 5);
    ctx.fillStyle = s.friend.hp < 40 ? "#ff888c" : "#c8e9b6";
    ctx.fillRect(
      heroX - size * 0.55,
      heroY - size * 0.95,
      (size * 1.1 * s.friend.hp) / s.friend.maxHp,
      5,
    );
  }
  ctx.fillStyle = "#080d15aa";
  ctx.beginPath();
  ctx.ellipse(
    heroX,
    heroY + size * 0.35,
    size * 0.4,
    size * 0.14,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.strokeStyle = "#dfedb4";
  ctx.lineWidth = Math.max(1.5, c.zoom);
  ctx.beginPath();
  ctx.ellipse(
    heroX,
    heroY + size * 0.3,
    size * 0.43,
    size * 0.18,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  const facing =
    animation?.familyId === 6 && ["up", "down"].includes(s.friend.facing)
      ? s.friend.sideFacing
      : s.friend.facing;
  const frameIndex = reduced
    ? 0
    : Math.floor(s.time * (s.friend.path.length ? 10 : 5)) % 8;
  const bitmap =
    animation?.clips[s.friend.path.length ? "walk" : "idle"][facing][
      frameIndex
    ] ?? sprite;
  if (bitmap) {
    const unit = (size * 1.4) / 16,
      left = heroX - unit * 8,
      top = heroY - unit * 11;
    ctx.fillStyle = "#111c25";
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        if (bitmap[y]?.[x] === "#")
          ctx.fillRect(
            left + x * unit - 1,
            top + y * unit - 1,
            unit + 2,
            unit + 2,
          );
    ctx.fillStyle = s.time - s.friend.lastHit < 0.25 ? "#ffc0b4" : "#e6f2cd";
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        if (bitmap[y]?.[x] === "#")
          ctx.fillRect(left + x * unit, top + y * unit, unit, unit);
  } else {
    ctx.fillStyle = s.time - s.friend.lastHit < 0.25 ? "#ffc0b4" : "#e6f2cd";
    ctx.fillRect(
      heroX - size * 0.2,
      heroY - size * 0.4,
      size * 0.4,
      size * 0.6,
    );
  }
  ctx.font = `bold ${Math.max(10, 7 * c.zoom)}px monospace`;
  ctx.textAlign = "center";
  ctx.fillStyle = "#dcedbd";
  ctx.fillText(
    s.friend.hp > 0
      ? `FRIEND · ${Math.ceil(s.friend.hp)}`
      : `RETURNING ${Math.max(0, Math.ceil(s.friend.respawnAt - s.time))}s`,
    heroX,
    heroY + size * 0.8,
  );
  workEffect(s.friend, heroX, heroY, "#e6efbf", true);
  for (const unit of s.visibleUnits ?? []) {
    const x = px(unit.x + 0.5),
      y = py(unit.y + 0.5),
      t = size * (unit.hero ? 0.6 : 0.35);
    ctx.fillStyle = unit.color;
    ctx.fillRect(x - t / 2, y - t, t, t);
    ctx.strokeStyle = "#f99ba1";
    ctx.strokeRect(x - t / 2 - 2, y - t - 2, t + 4, t + 4);
    ctx.fillStyle = "#4a303b";
    ctx.fillRect(x - size * 0.4, y + 5, size * 0.8, 4);
    ctx.fillStyle = "#efb0b3";
    ctx.fillRect(x - size * 0.4, y + 5, (size * 0.8 * unit.hp) / unit.maxHp, 4);
    ctx.font = `${Math.max(10, size * 0.25)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(
      unit.hero ? unit.name : (unit.role ?? "Worker"),
      x,
      y + size * 0.6,
    );
  }
  // Unknown space stays dark. Public objective locations and the neutral platform remain visible.
  if (s.shared && s.visibleCells) {
    const known = knownTiles(s);
    ctx.fillStyle = "#04091070";
    const left = Math.max(-BOUND, Math.floor(c.x - w / size / 2)),
      right = Math.min(BOUND, Math.ceil(c.x + w / size / 2));
    const top = Math.max(-BOUND, Math.floor(c.y - h / size / 2)),
      bottom = Math.min(BOUND, Math.ceil(c.y + h / size / 2));
    for (let x = left; x <= right; x++)
      for (let y = top; y <= bottom; y++)
        if (!known.has(`${x},${y}`))
          ctx.fillRect(px(x), py(y), size + 1, size + 1);
  }
  const target = attackTarget(s);
  if (target) {
    const x = px(target.point.x + 0.5),
      y = py(target.point.y + 0.5);
    ctx.strokeStyle = "#ffb088";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(12, size * 0.65), 0, Math.PI * 2);
    ctx.moveTo(x - size, y);
    ctx.lineTo(x - size * 0.7, y);
    ctx.moveTo(x + size * 0.7, y);
    ctx.lineTo(x + size, y);
    ctx.stroke();
  }
  if (orderMarker && orderMarker.until > performance.now()) {
    const { point, status } = orderMarker;
    const x = px(point.x + 0.5),
      y = py(point.y + 0.5);
    ctx.strokeStyle =
      status === "rejected"
        ? "#ff8c96"
        : status === "pending"
          ? "#efd767"
          : "#d6edb2";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(10, size * 0.42), 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      status === "rejected" ? "×" : status === "pending" ? "…" : "✓",
      x,
      y + 4,
    );
  }
  for (const shot of s.shots) {
    const color = shot.hostile
      ? "#ff8694"
      : shot.kind === "guard"
        ? "#efce82"
        : "#dbf9b4";
    const x = px(shot.from.x + 0.5),
      y = py(shot.from.y + 0.5),
      tx = px(shot.to.x + 0.5),
      ty = py(shot.to.y + 0.5);
    ctx.strokeStyle = color;
    ctx.lineWidth = shot.kind === "turret" ? 3 : 2;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const t = reduced
      ? 1
      : Math.min(1, (s.time - (shot.at ?? s.time) + 0.05) / 0.25);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + (tx - x) * t, y + (ty - y) * t, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(tx, ty, 4 + (reduced ? 0 : t * 5), 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const e of s.enemies) {
    const x = px(e.x + 0.5),
      y = py(e.y + 0.5);
    ctx.fillStyle = "#ea8892";
    path(ctx, [
      { x, y: y - 5 * c.zoom },
      { x: x + 4 * c.zoom, y: y + 4 * c.zoom },
      { x: x - 4 * c.zoom, y: y + 4 * c.zoom },
    ]);
    ctx.fill();
    ctx.fillStyle = "#543940";
    ctx.fillRect(x - 6, y + 8, 12, 2);
    ctx.fillStyle = "#ec98a0";
    ctx.fillRect(x - 6, y + 8, (12 * e.hp) / e.maxHp, 2);
  }
  if (ghost) {
    const valid = !placementError(
        s,
        ghost.type,
        ghost.shape,
        ghost.rotation,
        ghost.x,
        ghost.y,
      ),
      color = valid ? "#c5e2b7" : "#ee9a9e";
    for (const p of rotated(ghost.shape, ghost.rotation)) {
      const x = px(p.x + ghost.x),
        y = py(p.y + ghost.y);
      ctx.fillStyle = valid ? "#c5e2b733" : "#ee9a9e33";
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    }
    if (ghost.type === "turret") {
      ctx.strokeStyle = "#dd909644";
      ctx.beginPath();
      ctx.arc(px(ghost.x + 0.5), py(ghost.y + 0.5), 8 * size, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.textAlign = "left";
}
