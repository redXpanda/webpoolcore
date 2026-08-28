function barycentric(point, a, b, c) {
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denominator) < 1e-12) return null;
  const w0 = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / denominator;
  const w1 = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / denominator;
  return [w0, w1, 1 - w0 - w1];
}

export function rasterizeLightmapTexels(triangles, atlas) {
  const texels = [];
  const owners = new Int32Array(atlas.width * atlas.height).fill(-1);
  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex++) {
    const triangle = triangles[triangleIndex];
    const uvs = [triangle.uv0, triangle.uv1, triangle.uv2];
    const xs = uvs.map(uv => uv[0] * atlas.width);
    const ys = uvs.map(uv => (1 - uv[1]) * atlas.height);
    const minX = Math.max(0, Math.floor(Math.min(...xs) - .5));
    const maxX = Math.min(atlas.width - 1, Math.ceil(Math.max(...xs) - .5));
    const minY = Math.max(0, Math.floor(Math.min(...ys) - .5));
    const maxY = Math.min(atlas.height - 1, Math.ceil(Math.max(...ys) - .5));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const uv = [(x + .5) / atlas.width, 1 - (y + .5) / atlas.height];
      const weights = barycentric(uv, uvs[0], uvs[1], uvs[2]);
      if (!weights || weights.some(weight => weight < -1e-5)) continue;
      const pixel = y * atlas.width + x;
      const position = [0, 0, 0];
      const normal = [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) {
        position[axis] = triangle.p0[axis] * weights[0] + triangle.p1[axis] * weights[1] + triangle.p2[axis] * weights[2];
        normal[axis] = triangle.n0[axis] * weights[0] + triangle.n1[axis] * weights[1] + triangle.n2[axis] * weights[2];
      }
      const normalLength = Math.hypot(...normal);
      for (let axis = 0; axis < 3; axis++) normal[axis] /= normalLength;
      if (owners[pixel] >= 0) {
        const previous = texels[owners[pixel]];
        const separation = Math.hypot(...position.map((value, axis) => value - previous.position[axis]));
        if (separation > .05) throw new Error(`Overlapping lightmap UV at pixel ${x},${y}`);
        continue;
      }
      owners[pixel] = texels.length;
      texels.push({ pixel, position, normal, material: triangle.material });
    }
  }
  return { texels, owners };
}
