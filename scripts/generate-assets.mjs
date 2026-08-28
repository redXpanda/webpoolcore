import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';

const outputDirectory = path.resolve('public/generated');
await mkdir(outputDirectory, { recursive: true });

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let value = n;
  for (let k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  crcTable[n] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

async function writePng(name, width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    rows[rowOffset] = 0;
    pixels.copy(rows, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  await writeFile(path.join(outputDirectory, name), png);
}

function image(size, sample) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const rgba = sample(x, y);
      pixels[offset] = rgba[0];
      pixels[offset + 1] = rgba[1];
      pixels[offset + 2] = rgba[2];
      pixels[offset + 3] = rgba[3] ?? 255;
    }
  }
  return pixels;
}

const clamp = value => Math.max(0, Math.min(1, value));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const hash = (x, y) => {
  let value = Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
};

const tileSize = 512;
const tileCount = 8;
const cell = tileSize / tileCount;
await writePng('tile-albedo.png', tileSize, tileSize, image(tileSize, (x, y) => {
  const localX = x % cell;
  const localY = y % cell;
  const grout = localX < 2 || localX > cell - 2 || localY < 2 || localY > cell - 2;
  if (grout) return [169, 187, 183, 255];
  const tileX = Math.floor(x / cell);
  const tileY = Math.floor(y / cell);
  const variation = Math.round(hash(tileX, tileY) * 11);
  const sheen = Math.round((localX + localY) / (cell * 2) * 4);
  const value = 235 + variation + sheen;
  return [value - 4, Math.min(255, value + 3), Math.min(255, value + 1), 255];
}));

const heightAt = (x, y) => {
  const wrappedX = ((x % tileSize) + tileSize) % tileSize;
  const wrappedY = ((y % tileSize) + tileSize) % tileSize;
  const localX = wrappedX % cell;
  const localY = wrappedY % cell;
  const distance = Math.min(localX, cell - localX, localY, cell - localY);
  return smoothstep(1.6, 6.5, distance);
};
await writePng('tile-normal.png', tileSize, tileSize, image(tileSize, (x, y) => {
  let nx = -(heightAt(x + 1, y) - heightAt(x - 1, y)) * .9;
  let ny = -(heightAt(x, y + 1) - heightAt(x, y - 1)) * .9;
  let nz = 1;
  const length = Math.hypot(nx, ny, nz);
  nx /= length; ny /= length; nz /= length;
  return [Math.round((nx * .5 + .5) * 255), Math.round((ny * .5 + .5) * 255), Math.round((nz * .5 + .5) * 255), 255];
}));

let seed = 0x8f31a6d5;
const random = () => {
  seed = Math.imul(seed ^ seed >>> 15, 1 | seed);
  seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed);
  return ((seed ^ seed >>> 14) >>> 0) / 4294967296;
};
const waves = Array.from({ length: 18 }, (_, index) => ({
  angle: random() * Math.PI * 2,
  frequency: 1.2 + index * .32 + random() * .7,
  phase: random() * Math.PI * 2,
  amplitude: 1 / (1 + index * .17),
}));
const wetnessAt = (x, y) => {
  const u = x / tileSize * Math.PI * 2;
  const v = y / tileSize * Math.PI * 2;
  let noise = 0;
  let weight = 0;
  for (const wave of waves) {
    const projection = Math.cos(wave.angle) * u + Math.sin(wave.angle) * v;
    noise += Math.sin(projection * wave.frequency + wave.phase) * wave.amplitude;
    weight += wave.amplitude;
  }
  noise = noise / weight * .5 + .5;
  const broad = Math.sin(u * .72 + Math.sin(v * .51)) * .12 + Math.sin(v * .83 - u * .19) * .1;
  return smoothstep(.38, .72, clamp(noise + broad));
};
await writePng('wet-mask.png', tileSize, tileSize, image(tileSize, (x, y) => {
  const value = Math.round(wetnessAt(x, y) * 255);
  return [value, value, value, 255];
}));
await writePng('wet-roughness.png', tileSize, tileSize, image(tileSize, (x, y) => {
  const value = Math.round((1 - wetnessAt(x, y) * .76) * 255);
  return [value, value, value, 255];
}));

await writePng('light-shaft.png', 256, 256, image(256, (x) => {
  const alpha = Math.round(Math.pow(1 - x / 255, 1.6) * 108);
  return [240, 255, 248, alpha];
}));

const giSize = 512;
const windows = [-28, -9, 10];
await writePng('gi-lightmap.png', giSize, giSize, image(giSize, (px, py) => {
  const worldX = px / (giSize - 1) * 92 - 46;
  const worldZ = (1 - py / (giSize - 1)) * 82 - 49;
  const distanceFromWindows = Math.max(0, worldX + 46);
  let sunlight = 0;
  for (const windowZ of windows) {
    const beamCenter = windowZ - distanceFromWindows * .34;
    const lateral = worldZ - beamCenter;
    sunlight += Math.exp(-(lateral * lateral) / 18) * Math.exp(-distanceFromWindows / 38);
  }
  const centralPool = Math.exp(-((worldX * worldX) / 280 + ((worldZ - 2) ** 2) / 380));
  const galleryBounce = Math.exp(-(((worldX + 34) ** 2) / 150 + ((worldZ + 8) ** 2) / 900));
  const ambient = .035;
  const warm = clamp(sunlight * .72);
  const cool = clamp(centralPool * .11 + galleryBounce * .08);
  return [
    Math.round(clamp(ambient + warm + cool * .25) * 255),
    Math.round(clamp(ambient * 1.15 + warm * .78 + cool * .72) * 255),
    Math.round(clamp(ambient * 1.12 + warm * .52 + cool) * 255),
    255,
  ];
}));

// Bake a static room reflection probe. The six images follow Three.js cube-map
// face order and contain only geometry/light information available at build time.
const probeSize = 384;
const probePosition = { x: 0, y: 2.2, z: -8 };
const roomMin = { x: -46, y: 0, z: -49 };
const roomMax = { x: 46, y: 10, z: 33 };
const probeFaces = [
  { name: 'probe-px.png', direction: (u, v) => [1, v, -u] },
  { name: 'probe-nx.png', direction: (u, v) => [-1, v, u] },
  { name: 'probe-py.png', direction: (u, v) => [u, 1, -v] },
  { name: 'probe-ny.png', direction: (u, v) => [u, -1, v] },
  { name: 'probe-pz.png', direction: (u, v) => [u, v, 1] },
  { name: 'probe-nz.png', direction: (u, v) => [-u, v, -1] },
];

function tileLine(a, b, scale = 1) {
  const gridA = Math.abs((a / scale) - Math.round(a / scale));
  const gridB = Math.abs((b / scale) - Math.round(b / scale));
  return smoothstep(.035, .012, Math.min(gridA, gridB));
}

function sampleProbe(direction) {
  const length = Math.hypot(...direction);
  const ray = direction.map(component => component / length);
  let distance = Infinity;
  let surface = '';
  for (const [axis, component] of ['x', 'y', 'z'].map((axis, index) => [axis, ray[index]])) {
    if (Math.abs(component) < 1e-6) continue;
    for (const boundary of [roomMin[axis], roomMax[axis]]) {
      const hitDistance = (boundary - probePosition[axis]) / component;
      if (hitDistance > 0 && hitDistance < distance) {
        const hit = {
          x: probePosition.x + ray[0] * hitDistance,
          y: probePosition.y + ray[1] * hitDistance,
          z: probePosition.z + ray[2] * hitDistance,
        };
        if (hit.x >= roomMin.x - .01 && hit.x <= roomMax.x + .01
          && hit.y >= roomMin.y - .01 && hit.y <= roomMax.y + .01
          && hit.z >= roomMin.z - .01 && hit.z <= roomMax.z + .01) {
          distance = hitDistance;
          surface = `${axis}${boundary === roomMax[axis] ? '+' : '-'}`;
        }
      }
    }
  }

  const hit = {
    x: probePosition.x + ray[0] * distance,
    y: probePosition.y + ray[1] * distance,
    z: probePosition.z + ray[2] * distance,
  };
  let color;
  let grout = 0;
  if (surface === 'y+') {
    color = [40, 54, 52];
    grout = tileLine(hit.x, hit.z, 2);
    const stripX = Math.abs(hit.x) < 4.5 && Math.abs(((hit.z + 39) % 16 + 16) % 16 - 8) < .12;
    const sideStrip = Math.abs(Math.abs(hit.x) - 34) < 3 && Math.abs(((hit.z + 39) % 16 + 16) % 16 - 8) < .12;
    if (stripX || sideStrip) color = [205, 238, 226];
  } else if (surface === 'y-') {
    const inPool = [
      [0, 2, 27, 31], [-36.5, -8, 15, 66], [34, -29, 20, 28],
      [34, 16, 19, 18], [1, -32, 39, 24],
    ].some(([x, z, w, d]) => Math.abs(hit.x - x) < w / 2 && Math.abs(hit.z - z) < d / 2);
    color = inPool ? [25, 105, 107] : [137, 158, 154];
    grout = tileLine(hit.x, hit.z, 1);
  } else {
    color = surface === 'x-' ? [145, 165, 160] : [112, 135, 131];
    const horizontal = surface[0] === 'x' ? hit.z : hit.x;
    grout = tileLine(horizontal, hit.y, 1);
    const isWestWindow = surface === 'x-' && hit.y > 5.35 && hit.y < 8.75
      && [-28, -9, 10].some(center => Math.abs(hit.z - center) < 3.5);
    if (isWestWindow) {
      const frame = Math.abs(hit.y - 7.05) > 1.48
        || [-28, -9, 10].some(center => Math.abs(hit.z - center) < .09);
      color = frame ? [64, 91, 86] : [235, 248, 237];
      grout = 0;
    }
  }

  const distanceFade = clamp(1 - distance / 155);
  const light = .72 + distanceFade * .28;
  return color.map(channel => Math.round(channel * light * (1 - grout * .34)));
}

for (const face of probeFaces) {
  await writePng(face.name, probeSize, probeSize, image(probeSize, (x, y) => {
    const u = (x + .5) / probeSize * 2 - 1;
    const v = 1 - (y + .5) / probeSize * 2;
    return [...sampleProbe(face.direction(u, v)), 255];
  }));
}

console.log(`Generated procedural assets in ${outputDirectory}`);
