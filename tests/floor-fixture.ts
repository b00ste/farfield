import type { State, Point } from "../games/farfield/engine.ts";
/** Deterministic L-shaped floor geometry for movement tests, not gameplay construction. */
export function floorTo(s: State, target: Point, progress = 1) {
  const occupied = new Set(
    s.modules.flatMap((m) => m.cells.map((p) => `${p.x},${p.y}`)),
  );
  const cells: Point[] = [];
  let x = s.spawn?.x ?? -1,
    y = s.spawn?.y ?? -1;
  const add = () => {
    if (!occupied.has(`${x},${y}`)) cells.push({ x, y });
  };
  while (x !== target.x) {
    x += Math.sign(target.x - x);
    add();
  }
  while (y !== target.y) {
    y += Math.sign(target.y - y);
    add();
  }
  const module = {
    id: s.nextId++,
    type: "passage" as const,
    progress,
    cells,
    owner: "test",
  };
  s.modules.push(module);
  return module;
}
