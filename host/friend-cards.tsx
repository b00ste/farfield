import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OwnedFriend } from "@rarefriends/friendsdk/owned";
import type { createGenerationSpriteReader } from "@rarefriends/friendsdk/sprites";
type Reader = ReturnType<typeof createGenerationSpriteReader>;
type Sprites = Awaited<ReturnType<Reader["read"]>>;

function FriendPortrait({ rows }: { rows: readonly string[] }) {
  return (
    <svg viewBox="0 0 20 20" shapeRendering="crispEdges" aria-hidden="true">
      {rows.flatMap((row, y) =>
        [...row].flatMap((pixel, x) =>
          pixel === "#"
            ? [
                <rect
                  key={`${x},${y}`}
                  x={x + 2}
                  y={y + 2}
                  width="1"
                  height="1"
                  fill="currentColor"
                />,
              ]
            : [],
        ),
      )}
    </svg>
  );
}
function RosterFriend({
  friend,
  reader,
  inspected,
  onInspect,
}: {
  friend: OwnedFriend;
  reader: Reader;
  inspected: boolean;
  onInspect: (id: bigint) => void;
}) {
  const art = useQuery({
    queryKey: ["friend-art", String(friend.id)],
    queryFn: () => reader.read(friend.id),
    staleTime: Infinity,
    retry: 1,
  });
  const rows =
    art.data?.clips.idle[art.data.familyId === 6 ? "right" : "down"][0].rows;
  return (
    <button
      className="roster-friend"
      aria-pressed={inspected}
      onClick={() => onInspect(friend.id)}
      aria-label={`Inspect Friend #${friend.id}${art.data ? `, ${art.data.familyName}` : ""}`}
    >
      <span className="roster-sprite">
        {rows ? (
          <FriendPortrait rows={rows} />
        ) : (
          <span>{art.isError ? "Art unavailable" : "…"}</span>
        )}
      </span>
      <strong>#{String(friend.id)}</strong>
    </button>
  );
}
/** Only this canvas animates; the collection and query consumers stay still. */
function AnimatedPortrait({
  art,
  motion,
  reduced,
}: {
  art: Sprites;
  motion: "idle" | "walk";
  reduced: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const frames = art.clips[motion][art.familyId === 6 ? "right" : "down"];
    let animation = 0,
      previous = -1;
    const start = performance.now();
    const draw = (now: number) => {
      const frame = reduced
        ? 0
        : Math.floor(Math.max(0, now - start) / 140) % frames.length;
      if (previous !== frame && !document.hidden) {
        ctx.clearRect(0, 0, 20, 20);
        ctx.fillStyle = "#d8e6ce";
        frames[frame].rows.forEach((row, y) =>
          [...row].forEach((pixel, x) => {
            if (pixel === "#") ctx.fillRect(x + 2, y + 2, 1, 1);
          }),
        );
        previous = frame;
      }
      if (!reduced) animation = requestAnimationFrame(draw);
    };
    draw(start);
    return () => cancelAnimationFrame(animation);
  }, [art, motion, reduced]);
  return (
    <canvas
      ref={canvas}
      width={20}
      height={20}
      aria-label={`${art.familyName} ${motion} animation`}
      role="img"
    />
  );
}
export function CommanderScreen({
  friends,
  reader,
  selectedId,
  onSelect,
  onBack,
  reduced = false,
  status,
  onRetry,
  onReconnect,
}: {
  friends: readonly OwnedFriend[];
  reader: Reader;
  selectedId?: bigint;
  onSelect: (id: bigint) => void;
  onBack: () => void;
  reduced?: boolean;
  status: "loading" | "error" | "ready" | "disconnected";
  onRetry: () => void;
  onReconnect: () => void;
}) {
  const [inspectedId, setInspectedId] = useState(selectedId ?? friends[0]?.id);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [motion, setMotion] = useState<"idle" | "walk">("idle");
  const roster = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 3, rows: 2 });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const columns = Math.max(
        2,
        Math.min(6, Math.floor(width / (width < 500 ? 94 : 140))),
      );
      const rows = Math.max(
        1,
        Math.min(4, Math.floor(height / (width < 500 ? 104 : 148))),
      );
      setLayout((current) =>
        current.columns === columns && current.rows === rows
          ? current
          : { columns, rows },
      );
    });
    if (roster.current) observer.observe(roster.current);
    return () => observer.disconnect();
  }, []);
  const inspected =
    friends.find((f) => f.id === inspectedId) ??
    friends.find((f) => f.id === selectedId) ??
    friends[0];
  const art = useQuery({
    queryKey: ["friend-art", String(inspected?.id)],
    queryFn: () => reader.read(inspected!.id),
    enabled: !!inspected,
    staleTime: Infinity,
    retry: 1,
  });
  const shown = friends.filter((f) =>
    String(f.id).includes(search.trim().replace(/^#/, "")),
  );
  const pageSize = layout.columns * layout.rows,
    pages = Math.max(1, Math.ceil(shown.length / pageSize)),
    currentPage = Math.min(page, pages - 1);
  return (
    <section className="commander-screen" aria-label="Your commanders">
      <header>
        <button aria-label="Back to main menu" onClick={onBack}>
          ← Back
        </button>
        <h1>Your Friends</h1>
        <span>
          {status === "loading"
            ? "Loading…"
            : status === "ready"
              ? `${friends.length} Friends`
              : ""}
        </span>
      </header>
      <div className="commander-browser" aria-busy={status === "loading"}>
        <div className="commander-collection">
          <label className="friend-search">
            <input
              aria-label="Find a Friend"
              placeholder="Find a Friend by number"
              inputMode="numeric"
              disabled={status !== "ready" || !friends.length}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <div
            ref={roster}
            className="commander-roster"
            style={{
              gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
            }}
          >
            {shown
              .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
              .map((f) => (
                <RosterFriend
                  key={String(f.id)}
                  friend={f}
                  reader={reader}
                  inspected={f.id === inspected?.id}
                  onInspect={setInspectedId}
                />
              ))}
            {status === "loading" ? (
              <div className="roster-message roster-loading" role="status">
                <span className="loading-signal" aria-hidden="true">
                  ✦
                </span>
                <p>Loading your Friends…</p>
              </div>
            ) : status === "error" ? (
              <div className="roster-message" role="alert">
                <p>Couldn’t load your Friends.</p>
                <button onClick={onRetry}>Retry loading Friends</button>
              </div>
            ) : status === "disconnected" ? (
              <div className="roster-message">
                <p>Connect your wallet to view your Friends.</p>
                <button onClick={onReconnect}>Reconnect wallet</button>
              </div>
            ) : !friends.length ? (
              <div className="roster-message" role="status">
                <p>No eligible Friends in this wallet.</p>
                <button onClick={onRetry}>Refresh Friends</button>
              </div>
            ) : !shown.length ? (
              <div className="roster-message" role="status">
                No Friend matches that number.
              </div>
            ) : null}
          </div>
          <nav
            className="commander-pages"
            aria-label="Friend pages"
            hidden={status !== "ready" || !friends.length}
          >
            <button
              aria-label="Previous Friends"
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
            >
              ←
            </button>
            <span>
              {currentPage + 1} / {pages}
            </span>
            <button
              aria-label="Next Friends"
              disabled={currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              →
            </button>
          </nav>
        </div>
        <aside className="commander-inspect" aria-label="Friend details">
          {status === "ready" && inspected ? (
            <>
              <div className="commander-portrait">
                {art.data ? (
                  <AnimatedPortrait
                    art={art.data}
                    motion={motion}
                    reduced={reduced}
                  />
                ) : (
                  <span>
                    {art.isError ? "Portrait unavailable" : "Loading Friend…"}
                  </span>
                )}
              </div>
              <div className="commander-identity">
                <span className="commander-type" data-testid="friend-type">
                  TYPE ·{" "}
                  {art.data?.familyName ??
                    (art.isError ? "Unavailable" : "Loading…")}
                </span>
                <h2>Friend #{String(inspected.id)}</h2>
                <p>Generation {inspected.generation}</p>
              </div>
              <div
                className="commander-motion"
                role="group"
                aria-label="Animation"
              >
                <button
                  aria-pressed={motion === "idle"}
                  onClick={() => setMotion("idle")}
                >
                  Idle
                </button>
                <button
                  aria-pressed={motion === "walk"}
                  onClick={() => setMotion("walk")}
                >
                  Walk
                </button>
              </div>
              <button
                className="play-button"
                onClick={() => onSelect(inspected.id)}
              >
                {selectedId === inspected.id
                  ? "Keep commander"
                  : "Select commander"}{" "}
                →
              </button>
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
