import assert from 'node:assert/strict';
import { buildTriangleBvh, intersectTriangleBvh } from './lightmapper/triangle-bvh.mjs';
import { rasterizeLightmapTexels } from './lightmapper/lightmap-rasterizer.mjs';

const material = { albedo: [.5, .5, .5], doubleSided: true };
const triangle = {
  p0: [0, 0, 0], p1: [1, 0, 0], p2: [0, 1, 0],
  n0: [0, 0, 1], n1: [0, 0, 1], n2: [0, 0, 1],
  uv0: [.1, .1], uv1: [.9, .1], uv2: [.1, .9],
  min: [0, 0, 0], max: [1, 1, 0], center: [.5, .5, 0], material,
};

const hit = intersectTriangleBvh([.25, .25, 1], [0, 0, -1], buildTriangleBvh([triangle]));
assert.ok(hit);
assert.ok(Math.abs(hit.distance - 1) < 1e-6);
assert.deepEqual(hit.normal, [0, 0, 1]);

const rasterized = rasterizeLightmapTexels([triangle], { width: 16, height: 16 });
assert.ok(rasterized.texels.length > 50);
assert.equal(rasterized.owners.filter(owner => owner >= 0).length, rasterized.texels.length);

console.log(`Lightmapper tests passed: ${rasterized.texels.length} texels`);
