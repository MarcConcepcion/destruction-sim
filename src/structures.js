/**
 * Structures: owns every placed construction piece (mesh + rigid body), the
 * undo stack, and the "restore the layout" operation.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { MATERIALS } from './materials.js';
import { PIECE_BY_ID, getPieceGeometry, physicsShape, pieceVolume } from './pieces.js';

export class Structures {
  constructor({ scene, physics, materials, settings }) {
    this.scene = scene;
    this.physics = physics;
    this.materials = materials;
    this.settings = settings;
    /** Placement order (oldest first) - drives undo and the piece budget. */
    this.list = [];
    this._variant = 0;
  }

  get count() {
    return this.list.length;
  }

  get isFull() {
    return this.list.length >= CONFIG.MAX_PIECES;
  }

  /** Mass in kg that a piece would get with the current density setting. */
  massOf(typeId, materialId) {
    return pieceVolume(PIECE_BY_ID[typeId]) * this.settings.pieceDensity * MATERIALS[materialId].density;
  }

  /**
   * Create a piece. Returns the physics entity, or null when the piece budget is full.
   * The pose is remembered as the piece's "home" for Restore.
   */
  addPiece({ typeId, materialId, position, quaternion }) {
    if (this.isFull) return null;
    const def = PIECE_BY_ID[typeId];
    const mat = MATERIALS[materialId];

    const mesh = new THREE.Mesh(getPieceGeometry(def), this.materials.piece(materialId, this._variant++));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const entity = this.physics.createEntity({
      kind: 'piece',
      shape: physicsShape(def),
      mass: this.massOf(typeId, materialId),
      position,
      quaternion,
      friction: mat.friction,
      restitution: mat.restitution,
      linearDamping: 0.02,
      angularDamping: 0.05,
      persistent: true,
      mesh,
      data: { typeId, materialId },
      onRemove: (e) => {
        e.mesh.removeFromParent(); // geometry + material are shared: nothing to dispose
        const i = this.list.indexOf(e);
        if (i >= 0) this.list.splice(i, 1);
      },
    });
    this.list.push(entity);
    return entity;
  }

  removePiece(entity) {
    this.physics.removeEntity(entity);
  }

  undo() {
    const last = this.list[this.list.length - 1];
    if (!last) return false;
    this.removePiece(last);
    return true;
  }

  clearAll() {
    for (const e of [...this.list]) this.physics.removeEntity(e);
  }

  /** Put every piece (including ones that fell out of the world) back where it was built. */
  restoreAll() {
    for (const e of this.list) this.physics.restoreEntity(e);
  }
}
