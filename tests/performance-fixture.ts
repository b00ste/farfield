import { Rooms } from "../server/rooms.ts";
import { createActor, assignedRoles } from "../games/farfield/actors.ts";
import { syncTerrain } from "../server/battlefield.ts";
export function crowdedMatch(workers = 64) {
  const rooms = new Rooms();
  const a = rooms.create("7730", 1000, "normal", "custom", [
    "normal",
    "normal",
    "normal",
  ]);
  const room = rooms.rooms.get(a.code)!;
  rooms.command(a.code, a.token, { type: "start" }, 1000);
  for (const p of room.players) {
    p.bot = false;
    p.nextDecision = Infinity;
    const s = p.state,
      origin = s.spawn!,
      sx = -Math.sign(origin.x),
      sy = -Math.sign(origin.y);
    for (let i = 1; i < 120; i++) {
      const x = origin.x + (i % 12) * 2 * sx,
        y = origin.y + Math.floor(i / 12) * 2 * sy;
      s.modules.push({
        id: s.nextId++,
        owner: p.id,
        type: i < 30 ? "habitat" : i < 50 ? "foundry" : "passage",
        cells: [
          { x, y },
          { x: x - sx, y },
          { x, y: y - sy },
          { x: x - sx, y: y - sy },
        ],
        progress: i >= 100 ? 0 : 1,
        hp: 100,
      });
    }
    s.workers = Array.from({ length: workers }, (_, i) => ({
      ...createActor(),
      ...origin,
      id: s.nextId++,
      role: "builders" as const,
      hp: 60,
      maxHp: 60,
      targetId: null,
    }));
    s.alloy = s.energy = s.food = 300;
    assignedRoles(s);
  }
  syncTerrain(room);
  return { rooms, room, a };
}
