import { Rooms } from "../server/rooms.ts";
import { syncTerrain } from "../server/battlefield.ts";
import {
  createActor,
  resetOrder,
  assignedRoles,
} from "../games/farfield/actors.ts";
import type { Module } from "../games/farfield/engine.ts";
export function battle() {
  const rooms = new Rooms(),
    a = rooms.create("1", 1000, "normal", "custom"),
    b = rooms.join(a.code, "2", 1000);
  rooms.command(a.code, a.token, { type: "start" }, 1000);
  const room = rooms.rooms.get(a.code)!,
    p = room.players[0],
    q = room.players[1];
  room.monoliths!.forEach((m) => {
    m.x = 25;
    m.y = 25;
  });
  room.floor = [
    {
      id: -9,
      type: "passage",
      owner: "neutral",
      wreck: true,
      progress: 1,
      cells: Array.from({ length: 50 }, (_, i) => ({
        x: i % 10,
        y: Math.floor(i / 10) - 2,
      })),
    },
  ];
  Object.assign(p.state.friend, { x: 0, y: 0 });
  resetOrder(p.state.friend, null, "idle");
  const turret: Module = {
    id: 900,
    type: "turret" as const,
    owner: q.id,
    progress: 1,
    hp: 100,
    cells: [
      { x: 4, y: 0 },
      { x: 5, y: 0 },
      { x: 4, y: 1 },
      { x: 5, y: 1 },
    ],
  };
  q.state.modules.push(turret);
  q.state.workers = [0, 1].map((i) => {
    const w = {
      ...createActor(),
      id: 901 + i,
      role: "guards" as const,
      x: 4 + i,
      y: 0,
      hp: 60,
      maxHp: 60,
    };
    resetOrder(w, turret.id);
    return w;
  });
  assignedRoles(q.state);
  syncTerrain(room);
  return { rooms, room, a, p, q, turret };
}
