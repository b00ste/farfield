import { mkdir, readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

// The icon uses the game's original station tiles, with a mask-safe silhouette.
// Generate PNGs directly from this geometry; no downloaded artwork or build deps.
const tiles = [
  [2, 0, "#e6cb72"],
  [1, 1, "#8698a6"],
  [2, 1, "#e6cb72"],
  [3, 1, "#8698a6"],
  [0, 2, "#d8a27e"],
  [1, 2, "#d8a27e"],
  [2, 2, "#e3e7c4"],
  [3, 2, "#8698a6"],
  [4, 2, "#cb8495"],
  [1, 3, "#8698a6"],
  [2, 3, "#91b7a0"],
  [3, 3, "#cb8495"],
  [2, 4, "#91b7a0"],
];
const rects = [
  [0, 0, 512, 512, "#0a151e"],
  ...tiles.map(([x, y, color]) => [104 + x * 62, 104 + y * 62, 56, 56, color]),
];
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const name = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (const [x, y, width, height, color] of rects) {
    const rgb = color
      .slice(1)
      .match(/../g)
      .map((hex) => parseInt(hex, 16));
    for (
      let py = Math.round((y * size) / 512);
      py < Math.round(((y + height) * size) / 512);
      py++
    ) {
      for (
        let px = Math.round((x * size) / 512);
        px < Math.round(((x + width) * size) / 512);
        px++
      ) {
        const offset = py * (size * 4 + 1) + 1 + px * 4;
        raw.set([...rgb, 255], offset);
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export async function buildPwa(output, version) {
  await mkdir(`${output}/icons`, { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${rects.map(([x, y, width, height, fill]) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`).join("")}</svg>`;
  await Promise.all([
    writeFile(`${output}/icons/icon.svg`, svg),
    ...[
      [192, "icon-192"],
      [512, "icon-512"],
      [512, "icon-maskable-512"],
      [180, "apple-touch-icon"],
    ].map(([size, name]) =>
      writeFile(`${output}/icons/${name}.png`, png(size)),
    ),
    ...["manifest.webmanifest", "offline.html"].map(async (file) =>
      writeFile(`${output}/${file}`, await readFile(`host/${file}`)),
    ),
    readFile("host/service-worker.js", "utf8").then((source) =>
      writeFile(
        `${output}/service-worker.js`,
        source.replace("__BUILD__", version),
      ),
    ),
  ]);
}
