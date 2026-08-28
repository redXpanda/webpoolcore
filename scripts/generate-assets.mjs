import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import {
  BAKE_ROOM,
  LIGHTMAP_ATLAS_HEIGHT,
  LIGHTMAP_ATLAS_WIDTH,
  LIGHTMAP_TILE_COLUMNS,
  LIGHTMAP_TILE_SIZE,
  STATIC_BAKE_BOXES,
} from '../src/scenes/sunsetPoolHallBakeData.js';

const sceneId = 'sunset-pool-hall';
const outputDirectory = path.resolve('public/generated', sceneId);
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

function image2d(width, height, sample) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rgba = sample(x, y); const offset = (y * width + x) * 4;
    for (let channel = 0; channel < 4; channel++) pixels[offset + channel] = rgba[channel] ?? 255;
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
  return [255, 142, 48, alpha];
}));

const eastWindows = [-42, -32, -22, -12, -2, 8, 18, 28];
const westWindows = [-40, -24, -8, 8, 24];
const bakeBoxes = STATIC_BAKE_BOXES.map(box => ({
  ...box,
  min: box.position.map((value, axis) => value - box.size[axis] / 2),
  max: box.position.map((value, axis) => value + box.size[axis] / 2),
}));
const hitBox = (origin, direction, box) => {
  let near = -Infinity; let far = Infinity; let hitAxis = 0; let hitSign = 1;
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis]; const d = direction[axis];
    if (Math.abs(d) < 1e-7) { if (o < box.min[axis] || o > box.max[axis]) return null; continue; }
    const a = (box.min[axis] - o) / d; const b = (box.max[axis] - o) / d;
    const axisNear = Math.min(a, b);
    if (axisNear > near) { near = axisNear; hitAxis = axis; hitSign = a < b ? -1 : 1; }
    far = Math.min(far, Math.max(a, b));
    if (near > far || far < 1e-4) return null;
  }
  if (near < 1e-4) return null;
  const normal = [0, 0, 0]; normal[hitAxis] = hitSign;
  return { distance: near, normal, albedo: box.albedo };
};
const mergeBounds = boxes => ({
  min: [0, 1, 2].map(axis => Math.min(...boxes.map(box => box.min[axis]))),
  max: [0, 1, 2].map(axis => Math.max(...boxes.map(box => box.max[axis]))),
});
const buildBvh = boxes => {
  const bounds = mergeBounds(boxes);
  if (boxes.length <= 4) return { ...bounds, boxes };
  const extent = bounds.max.map((value, axis) => value - bounds.min[axis]);
  const axis = extent.indexOf(Math.max(...extent));
  boxes.sort((a, b) => a.position[axis] - b.position[axis]);
  const middle = Math.floor(boxes.length / 2);
  return { ...bounds, left: buildBvh(boxes.slice(0, middle)), right: buildBvh(boxes.slice(middle)) };
};
const hitBounds = (origin, direction, node, maximum = Infinity) => {
  let near = 0; let far = maximum;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-7) { if (origin[axis] < node.min[axis] || origin[axis] > node.max[axis]) return false; continue; }
    const a = (node.min[axis] - origin[axis]) / direction[axis]; const b = (node.max[axis] - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
    if (near > far) return false;
  }
  return true;
};
const bakeBvh = buildBvh([...bakeBoxes]);
const hitBvh = (origin, direction, node, closest = null) => {
  if (!hitBounds(origin, direction, node, closest?.distance)) return closest;
  if (node.boxes) {
    for (const box of node.boxes) {
      const hit = hitBox(origin, direction, box);
      if (hit && (!closest || hit.distance < closest.distance)) closest = hit;
    }
    return closest;
  }
  closest = hitBvh(origin, direction, node.left, closest);
  return hitBvh(origin, direction, node.right, closest);
};
const isSideWindow = (x, y, z) => {
  const west = x < 0; const centers = west ? westWindows : eastWindows; const width = west ? 7.2 : 3.4;
  const center = centers.find(value => Math.abs(z - value) <= width / 2);
  if (center === undefined || y < .58) return false;
  const spring = 8.4 - width / 2;
  return y <= spring || (z - center) ** 2 + (y - spring) ** 2 <= (width / 2) ** 2;
};
const intersectScene = (origin, direction) => {
  let closest = hitBvh(origin, direction, bakeBvh);
  for (let axis = 0; axis < 3; axis++) {
    const boundary = direction[axis] > 0 ? [BAKE_ROOM.maxX, BAKE_ROOM.maxY, BAKE_ROOM.maxZ][axis] : [BAKE_ROOM.minX, BAKE_ROOM.minY, BAKE_ROOM.minZ][axis];
    if (Math.abs(direction[axis]) < 1e-7) continue;
    const distance = (boundary - origin[axis]) / direction[axis];
    if (distance < 1e-4 || (closest && distance >= closest.distance)) continue;
    const point = origin.map((value, i) => value + direction[i] * distance);
    const portal = axis === 0 && isSideWindow(point[0], point[1], point[2]);
    if (portal) return { distance, portal: true };
    const normal = [0, 0, 0]; normal[axis] = direction[axis] > 0 ? -1 : 1;
    closest = { distance, normal, albedo: axis === 1 ? [.3, .27, .22] : [.48, .37, .27] };
  }
  return closest;
};
let bakeSeed = 0x1234abcd;
const bakeRandom = () => ((bakeSeed = Math.imul(bakeSeed ^ bakeSeed >>> 15, 1 | bakeSeed)) >>> 0) / 4294967296;
const cosineDirection = normal => {
  const u = bakeRandom(); const v = bakeRandom(); const phi = Math.PI * 2 * u;
  const local = [Math.cos(phi) * Math.sqrt(v), Math.sin(phi) * Math.sqrt(v), Math.sqrt(1 - v)];
  const up = Math.abs(normal[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
  const tangent = [up[1] * normal[2] - up[2] * normal[1], up[2] * normal[0] - up[0] * normal[2], up[0] * normal[1] - up[1] * normal[0]];
  const length = Math.hypot(...tangent); for (let i = 0; i < 3; i++) tangent[i] /= length;
  const bitangent = [normal[1] * tangent[2] - normal[2] * tangent[1], normal[2] * tangent[0] - normal[0] * tangent[2], normal[0] * tangent[1] - normal[1] * tangent[0]];
  return normal.map((value, i) => tangent[i] * local[0] + bitangent[i] * local[1] + value * local[2]);
};
// HDR exterior sky radiance. Sunset direct light remains orange, while the
// broad sky keeps enough green/blue energy to produce plausible indoor fill.
const sky = [5.2, 4.1, 3.0];
const portals = [
  ...westWindows.map(z => ({ x: BAKE_ROOM.minX, z, width: 7.2, normal: [1, 0, 0] })),
  ...eastWindows.map(z => ({ x: BAKE_ROOM.maxX, z, width: 3.4, normal: [-1, 0, 0] })),
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const samplePortal = (origin, normal) => {
  const portal = portals[Math.floor(bakeRandom() * portals.length)];
  const spring = 8.4 - portal.width / 2;
  const target = [portal.x, .58 + bakeRandom() * (spring - .58), portal.z + (bakeRandom() - .5) * portal.width];
  const vector = target.map((value, axis) => value - origin[axis]);
  const distanceSquared = dot(vector, vector); const distance = Math.sqrt(distanceSquared);
  const direction = vector.map(value => value / distance);
  const surfaceCosine = Math.max(0, dot(normal, direction));
  const portalCosine = Math.max(0, -dot(portal.normal, direction));
  if (surfaceCosine === 0 || portalCosine === 0) return { color: [0, 0, 0], direction };
  const hit = intersectScene(origin.map((value, axis) => value + normal[axis] * .003), direction);
  if (!hit?.portal || Math.abs(hit.distance - distance) > .08) return { color: [0, 0, 0], direction };
  const area = portal.width * (spring - .58);
  const weight = portals.length * area * surfaceCosine * portalCosine / Math.max(distanceSquared, .25);
  return { color: sky.map(value => value * weight), direction };
};
const trace = (origin, normal, depth) => {
  const direct = samplePortal(origin, normal).color;
  if (depth === 1) return direct;
  const direction = cosineDirection(normal);
  const hit = intersectScene(origin.map((value, i) => value + normal[i] * .003), direction);
  if (!hit || hit.portal) return direct;
  const point = origin.map((value, i) => value + direction[i] * hit.distance);
  const incoming = trace(point, hit.normal, depth - 1);
  return direct.map((value, channel) => value + incoming[channel] * hit.albedo[channel]);
};
const faceAxes = [[2, 1], [2, 1], [0, 2], [0, 2], [0, 1], [0, 1]];
const faceNormals = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const lightmap = new Float32Array(LIGHTMAP_ATLAS_WIDTH * LIGHTMAP_ATLAS_HEIGHT * 3);
const directionMap = new Float32Array(LIGHTMAP_ATLAS_WIDTH * LIGHTMAP_ATLAS_HEIGHT * 3);
const aoMap = new Float32Array(LIGHTMAP_ATLAS_WIDTH * LIGHTMAP_ATLAS_HEIGHT).fill(1);
const progressivePasses = 6;
const samplesPerPass = 8;
const samplesPerTexel = progressivePasses * samplesPerPass;
const luminance = color => color[0] * .2126 + color[1] * .7152 + color[2] * .0722;
const bakeTexel = (point, normal, pixelOffset) => {
  const sum = [0, 0, 0]; const moment = [0, 0, 0]; let ao = 0;
  for (let pass = 0; pass < progressivePasses; pass++) for (let sample = 0; sample < samplesPerPass; sample++) {
    const direct = samplePortal(point, normal);
    const bounceDirection = cosineDirection(normal);
    const hit = intersectScene(point.map((value, axis) => value + normal[axis] * .003), bounceDirection);
    let indirect = [0, 0, 0];
    if (hit && !hit.portal) {
      const bouncePoint = point.map((value, axis) => value + bounceDirection[axis] * hit.distance);
      indirect = trace(bouncePoint, hit.normal, 2).map((value, channel) => value * hit.albedo[channel]);
    }
    const color = direct.color.map((value, channel) => value + indirect[channel]);
    for (let channel = 0; channel < 3; channel++) {
      sum[channel] += color[channel] / samplesPerTexel;
      moment[channel] += (direct.direction[channel] * luminance(direct.color) + bounceDirection[channel] * luminance(indirect)) / samplesPerTexel;
    }
    ao += (!hit || hit.portal ? 1 : Math.min(hit.distance / 4, 1)) / samplesPerTexel;
  }
  const momentLength = Math.hypot(...moment);
  for (let channel = 0; channel < 3; channel++) {
    lightmap[pixelOffset * 3 + channel] = sum[channel];
    directionMap[pixelOffset * 3 + channel] = momentLength > 1e-6 ? moment[channel] / momentLength : normal[channel];
  }
  aoMap[pixelOffset] = ao;
};
for (let boxIndex = 0; boxIndex < bakeBoxes.length; boxIndex++) for (let face = 0; face < 6; face++) {
  const box = bakeBoxes[boxIndex]; const tile = boxIndex * 6 + face;
  const tileX = tile % LIGHTMAP_TILE_COLUMNS * LIGHTMAP_TILE_SIZE;
  const tileY = Math.floor(tile / LIGHTMAP_TILE_COLUMNS) * LIGHTMAP_TILE_SIZE;
  const normal = faceNormals[face]; const normalAxis = Math.floor(face / 2); const axes = faceAxes[face];
  for (let y = 1; y < LIGHTMAP_TILE_SIZE - 1; y++) for (let x = 1; x < LIGHTMAP_TILE_SIZE - 1; x++) {
    const point = [...box.position];
    point[normalAxis] += normal[normalAxis] * box.size[normalAxis] / 2;
    point[axes[0]] += (x / (LIGHTMAP_TILE_SIZE - 1) - .5) * box.size[axes[0]];
    point[axes[1]] += (y / (LIGHTMAP_TILE_SIZE - 1) - .5) * box.size[axes[1]];
    const py = LIGHTMAP_ATLAS_HEIGHT - 1 - (tileY + y);
    bakeTexel(point, normal, py * LIGHTMAP_ATLAS_WIDTH + tileX + x);
  }
}
for (let side = 0; side < 2; side++) {
  const tile = bakeBoxes.length * 6 + side;
  const tileX = tile % LIGHTMAP_TILE_COLUMNS * LIGHTMAP_TILE_SIZE;
  const tileY = Math.floor(tile / LIGHTMAP_TILE_COLUMNS) * LIGHTMAP_TILE_SIZE;
  const normal = side === 0 ? [1, 0, 0] : [-1, 0, 0];
  for (let y = 1; y < LIGHTMAP_TILE_SIZE - 1; y++) for (let x = 1; x < LIGHTMAP_TILE_SIZE - 1; x++) {
    const localX = (x / (LIGHTMAP_TILE_SIZE - 1) - .5) * 84;
    const point = [side === 0 ? BAKE_ROOM.minX : BAKE_ROOM.maxX, y / (LIGHTMAP_TILE_SIZE - 1) * BAKE_ROOM.maxY, -8 + (side === 0 ? -localX : localX)];
    const py = LIGHTMAP_ATLAS_HEIGHT - 1 - (tileY + y);
    bakeTexel(point, normal, py * LIGHTMAP_ATLAS_WIDTH + tileX + x);
  }
}
// Denoise independently inside each chart so unrelated UV islands never bleed.
for (let iteration = 0; iteration < 3; iteration++) {
  const source = lightmap.slice();
  const sourceDirection = directionMap.slice();
  const sourceAo = aoMap.slice();
  for (let tile = 0; tile < bakeBoxes.length * 6 + 2; tile++) {
    const tx = tile % LIGHTMAP_TILE_COLUMNS * LIGHTMAP_TILE_SIZE;
    const ty = LIGHTMAP_ATLAS_HEIGHT - (Math.floor(tile / LIGHTMAP_TILE_COLUMNS) + 1) * LIGHTMAP_TILE_SIZE;
    for (let y = 1; y < LIGHTMAP_TILE_SIZE - 1; y++) for (let x = 1; x < LIGHTMAP_TILE_SIZE - 1; x++) {
      const target = ((ty + y) * LIGHTMAP_ATLAS_WIDTH + tx + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0; let directionSum = 0; let weight = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const spatial = ox === 0 && oy === 0 ? 4 : ox === 0 || oy === 0 ? 2 : 1;
          const neighbor = ((ty + y + oy) * LIGHTMAP_ATLAS_WIDTH + tx + x + ox) * 3 + channel;
          sum += source[neighbor] * spatial;
          directionSum += sourceDirection[neighbor] * spatial;
          weight += spatial;
        }
        lightmap[target + channel] = sum / weight;
        directionMap[target + channel] = directionSum / weight;
      }
      const pixel = target / 3; let aoSum = 0; let aoWeight = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const spatial = ox === 0 && oy === 0 ? 4 : ox === 0 || oy === 0 ? 2 : 1;
        aoSum += sourceAo[(ty + y + oy) * LIGHTMAP_ATLAS_WIDTH + tx + x + ox] * spatial; aoWeight += spatial;
      }
      aoMap[pixel] = aoSum / aoWeight;
    }
  }
}
// Pad chart borders to prevent bilinear and mip-map bleeding.
for (let tile = 0; tile < bakeBoxes.length * 6 + 2; tile++) {
  const tx = tile % LIGHTMAP_TILE_COLUMNS * LIGHTMAP_TILE_SIZE;
  const ty = LIGHTMAP_ATLAS_HEIGHT - (Math.floor(tile / LIGHTMAP_TILE_COLUMNS) + 1) * LIGHTMAP_TILE_SIZE;
  for (let i = 1; i < LIGHTMAP_TILE_SIZE - 1; i++) for (const [x, y, sx, sy] of [[0, i, 1, i], [LIGHTMAP_TILE_SIZE - 1, i, LIGHTMAP_TILE_SIZE - 2, i], [i, 0, i, 1], [i, LIGHTMAP_TILE_SIZE - 1, i, LIGHTMAP_TILE_SIZE - 2]]) {
    const target = (ty + y) * LIGHTMAP_ATLAS_WIDTH + tx + x; const source = (ty + sy) * LIGHTMAP_ATLAS_WIDTH + tx + sx;
    for (let c = 0; c < 3; c++) {
      lightmap[target * 3 + c] = lightmap[source * 3 + c];
      directionMap[target * 3 + c] = directionMap[source * 3 + c];
    }
    aoMap[target] = aoMap[source];
  }
}
await writePng('gi-lightmap.png', LIGHTMAP_ATLAS_WIDTH, LIGHTMAP_ATLAS_HEIGHT, image2d(LIGHTMAP_ATLAS_WIDTH, LIGHTMAP_ATLAS_HEIGHT, (x, y) => {
  const offset = (y * LIGHTMAP_ATLAS_WIDTH + x) * 3;
  const maximum = Math.max(lightmap[offset], lightmap[offset + 1], lightmap[offset + 2], 1e-6);
  const multiplier = Math.min(1, Math.ceil(Math.min(maximum / 8, 1) * 255) / 255);
  return [0, 1, 2].map(channel => Math.round(clamp(lightmap[offset + channel] / (multiplier * 8)) * 255)).concat(Math.round(multiplier * 255));
}));
await writePng('gi-direction.png', LIGHTMAP_ATLAS_WIDTH, LIGHTMAP_ATLAS_HEIGHT, image2d(LIGHTMAP_ATLAS_WIDTH, LIGHTMAP_ATLAS_HEIGHT, (x, y) => {
  const offset = (y * LIGHTMAP_ATLAS_WIDTH + x) * 3;
  return [0, 1, 2].map(channel => Math.round(clamp(directionMap[offset + channel] * .5 + .5) * 255)).concat(255);
}));
await writePng('gi-ao.png', LIGHTMAP_ATLAS_WIDTH, LIGHTMAP_ATLAS_HEIGHT, image2d(LIGHTMAP_ATLAS_WIDTH, LIGHTMAP_ATLAS_HEIGHT, (x, y) => {
  const value = Math.round(clamp(aoMap[y * LIGHTMAP_ATLAS_WIDTH + x]) * 255);
  return [value, value, value, 255];
}));

const causticShadowSize = 512;
const sunSlopeY = .2 / .86;
const sunSlopeZ = .46 / .86;
const columnCenters = [-42, -28.4, -14.8, -1.2, 12.4, 26];
await writePng('caustic-shadow.png', causticShadowSize, causticShadowSize, image(causticShadowSize, (px, py) => {
  const worldX = px / (causticShadowSize - 1) * 64 - 32;
  const worldZ = (1 - py / (causticShadowSize - 1)) * 84 - 50;
  const distanceToEastWall = 32 - worldX;
  const wallY = -.8 + distanceToEastWall * sunSlopeY;
  const wallZ = worldZ + distanceToEastWall * sunSlopeZ;
  let windowLight = 0;
  for (const centerZ of eastWindows) {
    const horizontal = Math.abs(wallZ - centerZ);
    const archRadius = 1.7;
    const archSpring = 8.4 - archRadius;
    const inBody = wallY >= .58 && wallY <= archSpring;
    const inArch = wallY > archSpring
      && horizontal * horizontal + (wallY - archSpring) ** 2 <= archRadius * archRadius;
    if (inBody || inArch) {
      const edge = 1 - smoothstep(1.25, 1.72, horizontal);
      windowLight = Math.max(windowLight, edge);
    }
  }

  let columnVisibility = 1;
  if (worldX < 26.8) {
    const distancePastColumns = 26.8 - worldX;
    for (const columnZ of columnCenters) {
      const shadowCenter = columnZ - distancePastColumns * sunSlopeZ;
      const halfWidth = .72 + distancePastColumns * .018;
      const shadow = 1 - smoothstep(halfWidth, halfWidth + .5, Math.abs(worldZ - shadowCenter));
      columnVisibility *= 1 - shadow * .92;
    }
  }

  const indirect = .16 + .18 * Math.exp(-distanceToEastWall / 30);
  const value = Math.round(clamp(indirect + windowLight * columnVisibility * .92) * 255);
  return [value, value, value, 255];
}));

// Bake a static room reflection probe. The six images follow Three.js cube-map
// face order and contain only geometry/light information available at build time.
const probeSize = 384;
const probePosition = { x: 0, y: 1.6, z: -8 };
const roomMin = { x: -32, y: 0, z: -50 };
const roomMax = { x: 32, y: 9.5, z: 34 };
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
    color = [55, 45, 36];
    grout = tileLine(hit.x, hit.z, 2);
    const beam = Math.abs(((hit.z + 44) % 12 + 12) % 12) < .7;
    if (beam) color = [36, 29, 24];
  } else if (surface === 'y-') {
    const inPool = Math.abs(hit.x) < 28.5 && hit.z > -46.5 && hit.z < 30.5;
    color = inPool ? [17, 68, 65] : [105, 91, 73];
    grout = tileLine(hit.x, hit.z, 1);
  } else {
    color = surface[0] === 'x' ? [111, 82, 61] : [87, 68, 54];
    const horizontal = surface[0] === 'x' ? hit.z : hit.x;
    grout = tileLine(horizontal, hit.y, 1);
    const sideWindows = surface === 'x-' ? westWindows : eastWindows;
    const windowWidth = surface === 'x-' ? 7.2 : 3.4;
    const archSpring = 8.4 - windowWidth / 2;
    const nearestWindow = sideWindows.find(center => Math.abs(hit.z - center) < windowWidth / 2);
    const horizontalDistance = nearestWindow === undefined ? Infinity : Math.abs(hit.z - nearestWindow);
    const inWindowBody = hit.y > .58 && hit.y <= archSpring;
    const inWindowArch = hit.y > archSpring
      && horizontalDistance * horizontalDistance + (hit.y - archSpring) ** 2 < (windowWidth / 2) ** 2;
    const isSideWindow = surface[0] === 'x' && nearestWindow !== undefined && (inWindowBody || inWindowArch);
    const isFarWindow = surface === 'z-' && hit.y > .65 && hit.y < 8.05
      && [-29.5, -22.5, -13, -.5, 12, 22, 29.5].every(column => Math.abs(hit.x - column) > .72);
    if (isSideWindow || isFarWindow) {
      color = isSideWindow ? [232, 102, 24] : [167, 111, 65];
      grout = 0;
    }
  }

  const distanceFade = clamp(1 - distance / 125);
  const light = .68 + distanceFade * .32;
  return color.map(channel => Math.round(channel * light * (1 - grout * .34)));
}

for (const face of probeFaces) {
  await writePng(face.name, probeSize, probeSize, image(probeSize, (x, y) => {
    const u = (x + .5) / probeSize * 2 - 1;
    const v = 1 - (y + .5) / probeSize * 2;
    return [...sampleProbe(face.direction(u, v)), 255];
  }));
}

console.log(`Generated procedural assets for ${sceneId} in ${outputDirectory}`);
