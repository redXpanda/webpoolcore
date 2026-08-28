import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { sunsetPoolHall } from './scenes/sunsetPoolHall.js';
import './style.css';

// Swap this definition to replace the environment without changing runtime logic.
const activeSceneDefinition = sunsetPoolHall;
const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const getRenderPixelRatio = () => Math.min(devicePixelRatio, innerWidth < 700 ? 1.25 : 1.75);
renderer.setPixelRatio(getRenderPixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = activeSceneDefinition.render.exposure;

const cameraConfig = activeSceneDefinition.camera;
const camera = new THREE.PerspectiveCamera(cameraConfig.fov, innerWidth / innerHeight, cameraConfig.near, cameraConfig.far);
camera.position.fromArray(cameraConfig.spawn);
const controls = new PointerLockControls(camera, document.body);
controls.pointerSpeed = .72;

async function loadSceneAssets(assetManifest) {
  const textureLoader = new THREE.TextureLoader();
  const cubeTextureLoader = new THREE.CubeTextureLoader();
  const gltfLoader = new GLTFLoader();
  const assetUrl = name => `${import.meta.env.BASE_URL}${assetManifest.basePath}/${name}`;
  const assets = {};
  await Promise.all([
    ...Object.entries(assetManifest.textures).map(async ([key, file]) => {
      assets[key] = await textureLoader.loadAsync(assetUrl(file));
    }),
    ...Object.entries(assetManifest.cubeTextures).map(async ([key, files]) => {
      assets[key] = await cubeTextureLoader.loadAsync(files.map(assetUrl));
    }),
    ...Object.entries(assetManifest.models ?? {}).map(async ([key, file]) => {
      assets[key] = await gltfLoader.loadAsync(assetUrl(file));
    }),
    ...Object.entries(assetManifest.data ?? {}).map(async ([key, file]) => {
      const response = await fetch(assetUrl(file));
      if (!response.ok) throw new Error(`Failed to load ${file}: ${response.status}`);
      assets[key] = await response.json();
    }),
  ]);
  return assets;
}

const assets = await loadSceneAssets(activeSceneDefinition.assets);
const world = activeSceneDefinition.create({ renderer, camera, assets });
const {
  scene,
  collisionBoxes,
  waterMeshes,
  causticMeshes,
  ssrSurfaces,
  ssrMask,
} = world;

class Soundscape {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.nextDrip = 0;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = .32;
    this.master.connect(this.ctx.destination);
    const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 4, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = this.ctx.createGain();
    gain.gain.value = .038;
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start();
    const hum = this.ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 52;
    const humGain = this.ctx.createGain();
    humGain.gain.value = .025;
    hum.connect(humGain).connect(this.master);
    hum.start();
  }

  tone(frequency, duration, volume, type = 'sine') {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * .58, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  step() {
    this.tone(120, .16, .09);
  }

  update(time) {
    if (time > this.nextDrip && this.ctx) {
      this.tone(480 + Math.random() * 700, .45, .018);
      this.nextDrip = time + 2.5 + Math.random() * 5;
    }
  }

  toggle() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : .32, this.ctx.currentTime, .08);
    return this.muted;
  }
}

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
ssrPass.metalnessOnMaterial.map = ssrMask;
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
    uBalance: { value: new THREE.Vector3(1.055, .995, .91) },
  },
  vertexShader: `varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `uniform sampler2D tDiffuse;
    uniform vec3 uBalance;
    varying vec2 vUv;
    void main(){
      vec4 source = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(max(source.rgb * uBalance, 0.0), source.a);
    }`,
});
const bloomPass = new UnrealBloomPass(new THREE.Vector2(postWidth, postHeight), .42, .46, 1.12);
composer.addPass(ssrPass);
composer.addPass(whiteBalancePass);
composer.addPass(bloomPass);
composer.addPass(new SMAAPass());
composer.addPass(new OutputPass());

const keys = new Set();
const velocity = new THREE.Vector3();
const moveDirection = new THREE.Vector3();
const forwardDirection = new THREE.Vector3();
const rightDirection = new THREE.Vector3();
const playerBox = new THREE.Box3();
const clock = new THREE.Clock();
const soundscape = new Soundscape();
let grounded = true;
let lastStep = 0;

function collides(position) {
  playerBox.min.set(position.x - .28, .05, position.z - .28);
  playerBox.max.set(position.x + .28, cameraConfig.eyeHeight + .1, position.z + .28);
  return collisionBoxes.some(box => box.intersectsBox(playerBox));
}

function updatePlayer(deltaTime, elapsed) {
  if (!controls.isLocked) return;
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 6.5 : 3.8;
  const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
  const side = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  camera.getWorldDirection(forwardDirection);
  forwardDirection.y = 0;
  forwardDirection.normalize();
  rightDirection.crossVectors(forwardDirection, camera.up).normalize();
  moveDirection.set(0, 0, 0).addScaledVector(forwardDirection, forward).addScaledVector(rightDirection, side);
  if (moveDirection.lengthSq() > 0) {
    moveDirection.normalize().multiplyScalar(speed * deltaTime);
    const candidate = camera.position.clone();
    candidate.x += moveDirection.x;
    if (!collides(candidate)) camera.position.x = candidate.x;
    candidate.copy(camera.position);
    candidate.z += moveDirection.z;
    if (!collides(candidate)) camera.position.z = candidate.z;
    const interval = speed > 4 ? .31 : .48;
    if (elapsed - lastStep > interval) {
      soundscape.step();
      lastStep = elapsed;
    }
  }
  velocity.y -= 17 * deltaTime;
  camera.position.y += velocity.y * deltaTime;
  if (camera.position.y <= cameraConfig.eyeHeight) {
    camera.position.y = cameraConfig.eyeHeight;
    velocity.y = 0;
    grounded = true;
  }
}

const locationName = document.querySelector('#location-name');
const depthLabel = document.querySelector('#depth');
function updateLocation() {
  locationName.textContent = world.describeLocation(camera.position);
  depthLabel.textContent = `水深 ${world.depth.toFixed(2)} M`;
}

function animate() {
  requestAnimationFrame(animate);
  const deltaTime = Math.min(clock.getDelta(), .05);
  const elapsed = clock.elapsedTime;
  updatePlayer(deltaTime, elapsed);
  updateLocation();
  soundscape.update(elapsed);
  world.update?.(deltaTime, elapsed);

  for (const water of waterMeshes) {
    water.material.uniforms.uTime.value = elapsed;
    water.visible = false;
  }
  for (const caustic of causticMeshes) caustic.material.uniforms.uTime.value = elapsed;
  renderer.setRenderTarget(refractionTarget);
  renderer.clear();
  renderer.render(scene, camera);
  for (const water of waterMeshes) {
    water.material.uniforms.uSceneColor.value = refractionTarget.texture;
    water.material.uniforms.uSceneDepth.value = refractionTarget.depthTexture;
    water.material.uniforms.uResolution.value.set(refractionTarget.width, refractionTarget.height);
    water.visible = true;
  }
  for (const caustic of causticMeshes) caustic.visible = false;
  composer.render(deltaTime);
  for (const caustic of causticMeshes) caustic.visible = true;
}

const entry = document.querySelector('#entry');
const hud = document.querySelector('#hud');
const pause = document.querySelector('#pause');
document.querySelector('#enter').addEventListener('click', () => {
  soundscape.start();
  controls.lock();
});
document.querySelector('#resume').addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => {
  entry.classList.add('is-hidden');
  pause.classList.add('is-hidden');
  hud.classList.remove('is-hidden');
  hud.setAttribute('aria-hidden', 'false');
});
controls.addEventListener('unlock', () => {
  if (entry.classList.contains('is-hidden')) {
    pause.classList.remove('is-hidden');
    pause.setAttribute('aria-hidden', 'false');
    hud.classList.add('is-hidden');
  }
});
document.querySelector('#sound').addEventListener('click', event => {
  const muted = soundscape.toggle();
  event.currentTarget.classList.toggle('muted', muted);
  event.currentTarget.ariaLabel = muted ? '开启声音' : '关闭声音';
  event.currentTarget.title = event.currentTarget.ariaLabel;
});
addEventListener('keydown', event => {
  keys.add(event.code);
  if (event.code === 'Space' && grounded && controls.isLocked) {
    velocity.y = 5.4;
    grounded = false;
    soundscape.tone(160, .12, .04);
  }
});
addEventListener('keyup', event => keys.delete(event.code));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  const pixelRatio = getRenderPixelRatio();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(innerWidth, innerHeight);
  const width = Math.max(1, Math.round(innerWidth * pixelRatio));
  const height = Math.max(1, Math.round(innerHeight * pixelRatio));
  refractionTarget.setSize(width, height);
});

animate();
setTimeout(() => document.querySelector('#loading').classList.add('is-hidden'), 700);
