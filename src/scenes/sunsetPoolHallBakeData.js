export const BAKE_ROOM = { minX: -32, maxX: 32, minY: 0, maxY: 9.5, minZ: -50, maxZ: 34 };

export function createStaticBakeBoxes() {
  const boxes = [];
  const add = (name, size, position, albedo = [.48, .37, .27]) => boxes.push({ name, size, position, albedo });
  const pool = { x: 0, z: -8, width: 57, depth: 77 };
  const sideDeckWidth = 3.5;
  const endDeckDepth = 3.5;
  for (const [x, z, width, depth] of [
    [-30.25, -8, sideDeckWidth, 84], [30.25, -8, sideDeckWidth, 84],
    [0, -48.25, pool.width, endDeckDepth], [0, 32.25, pool.width, endDeckDepth],
  ]) add('wet-deck', [width, .4, depth], [x, -.2, z], [.42, .36, .28]);
  add('pool-bottom', [57, .4, 77], [0, -49.78, -8], [.25, .36, .33]);
  add('pool-wall-west', [.35, 50, 77], [-28.5, -24.58, -8]);
  add('pool-wall-east', [.35, 50, 77], [28.5, -24.58, -8]);
  add('pool-wall-north', [57, 50, .35], [0, -24.58, -46.5]);
  add('pool-wall-south', [57, 50, .35], [0, -24.58, 30.5]);
  add('pool-rim-west', [1, .62, 77], [-29, .31, -8]);
  add('pool-rim-east', [1, .62, 77], [29, .31, -8]);
  add('pool-rim-north', [59, .62, 1], [0, .31, -47]);
  add('pool-rim-south', [59, .62, 1], [0, .31, 31]);
  add('ceiling', [64, .5, 84], [0, 9.75, -8], [.24, .2, .16]);
  for (let z = -44; z <= 28; z += 12) add('ceiling-beam', [64, .72, 1.35], [0, 8.92, z], [.24, .2, .16]);
  for (const x of [-26.8, 26.8]) {
    for (let z = -42; z <= 26; z += 13.6) add('colonnade', [1.45, 8.6, 1.65], [x, 4.3, z]);
    add('colonnade-lintel', [1.7, 1.15, 82], [x, 8.45, -8], [.24, .2, .16]);
  }
  add('far-wall-lower', [64, .65, .7], [0, .325, -50]);
  add('far-wall-upper', [64, 1.45, .7], [0, 8.775, -50]);
  for (const x of [-32, -27, -18, -8, 7, 17, 27, 32]) add('far-window-column', [1.15, 8.1, .7], [x, 4.45, -50]);
  add('near-wall', [64, 9.5, .7], [0, 4.75, 34]);
  for (const [name, size, position] of [
    ['submerged-shelf-a', [18, .75, 16], [-9, -.72, -2]],
    ['submerged-shelf-b', [16, .55, 20], [11, -1.1, -20]],
    ['submerged-shelf-c', [13, .45, 13], [-12, -1.55, -33]],
    ['submerged-shelf-foreground', [52, .5, 44], [0, -1.02, 12]],
  ]) add(name, size, position, [.25, .36, .33]);
  for (let step = 0; step < 5; step++) add(`submerged-step-${step}`, [14, .28, 2.2], [15, -.05 - step * .22, 22 - step * 2.05], [.25, .36, .33]);
  return boxes;
}

export const STATIC_BAKE_BOXES = createStaticBakeBoxes();

export function createSunsetPoolHallBakeConfig(lightmap) {
  const radiance = [5.2, 4.1, 3.0];
  const lights = [];
  for (const [x, centers, width, normal] of [
    [BAKE_ROOM.minX, [-40, -24, -8, 8, 24], 7.2, [1, 0, 0]],
    [BAKE_ROOM.maxX, [-42, -32, -22, -12, -2, 8, 18, 28], 3.4, [-1, 0, 0]],
  ]) {
    const spring = 8.4 - width / 2;
    const height = spring - .58;
    for (const z of centers) lights.push({
      type: 'rectangle',
      center: [x, .58 + height / 2, z],
      axisU: [0, 0, width],
      axisV: [0, height, 0],
      normal: [...normal],
      area: width * height,
      radiance: [...radiance],
    });
  }
  return {
    lights,
    materials: {
      tile: { albedo: [.62, .57, .49], doubleSided: false },
      wall: { albedo: [.34, .25, .18], doubleSided: false },
      ceiling: { albedo: [.18, .15, .12], doubleSided: false },
      submerged: { albedo: [.28, .39, .36], doubleSided: false },
      wetFloor: { albedo: [.42, .36, .28], doubleSided: false },
    },
    atlas: { width: lightmap.width, height: lightmap.height, padding: 4 },
    settings: {
      progressivePasses: 2,
      samplesPerPass: 8,
      bounces: 3,
      aoDistance: 4,
      denoiseIterations: 3,
      rayEpsilon: .003,
      seed: 0x1234abcd,
    },
  };
}
