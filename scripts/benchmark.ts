import { performance } from "node:perf_hooks";
import { crowdedMatch } from "../tests/performance-fixture.ts";
const { rooms, room, a } = crowdedMatch();
const samples = [];
for (let i = 0; i < 80; i++) {
  const start = performance.now();
  rooms.advance(0.1, 1000);
  rooms.view(room, a.token, 1000);
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    players: 4,
    modules: 480,
    workers: 256,
    meanMs: samples.reduce((a, b) => a + b) / samples.length,
    p95Ms: samples[Math.floor(samples.length * 0.95)],
    snapshotBytes: JSON.stringify(rooms.view(room, a.token, 1000)).length,
  }),
);
