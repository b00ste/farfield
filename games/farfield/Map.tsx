import type { OrderMarker } from "./order-feedback.ts";
import { useEffect, useRef, useState } from "react";
import {
  render,
  screenToWorld,
  type Camera,
  type Ghost,
  type Sprite,
  type CharacterAnimation,
} from "./render.ts";
import { visualPosition } from "./actors.ts";
import { placementError, rotated, type State, type Point } from "./engine.ts";
export function StationMap({
  orderMarker,
  state,
  contacts,
  ghost,
  sprite,
  animation,
  inspectedId,
  onMove,
  reduced,
  disabled,
  blueprint,
  onPick,
  onPreview,
  onRotate,
  onPlace,
  focusPoint,
}: {
  orderMarker: OrderMarker | null;
  focusPoint: (Point & { follow?: boolean }) | null;
  contacts: import("./render.ts").Contact[];
  state: State;
  ghost: Ghost;
  sprite: Sprite | null;
  animation: CharacterAnimation | null;
  inspectedId: number | null;
  onMove: (dx: number, dy: number) => void;
  reduced: boolean;
  disabled: boolean;
  blueprint: Pick<NonNullable<Ghost>, "type" | "shape" | "rotation"> | null;
  onPick: (p: Point) => void;
  onPreview: (p: Point) => void;
  onRotate: () => void;
  onPlace: () => void;
}) {
  const placing = !!blueprint;
  const canvas = useRef<HTMLCanvasElement>(null),
    camera = useRef<Camera>({
      x: state.spawn?.x ?? 0,
      y: state.spawn?.y ?? 0,
      zoom: innerWidth > 900 ? 1.5 : 1,
    });
  const latest = useRef({
    state,
    contacts,
    ghost,
    sprite,
    reduced,
    animation,
    inspectedId,
    orderMarker,
    placing,
    onPreview,
  });
  latest.current = {
    state,
    contacts,
    ghost,
    sprite,
    reduced,
    animation,
    inspectedId,
    orderMarker,
    placing,
    onPreview,
  };
  // Seed a visible preview without waiting for a hover event (touch has none).
  useEffect(() => {
    if (!blueprint || ghost || disabled) return;
    const cells = rotated(blueprint.shape, blueprint.rotation);
    const width = Math.max(...cells.map((p) => p.x)) + 1;
    const height = Math.max(...cells.map((p) => p.y)) + 1;
    const rect = canvas.current!.getBoundingClientRect();
    const insetX = Math.min(24, rect.width / 8);
    const insetY = Math.min(96, rect.height / 4);
    // Keep the entire piece visible, including on a phone zoomed far in.
    setCameraZoom(
      Math.min(
        camera.current.zoom,
        (rect.width - 2 * insetX) / (24 * (width + 1)),
        (rect.height - 2 * insetY) / (24 * (height + 1)),
      ),
    );
    const size = 24 * camera.current.zoom;
    const minX = Math.ceil(camera.current.x - (rect.width / 2 - insetX) / size);
    const maxX = Math.floor(
      camera.current.x + (rect.width / 2 - insetX) / size - width,
    );
    const minY = Math.ceil(
      camera.current.y - (rect.height / 2 - insetY) / size,
    );
    const maxY = Math.floor(
      camera.current.y + (rect.height / 2 - insetY) / size - height,
    );
    const center = {
      x: Math.max(
        minX,
        Math.min(maxX, Math.floor(camera.current.x - width / 2)),
      ),
      y: Math.max(
        minY,
        Math.min(maxY, Math.floor(camera.current.y - height / 2)),
      ),
    };
    const occupied = new Set(
      [
        ...latest.current.state.modules,
        ...(latest.current.state.terrain ?? []),
      ].flatMap((m) => m.cells.map((p) => `${p.x},${p.y}`)),
    );
    const candidates: Point[] = [];
    for (let y = -4; y <= 4; y++)
      for (let x = -4; x <= 4; x++) {
        const p = { x: center.x + x, y: center.y + y };
        if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)
          candidates.push(p);
      }
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - center.x, a.y - center.y) -
        Math.hypot(b.x - center.x, b.y - center.y),
    );
    const position = candidates.find((p) => {
      if (cells.some((c) => occupied.has(`${p.x + c.x},${p.y + c.y}`)))
        return false;
      const error = placementError(
        latest.current.state,
        blueprint.type,
        blueprint.shape,
        blueprint.rotation,
        p.x,
        p.y,
      );
      return !error || error === "Not enough alloy.";
    });
    latest.current.onPreview(position ?? center);
  }, [
    placing,
    blueprint?.type,
    blueprint?.shape,
    blueprint?.rotation,
    ghost,
    disabled,
  ]);
  const lastSpawn = useRef("");
  useEffect(() => {
    if (!state.spawn) return;
    const id = `${state.spawn.x},${state.spawn.y}`;
    if (lastSpawn.current !== id) {
      lastSpawn.current = id;
      camera.current.x = state.spawn.x;
      camera.current.y = state.spawn.y;
    }
  }, [state.spawn]);
  const following = useRef(false),
    lastMove = useRef(0);
  const received = useRef({ state, at: performance.now() });
  if (received.current.state !== state)
    received.current = { state, at: performance.now() };
  const drag = useRef<{
    x: number;
    y: number;
    cx: number;
    cy: number;
    distance: number;
    pointerId: number;
    preview: Point | null;
    tileSize: number;
  } | null>(null);
  const touches = useRef(new Map<number, Point>());
  const multiTouch = useRef(false);
  const pinch = useRef<{ x: number; y: number; distance: number } | null>(null);
  const touchPair = () => {
    const [a, b] = [...touches.current.values()];
    return a && b
      ? {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          distance: Math.hypot(a.x - b.x, a.y - b.y),
        }
      : null;
  };
  const endTouch = (id: number) => {
    touches.current.delete(id);
    pinch.current = touchPair();
    if (!touches.current.size) multiTouch.current = false;
  };
  const [zoom, setZoom] = useState(Math.round(camera.current.zoom * 100));
  const setCameraZoom = (z: number) => {
    camera.current.zoom = Math.max(0.1, Math.min(4, z));
    setZoom(Math.round(camera.current.zoom * 100));
  };
  useEffect(() => {
    if (focusPoint) {
      following.current = !!focusPoint.follow;
      camera.current.x = focusPoint.x;
      camera.current.y = focusPoint.y;
      setCameraZoom(
        focusPoint.follow || (focusPoint.x === 0 && focusPoint.y === 0)
          ? innerWidth > 900
            ? 1.5
            : 1
          : 0.75,
      );
    }
  }, [focusPoint]);
  useEffect(() => {
    const el = canvas.current!,
      ctx = el.getContext("2d")!;
    let frame = 0,
      w = 0,
      h = 0;
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect(),
        dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      el.width = w * dpr;
      el.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    observer.observe(el);
    const draw = (now: number) => {
      const {
        state,
        contacts,
        ghost,
        sprite,
        reduced,
        animation,
        inspectedId,
        placing,
      } = latest.current;
      // Animate between server snapshots without predicting resources or commands.
      const elapsed =
        state.phase === "playing" && !state.paused
          ? Math.max(0, Math.min(0.35, (now - received.current.at) / 1000))
          : 0;
      if (following.current && !placing) {
        const position = visualPosition(state.friend, elapsed, 3.5);
        camera.current.x = position.x;
        camera.current.y = position.y;
      }
      render(
        ctx,
        w,
        h,
        { ...state, time: state.time + elapsed },
        camera.current,
        ghost,
        sprite,
        reduced,
        animation,
        elapsed,
        inspectedId,
        contacts,
        latest.current.orderMarker,
      );
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setCameraZoom(camera.current.zoom * (e.deltaY > 0 ? 0.9 : 1.1));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, []);
  return (
    <div className="map-wrap">
      <canvas
        ref={canvas}
        aria-label="Station map. Tap a building to move your Friend and work. Drag to pan; pinch to zoom. Use arrow keys to walk on completed station tiles. Build passages to shared monoliths and explore enemy bases. Choose a building to preview it. Drag its preview to position it, then use Build. Tap elsewhere to build there. R rotates; Enter also builds."
        tabIndex={0}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0 || (!e.isPrimary && e.pointerType !== "touch"))
            return;
          if (e.pointerType === "touch") {
            touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (touches.current.size > 1 || multiTouch.current) {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              following.current = false;
              multiTouch.current = true;
              drag.current = null;
              pinch.current = touchPair();
              return;
            }
          }
          if (placing) following.current = false;
          e.preventDefault();
          e.currentTarget.focus({ preventScroll: true });
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          const point = screenToWorld(
            e.clientX - r.left,
            e.clientY - r.top,
            r.width,
            r.height,
            camera.current,
          );
          const grabPreview =
            !disabled &&
            placing &&
            ghost &&
            (e.pointerType === "touch" || e.pointerType === "pen") &&
            rotated(ghost.shape, ghost.rotation).some(
              (p) => ghost.x + p.x === point.x && ghost.y + p.y === point.y,
            );
          drag.current = {
            preview: grabPreview ? { x: ghost.x, y: ghost.y } : null,
            tileSize: 24 * camera.current.zoom,
            x: e.clientX,
            y: e.clientY,
            cx: camera.current.x,
            cy: camera.current.y,
            distance: 0,
            pointerId: e.pointerId,
          };
        }}
        onPointerMove={(e) => {
          if (touches.current.has(e.pointerId)) {
            touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (multiTouch.current) {
              const next = touchPair(),
                previous = pinch.current;
              if (
                next &&
                previous &&
                previous.distance > 0 &&
                next.distance > 0
              ) {
                const r = e.currentTarget.getBoundingClientRect();
                const c = camera.current;
                const wx =
                  c.x + (previous.x - r.left - r.width / 2) / (24 * c.zoom);
                const wy =
                  c.y + (previous.y - r.top - r.height / 2) / (24 * c.zoom);
                setCameraZoom((c.zoom * next.distance) / previous.distance);
                c.x = wx - (next.x - r.left - r.width / 2) / (24 * c.zoom);
                c.y = wy - (next.y - r.top - r.height / 2) / (24 * c.zoom);
              }
              pinch.current = next;
              return;
            }
          }
          const d = drag.current;
          if (disabled && !d) return;
          if (!d) {
            if (e.pointerType === "mouse" && placing) {
              const r = e.currentTarget.getBoundingClientRect();
              onPreview(
                screenToWorld(
                  e.clientX - r.left,
                  e.clientY - r.top,
                  r.width,
                  r.height,
                  camera.current,
                ),
              );
            }
            return;
          }
          if (e.pointerId !== d.pointerId) return;
          d.distance = Math.max(
            d.distance,
            Math.hypot(e.clientX - d.x, e.clientY - d.y),
          );
          if (d.preview) {
            if (!disabled && placing && d.distance > 5)
              onPreview({
                x: d.preview.x + Math.round((e.clientX - d.x) / d.tileSize),
                y: d.preview.y + Math.round((e.clientY - d.y) / d.tileSize),
              });
            return;
          }
          if (d.distance > 5) {
            following.current = false;
            camera.current.x =
              d.cx - (e.clientX - d.x) / (24 * camera.current.zoom);
            camera.current.y =
              d.cy - (e.clientY - d.y) / (24 * camera.current.zoom);
          }
        }}
        onPointerUp={(e) => {
          const suppressTap = multiTouch.current;
          endTouch(e.pointerId);
          if (suppressTap) return;
          const d = drag.current;
          if (!d || d.pointerId !== e.pointerId) return;
          drag.current = null;
          d.distance = Math.max(
            d.distance,
            Math.hypot(e.clientX - d.x, e.clientY - d.y),
          );
          if (disabled || e.button !== 0) return;
          if (d.distance > 5) {
            if (d.preview && placing)
              onPreview({
                x: d.preview.x + Math.round((e.clientX - d.x) / d.tileSize),
                y: d.preview.y + Math.round((e.clientY - d.y) / d.tileSize),
              });
            return;
          }
          if (d.preview) {
            // A tap confirms the whole piece, even when grabbing a non-anchor tile.
            onPlace();
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          onPick(
            screenToWorld(
              e.clientX - r.left,
              e.clientY - r.top,
              r.width,
              r.height,
              camera.current,
            ),
          );
        }}
        onPointerCancel={(e) => {
          endTouch(e.pointerId);
          drag.current = null;
        }}
        onLostPointerCapture={(e) => {
          endTouch(e.pointerId);
          if (drag.current?.pointerId === e.pointerId) drag.current = null;
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          const direction = (
            {
              ArrowRight: [1, 0],
              ArrowLeft: [-1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            } as Record<string, number[]>
          )[e.key];
          if (direction) {
            e.preventDefault();
            const [dx, dy] = direction;
            if (placing && ghost)
              onPreview({ x: ghost.x + dx, y: ghost.y + dy });
            else if (!placing && performance.now() - lastMove.current > 140) {
              lastMove.current = performance.now();
              onMove(dx, dy);
            }
          }
          if (e.key.toLowerCase() === "r") {
            e.preventDefault();
            onRotate();
          }
          if (e.key === "Enter") {
            e.preventDefault();
            onPlace();
          }
        }}
      />
      <div className="sector-label">
        <span className="live-dot" /> SECTOR 04 <span> / </span> THE FARFIELD
      </div>
      <div className="map-controls">
        <button
          aria-label="Zoom out"
          onClick={() => setCameraZoom(camera.current.zoom / 1.2)}
        >
          −
        </button>
        <span>{zoom}%</span>
        <button
          aria-label="Zoom in"
          onClick={() => setCameraZoom(camera.current.zoom * 1.2)}
        >
          +
        </button>
        <button
          aria-label="Center station"
          onClick={() => {
            following.current = false;
            camera.current.x = state.spawn?.x ?? 0;
            camera.current.y = state.spawn?.y ?? 0;
            setCameraZoom(innerWidth > 900 ? 1.5 : 1);
          }}
        >
          ◎
        </button>
        <button
          aria-label="View entire sector"
          onClick={() => {
            following.current = false;
            camera.current.x = 0;
            camera.current.y = 0;
            const r = canvas.current!.getBoundingClientRect();
            setCameraZoom(Math.min(r.width, r.height) / (84 * 24));
          }}
        >
          ⤢
        </button>
      </div>
      <div className="map-coordinates">
        {ghost
          ? `X ${ghost.x.toString().padStart(3, "0")} · Y ${ghost.y.toString().padStart(3, "0")}`
          : null}
      </div>
      <div className="compass" aria-hidden="true">
        N<br />↑
      </div>
    </div>
  );
}
