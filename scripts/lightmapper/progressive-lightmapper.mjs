import { buildTriangleBvh, intersectTriangleBvh } from './triangle-bvh.mjs';
import { rasterizeLightmapTexels } from './lightmap-rasterizer.mjs';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const luminance = color => color[0] * .2126 + color[1] * .7152 + color[2] * .0722;

function createRandom(initialSeed) {
  let seed = initialSeed >>> 0;
  return () => ((seed = Math.imul(seed ^ seed >>> 15, 1 | seed)) >>> 0) / 4294967296;
}

function cosineDirection(normal, random) {
  const phi = Math.PI * 2 * random();
  const radius = Math.sqrt(random());
  const local = [Math.cos(phi) * radius, Math.sin(phi) * radius, Math.sqrt(1 - radius * radius)];
  const up = Math.abs(normal[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
  const tangent = [
    up[1] * normal[2] - up[2] * normal[1],
    up[2] * normal[0] - up[0] * normal[2],
    up[0] * normal[1] - up[1] * normal[0],
  ];
  const length = Math.hypot(...tangent);
  for (let axis = 0; axis < 3; axis++) tangent[axis] /= length;
  const bitangent = [
    normal[1] * tangent[2] - normal[2] * tangent[1],
    normal[2] * tangent[0] - normal[0] * tangent[2],
    normal[0] * tangent[1] - normal[1] * tangent[0],
  ];
  return normal.map((value, axis) => tangent[axis] * local[0] + bitangent[axis] * local[1] + value * local[2]);
}

function createTracer(scene, random) {
  const bvh = buildTriangleBvh(scene.triangles);
  const epsilon = scene.settings.rayEpsilon ?? .003;

  function intersect(origin, direction) {
    return intersectTriangleBvh(origin, direction, bvh);
  }

  function sampleAreaLight(origin, normal) {
    const light = scene.lights[Math.floor(random() * scene.lights.length)];
    const target = light.center.map((value, axis) => value
      + (random() - .5) * light.axisU[axis]
      + (random() - .5) * light.axisV[axis]);
    const vector = target.map((value, axis) => value - origin[axis]);
    const distanceSquared = dot(vector, vector);
    const distance = Math.sqrt(distanceSquared);
    const direction = vector.map(value => value / distance);
    const surfaceCosine = Math.max(0, dot(normal, direction));
    const lightCosine = Math.max(0, -dot(light.normal, direction));
    if (surfaceCosine === 0 || lightCosine === 0) return { color: [0, 0, 0], direction };
    const hit = intersect(origin.map((value, axis) => value + normal[axis] * epsilon), direction);
    if (hit && hit.distance < distance - epsilon * 2) return { color: [0, 0, 0], direction };
    const weight = scene.lights.length * light.area * surfaceCosine * lightCosine / Math.max(distanceSquared, .25);
    return { color: light.radiance.map(value => value * weight), direction };
  }

  function trace(origin, normal, depth) {
    const direct = sampleAreaLight(origin, normal).color;
    if (depth === 1) return direct;
    const direction = cosineDirection(normal, random);
    const hit = intersect(origin.map((value, axis) => value + normal[axis] * epsilon), direction);
    if (!hit) return direct;
    const point = origin.map((value, axis) => value + direction[axis] * hit.distance);
    const incoming = trace(point, hit.normal, depth - 1);
    return direct.map((value, channel) => value + incoming[channel] * hit.material.albedo[channel]);
  }

  return { intersect, sampleAreaLight, trace, epsilon };
}

function denoiseTexels(targets, atlas, owners, texels, iterations) {
  for (let iteration = 0; iteration < iterations; iteration++) {
    const sources = targets.map(target => target.data.slice());
    for (const texel of texels) {
      const x = texel.pixel % atlas.width;
      const y = Math.floor(texel.pixel / atlas.width);
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        const { data, channels } = targets[targetIndex];
        const source = sources[targetIndex];
        for (let channel = 0; channel < channels; channel++) {
          let sum = 0;
          let totalWeight = 0;
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox; const ny = y + oy;
            if (nx < 0 || nx >= atlas.width || ny < 0 || ny >= atlas.height) continue;
            const owner = owners[ny * atlas.width + nx];
            if (owner < 0) continue;
            const neighbor = texels[owner];
            const normalWeight = Math.max(0, dot(texel.normal, neighbor.normal)) ** 8;
            const distance = Math.hypot(...texel.position.map((value, axis) => value - neighbor.position[axis]));
            const spatial = ox === 0 && oy === 0 ? 4 : ox === 0 || oy === 0 ? 2 : 1;
            const weight = spatial * normalWeight * Math.exp(-distance * .35);
            sum += source[(ny * atlas.width + nx) * channels + channel] * weight;
            totalWeight += weight;
          }
          if (totalWeight > 0) data[texel.pixel * channels + channel] = sum / totalWeight;
        }
      }
    }
  }
}

function padLightmap(targets, atlas, owners, padding) {
  let valid = Uint8Array.from(owners, owner => owner >= 0 ? 1 : 0);
  for (let iteration = 0; iteration < padding; iteration++) {
    const sourceValid = valid.slice();
    const sources = targets.map(target => target.data.slice());
    for (let y = 0; y < atlas.height; y++) for (let x = 0; x < atlas.width; x++) {
      const pixel = y * atlas.width + x;
      if (sourceValid[pixel]) continue;
      let sourcePixel = -1;
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + ox; const ny = y + oy;
        if (nx >= 0 && nx < atlas.width && ny >= 0 && ny < atlas.height && sourceValid[ny * atlas.width + nx]) {
          sourcePixel = ny * atlas.width + nx;
          break;
        }
      }
      if (sourcePixel < 0) continue;
      valid[pixel] = 1;
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        const { data, channels } = targets[targetIndex];
        const source = sources[targetIndex];
        for (let channel = 0; channel < channels; channel++) data[pixel * channels + channel] = source[sourcePixel * channels + channel];
      }
    }
  }
}

export function bakeProgressiveLightmaps(scene, { onProgress = null } = {}) {
  const { atlas, settings } = scene;
  const random = createRandom(settings.seed ?? 0x1234abcd);
  const tracer = createTracer(scene, random);
  const lightmap = new Float32Array(atlas.width * atlas.height * 3);
  const directionMap = new Float32Array(atlas.width * atlas.height * 3);
  const aoMap = new Float32Array(atlas.width * atlas.height).fill(1);
  const samplesPerTexel = settings.progressivePasses * settings.samplesPerPass;
  const { texels, owners } = rasterizeLightmapTexels(scene.triangles, atlas);
  onProgress?.({ stage: 'trace', completed: 0, total: texels.length, samplesPerTexel });

  for (let texelIndex = 0; texelIndex < texels.length; texelIndex++) {
      const texel = texels[texelIndex];
      const point = texel.position;
      const normal = texel.normal;
      const sum = [0, 0, 0]; const moment = [0, 0, 0]; let ao = 0;
      for (let pass = 0; pass < settings.progressivePasses; pass++) for (let sample = 0; sample < settings.samplesPerPass; sample++) {
        const direct = tracer.sampleAreaLight(point, normal);
        const bounceDirection = cosineDirection(normal, random);
        const hit = tracer.intersect(point.map((value, axis) => value + normal[axis] * tracer.epsilon), bounceDirection);
        let indirect = [0, 0, 0];
        if (hit) {
          const bouncePoint = point.map((value, axis) => value + bounceDirection[axis] * hit.distance);
          indirect = tracer.trace(bouncePoint, hit.normal, settings.bounces - 1)
            .map((value, channel) => value * hit.material.albedo[channel]);
        }
        const color = direct.color.map((value, channel) => value + indirect[channel]);
        for (let channel = 0; channel < 3; channel++) {
          sum[channel] += color[channel] / samplesPerTexel;
          moment[channel] += (direct.direction[channel] * luminance(direct.color)
            + bounceDirection[channel] * luminance(indirect)) / samplesPerTexel;
        }
        ao += (!hit ? 1 : Math.min(hit.distance / settings.aoDistance, 1)) / samplesPerTexel;
      }
      const momentLength = Math.hypot(...moment);
      for (let channel = 0; channel < 3; channel++) {
        lightmap[texel.pixel * 3 + channel] = sum[channel];
        directionMap[texel.pixel * 3 + channel] = momentLength > 1e-6 ? moment[channel] / momentLength : normal[channel];
      }
      aoMap[texel.pixel] = ao;
      if ((texelIndex + 1) % 10000 === 0) onProgress?.({ stage: 'trace', completed: texelIndex + 1, total: texels.length, samplesPerTexel });
  }
  onProgress?.({ stage: 'trace', completed: texels.length, total: texels.length, samplesPerTexel });

  const targets = [
    { data: lightmap, channels: 3 },
    { data: directionMap, channels: 3 },
    { data: aoMap, channels: 1 },
  ];
  denoiseTexels(targets, atlas, owners, texels, settings.denoiseIterations);
  padLightmap(targets, atlas, owners, atlas.padding);
  return { width: atlas.width, height: atlas.height, lightmap, directionMap, aoMap, texelCount: texels.length };
}
