/**
 * Camera controls: OrbitControls (drag = orbit, right-drag = pan, wheel = zoom,
 * touch: one finger orbit, two fingers pinch/pan) plus WASD ground-plane panning.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from './config.js';

const HOME_POS = new THREE.Vector3(17, 10, 21);
const HOME_TARGET = new THREE.Vector3(0, 3, 0);
const LIMIT = CONFIG.BUILD_HALF + 10;

export class CameraRig {
  constructor(camera, domElement, keys) {
    this.camera = camera;
    this.keys = keys; // Set of currently held key names (see input.js)

    const c = new OrbitControls(camera, domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.09;
    c.rotateSpeed = 0.8;
    c.zoomSpeed = 0.9;
    c.minDistance = 3;
    c.maxDistance = 75;
    c.maxPolarAngle = Math.PI * 0.495; // never dip below the ground
    c.screenSpacePanning = false; // pan along the ground plane, not the view plane
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls = c;
    this.reset();

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move = new THREE.Vector3();
  }

  get target() {
    return this.controls.target;
  }

  reset() {
    this.camera.position.copy(HOME_POS);
    this.controls.target.copy(HOME_TARGET);
    this.controls.update();
  }

  /** Move the camera to a given position/look-at point (used to frame wide structures). */
  frame(position, target) {
    this.camera.position.set(position[0], position[1], position[2]);
    this.controls.target.set(target[0], target[1], target[2]);
    this.controls.update();
  }

  update(dt) {
    const k = this.keys;
    const f = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0);
    const r = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    const c = this.controls;
    if (f || r) {
      // Pan relative to where the camera is looking, flattened onto the ground.
      this._fwd.subVectors(c.target, this.camera.position).setY(0);
      if (this._fwd.lengthSq() < 1e-6) this._fwd.set(0, 0, -1);
      this._fwd.normalize();
      this._right.crossVectors(this._fwd, this.camera.up).normalize();
      const dist = this.camera.position.distanceTo(c.target);
      const speed = (6 + dist * 0.7) * (k.has('shift') ? 2.5 : 1) * dt;
      this._move.set(0, 0, 0).addScaledVector(this._fwd, f * speed).addScaledVector(this._right, r * speed);
      this.camera.position.add(this._move);
      c.target.add(this._move);
    }
    // Keep the focus point inside the playable area.
    const t = c.target;
    const cx = THREE.MathUtils.clamp(t.x, -LIMIT, LIMIT) - t.x;
    const cz = THREE.MathUtils.clamp(t.z, -LIMIT, LIMIT) - t.z;
    const cy = THREE.MathUtils.clamp(t.y, 0, 25) - t.y;
    if (cx || cz || cy) {
      this._move.set(cx, cy, cz);
      t.add(this._move);
      this.camera.position.add(this._move);
    }
    c.update();
  }

  dispose() {
    this.controls.dispose();
  }
}
