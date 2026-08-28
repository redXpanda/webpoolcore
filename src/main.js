import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import './style.css';

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const getRenderPixelRatio = () => Math.min(devicePixelRatio, innerWidth < 700 ? 1.25 : 1.75);
renderer.setPixelRatio(getRenderPixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .92;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ebbb7);
scene.fog = new THREE.FogExp2(0x637f7c, 0.0062);
RectAreaLightUniformsLib.init();

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.08, 240);
camera.position.set(0, 1.72, 20);
const controls = new PointerLockControls(camera, document.body);
controls.pointerSpeed = 0.72;

const clock = new THREE.Clock();
const solidBoxes = [];
const waterMeshes = [];
const causticMeshes = [];
const ssrSurfaces = [];
const POOL_DEPTH = 50;
const poolSpecs = [
  { x: 0, z: 2, w: 27, d: 31, y: .3 },
  { x: -36.5, z: -8, w: 15, d: 66, y: .18 },
  { x: 34, z: -29, w: 20, d: 28, y: .48 },
  { x: 34, z: 16, w: 19, d: 18, y: .16 },
  { x: 1, z: -32, w: 39, d: 24, y: .2 },
];
const keys = new Set();
const velocity = new THREE.Vector3();
const moveDir = new THREE.Vector3();
const forwardDir = new THREE.Vector3();
const rightDir = new THREE.Vector3();
let grounded = true;
let lastStep = 0;

const assetUrl = name => `${import.meta.env.BASE_URL}generated/${name}`;
const textureLoader = new THREE.TextureLoader();
const cubeTextureLoader = new THREE.CubeTextureLoader();
const [loadedTextures, reflectionProbe] = await Promise.all([
  Promise.all([
    'tile-albedo.png',
    'tile-normal.png',
    'wet-mask.png',
    'wet-roughness.png',
    'gi-lightmap.png',
    'light-shaft.png',
  ].map(name => textureLoader.loadAsync(assetUrl(name)))),
  cubeTextureLoader.loadAsync([
    'probe-px.png', 'probe-nx.png', 'probe-py.png',
    'probe-ny.png', 'probe-pz.png', 'probe-nz.png',
  ].map(assetUrl)),
]);
const [tileTexture, tileNormalTexture, wetMaskTexture, wetRoughnessTexture, giLightmap, shaftTexture] = loadedTextures;

function configureTexture(texture, { repeat = 1, colorSpace = THREE.NoColorSpace, tiled = true } = {}) {
  texture.colorSpace = colorSpace;
  texture.wrapS = texture.wrapT = tiled ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.repeat.set(repeat, repeat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

configureTexture(tileTexture, { repeat: 3, colorSpace: THREE.SRGBColorSpace });
configureTexture(tileNormalTexture, { repeat: 3 });
configureTexture(wetMaskTexture, { repeat: 3.5 });
configureTexture(wetRoughnessTexture, { repeat: 3.5 });
configureTexture(giLightmap, { colorSpace: THREE.SRGBColorSpace, tiled: false });
configureTexture(shaftTexture, { colorSpace: THREE.SRGBColorSpace, tiled: false });
giLightmap.channel = 1;
reflectionProbe.colorSpace = THREE.SRGBColorSpace;
reflectionProbe.mapping = THREE.CubeReflectionMapping;
reflectionProbe.minFilter = THREE.LinearMipmapLinearFilter;
reflectionProbe.magFilter = THREE.LinearFilter;
reflectionProbe.generateMipmaps = true;
reflectionProbe.needsUpdate = true;

const floorTexture = configureTexture(tileTexture.clone(), { repeat: 14, colorSpace: THREE.SRGBColorSpace });
const floorNormalTexture = configureTexture(tileNormalTexture.clone(), { repeat: 14 });
const tileMat = new THREE.MeshPhysicalMaterial({
  map: tileTexture,
  normalMap: tileNormalTexture,
  normalScale: new THREE.Vector2(.34, -.34),
  lightMap: giLightmap,
  lightMapIntensity: 1.35,
  roughness: .24,
  metalness: 0,
  clearcoat: .32,
  clearcoatRoughness: .18,
  color: 0xffffff,
});
const floorMat = new THREE.MeshPhysicalMaterial({
  map: floorTexture,
  normalMap: floorNormalTexture,
  normalScale: new THREE.Vector2(.22, -.22),
  roughnessMap: wetRoughnessTexture,
  clearcoatMap: wetMaskTexture,
  clearcoatRoughnessMap: wetRoughnessTexture,
  lightMap: giLightmap,
  lightMapIntensity: 1.5,
  envMap: reflectionProbe,
  color: 0xf4fbf9,
  roughness: .56,
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: .24,
  ior: 1.45,
  specularIntensity: .92,
  specularColor: new THREE.Color(0xe8fffb),
  envMapIntensity: .38,
});
const trimMat = new THREE.MeshStandardMaterial({ color: 0x2e716b, roughness: .42 });
const darkTileMat = tileMat.clone(); darkTileMat.color.set(0x9ec5bf);

function box(name, size, pos, material = tileMat, collidable = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...pos);
  const positions = mesh.geometry.attributes.position;
  const lightMapUvs = new Float32Array(positions.count * 2);
  for (let index = 0; index < positions.count; index++) {
    const worldX = positions.getX(index) + mesh.position.x;
    const worldZ = positions.getZ(index) + mesh.position.z;
    lightMapUvs[index * 2] = THREE.MathUtils.clamp((worldX + 46) / 92, 0, 1);
    lightMapUvs[index * 2 + 1] = THREE.MathUtils.clamp((worldZ + 49) / 82, 0, 1);
  }
  mesh.geometry.setAttribute('uv1', new THREE.BufferAttribute(lightMapUvs, 2));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (collidable) solidBoxes.push(new THREE.Box3().setFromObject(mesh));
  return mesh;
}

function buildDeckAroundPools() {
  const xCuts = [-46, 46];
  const zCuts = [-49, 33];
  for (const pool of poolSpecs) {
    xCuts.push(pool.x - pool.w / 2, pool.x + pool.w / 2);
    zCuts.push(pool.z - pool.d / 2, pool.z + pool.d / 2);
  }
  xCuts.sort((a, b) => a - b);
  zCuts.sort((a, b) => a - b);

  for (let xi = 0; xi < xCuts.length - 1; xi++) {
    for (let zi = 0; zi < zCuts.length - 1; zi++) {
      const x1 = xCuts[xi], x2 = xCuts[xi + 1];
      const z1 = zCuts[zi], z2 = zCuts[zi + 1];
      const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      const submerged = poolSpecs.some(pool =>
        Math.abs(cx - pool.x) < pool.w / 2 && Math.abs(cz - pool.z) < pool.d / 2
      );
      if (submerged || x2 - x1 < .01 || z2 - z1 < .01) continue;
      const deck = box('wet-deck', [x2 - x1, .4, z2 - z1], [cx, -.2, cz], floorMat, false);
      ssrSurfaces.push(deck);
    }
  }
}

function addPoolBasin(x, z, w, d, waterY) {
  const bottomY = waterY - POOL_DEPTH;
  const wallHeight = POOL_DEPTH;
  box('pool-bottom', [w, .4, d], [x, bottomY - .2, z], tileMat, false);
  box('pool-wall-west', [.35, wallHeight, d], [x - w / 2, waterY - wallHeight / 2, z], tileMat);
  box('pool-wall-east', [.35, wallHeight, d], [x + w / 2, waterY - wallHeight / 2, z], tileMat);
  box('pool-wall-north', [w, wallHeight, .35], [x, waterY - wallHeight / 2, z - d / 2], tileMat);
  box('pool-wall-south', [w, wallHeight, .35], [x, waterY - wallHeight / 2, z + d / 2], tileMat);
  return bottomY;
}

function addWater(x, z, w, d, y = .34) {
  const bottomY = addPoolBasin(x, z, w, d, y);
  const geo = new THREE.PlaneGeometry(w, d, Math.max(24, Math.floor(w * 1.5)), Math.max(24, Math.floor(d * 1.5)));
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uSceneColor: { value: null },
      uSceneDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCameraNear: { value: camera.near },
      uCameraFar: { value: camera.far },
      uDeep: { value: new THREE.Color(0x3ea6a2) },
      uShallow: { value: new THREE.Color(0xa6e4dc) },
      uReflectionProbe: { value: reflectionProbe },
      uProbePosition: { value: new THREE.Vector3(0, 2.2, -8) },
      uProbeMin: { value: new THREE.Vector3(-46, 0, -49) },
      uProbeMax: { value: new THREE.Vector3(46, 10, 33) },
      uSunDir: { value: new THREE.Vector3(-.45, .82, .35).normalize() },
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vCrest;
      void main() {
        vec3 p = position;
        float p1 = p.x * .82 + p.z * .34 + uTime * 1.35;
        float p2 = p.x * -.28 + p.z * 1.17 - uTime * .92;
        float p3 = length(p.xz) * 1.42 - uTime * 1.65;
        float wave = sin(p1) * .030 + sin(p2) * .020 + sin(p3) * .012;
        float dx = cos(p1) * .030 * .82 + cos(p2) * .020 * -.28 + cos(p3) * .012 * 1.42 * p.x / max(length(p.xz), .01);
        float dz = cos(p1) * .030 * .34 + cos(p2) * .020 * 1.17 + cos(p3) * .012 * 1.42 * p.z / max(length(p.xz), .01);
        p.y += wave;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorldPos = world.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * vec3(-dx, 1.0, -dz));
        vCrest = wave;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform sampler2D uSceneColor;
      uniform sampler2D uSceneDepth;
      uniform vec2 uResolution;
      uniform float uCameraNear;
      uniform float uCameraFar;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform samplerCube uReflectionProbe;
      uniform vec3 uProbePosition;
      uniform vec3 uProbeMin;
      uniform vec3 uProbeMax;
      uniform vec3 uSunDir;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vCrest;
      float viewZFromDepth(float depth) {
        return (uCameraNear * uCameraFar) / ((uCameraFar - uCameraNear) * depth - uCameraFar);
      }
      vec3 boxProjectedDirection(vec3 direction, vec3 worldPosition) {
        vec3 safeDirection = sign(direction) * max(abs(direction), vec3(0.0001));
        vec3 distancesToMin = (uProbeMin - worldPosition) / safeDirection;
        vec3 distancesToMax = (uProbeMax - worldPosition) / safeDirection;
        vec3 distances = mix(distancesToMin, distancesToMax, step(vec3(0.0), safeDirection));
        float distanceToWall = min(min(distances.x, distances.y), distances.z);
        vec3 hitPosition = worldPosition + safeDirection * max(distanceToWall, 0.0);
        return hitPosition - uProbePosition;
      }
      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float fresnel = .025 + .975 * pow(1.0 - ndv, 5.0);
        vec2 screenUV = gl_FragCoord.xy / uResolution;
        float sceneDepth = texture2D(uSceneDepth, screenUV).x;
        float waterViewZ = viewZFromDepth(gl_FragCoord.z);
        float sceneViewZ = viewZFromDepth(sceneDepth);
        float thickness = clamp(waterViewZ - sceneViewZ, 0.0, 50.0);
        float distortionDepth = min(thickness, 5.0);
        vec2 distortion = N.xz * (.009 + distortionDepth * .0012) * (1.0 - fresnel * .65);
        vec2 refractUV = clamp(screenUV + distortion, vec2(.002), vec2(.998));
        float dispersion = .0007 * min(thickness, 3.0);
        vec3 refracted;
        refracted.r = texture2D(uSceneColor, refractUV + N.xz * dispersion).r;
        refracted.g = texture2D(uSceneColor, refractUV).g;
        refracted.b = texture2D(uSceneColor, refractUV - N.xz * dispersion).b;
        vec3 absorption = exp(-thickness * vec3(.009, .0032, .0016));
        refracted = refracted * absorption + uDeep * (1.0 - absorption) * .24;
        vec3 H = normalize(V + normalize(uSunDir));
        float sunGlint = pow(max(dot(N, H), 0.0), 180.0) * 2.4;
        vec3 waterTint = mix(uDeep, uShallow, .72 + vCrest * 3.0);
        vec3 color = mix(refracted, waterTint, .025 + thickness * .0014);
        vec3 reflectionDirection = reflect(-V, N);
        vec3 probeDirection = boxProjectedDirection(reflectionDirection, vWorldPos);
        vec3 reflectedRoom = textureCube(uReflectionProbe, probeDirection).rgb;
        color = mix(color, reflectedRoom, fresnel * .82);
        color += vec3(1.0, .96, .78) * sunGlint;
        gl_FragColor = vec4(color, 1.0);
      }`
  });
  const water = new THREE.Mesh(geo, mat);
  water.position.set(x, y, z);
  scene.add(water);
  waterMeshes.push(water);

  const caustic = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vWorld; void main(){ vec4 world=modelMatrix*vec4(position,1.); vWorld=world.xz; gl_Position=projectionMatrix*viewMatrix*world; }`,
      fragmentShader: `uniform float uTime; varying vec2 vWorld;
        void main(){ vec2 p=vWorld; float a=sin(p.x*2.15+sin(p.y*1.72+uTime)*1.4); float b=sin(p.y*2.42-sin(p.x*1.31-uTime*.8)*1.25); float c=pow(max(0.,a*b),8.); gl_FragColor=vec4(.52,.95,.86,c*.34); }`,
    })
  );
  caustic.rotation.x = -Math.PI / 2;
  caustic.position.set(x, bottomY + .012, z);
  scene.add(caustic);
  causticMeshes.push(caustic);
}

function stripLight(x, y, z, length, axis = 'x', intensity = 16) {
  const geo = new THREE.BoxGeometry(axis === 'x' ? length : .22, .08, axis === 'z' ? length : .22);
  const mat = new THREE.MeshBasicMaterial({ color: 0xeafff7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z); scene.add(mesh);
  const light = new THREE.RectAreaLight(0xddfff8, intensity * .12, axis === 'x' ? length : .22, axis === 'z' ? length : .22);
  light.position.set(x, y - .12, z); light.lookAt(x, 0, z); scene.add(light);
}

function addHighWindows() {
  const glassMat = new THREE.MeshBasicMaterial({ color: 0xeafff8, side: THREE.DoubleSide });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x48716c, roughness: .3 });
  const windowCenters = [-28, -9, 10];
  const windowWidth = 7;

  // Build an actual closed wall around the openings so sunlight only enters through glass.
  box('west-wall-lower', [.6, 5.35, 82], [-46, 2.675, -8], tileMat);
  box('west-wall-upper', [.6, 1.2, 82], [-46, 9.4, -8], tileMat);
  const gaps = [-49, ...windowCenters.flatMap(z => [z - windowWidth / 2, z + windowWidth / 2]), 33];
  for (let i = 0; i < gaps.length - 1; i += 2) {
    const start = gaps[i], end = gaps[i + 1];
    box('west-wall-window-band', [.6, 3.45, end - start], [-46, 7.075, (start + end) / 2], tileMat);
  }
  for (const z of windowCenters) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.2), glassMat);
    pane.rotation.y = Math.PI / 2; pane.position.set(-45.66, 7.05, z); scene.add(pane);
    box('window-top', [.3, .22, 7.6], [-45.35, 8.75, z], frameMat, false).castShadow = false;
    box('window-bottom', [.3, .22, 7.6], [-45.35, 5.35, z], frameMat, false).castShadow = false;
    for (const offset of [-3.7, 0, 3.7]) box('window-frame', [.3, 3.6, .16], [-45.35, 7.05, z + offset], frameMat, false).castShadow = false;
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(38, 5.6), new THREE.MeshBasicMaterial({ map: shaftTexture, transparent: true, opacity: .18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    shaft.position.set(-27, 5.2, z); shaft.rotation.z = -.10; scene.add(shaft);
  }
}

function buildWorld() {
  buildDeckAroundPools();
  box('ceiling', [92, .5, 82], [0, 10.25, -8], tileMat, false);
  box('north', [92, 10, .6], [0, 5, -49], tileMat);
  box('south', [92, 10, .6], [0, 5, 33], tileMat);
  box('east', [.6, 10, 82], [46, 5, -8], tileMat);
  addHighWindows();

  // Central courtyard pool and its raised rim.
  addWater(0, 2, 27, 31, .3);
  box('pool-left', [1.2, .8, 31], [-14.1, .4, 2], tileMat);
  box('pool-right', [1.2, .8, 31], [14.1, .4, 2], tileMat);
  box('pool-north', [29.4, .8, 1.2], [0, .4, -14.1], tileMat);
  box('pool-south', [29.4, .8, 1.2], [0, .4, 18.1], tileMat);
  const centralPoolBottomY = .3 - POOL_DEPTH;
  for (let z = -11; z < 17; z += 4) {
    box('lane', [.12, .035, 2.8], [0, centralPoolBottomY + .018, z], trimMat, false);
  }

  // Left colonnade and narrow flooded gallery.
  for (let z = -38; z <= 20; z += 8) box('column', [1.6, 9.8, 1.6], [-28, 4.9, z], tileMat);
  addWater(-36.5, -8, 15, 66, .18);
  box('gallery-divider-a', [1, 6.8, 24], [-20, 3.4, -32], tileMat);
  box('gallery-divider-b', [1, 6.8, 20], [-20, 3.4, 20], tileMat);
  box('gallery-lintel', [1, 1.6, 18], [-20, 9.2, -6], tileMat);

  // Right side: stepped bath, open passages and a distant chamber.
  box('right-wall-a', [1, 8, 22], [22, 4, -37], tileMat);
  box('right-wall-b', [1, 8, 17], [22, 4, 23.5], tileMat);
  box('right-lintel', [1, 2, 43], [22, 9, -7.5], tileMat);
  addWater(34, -29, 20, 28, .48);
  for (let i = 0; i < 5; i++) box('steps', [20, .25 + i*.14, 2.2], [34, .125 + i*.07, -14.8 - i*2.1], darkTileMat);
  box('far-divider-a', [20, 7.6, .8], [35, 3.8, 5], tileMat);
  box('far-divider-b', [20, 7.6, .8], [35, 3.8, 27], tileMat);
  box('far-lintel', [4, 2.2, .8], [24.5, 8.9, 16], tileMat);
  box('far-lintel-2', [4, 2.2, .8], [45.5, 8.9, 16], tileMat);
  addWater(34, 16, 19, 18, .16);

  // Low sculptural platforms make the scale legible.
  box('island', [8, .65, 5], [-5, .325, -30], tileMat);
  box('island-top', [4, 1.2, 3], [-5, 1.25, -30], darkTileMat);
  addWater(1, -32, 39, 24, .2);

  for (const z of [-39, -23, -7, 9, 25]) {
    stripLight(-34, 9.92, z, 5, 'z', 13);
    stripLight(0, 9.92, z, 9, 'x', 18);
    stripLight(34, 9.92, z, 6, 'x', 14);
  }

  // Static fill approximates baked GI; the directional sun provides the readable shadow direction.
  scene.add(new THREE.AmbientLight(0xb8d0cc, .055));
  const hemi = new THREE.HemisphereLight(0xd8eee9, 0x263f3c, .18); scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffefd0, 5.2);
  sun.position.set(-72, 14, 18);
  sun.target.position.set(5, 0, -8);
  scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -.00015;
  sun.shadow.normalBias = .035;
  sun.shadow.camera.left = -54; sun.shadow.camera.right = 54;
  sun.shadow.camera.top = 54; sun.shadow.camera.bottom = -54; sun.shadow.camera.near = 1; sun.shadow.camera.far = 110;
  scene.add(sun);
}

class Soundscape {
  constructor() { this.ctx = null; this.master = null; this.muted = false; this.nextDrip = 0; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain(); this.master.gain.value = .32; this.master.connect(this.ctx.destination);
    const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 4, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0); for (let i=0;i<data.length;i++) data[i] = Math.random()*2-1;
    const noise = this.ctx.createBufferSource(); noise.buffer=noiseBuffer; noise.loop=true;
    const filter = this.ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=420;
    const gain = this.ctx.createGain(); gain.gain.value=.038; noise.connect(filter).connect(gain).connect(this.master); noise.start();
    const hum = this.ctx.createOscillator(); hum.type='sine'; hum.frequency.value=52;
    const humGain=this.ctx.createGain(); humGain.gain.value=.025; hum.connect(humGain).connect(this.master); hum.start();
  }
  tone(freq, duration, volume, type='sine') {
    if (!this.ctx || this.muted) return;
    const now=this.ctx.currentTime, osc=this.ctx.createOscillator(), gain=this.ctx.createGain();
    osc.type=type; osc.frequency.setValueAtTime(freq,now); osc.frequency.exponentialRampToValueAtTime(freq*.58,now+duration);
    gain.gain.setValueAtTime(volume,now); gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
    osc.connect(gain).connect(this.master); osc.start(now); osc.stop(now+duration);
  }
  step(wet=false) { this.tone(wet ? 120 : 82, wet ? .16 : .09, wet ? .09 : .045, wet ? 'sine' : 'triangle'); }
  update(time) { if (time > this.nextDrip && this.ctx) { this.tone(480+Math.random()*700, .45, .018); this.nextDrip=time+2.5+Math.random()*5; } }
  toggle() { this.muted=!this.muted; if(this.master) this.master.gain.setTargetAtTime(this.muted?0:.32,this.ctx.currentTime,.08); return this.muted; }
}

buildWorld();
const soundscape = new Soundscape();

const renderPixelRatio = getRenderPixelRatio();
const postWidth = Math.max(1, Math.round(innerWidth * renderPixelRatio));
const postHeight = Math.max(1, Math.round(innerHeight * renderPixelRatio));
const refractionTarget = new THREE.WebGLRenderTarget(postWidth, postHeight, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  type: THREE.HalfFloatType,
  depthBuffer: true,
});
refractionTarget.depthTexture = new THREE.DepthTexture(postWidth, postHeight, THREE.UnsignedShortType);
const ssrPass = new SSRPass({
  renderer,
  scene,
  camera,
  width: postWidth,
  height: postHeight,
  selects: ssrSurfaces,
});
ssrPass.opacity = .62;
ssrPass.maxDistance = 34;
ssrPass.thickness = .11;
ssrPass.blur = true;
ssrPass.distanceAttenuation = true;
ssrPass.fresnel = true;
ssrPass.infiniteThick = false;
ssrPass.metalnessOnMaterial.map = wetMaskTexture;
ssrPass.ssrMaterial.fragmentShader = ssrPass.ssrMaterial.fragmentShader.replace(
  'vec4 reflectColor=texture2D(tDiffuse,uv);',
  `#ifdef SELECTIVE
    op *= metalness;
  #endif
  vec4 reflectColor=texture2D(tDiffuse,uv);`,
);
ssrPass.ssrMaterial.needsUpdate = true;

const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderPixelRatio);

const whiteBalancePass = new ShaderPass({
  name: 'WhiteBalanceShader',
  uniforms: {
    tDiffuse: { value: null },
    uBalance: { value: new THREE.Vector3(1.018, 1.004, .966) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec3 uBalance;
    varying vec2 vUv;
    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(max(source.rgb * uBalance, 0.0), source.a);
    }`,
});

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(postWidth, postHeight),
  .32,
  .42,
  1.08,
);

composer.addPass(ssrPass);
composer.addPass(whiteBalancePass);
composer.addPass(bloomPass);
composer.addPass(new SMAAPass());
composer.addPass(new OutputPass());

const playerBox = new THREE.Box3();
function collides(position) {
  playerBox.min.set(position.x-.28, .05, position.z-.28);
  playerBox.max.set(position.x+.28, 1.82, position.z+.28);
  return solidBoxes.some(b => b.intersectsBox(playerBox));
}

function updatePlayer(dt, elapsed) {
  if (!controls.isLocked) return;
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 6.5 : 3.8;
  const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
  const side = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  camera.getWorldDirection(forwardDir);
  forwardDir.y = 0;
  forwardDir.normalize();
  rightDir.crossVectors(forwardDir, camera.up).normalize();
  moveDir.set(0, 0, 0).addScaledVector(forwardDir, forward).addScaledVector(rightDir, side);
  if (moveDir.lengthSq() > 0) {
    moveDir.normalize().multiplyScalar(speed * dt);
    const candidate = camera.position.clone(); candidate.x += moveDir.x;
    if (!collides(candidate)) camera.position.x = candidate.x;
    candidate.copy(camera.position); candidate.z += moveDir.z;
    if (!collides(candidate)) camera.position.z = candidate.z;
    const interval = speed > 4 ? .31 : .48;
    if (elapsed-lastStep > interval) { soundscape.step(true); lastStep=elapsed; }
  }
  velocity.y -= 17 * dt;
  camera.position.y += velocity.y * dt;
  if (camera.position.y <= 1.72) { camera.position.y=1.72; velocity.y=0; grounded=true; }
}

const locationName = document.querySelector('#location-name');
const depth = document.querySelector('#depth');
function updateLocation() {
  const {x,z}=camera.position;
  let name='深水中庭';
  if(x < -22){ name='回声深井'; }
  else if(x > 22 && z < -10){ name='阶梯深池'; }
  else if(x > 22 && z > 5){ name='静默水井'; }
  else if(z < -18){ name='沉降大厅'; }
  const value=POOL_DEPTH.toFixed(2);
  locationName.textContent=name; depth.textContent=`水深 ${value} M`;
}

function animate() {
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05), elapsed=clock.elapsedTime;
  updatePlayer(dt, elapsed); updateLocation(); soundscape.update(elapsed);
  for(const water of waterMeshes) {
    water.material.uniforms.uTime.value=elapsed;
    water.visible=false;
  }
  for(const caustic of causticMeshes) caustic.material.uniforms.uTime.value=elapsed;
  renderer.setRenderTarget(refractionTarget);
  renderer.clear();
  renderer.render(scene,camera);
  for(const water of waterMeshes) {
    water.material.uniforms.uSceneColor.value=refractionTarget.texture;
    water.material.uniforms.uSceneDepth.value=refractionTarget.depthTexture;
    water.material.uniforms.uResolution.value.set(ssrPass.width,ssrPass.height);
    water.visible=true;
  }
  for(const caustic of causticMeshes) caustic.visible=false;
  composer.render(dt);
  for(const caustic of causticMeshes) caustic.visible=true;
}

const entry=document.querySelector('#entry'), hud=document.querySelector('#hud'), pause=document.querySelector('#pause');
document.querySelector('#enter').addEventListener('click',()=>{ soundscape.start(); controls.lock(); });
document.querySelector('#resume').addEventListener('click',()=>controls.lock());
controls.addEventListener('lock',()=>{ entry.classList.add('is-hidden'); pause.classList.add('is-hidden'); hud.classList.remove('is-hidden'); hud.setAttribute('aria-hidden','false'); });
controls.addEventListener('unlock',()=>{ if(entry.classList.contains('is-hidden')) { pause.classList.remove('is-hidden'); pause.setAttribute('aria-hidden','false'); hud.classList.add('is-hidden'); } });
document.querySelector('#sound').addEventListener('click',e=>{ const muted=soundscape.toggle(); e.currentTarget.classList.toggle('muted',muted); e.currentTarget.ariaLabel=muted?'开启声音':'关闭声音'; e.currentTarget.title=e.currentTarget.ariaLabel; });

addEventListener('keydown',e=>{ keys.add(e.code); if(e.code==='Space'&&grounded&&controls.isLocked){velocity.y=5.4;grounded=false;soundscape.tone(160,.12,.04);} });
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  const pixelRatio=getRenderPixelRatio();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth,innerHeight);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(innerWidth,innerHeight);
  const width=Math.max(1,Math.round(innerWidth*pixelRatio));
  const height=Math.max(1,Math.round(innerHeight*pixelRatio));
  refractionTarget.setSize(width,height);
});

animate();
setTimeout(()=>document.querySelector('#loading').classList.add('is-hidden'),700);
