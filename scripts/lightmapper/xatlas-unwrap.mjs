import path from 'node:path';
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Api } from 'xatlasjs/dist/node/api.mjs';
import createXAtlasModule from 'xatlasjs/dist/node/xatlas.js';

const XAtlasApi = Api(createXAtlasModule);

function attributeArray(attribute) {
  return new Float32Array(attribute.array.buffer.slice(
    attribute.array.byteOffset,
    attribute.array.byteOffset + attribute.array.byteLength,
  ));
}

export async function generateLightmapUv(scene, options = {}) {
  const xatlas = new XAtlasApi(
    () => {},
    () => path.resolve('node_modules/xatlasjs/dist/node/xatlas.wasm'),
  );
  while (!xatlas.loaded) await new Promise(resolve => setTimeout(resolve, 10));
  xatlas.createAtlas();
  const meshes = [];
  scene.traverse(object => {
    if (!object.isMesh || object.userData.contributeGI !== true) return;
    if (!object.geometry.index) object.geometry = mergeVertices(object.geometry, 1e-5);
    const geometry = object.geometry;
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    if (position.count > 65535) throw new Error(`xatlas mesh ${object.name} exceeds the Uint16 vertex limit`);
    const index = new Uint16Array(geometry.index.array);
    xatlas.addMesh(
      index,
      attributeArray(position),
      attributeArray(normal),
      attributeArray(uv),
      object.uuid,
      true,
      true,
    );
    meshes.push(object);
  });
  const atlas = xatlas.generateAtlas(
    { maxIterations: 4, normalDeviationWeight: 2, normalSeamWeight: 4 },
    {
      resolution: options.resolution ?? 1024,
      padding: options.padding ?? 4,
      texelsPerUnit: options.texelsPerUnit ?? 8,
      bilinear: true,
      blockAlign: false,
      bruteForce: false,
      createImage: false,
      rotateCharts: true,
      rotateChartsToAxis: true,
    },
  );
  const byUuid = new Map(meshes.map(mesh => [mesh.uuid, mesh]));
  for (const result of atlas.meshes) {
    const mesh = byUuid.get(result.mesh);
    if (!mesh) throw new Error(`xatlas returned an unknown mesh ${result.mesh}`);
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(result.index, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(result.vertex.vertices, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(result.vertex.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(result.vertex.coords, 2));
    geometry.setAttribute('uv1', new THREE.BufferAttribute(result.vertex.coords1, 2));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  }
  xatlas.destroyAtlas();
  return { width: atlas.width, height: atlas.height, atlasCount: atlas.atlasCount, texelsPerUnit: atlas.texelsPerUnit };
}
