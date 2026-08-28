function mergeBounds(triangles) {
  return {
    min: [0, 1, 2].map(axis => Math.min(...triangles.map(item => item.min[axis]))),
    max: [0, 1, 2].map(axis => Math.max(...triangles.map(item => item.max[axis]))),
  };
}

export function buildTriangleBvh(triangles, leafSize = 8) {
  const bounds = mergeBounds(triangles);
  if (triangles.length <= leafSize) return { ...bounds, triangles };
  const extent = bounds.max.map((value, axis) => value - bounds.min[axis]);
  const axis = extent.indexOf(Math.max(...extent));
  const sorted = [...triangles].sort((a, b) => a.center[axis] - b.center[axis]);
  const middle = Math.floor(sorted.length / 2);
  return {
    ...bounds,
    left: buildTriangleBvh(sorted.slice(0, middle), leafSize),
    right: buildTriangleBvh(sorted.slice(middle), leafSize),
  };
}

function intersectsBounds(origin, inverseDirection, node, maximum) {
  let near = 0;
  let far = maximum;
  for (let axis = 0; axis < 3; axis++) {
    const a = (node.min[axis] - origin[axis]) * inverseDirection[axis];
    const b = (node.max[axis] - origin[axis]) * inverseDirection[axis];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return false;
  }
  return true;
}

function intersectTriangle(origin, direction, triangle) {
  const edge1 = triangle.p1.map((value, axis) => value - triangle.p0[axis]);
  const edge2 = triangle.p2.map((value, axis) => value - triangle.p0[axis]);
  const p = [
    direction[1] * edge2[2] - direction[2] * edge2[1],
    direction[2] * edge2[0] - direction[0] * edge2[2],
    direction[0] * edge2[1] - direction[1] * edge2[0],
  ];
  const determinant = edge1[0] * p[0] + edge1[1] * p[1] + edge1[2] * p[2];
  if (!triangle.material.doubleSided && determinant < 1e-8) return null;
  if (Math.abs(determinant) < 1e-8) return null;
  const inverse = 1 / determinant;
  const t = origin.map((value, axis) => value - triangle.p0[axis]);
  const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * inverse;
  if (u < 0 || u > 1) return null;
  const q = [
    t[1] * edge1[2] - t[2] * edge1[1],
    t[2] * edge1[0] - t[0] * edge1[2],
    t[0] * edge1[1] - t[1] * edge1[0],
  ];
  const v = (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]) * inverse;
  if (v < 0 || u + v > 1) return null;
  const distance = (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]) * inverse;
  if (distance < 1e-4) return null;
  const w = 1 - u - v;
  const normal = [0, 1, 0];
  for (let axis = 0; axis < 3; axis++) normal[axis] = triangle.n0[axis] * w + triangle.n1[axis] * u + triangle.n2[axis] * v;
  const length = Math.hypot(...normal);
  for (let axis = 0; axis < 3; axis++) normal[axis] /= length;
  if (normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2] > 0) {
    for (let axis = 0; axis < 3; axis++) normal[axis] *= -1;
  }
  return { distance, normal, material: triangle.material };
}

export function intersectTriangleBvh(origin, direction, node, closest = null) {
  const inverseDirection = direction.map(value => Math.abs(value) < 1e-12 ? Math.sign(value || 1) * 1e12 : 1 / value);
  function visit(current, hit) {
    if (!intersectsBounds(origin, inverseDirection, current, hit?.distance ?? Infinity)) return hit;
    if (current.triangles) {
      for (const triangle of current.triangles) {
        const candidate = intersectTriangle(origin, direction, triangle);
        if (candidate && (!hit || candidate.distance < hit.distance)) hit = candidate;
      }
      return hit;
    }
    hit = visit(current.left, hit);
    return visit(current.right, hit);
  }
  return visit(node, closest);
}
