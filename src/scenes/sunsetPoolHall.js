import * as THREE from 'three';
import {
  LIGHTMAP_ATLAS_HEIGHT,
  LIGHTMAP_ATLAS_WIDTH,
  LIGHTMAP_TILE_COLUMNS,
  LIGHTMAP_TILE_SIZE,
  STATIC_BAKE_BOXES,
} from './sunsetPoolHallBakeData.js';

const POOL_DEPTH = 50;
const ROOM = {
  minX: -32,
  maxX: 32,
  minZ: -50,
  maxZ: 34,
  height: 9.5,
};
const ROOM_CENTER_Z = (ROOM.minZ + ROOM.maxZ) / 2;
const WATER_Y = .42;

export const sunsetPoolHall = {
  id: 'sunset-pool-hall',
  assets: {
    basePath: 'generated/sunset-pool-hall',
    textures: {
      tile: 'tile-albedo.png',
      tileNormal: 'tile-normal.png',
      wetMask: 'wet-mask.png',
      wetRoughness: 'wet-roughness.png',
      giLightmap: 'gi-lightmap.png',
      giDirection: 'gi-direction.png',
      giAo: 'gi-ao.png',
      lightShaft: 'light-shaft.png',
      causticShadow: 'caustic-shadow.png',
    },
    cubeTextures: {
      reflectionProbe: [
        'probe-px.png', 'probe-nx.png', 'probe-py.png',
        'probe-ny.png', 'probe-pz.png', 'probe-nz.png',
      ],
    },
  },
  camera: {
    fov: 64,
    near: .08,
    far: 240,
    eyeHeight: 1.28,
    spawn: [0, 1.28, 27.5],
  },
  render: {
    exposure: .84,
    background: 0x211d18,
    fogColor: 0x302921,
    fogDensity: .0052,
  },
  create: createSunsetPoolHall,
};

function createSunsetPoolHall({ renderer, camera, assets }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sunsetPoolHall.render.background);
  scene.fog = new THREE.FogExp2(sunsetPoolHall.render.fogColor, sunsetPoolHall.render.fogDensity);

  const collisionBoxes = [];
  const waterMeshes = [];
  const causticMeshes = [];
  const ssrSurfaces = [];
  const { tile, tileNormal, wetMask, wetRoughness, giLightmap, giDirection, giAo, lightShaft, causticShadow, reflectionProbe } = assets;

  function configureTexture(texture, { repeat = 1, colorSpace = THREE.NoColorSpace, tiled = true } = {}) {
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = tiled ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.repeat.set(repeat, repeat);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  configureTexture(tile, { repeat: 3, colorSpace: THREE.SRGBColorSpace });
  configureTexture(tileNormal, { repeat: 3 });
  configureTexture(wetMask, { repeat: 3.5 });
  configureTexture(wetRoughness, { repeat: 3.5 });
  // GI stores linear irradiance and must not be gamma-decoded as sRGB.
  configureTexture(giLightmap, { colorSpace: THREE.NoColorSpace, tiled: false });
  configureTexture(giDirection, { colorSpace: THREE.NoColorSpace, tiled: false });
  configureTexture(giAo, { colorSpace: THREE.NoColorSpace, tiled: false });
  configureTexture(lightShaft, { colorSpace: THREE.SRGBColorSpace, tiled: false });
  configureTexture(causticShadow, { tiled: false });
  giLightmap.channel = 1;
  giDirection.channel = 1;
  giAo.channel = 1;
  reflectionProbe.colorSpace = THREE.SRGBColorSpace;
  reflectionProbe.mapping = THREE.CubeReflectionMapping;
  reflectionProbe.minFilter = THREE.LinearMipmapLinearFilter;
  reflectionProbe.magFilter = THREE.LinearFilter;
  reflectionProbe.generateMipmaps = true;
  reflectionProbe.needsUpdate = true;

  const floorTexture = configureTexture(tile.clone(), { repeat: 14, colorSpace: THREE.SRGBColorSpace });
  const floorNormalTexture = configureTexture(tileNormal.clone(), { repeat: 14 });
  const tileMaterial = new THREE.MeshPhysicalMaterial({
    map: tile,
    normalMap: tileNormal,
    normalScale: new THREE.Vector2(.3, -.3),
    lightMap: giLightmap,
    lightMapIntensity: 1,
    color: 0xc1b09a,
    roughness: .38,
    clearcoat: .2,
    clearcoatRoughness: .28,
  });
  const wallMaterial = tileMaterial.clone();
  wallMaterial.color.set(0x8b7560);
  wallMaterial.roughness = .58;
  wallMaterial.clearcoat = .08;
  wallMaterial.emissive.set(0x24150d);
  wallMaterial.emissiveIntensity = .16;
  const windowRevealMaterial = wallMaterial.clone();
  windowRevealMaterial.color.set(0xa17b5c);
  windowRevealMaterial.roughness = .68;
  const ceilingMaterial = wallMaterial.clone();
  ceilingMaterial.color.set(0x51453a);
  const submergedMaterial = tileMaterial.clone();
  submergedMaterial.color.set(0x83968a);
  submergedMaterial.emissive.set(0x21483f);
  submergedMaterial.emissiveIntensity = .58;
  submergedMaterial.roughness = .46;
  const wetFloorMaterial = new THREE.MeshPhysicalMaterial({
    map: floorTexture,
    normalMap: floorNormalTexture,
    normalScale: new THREE.Vector2(.22, -.22),
    roughnessMap: wetRoughness,
    clearcoatMap: wetMask,
    clearcoatRoughnessMap: wetRoughness,
    lightMap: giLightmap,
    lightMapIntensity: 1,
    envMap: reflectionProbe,
    envMapIntensity: .38,
    color: 0x9e8d77,
    roughness: .56,
    clearcoat: 1,
    clearcoatRoughness: .24,
    ior: 1.45,
    specularIntensity: .92,
    specularColor: new THREE.Color(0xffddae),
  });

  function enableBakedLighting(material) {
    material.aoMap = giAo;
    material.aoMapIntensity = .72;
    material.onBeforeCompile = shader => {
      shader.uniforms.giDirectionMap = { value: giDirection };
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lightmap_pars_fragment>',
        '#include <lightmap_pars_fragment>\nuniform sampler2D giDirectionMap;',
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;',
        `vec3 bakedDirection = normalize(texture2D(giDirectionMap, vLightMapUv).rgb * 2.0 - 1.0);
        vec3 bakedDirectionView = normalize((viewMatrix * vec4(bakedDirection, 0.0)).xyz);
        float directionalResponse = mix(0.68, 1.28, max(dot(normal, bakedDirectionView), 0.0));
        vec3 lightMapIrradiance = lightMapTexel.rgb * (lightMapTexel.a * 8.0) * lightMapIntensity * directionalResponse;`,
      );
    };
    material.customProgramCacheKey = () => 'directional-rgbm-lightmap-v1';
  }
  for (const material of [tileMaterial, wallMaterial, windowRevealMaterial, ceilingMaterial, submergedMaterial, wetFloorMaterial]) {
    enableBakedLighting(material);
  }

  function addLightMapUv(geometry, size, bakeIndex) {
    const positions = geometry.attributes.position;
    const normals = geometry.attributes.normal;
    const lightMapUvs = new Float32Array(positions.count * 2);
    for (let index = 0; index < positions.count; index++) {
      const normal = [normals.getX(index), normals.getY(index), normals.getZ(index)];
      const axis = normal.findIndex(value => Math.abs(value) > .5);
      const face = axis * 2 + (normal[axis] < 0 ? 1 : 0);
      const local = [positions.getX(index), positions.getY(index), positions.getZ(index)];
      const axes = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
      const tile = bakeIndex * 6 + face;
      const column = tile % LIGHTMAP_TILE_COLUMNS;
      const row = Math.floor(tile / LIGHTMAP_TILE_COLUMNS);
      const inner = LIGHTMAP_TILE_SIZE - 2;
      const u = local[axes[0]] / size[axes[0]] + .5;
      const v = local[axes[1]] / size[axes[1]] + .5;
      lightMapUvs[index * 2] = (column * LIGHTMAP_TILE_SIZE + 1 + u * inner) / LIGHTMAP_ATLAS_WIDTH;
      lightMapUvs[index * 2 + 1] = (row * LIGHTMAP_TILE_SIZE + 1 + v * inner) / LIGHTMAP_ATLAS_HEIGHT;
    }
    geometry.setAttribute('uv1', new THREE.BufferAttribute(lightMapUvs, 2));
  }

  let bakeBoxIndex = 0;
  function box(name, size, positionArray, material = tileMaterial, collidable = true) {
    const geometry = new THREE.BoxGeometry(...size);
    const position = new THREE.Vector3(...positionArray);
    const baked = STATIC_BAKE_BOXES[bakeBoxIndex];
    const matches = baked?.name === name
      && size.every((value, axis) => Math.abs(value - baked.size[axis]) < 1e-5)
      && positionArray.every((value, axis) => Math.abs(value - baked.position[axis]) < 1e-5);
    if (!matches) throw new Error(`Lightmap layout mismatch at static box ${bakeBoxIndex}: ${name}`);
    addLightMapUv(geometry, size, bakeBoxIndex++);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (collidable) collisionBoxes.push(new THREE.Box3().setFromObject(mesh));
    return mesh;
  }

  function createCausticMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uShadowMask: { value: causticShadow },
      },
      vertexShader: `varying vec2 vWorld;
        varying vec2 vShadowUv;
        void main(){
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xz;
          vShadowUv = (world.xz - vec2(-32.0, -50.0)) / vec2(64.0, 84.0);
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `uniform float uTime;
        uniform sampler2D uShadowMask;
        varying vec2 vWorld;
        varying vec2 vShadowUv;
        void main(){
          vec2 p = vWorld;
          float a = sin(p.x * 11.4 + sin(p.y * 8.1 + uTime) * 1.3);
          float b = sin(p.y * 12.1 - sin(p.x * 7.6 - uTime * .8) * 1.2);
          float ridge = 1.0 - smoothstep(.025, .13, abs(a + b));
          float c = pow(ridge, 2.0);
          float architecturalLight = texture2D(uShadowMask, clamp(vShadowUv, 0.0, 1.0)).r;
          gl_FragColor = vec4(1.0, .64, .27, c * .16 * mix(.06, 1.0, architecturalLight));
        }`,
    });
  }

  const causticMaterial = createCausticMaterial();
  function addCausticSurface(x, z, width, depth, y) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), causticMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    scene.add(mesh);
    causticMeshes.push(mesh);
  }

  function addPoolBasin(x, z, width, depth, waterY) {
    const bottomY = waterY - POOL_DEPTH;
    box('pool-bottom', [width, .4, depth], [x, bottomY - .2, z], tileMaterial, false);
    box('pool-wall-west', [.35, POOL_DEPTH, depth], [x - width / 2, waterY - POOL_DEPTH / 2, z], tileMaterial);
    box('pool-wall-east', [.35, POOL_DEPTH, depth], [x + width / 2, waterY - POOL_DEPTH / 2, z], tileMaterial);
    box('pool-wall-north', [width, POOL_DEPTH, .35], [x, waterY - POOL_DEPTH / 2, z - depth / 2], tileMaterial);
    box('pool-wall-south', [width, POOL_DEPTH, .35], [x, waterY - POOL_DEPTH / 2, z + depth / 2], tileMaterial);
    addCausticSurface(x, z, width, depth, bottomY + .012);
  }

  function addWater(x, z, width, depth, y) {
    addPoolBasin(x, z, width, depth, y);
    const geometry = new THREE.PlaneGeometry(width, depth, Math.max(32, Math.floor(width * 1.4)), Math.max(32, Math.floor(depth * 1.4)));
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uSceneColor: { value: null },
        uSceneDepth: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCameraNear: { value: camera.near },
        uCameraFar: { value: camera.far },
        uDeep: { value: new THREE.Color(0x24534b) },
        uShallow: { value: new THREE.Color(0x8ba397) },
        uReflectionProbe: { value: reflectionProbe },
        uProbePosition: { value: new THREE.Vector3(0, 1.6, ROOM_CENTER_Z) },
        uProbeMin: { value: new THREE.Vector3(ROOM.minX, 0, ROOM.minZ) },
        uProbeMax: { value: new THREE.Vector3(ROOM.maxX, ROOM.height, ROOM.maxZ) },
      },
      vertexShader: `uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vCrest;
        void main(){
          vec3 p = position;
          float p1 = p.x * .82 + p.z * .34 + uTime * 1.35;
          float p2 = p.x * -.28 + p.z * 1.17 - uTime * .92;
          float p3 = length(p.xz) * 1.42 - uTime * 1.65;
          float wave = sin(p1) * .03 + sin(p2) * .02 + sin(p3) * .012;
          float radius = max(length(p.xz), .01);
          float dx = cos(p1) * .0246 - cos(p2) * .0056 + cos(p3) * .01704 * p.x / radius;
          float dz = cos(p1) * .0102 + cos(p2) * .0234 + cos(p3) * .01704 * p.z / radius;
          p.y += wave;
          vec4 world = modelMatrix * vec4(p, 1.0);
          vWorldPos = world.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * vec3(-dx, 1.0, -dz));
          vCrest = wave;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `uniform sampler2D uSceneColor;
        uniform sampler2D uSceneDepth;
        uniform samplerCube uReflectionProbe;
        uniform vec2 uResolution;
        uniform float uCameraNear;
        uniform float uCameraFar;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uProbePosition;
        uniform vec3 uProbeMin;
        uniform vec3 uProbeMax;
        uniform vec3 uSunDir;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vCrest;
        float viewZFromDepth(float depth){
          return (uCameraNear * uCameraFar) / ((uCameraFar - uCameraNear) * depth - uCameraFar);
        }
        vec3 boxProjectedDirection(vec3 direction, vec3 worldPosition){
          vec3 safeDirection = sign(direction) * max(abs(direction), vec3(.0001));
          vec3 toMin = (uProbeMin - worldPosition) / safeDirection;
          vec3 toMax = (uProbeMax - worldPosition) / safeDirection;
          vec3 distances = mix(toMin, toMax, step(vec3(0.0), safeDirection));
          float distanceToWall = min(min(distances.x, distances.y), distances.z);
          return worldPosition + safeDirection * max(distanceToWall, 0.0) - uProbePosition;
        }
        void main(){
          vec3 N = normalize(vWorldNormal);
          vec3 V = normalize(cameraPosition - vWorldPos);
          float ndv = clamp(dot(N, V), 0.0, 1.0);
          float fresnel = .025 + .975 * pow(1.0 - ndv, 5.0);
          vec2 screenUV = gl_FragCoord.xy / uResolution;
          float sceneDepth = texture2D(uSceneDepth, screenUV).x;
          float waterViewZ = viewZFromDepth(gl_FragCoord.z);
          float sceneViewZ = viewZFromDepth(sceneDepth);
          float thickness = clamp(waterViewZ - sceneViewZ, 0.0, 50.0);
          vec2 distortion = N.xz * (.006 + min(thickness, 5.0) * .0007) * (1.0 - fresnel * .65);
          vec2 refractUV = clamp(screenUV + distortion, vec2(.002), vec2(.998));
          float refractedDepth = texture2D(uSceneDepth, refractUV).x;
          if (refractedDepth < gl_FragCoord.z) refractUV = screenUV;
          float dispersion = .00022 * min(thickness, 3.0);
          vec3 refracted;
          refracted.r = texture2D(uSceneColor, refractUV + N.xz * dispersion).r;
          refracted.g = texture2D(uSceneColor, refractUV).g;
          refracted.b = texture2D(uSceneColor, refractUV - N.xz * dispersion).b;
          vec3 transmittance = exp(-thickness * vec3(.018, .006, .0025));
          refracted = refracted * transmittance + uDeep * (1.0 - transmittance) * .28;
          vec3 reflectionDirection = reflect(-V, N);
          vec3 reflectedRoom = textureCube(uReflectionProbe, boxProjectedDirection(reflectionDirection, vWorldPos)).rgb;
          vec3 waterTint = mix(uDeep, uShallow, clamp(.62 + vCrest * 3.0, 0.0, 1.0));
          vec3 color = mix(refracted, waterTint, .014 + thickness * .0007);
          color = mix(color, reflectedRoom, fresnel * .74);
          gl_FragColor = vec4(color, 1.0);
        }`,
    });
    const water = new THREE.Mesh(geometry, material);
    water.position.set(x, y, z);
    scene.add(water);
    waterMeshes.push(water);
  }

  function archShape(width, sill, spring) {
    const radius = width / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-radius, sill);
    shape.lineTo(radius, sill);
    shape.lineTo(radius, spring);
    shape.absarc(0, spring, radius, 0, Math.PI, false);
    shape.closePath();
    return shape;
  }

  function archHole(center, width, sill, spring) {
    const radius = width / 2;
    const path = new THREE.Path();
    path.moveTo(center - radius, sill);
    path.lineTo(center - radius, spring);
    path.absarc(center, spring, radius, Math.PI, 0, true);
    path.lineTo(center + radius, sill);
    path.closePath();
    return path;
  }

  const sunsetGlassMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(1, .48, .12),
    side: THREE.DoubleSide,
  });

  function addArchedSideWall(side, windowCenters, windowWidth) {
    const isWest = side === 'west';
    const wallShape = new THREE.Shape();
    wallShape.moveTo(-42, 0);
    wallShape.lineTo(42, 0);
    wallShape.lineTo(42, ROOM.height);
    wallShape.lineTo(-42, ROOM.height);
    wallShape.closePath();
    const sill = .58;
    const archTop = 8.4;
    const spring = archTop - windowWidth / 2;
    for (const worldZ of windowCenters) {
      const localCenter = isWest ? ROOM_CENTER_Z - worldZ : worldZ - ROOM_CENTER_Z;
      wallShape.holes.push(archHole(localCenter, windowWidth, sill, spring));
    }

    const geometry = new THREE.ExtrudeGeometry(wallShape, {
      depth: 1.1,
      bevelEnabled: true,
      bevelSize: .07,
      bevelThickness: .055,
      bevelSegments: 2,
      curveSegments: 32,
    });
    if (geometry.attributes.position) {
      const positions = geometry.attributes.position;
      const tile = STATIC_BAKE_BOXES.length * 6 + (isWest ? 0 : 1);
      const column = tile % LIGHTMAP_TILE_COLUMNS;
      const row = Math.floor(tile / LIGHTMAP_TILE_COLUMNS);
      const uv1 = new Float32Array(positions.count * 2);
      for (let index = 0; index < positions.count; index++) {
        const u = THREE.MathUtils.clamp(positions.getX(index) / 84 + .5, 0, 1);
        const v = THREE.MathUtils.clamp(positions.getY(index) / ROOM.height, 0, 1);
        uv1[index * 2] = (column * LIGHTMAP_TILE_SIZE + 1 + u * (LIGHTMAP_TILE_SIZE - 2)) / LIGHTMAP_ATLAS_WIDTH;
        uv1[index * 2 + 1] = (row * LIGHTMAP_TILE_SIZE + 1 + v * (LIGHTMAP_TILE_SIZE - 2)) / LIGHTMAP_ATLAS_HEIGHT;
      }
      geometry.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    }
    const wall = new THREE.Mesh(geometry, [wallMaterial, windowRevealMaterial]);
    wall.name = `${side}-arched-wall`;
    wall.rotation.y = isWest ? Math.PI / 2 : -Math.PI / 2;
    wall.position.set(isWest ? ROOM.minX : ROOM.maxX, 0, ROOM_CENTER_Z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
    collisionBoxes.push(new THREE.Box3().setFromObject(wall));

    windowCenters.forEach((worldZ, index) => {
      const pane = new THREE.Mesh(new THREE.ShapeGeometry(archShape(windowWidth * .92, sill, spring)), sunsetGlassMaterial);
      pane.rotation.y = isWest ? Math.PI / 2 : -Math.PI / 2;
      pane.position.set(isWest ? ROOM.minX + .05 : ROOM.maxX - .05, 0, worldZ);
      scene.add(pane);

    });
  }

  function addFarWindows() {
    const cuts = [-32, -27, -18, -8, 7, 17, 27, 32];
    box('far-wall-lower', [64, .65, .7], [0, .325, ROOM.minZ], wallMaterial);
    box('far-wall-upper', [64, 1.45, .7], [0, 8.775, ROOM.minZ], wallMaterial);
    for (const x of cuts) box('far-window-column', [1.15, 8.1, .7], [x, 4.45, ROOM.minZ], wallMaterial);
    const paneMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(.48, .35, .23), side: THREE.DoubleSide });
    for (let index = 0; index < cuts.length - 1; index++) {
      const left = cuts[index] + .58;
      const right = cuts[index + 1] - .58;
      if (right <= left) continue;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(right - left, 7.35), paneMaterial);
      pane.position.set((left + right) / 2, 4.35, ROOM.minZ + .36);
      scene.add(pane);
    }
  }

  function addSubmergedPlatform(name, size, position) {
    box(name, size, position, submergedMaterial, false);
    addCausticSurface(position[0], position[2], size[0], size[2], position[1] + size[1] / 2 + .012);
  }

  function buildWorld() {
    const pool = { x: 0, z: -8, width: 57, depth: 77 };
    const sideDeckWidth = (ROOM.maxX - ROOM.minX - pool.width) / 2;
    const endDeckDepth = (ROOM.maxZ - ROOM.minZ - pool.depth) / 2;
    for (const [x, z, width, depth] of [
      [ROOM.minX + sideDeckWidth / 2, ROOM_CENTER_Z, sideDeckWidth, 84],
      [ROOM.maxX - sideDeckWidth / 2, ROOM_CENTER_Z, sideDeckWidth, 84],
      [0, ROOM.minZ + endDeckDepth / 2, pool.width, endDeckDepth],
      [0, ROOM.maxZ - endDeckDepth / 2, pool.width, endDeckDepth],
    ]) {
      const deck = box('wet-deck', [width, .4, depth], [x, -.2, z], wetFloorMaterial, false);
      ssrSurfaces.push(deck);
    }

    addWater(pool.x, pool.z, pool.width, pool.depth, WATER_Y);
    box('pool-rim-west', [1, .62, pool.depth], [-29, .31, pool.z], wallMaterial);
    box('pool-rim-east', [1, .62, pool.depth], [29, .31, pool.z], wallMaterial);
    box('pool-rim-north', [59, .62, 1], [0, .31, -47], wallMaterial);
    box('pool-rim-south', [59, .62, 1], [0, .31, 31], wallMaterial);

    box('ceiling', [64, .5, 84], [0, 9.75, ROOM_CENTER_Z], ceilingMaterial, false);
    for (let z = -44; z <= 28; z += 12) {
      box('ceiling-beam', [64, .72, 1.35], [0, 8.92, z], ceilingMaterial, false);
    }
    for (const x of [-26.8, 26.8]) {
      for (let z = -42; z <= 26; z += 13.6) {
        box('colonnade', [1.45, 8.6, 1.65], [x, 4.3, z], wallMaterial);
      }
      box('colonnade-lintel', [1.7, 1.15, 82], [x, 8.45, ROOM_CENTER_Z], ceilingMaterial, false);
    }

    addArchedSideWall('west', [-40, -24, -8, 8, 24], 7.2);
    addArchedSideWall('east', [-42, -32, -22, -12, -2, 8, 18, 28], 3.4);
    addFarWindows();
    box('near-wall', [64, ROOM.height, .7], [0, ROOM.height / 2, ROOM.maxZ], wallMaterial);

    addSubmergedPlatform('submerged-shelf-a', [18, .75, 16], [-9, -.72, -2]);
    addSubmergedPlatform('submerged-shelf-b', [16, .55, 20], [11, -1.1, -20]);
    addSubmergedPlatform('submerged-shelf-c', [13, .45, 13], [-12, -1.55, -33]);
    addSubmergedPlatform('submerged-shelf-foreground', [52, .5, 44], [0, -1.02, 12]);
    for (let step = 0; step < 5; step++) {
      addSubmergedPlatform(`submerged-step-${step}`, [14, .28, 2.2], [15, -.05 - step * .22, 22 - step * 2.05]);
    }

    const sun = new THREE.DirectionalLight(0xff8e3c, 6.8);
    sun.position.set(58, 13, 18);
    sun.target.position.set(-12, 0, -19);
    scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -.00012;
    sun.shadow.normalBias = .035;
    sun.shadow.camera.left = -54;
    sun.shadow.camera.right = 54;
    sun.shadow.camera.top = 54;
    sun.shadow.camera.bottom = -54;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 115;
    scene.add(sun);
  }

  buildWorld();

  return {
    scene,
    collisionBoxes,
    waterMeshes,
    causticMeshes,
    ssrSurfaces,
    ssrMask: wetMask,
    depth: POOL_DEPTH,
    describeLocation() {
      return '夕照水厅';
    },
  };
}
