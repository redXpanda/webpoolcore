import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { createSunsetPoolHallBakeConfig } from '../src/scenes/sunsetPoolHallBakeData.js';
import { bakeProgressiveLightmaps } from './lightmapper/progressive-lightmapper.mjs';
import { encodeAo, encodeDirection, encodeRgbm } from './lightmapper/lightmap-codec.mjs';
import { generateSunsetPoolHallGlb } from './generate-scene-glb.mjs';
import { readGltfBakeScene } from './lightmapper/gltf-scene-reader.mjs';

const sceneId = 'sunset-pool-hall';
const outputDirectory = path.resolve('public/generated', sceneId);
await mkdir(outputDirectory, { recursive: true });
const generatedScene = await generateSunsetPoolHallGlb(outputDirectory);

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
  return [255, 142, 48, alpha];
}));

const bakeScene = await readGltfBakeScene(
  path.join(outputDirectory, 'scene.glb'),
  createSunsetPoolHallBakeConfig(generatedScene.lightmap),
);
const bakedGi = bakeProgressiveLightmaps(bakeScene, {
  onProgress({ completed, total, samplesPerTexel }) {
    if (completed === 0 || completed === total || completed % 50000 === 0) {
      console.log(`GI trace: ${completed}/${total} texels, ${samplesPerTexel} samples/texel`);
    }
  },
});
await writePng('gi-lightmap.png', bakedGi.width, bakedGi.height, encodeRgbm(bakedGi.lightmap, bakedGi.width, bakedGi.height));
await writePng('gi-direction.png', bakedGi.width, bakedGi.height, encodeDirection(bakedGi.directionMap, bakedGi.width, bakedGi.height));
await writePng('gi-ao.png', bakedGi.width, bakedGi.height, encodeAo(bakedGi.aoMap, bakedGi.width, bakedGi.height));

const eastWindows = [-42, -32, -22, -12, -2, 8, 18, 28];
const westWindows = [-40, -24, -8, 8, 24];
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
