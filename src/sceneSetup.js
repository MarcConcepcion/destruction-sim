/**
 * Renderer, scene, lighting, sky and ground.
 *
 * Performance notes (integrated-GPU target):
 *  - pixel ratio capped at 1.5, one shadow-casting light with a 2048 map that
 *    follows the camera target so the resolution is spent where the action is
 *  - no SSAO / post-processing. Ambient occlusion is approximated by a
 *    hemisphere light + image-based light from the sky; this is the documented
 *    trade-off against the "AO where practical" goal.
 *  - the "Low" quality switch turns shadows off and drops to pixel ratio 1
 */
import * as THREE from 'three';
import { createMaterialLibrary } from './materials.js';

const SKY_TOP = new THREE.Color(0x3f86d6);
const SKY_HORIZON = new THREE.Color(0xcfe2f0);
const SUN_OFFSET = new THREE.Vector3(24, 36, 16);

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyFrag = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSun;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.5));
    float s = max(dot(d, normalize(uSun)), 0.0);
    col += vec3(1.0, 0.86, 0.62) * (pow(s, 900.0) * 1.5 + pow(s, 10.0) * 0.14);
    col = mix(col, uHorizon, step(d.y, 0.0));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

function createSky(radius) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: {
      uTop: { value: SKY_TOP },
      uHorizon: { value: SKY_HORIZON },
      uSun: { value: SUN_OFFSET.clone() },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

export function createGraphics(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY_HORIZON, 90, 340);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 700);
  camera.position.set(17, 10, 21);

  // --- sky + image-based lighting generated from that same sky -----------------
  const sky = createSky(450);
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(createSky(50));
  const envRT = pmrem.fromScene(envScene, 0.02, 1, 100);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;
  envScene.traverse((o) => {
    if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
  });
  pmrem.dispose();

  // --- lights -------------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x7a6a50, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 130;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // --- ground + build pad ----------------------------------------------------------
  const materials = createMaterialLibrary(renderer.capabilities.getMaxAnisotropy());

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), materials.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const pad = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), materials.grid);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.004;
  pad.renderOrder = 1;
  scene.add(pad);

  const gfx = {
    renderer,
    scene,
    camera,
    sun,
    pad,
    materials,
    quality: 'high',
    container: canvas.parentElement,

    resize() {
      const w = Math.max(1, gfx.container.clientWidth);
      const h = Math.max(1, gfx.container.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },

    setQuality(q) {
      gfx.quality = q;
      const high = q === 'high';
      renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio || 1, 1.5) : 1);
      renderer.shadowMap.enabled = high;
      sun.castShadow = high;
      materials.refresh(); // shader variants differ with/without shadows
      gfx.resize();
    },

    /** Keep the shadow map centred on the action; snapped so shadows don't shimmer while panning. */
    followTarget(target) {
      const sx = Math.round(target.x / 4) * 4;
      const sz = Math.round(target.z / 4) * 4;
      sun.target.position.set(sx, 0, sz);
      sun.position.set(sx + SUN_OFFSET.x, SUN_OFFSET.y, sz + SUN_OFFSET.z);
    },

    render() {
      sky.position.copy(camera.position);
      renderer.render(scene, camera);
    },

    dispose() {
      envRT.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      ground.geometry.dispose();
      pad.geometry.dispose();
      materials.dispose();
      renderer.dispose();
    },
  };

  gfx.setQuality('high');
  return gfx;
}
