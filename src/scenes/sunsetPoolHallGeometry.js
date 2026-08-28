import * as THREE from 'three';
import {
  BAKE_ROOM,
  STATIC_BAKE_BOXES,
} from './sunsetPoolHallBakeData.js';

const ROOM_CENTER_Z = (BAKE_ROOM.minZ + BAKE_ROOM.maxZ) / 2;
const placeholderMaterials = new Map();

function placeholderMaterial(role) {
  if (!placeholderMaterials.has(role)) {
    placeholderMaterials.set(role, new THREE.MeshStandardMaterial({ name: role, color: 0x808080 }));
  }
  return placeholderMaterials.get(role);
}

function materialRole(name) {
  if (name === 'wet-deck') return 'wetFloor';
  if (name === 'ceiling' || name === 'ceiling-beam' || name === 'colonnade-lintel') return 'ceiling';
  if (name.startsWith('submerged-')) return 'submerged';
  if (name.startsWith('pool-bottom') || name.startsWith('pool-wall-')) return 'tile';
  return 'wall';
}

function isCollidable(name) {
  return name !== 'wet-deck'
    && name !== 'pool-bottom'
    && name !== 'ceiling'
    && name !== 'ceiling-beam'
    && name !== 'colonnade-lintel'
    && !name.startsWith('submerged-');
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

function addArchedWall(group, side, centers, width) {
  const west = side === 'west';
  const shape = new THREE.Shape();
  shape.moveTo(-42, 0);
  shape.lineTo(42, 0);
  shape.lineTo(42, BAKE_ROOM.maxY);
  shape.lineTo(-42, BAKE_ROOM.maxY);
  shape.closePath();
  const sill = .58;
  const spring = 8.4 - width / 2;
  for (const worldZ of centers) {
    const localCenter = west ? ROOM_CENTER_Z - worldZ : worldZ - ROOM_CENTER_Z;
    shape.holes.push(archHole(localCenter, width, sill, spring));
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1.1,
    bevelEnabled: true,
    bevelSize: .07,
    bevelThickness: .055,
    bevelSegments: 2,
    curveSegments: 32,
  });
  const wall = new THREE.Mesh(geometry, placeholderMaterial('wall'));
  wall.name = `${side}-arched-wall`;
  wall.rotation.y = west ? Math.PI / 2 : -Math.PI / 2;
  wall.position.set(west ? BAKE_ROOM.minX : BAKE_ROOM.maxX, 0, ROOM_CENTER_Z);
  wall.userData = { materialRole: 'wall', collidable: true, contributeGI: true };
  group.add(wall);

  for (const worldZ of centers) {
    const pane = new THREE.Mesh(new THREE.ShapeGeometry(archShape(width * .92, sill, spring)), placeholderMaterial('window'));
    pane.name = `${side}-window`;
    pane.rotation.y = west ? Math.PI / 2 : -Math.PI / 2;
    pane.position.set(west ? BAKE_ROOM.minX + .05 : BAKE_ROOM.maxX - .05, 0, worldZ);
    pane.userData = { materialRole: 'window', collidable: false, contributeGI: false };
    group.add(pane);
  }
}

function addFarWindowPanes(group) {
  const cuts = [-32, -27, -18, -8, 7, 17, 27, 32];
  for (let index = 0; index < cuts.length - 1; index++) {
    const left = cuts[index] + .58;
    const right = cuts[index + 1] - .58;
    if (right <= left) continue;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(right - left, 7.35), placeholderMaterial('farWindow'));
    pane.name = 'far-window';
    pane.position.set((left + right) / 2, 4.35, BAKE_ROOM.minZ + .36);
    pane.userData = { materialRole: 'farWindow', collidable: false, contributeGI: false };
    group.add(pane);
  }
}

export function buildSunsetPoolHallGeometry() {
  const group = new THREE.Group();
  group.name = 'sunset-pool-hall-static';
  for (let index = 0; index < STATIC_BAKE_BOXES.length; index++) {
    const box = STATIC_BAKE_BOXES[index];
    const geometry = new THREE.BoxGeometry(...box.size);
    const role = materialRole(box.name);
    const mesh = new THREE.Mesh(geometry, placeholderMaterial(role));
    mesh.name = `${box.name}-${index}`;
    mesh.position.fromArray(box.position);
    mesh.userData = {
      sourceName: box.name,
      materialRole: role,
      collidable: isCollidable(box.name),
      contributeGI: true,
      ssrSurface: box.name === 'wet-deck',
      causticReceiver: box.name.startsWith('submerged-') || box.name === 'pool-bottom',
      lightmapBoxIndex: index,
    };
    group.add(mesh);
  }
  addArchedWall(group, 'west', [-40, -24, -8, 8, 24], 7.2);
  addArchedWall(group, 'east', [-42, -32, -22, -12, -2, 8, 18, 28], 3.4);
  addFarWindowPanes(group);
  return group;
}

export function createSunsetPoolHallMetadata(lightmap = null) {
  return {
    version: 1,
    sceneId: 'sunset-pool-hall',
    lightmap,
    room: { ...BAKE_ROOM },
    water: { x: 0, y: .42, z: -8, width: 57, depth: 77, poolDepth: 50 },
    sun: {
      color: '#ff8e3c',
      intensity: 6.8,
      position: [58, 13, 18],
      target: [-12, 0, -19],
      shadowBounds: 54,
    },
  };
}
