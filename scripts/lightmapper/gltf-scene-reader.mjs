import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

if (typeof globalThis.ProgressEvent === 'undefined') globalThis.ProgressEvent = class ProgressEvent {};

const toArray = vector => [vector.x, vector.y, vector.z];

export async function readGltfBakeScene(glbPath, config) {
  const buffer = await readFile(glbPath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');
  gltf.scene.updateMatrixWorld(true);
  const triangles = [];

  gltf.scene.traverse(object => {
    if (!object.isMesh || object.userData.contributeGI !== true) return;
    const geometry = object.geometry;
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const lightmapUv = geometry.attributes.uv1;
    if (!position || !normal || !lightmapUv) throw new Error(`GI mesh ${object.name} is missing POSITION, NORMAL or TEXCOORD_1`);
    const material = config.materials[object.userData.materialRole];
    if (!material) throw new Error(`GI mesh ${object.name} has unknown material role ${object.userData.materialRole}`);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
    const index = geometry.index;
    const count = index?.count ?? position.count;
    for (let offset = 0; offset < count; offset += 3) {
      const vertices = [0, 1, 2].map(corner => index ? index.getX(offset + corner) : offset + corner);
      const points = vertices.map(vertex => toArray(new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(object.matrixWorld)));
      const normals = vertices.map(vertex => toArray(new THREE.Vector3().fromBufferAttribute(normal, vertex).applyMatrix3(normalMatrix).normalize()));
      const uvs = vertices.map(vertex => [lightmapUv.getX(vertex), lightmapUv.getY(vertex)]);
      const min = [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis])));
      const max = [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis])));
      triangles.push({
        p0: points[0], p1: points[1], p2: points[2],
        n0: normals[0], n1: normals[1], n2: normals[2],
        uv0: uvs[0], uv1: uvs[1], uv2: uvs[2],
        min, max,
        center: min.map((value, axis) => (value + max[axis]) / 2),
        material,
      });
    }
  });

  return { ...config, triangles };
}
