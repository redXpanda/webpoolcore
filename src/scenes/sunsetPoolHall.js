import * as THREE from 'three';

const ROOM = {
  minX: -32,
  maxX: 32,
  minZ: -50,
  maxZ: 34,
  height: 9.5,
};
const ROOM_CENTER_Z = (ROOM.minZ + ROOM.maxZ) / 2;

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
    models: {
      sceneModel: 'scene.glb',
    },
    data: {
      sceneMetadata: 'scene-metadata.json',
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
  const {
    tile, tileNormal, wetMask, wetRoughness, giLightmap, giDirection, giAo,
    lightShaft, causticShadow, reflectionProbe, sceneModel, sceneMetadata,
  } = assets;

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

  function addWater(x, z, width, depth, y) {
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

  const sunsetGlassMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(1, .48, .12),
    side: THREE.DoubleSide,
  });
  const farWindowMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(.48, .35, .23),
    side: THREE.DoubleSide,
  });

  function buildWorld() {
    const materialByRole = {
      tile: tileMaterial,
      wall: wallMaterial,
      ceiling: ceilingMaterial,
      submerged: submergedMaterial,
      wetFloor: wetFloorMaterial,
      window: sunsetGlassMaterial,
      farWindow: farWindowMaterial,
    };
    const staticRoot = sceneModel.scene;
    scene.add(staticRoot);
    staticRoot.updateMatrixWorld(true);
    staticRoot.traverse(object => {
      if (!object.isMesh) return;
      const role = object.userData.materialRole;
      object.material = materialByRole[role] ?? wallMaterial;
      object.castShadow = role !== 'window' && role !== 'farWindow';
      object.receiveShadow = object.castShadow;
      if (object.userData.collidable) collisionBoxes.push(new THREE.Box3().setFromObject(object));
      if (object.userData.ssrSurface) ssrSurfaces.push(object);
      if (object.userData.causticReceiver) {
        const bounds = new THREE.Box3().setFromObject(object);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        addCausticSurface(center.x, center.z, size.x, size.z, bounds.max.y + .012);
      }
    });

    const water = sceneMetadata.water;
    addWater(water.x, water.z, water.width, water.depth, water.y);

    const sunData = sceneMetadata.sun;
    const sun = new THREE.DirectionalLight(sunData.color, sunData.intensity);
    sun.position.fromArray(sunData.position);
    sun.target.position.fromArray(sunData.target);
    scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -.00012;
    sun.shadow.normalBias = .035;
    sun.shadow.camera.left = -sunData.shadowBounds;
    sun.shadow.camera.right = sunData.shadowBounds;
    sun.shadow.camera.top = sunData.shadowBounds;
    sun.shadow.camera.bottom = -sunData.shadowBounds;
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
    depth: sceneMetadata.water.poolDepth,
    describeLocation() {
      return '夕照水厅';
    },
  };
}
