import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {
  buildSunsetPoolHallGeometry,
  createSunsetPoolHallMetadata,
} from '../src/scenes/sunsetPoolHallGeometry.js';
import { generateLightmapUv } from './lightmapper/xatlas-unwrap.mjs';

class NodeFileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result;
      this.onloadend?.({ target: this });
    }).catch(error => this.onerror?.(error));
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then(result => {
      const mime = blob.type || 'application/octet-stream';
      this.result = `data:${mime};base64,${Buffer.from(result).toString('base64')}`;
      this.onloadend?.({ target: this });
    }).catch(error => this.onerror?.(error));
  }
}

if (typeof globalThis.FileReader === 'undefined') globalThis.FileReader = NodeFileReader;

export async function generateSunsetPoolHallGlb(outputDirectory) {
  const scene = buildSunsetPoolHallGeometry();
  const lightmap = await generateLightmapUv(scene, { resolution: 1024, padding: 4, texelsPerUnit: 2 });
  if (lightmap.atlasCount !== 1) throw new Error(`Expected one lightmap atlas, xatlas generated ${lightmap.atlasCount}`);
  const exporter = new GLTFExporter();
  const arrayBuffer = await exporter.parseAsync(scene, {
    binary: true,
    onlyVisible: true,
    trs: false,
    includeCustomExtensions: true,
  });
  await Promise.all([
    writeFile(path.join(outputDirectory, 'scene.glb'), Buffer.from(arrayBuffer)),
    writeFile(path.join(outputDirectory, 'scene-metadata.json'), `${JSON.stringify(createSunsetPoolHallMetadata(lightmap), null, 2)}\n`),
  ]);
  return { lightmap };
}
