/**
 * Build mode: a translucent preview follows the pointer, snaps to a grid, rests
 * exactly on whatever is underneath, turns red when the spot is blocked, and
 * places a real rigid body on click. "Erase" removes the hovered piece.
 *
 * Where the preview rests is found with physics queries (ray + downward
 * shape-cast), not mesh raycasts, so what you see is exactly where the piece
 * will settle.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { MATERIALS } from './materials.js';
import { PIECES, getPieceEdges, getPieceGeometry, physicsShape, worldHalfExtents } from './pieces.js';

const ERASE = 'erase';
const UP = new THREE.Vector3(0, 1, 0);
const TILT_AXES = [null, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)];

export class Builder {
  constructor({ scene, camera, physics, structures, materials, settings, pointer, raycaster }) {
    Object.assign(this, { scene, camera, physics, structures, materials, settings, pointer, raycaster });
    this.active = true;
    this.slot = 1; // index into PIECES, or ERASE
    this.pieceIndex = 1; // brick
    this.erase = false;
    this.yaw = 0;
    this.tilt = 0; // 0 = upright, 1 = on its side (X), 2 = on its side (Z)

    this.valid = false;
    this.placement = null; // {position, quaternion} of the last computed preview
    this.hovered = null; // entity under the cursor while erasing

    this.ghost = new THREE.Mesh(getPieceGeometry(PIECES[this.pieceIndex]), materials.ghostOK);
    this.ghost.renderOrder = 5;
    this.ghostEdges = new THREE.LineSegments(getPieceEdges(PIECES[this.pieceIndex]), materials.ghostEdge);
    this.ghost.add(this.ghostEdges);
    this.ghost.visible = false;
    scene.add(this.ghost);

    this.outline = new THREE.Mesh(getPieceGeometry(PIECES[0]), materials.hoverErase);
    this.outline.renderOrder = 5;
    this.outline.visible = false;
    scene.add(this.outline);

    this._q = new THREE.Quaternion();
    this._qa = new THREE.Quaternion();
    this._he = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this.info = '';
  }

  get def() {
    return PIECES[this.pieceIndex];
  }

  // ----------------------------------------------------------- state changes ----
  setActive(on) {
    this.active = on;
    if (!on) this._hide();
  }

  /** slot 0..6 = piece, 7 = erase */
  select(slot) {
    if (slot === PIECES.length) {
      this.erase = true;
    } else if (slot >= 0 && slot < PIECES.length) {
      this.erase = false;
      this.pieceIndex = slot;
      this.ghost.geometry = getPieceGeometry(this.def);
      this.ghostEdges.geometry = getPieceEdges(this.def);
    }
    this.slot = slot;
    this._hide();
  }

  rotate(dir, fine) {
    const step = fine ? Math.PI / 12 : Math.PI / 2; // 15 deg with Shift, otherwise 90 deg
    this.yaw = (this.yaw + dir * step) % (Math.PI * 2);
  }

  cycleTilt() {
    this.tilt = (this.tilt + 1) % TILT_AXES.length;
  }

  /** Orientation = yaw about world Y, applied after the tilt that lays a piece on its side. */
  orientation(out = this._q) {
    out.setFromAxisAngle(UP, this.yaw);
    const axis = TILT_AXES[this.tilt];
    if (axis) out.multiply(this._qa.setFromAxisAngle(axis, Math.PI / 2));
    return out;
  }

  _hide() {
    this.ghost.visible = false;
    this.outline.visible = false;
    this.hovered = null;
    this.valid = false;
    this.info = '';
  }

  // ------------------------------------------------------------------ frame ----
  update() {
    if (!this.active || !this.pointer.inside) {
      if (this.ghost.visible || this.outline.visible) this._hide();
      return;
    }
    this.raycaster.setFromCamera(this.pointer.ndc, this.camera);
    if (this.erase) this._updateErase();
    else this._updatePreview();
  }

  _updateErase() {
    this.ghost.visible = false;
    const { origin, direction } = this.raycaster.ray;
    const hit = this.physics.pick(origin, direction, 300, (e) => e.kind === 'piece');
    const e = hit && hit.entity.kind === 'piece' ? hit.entity : null;
    this.hovered = e;
    if (!e) {
      this.outline.visible = false;
      this.info = 'Erase: point at a piece and click to remove it';
      return;
    }
    const m = e.mesh;
    this.outline.geometry = m.geometry;
    this.outline.position.copy(m.position);
    this.outline.quaternion.copy(m.quaternion);
    this.outline.scale.setScalar(1.04);
    this.outline.visible = true;
    this.info = `Erase ${MATERIALS[e.data.materialId].name} ${e.data.typeId} - ${Math.round(e.mass)} kg`;
  }

  _updatePreview() {
    this.outline.visible = false;
    const { origin, direction } = this.raycaster.ray;
    // Build on pieces and the ground; projectiles and the crane ball are ignored.
    const hit = this.physics.pick(origin, direction, 300, (e) => e.kind === 'piece' || e.kind === 'ground');
    if (!hit) {
      this.ghost.visible = false;
      this.valid = false;
      return;
    }

    const def = this.def;
    const q = this.orientation();
    const he = worldHalfExtents(def, q, this._he);
    const n = hit.normal;
    const snap = this.settings.snap;
    const g = CONFIG.GRID;
    const snapV = (v) => Math.round(v / g) * g;

    let x = hit.point.x;
    let z = hit.point.z;
    if (n.y > 0.5 || n.y < -0.5) {
      if (snap) { x = snapV(x); z = snapV(z); }
    } else {
      // Side face: stand the piece off the wall so it touches without overlapping (1 cm gap),
      // snapping only along the wall.
      const hn = Math.hypot(n.x, n.z) || 1;
      const nx = n.x / hn;
      const nz = n.z / hn;
      const reach = Math.abs(nx) * he.x + Math.abs(nz) * he.z + 0.01;
      x += nx * reach;
      z += nz * reach;
      if (snap) {
        if (Math.abs(nx) > 0.7) z = snapV(z);
        else if (Math.abs(nz) > 0.7) x = snapV(x);
      }
    }

    // Drop the piece straight down from just above the hit until it rests on something.
    const startY = n.y < -0.5 ? hit.point.y - he.y - 0.05 : hit.point.y + he.y + 0.4;
    const shape = physicsShape(def);
    const quat = { x: q.x, y: q.y, z: q.z, w: q.w };
    const toi = this.physics.castShapeDown(shape, { x, y: startY, z }, quat, startY + 5);
    let y = startY;
    let valid = toi !== null;
    if (toi !== null) y = startY - toi + 0.004; // 4 mm of air so it never spawns interpenetrating

    const inBounds = Math.abs(x) <= CONFIG.BUILD_HALF && Math.abs(z) <= CONFIG.BUILD_HALF;
    if (valid) {
      valid = inBounds && !this.physics.overlaps(shape, { x, y, z }, quat, 0.96);
    }
    // A collider created this very frame is not queryable until the next physics tick.
    if (this.physics.queriesDirty && !this.physics.paused) valid = false;
    valid = valid && !this.structures.isFull;

    this.valid = valid;
    this.placement = { position: { x, y, z }, quaternion: quat };
    this.ghost.visible = true;
    this.ghost.position.set(x, y, z);
    this.ghost.quaternion.copy(q);
    this.ghost.material = valid ? this.materials.ghostOK : this.materials.ghostBad;

    const matId = this.settings.material;
    const kg = Math.round(this.structures.massOf(def.id, matId));
    this.info = this.structures.isFull
      ? `Piece limit reached (${CONFIG.MAX_PIECES}) - erase or clear something`
      : `${MATERIALS[matId].name} ${def.name.toLowerCase()} - ${kg} kg${valid ? '' : ' - blocked'}`;
  }

  // ------------------------------------------------------------------ click ----
  /** @returns {'placed'|'erased'|'blocked'|'full'|null} */
  primary() {
    if (!this.active) return null;
    if (this.erase) {
      if (!this.hovered) return null;
      this.structures.removePiece(this.hovered);
      this.hovered = null;
      this.outline.visible = false;
      return 'erased';
    }
    if (this.structures.isFull) return 'full';
    if (!this.ghost.visible || !this.valid || !this.placement) return 'blocked';
    this.structures.addPiece({
      typeId: this.def.id,
      materialId: this.settings.material,
      position: this.placement.position,
      quaternion: this.placement.quaternion,
    });
    this.valid = false; // wait for the next tick before another piece can go here
    return 'placed';
  }

  dispose() {
    this.ghost.removeFromParent();
    this.outline.removeFromParent();
  }
}
