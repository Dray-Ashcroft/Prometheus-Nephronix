import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s) => document.querySelector(s);
// Tap handling that survives jittery touch frames (smart panels): a press that drifts up to 28 px still counts as a tap.
// Keyboard and normal mouse clicks still work through 'click'; a tap is not fired twice.
// After a touch/pen tap the browser sends a late 'click', which can land on a button that was redrawn in the same place and
// run it a second time (Pause → Play). Swallow that click everywhere; keyboard activation (no pointer) is unaffected.
let swallowClickUntil = 0;
document.addEventListener('click', (e) => { if (performance.now() < swallowClickUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
function onTap(el, fn, onLong) {
  // tap vs long-press is decided on release from the events' own timestamps, so a busy frame cannot turn a tap into a long-press
  let start = null, t0 = 0, last = 0, hold = null;
  el.addEventListener('pointerdown', (e) => {
    start = [e.clientX, e.clientY]; t0 = e.timeStamp; e.stopPropagation();
    if (onLong) { clearTimeout(hold); hold = setTimeout(() => start && el.classList.add('holding'), 550); }
  });
  el.addEventListener('pointermove', (e) => { if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) >= 28) { clearTimeout(hold); el.classList.remove('holding'); } });
  el.addEventListener('pointerup', (e) => {
    e.stopPropagation(); clearTimeout(hold); el.classList.remove('holding');
    const moved = !start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) >= 28;
    if (!moved && !el.disabled) {
      last = performance.now(); swallowClickUntil = last + 700;
      if (onLong && e.timeStamp - t0 >= 550) onLong(e); else fn(e);
    }
    start = null;
  });
  el.addEventListener('pointercancel', (e) => {
    // some Android browsers cancel a long touch instead of sending pointerup: treat a cancelled hold of 550 ms+ as a long-press
    clearTimeout(hold); el.classList.remove('holding');
    if (start && onLong && e.timeStamp - t0 >= 550) { last = performance.now(); onLong(e); }
    start = null;
  });
  el.addEventListener('click', (e) => { e.stopPropagation(); if (performance.now() - last < 700 || el.disabled) return; fn(e); });
}
// Bubbles (hotspots): tap selects; long-press fades the bubble so the structure behind it shows, until another bubble is tapped
function bubbleTap(el, fn) {
  onTap(el, (e) => { document.querySelectorAll('.hs.faded').forEach((b) => { b.classList.remove('faded'); }); fn(e); },
    () => { el.classList.add('faded'); if (navigator.vibrate) try { navigator.vibrate(15); } catch (_) {} });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}


/* ================= renderer / scene ================= */
const host = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1518);
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 0.28; controls.maxDistance = 10;
controls.minPolarAngle = 0.25; controls.maxPolarAngle = Math.PI - 0.25;
controls.screenSpacePanning = true;

scene.add(new THREE.HemisphereLight(0xdfeff2, 0x1c2427, 1.15));
const key = new THREE.DirectionalLight(0xfff1e0, 2.0); key.position.set(1.2, 2.4, 2.0); scene.add(key);
const rim = new THREE.DirectionalLight(0x9fc4ff, 1.2); rim.position.set(-1.5, 1.6, -2.2); scene.add(rim);

/* ================= loading ================= */
const loader = new GLTFLoader();
const EMBED = window.RDX_EMBED || null;
const ASSETS = { bodyM: 'assets/body_male.glb', bodyF: 'assets/body_female.glb', uri: 'assets/urinary.glb', ls: 'assets/kidney_ls.glb', vasc: 'assets/kidney_vasc_flow.glb', neph: 'assets/nephron_s4.glb' };
const b64ToBuf = (b64) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
// Progress bar: each phase has a start and an end; inside a phase the bar creeps forward (never stalls, never passes the end)
function makeProgress(wrap, fill, pct, msg) {
  let shown = 0, base = 0, goal = 0, t0 = performance.now(), fin = false, last = performance.now();
  const tick = () => {
    const now = performance.now(), dt = now - last; last = now;            // time-based, so a busy device does not slow the bar down
    const creep = base + (goal - base) * 0.92 * (1 - Math.exp(-(now - t0) / 1100));
    shown += (Math.max(shown, fin ? 1 : creep) - shown) * (1 - Math.exp(-dt / (fin ? 70 : 160)));
    fill.style.transform = `scaleX(${shown.toFixed(4)})`; if (pct) pct.textContent = Math.round(shown * 100) + '%';
    if (!(fin && shown > 0.995)) requestAnimationFrame(tick); else { fill.style.transform = 'scaleX(1)'; if (pct) pct.textContent = '100%'; }
  };
  wrap.classList.remove('pending'); requestAnimationFrame(tick);
  return { phase(b, g, m) { base = b; goal = g; t0 = performance.now(); if (m && msg) msg.textContent = m; }, finish(m) { fin = true; shown = 1; fill.style.transform = 'scaleX(1)'; if (pct) pct.textContent = '100%'; if (m && msg) msg.textContent = m; } };
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const assetSize = (n) => (EMBED && EMBED[n] ? EMBED[n].length : 1);
// load one model; with a progress bar it reports two phases (unpacking, then building the 3D model) inside [a, b]
async function loadAsset(name, prog, a = 0, b = 1, label) {
  const mid = a + (b - a) * 0.3;
  if (prog) { prog.phase(a, mid, label); await nextFrame(); }
  if (EMBED && EMBED[name]) {
    const buf = b64ToBuf(EMBED[name]); if (prog) { prog.phase(mid, b, label); await nextFrame(); }
    return new Promise((res, rej) => loader.parse(buf, '', res, rej));
  }
  return loader.loadAsync(ASSETS[name], (e) => { if (prog && e.total) prog.phase(a + (b - a) * 0.9 * e.loaded / e.total, b, label); });
}
// first visit to Stage 2, 3 or 4: a small progress card over the scene while its model loads
let stageProg = null;
async function stageLoad(label, ensure, ready) {
  if (ready()) return ensure();
  const el = $('#sload'), t0 = performance.now(); el.classList.add('on'); stageProg = makeProgress($('#sprog'), $('#sbar'), $('#spct'), $('#smsg'));
  stageProg.phase(0, 0.05, label); await nextFrame(); await nextFrame();    // the card is on screen before the heavy work starts
  try { await ensure(); stageProg.finish(label); await new Promise((r) => setTimeout(r, Math.max(350, 800 - (performance.now() - t0)))); }   // show the full bar briefly
  finally { el.classList.remove('on'); stageProg = null; }
}

/* ================= materials ================= */
const makeSkin = (hex) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.FrontSide,
  uniforms: { uColor: { value: new THREE.Color(hex) }, uBase: { value: 0.05 }, uRim: { value: 0.55 } },
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `uniform vec3 uColor; uniform float uBase; uniform float uRim; varying vec3 vN; varying vec3 vV;
    void main(){ float f = pow(1.0-abs(dot(normalize(vN),normalize(vV))), 2.2); gl_FragColor = vec4(uColor*(0.55+0.6*f), uBase+uRim*f); }`
});
const boneMat = new THREE.MeshStandardMaterial({ color: 0xe6dfcc, roughness: 0.75, transparent: true, opacity: 0.42 });
const cartMat = new THREE.MeshStandardMaterial({ color: 0xb9d0d4, roughness: 0.6, transparent: true, opacity: 0.32 });
const organ = (c, extra = {}) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.5, emissive: 0x000000, ...extra });
const MAT = {
  kidney: () => organ(0x7c2c22),
  adrenal: () => organ(0xd9a443, { roughness: 0.6 }),
  ureter: () => organ(0xe7cf96, { roughness: 0.5 }),
  bladder: () => organ(0xcf8195),
  urethra: () => organ(0xe7cf96, { roughness: 0.5 }),
};

/* ================= content (NCERT Class 11, Excretory Products and Their Elimination) ================= */
const KIDNEY_METRICS = [['10–12 cm', 'adult length'], ['5–7 cm', 'width'], ['2–3 cm', 'thickness'], ['120–170 g', 'average mass']];
const INFO = {
  overview: {
    eyebrow: 'Stage 1', tag: 'Male and female', title: 'Human excretory system',
    lead: 'In both sexes it has a pair of kidneys, a pair of ureters, a urinary bladder and a urethra. Humans are ureotelic: urea, made in the liver, is filtered out of blood by the kidneys.',
    compare: true,
    metrics: [['1–1.5 L', 'urine passed by an adult per day'], ['25–30 g', 'urea removed per day']],
  },
  bodyM: {
    eyebrow: 'Stage 1', tag: 'Male', title: 'Male excretory system',
    lead: 'Follow the path urine takes. Tap an organ, or a numbered dot, to read about it. Turn on Skeleton to see the vertebral levels of the kidneys.',
    route: 'm',
  },
  bodyF: {
    eyebrow: 'Stage 1', tag: 'Female', title: 'Female excretory system',
    lead: 'The same organs as in the male. The main difference is the urethra, which is much shorter. Tap an organ, or a numbered dot, to read about it. Turn on Skeleton to see the vertebral levels of the kidneys.',
    route: 'f',
    note: 'The female skeleton is the male model reshaped by the simulator: a wider, shallower pelvis with a wider pubic arch, and a smaller, narrower ribcage. Fine details of the pelvis are approximate.',
  },
  kidneyR: {
    eyebrow: 'Excretory organ', tag: 'Paired', title: 'Right kidney',
    facts: [
      'Reddish-brown, bean-shaped organ lying between the last thoracic (T12) and third lumbar (L3) vertebrae, close to the dorsal inner wall of the abdominal cavity.',
      'Sits slightly lower than the left kidney, because the liver lies above it.',
      'The hilum, a notch on its inner concave surface, is where the ureter, blood vessels and nerves enter or leave.',
      'Each kidney has nearly one million nephrons, its functional units.',
    ],
    metrics: KIDNEY_METRICS, measure: true, next: 'Kidney L.S.',
  },
  kidneyL: {
    eyebrow: 'Excretory organ', tag: 'Paired', title: 'Left kidney',
    facts: [
      'Reddish-brown, bean-shaped organ lying between the T12 and L3 vertebrae, close to the dorsal inner wall of the abdominal cavity.',
      'Sits slightly higher than the right kidney; its upper pole reaches up to about T11.',
      'Like the right kidney, it lies behind the peritoneum (retroperitoneal); from behind, ribs 11 and 12 partly cover it.',
      'Each kidney has nearly one million nephrons, its functional units.',
    ],
    metrics: KIDNEY_METRICS, measure: true, next: 'Kidney L.S.',
  },
  ureter: {
    eyebrow: 'Conducting tube', tag: 'Paired', title: 'Ureter',
    facts: [
      'A thin muscular tube that leaves each kidney at the hilum, starting from the renal pelvis, and runs down to the urinary bladder.',
      'Waves of contraction in its smooth-muscle wall (peristalsis) push urine down towards the bladder.',
      'Each ureter enters the back of the bladder at a slant. When the bladder fills, its wall presses this slanted part shut, which stops urine flowing back up.',
    ],
    metrics: [['25–30 cm', 'adult length'], ['2', 'one per kidney']],
  },
  bladder: {
    eyebrow: 'Storage organ', tag: 'Single', title: 'Urinary bladder',
    facts: [
      'A hollow, muscular sac in the pelvic cavity that stores urine until it is passed out.',
      'As it fills and stretches, stretch receptors in its wall send signals to the CNS.',
      'Micturition: the CNS sends motor messages that contract the smooth muscle of the bladder and, at the same time, relax the urethral sphincter, so urine is released.',
      'The neural mechanism that controls this is called the micturition reflex.',
    ],
    metrics: [['1–1.5 L', 'urine per day (adult)'], ['≈ 6', 'pH of urine (light yellow, slightly acidic)']],
  },
  urethraM: {
    eyebrow: 'Conducting tube', tag: 'Male', title: 'Urethra (male)',
    facts: [
      'The tube that carries urine from the urinary bladder to the outside of the body.',
      'In the male it is long, running from the bladder neck to the tip of the penis.',
      'Its opening is kept closed by the urethral sphincter except during micturition.',
    ],
    metrics: [['18–20 cm', 'male'], ['≈ 4 cm', 'female, for comparison']],
    note: 'Drawn by the simulator, and simplified near its outer end. It is not part of the source model.',
  },
  urethraF: {
    eyebrow: 'Conducting tube', tag: 'Female', title: 'Urethra (female)',
    facts: [
      'The tube that carries urine from the urinary bladder to the outside of the body.',
      'In the female it is short. It opens at the external urethral orifice, in front of the vaginal opening.',
      'Its opening is kept closed by the urethral sphincter except during micturition.',
      'Because it is short, bacteria reach the bladder more easily. This is one reason urinary tract infections are more common in females.',
    ],
    metrics: [['≈ 4 cm', 'female'], ['18–20 cm', 'male, for comparison']],
    measure: true,
    note: 'Drawn by the simulator. It is not part of the source model.',
  },
  adrenal: {
    eyebrow: 'Endocrine gland', tag: 'Not excretory', title: 'Adrenal (suprarenal) gland',
    facts: [
      'A cap-shaped gland on the upper pole of each kidney. It belongs to the endocrine system, not the excretory system.',
      'It helps regulate the kidney. Its cortex secretes aldosterone, which makes the distal parts of the tubule reabsorb Na⁺ and water.',
      'Aldosterone release is triggered by angiotensin II, as part of the renin–angiotensin mechanism (Stage 4).',
      'Its medulla secretes adrenaline and noradrenaline.',
    ],
    metrics: [['2', 'one on each kidney']],
  },
  T12: {
    eyebrow: 'Landmark', tag: 'Skeleton', title: 'T12, the last thoracic vertebra',
    facts: [
      'The upper limit of the kidneys. The 12th pair of ribs joins the spine at this vertebra.',
      'From behind, rib 12 covers the upper part of the right kidney, and ribs 11 and 12 cover the higher-placed left kidney.',
    ],
  },
  L3: {
    eyebrow: 'Landmark', tag: 'Skeleton', title: 'L3, the third lumbar vertebra',
    facts: [
      'The lower limit of the kidneys. Below this level only the ureters continue down to the pelvis.',
      'Count up from the sacrum, L5, L4, L3, to find it in the model.',
    ],
  },
};

/* ================= the two bodies ================= */
// Each body unit is fitted separately. Source units -> metres; the base-mesh pack's own proportions are kept (male 1.75 m, female 1.69 m).
const SB = 1.75 / 0.241;
const UNITS = {
  m: { name: 'Male', x: -0.6, body: 'bodyM', bodyDx: 0.079, skin: 0xd8a68c, skeleton: true,
       fit: { s: 0.00098, top: 1.49, tz: -0.045, zs: 0.85, rx: -7, piv: 1.15, ys: 1, lift: 0 } },
  f: { name: 'Female', x: 0.6, body: 'bodyF', bodyDx: -0.070, skin: 0xdcab92, skeleton: true, warp: true,
       // female mesh: crotch sits higher, so the tract is lifted 1.5 cm and compressed 4 % vertically (kidneys stay 10 cm long);
       // the female pelvis reshaping then raises the pelvic organs a further ~1 cm
       fit: { s: 0.000946, top: 1.438, tz: 0.031, zs: 0.81, rx: -7, piv: 1.11, ys: 0.96, lift: 0.015 } },
};
const struct = {}; // 'm:kidneyR' -> { meshes:[], anchor, measure }
const unitObjs = { m: [], f: [] };
const pickables = [];
const skins = {}; const bones = []; const adrenals = [];
const sid = (u, id) => u + ':' + id;
function tag(u, id, mesh) { const k = sid(u, id); (struct[k] ||= { meshes: [] }).meshes.push(mesh); mesh.userData.struct = k; pickables.push(mesh); }

// Female-form warp applied to the male skeleton, in the male-fit world frame (x centred on the spine, metres).
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function femaleWarp(p, P) {
  let { x, y, z } = p;
  const wPel = 1 - smooth(P.pelTop - 0.04, P.pelTop + 0.05, y);          // 1 in the pelvis, 0 in the lumbar spine
  const wLow = 1 - smooth(P.outlet, P.pelTop, y);                         // 1 at the outlet / pubic arch, 0 at the iliac crest
  // 1) widen the pelvic cavity: inner region spreads more at the outlet (wider subpubic angle), lateral parts shift by a capped amount
  const a = wPel * (P.crestWiden + (P.outletWiden - P.crestWiden) * wLow);
  const inner = Math.sign(x) * Math.min(Math.abs(x), P.innerHalf);
  x += inner * a + x * wPel * P.allWiden;
  // 2) shallower pelvis: compress height below the crest
  if (y < P.pelTop) y = P.pelTop - (P.pelTop - y) * (1 - (1 - P.pelDepthY) * wPel);
  // 3) smaller, narrower thorax and shoulder girdle
  const wTh = smooth(P.thFrom, P.thTo, y);
  x *= 1 - (1 - P.thX) * wTh; z = P.spineZ + (z - P.spineZ) * (1 - (1 - P.thZ) * wTh);
  p.set(x, y, z); return p;
}
const FEMALE_WARP = { pelTop: 1.0, outlet: 0.83, crestWiden: 0.06, outletWiden: 0.55, innerHalf: 0.06, allWiden: 0.05, pelDepthY: 0.93,
  thFrom: 1.05, thTo: 1.14, thX: 0.9, thZ: 0.93, spineZ: -0.10 };

// Matrix of the urinary-model root inside its unit, for a given fit (no unit x offset)
function fitMatrix(F) {
  const sq = new THREE.Group(); sq.position.y = F.piv + F.lift; sq.scale.y = F.ys;
  const tl = new THREE.Group(); tl.rotation.x = THREE.MathUtils.degToRad(F.rx);
  const md = new THREE.Group(); md.scale.set(F.s, F.s, F.s * F.zs); md.position.set(-228.6 * F.s, F.top - 110 * F.s - F.piv, F.tz);
  tl.add(md); sq.add(tl); sq.updateMatrixWorld(true); return md.matrixWorld.clone();
}
// Reshape the (male) model into the female form. Bones get the full warp; organs only the pelvic part, so kidneys keep their shape.
function applyFemaleWarp(root) {
  const Mm = fitMatrix(UNITS.m.fit);
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const v = new THREE.Vector3();
  // organs: keep the pelvic height change (so they stay inside the pelvis) but only a mild widening (the female bladder is somewhat broader)
  const organOnly = { ...FEMALE_WARP, crestWiden: 0, outletWiden: 0.12, allWiden: 0, thX: 1, thZ: 1 };
  root.traverse((o) => {
    if (!o.isMesh) return;
    const R = Mm.clone().multiply(rootInv.clone().multiply(o.matrixWorld)), Ri = R.clone().invert();
    const bone = /^(Botjes|Costal|Vertebral)/.test(o.name);
    const p = o.geometry.attributes.position, f = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(R); femaleWarp(v, bone ? FEMALE_WARP : organOnly); v.applyMatrix4(Ri); f[i * 3] = v.x; f[i * 3 + 1] = v.y; f[i * 3 + 2] = v.z; }
    o.geometry = o.geometry.clone(); o.geometry.setAttribute('position', new THREE.BufferAttribute(f, 3)); o.geometry.computeVertexNormals(); o.geometry.computeBoundingSphere(); o.geometry.computeBoundingBox();
  });
}
// A point given in the male-fit frame -> the same anatomical point in unit u
function mapLandmark(u, p) {
  const q = p.clone(); if (u === 'f') femaleWarp(q, FEMALE_WARP);
  const K = fitMatrix(UNITS[u].fit).multiply(fitMatrix(UNITS.m.fit).invert());
  return q.applyMatrix4(K).add(new THREE.Vector3(UNITS[u].x, 0, 0));
}
// The skeleton model has level shoulders, but the body figures' shoulders slope down to the arms, so the lateral ends of the
// pectoral girdle poked through the skin. Measure the skin's top surface across the shoulders and lower only the bone that
// overshoots it, fading the shift out below the girdle so the ribs, spine and kidney levels are untouched.
const shoulderReport = {};
function fitShoulders(u, bodyRoot, boneMeshes) {
  const cx = UNITS[u].x, ray = new THREE.Raycaster(), v = new THREE.Vector3(), BIN = 0.008, NB = 70, MARGIN = 0.014;
  const skin = new Array(NB).fill(-Infinity), top = new Array(NB).fill(-Infinity);
  const binOf = (x) => Math.round((x - cx) / BIN) + NB / 2;
  for (let k = 0; k < NB; k++) {
    const x = cx + (k - NB / 2) * BIN;
    for (let z = -0.10; z <= 0.08; z += 0.02) { ray.set(new THREE.Vector3(x, 2.2, z), new THREE.Vector3(0, -1, 0)); const h = ray.intersectObject(bodyRoot, true)[0]; if (h && h.point.y > skin[k]) skin[k] = h.point.y; }
  }
  for (const m of boneMeshes) { const pa = m.geometry.attributes.position; for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld); const k = binOf(v.x); if (k >= 0 && k < NB && v.y > top[k]) top[k] = v.y; } }
  let over = top.map((t, k) => (isFinite(t) && isFinite(skin[k]) ? Math.max(0, t - (skin[k] - MARGIN)) : 0));
  over = over.map((_, k) => { let m = 0; for (let q = Math.max(0, k - 3); q <= Math.min(NB - 1, k + 3); q++) m = Math.max(m, over[q]); return m; });   // widen so the bend is smooth
  over = over.map((_, k) => { let s = 0, n = 0; for (let q = Math.max(0, k - 3); q <= Math.min(NB - 1, k + 3); q++) { s += over[q]; n++; } return s / n; });
  const maxOver = Math.max(...over); shoulderReport[u] = +(maxOver * 100).toFixed(1);
  if (maxOver <= 0) return;
  const Y0 = 1.25 * (u === 'f' ? 0.965 : 1);           // below this the skeleton is left exactly as it was
  for (const m of boneMeshes) {
    m.geometry = m.geometry.clone(); const pa = m.geometry.attributes.position, inv = m.matrixWorld.clone().invert();
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld);
      const k = binOf(v.x); if (k < 0 || k >= NB || !over[k] || v.y <= Y0) continue;
      const t = Math.min(1, (v.y - Y0) / Math.max(0.02, top[k] - Y0)), w = t * t * (3 - 2 * t);
      v.y -= over[k] * w; v.applyMatrix4(inv); pa.setXYZ(i, v.x, v.y, v.z);
    }
    pa.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere();
  }
}
function buildUnit(u, bodyG, uriScene) {
  const U = UNITS[u], F = U.fit;
  const unit = new THREE.Group(); unit.position.x = U.x; scene.add(unit); unitObjs[u].push(unit);
  // body shell
  const b = bodyG.scene; b.scale.setScalar(SB); b.position.set(-U.bodyDx * SB, 0, 0);
  const skinMat = makeSkin(U.skin);
  b.traverse((o) => { if (o.isMesh) { o.material = skinMat; o.renderOrder = 10; o.userData.body = u; } });
  unit.add(b); skins[u] = b;
  // urinary tract: squash (vertical scale about the pivot) -> tilt -> scaled model
  const squash = new THREE.Group(); squash.position.y = F.piv + F.lift; squash.scale.y = F.ys;
  const tilt = new THREE.Group(); tilt.rotation.x = THREE.MathUtils.degToRad(F.rx);
  const m = uriScene; if (U.warp) applyFemaleWarp(m);
  m.scale.set(F.s, F.s, F.s * F.zs); m.position.set(-228.6 * F.s, F.top - 110 * F.s - F.piv, F.tz);
  tilt.add(m); squash.add(tilt); unit.add(squash);
  const drop = [];
  m.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name;
    if (n.startsWith('Rechternier1')) { o.material = MAT.kidney(); tag(u, 'kidneyR', o); }      // patient's right (lower) kidney
    else if (n.startsWith('Rechternier')) { o.material = MAT.kidney(); tag(u, 'kidneyL', o); }
    else if (n.startsWith('PM3D_Sphere3D1')) { o.material = MAT.adrenal(); tag(u, 'adrenal', o); adrenals.push(o); }
    else if (n.startsWith('blaas')) { o.material = MAT.bladder(); tag(u, 'bladder', o); }
    else if (n.startsWith('Skin_ZSphere2')) { o.material = MAT.ureter(); tag(u, 'ureter', o); }
    else if (!U.skeleton) { drop.push(o); }
    else if (n.startsWith('Costal') || n.startsWith('Vertebral')) { o.material = cartMat; o.renderOrder = 5; bones.push(o); }
    else { o.material = boneMat; o.renderOrder = 4; bones.push(o); }
  });
  drop.forEach((o) => o.parent.remove(o));
  scene.updateMatrixWorld(true);
  fitShoulders(u, b, bones.filter((o) => { for (let q = o; q; q = q.parent) if (q === unit) return true; return false; }));
  scene.updateMatrixWorld(true);

  // ---- anchors and measurements from the real geometry ----
  const v = new THREE.Vector3();
  const boxOf = (id) => { const bx = new THREE.Box3(); struct[sid(u, id)].meshes.forEach((mm) => bx.expandByObject(mm)); return bx; };
  for (const id of ['kidneyR', 'kidneyL']) {
    const bx = boxOf(id); struct[sid(u, id)].anchor = bx.getCenter(new THREE.Vector3()).setZ(bx.max.z);
    struct[sid(u, id)].measure = `Measured in this model: ${((bx.max.y - bx.min.y) * 100).toFixed(1)} cm long, inside the adult range.`;
  }
  const bl = boxOf('bladder'); struct[sid(u, 'bladder')].anchor = bl.getCenter(new THREE.Vector3()).setZ(bl.max.z - 0.01);
  const adr = struct[sid(u, 'adrenal')].meshes.map((mm) => new THREE.Box3().setFromObject(mm)).sort((a, c) => a.min.x - c.min.x)[0];
  struct[sid(u, 'adrenal')].anchor = adr.getCenter(new THREE.Vector3()).setZ(adr.max.z);
  // right ureter at mid-abdomen
  const kR = boxOf('kidneyR'); const midY = (kR.min.y + bl.max.y) / 2;
  let acc = new THREE.Vector3(), k = 0;
  struct[sid(u, 'ureter')].meshes.forEach((mm) => { const p = mm.geometry.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mm.matrixWorld); if (v.x < U.x && Math.abs(v.y - midY) < 0.012) { acc.add(v); k++; } } });
  struct[sid(u, 'ureter')].anchor = k ? acc.divideScalar(k) : kR.getCenter(new THREE.Vector3());

  // ---- urethra (drawn) ----
  let neck = null;
  struct[sid(u, 'bladder')].meshes.forEach((mm) => { const p = mm.geometry.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mm.matrixWorld); if (!neck || v.y < neck.y) neck = v.clone(); } });
  const cx = U.x; let pts;
  if (u === 'm') {
    // bladder neck -> under the pubic symphysis -> forward to the body surface
    const hit = new THREE.Raycaster(new THREE.Vector3(cx, 0.79, 0.6), new THREE.Vector3(0, 0, -1)).intersectObject(b, true)[0];
    const skinZ = hit ? hit.point.z : 0.05;
    pts = [neck.clone().add(new THREE.Vector3(0, 0.004, 0)), new THREE.Vector3((neck.x + cx) / 2, neck.y - 0.02, neck.z + 0.004),
      new THREE.Vector3(cx, 0.800, neck.z + 0.018), new THREE.Vector3(cx, 0.790, (neck.z + skinZ) * 0.5 + 0.012), new THREE.Vector3(cx, 0.786, skinZ - 0.004)];
  } else {
    // short female urethra: bladder neck -> down and slightly forward -> external urethral orifice on the perineal surface
    const hit = new THREE.Raycaster(new THREE.Vector3(cx, 0.3, neck.z + 0.022), new THREE.Vector3(0, 1, 0)).intersectObject(b, true)[0];
    const ori = hit ? hit.point.clone().add(new THREE.Vector3(0, 0.003, 0)) : neck.clone().add(new THREE.Vector3(0, -0.035, 0.02));
    pts = [neck.clone().add(new THREE.Vector3(0, 0.004, 0)), new THREE.Vector3((neck.x * 2 + cx) / 3, (neck.y * 2 + ori.y) / 3, neck.z + 0.006), new THREE.Vector3(cx, (neck.y + ori.y * 2) / 3, (neck.z + ori.z * 2) / 3 + 0.002), ori];
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const ureth = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, u === 'm' ? 0.0034 : 0.0036, 12, false), MAT.urethra());
  scene.add(ureth); unitObjs[u].push(ureth); tag(u, 'urethra', ureth);
  struct[sid(u, 'urethra')].anchor = curve.getPoint(u === 'm' ? 0.55 : 0.5);
  if (u === 'f') struct[sid(u, 'urethra')].measure = `Measured in this model: ${(curve.getLength() * 100).toFixed(1)} cm long.`;

  // landmarks (male skeleton only): vertebral bodies counted upwards from the L5–S1 disc
  if (U.skeleton) {
    struct[sid(u, 'L3')] = { meshes: [], anchor: mapLandmark(u, new THREE.Vector3(0, 1.066, -0.025)) };
    struct[sid(u, 'T12')] = { meshes: [], anchor: mapLandmark(u, new THREE.Vector3(0, 1.165, -0.062)) };
  }
  // body label anchor (overview), at chest height
  const top = new THREE.Box3().setFromObject(b).max.y;
  struct[sid(u, 'body')] = { meshes: [], anchor: new THREE.Vector3(cx, top + 0.22, 0.05) };
}

/* ================= hotspots ================= */
const HOTSPOTS = [
  { id: 'kidneyR', n: 1, label: 'Right kidney', side: 'left' },
  { id: 'kidneyL', n: 1, label: 'Left kidney' },
  { id: 'ureter', n: 2, label: 'Ureter', side: 'left' },
  { id: 'bladder', n: 3, label: 'Urinary bladder' },
  { id: 'urethra', n: 4, label: 'Urethra' },
  { id: 'adrenal', n: 'A', label: 'Adrenal gland', layer: 'adr', side: 'left' },
  { id: 'T12', n: 'T12', label: 'T12', landmark: true, layer: 'bone' },
  { id: 'L3', n: 'L3', label: 'L3', landmark: true, layer: 'bone' },
];
const hsLayer = $('#hotspots'); const hsEls = [];
// Material-style biological sex symbols (drawn as SVG so they need no icon font)
const SEX_ICON = {
  m: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9.5" cy="14.5" r="5.6" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M13.6 10.4L20 4M14.6 4H20v5.4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  f: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.6" r="5.6" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M12 14.2V22M8.2 18.4h7.6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
};
// Hold the symbol for 5 s: a ring fills; releasing early winds it back. A quick tap shows a reminder.
const HOLD_MS = 5000, RING_C = 226.19;
function holdToExplore(el, u) {
  const prg = el.querySelector('.prg'), lbl = el.querySelector('.sexlbl'); let t0 = 0, e0 = 0, raf = 0, holding = false, nudgeT = 0;
  const set = (p) => { prg.style.strokeDashoffset = String(RING_C * (1 - p)); };
  const frame = () => {
    if (!holding) return;
    const p = Math.min(1, (performance.now() - t0) / HOLD_MS); set(p);
    if (p >= 1) { holding = false; el.classList.remove('pressing'); if (navigator.vibrate) try { navigator.vibrate(30); } catch (_) {} setTimeout(() => { set(0); }, 300); focusUnit(u); return; }
    raf = requestAnimationFrame(frame);
  };
  const stop = (e) => {
    if (!holding) return; holding = false; cancelAnimationFrame(raf); el.classList.remove('pressing');
    if ((e && e.timeStamp ? e.timeStamp - e0 : performance.now() - t0) < 450) { // a tap: remind how to open it
      clearTimeout(nudgeT); el.classList.add('nudge'); lbl.textContent = 'Hold to explore';
      nudgeT = setTimeout(() => { el.classList.remove('nudge'); lbl.textContent = UNITS[u].name; }, 1600);
    }
    el.classList.add('rewind'); set(0); setTimeout(() => el.classList.remove('rewind'), 380);
  };
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); swallowClickUntil = performance.now() + 6000; el.classList.remove('rewind'); holding = true; t0 = performance.now(); e0 = e.timeStamp; el.classList.add('pressing'); try { el.setPointerCapture(e.pointerId); } catch (_) {} raf = requestAnimationFrame(frame); });
  el.addEventListener('pointerup', (e) => { e.stopPropagation(); stop(e); });
  el.addEventListener('pointercancel', stop);
  el.addEventListener('lostpointercapture', stop);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusUnit(u); } }); // keyboard: no hold needed
}
function makeHotspots() {
  for (const u of ['m', 'f']) {
    // overview label for each body
    const bb = document.createElement('button'); bb.className = 'hs sexbtn';
    bb.innerHTML = `<span class="ring"><svg class="pr" viewBox="0 0 80 80" aria-hidden="true"><circle class="trk" cx="40" cy="40" r="36"/><circle class="prg" cx="40" cy="40" r="36"/></svg><span class="fab">${SEX_ICON[u]}</span></span><span class="sexlbl">${UNITS[u].name}</span>`;
    bb.setAttribute('aria-label', UNITS[u].name + ': hold for 5 seconds to explore');
    holdToExplore(bb, u);
    hsLayer.appendChild(bb); hsEls.push({ u, h: { id: 'body', overview: true }, el: bb });
    for (const h of HOTSPOTS) {
      if (h.only && h.only !== u) continue;
      const b = document.createElement('button');
      b.className = 'hs' + (h.side === 'left' ? ' left' : '') + (h.landmark ? ' landmark' : '');
      b.innerHTML = `<span class="dot">${h.n}</span><span class="tag">${h.label}</span>`;
      b.setAttribute('aria-label', h.label); b.setAttribute('aria-pressed', 'false');
      bubbleTap(b, (e) => { e.stopPropagation(); select(sid(u, h.id), true); });
      hsLayer.appendChild(b); hsEls.push({ u, h, el: b });
    }
  }
}
const tmp = new THREE.Vector3(), mid = new THREE.Vector3();
function placeHotspots() {
  if (stage === 2) return placeLS();
  if (stage === 3) return placeV();
  if (stage === 4) return placeN();
  const w = renderer.domElement.clientWidth, hgt = renderer.domElement.clientHeight;
  for (const { u, h, el } of hsEls) {
    const s = struct[sid(u, h.id)]; if (!s || !s.anchor) continue;
    const show = h.overview ? focus === null : focus === u && !(h.layer && !layers[h.layer]);
    tmp.copy(s.anchor).project(camera);
    el.classList.toggle('hidden', !show || tmp.z > 1);
    if (!show) continue;
    // place the tag on the side away from the body's midline, whichever way the camera faces
    const sx = tmp.x; mid.set(UNITS[u].x, s.anchor.y, s.anchor.z).project(camera);
    const left = h.landmark ? false : sx < mid.x - 0.002 ? true : sx > mid.x + 0.002 ? false : h.side === 'left';
    el.classList.toggle('left', left);
    el.style.transform = h.overview
      ? `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * hgt}px) translate(-50%, -50%)`
      : `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * hgt}px) translate(${left ? '-100%' : '0'}, -50%) translate(${left ? '15px' : '-15px'}, 0)`;
  }
}

/* ================= focus, selection, card ================= */
let focus = null;   // null = both bodies, 'm' or 'f'
let selected = null; // e.g. 'f:bladder'
const card = $('#card');
// Card collapse: manual toggle, and automatic collapse after 10 s without interaction. New content re-opens it.
const cardBox = $('#cardbox'); let cardTimer = null;
function setCollapsed(c) { cardBox.classList.toggle('collapsed', c); const t = $('#card-toggle'); t.setAttribute('aria-expanded', String(!c)); t.setAttribute('aria-label', c ? 'Expand card' : 'Collapse card'); }
let CARD_AUTO = true;   // tests switch this off: in the slow test browser the 10 s timer races their taps
function armCardTimer() { clearTimeout(cardTimer); if (CARD_AUTO) cardTimer = setTimeout(() => setCollapsed(true), 10000); }
new MutationObserver(() => { setCollapsed(false); armCardTimer(); }).observe(card, { childList: true });
onTap($('#card-toggle'), () => { const c = !cardBox.classList.contains('collapsed'); setCollapsed(c); if (c) clearTimeout(cardTimer); else armCardTimer(); });
cardBox.addEventListener('pointerdown', () => { if (!cardBox.classList.contains('collapsed')) armCardTimer(); }, true); // capture: buttons inside stop propagation
cardBox.addEventListener('scroll', () => armCardTimer(), { passive: true });
cardBox.addEventListener('click', () => { if (cardBox.classList.contains('collapsed')) { setCollapsed(false); armCardTimer(); } });
// no browser text menu or selection on long-press anywhere in the simulator
$('#app').addEventListener('contextmenu', (e) => e.preventDefault());
$('#app').addEventListener('selectstart', (e) => e.preventDefault());
// phones: the Layers chips open at the top of the info card, so they never cover the model
const dockHome = { parent: null, next: null };
function placeDock() {
  const d = $('#dock'), cb = $('#cardbox'); if (!dockHome.parent) { dockHome.parent = d.parentElement; dockHome.next = d.nextSibling; }
  const phone = innerWidth <= 760, open = $('#app').classList.contains('dock-open');
  if (phone && open) { if (d.parentElement !== cb) cb.insertBefore(d, cb.querySelector('#card')); setCollapsed(false); armCardTimer(); }
  else if (d.parentElement !== dockHome.parent) dockHome.parent.insertBefore(d, dockHome.next);
}
addEventListener('resize', placeDock);
onTap($('#dock-toggle'), () => { const open = !$('#app').classList.contains('dock-open'); $('#app').classList.toggle('dock-open', open); placeDock(); $('#dock-toggle').setAttribute('aria-expanded', String(open)); });
const infoKey = (k) => { const [u, id] = k.split(':'); return id === 'urethra' ? (u === 'm' ? 'urethraM' : 'urethraF') : id; };

function renderCard(key) {
  const d = INFO[key.includes(':') ? infoKey(key) : key];
  const s = key.includes(':') ? struct[key] : null;
  const u = key.includes(':') ? key[0] : (key === 'bodyM' ? 'm' : key === 'bodyF' ? 'f' : null);
  let html = `<div class="eyebrow"><span>${d.eyebrow}</span><em>${d.tag}${s && u && d.tag !== UNITS[u].name ? ' · ' + UNITS[u].name : ''}</em></div><h2>${d.title}</h2>`;
  if (d.lead) html += `<p>${d.lead}</p>`;
  if (d.compare) html += `<div class="pick">${['m', 'f'].map((x) => `<button class="pickbtn" data-focus="${x}"><b>${UNITS[x].name}</b><span>Urethra ${x === 'm' ? '18–20 cm' : '≈ 4 cm'}</span></button>`).join('')}</div>`;
  if (d.route) html += `<div class="route" aria-label="Path of urine">${['kidneyR:Kidney', 'ureter:Ureter', 'bladder:Urinary bladder', 'urethra:Urethra'].map((p, i) => { const [k, t] = p.split(':'); return (i ? '<span class="arw">→</span>' : '') + `<button class="chip" data-go="${d.route}:${k}">${t}</button>`; }).join('')}</div>`;
  if (d.facts) html += `<ul>${d.facts.map((f) => `<li>${f}</li>`).join('')}</ul>`;
  if (d.metrics) html += `<div class="metrics">${d.metrics.map(([b, t]) => `<div class="metric"><b>${b}</b><span>${t}</span></div>`).join('')}</div>`;
  if (d.measure && s && s.measure) html += `<p class="note">${s.measure}</p>`;
  if (d.note) html += `<p class="note">${d.note}</p>`;
  html += `<div class="actions">`;
  if (d.next) html += `<button class="btn" data-ls="${key.endsWith('kidneyL') ? 'L' : 'R'}">Open ${d.next}</button>`;
  if (s && u) html += `<button class="btn ghost" data-focus="${u}">${UNITS[u].name} overview</button>`;
  if (key !== 'overview') html += `<button class="btn ghost" data-focus="">Both bodies</button>`;
  html += `</div>`;
  card.innerHTML = html;
  card.querySelectorAll('[data-go]').forEach((b) => onTap(b, () => select(b.dataset.go, true)));
  card.querySelectorAll('[data-focus]').forEach((b) => onTap(b, () => focusUnit(b.dataset.focus || null)));
  card.querySelectorAll('[data-ls]').forEach((b) => onTap(b, () => enterStage(2, b.dataset.ls)));
}
function clearGlow() { for (const s of Object.values(struct)) s.meshes.forEach((m) => m.material.emissive && m.material.emissive.setHex(0)); }
function syncPressed() { hsEls.forEach(({ u, h, el }) => el.setAttribute('aria-pressed', String(sid(u, h.id) === selected))); }
function showUnits() { for (const x of ['m', 'f']) unitObjs[x].forEach((o) => (o.visible = focus === null || focus === x)); }
function focusUnit(u) {
  focus = u; showUnits(); selected = null; clearGlow(); syncPressed(); syncLayerButtons();
  renderCard(u === 'm' ? 'bodyM' : u === 'f' ? 'bodyF' : 'overview');
  flyTo(u ? unitView(u, 'front') : overviewView());
}
function select(key, fly) {
  const u = key[0];
  if (focus !== u) { focus = u; showUnits(); syncLayerButtons(); }
  selected = key; clearGlow(); syncPressed(); renderCard(key);
  const s = struct[key];
  if (fly && s && s.anchor) {
    const t = s.anchor.clone(); const id = key.slice(2);
    const back = id === 'T12' || id === 'L3';
    const dist = id === 'bladder' || id === 'urethra' ? 0.6 : 0.72;
    flyTo({ target: t, pos: t.clone().add(new THREE.Vector3(back ? 0.18 : 0.22, 0.06, back ? -dist : dist)) });
  }
}

/* ================= camera views ================= */
// both bodies; on wide screens aim right of centre so the card does not cover the female figure
function overviewView() { const w = camera.aspect >= 1; return { target: new THREE.Vector3(w ? 0.32 : 0, w ? 1.0 : 1.4, 0), pos: new THREE.Vector3(w ? 0.32 : 0, w ? 1.15 : 1.55, w ? 4.3 : 4.0) }; }
function unitView(u, which) {
  const x = UNITS[u].x, y = u === 'f' ? 1.0 : 1.02;
  if (which === 'back') return { target: new THREE.Vector3(x, y + 0.03, -0.04), pos: new THREE.Vector3(x - 0.2, y + 0.1, -1.45) };
  if (which === 'side') return { target: new THREE.Vector3(x, y, 0), pos: new THREE.Vector3(x + 1.5, y + 0.08, 0.1) };
  return { target: new THREE.Vector3(x, y, 0), pos: new THREE.Vector3(x + 0.35, y + 0.1, 1.55) };
}
function fitView(v) {
  const a = camera.aspect; if (a >= 1) return v;
  const dir = v.pos.clone().sub(v.target), k = Math.min(2.2, 1 / a);
  const target = v.target.clone().add(new THREE.Vector3(0, -0.1 * dir.length(), 0)); // lift the subject above the bottom sheet, in proportion to its size
  return { target, pos: target.clone().add(dir.multiplyScalar(k)) };
}
let tween = null;
function flyTo(v) {
  v = fitView(v);
  if (REDUCED) { camera.position.copy(v.pos); controls.target.copy(v.target); return; }
  tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: v.pos.clone(), t1: v.target.clone() };
}
function stepTween(dt) {
  if (!tween) return;
  tween.t = Math.min(1, tween.t + dt / 0.9);
  const e = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - (-2 * tween.t + 2) ** 3 / 2;
  // swing around the subject instead of cutting straight through it: interpolate the view direction on a sphere
  controls.target.lerpVectors(tween.t0, tween.t1, e);
  const o0 = tween.p0.clone().sub(tween.t0), o1 = tween.p1.clone().sub(tween.t1);
  const l = o0.length() + (o1.length() - o0.length()) * e;
  const q = new THREE.Quaternion().setFromUnitVectors(o0.clone().normalize(), o1.clone().normalize());
  const dir = o0.clone().normalize().applyQuaternion(new THREE.Quaternion().slerp(q, e));
  camera.position.copy(controls.target).addScaledVector(dir, l);
  if (tween.t >= 1) tween = null;
}
const view = (which) => flyTo(focus ? unitView(focus, which) : (which === 'front' ? overviewView() : unitView('m', which)));

/* ================= layers ================= */
const layers = { skin: true, bone: true, adr: true, lab: true, art: true, ven: true, col: true, flow: !REDUCED, ves: true, cel: true };
function syncLayerButtons() {

}
function setLayer(k, on) {
  layers[k] = on; $('#ly-' + k).setAttribute('aria-pressed', String(on));
  if (k === 'skin') Object.values(skins).forEach((s) => (s.visible = on));
  if (k === 'bone') bones.forEach((m) => (m.visible = on));
  if (k === 'adr') adrenals.forEach((m) => (m.visible = on));
  if (k === 'lab') $('#app').classList.toggle('nolabels', !on);
  if (k === 'art' || k === 'ven') (vMesh[k] || []).forEach((m) => (m.visible = on));
  if (k === 'col') ['col', 'pyr'].forEach((r) => (vMesh[r] || []).forEach((m) => (m.visible = on)));
  if (k === 'flow') flowUniforms.forEach((u) => (u.uFlow.value = on ? 1 : 0));
  if (k === 'ves') [...nMesh.art, ...nMesh.ven].forEach((m) => (m.visible = on));
  if (k === 'cel') nMesh.cel.forEach((m) => (m.visible = on));
}
['skin', 'bone', 'adr', 'lab', 'art', 'ven', 'col', 'flow', 'ves', 'cel'].forEach((k) => onTap($('#ly-' + k), () => setLayer(k, !layers[k])));
$('#ly-flow').setAttribute('aria-pressed', String(layers.flow));
onTap($('#vw-front'), () => (stage === 4 ? flyTo(nView('front')) : stage === 3 ? flyTo(vView('front')) : stage === 2 ? flyTo(lsView('front')) : view('front')));
onTap($('#vw-back'), () => (stage === 4 ? flyTo(nView('back')) : stage === 3 ? flyTo(vView('back')) : stage === 2 ? flyTo(lsView('back')) : view('back')));
onTap($('#vw-side'), () => (stage === 4 ? flyTo(nView('side')) : stage === 3 ? flyTo(vView('side')) : stage === 2 ? flyTo(lsView('side')) : view('side')));
onTap($('#vw-reset'), () => (stage === 4 ? (nMode === 'formation' ? goStep(nStep) : nMode === 'regulation' ? goReg() : selectN(null)) : stage === 3 ? selectV(null) : stage === 2 ? selectLS(null) : focusUnit(null)));
function setCredits(on) { const c = $('#credits'); c.classList.toggle('open', on); c.setAttribute('aria-hidden', String(!on)); c.inert = !on; $('#credits-open').setAttribute('aria-expanded', String(on)); }
$('#credits').inert = true;
onTap($('#credits-open'), () => setCredits(!$('#credits').classList.contains('open')));
onTap($('#credits-close'), () => setCredits(false));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#credits').classList.contains('open')) setCredits(false); });

/* ================= picking (tap, not drag) ================= */
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 16) return;
  const r = renderer.domElement.getBoundingClientRect();
  if (stage === 4 && nMode === 'structure' && nMesh.cel.length && layers.cel !== false) { // tapping the magnified cells opens the cell view
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    if (ray.intersectObjects(nMesh.cel.filter((m) => m.name.startsWith('cell_')), false)[0]) { selectN('cells'); return; }
  }
  if (stage >= 2) { // tap near a structure's dot selects it
    const els = stage === 2 ? lsEls : stage === 3 ? vEls : nEls, anc = stage === 2 ? lsAnchors : stage === 3 ? vAnchors : nAnchors;
    let best = null, bd = 44;
    for (const { a, el } of els) { if (el.classList.contains('hidden')) continue; tmp.copy(anc[a.id]).project(camera); const d = Math.hypot((tmp.x * 0.5 + 0.5) * r.width - (e.clientX - r.left), (-tmp.y * 0.5 + 0.5) * r.height - (e.clientY - r.top)); if (d < bd) { bd = d; best = a.id; } }
    if (best) (stage === 2 ? selectLS : stage === 3 ? selectV : selectN)(best);
    return;
  }
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const hit = ray.intersectObjects(pickables.filter(shown), false)[0];
  if (hit) return select(hit.object.userData.struct, true);
});

/* ================= Stage 2: Kidney L.S. ================= */
// Anchors are points on the source model (its own coordinates), picked from the cut face and checked against the
// model's tissue colours: cortex/columns, pyramids, pale calyces/pelvis, bright-red artery, dark vein.
const LS_ANCHORS = [
  { id: 'capsule', n: 1, label: 'Renal capsule', p: [-0.3063, 0.085, -0.9473] },
  { id: 'cortex', n: 2, label: 'Cortex', p: [0.0703, -0.7747, -0.5856], face: true },
  { id: 'pyramid', n: 3, label: 'Medullary pyramid', p: [-0.0934, -0.0242, -0.7803], face: true },
  { id: 'column', n: 4, label: 'Renal column', p: [0.0704, 0.0847, -0.6857], face: true, away: true },
  { id: 'papilla', n: 5, label: 'Renal papilla', p: [0.3841, 0.6799, -0.5487], face: true },
  { id: 'minor', n: 6, label: 'Minor calyx', p: [0.3432, 0.6035, -0.5988], face: true },
  { id: 'major', n: 7, label: 'Major calyx', p: [0.3296, -0.2289, -0.5149], face: true },
  { id: 'pelvis', n: 8, label: 'Renal pelvis', p: [0.5342, 0.0577, -0.3952], face: true },
  { id: 'hilum', n: 9, label: 'Hilum', p: [0.7799, -0.0105, -0.2264] },
  { id: 'ureter', n: 10, label: 'Ureter', p: [0.93, -0.5427, -0.01] },
  { id: 'artery', n: 'RA', label: 'Renal artery', p: [0.8017, 0.1259, -0.1721], cls: 'art' },
  { id: 'vein', n: 'RV', label: 'Renal vein', p: [0.7908, 0.2078, -0.1678], cls: 'ven' },
  { id: 'adrenal', n: 'A', label: 'Adrenal gland', p: [0.9436, 0.8218, -0.1889], layer: 'adr' },
];
const LS_CENTRE = new THREE.Vector3(0.23, 0.10, -0.62);       // middle of the kidney body on the cut face
const LS_NORMAL = new THREE.Vector3(-0.56, 0.10, 0.82).normalize(); // cut-face normal
const LS_SCALE = 0.11 / 1.94;                                 // source pole-to-pole length 1.94 units -> 11 cm
const LS_INFO = {
  overview: {
    eyebrow: 'Stage 2', tag: 'Longitudinal section', title: 'Kidney L.S.',
    lead: 'The kidney cut from top to bottom. Inside there are two zones, an outer cortex and an inner medulla. The section looks the same in males and females.',
    facts: [
      'The medulla is divided into a few conical masses, the medullary pyramids, which project into the calyces.',
      'The cortex extends in between the medullary pyramids as renal columns, called Columns of Bertini.',
      'Urine made by the nephrons drains: papilla → minor calyx → major calyx → renal pelvis → ureter.',
    ],
    metrics: [['≈ 1 million', 'nephrons in each kidney'], ['2 zones', 'outer cortex, inner medulla']],
  },
  capsule: { eyebrow: 'Covering', tag: 'Outer layer', title: 'Renal capsule',
    facts: ['The tough, fibrous outer layer of the kidney.', 'It protects the soft tissue inside and keeps the kidney\'s shape.'] },
  cortex: { eyebrow: 'Zone', tag: 'Outer', title: 'Renal cortex',
    facts: [
      'The outer zone of the kidney, just inside the capsule. It looks granular.',
      'The Malpighian corpuscles (glomerulus with Bowman\'s capsule), the PCT and the DCT of the nephrons lie in the cortex.',
      'Most nephrons are cortical nephrons, whose loop of Henle is very short and dips only a little into the medulla.',
      'Juxtamedullary nephrons sit near the medulla and have long loops that run deep into it.',
    ] },
  pyramid: { eyebrow: 'Zone', tag: 'Inner', title: 'Medulla: medullary pyramid',
    facts: [
      'The medulla is the inner zone of the kidney. It is divided into conical masses called medullary pyramids.',
      'Each pyramid has its broad base towards the cortex and its tip, the renal papilla, pointing into a calyx.',
      'Its striped look comes from the loops of Henle, collecting ducts and vasa recta running through it.',
    ] },
  column: { eyebrow: 'Zone', tag: 'Cortex', title: 'Renal column (Column of Bertini)',
    facts: [
      'Cortical tissue that extends inwards between two medullary pyramids.',
      'Branches of the renal artery and vein (interlobar vessels) run through the columns.',
    ] },
  papilla: { eyebrow: 'Drainage', tag: 'Pyramid tip', title: 'Renal papilla',
    facts: [
      'The tip of a medullary pyramid.',
      'The collecting ducts open here, releasing urine into a minor calyx.',
    ] },
  minor: { eyebrow: 'Drainage', tag: 'Collecting space', title: 'Minor calyx',
    facts: [
      'A cup-shaped space that fits around one renal papilla and receives its urine.',
      'Several minor calyces join to form a major calyx.',
    ] },
  major: { eyebrow: 'Drainage', tag: 'Collecting space', title: 'Major calyx',
    facts: [
      'Formed where several minor calyces join.',
      'The major calyces join to form the renal pelvis.',
    ] },
  pelvis: { eyebrow: 'Drainage', tag: 'Funnel', title: 'Renal pelvis',
    facts: [
      'A broad, funnel-shaped space inner to the hilum. Its projections are the calyces.',
      'It collects urine from the calyces and narrows into the ureter.',
    ] },
  hilum: { eyebrow: 'Landmark', tag: 'Notch', title: 'Hilum',
    facts: [
      'A notch at the centre of the inner concave surface of the kidney.',
      'The ureter, blood vessels and nerves enter or leave the kidney here.',
    ] },
  ureter: { eyebrow: 'Conducting tube', tag: 'Paired', title: 'Ureter',
    facts: [
      'Continues from the renal pelvis and carries urine down to the urinary bladder.',
      'Peristalsis in its smooth-muscle wall pushes the urine along.',
    ], metrics: [['25–30 cm', 'adult length']] },
  artery: { eyebrow: 'Blood vessel', tag: 'In', title: 'Renal artery',
    facts: [
      'Brings blood, carrying wastes such as urea, from the abdominal aorta into the kidney at the hilum.',
      'Inside, it branches repeatedly; every nephron finally receives blood through an afferent arteriole.',
      'About a fifth of the blood the heart pumps each minute passes through the two kidneys.',
    ], metrics: [['≈ 1200 mL', 'blood through both kidneys per minute']] },
  vein: { eyebrow: 'Blood vessel', tag: 'Out', title: 'Renal vein',
    facts: [
      'Carries filtered blood out of the kidney at the hilum, into the inferior vena cava.',
      'This blood has less urea than the blood that arrived in the renal artery.',
    ] },
  adrenal: { eyebrow: 'Endocrine gland', tag: 'Not excretory', title: 'Adrenal (suprarenal) gland',
    facts: [
      'Sits on the upper pole of the kidney but belongs to the endocrine system.',
      'Its cortex secretes aldosterone, which makes the distal parts of the tubule reabsorb Na⁺ and water.',
    ] },
};

let stage = 1, lsSide = 'R', lsSel = null, lsRoot = null, lsScaleG = null, lsLoading = null, lastFocus = null;
const lsAnchors = {}; const lsEls = [];
async function ensureLS() {
  if (lsRoot) return;
  if (!lsLoading) lsLoading = (async () => {
    const g = await loadAsset('ls', stageProg, 0.05, 0.8); if (stageProg) { stageProg.phase(0.8, 0.98, 'Preparing…'); await nextFrame(); }
    const inner = new THREE.Group(); inner.add(g.scene); inner.position.copy(LS_CENTRE).negate();
    const rot = new THREE.Group(); rot.quaternion.setFromUnitVectors(LS_NORMAL, new THREE.Vector3(0, 0, 1)); rot.add(inner);
    lsScaleG = new THREE.Group(); lsScaleG.add(rot);
    lsRoot = new THREE.Group(); lsRoot.position.set(0, 1, 0); lsRoot.add(lsScaleG); lsRoot.visible = false; scene.add(lsRoot);
    g.scene.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.6 }); });
    for (const a of LS_ANCHORS) {
      const b = document.createElement('button');
      b.className = 'hs ls' + (a.cls ? ' ' + a.cls : '');
      b.innerHTML = `<span class="dot">${a.n}</span><span class="tag">${a.label}</span>`;
      b.setAttribute('aria-label', a.label); b.setAttribute('aria-pressed', 'false');
      bubbleTap(b, (e) => { e.stopPropagation(); selectLS(a.id); });
      hsLayer.appendChild(b); lsEls.push({ a, el: b, inner });
    }
  })();
  await lsLoading;
}
function setLSSide(side) {
  lsSide = side;
  lsScaleG.scale.set(LS_SCALE * (side === 'L' ? -1 : 1), LS_SCALE, LS_SCALE);
  lsRoot.updateMatrixWorld(true);
  for (const { a, inner } of lsEls) lsAnchors[a.id] = inner.localToWorld(new THREE.Vector3(...a.p)).add(new THREE.Vector3(0, 0, 0.0015));
}
function placeLS() {
  const w = renderer.domElement.clientWidth, hgt = renderer.domElement.clientHeight;
  mid.copy(lsRoot.position).project(camera);
  for (const { a, el } of lsEls) {
    const p = lsAnchors[a.id]; if (!p) continue;
    const facing = !a.face || camera.position.z - lsRoot.position.z > 0.02;
    const show = stage === 2 && facing && !(a.layer && !layers[a.layer]);
    tmp.copy(p).project(camera);
    el.classList.toggle('hidden', !show || tmp.z > 1);
    if (!show) continue;
    const left = a.away ? tmp.x >= mid.x : tmp.x < mid.x;
    el.classList.toggle('left', left);
    el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * hgt}px) translate(${left ? '-100%' : '0'}, -50%) translate(${left ? '13px' : '-13px'}, 0)`;
  }
}
function renderLSCard(id) {
  const d = LS_INFO[id];
  const sideName = lsSide === 'R' ? 'Right kidney' : 'Left kidney';
  let html = `<div class="eyebrow"><span>${d.eyebrow}</span><em>${d.tag} · ${sideName}</em></div><h2>${d.title}</h2>`;
  if (d.lead) html += `<p>${d.lead}</p>`;
  if (id === 'overview') html += `<div class="pick">${['R', 'L'].map((s) => `<button class="pickbtn" data-side="${s}" aria-pressed="${s === lsSide}"><b>${s === 'R' ? 'Right' : 'Left'}</b><span>hilum faces ${s === 'R' ? 'your right' : 'your left'}</span></button>`).join('')}</div>`;
  if (d.facts) html += `<ul>${d.facts.map((f) => `<li>${f}</li>`).join('')}</ul>`;
  if (d.metrics) html += `<div class="metrics">${d.metrics.map(([b, t]) => `<div class="metric"><b>${b}</b><span>${t}</span></div>`).join('')}</div>`;
  if (id === 'overview') html += `<p class="note">Viewed from the front. For the left kidney the same section is shown mirrored, so its hilum faces the midline.</p>`;
  html += `<div class="actions">`;
  if (id !== 'overview') html += `<button class="btn ghost" data-lsgo="overview">Section overview</button>`;
  if (id === 'overview') html += `<button class="btn" data-stage="3">Open blood supply &amp; drainage</button>`;
  html += `<button class="btn ghost" data-stage="1">Back to Stage 1</button></div>`;
  card.innerHTML = html;
  card.querySelectorAll('[data-side]').forEach((b) => onTap(b, () => { setLSSide(b.dataset.side); renderLSCard('overview'); }));
  card.querySelectorAll('[data-lsgo]').forEach((b) => onTap(b, () => selectLS(null)));
  card.querySelectorAll('[data-stage]').forEach((b) => onTap(b, () => enterStage(+b.dataset.stage)));
}
function selectLS(id) {
  lsSel = id;
  lsEls.forEach(({ a, el }) => el.setAttribute('aria-pressed', String(a.id === id)));
  renderLSCard(id || 'overview');
  if (!id) return flyTo(lsView('front'));
  const t = lsAnchors[id].clone();
  flyTo({ target: t, pos: t.clone().add(new THREE.Vector3(0.03, 0.01, 0.17)) });
}
function lsView(which) {
  const c = lsRoot.position;
  if (which === 'back') return { target: c.clone(), pos: c.clone().add(new THREE.Vector3(0, 0.02, -0.34)) };
  if (which === 'side') return { target: c.clone(), pos: c.clone().add(new THREE.Vector3(lsSide === 'L' ? -0.34 : 0.34, 0.02, 0.04)) };
  return { target: c.clone().add(new THREE.Vector3(0.012, -0.012, 0)), pos: c.clone().add(new THREE.Vector3(0.02, 0.0, 0.34)) };
}


/* ================= Stage 3: blood supply and drainage ================= */
// Stylised kidney, cleaned in tools/vasc_prep.mjs: the rim vessel along the inside of the capsule was removed (no renal vessel
// runs that way), floating fragments dropped, and every tube carries _dist = path length from the hilum, used to animate flow.
const V_ANCHORS = {"renalArtery": [57.23, -21.57, 6.11], "segmental": [36.51, -11.83, 13.1], "interlobarA": [-31.4, 9.98, 8.51], "interlobarV": [-19.78, -60.18, 7.53], "renalVein": [86.96, -24.86, 7], "pyramid": [11.92, 70.62, -5.33], "papilla": [12.37, 55.83, -5.23], "minorCalyx": [-20.32, -10.56, 2.72], "majorCalyx": [28.2, -80.01, -1.69], "pelvis": [42.63, -44.27, -0.89], "ureter": [77.03, -38.43, 4.18]};
const V_CENTRE = new THREE.Vector3(7.54, -29.92, 0);
const V_SCALE = 0.11 / 270;            // shell pole-to-pole ≈ 270 units -> 11 cm
const V_HOTSPOTS = [
  { id: 'renalArtery', n: 'A1', label: 'Renal artery', cls: 'art', layer: 'art', away: true },
  { id: 'segmental', n: 'A2', label: 'Segmental artery', cls: 'art', layer: 'art' },
  { id: 'interlobarA', n: 'A3', label: 'Interlobar artery', cls: 'art', layer: 'art' },
  { id: 'interlobarV', n: 'V1', label: 'Interlobar vein', cls: 'ven', layer: 'ven' },
  { id: 'renalVein', n: 'V2', label: 'Renal vein', cls: 'ven', layer: 'ven' },
  { id: 'pyramid', n: 'U1', label: 'Medullary pyramid', layer: 'col' },
  { id: 'papilla', n: 'U2', label: 'Renal papilla', layer: 'col' },
  { id: 'minorCalyx', n: 'U3', label: 'Minor calyx', layer: 'col' },
  { id: 'majorCalyx', n: 'U4', label: 'Major calyx', layer: 'col' },
  { id: 'pelvis', n: 'U5', label: 'Renal pelvis', layer: 'col', away: true },
  { id: 'ureter', n: 'U6', label: 'Ureter', layer: 'col' },
];
const V_ROLE = { renalArtery: 'art', segmental: 'art', interlobarA: 'art', interlobarV: 'ven', renalVein: 'ven', pyramid: 'pyr', papilla: 'pyr', minorCalyx: 'col', majorCalyx: 'col', pelvis: 'col', ureter: 'col' };
const V_INFO = {
  overview: {
    eyebrow: 'Stage 3', tag: 'Two routes', title: 'Blood supply and drainage',
    lead: 'Blood enters and leaves the kidney at the hilum, through the renal artery and the renal vein. Urine leaves by a separate route: from the pyramids into the calyces, the renal pelvis and the ureter.',
    metrics: [['≈ 125 mL/min', 'filtrate formed by both kidneys (GFR), about 180 L a day'], ['≈ 99 %', 'of the filtrate is reabsorbed'], ['1–1.5 L', 'urine passed per day']],
    note: 'The model shows the larger vessels, down to the interlobar level. A vessel that ran round the inside of the capsule in the source model was removed, because no renal vessel runs that way.',
  },
  renalArtery: { eyebrow: 'Blood in', tag: 'Artery', title: 'Renal artery',
    facts: ['A branch of the abdominal aorta. It enters the kidney at the hilum.', 'The blood it brings still carries urea and other wastes.', 'About a fifth of the blood the heart pumps each minute passes through the two kidneys.'],
    metrics: [['≈ 1200 mL', 'blood through both kidneys per minute']] },
  segmental: { eyebrow: 'Blood in', tag: 'Artery', title: 'Segmental arteries',
    facts: ['In the renal sinus the renal artery divides into segmental arteries, each supplying one region of the kidney.', 'Segmental arteries do not join one another, so each region depends on its own branch.'] },
  interlobarA: { eyebrow: 'Blood in', tag: 'Artery', title: 'Interlobar arteries',
    facts: ['Run outwards through the renal columns, between the medullary pyramids.',
      'At the base of each pyramid they turn and arch along it as arcuate arteries. These give off interlobular arteries into the cortex.',
      'An afferent arteriole, a fine branch of the renal artery, then forms each glomerulus (Stage 4).'],
    note: 'The arcuate and interlobular arteries are too fine to be shown in this model.' },
  interlobarV: { eyebrow: 'Blood out', tag: 'Vein', title: 'Interlobar veins',
    facts: ['Run beside the interlobar arteries in the renal columns, carrying blood back towards the hilum.', 'The veins form a tree parallel to the arteries: interlobular → arcuate → interlobar → renal vein.'] },
  renalVein: { eyebrow: 'Blood out', tag: 'Vein', title: 'Renal vein',
    facts: ['Leaves the kidney at the hilum and drains into the inferior vena cava.',
      'Before reaching it, blood has passed through the glomerulus and then the peritubular capillaries or vasa recta around the tubule.',
      'It carries less urea than the blood that arrived in the renal artery.'] },
  pyramid: { eyebrow: 'Urine route', tag: 'Medulla', title: 'Medullary pyramid',
    facts: ['Contains the loops of Henle and the collecting ducts.', 'Its broad base faces the cortex; its tip, the papilla, points into a minor calyx.'] },
  papilla: { eyebrow: 'Urine route', tag: 'Pyramid tip', title: 'Renal papilla',
    facts: ['The collecting ducts of many nephrons open here.', 'Urine leaves the papilla and enters the minor calyx.'] },
  minorCalyx: { eyebrow: 'Urine route', tag: 'Collecting space', title: 'Minor calyx',
    facts: ['A cup that fits around one papilla and collects its urine.', 'Several minor calyces join to form a major calyx.'] },
  majorCalyx: { eyebrow: 'Urine route', tag: 'Collecting space', title: 'Major calyx',
    facts: ['Formed where minor calyces join.', 'The major calyces open into the renal pelvis.'] },
  pelvis: { eyebrow: 'Urine route', tag: 'Funnel', title: 'Renal pelvis',
    facts: ['A broad funnel-shaped space inner to the hilum. Its projections are the calyces.', 'It narrows into the ureter at the hilum.'] },
  ureter: { eyebrow: 'Urine route', tag: 'Conducting tube', title: 'Ureter',
    facts: ['Carries urine from the renal pelvis to the urinary bladder.', 'Peristalsis in its wall pushes the urine along.'],
    note: 'This model shows only the first part of the ureter, as it leaves the hilum.' },
};
let vRoot = null, vScaleG = null, vLoading = null, vSel = null, vSide = 'R';
const vAnchors = {}, vEls = [], vMesh = {}, flowUniforms = [];
function flowMat(color, pulse, dir, extra = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.5, ...extra });
  const u = { uTime: { value: 0 }, uFlow: { value: REDUCED ? 0 : 1 }, uPulse: { value: new THREE.Color(pulse) }, uDir: { value: dir }, uSpace: { value: 28 } };
  flowUniforms.push(u);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float _dist;\nvarying float vDist;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vDist = _dist;');
    sh.fragmentShader = 'uniform float uTime; uniform float uFlow; uniform vec3 uPulse; uniform float uDir; uniform float uSpace;\nvarying float vDist;\n' +
      sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  float ph = fract(vDist / uSpace - uDir * uTime * 0.6);\n  float band = smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.1, 0.4, ph));\n  totalEmissiveRadiance += uPulse * band * uFlow;');
  };
  return m;
}
async function ensureV() {
  if (vRoot) return;
  if (!vLoading) vLoading = (async () => {
    const g = await loadAsset('vasc', stageProg, 0.05, 0.8); if (stageProg) { stageProg.phase(0.8, 0.98, 'Preparing…'); await nextFrame(); }
    const inner = new THREE.Group(); inner.add(g.scene); inner.position.copy(V_CENTRE).negate();
    vScaleG = new THREE.Group(); vScaleG.add(inner);
    vRoot = new THREE.Group(); vRoot.position.set(0, 1, 0); vRoot.add(vScaleG); vRoot.visible = false; scene.add(vRoot);
    g.scene.traverse((o) => {
      if (!o.isMesh) return; const n = o.name;
      const k = n.includes('arterias') ? 'art' : n.includes('venas') ? 'ven' : n.includes('tronco') ? 'col' : n.includes('Piramide') ? 'pyr' : n.includes('Edge') ? 'edge' : 'shell';
      if (k === 'art') o.material = flowMat(0xa3271f, 0xff8a6a, 1);          // arterial blood: away from the hilum
      else if (k === 'ven') o.material = flowMat(0x3f5fae, 0x9fc0ff, -1);      // venous blood: back to the hilum
      else if (k === 'col') o.material = flowMat(0xd9c08a, 0xffd36b, -1);      // urine: towards the pelvis and ureter
      else if (k === 'pyr') o.material = new THREE.MeshPhysicalMaterial({ color: 0x8d3a3a, roughness: 0.55, clearcoat: 0.2 });
      else if (k === 'edge') o.material = new THREE.MeshPhysicalMaterial({ color: 0x9c4a3c, roughness: 0.6 });
      else o.material = new THREE.MeshPhysicalMaterial({ color: 0x5a2a24, roughness: 0.7, side: THREE.DoubleSide });
      o.material.emissive = o.material.emissive || new THREE.Color(0);
      (vMesh[k] ||= []).push(o);
    });
    for (const a of V_HOTSPOTS) {
      const b = document.createElement('button');
      b.className = 'hs ls' + (a.cls ? ' ' + a.cls : '');
      b.innerHTML = `<span class="dot">${a.n}</span><span class="tag">${a.label}</span>`;
      b.setAttribute('aria-label', a.label); b.setAttribute('aria-pressed', 'false');
      bubbleTap(b, () => selectV(a.id));
      hsLayer.appendChild(b); vEls.push({ a, el: b, inner });
    }
  })();
  await vLoading;
}
function setVSide(side) {
  vSide = side;
  vScaleG.scale.set(V_SCALE * (side === 'L' ? -1 : 1), V_SCALE, V_SCALE);
  vRoot.updateMatrixWorld(true);
  for (const { a, inner } of vEls) vAnchors[a.id] = inner.localToWorld(new THREE.Vector3(...V_ANCHORS[a.id]));
}
function placeV() {
  const w = renderer.domElement.clientWidth, hgt = renderer.domElement.clientHeight;
  mid.copy(vRoot.position).project(camera);
  for (const { a, el } of vEls) {
    const p = vAnchors[a.id]; if (!p) continue;
    const show = stage === 3 && layers[a.layer] !== false && camera.position.z - vRoot.position.z > 0.0;
    tmp.copy(p).project(camera);
    el.classList.toggle('hidden', !show || tmp.z > 1);
    if (!show) continue;
    const left = a.away ? tmp.x >= mid.x : tmp.x < mid.x;
    el.classList.toggle('left', left);
    el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * hgt}px) translate(${left ? '-100%' : '0'}, -50%) translate(${left ? '13px' : '-13px'}, 0)`;
  }
}
const PATH_BLOOD = [['renalArtery', 'Renal artery'], [null, 'Afferent arteriole'], [null, 'Glomerulus'], [null, 'Efferent arteriole'], [null, 'Peritubular capillaries'], ['renalVein', 'Renal vein']];
const PATH_URINE = [[null, 'Collecting duct'], ['minorCalyx', 'Calyces'], ['pelvis', 'Renal pelvis'], ['ureter', 'Ureter']];
function pathHTML(title, items, cls) {
  return `<div class="pathway"><span class="pw-t ${cls}">${title}</span><div class="route">${items.map(([id, t], i) => (i ? '<span class="arw">→</span>' : '') + (id ? `<button class="chip" data-vgo="${id}">${t}</button>` : `<span class="chip ghostchip" title="Too fine to show here">${t}</span>`)).join('')}</div></div>`;
}
function renderVCard(id) {
  const d = V_INFO[id];
  const sideName = vSide === 'R' ? 'Right kidney' : 'Left kidney';
  let html = `<div class="eyebrow"><span>${d.eyebrow}</span><em>${d.tag} · ${sideName}</em></div><h2>${d.title}</h2>`;
  if (d.lead) html += `<p>${d.lead}</p>`;
  if (id === 'overview') html += pathHTML('Blood', PATH_BLOOD, 'art') + pathHTML('Urine', PATH_URINE, 'uri') + `<p class="note">Faded steps are inside the nephron. See them in Stage 4.</p>`;
  if (d.facts) html += `<ul>${d.facts.map((f) => `<li>${f}</li>`).join('')}</ul>`;
  if (d.metrics) html += `<div class="metrics">${d.metrics.map(([b, t]) => `<div class="metric"><b>${b}</b><span>${t}</span></div>`).join('')}</div>`;
  if (d.note) html += `<p class="note">${d.note}</p>`;
  html += `<div class="actions">`;
  if (id === 'overview') html += `<button class="btn ghost" data-vside="${vSide === 'R' ? 'L' : 'R'}">Show ${vSide === 'R' ? 'left' : 'right'} kidney</button>`;
  else html += `<button class="btn ghost" data-vgo="">Stage 3 overview</button>`;
  if (id === 'overview' || id === 'interlobarA') html += `<button class="btn" data-stage="4">Open the nephron</button>`;
  html += `<button class="btn ghost" data-stage="2">Back to Kidney L.S.</button></div>`;
  card.innerHTML = html;
  card.querySelectorAll('[data-vgo]').forEach((b) => onTap(b, () => selectV(b.dataset.vgo || null)));
  card.querySelectorAll('[data-vside]').forEach((b) => onTap(b, () => { setVSide(b.dataset.vside); renderVCard('overview'); }));
  card.querySelectorAll('[data-stage]').forEach((b) => onTap(b, () => enterStage(+b.dataset.stage)));
}
function selectV(id) {
  vSel = id;
  vEls.forEach(({ a, el }) => el.setAttribute('aria-pressed', String(a.id === id)));
  for (const list of Object.values(vMesh)) list.forEach((m) => m.material.emissive.setHex(0));
  renderVCard(id || 'overview');
  if (!id) return flyTo(vView('front'));
  const t = vAnchors[id].clone();
  flyTo({ target: t, pos: t.clone().add(new THREE.Vector3(0.025, 0.01, 0.16)) });
}
function vView(which) {
  const c = vRoot.position;
  if (which === 'back') return { target: c.clone(), pos: c.clone().add(new THREE.Vector3(0, 0.02, -0.32)) };
  if (which === 'side') return { target: c.clone(), pos: c.clone().add(new THREE.Vector3(vSide === 'L' ? -0.3 : 0.3, 0.02, 0.12)) };
  return { target: c.clone().add(new THREE.Vector3(0.012, -0.004, 0)), pos: c.clone().add(new THREE.Vector3(0.02, 0.0, 0.31)) };
}

/* ================= Stage 4: the nephron and urine formation ================= */
// Model: iqcenter "Nephron" (juxtamedullary: long loop with vasa recta). Tubule centre line traced in tools/nephron_prep.mjs.
const N_PATH = {"pts":[[-428.27,232.12,-88.05],[-427,228.32,-82.35],[-425.77,225.9,-76.27],[-424.14,223.36,-71.16],[-421.2,219.53,-63],[-418.1,215.91,-54.29],[-414.3,212.15,-44.37],[-409.84,208.65,-33.21],[-405.78,207.77,-25.79],[-401.57,206.54,-20.08],[-397.12,206.24,-14.26],[-391.64,206.55,-8.66],[-386.18,206.76,-3.89],[-379.8,207.45,0.75],[-373.82,207.68,4.29],[-366.85,208.38,7.55],[-359.59,209.74,11.07],[-351.97,211.4,13.62],[-345.96,212.91,15.1],[-339.67,215.01,16.77],[-334.09,216.97,18.08],[-327.46,219.63,18.55],[-321.63,221.47,18.94],[-315.49,223.69,18.61],[-309.71,226.75,18.28],[-303.34,230.2,17.47],[-294.17,235.11,13.84],[-282.92,238.52,4.89],[-272.65,241.56,-3.69],[-261.23,245.94,-12.79],[-247.66,251.23,-21.91],[-232.74,256.75,-31.57],[-217.98,263,-40.51],[-205.83,267.73,-47.54],[-196.42,274,-49.7],[-186.52,280.72,-51.53],[-177.92,286.92,-52.93],[-172.13,291.61,-54.1],[-167.84,294.99,-54.68],[-162.91,296.26,-55.49],[-158.06,296.6,-55.38],[-152.68,296.26,-54.93],[-147.73,293.27,-54.07],[-143.14,289.19,-52.99],[-139.02,283.85,-51.76],[-136.34,276.22,-49.9],[-135.66,268.23,-47.78],[-135.81,260.1,-45.82],[-137.71,251.24,-43.78],[-140.14,243.79,-41.96],[-142.77,235.65,-39.83],[-146.03,227.53,-37.39],[-148.53,220.58,-34.75],[-149.59,213.97,-31.76],[-149.96,207.52,-28.27],[-148.37,201.54,-25.17],[-145.17,196.6,-21.91],[-139.86,195.41,-21.5],[-133.8,196.15,-21.94],[-127.42,199.02,-23.68],[-121.33,203.38,-26.65],[-115.09,209.74,-30.68],[-108,219.45,-35.97],[-101.26,230.11,-42.08],[-95.84,240.77,-46.39],[-89.47,252.07,-50.18],[-83.07,262.7,-53.31],[-76.95,272.49,-56.08],[-71.17,280.09,-57.3],[-66.88,285.57,-56.58],[-62.81,288.08,-52.8],[-59.32,287.74,-48.2],[-56.45,285.15,-43.29],[-55.21,280.55,-38.34],[-53.42,274.09,-34.5],[-51.53,267.76,-32.16],[-48.74,260.44,-31.49],[-45.45,255.07,-34.06],[-41.3,250.91,-36.69],[-37.05,247.46,-39.36],[-31.24,245.43,-42.13],[-25.91,246.02,-44.07],[-20.46,247.39,-45.05],[-15.91,249.07,-45.24],[-12.15,252.21,-44.74],[-9.11,256.06,-44.63],[-5.76,259.93,-45.1],[-2.4,263.87,-45.37],[1.54,266.8,-45.36],[5.72,268.21,-45],[7.89,266.11,-44.18],[8.99,262.17,-43.69],[10.57,256.66,-42.81],[12.35,249.83,-41.42],[13.07,240.48,-39.18],[12.19,230.55,-35.75],[9.43,220.93,-32.83],[8.03,214.16,-29.83],[6.25,206.81,-25.93],[2.73,198.72,-21.58],[-2.85,190.85,-16.67],[-7.6,184.03,-11.71],[-10.62,177.37,-7.16],[-10.54,172.12,-2.9],[-9.48,167.6,1.43],[-6.74,165.17,5.06],[-2.23,163.99,7.32],[4.6,164.57,7.37],[11.91,166.8,6.29],[19.65,170.94,2.87],[25.84,175.12,-1.49],[32.1,179.45,-6.88],[37.81,182.28,-12.03],[44.92,182.75,-16.37],[51.34,181.68,-18.59],[57.65,178.21,-20.66],[61.44,169.21,-20.95],[64.99,158.24,-19.94],[68.55,146.42,-18.23],[71.75,130.89,-16.33],[71.94,114.45,-14],[71.93,97.76,-12.3],[70.83,80.04,-10.43],[70.83,65.56,-7.82],[69.66,49.69,-6.92],[68.54,33.44,-6.3],[67.74,19.41,-5.02],[68.2,6.85,-3.47],[67.34,-5.78,-2.28],[66.64,-17.81,-0.41],[65.87,-30.9,0.9],[66.45,-41.58,4.2],[65.55,-51.92,7.7],[64.24,-60.95,10.19],[63.12,-69.68,12],[62.88,-77.46,14.11],[62.82,-84.67,15.28],[63.48,-90.99,16.04],[64.81,-97.22,16.21],[68.88,-102.95,16.95],[74.47,-107.5,17.56],[80.1,-110.61,17.61],[86.21,-112.61,17.28],[93.31,-112.06,16.88],[101.26,-106.91,16.12],[107.69,-95.51,14.45],[111.91,-79.21,12.19],[115.11,-63.06,9.66],[117.05,-45.52,7.04],[118.89,-26.13,4.52],[120.84,-6.54,2.06],[121.18,11.24,0.03],[122.51,25.14,-1.42],[124.13,35.49,-2.58],[125.45,46.66,-3.89],[126.74,59.99,-5.44],[128.6,73.66,-6.79],[129.23,86.95,-8.51],[129.48,100.9,-10.86],[128.94,114.75,-12.72],[128.43,128.3,-15.23],[127.69,141.1,-17.69],[127.66,150.89,-18.72],[126.92,159.03,-18.73],[126.6,168.28,-17.48],[127.16,176.62,-15.92],[127.26,183.86,-14.34],[127.08,192.55,-13.97],[126.88,201.35,-13.9],[126.94,211.29,-16.19],[126.82,220.35,-20.66],[127.08,229.53,-29.27],[127.15,237.69,-38.74],[128.19,245.27,-49.01],[129.91,250.54,-58.11],[131.91,254.35,-67.02],[134.67,256.11,-74.83],[139.28,256.34,-81.56],[144.25,254.06,-85.23],[150.19,249.92,-86.86],[156.98,245.16,-88.17],[163.4,239.77,-89],[169.33,232.77,-88.58],[175.04,225.47,-87.58],[179.06,218.32,-86.03],[182.86,211.39,-83.61],[185.28,205.6,-81.63],[187.41,199.17,-78.2],[191.09,192.7,-72.17],[195.06,187.4,-65.63],[199.92,182.78,-56.97],[205.28,179.57,-47.77],[210.13,177.32,-38.76],[215.87,176.46,-28.68],[220.08,178.13,-18.61],[222.54,181.64,-9.94],[224.67,186.18,-1.03],[224.44,191.37,6.49],[222.49,196.15,13.81],[219.51,200.31,21.14],[214.65,203.94,27.38],[208.77,205.51,32.73],[201.11,206.25,35.16],[193.26,207.28,34.44],[186,208.02,31.7],[179.68,208.97,27.21],[174.22,210.42,21.76],[170.04,212.44,14.53],[168.47,217.34,5.47],[170.27,223.78,-3.09],[172.92,230.2,-10.15],[176.3,236.28,-16.36],[179.67,242.89,-22.08],[184.35,251.54,-29.1],[188.31,261.56,-35.08],[191.66,269.45,-39.99],[193.76,275.82,-44.2],[195.13,282.77,-48.13],[195.71,289.75,-52.93],[197.21,297.18,-57.21],[197.26,302.56,-60.52],[199.4,307.45,-60.17],[202.55,311.57,-57.66],[205.43,315.16,-53.57],[209.38,317.96,-48.27],[213.6,319.06,-38.71],[217.35,319.02,-28.82],[221.65,319,-17.44],[224.56,316.48,-7.3],[226.26,313.57,2.38],[227.86,310.51,11.42],[229.28,305.18,19.77],[231.42,299.13,24.49],[233.13,291.95,27.66],[234.65,284.01,29.33],[236.89,275.74,27.7],[239.27,267.42,24.34],[242.6,259.18,19.43],[245.48,252.49,13.61],[248.46,246.76,8],[252.72,241.45,3.26],[257.91,235.79,-0.49],[264.45,230.31,-2.28],[272.13,225.27,-3.66],[279.82,220.52,-3.73],[288.53,216.77,-4],[297.71,215.06,-4.33],[305.96,215.67,-5.49],[312.61,218.29,-7.61],[316.5,222.46,-10.76],[318.15,228.36,-14.45],[318.27,234.83,-18.64],[316.14,241.83,-22.02],[312.17,248.29,-24.68],[307.41,253.17,-27.03],[302.23,257.79,-28.07],[297.01,262.54,-29.41],[291.64,267.25,-29.57],[286.57,271.96,-30.29],[281.94,276.96,-31.1],[277.37,283.58,-32.38],[272.95,291.81,-34.06],[270.1,300.77,-36.15],[268.57,309.86,-38.34],[269.25,318.69,-41.16],[271.35,327.26,-42.68],[275.49,334.05,-43.69],[281.05,337.85,-43.22],[287.89,339.57,-40.92],[295.37,339.68,-38.79],[303.23,338.25,-34.24],[311.52,334.62,-28.44],[319.52,330.34,-22.53],[326.55,325.08,-16.29],[333.46,319.6,-11.06],[340.59,313.67,-6.34],[347.2,306.74,-1.05],[354.27,299.83,1.82],[361.52,292.07,1.57],[370.46,280.29,-2.02],[379.1,267.3,-6.85],[386.12,253.13,-9.92],[390.8,237.96,-10.76],[393.24,214.54,-8.33],[395.02,189.98,-5.78],[396.36,165.67,-3.52],[397.17,144.89,-1.77],[397.8,114.25,0.47],[397.78,85.83,2.2],[397.22,58.63,3.53],[396.42,37.57,4.35],[395.35,17.2,4.97],[394.05,-2.07,5.4],[392.45,-21.85,5.68],[391.76,-29.44,5.74],[391.3,-34.31,5.77],[390.69,-40.45,5.79],[390.33,-43.96,5.79]],"arc":[0,6.96,13.62,19.56,29.03,38.97,50.24,62.75,71.25,78.46,85.79,93.63,100.88,108.8,115.75,123.47,131.66,139.87,146.23,153.07,159.13,166.3,172.42,178.96,185.5,192.8,203.81,218.59,232.31,247.55,264.74,283.34,301.7,316.51,328.03,340.13,350.82,358.37,363.86,369.01,373.88,379.28,385.13,391.37,398.22,406.52,414.81,423.18,432.47,440.51,449.34,458.42,466.26,473.59,480.93,487.85,494.59,500.04,506.16,513.37,521.43,531.21,544.35,558.36,571.08,584.59,597.38,609.26,618.88,625.88,631.98,637.76,644.01,650.88,658.61,665.61,673.47,680.28,686.71,692.8,699.55,705.25,710.96,715.81,720.73,725.64,730.78,735.97,740.88,745.3,748.43,752.55,758.35,765.55,775.19,785.72,796.16,803.69,812.2,822.04,832.86,842.54,851.15,857.92,864.27,869.42,874.6,881.45,889.17,898.6,907.24,916.57,924.76,933.1,939.99,947.48,957.25,968.82,981.29,997.25,1013.86,1030.63,1048.49,1063.2,1079.14,1095.44,1109.55,1122.22,1134.93,1147.12,1160.3,1171.5,1182.45,1191.91,1200.89,1208.96,1216.26,1222.66,1229.03,1236.1,1243.34,1249.77,1256.2,1263.34,1272.85,1286.04,1303.03,1319.69,1337.53,1357.17,1377.01,1394.91,1408.94,1419.48,1430.81,1444.3,1458.15,1471.57,1485.72,1499.7,1513.49,1526.55,1536.39,1544.57,1553.91,1562.41,1569.81,1578.52,1587.33,1597.52,1607.62,1620.22,1632.71,1645.53,1656.18,1666.07,1674.54,1682.7,1689.29,1696.71,1705.1,1713.53,1722.71,1732.03,1740.38,1748.65,1755.22,1762.82,1772.39,1781.7,1792.66,1803.78,1814.26,1825.89,1836.93,1846.6,1856.82,1865.96,1874.92,1883.86,1892.56,1900.67,1908.74,1916.69,1924.48,1932.3,1940.15,1948.74,1959.16,1970.02,1979.93,1989.25,1998.61,2010.7,2023.02,2032.9,2040.82,2048.91,2057.41,2066.12,2072.44,2077.79,2083.55,2089.7,2096.88,2107.39,2117.97,2130.13,2140.97,2151.23,2160.9,2170.91,2178.87,2186.91,2195.16,2203.89,2213.17,2223.32,2232.65,2241.2,2249.5,2258.04,2266.77,2276.05,2285.09,2294.58,2303.93,2312.27,2319.74,2326.25,2333.4,2341.11,2349.17,2357.2,2364.41,2371.44,2378.62,2385.76,2392.72,2399.59,2407.73,2417.21,2426.85,2436.32,2445.62,2454.57,2462.59,2469.33,2476.76,2484.54,2493.73,2504.47,2515.31,2526.07,2536.33,2546.73,2557.68,2567.97,2578.59,2593.81,2610.14,2626.25,2642.15,2665.82,2690.58,2715.03,2735.89,2766.63,2795.1,2822.33,2843.42,2863.84,2883.16,2902.99,2910.62,2915.51,2921.68,2925.21]};
const N_CENTRE = new THREE.Vector3(-50, 150, -50), N_SCALE = 0.0005;   // ~1000 model units -> 0.5 m on screen (magnified)
const N_SEG = [
  { id: 'capsule', a: 0, b: 245 }, { id: 'pct', a: 245, b: 945 }, { id: 'desc', a: 945, b: 1245 },
  { id: 'asc', a: 1245, b: 1600 }, { id: 'dct', a: 1600, b: 2560 }, { id: 'cd', a: 2560, b: 2925 },
];
const SEG_RANGE = { distal: [1600, 2925], capsule: [0, 245], pct: [245, 945], desc: [945, 1245], loop: [945, 1600], asc: [1245, 1600], dct: [1600, 2560], cd: [2560, 2925] };
const N_FIXED = { glomerulus: [-330, 251.3, -77.5], capsule: [-330, 160.3, -26.1], afferent: [-505.6, 268.5, -97.2], efferent: [-330, 119.6, 26.2], cells: [-150, 382, -40] };
const N_HOTSPOTS = [
  { id: 'glomerulus', n: 1, label: 'Glomerulus' },
  { id: 'capsule', n: 2, label: "Bowman's capsule" },
  { id: 'pct', n: 3, label: 'PCT', arc: 560 },
  { id: 'desc', n: 4, label: 'Descending limb', arc: 1090, side: 'left' },
  { id: 'loop', n: 5, label: "Henle's loop", arc: 1245, side: 'right' },
  { id: 'asc', n: 6, label: 'Ascending limb', arc: 1440, side: 'right' },
  { id: 'dct', n: 7, label: 'DCT', arc: 2080 },
  { id: 'cd', n: 8, label: 'Collecting duct', arc: 2780 },
  { id: 'afferent', n: 'AA', label: 'Afferent arteriole', cls: 'art', layer: 'ves' },
  { id: 'efferent', n: 'EA', label: 'Efferent arteriole', cls: 'art', layer: 'ves' },
  { id: 'peritubular', n: 'PC', label: 'Peritubular capillaries', cls: 'art', layer: 'ves', near: ['art', 1900] },
  { id: 'vasarecta', n: 'VR', label: 'Vasa recta', cls: 'ven', layer: 'ves', near: ['ven', 1150] },
  { id: 'cells', n: 'C', label: 'PCT cells', layer: 'cel' },
  { id: 'k_parietal', label: 'Parietal layer', capd: true, p: [-317.5,  344.2,  -27] },
  { id: 'k_space', label: "Bowman's space", capd: true, p: [-360.8,  197.5,  0.6] },
  { id: 'k_pod', label: 'Podocytes (visceral layer)', capd: true, p: [-290.2,  241.9,  -24] },
  { id: 'k_vpole', label: 'Vascular pole', capd: true, p: [-435.3,  261.6,  -110.9] },
  { id: 'k_upole', label: 'Urinary pole → PCT', capd: true, p: [-233.4,  256.7,  -31.9] },
  { id: 'c_lumen', label: 'Lumen (filtrate)', cell: true, p: [-108, 381, -36] },
  { id: 'c_brush', label: 'Brush border', cell: true, p: [-150, 398, -38], side: 'left' },
  { id: 'c_nuc', label: 'Nucleus', cell: true, p: [-110, 446, -48] },
  { id: 'c_cap', label: 'Peritubular capillary', cell: true, p: [-108, 472, -45] },
];
const N_INFO = {
  overview: { eyebrow: 'Stage 4', tag: 'Structure', title: 'The nephron',
    lead: 'The functional unit of the kidney. Each nephron has two parts: the glomerulus and the renal tubule.',
    facts: ['The glomerulus and Bowman\'s capsule together form the Malpighian corpuscle (renal corpuscle).',
      'The tubule continues as the PCT, Henle\'s loop (descending and ascending limbs) and the DCT, which opens into a collecting duct.',
      'The Malpighian corpuscle, PCT and DCT lie in the cortex; Henle\'s loop dips into the medulla.',
      'This model is a juxtamedullary nephron: its loop is long and it has a vasa recta.'],
    metrics: [['≈ 1 million', 'nephrons in each kidney'], ['≈ 125 mL/min', 'GFR, about 180 L a day']] },
  glomerulus: { eyebrow: 'Malpighian corpuscle', tag: 'Capillaries', title: 'Glomerulus',
    facts: ['A tuft of capillaries formed by the afferent arteriole, a fine branch of the renal artery.', 'Blood from the glomerulus is carried away by the efferent arteriole.', 'Blood is filtered here: the first step of urine formation.'] },
  capsule: { eyebrow: 'Malpighian corpuscle', tag: 'Double-walled', title: "Bowman's capsule",
    facts: ['A double-walled cup-like structure that encloses the glomerulus. The glomerulus pushes into it like a fist into a balloon, so the capsule is almost closed around it.',
      'Its outer parietal layer forms the wall. Its inner visceral layer is made of podocytes, which wrap the glomerular capillaries and leave minute spaces called filtration slits or slit pores.',
      "Filtrate collects in Bowman's space, between the two layers.",
      'The afferent and efferent arterioles enter and leave at the vascular pole; the opposite urinary pole opens into the PCT.'],
    note: 'Part of the wall is cut away facing you, so the glomerulus and Bowman\'s space can be seen, as in a textbook section.' },
  pct: { eyebrow: 'Renal tubule', tag: 'Cortex', title: 'Proximal convoluted tubule (PCT)',
    facts: ['The highly coiled part of the tubule that follows Bowman\'s capsule.', 'Lined by simple cuboidal brush-border epithelium, which increases the surface for reabsorption.', 'Nearly all essential nutrients and 70–80 % of the electrolytes and water are reabsorbed here.', 'About 40–50 % of the urea is reabsorbed passively: as water leaves, urea becomes more concentrated and diffuses out.'] },
  desc: { eyebrow: "Henle's loop", tag: 'Medulla', title: 'Descending limb',
    facts: ['Permeable to water but almost impermeable to electrolytes.', 'Water leaves as the filtrate moves down, so the filtrate becomes concentrated.'] },
  loop: { eyebrow: 'Renal tubule', tag: 'Medulla', title: "Henle's loop",
    facts: ['A hairpin-shaped part with a descending and an ascending limb.', 'Reabsorption here is minimal, but the loop keeps the fluid around it in the medulla at high osmolarity.', 'In juxtamedullary nephrons like this one the loop is long and runs deep into the medulla; in cortical nephrons it is very short.'] },
  asc: { eyebrow: "Henle's loop", tag: 'Medulla', title: 'Ascending limb',
    facts: ['Impermeable to water but allows electrolytes to move out, actively or passively.', 'As the concentrated filtrate rises, it becomes diluted because electrolytes pass into the medullary fluid.'] },
  dct: { eyebrow: 'Renal tubule', tag: 'Cortex', title: 'Distal convoluted tubule (DCT)',
    facts: ['A highly coiled part that opens into the collecting duct.', 'Conditional reabsorption of Na⁺ and water happens here, along with reabsorption of HCO₃⁻.', 'It selectively secretes H⁺, K⁺ and NH₃ to keep the pH and the sodium–potassium balance of blood.'],
    note: 'In a real nephron the DCT passes close to its own glomerulus, where it forms the juxtaglomerular apparatus (JGA). This model does not show that contact.' },
  cd: { eyebrow: 'Collecting system', tag: 'Cortex → medulla', title: 'Collecting duct',
    facts: ['A long straight duct into which the DCTs of many nephrons open. The side branches in the model are where other nephrons join.', 'Large amounts of water can be reabsorbed here, producing concentrated urine.', 'It lets small amounts of urea pass into the medullary fluid and secretes H⁺ and K⁺.', 'Collecting ducts open into the renal pelvis through the medullary pyramids, in the calyces.'] },
  afferent: { eyebrow: 'Blood vessel', tag: 'In', title: 'Afferent arteriole',
    facts: ['A fine branch of the renal artery that brings blood to the glomerulus and forms its capillary tuft.', 'It is wider than the efferent arteriole, which keeps the blood pressure in the glomerulus high enough for filtration.'] },
  efferent: { eyebrow: 'Blood vessel', tag: 'Out', title: 'Efferent arteriole',
    facts: ['Carries blood away from the glomerulus.', 'It goes on to form a fine capillary network around the renal tubule, the peritubular capillaries.'] },
  peritubular: { eyebrow: 'Blood vessel', tag: 'Network', title: 'Peritubular capillaries',
    facts: ['A fine capillary network around the renal tubule, formed by the efferent arteriole.', 'Substances reabsorbed from the tubule return to the blood here, and substances secreted into the tubule come from here.'] },
  vasarecta: { eyebrow: 'Blood vessel', tag: 'U-shaped', title: 'Vasa recta',
    facts: ['A minute vessel of the peritubular network that runs parallel to Henle\'s loop, forming a U shape.', 'It is absent or highly reduced in cortical nephrons.', 'Blood flows through it in the direction opposite to the filtrate in the loop (Stage 4b: counter-current mechanism).'] },
  cells: { eyebrow: 'Magnified', tag: 'Reabsorption', title: 'PCT cells (brush border)',
    facts: ['Simple cuboidal epithelial cells line the PCT. The fringe of microvilli facing the lumen, the brush border, greatly increases the surface area for reabsorption.',
      'Glucose, amino acids and Na⁺ are reabsorbed actively from the filtrate; water is reabsorbed passively.',
      'Watch a particle near the brush border: it is drawn in at a microvillus tip, crosses the cell and leaves from its base into the peritubular capillary. A cell glows as it takes particles in.',
      'Nitrogenous wastes such as urea are absorbed only passively, so most stay in the filtrate. H⁺, NH₃ and K⁺ are secreted from the blood into the lumen.'],
    legend: true, note: 'Magnified inset, not to scale. Particle numbers are illustrative.' },
};
// Urine formation tour (NCERT wording); particle types are colour-coded in the legend
const P_TYPES = {
  water: { c: 0x4aa8ff, t: 'Water (H₂O)' }, na: { c: 0xf2f2f2, t: 'Na⁺' }, k: { c: 0xc07cff, t: 'K⁺' }, cl: { c: 0x52d8c8, t: 'Cl⁻' },
  hco3: { c: 0xff7fc8, t: 'HCO₃⁻' }, glu: { c: 0x3fbf62, t: 'Glucose' }, urea: { c: 0xffd84a, t: 'Urea' }, rbc: { c: 0xc4132f, t: 'Blood cells' },
};
const BLOOD_ONLY = { rbc: 1 };            // too large to be filtered
// reabsorption probability per type in each segment (illustrative numbers that follow NCERT's description)
const REABS = {
  pct: { glu: 1, water: 0.7, na: 0.72, cl: 0.72, k: 0.65, hco3: 0.85, urea: 0.4 }, desc: { water: 0.75 }, asc: { na: 0.85, cl: 0.85, k: 0.75, hco3: 0.6 },   // loop: enough water out (≈ ×4 by the bend) and salt out (hypotonic at the top) to match 300 → 1200 → dilute
  dct: { na: 0.35, cl: 0.3, water: 0.25, hco3: 0.6 }, cd: { water: 0.6, urea: 0.22, hco3: 0.5 },   // HCO₃⁻: almost all reabsorbed, urine nearly free of it
};
// secretion from the blood into the tubule: particles per second, by type
// K⁺: most filtered K⁺ is reabsorbed (PCT, ascending limb); a moderate amount is secreted, so urine carries well under the filtered load
const SECRETE = { pct: { k: 0.04 }, dct: { k: 0.07 }, cd: { k: 0.05 } };
const N_TOUR = [
  { id: 'filtration', seg: 'capsule', focus: 'glomerulus', title: '1 · Glomerular filtration', facts: [
    'Blood reaches the glomerulus through the afferent arteriole.',
    'Blood pressure filters it through three layers: the endothelium of the glomerular blood vessels, the epithelium of Bowman\'s capsule and the basement membrane between them. The podocytes leave filtration slits.',
    'Water, salts, glucose, amino acids and urea pass into the capsule. Proteins and blood cells are too large: they stay in the blood and leave through the efferent arteriole. This is ultrafiltration.'],
    metrics: [['≈ 125 mL/min', 'GFR in a healthy person'], ['≈ 180 L', 'filtrate formed per day']] },
  { id: 'pct', seg: 'pct', title: '2 · PCT: most reabsorption', facts: [
    'Nearly all glucose and amino acids, and 70–80 % of electrolytes and water, are reabsorbed.',
    'They pass through the PCT\'s brush-border cells into the peritubular capillaries, which carry them back into the circulation.',
    'Nitrogenous wastes are reabsorbed passively: about 40–50 % of the urea diffuses out as water leaves.',
    'H⁺, NH₃ and K⁺ are secreted into the filtrate, and HCO₃⁻ is absorbed from it, keeping the pH and ionic balance of body fluids.'] },
  { id: 'desc', seg: 'desc', medulla: true, title: '3 · Descending limb: water out', facts: [
    'Permeable to water, almost impermeable to electrolytes.',
    'The surrounding medullary interstitium is hypertonic, so water leaves the limb by osmosis. The filtrate becomes concentrated as it moves down.',
    'Na⁺ and Cl⁻ stay inside the limb. As water leaves, they become more concentrated in the filtrate.',
    'The water collects in the interstitium and is carried away by the ascending vasa recta.'] },
  { id: 'asc', seg: 'asc', medulla: true, title: '4 · Ascending limb: salts out', facts: [
    'Impermeable to water: no water leaves here.',
    'Electrolytes (NaCl) leave, actively or passively, into the interstitium. The filtrate becomes diluted as it moves up.'] },
  { id: 'cc', seg: 'loop', medulla: true, vr: true, title: '5 · Counter-current mechanism', facts: [
    'Filtrate flows in opposite directions in the two limbs of Henle\'s loop, and blood flows in opposite directions in the two limbs of the vasa recta: both are counter currents.',
    'NaCl from the ascending limb is exchanged with the descending limb of the vasa recta, and returned to the interstitium by the ascending vasa recta. The salt stays trapped in the medulla.',
    'Small amounts of urea enter the thin ascending limb and are returned to the interstitium by the collecting tubule.',
    'Together NaCl and urea keep the medullary interstitium increasingly concentrated, so the collecting duct can draw water out and concentrate the urine.'],
    metrics: [['300 mOsmol L⁻¹', 'interstitium in the cortex'], ['≈ 1200 mOsmol L⁻¹', 'in the inner medulla']] },
  { id: 'dct', seg: 'dct', title: '6 · DCT: fine adjustment', facts: [
    'Conditional reabsorption of Na⁺ and water; HCO₃⁻ is reabsorbed.', 'H⁺, K⁺ and NH₃ are selectively secreted.'] },
  { id: 'cd', seg: 'cd', medulla: true, title: '7 · Collecting duct: concentrating urine', facts: [
    'Large amounts of water can be reabsorbed into the hypertonic interstitium, making the urine concentrated. Vasa recta running beside the duct carry it away (they are not drawn in this model).', 'As water leaves, the urine left in the duct becomes more concentrated (deeper yellow): it enters at about 100 mOsmol L⁻¹ and can reach about 1200 at the papilla.', 'Small amounts of urea pass into the medullary interstitium; part of it re-enters the thin ascending limb. H⁺ and K⁺ are secreted.'],
    metrics: [['≈ 99 %', 'of the filtrate is reabsorbed'], ['1–1.5 L', 'urine per day, pH ≈ 6']] },
];

/* --- regulation of kidney function (NCERT): ADH, renin-angiotensin mechanism, ANF --- */
// REG.fluid: 0 = fluid lost from the body, 0.5 = normal, 1 = excess water. REG.bp: glomerular blood pressure / blood flow, 0 low, 0.5 normal, 1 high.
const REG = { tab: 'adh', fluid: 0.5, bp: 0.5 };
const REABS_BASE = JSON.parse(JSON.stringify(REABS));
const clamp01 = (x) => Math.max(0, Math.min(1, x));
// log-linear interpolation through [x, y] points (urine volume and concentration span orders of magnitude)
const lerpPts = (pts, x) => { for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], t = (x - x0) / (x1 - x0); return Math.exp(Math.log(y0) + (Math.log(y1) - Math.log(y0)) * t); } return pts[pts.length - 1][1]; };
const gfrAt = (gp) => 125 * (1 + 0.9 * (gp - 0.5));
function regState() {
  const adh = clamp01(1 - REG.fluid), renin = clamp01((0.5 - REG.bp) * 2), anf = clamp01((REG.bp - 0.5) * 2), aldo = renin;
  const gp = REG.bp + (0.5 - REG.bp) * 0.6;          // angiotensin II raises a low pressure, ANF lowers a high one
  return { adh, renin, aldo, anf, gp, gfr: gfrAt(gp), gfrRaw: gfrAt(REG.bp),
    vol: lerpPts([[0, 18], [0.5, 1.5], [1, 0.5]], adh), osm: lerpPts([[0, 60], [0.5, 600], [1, 1200]], adh) };
}
// apply the hormones to the particle rules (only in the Regulation tab; elsewhere the normal rules hold)
function applyReg() {
  for (const k in REABS_BASE) REABS[k] = { ...REABS_BASE[k] };
  FILT = FILTERED;
  if (nMode !== 'regulation') return;
  const r = regState();
  REABS.cd.water = 0.12 + 0.78 * r.adh;                                      // ADH: water from the latter parts of the tubule
  REABS.dct.water = clamp01(0.08 + 0.34 * r.adh + 0.25 * r.aldo);            // aldosterone: Na⁺ and water from the distal tubule
  REABS.dct.na = Math.min(0.95, REABS_BASE.dct.na * (1 + 1.3 * r.aldo)); REABS.dct.cl = Math.min(0.95, REABS_BASE.dct.cl * (1 + 1.3 * r.aldo));
  if (r.aldo > 0) { REABS.cd.na = 0.35 * r.aldo; REABS.cd.cl = 0.3 * r.aldo; }
  if (r.anf > 0) {   // ANF is natriuretic: less Na⁺ (and Cl⁻) is reabsorbed distally, so more salt (and some water) leaves in urine
    REABS.dct.na *= 1 - 0.6 * r.anf; REABS.dct.cl *= 1 - 0.6 * r.anf; REABS.dct.water *= 1 - 0.3 * r.anf; REABS.cd.water *= 1 - 0.2 * r.anf; }
  FILT = Math.min(0.95, FILTERED * r.gfr / 125);                              // GFR follows the glomerular blood pressure
}
const pctOf = (x) => Math.round(x * 100) + '%';
function regLiveHTML() {
  const r = regState(), bar = (t, v, c) => `<div class="lvl"><span>${t}</span><div class="bar"><i style="width:${Math.round(v * 100)}%;${c ? 'background:' + c : ''}"></i></div><b>${pctOf(v)}</b></div>`;
  if (REG.tab === 'adh') {
    const d = r.adh - 0.5, st = d > 0.08 ? 'up' : d < -0.08 ? 'down' : 'norm';
    const C = { up: ['Fluid is lost from the body (e.g. heavy sweating, too little water intake)', 'Osmoreceptors are activated', 'They stimulate the hypothalamus: ADH (vasopressin) is released from the neurohypophysis', 'ADH: more water is reabsorbed from the latter parts of the tubule (DCT and collecting duct)', 'A small volume of concentrated urine: diuresis is prevented'],
      down: ['Body-fluid volume rises (e.g. drinking a lot of water)', 'Osmoreceptors are switched off', 'ADH release is suppressed', 'Less water is reabsorbed from the DCT and collecting duct', 'A large volume of dilute urine (diuresis)'],
      norm: ['Normal body-fluid volume', 'Osmoreceptors at rest', 'ADH is released at its usual low level', 'Normal water reabsorption in the DCT and collecting duct', 'About 1–1.5 L of urine a day'] }[st];
    let h = `<ol class="chain">${C.map((t) => `<li class="${st}">${t}</li>`).join('')}</ol>`;
    h += `<div class="lvls">${bar('ADH in blood', r.adh)}${bar('Collecting-duct water reabsorbed', REABS.cd.water, '#5b8fe4')}</div>`;
    h += `<div class="metrics"><div class="metric"><b>≈ ${r.vol < 3 ? r.vol.toFixed(1) : Math.round(r.vol)} L/day</b><span>urine volume</span></div><div class="metric"><b>≈ ${Math.round(r.osm / 10) * 10}</b><span>urine concentration, mOsmol L⁻¹ (at most ≈ 1200, the inner medulla)</span></div></div>`;
    if (r.adh < 0.12) h += `<p class="rnote">With almost no ADH the kidney cannot conserve water: large volumes of dilute urine are passed, leading to dehydration. This is <b>diabetes insipidus</b>.</p>`;
    return h + `<p class="rnote">ADH also constricts blood vessels. This raises blood pressure, and with it the glomerular blood flow and GFR.</p>`;
  }
  const st = r.renin > 0.08 ? 'up' : r.anf > 0.08 ? 'down' : 'norm';
  const C = { up: [['Glomerular blood flow, blood pressure and GFR fall (e.g. after blood loss)'], ['JG cells of the JGA release <b>renin</b>'], ['Renin converts angiotensinogen in the blood to angiotensin I, and further to <b>angiotensin II</b>'],
      ['Angiotensin II is a powerful vasoconstrictor. Here the efferent arteriole narrows, so blood backs up in the glomerulus: glomerular blood pressure and GFR rise', 1], ['Angiotensin II activates the adrenal cortex to release <b>aldosterone</b>', 1], ['Aldosterone: Na⁺ and water are reabsorbed from the distal parts of the tubule, raising blood pressure and GFR', 1]],
    down: [['Blood flow to the atria of the heart increases'], ['The atria release <b>ANF</b> (atrial natriuretic factor)'], ['ANF dilates blood vessels (here the afferent arteriole widens), so blood pressure falls'], ['ANF acts as a check on the renin–angiotensin mechanism: renin is not released'], ['ANF is natriuretic (salt-excreting): less Na⁺ is reabsorbed in the DCT, so more Na⁺ and water leave in the urine']],
    norm: [['Normal glomerular blood pressure'], ['Renin and ANF stay at low resting levels'], ['GFR ≈ 125 mL/min']] }[st];
  let h = `<ol class="chain">${C.map(([t, sub]) => `<li class="${st}${sub ? ' sub' : ''}">${t}</li>`).join('')}</ol>`;
  h += `<div class="lvls">${bar('Renin', r.renin, '#7fc8a0')}${bar('Aldosterone', r.aldo, '#f0b54a')}${bar('ANF', r.anf, '#5b8fe4')}</div>`;
  h += `<div class="metrics"><div class="metric"><b>≈ ${Math.round(r.gfr)} mL/min</b><span>GFR${Math.abs(r.gfr - r.gfrRaw) > 3 ? ` (≈ ${Math.round(r.gfrRaw)} without these hormones)` : ''}</span></div><div class="metric"><b>× ${(REABS.dct.na / REABS_BASE.dct.na).toFixed(1)}</b><span>Na⁺ reabsorbed in the DCT, compared with normal</span></div></div>`;
  return h + `<p class="rnote">The JGA is where the DCT touches the afferent arteriole of its own glomerulus. In this model the DCT runs elsewhere, so the green marker shows only the JG cells in the afferent arteriole wall.</p>`;
}
function regHTML(tabs) {
  const adh = REG.tab === 'adh', v = Math.round((adh ? REG.fluid : REG.bp) * 100);
  let h = `<div class="eyebrow"><span>Stage 4</span><em>Regulation</em></div>${tabs}`;
  h += `<div class="tabs sub" role="tablist"><button role="tab" aria-selected="${adh}" data-rtab="adh">ADH</button><button role="tab" aria-selected="${!adh}" data-rtab="raas">Renin–angiotensin &amp; ANF</button></div>`;
  h += `<h2>${adh ? 'ADH: conserving body water' : 'JGA, renin–angiotensin and ANF'}</h2>`;
  h += `<div class="slider"><label for="reg-in">${adh ? 'Body fluid' : 'Glomerular blood pressure / blood flow'}</label><input type="range" id="reg-in" min="0" max="100" step="1" value="${v}"><div class="ticks">${adh ? '<span>Fluid loss</span><span>Normal</span><span>Excess water</span>' : '<span>Low</span><span>Normal</span><span>High</span>'}</div></div>`;
  h += `<div id="reg-live">${regLiveHTML()}</div>`;
  h += legendHTML() + `<p class="rnote">Hormone levels, volumes and GFR are typical teaching values. The particle stream shows the direction of each change; particle numbers are illustrative.</p>`;
  return h + `<div class="actions"><button class="btn ghost" data-rreset>Back to normal</button></div>`;
}
function goReg() {
  applyReg(); highlight(REG.tab === 'adh' ? 'distal' : 'dct'); if (interPlane) interPlane.visible = REG.tab === 'adh'; renderNCard();
  const pts = [];
  if (REG.tab === 'adh') { const [a, b] = SEG_RANGE.cd; N_PATH.pts.forEach((p, j) => { if (N_PATH.arc[j] >= a && N_PATH.arc[j] <= b) pts.push(new THREE.Vector3(...p)); }); N_VR.avr.pts.forEach((p) => pts.push(new THREE.Vector3(...p))); }
  else { pts.push(new THREE.Vector3(...N_FIXED.glomerulus), new THREE.Vector3(...JGA_P)); N_PATH.pts.forEach((p, j) => { if (N_PATH.arc[j] >= 1600 && N_PATH.arc[j] <= 2560) pts.push(new THREE.Vector3(...p)); }); }
  const bx = new THREE.Box3().setFromPoints(pts); const c = nInner.localToWorld(bx.getCenter(new THREE.Vector3()));
  const size = bx.getSize(new THREE.Vector3()).length() * N_SCALE;
  const tall = camera.aspect < 1, dist = Math.max(0.2, size * 1.25 * (tall ? 1.9 : 1)), dx = !tall && REG.tab === 'adh' ? dist * 0.22 : 0;   // the card covers the right of the screen (the bottom on phones)
  c.x += dx; if (tall) c.y -= dist * 0.16; flyTo({ target: c, pos: c.clone().add(new THREE.Vector3(0.04, 0.02, dist)) });
}
// JG cells: a glowing patch on the afferent arteriole wall at the vascular pole, puffing renin into the blood when it is released
const JGA_P = [-445.7, 267.2, -96.7]; let jga = null; const reninPuffs = []; let puffAcc = 0;
function initUrineTags() {
  for (const [a, txt, id] of [[2690, 'Enters ≈ 100 · dilute', 'u0'], [2895, 'Urine ≈ 1200 · concentrated', 'u1']]) {
    const el = document.createElement('div'); el.className = 'otag urine'; el.textContent = txt; el.hidden = true; hsLayer.appendChild(el);
    oTags.push({ p: centreAtArc(a).clone().add(new THREE.Vector3(26, 0, 0)), el, k: 'urine', id });
  }
}
function initJGA() {
  jga = new THREE.Mesh(new THREE.SphereGeometry(9, 20, 14), new THREE.MeshBasicMaterial({ color: 0x7fc8a0, transparent: true, opacity: 0.3, depthWrite: false }));
  jga.position.set(...JGA_P); jga.renderOrder = 8; jga.visible = false; nInner.add(jga);
  const g = new THREE.SphereGeometry(2.2, 10, 8);
  for (let i = 0; i < 24; i++) { const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x9be8bd, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; m.renderOrder = 8; m.userData = { t: 1, d: new THREE.Vector3() }; nInner.add(m); reninPuffs.push(m); }
  const el = document.createElement('div'); el.className = 'otag jga'; el.textContent = 'JG cells (JGA) · renin'; el.hidden = true; hsLayer.appendChild(el);
  oTags.push({ p: new THREE.Vector3(...JGA_P).add(new THREE.Vector3(0, 16, 0)), el, k: 'jga', id: 'jga' });
  // live labels for the RAAS tab: GFR at the glomerulus, aldosterone acting on the DCT
  for (const [p, id] of [[new THREE.Vector3(...N_FIXED.glomerulus).add(new THREE.Vector3(0, 118, 0)), 'gfr'], [centreAtArc(1700).add(new THREE.Vector3(0, 34, 0)), 'aldo'], [new THREE.Vector3(...N_FIXED.efferent).add(new THREE.Vector3(0, -24, 0)), 'vasoE'], [new THREE.Vector3(...N_FIXED.afferent).add(new THREE.Vector3(-20, 46, 0)), 'vasoA']]) {
    const e2 = document.createElement('div'); e2.className = 'otag jga'; e2.hidden = true; hsLayer.appendChild(e2); oTags.push({ p, el: e2, k: 'jga', id }); }
}
function stepJGA(dt, t) {
  if (!jga) return;
  const on = stage === 4 && nMode === 'regulation' && REG.tab === 'raas'; jga.visible = on;
  if (!on) { reninPuffs.forEach((m) => (m.visible = false)); return; }
  const r = regState();
  jga.material.opacity = 0.18 + 0.5 * r.renin * (0.6 + 0.4 * Math.sin(t * 5)); jga.scale.setScalar(1 + 0.25 * r.renin * Math.sin(t * 5));
  puffAcc += dt * 6 * r.renin;
  while (puffAcc > 1) { puffAcc--; const m = reninPuffs.find((q) => q.userData.t >= 1); if (!m) break; m.userData.t = 0; m.userData.d.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(26); m.visible = true; }
  for (const m of reninPuffs) { const u = m.userData; if (u.t >= 1) { m.visible = false; continue; } u.t = Math.min(1, u.t + dt / 2.2); m.position.set(...JGA_P).addScaledVector(u.d, u.t); m.material.opacity = 0.9 * (1 - u.t); }
}

let nRoot = null, nInner = null, nLoading = null, nSel = null, nMode = 'structure', nStep = 0, nPlaying = !REDUCED;
const nAnchors = {}, nEls = [], nMesh = { art: [], ven: [], cel: [], tub: [], pod: [] };
let tubU = null;
// --- path for particles: glomerulus centre -> capsule neck -> along the centre line ---
const PP = [], PS = [];
function buildParticlePath() {
  const G = new THREE.Vector3(...N_FIXED.glomerulus);
  PP.push(G); PS.push(0);
  const start = N_PATH.arc.findIndex((a) => a >= 230);
  // offset so that path arc length matches tubule arc length from the neck on
  const neck = new THREE.Vector3(...N_PATH.pts[start]);
  const lead = G.distanceTo(neck);
  for (let i = start; i < N_PATH.pts.length; i++) { PP.push(new THREE.Vector3(...N_PATH.pts[i])); PS.push(lead + N_PATH.arc[i] - N_PATH.arc[start]); }
  buildParticlePath.toArc = (s) => (s < lead ? 0 : N_PATH.arc[start] + (s - lead));
  buildParticlePath.fromArc = (a) => lead + Math.max(0, a - N_PATH.arc[start]);
}
const _t = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3();
function sampleAt(s, out) {
  let lo = 0, hi = PS.length - 1; if (s >= PS[hi]) s = PS[hi] - 0.01;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (PS[m] <= s) lo = m; else hi = m; }
  const f = (s - PS[lo]) / (PS[hi] - PS[lo] || 1);
  out.lerpVectors(PP[lo], PP[hi], f); _t.subVectors(PP[hi], PP[lo]).normalize();
  _up.set(0, 0, 1); if (Math.abs(_t.z) > 0.9) _up.set(0, 1, 0);
  _n.crossVectors(_t, _up).normalize(); _b.crossVectors(_t, _n);
  return out;
}
function centreAtArc(a) { const j = Math.max(0, N_PATH.arc.findIndex((x) => x >= a)); return new THREE.Vector3(...N_PATH.pts[j]); }

// --- tubule material: highlight a segment by arc range ---
function tubuleMat() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xdcc08a, roughness: 0.5, clearcoat: 0.25, side: THREE.FrontSide, transparent: true, opacity: 1 });
  tubU = { uA: { value: -1 }, uB: { value: -1 }, uT: { value: 0 }, uCD: { value: 0 }, uC0: { value: SEG_RANGE.cd[0] }, uC1: { value: SEG_RANGE.cd[1] } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, tubU);
    sh.vertexShader = 'attribute float _s;\nvarying float vS;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vS = _s;');
    sh.fragmentShader = 'uniform float uA; uniform float uB; uniform float uT; uniform float uCD; uniform float uC0; uniform float uC1;\nvarying float vS;\n' + sh.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\n  if (uCD > 0.0 && vS >= uC0) { float tc = smoothstep(0.0, 1.0, clamp((vS - uC0) / (uC1 - uC0), 0.0, 1.0)) * uCD; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.64, 0.12), tc); diffuseColor.a = max(diffuseColor.a, 0.32 + 0.4 * tc); }').replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  if (vS >= uA && vS <= uB) totalEmissiveRadiance += vec3(0.55, 0.36, 0.08) * (0.55 + 0.25 * sin(uT * 3.2));');
  };
  return m;
}

// --- particles ---
// Blood enters along the afferent arteriole; in the glomerulus small solutes are filtered into the tubule, proteins and blood
// cells (and the unfiltered share of the solutes) leave through the efferent arteriole into the peritubular capillaries.
// Reabsorbed particles cross the tubule wall into the nearest capillary; secreted ones make the reverse trip.
const N_VES = {"aff":{"pts":[[-554.27,282.29,-124.51],[-553.06,282.06,-124.05],[-551.87,281.78,-123.56],[-549.77,281.41,-122.79],[-547.5,280.87,-121.75],[-545.28,280.2,-120.59],[-543.2,279.58,-119.5],[-541.25,279.06,-118.47],[-539.16,278.41,-117.36],[-537.19,277.8,-116.31],[-535.24,277.25,-115.23],[-533.24,276.63,-114.17],[-531.23,275.95,-113.13],[-529.48,275.34,-112.07],[-527.3,274.56,-110.76],[-525.06,273.79,-109.55],[-523.04,273.1,-108.29],[-520.92,272.38,-106.93],[-518.71,271.69,-105.62],[-516.85,271.04,-104.47],[-514.73,270.38,-103.2],[-512.49,269.78,-102.02],[-510.06,269.16,-100.9],[-507.25,268.5,-99.84],[-504.45,267.96,-98.89],[-501.52,267.58,-98.08],[-498.52,267.18,-97.34],[-495.45,266.78,-96.6],[-492.18,266.39,-95.89],[-489.02,266,-95.19],[-486.14,265.6,-94.47],[-483.08,265.15,-93.63],[-480.3,264.66,-92.77],[-478,264.23,-91.89],[-475.34,263.79,-90.94],[-472.41,263.22,-89.98],[-469.72,262.75,-89.25],[-466.95,262.54,-88.77],[-464.18,262.43,-88.58],[-461.59,262.53,-88.75],[-459.28,262.92,-89.34],[-456.79,263.57,-90.31],[-454.43,264.26,-91.52],[-452.02,265.09,-92.87],[-449.8,265.91,-94.22],[-447.69,266.6,-95.53],[-445.66,267.21,-96.72],[-443.3,267.86,-98.01],[-440.6,268.5,-99.44],[-437.77,269.11,-100.89],[-434.83,269.74,-102.4],[-431.97,270.31,-103.82],[-429.33,270.9,-105.15],[-427.15,271.39,-106.32],[-424.9,271.88,-107.58],[-422.69,272.48,-108.88],[-420.56,273.14,-110.28],[-418.52,273.83,-111.77],[-416.46,274.67,-113.43],[-414.51,275.53,-115.17],[-412.59,276.15,-117.03],[-410.68,276.57,-118.94],[-408.69,276.62,-120.84],[-406.65,276.26,-122.71],[-404.77,275.64,-124.45],[-402.88,274.74,-126.08],[-400.94,273.64,-127.75],[-399.21,272.56,-129.26],[-397.5,271.36,-130.7],[-395.62,269.95,-132.15],[-393.71,268.56,-133.58],[-391.95,267.23,-134.85],[-390,265.65,-136.2],[-388.07,264.07,-137.55],[-386.14,262.48,-138.95],[-384.38,260.91,-140.16],[-382.59,259.25,-141.35],[-380.78,257.66,-142.51],[-378.92,256.09,-143.61],[-376.97,254.35,-144.71],[-374.82,252.52,-145.98],[-372.66,250.67,-147.22],[-370.5,248.75,-148.44],[-368.44,246.77,-149.51],[-366.48,244.95,-150.36],[-364.47,243.03,-151.13],[-362.41,241.04,-151.76],[-360.34,239.18,-152.02],[-358.28,237.34,-151.87],[-356.5,235.58,-151.39],[-355.33,233.88,-150.07],[-355.09,232.14,-147.91],[-355.77,230.4,-145.44],[-357.24,228.68,-142.91],[-359.26,227.03,-140.27],[-361.53,225.56,-137.87],[-363.53,224.33,-136.07],[-365.65,223.05,-134.24],[-367.69,221.89,-132.53],[-369.65,220.73,-130.85],[-371.52,219.62,-129.31],[-373.53,218.49,-127.62],[-375.32,217.47,-126.05],[-377.04,216.42,-124.46],[-378.88,215.3,-122.75],[-380.83,214.14,-120.93],[-382.73,212.99,-119.21],[-384.78,211.81,-117.36],[-387.22,211.18,-115.62],[-389.62,211.64,-114.7],[-391.51,213.02,-114.75],[-392.75,215.26,-115.81],[-393.25,218.13,-117.77],[-392.64,221.24,-120.35],[-391.2,223.9,-122.14],[-389.58,225.72,-122.26],[-388.51,226.47,-120.77],[-387.85,226.43,-118.35],[-387.96,225.48,-114.83],[-388.65,223.95,-111.35],[-389.86,222.28,-108.5],[-391.1,220.7,-106],[-392.35,219.25,-103.53],[-393.48,217.83,-101.22],[-394.67,216.35,-98.81],[-395.96,214.73,-96.23],[-397.14,213.19,-93.73],[-398.2,211.62,-91.2],[-399.21,210,-88.53],[-399.98,208.36,-85.86],[-400.37,206.88,-83.29],[-400.51,205.35,-80.6],[-400.5,203.82,-77.96],[-400.21,202.43,-75.53],[-399.8,201.13,-73.26],[-399.26,199.75,-70.98],[-398.53,198.25,-68.43],[-397.6,196.86,-65.9],[-396.49,195.49,-63.09],[-395.33,194.2,-60.25],[-393.99,192.98,-57.22],[-392.8,192.12,-54.59],[-391.58,191.3,-51.77],[-390.44,190.7,-49.27],[-389.31,190.22,-46.73],[-388.24,189.91,-44.45],[-387.06,189.69,-42.2],[-385.9,189.7,-40.19],[-384.77,189.72,-38.17],[-383.5,189.83,-36.08],[-382.24,190.11,-34.06],[-380.61,190.63,-31.81],[-378.87,191.33,-29.61],[-376.99,192.26,-27.6],[-375.09,193.43,-25.98],[-373.05,194.76,-24.68],[-371.1,196.29,-24],[-369.04,197.96,-23.8],[-366.94,199.73,-23.99],[-364.75,201.55,-24.55],[-362.68,203.42,-25.71],[-360.74,205.22,-27.52],[-359.14,206.87,-29.7],[-358.1,208.37,-32.25],[-357.8,209.56,-34.86],[-358.34,210.57,-37.25],[-359.94,211.2,-39.08],[-362.26,211.51,-40.41],[-364.99,211.59,-41.23],[-367.92,211.57,-41.74],[-370.79,211.44,-42.15],[-373.61,211.45,-42.89],[-376.06,211.75,-43.93],[-378.18,212.27,-45.34],[-379.86,213.28,-47.55],[-380.99,214.78,-50.49],[-381.34,216.56,-53.74],[-381.48,218.46,-57.43],[-381.3,220.29,-61.26],[-380.9,221.45,-65.02],[-380.46,222.13,-68.78],[-380.17,222.69,-72.46],[-379.82,223.16,-75.88],[-379.49,223.7,-79.05],[-379.28,224.78,-82.12],[-379.25,226.01,-84.67],[-379.02,227.1,-87.42],[-378.48,227.74,-90.49],[-377.8,228.05,-93.63],[-376.78,228.02,-96.86],[-375.53,227.73,-100.21],[-374.16,227.6,-103.37],[-373.08,227.84,-106.12],[-372.09,228.34,-108.87],[-371.38,229.1,-111.26],[-370.72,230.21,-113.69],[-370.31,231.29,-115.89],[-369.91,232.54,-118.15],[-369.55,234,-120.5],[-369.19,235.55,-122.82],[-368.94,237.24,-124.97],[-368.76,239.04,-127.08],[-368.64,240.88,-129.05],[-368.63,242.87,-130.94],[-368.8,245.1,-132.76],[-369.09,247.7,-134.6],[-369.46,250.3,-136.19],[-369.9,252.85,-137.62],[-370.3,255.35,-138.87],[-370.77,257.66,-139.88],[-371.19,259.69,-140.62],[-371.59,261.71,-141.31],[-372.07,264.32,-141.82],[-372.55,266.86,-142.02],[-372.52,269.48,-141.51],[-371.24,271.59,-140.38],[-368.92,273.46,-139.39],[-365.63,274.51,-138.41],[-361.5,275.22,-137.7],[-356.97,275.53,-137.7],[-352.84,275.94,-138.36],[-348.87,276.16,-138.76],[-345.27,276.31,-139.14],[-342.06,276.55,-139.41],[-338.86,276.72,-139.62],[-335.7,276.88,-139.67],[-332.54,277.07,-139.71],[-329.12,276.89,-139.7],[-325.76,276.39,-139.48],[-322.97,275.21,-138.54],[-321.25,273.63,-136.87],[-320.56,271.72,-134.49],[-320.66,270.01,-131.66],[-321.14,268.22,-128.56],[-321.92,266.77,-125.63],[-322.38,265.45,-122.81],[-322.58,264.36,-119.91],[-322.65,263.61,-117.04],[-322.72,263.38,-113.96],[-322.69,263.89,-110.76],[-322.69,264.89,-107.58],[-322.89,265.83,-104.77],[-323.25,266.38,-102],[-323.73,266.5,-99.48],[-324.32,266,-97.26],[-325.11,264.83,-94.88],[-325.96,263.57,-92.64],[-326.84,262.17,-90.41],[-327.8,260.76,-88.17],[-328.87,259.06,-85.63],[-329.99,257.4,-83.44],[-330.52,256.55,-82.28],[-331.12,255.71,-81.04]],"arc":[0,1.31,2.63,4.89,7.46,10.05,12.47,14.74,17.19,19.51,21.81,24.15,26.51,28.65,31.31,33.97,36.45,39.07,41.73,44.01,46.57,49.17,51.91,54.99,57.99,61.06,64.18,67.36,70.73,73.99,76.98,80.19,83.13,85.63,88.5,91.64,94.46,97.28,100.06,102.66,105.07,107.82,110.56,113.44,116.17,118.74,121.18,123.94,127.06,130.3,133.67,136.91,139.93,142.45,145.08,147.71,150.34,152.96,155.73,158.49,161.23,163.97,166.72,169.5,172.14,174.79,177.58,180.12,182.66,185.42,188.18,190.73,193.58,196.41,199.27,201.92,204.64,207.31,209.99,212.82,215.91,219.02,222.16,225.21,228.02,230.89,233.83,236.63,239.39,241.94,244.39,247.17,250.27,253.66,257.37,260.99,263.95,267.03,269.93,272.76,275.42,278.28,280.88,283.44,286.2,289.1,291.91,294.91,297.98,300.59,302.93,305.7,309.21,313.3,316.81,319.25,321.24,323.74,327.39,331.25,334.77,337.98,341.1,344.04,347.11,350.42,353.58,356.75,360.02,363.25,366.25,369.34,372.39,375.21,377.85,380.58,383.62,386.66,389.97,393.3,396.83,399.84,403.03,405.84,408.65,411.19,413.75,416.07,418.38,420.83,423.22,426.05,428.94,431.85,434.6,437.37,439.93,442.59,445.35,448.25,451.27,454.48,457.65,460.78,463.67,466.31,468.83,471.51,474.37,477.35,480.25,483.16,485.84,488.44,491.39,494.88,498.61,502.76,507,510.96,514.81,518.54,522.02,525.25,528.51,531.34,534.3,537.48,540.72,544.1,547.69,551.14,554.1,557.06,559.68,562.43,564.91,567.52,570.31,573.12,575.86,578.64,581.35,584.09,586.97,590.17,593.25,596.2,599.02,601.59,603.79,605.96,608.67,611.25,613.93,616.64,619.78,623.36,627.62,632.16,636.36,640.36,643.98,647.21,650.42,653.59,656.75,660.18,663.58,666.75,669.62,672.75,676.06,679.68,683.03,686.18,689.28,692.25,695.34,698.58,701.92,704.89,707.73,710.31,712.65,715.42,718.13,720.9,723.72,726.96,729.92,731.45,733.07],"r":3.7},"eff":{"pts":[[-330.54,252.08,-77.4],[-330.79,252.93,-78.26],[-330.53,254.14,-79.72],[-330.2,255.94,-81.9],[-329.53,258.03,-84.65],[-328.51,260.18,-87.66],[-327.32,262,-90.42],[-326.5,263.26,-92.58],[-325.7,264.45,-94.7],[-325.12,265.38,-96.46],[-324.51,266.3,-98.23],[-323.92,266.93,-100.34],[-323.34,267.05,-102.53],[-322.91,266.48,-105],[-322.72,265.48,-107.96],[-322.62,264.42,-111.11],[-322.6,263.53,-114.01],[-322.55,263.34,-117.05],[-322.53,263.93,-120.12],[-322.27,265.21,-122.91],[-321.87,266.71,-125.91],[-321.37,268.26,-129.28],[-320.82,269.65,-132.52],[-320.25,270.98,-135.24],[-319.38,272.28,-137.5],[-317.75,273.9,-138.8],[-315.25,275.39,-139.08],[-312.33,276.69,-138.83],[-308.62,277.67,-138.18],[-304.76,278.33,-137.21],[-300.92,278.23,-136.01],[-297.67,278.02,-134.81],[-294.61,277.71,-133.47],[-292.01,277.37,-132.06],[-289.44,276.97,-130.56],[-287.34,276.47,-129],[-285.33,275.94,-127.37],[-283.25,275.29,-125.43],[-281.31,274.5,-123.4],[-279.51,273.54,-121.21],[-277.95,272.63,-119.09],[-276.42,271.54,-116.68],[-275.11,270.33,-114.28],[-273.95,269.17,-111.93],[-273.02,267.97,-109.71],[-272.28,266.6,-107.35],[-271.99,265.16,-105.13],[-272.06,263.69,-103.05],[-272.54,261.93,-100.84],[-273.37,260.11,-98.75],[-274.77,258.09,-96.84],[-276.59,256.03,-95.06],[-278.71,254.01,-93.41],[-280.78,252.2,-92.06],[-283.09,250.29,-90.72],[-285.26,248.59,-89.59],[-287.49,246.88,-88.56],[-289.57,245.25,-87.74],[-291.74,243.58,-86.85],[-293.83,242.06,-86.07],[-295.91,240.65,-85.4],[-297.63,239.42,-84.83],[-299.6,238.11,-84.13],[-301.58,236.89,-83.6],[-303.46,235.72,-83.15],[-305.49,234.36,-82.5],[-307.85,232.84,-81.91],[-310.11,231.36,-81.41],[-312.46,229.84,-80.89],[-315.05,228.23,-80.3],[-317.42,226.73,-79.83],[-319.89,225.22,-79.35],[-322.32,223.75,-78.94],[-324.89,222.24,-78.46],[-327.51,220.56,-78.01],[-330.13,218.99,-77.64],[-332.45,217.57,-77.34],[-334.87,216.15,-77.08],[-337.11,214.7,-76.95],[-339.32,213.39,-76.89],[-341.68,212,-76.88],[-344.03,210.66,-76.88],[-346.21,209.31,-76.88],[-348.42,208.06,-76.92],[-350.74,206.68,-77.19],[-352.74,205.34,-78.14],[-354.09,204.29,-79.79],[-354.69,203.65,-82.06],[-354.25,203.39,-84.77],[-352.55,203.73,-87.65],[-350.19,204.34,-90.11],[-347.56,204.78,-92.15],[-345.03,204.83,-93.88],[-342.87,204.48,-95.39],[-340.85,203.37,-96.74],[-339.12,201.71,-97.94],[-337.78,199.71,-98.89],[-336.54,197.1,-99.54],[-335.44,194.3,-99.95],[-334.64,191.65,-100.1],[-333.9,189.08,-100.14],[-333.23,186.25,-100.07],[-332.55,183.84,-100.06],[-331.72,181.37,-100.17],[-330.72,178.96,-100.32],[-329.49,176.58,-100.61],[-328.01,174.68,-100.97],[-326.42,172.98,-101.37],[-324.34,171.54,-101.88],[-321.97,170.43,-102.57],[-319.1,169.79,-103.42],[-316.09,169.44,-104.44],[-313.11,169.32,-105.52],[-310.03,169.7,-106.61],[-307.14,170.38,-107.56],[-304.78,171.3,-108.15],[-302.69,173.02,-108.13],[-301.16,175.41,-107.36],[-300.85,177.99,-105.75],[-301.37,180.64,-103.57],[-302.53,183.23,-101.2],[-304.24,185.23,-98.75],[-306.02,186.84,-96.38],[-307.77,188.31,-94.27],[-309.51,189.66,-92.2],[-311.34,191.05,-89.97],[-313.23,192.41,-87.82],[-315.22,193.73,-85.77],[-317.24,195.09,-83.67],[-319.22,196.44,-81.63],[-321.28,197.76,-79.56],[-323.32,199.12,-77.46],[-325.19,200.41,-75.5],[-327.16,201.63,-73.52],[-329.17,202.89,-71.48],[-330.98,204.13,-69.59],[-332.85,205.3,-67.72],[-334.89,206.56,-65.68],[-336.67,207.81,-63.79],[-338.55,209.05,-61.91],[-340.47,210.29,-59.94],[-342.26,211.54,-57.95],[-344.1,212.83,-56.03],[-346.16,214.18,-53.83],[-347.96,215.44,-51.83],[-349.94,216.77,-49.73],[-351.82,218.01,-47.78],[-353.66,219.19,-45.83],[-355.55,220.37,-43.91],[-357.39,221.58,-41.98],[-359.19,222.73,-40.16],[-361.11,223.97,-38.24],[-363.14,225.3,-36.22],[-364.97,226.56,-34.39],[-366.88,227.75,-32.52],[-368.73,229.01,-30.62],[-370.57,230.41,-28.73],[-372.3,231.85,-26.94],[-373.96,233.35,-25.16],[-375.66,235.05,-23.38],[-377.1,236.87,-21.77],[-377.98,238.95,-20.38],[-378.25,241.02,-19.38],[-377.62,243.33,-19.06],[-376.04,245.62,-19.68],[-374.11,247.55,-20.98],[-372.14,249.1,-23.21],[-370.39,250.43,-26.11],[-369.4,251.4,-29.59],[-369.19,252.18,-33.15],[-369.35,252.98,-36.69],[-370.09,253.61,-40.31],[-371.14,254.12,-43.71],[-372.51,254.55,-46.86],[-374.23,254.91,-50.05],[-376.36,255.2,-53.55],[-378.41,255.38,-56.6],[-380.74,255.56,-59.94],[-382.91,255.69,-62.98],[-384.92,255.8,-65.72],[-386.77,255.83,-68.12],[-388.72,255.88,-70.53],[-390.46,255.89,-72.59],[-392.26,255.82,-74.68],[-394.11,255.74,-76.71],[-395.94,255.68,-78.72],[-397.81,255.63,-80.76],[-399.64,255.59,-82.66],[-401.52,255.52,-84.62],[-403.39,255.47,-86.55],[-405.26,255.36,-88.46],[-407.17,255.18,-90.35],[-409.14,254.97,-92.36],[-411.13,254.7,-94.34],[-413.18,254.42,-96.33],[-415.17,254.15,-98.29],[-417.12,253.92,-100.22],[-419.06,253.68,-102.14],[-421.03,253.37,-104.04],[-422.94,252.93,-105.91],[-424.97,252.55,-107.8],[-427.02,252.08,-109.67],[-429.15,251.52,-111.48],[-431.18,251.04,-113.14],[-433.1,250.66,-114.73],[-435.02,250.17,-116.28],[-436.89,249.6,-117.84],[-438.65,249.07,-119.37],[-440.41,248.52,-120.88],[-442.33,247.85,-122.38],[-444.16,247.14,-123.83],[-445.94,246.46,-125.24],[-447.83,245.66,-126.64],[-449.79,244.8,-128.09],[-451.74,243.79,-129.52],[-453.77,242.55,-130.89],[-455.92,241.04,-132.27],[-458.18,239.13,-133.58],[-460.29,236.96,-134.58],[-462.12,234.64,-135.34],[-463.73,232.22,-135.78],[-465.04,229.82,-135.8],[-465.93,227.48,-135.33],[-466.68,225.09,-134.51],[-467.44,222.66,-133.33],[-468.09,220.31,-131.9],[-468.71,217.9,-130.1],[-469.26,215.64,-128.17],[-469.76,213.49,-126.23],[-470.19,211.48,-124.26],[-470.58,209.46,-122.2],[-470.86,207.51,-120.24],[-471.07,205.63,-118.28],[-471.23,203.79,-116.21],[-471.28,202.01,-114.12],[-471.32,200.26,-111.98],[-471.35,198.54,-109.8],[-471.35,196.87,-107.59],[-471.34,195.2,-105.38],[-471.22,193.45,-103.14],[-471.04,191.76,-100.92],[-470.87,190.19,-98.71],[-470.66,188.53,-96.45],[-470.37,186.87,-94.22],[-469.96,185.25,-91.98],[-469.55,183.59,-89.75],[-469.07,181.9,-87.46],[-468.36,180.05,-84.97],[-467.65,178.31,-82.42],[-466.86,176.4,-79.68],[-465.99,174.59,-76.91],[-464.93,172.58,-73.93],[-463.92,170.87,-71.19],[-462.78,169.11,-68.46],[-461.64,167.51,-65.86],[-460.42,165.86,-63.24],[-459.14,164.44,-60.83],[-457.85,162.97,-58.44],[-456.49,161.46,-56.05],[-455.13,160.05,-53.73],[-453.66,158.64,-51.35],[-452.19,157.2,-49.02],[-450.58,155.74,-46.74],[-448.97,154.35,-44.46],[-447.33,152.99,-42.2],[-445.69,151.72,-40.07],[-443.93,150.39,-37.94],[-442.13,149.09,-35.73],[-440.3,147.9,-33.72],[-438.36,146.72,-31.78],[-436.47,145.57,-29.86],[-434.47,144.47,-27.94],[-432.5,143.45,-26.07],[-430.49,142.35,-24.21],[-428.43,141.33,-22.39],[-426.29,140.24,-20.59],[-424.37,139.31,-18.99],[-422.49,138.4,-17.5],[-420.61,137.55,-16.01],[-418.85,136.74,-14.66],[-417.06,135.97,-13.36],[-415.2,135.2,-12.03],[-413.28,134.47,-10.74],[-411.34,133.76,-9.49],[-409.39,133.09,-8.26],[-407.33,132.38,-7.02],[-405.34,131.67,-5.85],[-403.36,131.03,-4.68],[-401.45,130.4,-3.47],[-399.41,129.67,-2.2],[-397.47,129.15,-1.09],[-395.12,128.44,0.18],[-392.46,127.66,1.51],[-389.7,126.93,2.75],[-386.99,126.18,3.98],[-384.31,125.42,5.21],[-382,124.91,6.25],[-379.5,124.32,7.3],[-376.95,123.71,8.32],[-374.34,123.22,9.37],[-371.62,122.64,10.47],[-368.86,122.01,11.53],[-366.66,121.58,12.45],[-364.58,121.18,13.33],[-362.57,120.79,14.06],[-360.61,120.47,14.74],[-358.74,120.24,15.39],[-356.79,119.94,15.99],[-354.77,119.62,16.56],[-352.53,119.32,17.22],[-350,119.03,17.89],[-347.42,118.79,18.65],[-344.45,118.59,19.45],[-341.29,118.4,20.24],[-338.31,118.22,21.06],[-335.18,118.13,21.86],[-331.77,118.12,22.64],[-328.8,118.17,23.37],[-325.8,118.28,24.03],[-322.75,118.51,24.63],[-319.86,118.83,25.16],[-317.21,119.09,25.6],[-314.5,119.46,26],[-311.89,119.87,26.45],[-309.3,120.32,26.86],[-306.55,120.82,27.27],[-303.55,121.44,27.67],[-300.56,122.07,28.03],[-297.69,122.79,28.35],[-294.62,123.52,28.6],[-291.75,124.25,28.85],[-289.1,125,29.02],[-286.17,125.8,29.23],[-283.24,126.68,29.39],[-280.6,127.63,29.5],[-278.25,128.51,29.51],[-275.96,129.36,29.54],[-273.84,130.2,29.56],[-271.49,131.17,29.58],[-269.22,132.09,29.61],[-266.85,133.1,29.63],[-264.57,134.15,29.64],[-262.37,135.21,29.6],[-260.51,136.13,29.54],[-258.39,137.16,29.52],[-256.16,138.28,29.52],[-253.85,139.45,29.5],[-251.49,140.68,29.48],[-249,142,29.43],[-246.56,143.39,29.23],[-243.98,144.86,29.02],[-241.35,146.45,28.8],[-238.87,148.07,28.6],[-236.44,149.58,28.37],[-234.2,151.01,28.2],[-232.3,152.42,28.02],[-230.53,153.68,27.82],[-228.65,154.96,27.51],[-226.66,156.45,27.23],[-224.68,158.02,26.98],[-222.67,159.52,26.7],[-220.3,161.29,26.37],[-218.02,163.1,26.04],[-215.83,164.95,25.66],[-213.65,166.78,25.31],[-211.4,168.77,24.84],[-209.42,170.67,24.43],[-207.49,172.56,24.08],[-205.63,174.39,23.71],[-203.65,176.36,23.26],[-201.75,178.28,22.87],[-199.98,180.21,22.39],[-198.21,182.22,21.89],[-196.34,184.44,21.44],[-194.56,186.67,21],[-192.85,189.31,20.59],[-191.3,191.93,20.23],[-189.85,194.71,19.73],[-188.65,197.36,19.08],[-187.59,200.05,18.19],[-186.56,202.49,17.26],[-185.44,205.08,16.15],[-184.29,207.56,15.01],[-183.08,210.15,13.84],[-181.83,212.74,12.72],[-180.63,215.27,11.5],[-179.5,217.64,10.41],[-178.47,219.98,9.35],[-177.47,222.3,8.23],[-176.6,224.46,7.02],[-175.79,226.68,5.82],[-174.82,229.23,4.72],[-173.83,231.81,3.82],[-172.86,234.3,3.06],[-171.93,236.86,2.55],[-171.02,239.38,2.15],[-170.29,241.95,1.54],[-169.71,244.98,0.95],[-169.19,248.58,0.54],[-168.76,252.48,0.17],[-168.23,256.77,-0.03],[-167.67,260.64,-0.01],[-166.96,264.02,-0.01],[-166.11,267.13,-0.03],[-165.01,270.04,-0.06],[-163.95,272.61,-0.04],[-162.67,275.38,-0.07],[-161.25,278.06,-0.09],[-159.72,280.42,-0.1],[-158.06,282.75,-0.04],[-156.28,284.88,-0.07],[-154.39,286.75,-0.03],[-152.05,288.54,0.05],[-149.23,289.96,0.05],[-146.3,290.83,0.02],[-142.72,291.01,-0.03],[-138.67,290.44,-0.09],[-135,289.38,-0.17],[-131.73,288.04,-0.19],[-128.61,286.48,-0.17],[-126.02,285.01,-0.12],[-123.72,283.53,-0.11],[-121.33,281.98,-0.1],[-118.69,280.13,-0.09],[-115.94,278.2,-0.07],[-112.95,276.06,-0.05],[-110.22,274.06,-0.06],[-107.56,271.93,-0.06],[-105.32,269.89,-0.05],[-103.21,267.72,-0.05],[-101.49,265.52,-0.04],[-99.84,263.28,0.01],[-98.27,261.03,0.04],[-96.66,258.77,0.06],[-95.05,256.5,0.07],[-93.44,254.33,0.09],[-91.74,252.19,0.12],[-90,250.06,0.18],[-88.16,247.82,0.14],[-86.33,245.58,0.14],[-84.44,243.35,0.11],[-82.52,241.16,0.05],[-80.39,238.93,0.01],[-78.28,237.04,0.01],[-76.1,235.46,-0.01],[-73.8,234.26,-0.03],[-71.2,233.48,-0.04],[-68.6,233.36,-0.03],[-65.89,233.82,0.03],[-63.01,234.86,0.06],[-59.93,236.64,0.13],[-57.16,238.76,0.16],[-54.73,240.91,0.15],[-52.16,243.38,0.08],[-49.76,245.85,0.05],[-47.7,247.99,-0.01],[-45.67,250.09,-0.05],[-43.54,252.32,-0.08],[-41.66,254.29,-0.08],[-39.88,256.15,-0.04],[-38,258.06,-0.04],[-36.08,259.89,-0.05],[-33.96,261.71,-0.04],[-31.77,263.33,-0.04],[-29.14,265,-0.05],[-26.31,266.62,-0.03],[-23.45,268.26,-0.02],[-20.71,269.76,-0.06],[-17.72,271.37,-0.03],[-14.75,272.79,-0.03],[-11.64,274.03,0],[-8.58,274.81,0.04],[-5.47,275.17,0.06],[-2.49,274.93,0.03],[0.27,274.19,0.01],[2.59,272.76,0.16],[4.68,270.8,0.8],[6.29,268.64,1.89],[7.3,266.25,3.8],[7.8,263.83,6.16],[8.07,261.57,8.72],[8.18,259.58,11.25],[8.33,257.7,13.81],[8.61,256.08,15.99],[8.95,254.48,18.1],[9.23,252.86,20.23],[9.66,251.22,22.29],[10.42,249.51,24.14],[11.73,247.62,25.67],[13.57,245.92,26.76],[16.11,244.44,27.22],[19.05,243.27,27.08],[22.19,242.46,26.44],[25.36,242.1,25.38],[28.39,241.94,24.18],[31.39,241.9,22.94],[34.53,242.2,21.73],[37.68,242.73,20.74],[40.54,243.49,20.09],[43.39,244.43,19.7],[45.93,245.58,19.59],[48.52,246.76,19.81],[51.03,247.83,20.12],[53.81,248.72,20.41],[57,249.5,20.63],[60.55,250.23,20.84],[64.09,250.75,20.84],[67.89,251.2,20.72],[71.41,251.82,20.51],[74.48,252.45,20.3],[77.25,253.36,20.21],[79.58,254.86,20.07],[81.4,256.79,19.75],[83,259.12,19.13],[84.28,261.58,18.25],[85.19,264.11,16.8],[85.96,266.35,14.98],[86.62,268.38,12.9],[87.26,270.04,10.68],[88,271.72,8.22],[88.76,273.21,5.85],[89.4,274.57,3.44],[90.08,275.92,0.99],[90.73,277.22,-1.38],[91.38,278.52,-3.72],[92.08,279.84,-6.25],[92.77,281.09,-8.76],[93.49,282.38,-11.36],[94.24,283.63,-14],[94.88,284.75,-16.6],[95.67,286.06,-19.27],[97.15,287.96,-21.52],[98.97,290.03,-22.95],[101.06,292.3,-23.81],[103.6,294.61,-24.04],[106.27,296.67,-23.51],[109,298.23,-22.61],[111.63,299.47,-21.71],[114.36,300.48,-20.7],[117.01,301.41,-19.72],[119.52,302.22,-18.74],[121.63,302.8,-17.91],[124.06,303.33,-16.93],[126.32,303.85,-16.03],[128.55,304.29,-15.11],[131.17,304.63,-14.1],[133.74,304.95,-13.11],[136.32,305.16,-12.15],[138.93,305.27,-11.23],[141.9,305.4,-10.08],[144.84,305.73,-8.98],[148.18,305.98,-7.83],[151.49,306.11,-6.71],[155.28,305.69,-5.38],[159.1,304.95,-4.17],[162.65,303.75,-3.06],[165.83,302.4,-2.04],[169.05,300.53,-1.15],[172.09,298.53,-0.56],[174.91,296.35,-0.15],[177.73,294.09,0.28],[180.53,291.72,0.72],[183.12,289.73,1.19],[185.48,288.15,1.8],[187.89,286.72,2.52],[190.32,285.44,3.33],[192.95,284.27,4.3],[195.56,283.24,5.3],[198.36,282.37,6.38],[201.06,281.7,7.46],[203.93,281.17,8.61],[206.72,280.79,9.61],[209.31,280.54,10.59],[211.99,280.47,11.52],[214.67,280.58,12.41],[217.46,280.87,13.22],[220.2,281.22,13.96],[223.36,281.83,14.67],[226.21,282.4,15.22],[228.96,283.04,15.62],[231.63,283.94,15.72],[234.35,285.3,15.63],[236.63,286.69,15.31],[238.78,288.33,14.79],[240.76,290.26,14.12],[242.38,292.5,13.26],[243.56,294.69,12.34],[244.56,297.42,11.14],[245.31,300.22,9.88],[245.98,303.33,8.4],[246.43,306.36,6.94],[246.88,309.39,5.58],[247.27,312.18,4.34],[247.85,315.1,3.06],[248.53,317.69,2.03],[249.48,319.98,1.24],[251.16,322.16,0.6],[253.17,323.85,0.17],[255.58,324.9,-0.05],[258.78,325.23,-0.12],[262.13,325.04,-0.13],[265.31,324.15,-0.18],[268.72,322.79,-0.18],[271.83,321.34,-0.12],[274.35,319.9,-0.08],[276.69,318.47,-0.08],[278.93,317.17,-0.05],[281.16,315.83,-0.04],[283.49,314.45,-0.03],[285.72,313.15,-0.04],[287.98,311.85,-0.01],[290.05,310.55,0.08],[291.89,309.52,0.2],[293.67,308.42,0.33],[295.87,307.13,0.53],[298.11,305.78,0.73],[300.73,304.19,0.97],[303.75,302.33,1.2],[307.15,300.43,1.48],[310.54,298.51,1.8],[314.27,296.34,2.13],[317.88,294.19,2.33],[321.38,292.05,2.4],[324.78,289.86,2.34],[327.77,287.8,2.01],[330.41,285.96,1.45],[332.77,284.48,0.81],[335.05,283.3,-0.08],[337.16,282.55,-1.24],[339.83,282.63,-3.02],[342.61,283.33,-5.13],[345.45,284.42,-7.49],[348.11,286.05,-9.88],[350.59,288.21,-12.37],[352.51,290.2,-14.35],[354.23,292.37,-16.16],[355.76,294.78,-17.83],[357.18,297.5,-19.37],[358.42,300.09,-20.65],[359.57,303.21,-21.74],[360.49,306.14,-22.57],[361.28,309.01,-23.24],[361.91,311.66,-23.65],[362.43,314.4,-23.88],[362.7,316.87,-23.92],[362.88,318.16,-23.94],[363.02,319.49,-23.91]],"arc":[0,1.23,3.15,6,9.51,13.35,16.87,19.5,22.06,24.13,26.22,28.5,30.77,33.34,36.47,39.8,42.83,45.87,49,52.08,55.46,59.2,62.77,65.85,68.6,71.24,74.17,77.37,81.26,85.29,89.32,92.79,96.15,99.12,102.13,104.79,107.43,110.35,113.26,116.26,119.04,122.1,125.09,127.95,130.64,133.47,136.13,138.69,141.55,144.44,147.55,150.82,154.19,157.25,160.53,163.51,166.51,169.27,172.16,174.86,177.46,179.64,182.11,184.5,186.76,189.28,192.16,194.9,197.75,200.86,203.7,206.63,209.5,212.52,215.67,218.74,221.48,224.3,226.97,229.53,232.28,234.98,237.55,240.08,242.8,245.39,247.77,250.2,252.95,256.31,259.77,263.14,266.2,268.86,271.53,274.21,276.8,279.76,282.8,285.57,288.25,291.15,293.65,296.27,298.88,301.58,304.01,306.37,308.95,311.66,314.72,317.92,321.09,324.38,327.5,330.09,332.8,335.74,338.8,342.27,345.97,349.57,352.93,356.05,359.07,362.27,365.44,368.58,371.8,374.95,378.15,381.39,384.38,387.44,390.56,393.45,396.35,399.49,402.38,405.31,408.33,411.28,414.24,417.54,420.51,423.69,426.67,429.6,432.54,435.47,438.27,441.26,444.41,447.29,450.22,453.16,456.14,459.02,461.88,464.87,467.69,470.34,472.66,475.08,477.92,480.95,484.3,487.95,491.69,495.34,498.97,502.72,506.31,509.78,513.41,517.52,521.2,525.28,529.02,532.41,535.45,538.55,541.24,544,546.75,549.47,552.23,554.88,557.59,560.28,562.96,565.65,568.47,571.29,574.16,576.97,579.72,582.46,585.22,587.92,590.73,593.54,596.39,599.05,601.57,604.09,606.59,608.99,611.36,613.89,616.34,618.71,621.19,623.77,626.4,629.14,632.11,635.34,638.53,641.59,644.52,647.26,649.81,652.44,655.24,658.07,661.14,664.17,667.1,669.96,672.86,675.64,678.37,681.14,683.88,686.65,689.43,692.2,694.97,697.82,700.61,703.33,706.14,708.93,711.73,714.54,717.42,720.61,723.77,727.2,730.63,734.38,737.76,741.2,744.46,747.78,750.86,753.95,757.09,760.13,763.26,766.37,769.51,772.64,775.74,778.72,781.78,784.91,787.88,790.87,793.8,796.78,799.68,802.64,805.57,808.56,811.23,813.79,816.34,818.7,821.05,823.46,825.88,828.3,830.7,833.21,835.62,838.01,840.35,842.87,845.16,847.93,851,854.12,857.18,860.23,862.81,865.59,868.4,871.25,874.24,877.27,879.69,881.99,884.16,886.25,888.26,890.32,892.43,894.79,897.43,900.13,903.2,906.47,909.57,912.8,916.3,919.36,922.43,925.54,928.5,931.2,933.96,936.65,939.31,942.14,945.23,948.3,951.27,954.44,957.41,960.17,963.22,966.28,969.09,971.6,974.04,976.32,978.86,981.32,983.89,986.4,988.84,990.91,993.28,995.77,998.36,1001.02,1003.84,1006.65,1009.63,1012.71,1015.68,1018.55,1021.22,1023.58,1025.77,1028.07,1030.57,1033.1,1035.62,1038.6,1041.54,1044.43,1047.3,1050.34,1053.1,1055.84,1058.47,1061.3,1064.03,1066.69,1069.42,1072.35,1075.23,1078.41,1081.48,1084.65,1087.63,1090.66,1093.46,1096.49,1099.46,1102.54,1105.63,1108.68,1111.53,1114.3,1117.06,1119.69,1122.33,1125.28,1128.18,1130.96,1133.73,1136.44,1139.18,1142.32,1145.99,1149.93,1154.26,1158.17,1161.61,1164.84,1167.95,1170.73,1173.78,1176.81,1179.62,1182.49,1185.27,1187.92,1190.87,1194.03,1197.08,1200.67,1204.76,1208.59,1212.11,1215.61,1218.58,1221.32,1224.16,1227.39,1230.74,1234.42,1237.81,1241.22,1244.25,1247.27,1250.07,1252.85,1255.59,1258.37,1261.15,1263.85,1266.59,1269.34,1272.24,1275.13,1278.05,1280.97,1284.06,1286.88,1289.58,1292.17,1294.89,1297.49,1300.24,1303.3,1306.86,1310.35,1313.6,1317.15,1320.6,1323.57,1326.49,1329.58,1332.3,1334.88,1337.56,1340.21,1343,1345.73,1348.85,1352.1,1355.4,1358.52,1361.92,1365.22,1368.56,1371.72,1374.85,1377.84,1380.7,1383.43,1386.36,1389.27,1392.49,1395.9,1399.33,1402.55,1405.73,1408.46,1411.13,1413.82,1416.49,1419.12,1421.88,1424.61,1427.59,1430.76,1434.06,1437.42,1440.69,1443.94,1447.31,1450.66,1453.69,1456.71,1459.5,1462.36,1465.11,1468.04,1471.32,1474.96,1478.54,1482.36,1485.95,1489.09,1492,1494.78,1497.45,1500.34,1503.25,1506.31,1509.3,1512.27,1515.12,1518.19,1521.09,1523.93,1526.81,1529.59,1532.34,1535.28,1538.17,1541.16,1544.17,1547.08,1550.16,1553.45,1556.56,1559.76,1563.2,1566.61,1569.89,1572.93,1576.01,1578.99,1581.8,1584.15,1586.81,1589.3,1591.76,1594.58,1597.35,1600.12,1602.89,1606.07,1609.23,1612.77,1616.27,1620.31,1624.37,1628.29,1631.89,1635.71,1639.4,1642.99,1646.63,1650.32,1653.63,1656.53,1659.42,1662.29,1665.33,1668.31,1671.43,1674.41,1677.55,1680.54,1683.32,1686.16,1688.98,1691.9,1694.76,1698.06,1701.02,1703.87,1706.69,1709.73,1712.42,1715.18,1718.01,1720.91,1723.57,1726.71,1729.87,1733.37,1736.77,1740.13,1743.2,1746.44,1749.31,1751.91,1754.74,1757.4,1760.03,1763.25,1766.6,1769.91,1773.58,1777.02,1779.91,1782.65,1785.25,1787.85,1790.56,1793.14,1795.75,1798.19,1800.3,1802.4,1804.95,1807.58,1810.65,1814.21,1818.12,1822.02,1826.35,1830.56,1834.66,1838.71,1842.36,1845.62,1848.48,1851.19,1853.72,1856.93,1860.48,1864.33,1868.27,1872.38,1875.78,1879.1,1882.41,1885.84,1888.98,1892.49,1895.66,1898.72,1901.47,1904.27,1906.75,1908.05,1909.39],"r":3.72}};
const MAXP = 2400; let pMesh = null; const parts = []; let spawnAcc = 0; const secAcc = {};
const LUMEN = 9, VLUMEN = 1.3, V_BLOOD = 95, V_TUB = 70, FILTERED = 0.65;
let FILT = FILTERED;   // share of filterable particles entering the capsule (scaled by GFR in the Regulation tab)
const PATHS = {};
// Smooth path: Catmull-Rom position and parallel-transport frames, so particles neither kink at bends nor jump around the axis
function makePath(pts, arc) {
  const P = pts.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(...p))), S = arc.slice(), n = P.length;
  const T = P.map((_, i) => new THREE.Vector3().subVectors(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)]).normalize());
  const N = [], tmpv = new THREE.Vector3(Math.abs(T[0].z) < 0.9 ? 0 : 1, 0, Math.abs(T[0].z) < 0.9 ? 1 : 0);
  N[0] = new THREE.Vector3().crossVectors(T[0], tmpv).normalize();
  for (let i = 1; i < n; i++) { const v = N[i - 1].clone().addScaledVector(T[i], -N[i - 1].dot(T[i])); N[i] = v.lengthSq() > 1e-8 ? v.normalize() : N[i - 1].clone(); }
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  return { P, S, len: S[n - 1], sample(s, out) {
    let lo = 0, hi = n - 1; if (s >= S[hi]) s = S[hi] - 0.01; if (s < 0) s = 0;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const f = (s - S[lo]) / (S[hi] - S[lo] || 1), p0 = P[Math.max(0, lo - 1)], p1 = P[lo], p2 = P[hi], p3 = P[Math.min(n - 1, hi + 1)];
    const f2 = f * f, f3 = f2 * f;
    out.set(0, 0, 0).addScaledVector(p0, -0.5 * f3 + f2 - 0.5 * f).addScaledVector(p1, 1.5 * f3 - 2.5 * f2 + 1).addScaledVector(p2, -1.5 * f3 + 2 * f2 + 0.5 * f).addScaledVector(p3, 0.5 * f3 - 0.5 * f2);
    _t.lerpVectors(T[lo], T[hi], f).normalize(); _n.lerpVectors(N[lo], N[hi], f).normalize(); _b.crossVectors(_t, _n);
    return out;
  } };
}
// --- molecule shapes (model units; the tubule lumen radius is ~9) ---
function ballGeo(parts) { // parts: [radius, x, y, z]
  return BufferGeometryUtils.mergeGeometries(parts.map(([r, x, y, z]) => new THREE.SphereGeometry(r, 10, 7).translate(x, y, z)));
}
function makeMoleculeGeos() {
  const G = {};
  const h2o = 104.5 * Math.PI / 360;
  G.water = ballGeo([[1.9, 0, 0, 0], [1.15, Math.sin(h2o) * 2.1, -Math.cos(h2o) * 2.1, 0], [1.15, -Math.sin(h2o) * 2.1, -Math.cos(h2o) * 2.1, 0]]);
  G.na = new THREE.SphereGeometry(1.5, 12, 8);   // Na⁺ is a small ion…
  G.cl = new THREE.SphereGeometry(2.6, 12, 8);   // …Cl⁻ is much larger (≈ 1.8×)
  G.k = new THREE.SphereGeometry(2.05, 12, 8);
  G.h = new THREE.SphereGeometry(0.95, 12, 8);
  G.nh3 = ballGeo([[1.6, 0, 0.5, 0], ...[0, 1, 2].map((i) => [0.95, Math.cos(i * 2.094) * 1.75, -0.7, Math.sin(i * 2.094) * 1.75])]);
  G.glu = new THREE.TorusGeometry(2.1, 0.72, 8, 6);  // six-membered ring
  G.aa = new THREE.CapsuleGeometry(0.95, 2.6, 4, 10).rotateZ(Math.PI / 2);
  { const a = (i) => i * 2.094; G.hco3 = ballGeo([[1.25, 0, 0, 0], ...[0, 1, 2].map((i) => [1.3, Math.cos(a(i)) * 2.25, Math.sin(a(i)) * 2.25, 0]), [0.75, 3.35, 0.9, 0]]); }   // C, three O, one H
  G.urea = ballGeo([[1.35, 0, 0, 0], [1.25, 0, 2.2, 0], [1.3, 1.9, -1.1, 0], [1.3, -1.9, -1.1, 0]]);
  const pr = new THREE.IcosahedronGeometry(3.3, 2), pp = pr.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pp.count; i++) { v.fromBufferAttribute(pp, i); const k = 1 + 0.16 * Math.sin(v.x * 1.7) * Math.sin(v.y * 1.9 + 1) * Math.sin(v.z * 1.5 + 2); v.multiplyScalar(k); pp.setXYZ(i, v.x, v.y, v.z); }
  pr.computeVertexNormals(); G.prot = pr;                 // knobbly globular protein
  const prof = []; for (let i = 0; i <= 10; i++) { const t = i / 10, r = 4.2 * t; const th = 0.55 + 1.05 * Math.pow(Math.sin(t * Math.PI * 0.5), 6) * (1 - Math.pow(t, 18)); prof.push(new THREE.Vector2(r, th)); }
  for (let i = 10; i >= 0; i--) { const q = prof[i]; prof.push(new THREE.Vector2(q.x, -q.y)); }
  G.rbc = new THREE.LatheGeometry(prof, 18).rotateX(Math.PI / 2);   // biconcave disc (low-poly: it is a few pixels across)
  return G;
}
let MOL_GEO = null; const MOL_MAT = {}; const isoFade = {}, isoBoost = {}; let isoSel = [];   // substances being followed (tap: one; long-press: a group of up to 3)
const ISO_MAX = 3;
function molMaterial(type) {
  if (MOL_MAT[type]) return MOL_MAT[type];
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.04, transparent: true, opacity: 1 });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n  totalEmissiveRadiance += vColor * 0.42;\n#endif'); };
  isoFade[type] = 1; return (MOL_MAT[type] = m);
}
// A swarm draws any list of particles with one instanced mesh per substance
function makeSwarm(parent, cap) {
  if (!MOL_GEO) MOL_GEO = makeMoleculeGeos();
  const group = new THREE.Group(), meshes = {};
  for (const t of Object.keys(P_TYPES)) {
    const im = new THREE.InstancedMesh(MOL_GEO[t], molMaterial(t), cap); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0; im.frustumCulled = false; im.renderOrder = 2; const c = new THREE.Color(P_TYPES[t].c); for (let i = 0; i < cap; i++) im.setColorAt(i, c);
    meshes[t] = im; group.add(im);
  }
  parent.add(group);
  const cnt = {};
  return { group, begin() { for (const t in meshes) cnt[t] = 0; }, putS(type, pos, quat, sv) { const im = meshes[type]; const i = cnt[type]; if (i >= cap) return; const b = isoBoost[type] || 1; _m.compose(pos, quat, _s3.set(sv.x * b, sv.y * b, sv.z * b)); im.setMatrixAt(i, _m); cnt[type] = i + 1; },
    put(type, pos, quat, sc) { const im = meshes[type]; const i = cnt[type]; if (i >= cap) return; _m.compose(pos, quat, _s3.setScalar(sc * (isoBoost[type] || 1))); im.setMatrixAt(i, _m); cnt[type] = i + 1; },
    end() { for (const t in meshes) { meshes[t].count = cnt[t]; meshes[t].instanceMatrix.needsUpdate = true; } } };
}
// Tumbling: each particle spins slowly about its own axis
const _e = new THREE.Euler();
function spinOf(p, t, q) { if (p.ra === undefined) { p.ra = Math.random() * 6.28; p.rb = Math.random() * 6.28; p.wa = (Math.random() - 0.5) * 1.6; p.wb = (Math.random() - 0.5) * 1.2; } _e.set(p.ra + p.wa * t, p.rb + p.wb * t, p.ra * 0.5); return q.setFromEuler(_e); }
// Isolate one substance: the others fade away; null shows everything
function setIso(type) { isoSel = type ? [type] : []; renderIsoChips(); }
// long-press: add to the group (or take out again); a fourth replaces the oldest
function addIso(type) { if (!type) return; const i = isoSel.indexOf(type); if (i >= 0) isoSel.splice(i, 1); else { isoSel.push(type); if (isoSel.length > ISO_MAX) isoSel.shift(); } renderIsoChips(); }
function stepIso(dt) {
  for (const t of Object.keys(P_TYPES)) {
    const on = isoSel.includes(t), target = !isoSel.length || on ? 1 : 0.05; const m = MOL_MAT[t]; if (!m) continue;
    isoFade[t] += (target - isoFade[t]) * Math.min(1, dt * 6); m.opacity = isoFade[t]; m.depthWrite = isoFade[t] > 0.95;
    const bt = on ? 1.45 : 1; isoBoost[t] = (isoBoost[t] || 1) + (bt - (isoBoost[t] || 1)) * Math.min(1, dt * 6);
  }
}
let XFER = []; // capillary points reabsorbed particles can enter: { p, arc } (arc on the efferent/peritubular path, or null for the vasa recta)

/* --- medulla: interstitium gradient and counter-current exchange --- */
const N_VR = {"dvr":{"pts":[[153.72,252.71,-6.26],[153.59,252.26,-7.1],[153.44,251.45,-8.03],[153.06,249.92,-9.64],[152.55,247.93,-11.38],[152.02,245.54,-13.15],[151.5,243.18,-14.76],[150.84,240.79,-16.25],[150.25,238.58,-17.73],[149.63,236.42,-19.4],[148.85,234.48,-21.21],[147.87,232.59,-23.23],[146.77,230.87,-25.05],[145.7,228.72,-26.36],[144.9,226.47,-26.87],[144.43,223.91,-26.47],[144.42,221.16,-24.95],[144.93,218.34,-22.86],[145.66,216.05,-20.58],[146.45,213.87,-18.24],[147.27,211.84,-16.07],[147.97,210.02,-14.24],[148.56,208.37,-12.54],[149.29,206.71,-10.91],[149.93,205.08,-9.39],[150.5,203.54,-7.91],[151.18,201.88,-6.53],[151.87,200.18,-5.24],[152.39,198.48,-3.93],[153.08,196.38,-2.57],[153.72,194.18,-1.36],[154.31,191.64,-0.28],[154.81,188.8,0.48],[155,185.74,0.9],[155.1,182.62,1.1],[155.58,179.07,1.29],[156.18,175.73,1.42],[156.75,172.24,1.65],[157.68,168.56,1.74],[158.65,164.84,1.68],[159.29,161.49,1.56],[159.73,157.84,1.38],[160.33,154.23,1.22],[160.92,150.65,1.16],[161.42,147.12,1.06],[161.96,143.31,0.83],[162.69,139.47,0.62],[163.31,135.66,0.4],[163.89,131.91,0.21],[164.47,128.15,0.1],[164.92,124.34,0.06],[165.12,120.58,0.03],[165.01,116.9,0],[164.27,113.47,0.11],[163.52,110.04,0.13],[163.33,106.34,0.09],[163.13,102.64,0.07],[163.25,98.85,0.08],[163.9,94.71,-0.06],[164.41,90.62,-0.12],[164.26,86.78,-0.12],[164.13,82.95,-0.13],[163.97,79.11,-0.16],[163.8,75.32,-0.17],[163.66,71.49,-0.18],[163.54,67.68,-0.43],[163.32,64.08,-0.9],[163.12,60.45,-1.19],[162.99,56.75,-1.15],[162.85,53.04,-1.12],[162.76,49.34,-0.84],[162.74,45.46,-0.34],[162.64,41.6,-0.03],[162.39,37.78,-0.03],[161.77,34.1,0.12],[160.98,30.6,0.33],[160.27,27.13,0.41],[159.73,23.96,0.46],[159.42,20.67,0.5],[159.35,17.21,0.4],[159.37,13.56,0.24],[159.23,9.93,0.17],[158.76,5.93,0.14],[157.99,2.2,-0.07],[156.97,-1.35,-0.57],[156.01,-4.87,-0.93],[155.05,-8.04,-1.26],[154.41,-11.29,-1.28],[153.96,-14.67,-1.08],[153.89,-18.21,-0.6],[153.99,-21.62,-0.3],[154.31,-25.38,0.05],[154.49,-28.62,0.06],[154.72,-31.8,0.02],[155.16,-35.07,0.01],[155.59,-38.49,0.04],[155.94,-41.97,0.02],[156.2,-45.83,0.04],[156.15,-49.63,0.19],[156.01,-53.28,0.35],[156.01,-56.92,0.42],[156.48,-60.75,0.41],[157.22,-64.64,0.39],[158.33,-68.57,0.24],[159.32,-72.55,0.05],[160.21,-76.54,-0.04],[160.68,-80.36,-0.03],[161.13,-84.09,-0.04],[161.43,-87.87,-0.04],[161.77,-91.7,-0.02],[161.84,-95.47,-0.01],[161.6,-99.31,-0.02],[161.26,-102.8,-0.02],[160.76,-106.25,-0.02],[159.94,-109.74,0],[159.07,-112.88,0.05],[158.14,-115.9,0.12],[156.59,-119.06,0.44],[154.79,-121.67,0.8],[152.91,-123.69,1.26],[151.21,-125.96,1.55],[149.83,-128.04,1.71],[149.16,-130.47,1.4],[148.73,-133.47,1.04],[148.54,-136.67,0.54],[147.96,-139.92,0.19],[147.16,-142.99,-0.03],[145.89,-145.59,0.01],[144.18,-147.82,0.01],[142.25,-149.88,0.05],[139.92,-151.56,0.08],[137.36,-153.02,0.08],[134.65,-154.22,0.03],[131.73,-155.21,0.03],[128.67,-156.13,-0.01],[125.78,-156.74,-0.05],[122.68,-157.32,-0.04],[119.76,-157.87,-0.02],[117.26,-158.23,-0.03],[114.86,-158.46,-0.04],[112.3,-158.84,0],[109.58,-159.16,-0.01],[106.45,-159.41,0],[102.97,-159.65,0.03],[99.11,-159.83,0.06],[95.19,-159.67,-0.02],[91.64,-159.39,-0.06],[88.27,-159.04,-0.1],[84.98,-158.74,0.01],[83.38,-158.46,0.01],[82.11,-158.32,0.1]],"arc":[0,0.95,2.2,4.45,7.15,10.17,13.07,15.96,18.69,21.49,24.26,27.19,29.92,32.66,35.1,37.73,40.88,44.43,47.74,51.03,54.11,56.79,59.23,61.66,63.99,66.2,68.45,70.7,72.91,75.51,78.09,80.92,83.9,87,90.12,93.71,97.11,100.65,104.45,108.3,111.7,115.38,119.04,122.68,126.24,130.1,134.01,137.88,141.68,145.48,149.32,153.09,156.77,160.28,163.79,167.5,171.2,175,179.19,183.31,187.15,190.98,194.83,198.63,202.46,206.27,209.92,213.56,217.27,220.97,224.69,228.6,232.47,236.3,240.04,243.63,247.17,250.38,253.69,257.15,260.8,264.44,268.47,272.28,276.01,279.68,283.01,286.32,289.73,293.31,296.73,300.52,303.76,306.96,310.25,313.7,317.2,321.07,324.87,328.53,332.17,336.03,339.99,344.08,348.18,352.27,356.12,359.87,363.67,367.51,371.28,375.13,378.64,382.12,385.7,388.97,392.13,395.66,398.85,401.65,404.5,407,409.54,412.6,415.83,419.15,422.34,425.23,428.04,430.86,433.74,436.68,439.65,442.73,445.93,448.88,452.03,455.01,457.53,459.95,462.53,465.27,468.41,471.9,475.76,479.69,483.25,486.63,489.94,491.56,492.84],"r":3.75},"avr":{"pts":[[77.06,-162.75,-0.08],[76.75,-162.12,-0.13],[76.12,-161.41,-0.14],[74.6,-160.43,-0.1],[71.96,-159.39,-0.07],[68.74,-158.37,-0.04],[65.41,-157.61,0.03],[61.98,-156.89,0.11],[58.99,-155.84,0.08],[56.54,-154.44,0.08],[54.21,-152.72,0.04],[51.87,-150.48,0.03],[49.85,-148,-0.03],[48.23,-145.35,-0.09],[47.1,-142.77,-0.09],[46.33,-140.09,-0.14],[45.44,-137.4,-0.14],[44.11,-134.87,-0.09],[42.11,-132.25,-0.01],[39.99,-129.68,0],[37.54,-127.23,0.09],[35.22,-124.7,0.06],[33.18,-122.14,0.03],[31.49,-119.44,0],[29.72,-116.37,-0.01],[28.18,-113.18,-0.04],[26.86,-110.09,-0.03],[25.91,-106.66,0.12],[25.35,-103.34,0.59],[24.95,-100.17,1.21],[24.87,-96.75,1.74],[25.02,-92.79,1.74],[25.15,-89.05,1.63],[25.3,-85.3,1.19],[25.72,-81.35,0.57],[26.16,-77.39,0.07],[26.56,-73.82,0.09],[27.31,-70.03,-0.14],[28.29,-66.33,-0.51],[29.1,-62.64,-0.73],[29.55,-58.92,-0.72],[30.16,-55.15,-0.71],[30.59,-51.39,-0.42],[31.01,-47.65,0.39],[31.57,-44.48,1.21],[32.41,-41.41,1.75],[32.89,-38.09,1.75],[33.25,-34.7,1.66],[33.29,-31.44,1.22],[33.23,-27.67,0.61],[33.1,-23.88,0.08],[33.29,-20.37,0.11],[33.48,-16.89,0.14],[33.8,-13.05,0.16],[33.96,-9.23,-0.04],[34,-5.65,-0.47],[33.89,-2.11,-1],[33.9,1.43,-1.28],[33.92,5.16,-1.33],[34.12,8.62,-1.11],[34.42,12.24,-0.7],[34.71,15.89,-0.21],[34.89,19.54,0.05],[34.81,22.99,0.1],[34.47,26.8,0.09],[34.13,30.63,0.09],[33.67,34.41,0.1],[33.09,38.22,0.11],[32.66,42.02,0.09],[32.63,45.75,-0.01],[32.91,49.29,-0.41],[33.3,52.88,-0.7],[33.66,56.47,-0.82],[34.19,60.22,-0.84],[34.74,63.9,-0.76],[35.22,67.66,-0.33],[35.8,71.14,-0.11],[36.62,74.3,-0.04],[37.48,77.27,-0.1],[38.4,80.4,-0.13],[39.3,83.63,-0.02],[40.36,86.67,0.4],[41.4,89.53,0.93],[42.46,92.33,1.6],[43.36,95.07,1.89],[44.02,97.62,1.76],[44.56,100.24,1.42],[44.94,103.4,1.08],[45.01,106.33,0.67],[44.91,108.84,0.66],[44.61,111.26,1.02],[43.92,113.74,1.72],[43.05,115.74,2.5],[42.06,117.67,3.53],[40.77,119.66,4.78],[39.21,121.54,6.08],[37.56,123.3,7.07],[35.54,125.06,7.73],[33.2,126.67,8.09],[32.02,127.44,8.25],[30.83,128.23,8.21]],"arc":[0,0.71,1.66,3.47,6.3,9.68,13.1,16.61,19.77,22.59,25.49,28.73,31.93,35.03,37.85,40.64,43.48,46.34,49.63,52.96,56.43,59.86,63.13,66.32,69.86,73.4,76.76,80.33,83.72,86.98,90.44,94.41,98.15,101.92,105.95,109.97,113.56,117.43,121.27,125.05,128.8,132.62,136.42,140.26,143.59,146.82,150.18,153.58,156.88,160.69,164.52,168.03,171.52,175.37,179.21,182.81,186.39,189.94,193.67,197.15,200.8,204.49,208.16,211.61,215.44,219.28,223.09,226.94,230.77,234.5,238.07,241.7,245.31,249.09,252.81,256.63,260.16,263.42,266.52,269.78,273.14,276.39,279.48,282.54,285.44,288.07,290.77,293.97,296.93,299.44,301.91,304.58,306.9,309.3,311.97,314.74,317.35,320.11,322.97,324.39,325.82],"r":3.81}};
const V_VR = 42;                     // slow blood flow in the vasa recta
let VR_SPLIT = 0, Y_TOP = 150, Y_BOT = -165, interPlane = null; const oTags = [];
const VR_IN = [['water', 0.55], ['na', 0.18], ['cl', 0.18], ['rbc', 0.09]];
let vrAcc = 0;
function initMedulla() {
  // one continuous path: down the descending vasa recta, round the bend, up the ascending vasa recta
  const pts = N_VR.dvr.pts.concat(N_VR.avr.pts.slice(1)), arc = N_VR.dvr.arc.concat(N_VR.avr.arc.slice(1).map((a) => a + N_VR.dvr.arc[N_VR.dvr.arc.length - 1]));
  PATHS.vr = makePath(pts, arc); VR_SPLIT = N_VR.dvr.arc[N_VR.dvr.arc.length - 1];
  const yAt = (a) => N_PATH.pts[Math.max(0, N_PATH.arc.findIndex((x) => x >= a))][1];
  Y_TOP = Math.min(yAt(950), yAt(1590)); Y_BOT = Math.min(...N_VR.dvr.pts.map((p) => p[1])) - 8;
  // interstitium backdrop: osmolarity rises with depth (300 at the cortex boundary -> 1200 in the inner medulla)
  const x0 = -30, x1 = 440, z = -75;
  const g = new THREE.PlaneGeometry(x1 - x0, Y_TOP - Y_BOT, 1, 32).translate((x0 + x1) / 2, (Y_TOP + Y_BOT) / 2, z);
  interPlane = new THREE.Mesh(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTop: { value: Y_TOP }, uBot: { value: Y_BOT } },
    vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform float uTop; uniform float uBot; varying float vY; void main(){ float t = clamp((uTop - vY)/(uTop - uBot),0.,1.); vec3 c = mix(vec3(0.95,0.85,0.55), vec3(0.95,0.42,0.12), t); gl_FragColor = vec4(c, 0.10 + 0.30*t); }' }));
  interPlane.renderOrder = 1; interPlane.visible = false; nInner.add(interPlane); makeAmbient();
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0, Y_TOP, z + 1), new THREE.Vector3(x1, Y_TOP, z + 1)]), new THREE.LineDashedMaterial({ color: 0xf0b54a, dashSize: 8, gapSize: 6, transparent: true, opacity: 0.8 }));
  line.computeLineDistances(); interPlane.add(line);
  // scale and tubular-fluid tags
  const lvl = (o) => Y_TOP - (Y_TOP - Y_BOT) * (o - 300) / 900;
  const T = [
    [[x0 + 4, Y_TOP + 12, z], 'Cortex', 'zone'], [[x0 + 4, Y_TOP - 12, z], 'Medulla', 'zone'],
    ...[300, 600, 900, 1200].map((o) => [[x0 + 4, lvl(o), z], o + (o === 1200 ? ' mOsmol L⁻¹' : ''), 'scale']),
    [centreAtArc(965).toArray(), 'Filtrate 300 · isotonic', 'fluid'], [centreAtArc(1240).toArray(), 'Concentrated · ≈ 1200', 'fluid'], [centreAtArc(1580).toArray(), 'Dilute · hypotonic', 'fluid'],
    [N_VR.dvr.pts[Math.floor(N_VR.dvr.pts.length * 0.35)], 'Descending vasa recta ↓', 'ves'], [N_VR.avr.pts[Math.floor(N_VR.avr.pts.length * 0.6)], 'Ascending vasa recta ↑', 'ves'],
  ];
  for (const [p, t, k] of T) { const el = document.createElement('div'); el.className = 'otag ' + k; el.textContent = t; el.hidden = true; hsLayer.appendChild(el); oTags.push({ p: new THREE.Vector3(...p), el, k }); }
}
// resting solute pool in the interstitium: density rises with depth, so the gradient itself can be seen (and followed with the legend)
const AMB = [];
function makeAmbient() {
  // keep clear of the tubule: tube radius (≈ 12) + drift (3) + particle size (≈ 3)
  const tubePts = N_PATH.pts.filter((_, j) => (N_PATH.arc[j] >= 945 && N_PATH.arc[j] <= 1600) || N_PATH.arc[j] >= 2560).map((q) => new THREE.Vector3(...q));
  const tubeR = N_PATH.pts.map((_, j) => (N_PATH.arc[j] >= 2560 ? 30 : 18)).filter((_, j) => (N_PATH.arc[j] >= 945 && N_PATH.arc[j] <= 1600) || N_PATH.arc[j] >= 2560);
  const clear = (v) => tubePts.every((q, k) => q.distanceTo(v) > tubeR[k]);
  for (let i = 0, tries = 0; i < 110 && tries < 5000; tries++) {
    const t = Math.sqrt(Math.random()), y = Y_TOP - (Y_TOP - Y_BOT) * t * 0.97;       // pdf rises linearly with depth
    const nearCD = Math.random() < 0.22, x = nearCD ? 340 + Math.random() * 100 : 8 + Math.random() * 175;
    const base = new THREE.Vector3(x, y, -28 + Math.random() * 46); if (!clear(base)) continue;
    const type = Math.random() < 0.28 + 0.25 * t ? 'urea' : Math.random() < 0.5 ? 'na' : 'cl';  // urea mainly in the inner medulla
    AMB.push({ type, base, th: Math.random() * 6.28, r: Math.random() * 9 }); i++;
  }
}
function placeOTags() {
  const regAdh = stage === 4 && nMode === 'regulation' && REG.tab === 'adh', regRaas = stage === 4 && nMode === 'regulation' && REG.tab === 'raas';
  const show = (stage === 4 && nMode === 'formation' && N_TOUR[nStep].medulla) || regAdh || regRaas;
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  for (const o of oTags) {
    const cdStep = nMode === 'formation' && N_TOUR[nStep].id === 'cd';
    const vis = show && (o.k === 'urine' ? regAdh || cdStep : o.k === 'jga' ? regRaas : regRaas ? false : regAdh ? o.k === 'zone' || o.k === 'scale' : (o.k !== 'ves' || N_TOUR[nStep].vr) && (o.k !== 'fluid' || nStep <= 4));
    if (vis && o.k === 'jga') { const r = regState();
      if (o.id === 'jga') { if (w < 600 && r.anf > 0.08) { o.el.hidden = true; continue; } o.el.textContent = 'JG cells (JGA) · ' + (r.renin > 0.08 ? 'releasing renin' : 'renin at rest'); }   // phones: room for the ANF label
      else if (o.id === 'gfr') o.el.textContent = `GFR ≈ ${Math.round(r.gfr)} mL/min`;
      else if (o.id === 'vasoE') { if (r.renin <= 0.08) { o.el.hidden = true; continue; } o.el.textContent = 'Efferent arteriole constricts · angiotensin II'; }
      else if (o.id === 'vasoA') { if (r.anf <= 0.08) { o.el.hidden = true; continue; } o.el.textContent = 'Afferent arteriole dilates · ANF'; }
      else if (o.id === 'aldo') { if (r.aldo <= 0.08 && r.anf <= 0.08) { o.el.hidden = true; continue; } o.el.textContent = r.aldo > 0.08 ? 'Aldosterone ↑ · DCT: more Na⁺ & water reabsorbed' : 'ANF ↑ · DCT: less Na⁺ reabsorbed (more in urine)'; } }
    if (vis && o.id === 'u1') { const osm = regAdh ? Math.round(regState().osm / 10) * 10 : 1200; o.el.textContent = `Urine ≈ ${osm} · ${osm >= 400 ? 'concentrated' : osm > 250 ? 'isotonic' : 'dilute'}`; }
    o.el.hidden = !vis; if (!vis) continue;
    tmp.copy(o.p); nInner.localToWorld(tmp); tmp.project(camera);
    if (o.k === 'jga' || o.k === 'urine') {   // live labels: keep them on screen (the aldosterone one opens to the left of its point)
      const px = (tmp.x * 0.5 + 0.5) * w, py = (-tmp.y * 0.5 + 0.5) * h, ew = o.el.offsetWidth || 0;
      const x = Math.max(6, Math.min(w - ew - 6, o.id === 'aldo' ? px - ew - 14 : px));
      o.el.style.transform = `translate(${x}px, ${py + (o.id === 'aldo' && w < 600 ? 30 : 0)}px) translate(0, -50%)`;   // on phones it would cover the JG-cell label
    } else o.el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px) translate(${o.id === 'aldo' ? 'calc(-100% - 14px)' : o.k === 'fluid' || o.k === 'ves' ? '14px' : '0'}, -50%)`;
  }
}
// nearest point on the vasa recta, restricted to its descending (d) or ascending (a) limb
function nearestVR(p, limb) {
  const P = PATHS.vr.P, S = PATHS.vr.S; let bi = -1, bd = 1e18;
  for (let i = 0; i < P.length; i++) { if ((limb === 'd') !== (S[i] < VR_SPLIT)) continue; if (P[i].y > Y_TOP) continue; const d = P[i].distanceToSquared(p); if (d < bd) { bd = d; bi = i; } }
  return bi < 0 ? null : { p: P[bi], s: S[bi] };
}
// a resting point in the interstitium between two positions
function interPoint(a, b, f) { return new THREE.Vector3().lerpVectors(a, b, f).add(new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14)); }
function hopOut(p, from, ref, dist, next, dwell) {
  let q = null, bd = 1e18; for (const r of ref) { const d = r.distanceToSquared(from); if (d < bd) { bd = d; q = r; } }
  const dir = q ? from.clone().sub(q) : new THREE.Vector3(1, 0, 0); if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0); dir.normalize();
  const to = (q || from).clone().addScaledVector(dir, dist).add(new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5));
  startXfer(p, from, to, { inter: true, next, dwell }); p.dur = Math.max(1.1, from.distanceTo(to) / 70);
}
let CD_C = null, DESC_C = null;   // centre lines of the collecting duct and descending limb (medulla)
const cdC = () => (CD_C ||= N_PATH.pts.filter((_, j) => N_PATH.arc[j] >= 2560).map((q) => new THREE.Vector3(...q)));
const descC = () => (DESC_C ||= N_PATH.pts.filter((_, j) => N_PATH.arc[j] >= 945 && N_PATH.arc[j] <= 1245).map((q) => new THREE.Vector3(...q)));
function toInter(p, from, toward, next, dwell) { startXfer(p, from, interPoint(from, toward, 0.42 + Math.random() * 0.2), { inter: true, next, dwell }); p.dur = Math.max(1.1, p.from.distanceTo(p.to) / 70); }  // long crossings drift at tubule-flow speed
function spawnVR() { if (parts.length >= MAXP) return; parts.push({ type: pick(VR_IN), path: 'vr', s: Math.random() * 6, th: Math.random() * 6.283, r: Math.random() * LUMEN * 0.6, state: 'move', k: 0 }); }
// called when a tubule particle is reabsorbed in the medulla; returns true if handled here
function medullaExit(p, from, sg) {
  if (from.y > Y_TOP) return false;
  if (sg === 'cd' && p.type === 'water') {                            // water: out of the duct into the interstitium beside it, where vasa recta take it up
    hopOut(p, from, cdC(), 34, 'fade', 1.4 + Math.random() * 1.4); return true;
  }
  if (sg === 'desc') {                                                  // water: into the interstitium, then taken up by the ascending vasa recta beside the limb
    const v = nearestVR(from, 'a'); toInter(p, from, v ? v.p : from, v ? 'avr' : 'fade', 1.2 + Math.random() * 1.4); return true;
  }
  if (sg === 'asc') {                                                   // NaCl and K⁺: into the interstitium, then into the descending vasa recta
    const v = nearestVR(from, 'd'); toInter(p, from, v ? v.p : from, v ? 'dvr' : 'fade', 1.4 + Math.random() * 1.6); return true;   // K⁺ too: back to the blood
  }
  if (sg === 'cd' && p.type === 'urea') {                               // urea: into the interstitium, part re-enters the thin ascending limb
    toInter(p, from, centreAtArc(1290), Math.random() < 0.6 ? 'thinAsc' : 'fade', 1.5 + Math.random() * 1.5); return true;
  }
  return false;
}
function leaveInter(p) {
  const at = p.ipos.clone(); ev(p.type + '|interstitium|→ ' + ({ avr: 'ascending vasa recta', dvr: 'descending vasa recta', thinAsc: 'thin ascending limb' }[p.next] || 'stays in interstitium'));
  if (p.next === 'avr' || p.next === 'dvr') {
    const v = nearestVR(at, p.next === 'avr' ? 'a' : 'd'); if (!v) { p.state = 'fade'; p.k = 0; p.to = at; return; }
    p.exchanged = p.next === 'dvr'; startXfer(p, at, v.p, { path: 'vr', s: v.s }); p.dur = Math.max(0.9, at.distanceTo(v.p) / 70);
  } else if (p.next === 'thinAsc') {
    const s = buildParticlePath.fromArc(1260 + Math.random() * 70); p.path = 'tub'; p.s = s; const dst = posOf(p, new THREE.Vector3());
    p.recycled = true; startXfer(p, at, dst, { path: 'tub', s }); p.dur = 2.6;
  } else { p.state = 'fade'; p.k = 0; p.to = at; }
}
function stepVR(p, dt) {        // blood in the vasa recta, with exchange across its wall
  p.s += V_VR * dt;
  if (p.s >= PATHS.vr.len) return false;
  if (p.vrExit === undefined) {
    p.vrExit = -1;
    if (false && p.type === 'water' && p.s < VR_SPLIT && Math.random() < 0.35) p.vrExit = p.s + Math.random() * (VR_SPLIT - p.s) * 0.85;          // water leaves the DVR…
    if ((p.type === 'na' || p.type === 'cl') && (p.exchanged || Math.random() < 0.3)) p.vrExit = VR_SPLIT + 20 + Math.random() * (PATHS.vr.len - VR_SPLIT) * 0.6; // …NaCl leaves the AVR
  }
  if (p.vrExit > 0 && p.s >= p.vrExit) {
    const from = posOf(p, new THREE.Vector3());
    if (from.y < Y_TOP) { ev(p.type + '|' + (p.s < VR_SPLIT ? 'descending vasa recta' : 'ascending vasa recta') + '|left into interstitium');
      if (p.type === 'water') { const v = nearestVR(from, 'a'); toInter(p, from, v ? v.p : from, v ? 'avr' : 'fade', 0.8 + Math.random()); }
      else { hopOut(p, from, descC(), 44, 'fade', 2.0 + Math.random() * 2.0); }   // returned to the interstitium beside the ascending vasa recta, on the side away from the loop
      p.vrExit = -2;
    }
  }
  return true;
}

/* --- vasoconstriction (angiotensin II) and vasodilation (ANF): the arterioles are scaled about their traced centre lines --- */
const VASO = { aff: 1, eff: 1, verts: null, applied: false };
function initVaso() {
  const m = nMesh.art[0]; if (!m) return; const g = m.geometry, root = nInner.children[0];
  { // the model stores positions as 16-bit integers spanning only the vessels' own extent: widening would overflow them
    const q = g.attributes.position, f = new Float32Array(q.count * 3); for (let i = 0; i < q.count; i++) { f[i * 3] = q.getX(i); f[i * 3 + 1] = q.getY(i); f[i * 3 + 2] = q.getZ(i); }
    g.setAttribute('position', new THREE.BufferAttribute(f, 3)); }
  const pa = g.attributes.position;
  root.updateWorldMatrix(true, true); m.updateWorldMatrix(true, false);
  const M = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(m.matrixWorld), Mi = M.clone().invert();
  const A = N_VES.aff.pts.map((q) => new THREE.Vector3(...q)), E = N_VES.eff.pts.map((q) => new THREE.Vector3(...q)), C = new THREE.Vector3(...CAPS_C), eEnd = N_VES.eff.arc[N_VES.eff.arc.length - 1];
  const V = [], v = new THREE.Vector3();
  for (let i = 0; i < pa.count; i++) {
    v.fromBufferAttribute(pa, i).applyMatrix4(M);
    let ia = 0, da = 1e18, ie = 0, de = 1e18;
    for (let j = 0; j < A.length; j++) { const d = A[j].distanceToSquared(v); if (d < da) { da = d; ia = j; } }
    for (let j = 0; j < E.length; j++) { const d = E[j].distanceToSquared(v); if (d < de) { de = d; ie = j; } }
    da = Math.sqrt(da); de = Math.sqrt(de); let kind = 0, w = 0, c = null;
    if (da <= de && da < 9) { c = A[ia]; w = sstep(CAPS_R + 1, CAPS_R + 9, c.distanceTo(C)); kind = 1; }
    else if (de < 6.5) { c = E[ie]; w = sstep(CAPS_R + 2, CAPS_R + 22, c.distanceTo(C)) * (1 - sstep(0.88, 1, N_VES.eff.arc[ie] / eEnd)); kind = 2; }
    if (w > 0) V.push({ i, kind, w, c: c.clone(), p: v.clone() });
  }
  Object.assign(VASO, { verts: V, Mi, geo: g });
}
function applyVaso() {
  const pa = VASO.geo.attributes.position, t = new THREE.Vector3();
  for (const q of VASO.verts) { const k = 1 + ((q.kind === 1 ? VASO.aff : VASO.eff) - 1) * q.w; t.copy(q.p).sub(q.c).multiplyScalar(k).add(q.c).applyMatrix4(VASO.Mi); pa.setXYZ(q.i, t.x, t.y, t.z); }
  pa.needsUpdate = true; VASO.geo.computeBoundingSphere();
}
function stepVaso(dt) {
  const on = stage === 4 && nMode === 'regulation' && REG.tab === 'raas', r = on ? regState() : null;
  if (!VASO.verts) { if (!on) return; if (nMesh.art.length && nInner) initVaso(); if (!VASO.verts) return; }   // set up only when the RAAS tab is first opened
  const ta = on ? 1 - 0.1 * r.renin + 0.35 * r.anf : 1, te = on ? 1 - 0.4 * r.renin : 1;   // angiotensin II: efferent ≫ afferent; ANF: afferent widens
  const k = 1 - Math.exp(-dt * 2.5), na = VASO.aff + (ta - VASO.aff) * k, ne = VASO.eff + (te - VASO.eff) * k;
  if (VASO.applied && Math.abs(na - VASO.aff) + Math.abs(ne - VASO.eff) < 2e-4) return;
  VASO.aff = na; VASO.eff = ne; VASO.applied = true; applyVaso();
}
// blood particles in the efferent arteriole follow its current calibre
const effDyn = (s) => 1 + (VASO.eff - 1) * (1 - effK(s)) / (1 - F_EFF);
let nSwarm = null;
function makeParticles() {
  nSwarm = makeSwarm(nInner, 1200); pMesh = nSwarm.group;
  PATHS.aff = makePath(N_VES.aff.pts, N_VES.aff.arc);
  PATHS.eff = makePath(N_VES.eff.pts, N_VES.eff.arc);
  PATHS.tub = makePath(PP, PS);
  initMedulla(); initJGA(); initUrineTags();
  XFER = N_VES.eff.pts.map((p, i) => ({ p: new THREE.Vector3(...p), arc: N_VES.eff.arc[i] })).filter((x) => x.arc > 180);
  const v = new THREE.Vector3();
  for (const m of nMesh.ven) { const pa = m.geometry.attributes.position; for (let i = 0; i < pa.count; i += 5) XFER.push({ p: v.fromBufferAttribute(pa, i).applyMatrix4(m.matrix).clone(), arc: null }); }
}
function nearestXfer(p) { let best = null, bd = 140 * 140; for (const x of XFER) { const d = x.p.distanceToSquared(p); if (d < bd) { bd = d; best = x; } } return best; }
const segOf = (arc) => { for (const sg of N_SEG) if (arc >= sg.a && arc < sg.b) return sg.id; return 'end'; };
let simT = 0;
const EVT = {}; const ev = (k) => { EVT[k] = (EVT[k] || 0) + 1; };   // event tally for validation tests
// local calibre of the efferent arteriole (narrowed to 0.72 outside the capsule, widening again where it joins the peritubular
// capillaries; matches tools/nephron_prep.mjs) so blood particles there are drawn small enough to stay inside its wall
const CAPS_C = [-332.5, 250.61, -73.92], CAPS_R = 103.79, F_EFF = 0.72;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const EFF_K = N_VES.eff.pts.map((q, i) => { const w = sstep(CAPS_R + 2, CAPS_R + 22, Math.hypot(q[0] - CAPS_C[0], q[1] - CAPS_C[1], q[2] - CAPS_C[2])) * (1 - sstep(0.88, 1, N_VES.eff.arc[i] / N_VES.eff.arc[N_VES.eff.arc.length - 1])); return 1 + (F_EFF - 1) * w; });
function effK(s) { const A = N_VES.eff.arc; let lo = 0, hi = A.length - 1; if (s <= 0) return EFF_K[0]; if (s >= A[hi]) return EFF_K[hi]; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (A[m] <= s) lo = m; else hi = m; } return EFF_K[lo]; }
const posOf = (p, out) => {
  PATHS[p.path].sample(p.s, out);
  const wob = 1 + 0.12 * Math.sin(simT * 1.3 + p.th * 3);                 // gentle drift within the lumen
  const r = (p.path === 'tub' ? p.r : p.r * VLUMEN / LUMEN * (p.path === 'eff' ? effK(p.s) * effDyn(p.s) : 1)) * wob, th = p.th + 0.35 * Math.sin(simT * 0.7 + p.r);
  return out.addScaledVector(_n, Math.cos(th) * r).addScaledVector(_b, Math.sin(th) * r);
};
const BLOOD_MIX = [['water', 0.42], ['na', 0.14], ['cl', 0.13], ['k', 0.05], ['hco3', 0.07], ['glu', 0.08], ['urea', 0.07], ['rbc', 0.04]];
function pick(mix) { let r = Math.random(), acc = 0; for (const [t, w] of mix) { acc += w; if (r < acc) return t; } return mix[0][0]; }
function spawnBlood() {
  if (parts.length >= MAXP) return;
  const type = pick(BLOOD_MIX);
  parts.push({ type, path: 'aff', s: Math.random() * 8, th: Math.random() * 6.283, r: Math.random() * LUMEN * 0.6, state: 'move', k: 0, seg: null, exitAt: -1 });
}
const XST = {};
let LOOP_C = null;   // centre-line points of the two limbs, for the crossing check
function crossesLoop(a, b) {
  if (!LOOP_C) LOOP_C = { desc: N_PATH.pts.filter((_, j) => N_PATH.arc[j] >= 960 && N_PATH.arc[j] <= 1230).map((q) => new THREE.Vector3(...q)), asc: N_PATH.pts.filter((_, j) => N_PATH.arc[j] >= 1260 && N_PATH.arc[j] <= 1590).map((q) => new THREE.Vector3(...q)) };
  const v = new THREE.Vector3(), hit = [];
  for (const [k, pts] of Object.entries(LOOP_C)) { if (pts.some((q) => q.distanceTo(a) < 16 || q.distanceTo(b) < 16)) continue;   // its own source or destination limb
    for (let f = 0.15; f <= 0.85; f += 0.07) { v.lerpVectors(a, b, f); if (pts.some((q) => q.distanceTo(v) < 12)) { hit.push(k); break; } } }
  return hit;
}   // transfer statistics for validation tests: distance and speed of every crossing
function startXfer(p, from, to, then) { p.state = 'xfer'; p.k = 0; p.from = from.clone(); p.to = to.clone(); p.then = then; p.xkey = p.type + '|' + (p.state0 || p.path || '?') + ' → ' + (then.inter ? 'interstitium' : then.fade ? 'fade' : then.path); }
function stepParticles(dt) {
  simT += dt;
  spawnAcc += dt * 32; while (spawnAcc > 1) { spawnAcc--; spawnBlood(); }
  vrAcc += dt * 4.5; while (vrAcc > 1) { vrAcc--; spawnVR(); }
  // secretion: from the nearest capillary into the tubule
  for (const [sg, rates] of Object.entries(SECRETE)) for (const [type, rate] of Object.entries(rates)) {
    const key = sg + type; secAcc[key] = (secAcc[key] || 0) + dt * rate;
    while (secAcc[key] > 1 && parts.length < MAXP) {
      secAcc[key]--; const [a, b] = SEG_RANGE[sg]; ev(type + '|' + sg + '|secreted into tubule');
      const p = { type, path: 'tub', s: buildParticlePath.fromArc(a + Math.random() * (b - a)), th: Math.random() * 6.283, r: Math.random() * LUMEN * 0.6, state: 'move', k: 0, seg: sg, exitAt: -1, secreted: true };
      const dest = posOf(p, new THREE.Vector3()), src = nearestXfer(dest);
      startXfer(p, src ? src.p : dest.clone().addScaledVector(_n, LUMEN * 2.6), dest, { path: 'tub', s: p.s }); parts.push(p);
    }
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.state === 'move') {
      if (p.path === 'aff') {
        p.s += V_BLOOD * dt;
        if (p.s >= PATHS.aff.len) { // in the glomerulus: filtered or not
          if (!BLOOD_ONLY[p.type] && Math.random() < FILT) { p.path = 'tub'; p.s = 0; p.seg = null; ev(p.type + '|glomerulus|filtered into capsule'); } else { p.path = 'eff'; p.s = 0; ev(p.type + '|glomerulus|stayed in blood → efferent'); }
        }
      } else if (p.path === 'eff') {
        p.s += V_BLOOD * dt; if (p.s >= PATHS.eff.len) { parts.splice(i, 1); continue; }
      } else if (p.path === 'vr') {
        if (!stepVR(p, dt)) { parts.splice(i, 1); continue; }
      } else {
        p.s += V_TUB * (p.seg === 'desc' || p.seg === 'asc' || p.seg === 'cd' ? LOOP_SLOW : 1) * dt;   // little volume is left by then, so the flow is slow
        const arc = buildParticlePath.toArc(p.s), sg = segOf(arc);
        if (sg === 'end') { ev(p.type + '|urine|left in urine'); parts.splice(i, 1); continue; }
        if (sg !== p.seg) { // entering a new segment: decide once whether this particle is reabsorbed here
          p.seg = sg; p.exitAt = -1;
          const pr = p.secreted || (p.recycled && sg !== 'cd') ? 0 : (REABS[sg] || {})[p.type] || 0;
          if (Math.random() < pr) { const [a, b] = SEG_RANGE[sg]; p.exitAt = buildParticlePath.fromArc(Math.max(arc, a) + Math.random() * (b - Math.max(arc, a)) * 0.9); }
        }
        if (p.exitAt > 0 && p.s >= p.exitAt) { // reabsorbed: through the wall into the nearest capillary
          const from = posOf(p, new THREE.Vector3()), dst = nearestXfer(from);
          // urea leaves the collecting duct only into the medullary interstitium (the cortical part is impermeable to it):
          // still in the cortex, so the exit point moves further down the duct
          if (sg === 'cd' && p.type === 'urea' && from.y > Y_TOP) { p.exitAt = buildParticlePath.fromArc(arc + Math.random() * (SEG_RANGE.cd[1] - arc) * 0.9); continue; }
          ev(p.type + '|' + sg + '|reabsorbed' + (from.y <= Y_TOP ? ' (medulla)' : ''));
          if (medullaExit(p, from, sg)) continue;
          if (dst) startXfer(p, from, dst.p, dst.arc !== null ? { path: 'eff', s: dst.arc } : { fade: true });
          else { startXfer(p, from, from.clone().addScaledVector(_n, LUMEN * 2.6), { fade: true }); }
        }
      }
    } else if (p.state === 'xfer') {
      p.k += dt / ((p.dur || 1.2) * (p.type === 'urea' ? UREA_SLOW : 1));   // urea moves passively: a slower crossing
      if (p.k >= 1) { const t = p.then; { const d = p.from.distanceTo(p.to), T = (p.dur || 1.2) * (p.type === 'urea' ? UREA_SLOW : 1), x = (XST[p.xkey] ||= { n: 0, dmax: 0, vmax: 0, fast: 0, cross: 0 }); x.n++; if (p.to.y < Y_TOP + 20 && crossesLoop(p.from, p.to).length) x.cross++; x.dmax = Math.max(x.dmax, d); x.vmax = Math.max(x.vmax, d / T); if (d / T > 120) x.fast++; } p.dur = 0;
        if (t.inter) { p.state = 'inter'; p.ipos = p.to.clone(); p.next = t.next; p.dwell = t.dwell; p.k = 0; }
        else if (t.fade) { p.state = 'fade'; p.k = 0; }
        else { p.state = 'move'; p.path = t.path; p.s = t.s; p.seg = t.path === 'tub' ? segOf(buildParticlePath.toArc(t.s)) : null; if (t.path === 'vr') p.vrExit = undefined; } }
    } else if (p.state === 'inter') { p.k += dt; if (p.k >= p.dwell) leaveInter(p);
    } else if (p.state === 'fade') { p.k += dt / 0.8; if (p.k >= 1) { parts.splice(i, 1); continue; } }
  }
}
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s3 = new THREE.Vector3(), _c = new THREE.Color();
const BLOOD_SC = 0.55;
const LOOP_SLOW = 0.45;   // filtrate speed in Henle's loop relative to the rest of the tubule
const UREA_SLOW = 2.6;   // urea crosses by passive diffusion: slower, wandering, no pull
// particles grow in where blood enters the scene and shrink away where a vessel or the duct leaves it, instead of blinking
function edgeK(p) {
  let k = 1;
  if (p.path === 'aff' || p.path === 'vr') k = p.s / 12;
  if (p.path === 'eff' || p.path === 'vr') k = Math.min(k, (PATHS[p.path].len - p.s) / 18);
  else if (p.path === 'tub') k = (SEG_RANGE.cd[1] - buildParticlePath.toArc(p.s)) / 18;
  return Math.max(0, Math.min(1, k));
}
function drawParticles() {
  nSwarm.begin();
  if (interPlane && interPlane.visible) for (const a of AMB) { _p.copy(a.base).add(_s3.set(Math.sin(simT * 0.9 + a.th * 4) * 3, Math.sin(simT * 0.7 + a.r) * 3, Math.cos(simT * 0.8 + a.th) * 3)); nSwarm.put(a.type, _p, spinOf(a, simT, _q), 0.75); }
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]; let sc;
    if (p.state === 'move') { posOf(p, _p); sc = (p.path === 'tub' ? 1 : BLOOD_SC * (p.path === 'eff' ? effK(p.s) * effDyn(p.s) : 1)) * edgeK(p); }
    else if (p.state === 'xfer') { const e = p.type === 'urea' ? p.k : p.k * p.k * (3 - 2 * p.k); _p.lerpVectors(p.from, p.to, e);
      if (p.type === 'urea') { const a = 3.2 * Math.sin(Math.PI * p.k); _p.add(_s3.set(Math.sin(simT * 4.1 + p.th * 7) * a, Math.sin(simT * 3.4 + p.r * 3) * a, Math.cos(simT * 3.8 + p.th * 3) * a)); }   /* random-walk wander */
      const intoBlood = !(p.then.path === 'tub'); sc = intoBlood ? 1 - (1 - BLOOD_SC) * e : BLOOD_SC + (1 - BLOOD_SC) * e; }
    else if (p.state === 'inter') { _p.copy(p.ipos).add(_s3.set(Math.sin(simT * 1.7 + p.th * 5) * 2.2, Math.sin(simT * 1.3 + p.r) * 2.2, Math.cos(simT * 1.5 + p.th) * 2.2)); sc = 0.8; }
    else { _p.copy(p.to); sc = BLOOD_SC * (1 - p.k); }
    nSwarm.put(p.type, _p, spinOf(p, simT, _q), sc);
  }
  nSwarm.end();
}

/* --- magnified PCT cells: reabsorption across the brush-border epithelium --- */
// Geometry of the inset (model units): three cells, microvilli on the lower (lumen) side, capillary drawn along the top.
const CELLS = [
  { key: 'cell_left', x: -155, ap: 408, ba: 458, nuc: [-160, 428.5, -66.5] },
  { key: 'cell_middle', x: -110, ap: 415, ba: 462, nuc: [-110, 446, -61.5] },
  { key: 'cell_right', x: -63, ap: 407, ba: 457, nuc: [-56.5, 433, -62.5] },
];
const C_Z = -62, C_LUMEN_Y = 383, C_CAP_Y = 471, C_X0 = -183, C_X1 = -33;
const C_UPTAKE = { na: 0.75, cl: 0.7, k: 0.6, glu: 0.95, hco3: 0.85, water: 0.6, urea: 0 };
const LUMEN_MIX = [['water', 0.34], ['na', 0.16], ['cl', 0.15], ['k', 0.05], ['hco3', 0.09], ['glu', 0.1], ['urea', 0.11]];
let cSwarm = null, cT = 0;
let cellMode = false, cMesh = null, capTube = null; const cParts = []; let cSpawn = 0, cSec = 0;
const cellMats = {}; const cellGlow = { cell_left: 0, cell_middle: 0, cell_right: 0 };
function initCells() {
  cSwarm = makeSwarm(nInner, 200); cMesh = cSwarm.group; cMesh.visible = false; makePulses();
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(C_X0, C_CAP_Y + 1, C_Z), new THREE.Vector3(-120, C_CAP_Y - 1, C_Z - 2), new THREE.Vector3(-70, C_CAP_Y + 1, C_Z + 2), new THREE.Vector3(C_X1, C_CAP_Y, C_Z)]);
  capTube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 4.6, 12, false), new THREE.MeshPhysicalMaterial({ color: 0xc8243c, transparent: true, opacity: 0.4, depthWrite: false, roughness: 0.4 }));
  capTube.visible = false; capTube.renderOrder = 9; nInner.add(capTube);
  // one material per cell so each can glow on its own; see-through so particles show inside
  for (const m of nMesh.cel) { const c = CELLS.find((c) => m.name.startsWith(c.key)); if (!c) continue;
    if (!cellMats[c.key]) { cellMats[c.key] = m.material.clone(); cellMats[c.key].depthWrite = false; cellMats[c.key].emissive = new THREE.Color(0); }
    m.material = cellMats[c.key]; }
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function cellRoute(c, z, up) { // used for secretion (blood -> cell -> lumen)
  const side = c.nuc[0] + (Math.random() < 0.5 ? -13 : 13);
  const r = [[c.x, C_LUMEN_Y, z], [c.x, c.ap - 10, z], [c.x, c.ap, z], [side, c.nuc[1], z], [c.x, c.ba, z], [c.x, C_CAP_Y, z]];
  return up ? r : r.reverse();
}
// Uptake is shown as suction: the particle is caught near the brush border, accelerates to one microvillus tip (stretching along
// the pull), a ring pulses at the tip, it shoots up the microvillus, then diffuses slowly through the cytoplasm to the base.
const TIP_DROP = 17;                                   // microvillus tips sit this far below the apical surface
let pulses = [];
function makePulses() {
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.42, 6, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    m.visible = false; m.renderOrder = 10; cMesh.add(m); pulses.push({ m, t: 1 });
  }
}
function firePulse(x, y, z, hex) { const p = pulses.find((q) => q.t >= 1) || pulses[0]; p.t = 0; p.m.position.set(x, y, z); p.m.material.color.setHex(hex); p.m.visible = true; }
function cSpawnLumen() {
  const type = pick(LUMEN_MIX);
  const p = { type, st: 'lumen', x: C_X0, y: C_LUMEN_Y + (Math.random() - 0.5) * 7, z: C_Z + (Math.random() - 0.5) * 30, k: 0, cell: null, catchX: null, drift: 0 };
  if (Math.random() < (C_UPTAKE[type] || 0)) {
    const c = CELLS[Math.floor(Math.random() * 3)]; p.cell = c;
    p.tip = [c.x + (Math.random() - 0.5) * 30, c.ap - TIP_DROP, C_Z + (Math.random() - 0.5) * 16];   // one microvillus tip
    p.catchX = p.tip[0] - 22 - Math.random() * 10;
  }
  cParts.push(p);
}
const ease = (t) => t * t * (3 - 2 * t);
function stepCells(dt) {
  cT += dt;
  cSpawn += dt * 7; while (cSpawn > 1 && cParts.length < 190) { cSpawn--; cSpawnLumen(); }
  cSec += dt * 0.3; while (cSec > 1 && cParts.length < 190) { cSec--; const c = CELLS[Math.floor(Math.random() * 3)]; // secretion: blood -> cell -> lumen
    cParts.push({ type: 'k', st: 'cross', k: 0, route: cellRoute(c, C_Z + (Math.random() - 0.5) * 14, false), cell: c, dir: -1 }); }
  for (let i = cParts.length - 1; i >= 0; i--) {
    const p = cParts[i];
    if (p.st === 'lumen') {
      p.x += 30 * dt;
      if (p.cell) { // within reach of the border: drift towards it before the pull takes over
        const reach = Math.max(0, 1 - Math.abs(p.catchX - p.x) / 40); p.drift = Math.max(p.drift, reach);
        p.y += (p.tip[1] - 6 - p.y) * p.drift * dt * 1.2; p.z += (p.tip[2] - p.z) * p.drift * dt * 1.2;
        if (p.x >= p.catchX) { p.st = 'pull'; p.k = 0; p.from = [p.x, p.y, p.z]; }
      }
      if (p.x > C_X1) { cParts.splice(i, 1); continue; }
    } else if (p.st === 'pull') {           // accelerating suction to the microvillus tip
      p.k += dt / 0.75;
      if (p.k >= 1) { p.st = 'channel'; p.k = 0; firePulse(p.tip[0], p.tip[1], p.tip[2], P_TYPES[p.type].c); cellGlow[p.cell.key] = Math.min(1, cellGlow[p.cell.key] + 0.3); }
    } else if (p.st === 'channel') {        // fast up the microvillus into the cell
      p.k += dt / 0.35;
      if (p.k >= 1) {
        const c = p.cell, z = p.tip[2], side = c.nuc[0] + (p.tip[0] < c.nuc[0] ? -14 : 14);
        p.route = [[p.tip[0], c.ap + 2, z], [(p.tip[0] + side) / 2, (c.ap + c.nuc[1]) / 2, z + (Math.random() - 0.5) * 6], [side, c.nuc[1], z], [c.x + (Math.random() - 0.5) * 12, c.ba - 2, z], [c.x, C_CAP_Y, C_Z]];
        p.st = 'cross'; p.k = 0; p.dir = 1;
      }
    } else if (p.st === 'cross') {
      p.k += dt / (p.dir > 0 ? 3.0 : 2.6);
      if (p.k >= 1) { const end = p.route[p.route.length - 1]; if (p.dir > 0) { p.st = 'blood'; p.x = end[0]; p.y = end[1]; p.z = end[2]; } else { p.st = 'lumen'; p.cell = null; p.x = end[0]; p.y = end[1]; p.z = end[2]; } }
    } else if (p.st === 'blood') { p.x += 46 * dt; if (p.x > C_X1) { cParts.splice(i, 1); continue; } }
  }
  for (const k in cellGlow) cellGlow[k] = Math.max(0, cellGlow[k] - dt * 0.9);
  for (const q of pulses) if (q.t < 1) { q.t = Math.min(1, q.t + dt / 0.55); const e = ease(q.t); q.m.scale.setScalar(0.5 + 1.6 * e); q.m.material.opacity = 0.85 * (1 - e); if (q.t >= 1) q.m.visible = false; }
}
function routeAt(route, k) { const n = route.length - 1, f = Math.min(0.9999, k) * n, i = Math.floor(f), t = f - i; const e = t * t * (3 - 2 * t); return lerp3(route[i], route[i + 1], e); }
const _dir = new THREE.Vector3(), _xA = new THREE.Vector3(1, 0, 0), _sv = new THREE.Vector3();
function drawCells() {
  cSwarm.begin();
  for (const p of cParts) {
    let q, stretch = 0;
    if (p.st === 'pull') {
      const e = Math.pow(p.k, 2.4);                                  // slow at first, then snapped in
      const mid = [(p.from[0] + p.tip[0]) / 2 + 6, Math.min(p.from[1], p.tip[1]) - 2, (p.from[2] + p.tip[2]) / 2];
      const a = lerp3(p.from, mid, e), b = lerp3(mid, p.tip, e); q = lerp3(a, b, e);
      _dir.set(p.tip[0] - q[0], p.tip[1] - q[1], p.tip[2] - q[2]); stretch = Math.min(1, e * 1.6);
    } else if (p.st === 'channel') {
      q = lerp3(p.tip, [p.tip[0], p.cell.ap + 2, p.tip[2]], ease(p.k)); _dir.set(0, 1, 0); stretch = 1 - p.k * 0.7;
    } else if (p.st === 'cross') {
      q = routeAt(p.route, p.k);
      if (p.dir > 0) { q[0] += Math.sin(cT * 2.3 + p.tip[0]) * 2.2; q[2] += Math.cos(cT * 1.9 + p.tip[2]) * 2.2; }  // diffusing in the cytoplasm
    } else q = [p.x, p.y + (p.st === 'lumen' ? Math.sin(cT * 1.6 + p.z) * 0.8 : 0), p.z];
    _p.set(q[0], q[1], q[2]);
    const base = p.st === 'blood' ? 0.75 : p.st === 'cross' && p.dir > 0 ? 0.72 : 0.85;
    if (stretch > 0 && _dir.lengthSq() > 1e-6) { // squash-and-stretch along the pull
      _q.setFromUnitVectors(_xA, _dir.normalize());
      cSwarm.putS(p.type, _p, _q, _sv.set(base * (1 + 0.75 * stretch), base * (1 - 0.3 * stretch), base * (1 - 0.3 * stretch)));
    } else cSwarm.put(p.type, _p, spinOf(p, cT, _q), base);
  }
  cSwarm.end();
  for (const [k, m] of Object.entries(cellMats)) m.emissive.setRGB(0.55 * cellGlow[k], 0.32 * cellGlow[k], 0.7 * cellGlow[k]);
}
function setCellMode(on) {
  if (!cMesh) return; cellMode = on; cMesh.visible = on; capTube.visible = on;
  if (on && cParts.length === 0) for (let i = 0; i < 80; i++) stepCells(0.1);
  if (!on) for (const m of Object.values(cellMats)) m.emissive.setHex(0);
}

function setVesselXray(on) {
  [...nMesh.art, ...nMesh.ven].forEach((m) => { m.material.transparent = on; m.material.opacity = on ? 0.38 : 1; m.material.depthWrite = !on; m.material.needsUpdate = true; m.renderOrder = on ? 6 : 0; });
}
async function ensureN() {
  if (nRoot) return;
  if (!nLoading) nLoading = (async () => {
    const g = await loadAsset('neph', stageProg, 0.05, 0.8); if (stageProg) { stageProg.phase(0.8, 0.98, 'Preparing…'); await nextFrame(); }
    nInner = new THREE.Group(); nInner.add(g.scene); nInner.position.copy(N_CENTRE).negate();
    const sc = new THREE.Group(); sc.scale.setScalar(N_SCALE); sc.add(nInner);
    nRoot = new THREE.Group(); nRoot.position.set(0, 1, 0); nRoot.add(sc); nRoot.visible = false; scene.add(nRoot);
    g.scene.traverse((o) => {
      if (!o.isMesh) return; const n = o.name;
      if (o.geometry.attributes._s) { o.material = tubuleMat(); o.renderOrder = 5; nMesh.tub.push(o); }
      else if (n.startsWith('capillary_artery')) { o.material = new THREE.MeshPhysicalMaterial({ color: 0xc8243c, roughness: 0.4, clearcoat: 0.3 }); nMesh.art.push(o); }
      else if (n.startsWith('capillary_vein')) { o.material = new THREE.MeshPhysicalMaterial({ color: 0x3340c8, roughness: 0.45, clearcoat: 0.3 }); nMesh.ven.push(o); }   // colour set here: its WebP texture shows white in viewers without WebP support
      else if (n.startsWith('podocytes')) { o.material = new THREE.MeshPhysicalMaterial({ color: 0xe6dcf5, roughness: 0.5, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }); o.renderOrder = 7; nMesh.pod = [o]; }
      else { nMesh.cel.push(o); if (o.material.transparent) o.renderOrder = 8; }
    });
    buildParticlePath(); makeParticles(); initCells();
    nRoot.updateMatrixWorld(true);
    // anchors (model coordinates); tubule ones sit on the centre line, nudged towards the viewer
    const loc = {};
    for (const h of N_HOTSPOTS) {
      if (h.p) loc[h.id] = new THREE.Vector3(...h.p);
      else if (N_FIXED[h.id]) loc[h.id] = new THREE.Vector3(...N_FIXED[h.id]);
      else if (h.arc) loc[h.id] = centreAtArc(h.arc).add(new THREE.Vector3(0, 0, 11));
      else if (h.near) { // nearest vertex of a vessel to a point on the tubule
        const target = centreAtArc(h.near[1]); let best = null, bd = 1e18; const v = new THREE.Vector3();
        for (const m of nMesh[h.near[0]]) { const pa = m.geometry.attributes.position; for (let i = 0; i < pa.count; i += 2) { v.fromBufferAttribute(pa, i).applyMatrix4(m.matrix); const d = v.distanceToSquared(target); if (d < bd) { bd = d; best = v.clone(); } } }
        loc[h.id] = best;
      }
    }
    for (const h of N_HOTSPOTS) nAnchors[h.id] = nInner.localToWorld(loc[h.id].clone());
    for (const h of N_HOTSPOTS) {
      const b = document.createElement('button');
      b.className = 'hs ls' + (h.cls ? ' ' + h.cls : '') + (h.cell || h.capd ? ' mini' : '');
      b.innerHTML = h.cell || h.capd ? `<span class="tag">${h.label}</span>` : `<span class="dot">${h.n}</span><span class="tag">${h.label}</span>`;
      b.setAttribute('aria-label', h.label); b.setAttribute('aria-pressed', 'false');
      bubbleTap(b, () => selectN(h.cell ? 'cells' : h.capd ? 'capsule' : h.id));
      hsLayer.appendChild(b); nEls.push({ a: h, el: b });
    }
  })();
  await nLoading;
}
function placeN() {
  placeOTags();
  const w = renderer.domElement.clientWidth, hgt = renderer.domElement.clientHeight;
  mid.copy(nRoot.position).project(camera);
  for (const { a, el } of nEls) {
    const p = nAnchors[a.id]; if (!p) continue;
    const show = stage === 4 && nMode === 'structure' && !(a.layer && layers[a.layer] === false) && camera.position.z - nRoot.position.z > 0 && (cellMode ? (a.cell || a.id === 'cells') && a.id !== 'cells' : !a.cell) && (!a.capd || nSel === 'capsule') && !(a.id === 'glomerulus' && nSel === 'capsule');
    tmp.copy(p).project(camera);
    el.classList.toggle('hidden', !show || tmp.z > 1);
    if (!show) continue;
    const left = a.id === 'cells' ? true : a.side ? a.side === 'left' : tmp.x < mid.x;
    el.classList.toggle('left', left);
    el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * hgt}px) translate(${left ? '-100%' : '0'}, -50%) translate(${left ? '13px' : '-13px'}, 0)`;
  }
}
function highlight(id) {
  const r = SEG_RANGE[id];
  tubU.uA.value = r ? r[0] : -1; tubU.uB.value = r ? r[1] : -1;
  [...nMesh.art, ...nMesh.ven].forEach((m) => m.material.emissive && m.material.emissive.setHex(0));
  const ves = { afferent: 'art', efferent: 'art', peritubular: 'art', glomerulus: 'art', vasarecta: 'ven' }[id];
  if (ves) nMesh[ves].forEach((m) => m.material.emissive && m.material.emissive.setHex(0x331008));
  nMesh.pod.forEach((m) => m.material.emissive.setHex(id === 'capsule' ? 0x2a2040 : 0));
}
const ISO_SHORT = { water: 'H₂O', na: 'Na⁺', k: 'K⁺', cl: 'Cl⁻', hco3: 'HCO₃⁻', glu: 'Glucose', urea: 'Urea', rbc: 'RBC' };
const EYE_SVG = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M2.5 12s3.4-6.5 9.5-6.5S21.5 12 21.5 12s-3.4 6.5-9.5 6.5S2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
function legendHTML() {
  return `<div class="legend-h"><div><b>Follow a substance</b><small>Tap one · hold to add up to ${ISO_MAX}</small></div><button class="iso-all" data-iso="" aria-label="Show all substances" title="Show all" ${isoSel.length ? '' : 'disabled'}>${EYE_SVG}</button></div>
  <div class="legend${isoSel.length ? ' has-sel' : ''}">${Object.entries(P_TYPES).map(([k, p]) => `<button class="iso" data-iso="${k}" aria-pressed="${isoSel.includes(k)}" aria-label="${p.t}" title="${p.t}"><i style="background:#${p.c.toString(16).padStart(6, '0')}"></i>${ISO_SHORT[k] || p.t}</button>`).join('')}</div>`;
}
function renderIsoChips() {
  card.querySelectorAll('.iso').forEach((b) => b.setAttribute('aria-pressed', String(isoSel.includes(b.dataset.iso))));
  const all = card.querySelector('.iso-all'); if (all) all.disabled = !isoSel.length;
  const lg = card.querySelector('.legend'); if (lg) lg.classList.toggle('has-sel', isoSel.length > 0);
}
function renderNCard() {
  const tabs = `<div class="tabs" role="tablist"><button role="tab" aria-selected="${nMode === 'structure'}" data-nmode="structure">Structure</button><button role="tab" aria-selected="${nMode === 'formation'}" data-nmode="formation">Urine formation</button><button role="tab" aria-selected="${nMode === 'regulation'}" data-nmode="regulation">Regulation</button></div>`;
  let html = '';
  if (nMode === 'structure') {
    const d = N_INFO[nSel || 'overview'];
    html += `<div class="eyebrow"><span>${d.eyebrow}</span><em>${d.tag}</em></div>${tabs}<h2>${d.title}</h2>`;
    if (d.lead) html += `<p>${d.lead}</p>`;
    if (d.facts) html += `<ul>${d.facts.map((f) => `<li>${f}</li>`).join('')}</ul>`;
    if (d.metrics) html += `<div class="metrics">${d.metrics.map(([b, t]) => `<div class="metric"><b>${b}</b><span>${t}</span></div>`).join('')}</div>`;
    if (d.legend) html += legendHTML();
    if (d.note) html += `<p class="note">${d.note}</p>`;
    html += `<div class="actions">${nSel ? '<button class="btn ghost" data-ngo="">Nephron overview</button>' : '<button class="btn" data-nmode="formation">Watch urine formation</button>'}<button class="btn ghost" data-stage="3">Back to Stage 3</button></div>`;
  } else if (nMode === 'regulation') {
    html += regHTML(tabs);
  } else {
    const s = N_TOUR[nStep];
    html += `<div class="eyebrow"><span>Stage 4</span><em>Urine formation</em></div>${tabs}`;
    html += `<div class="steps">${N_TOUR.map((x, i) => `<button data-nstep="${i}" aria-current="${i === nStep}">${i + 1}</button>`).join('')}</div>`;
    html += `<h2>${s.title}</h2><ul>${s.facts.map((f) => `<li>${f}</li>`).join('')}</ul>`;
    if (s.metrics) html += `<div class="metrics">${s.metrics.map(([b, t]) => `<div class="metric"><b>${b}</b><span>${t}</span></div>`).join('')}</div>`;
    html += legendHTML() + `<p class="note">Shapes are simplified models, not to scale; particle numbers are illustrative. Blood flows inside the arterioles and capillaries; reabsorbed particles cross the tubule wall into the nearest capillary.</p>`;
    html += `<div class="actions">${nStep > 0 ? '<button class="btn ghost" data-nstep="' + (nStep - 1) + '">Previous</button>' : ''}${nStep < N_TOUR.length - 1 ? '<button class="btn ghost" data-nstep="' + (nStep + 1) + '">Next step</button>' : ''}</div>`;
  }
  card.innerHTML = html;
  card.querySelectorAll('[data-nmode]').forEach((b) => onTap(b, () => setNMode(b.dataset.nmode)));
  card.querySelectorAll('[data-ngo]').forEach((b) => onTap(b, () => selectN(null)));
  card.querySelectorAll('[data-nstep]').forEach((b) => onTap(b, () => goStep(+b.dataset.nstep)));
  card.querySelectorAll('[data-nplay]').forEach((b) => onTap(b, () => setPlaying(!nPlaying)));
  card.querySelectorAll('[data-rtab]').forEach((b) => onTap(b, () => { REG.tab = b.dataset.rtab; goReg(); }));
  card.querySelectorAll('[data-rreset]').forEach((b) => onTap(b, () => { REG.fluid = 0.5; REG.bp = 0.5; goReg(); }));
  const ri = card.querySelector('#reg-in');
  if (ri) ri.addEventListener('input', () => { let v = +ri.value; if (Math.abs(v - 50) < 4) v = 50; REG[REG.tab === 'adh' ? 'fluid' : 'bp'] = v / 100; applyReg(); $('#reg-live').innerHTML = regLiveHTML(); armCardTimer(); });
  card.querySelectorAll('[data-iso]').forEach((b) => onTap(b, () => setIso(!b.dataset.iso || (isoSel.length === 1 && isoSel[0] === b.dataset.iso) ? null : b.dataset.iso), () => addIso(b.dataset.iso)));
  card.querySelectorAll('[data-stage]').forEach((b) => onTap(b, () => enterStage(+b.dataset.stage)));
}
function setNMode(m) {
  CALLS.push('setNMode ' + m + ' @' + Math.round(performance.now()));
  nMode = m; if (m !== 'structure') setCellMode(false);
  const xr = m !== 'structure'; applyReg();
  nMesh.tub.forEach((t) => { t.material.opacity = xr ? 0.32 : 1; t.material.depthWrite = !xr; t.material.needsUpdate = true; });
  pMesh.visible = xr; setVesselXray(xr); nMesh.pod.forEach((m) => (m.material.opacity = xr ? 0.18 : 0.38)); if (interPlane) interPlane.visible = false;
  if (xr && parts.length === 0) for (let i = 0; i < 650; i++) stepParticles(0.1); // pre-fill vessels and tubule with a running stream
  if (xr) { nSel = null; nEls.forEach(({ el }) => el.setAttribute('aria-pressed', 'false')); if (m === 'regulation') goReg(); else goStep(nStep); }
  else { highlight(null); renderNCard(); flyTo(nView('front')); oTags.forEach((o) => (o.el.hidden = true)); }
}
const CALLS = [];   // call trace for tests
const PERF = { sim: 0 };   // average milliseconds per frame spent moving and drawing particles
function goStep(i) {
  CALLS.push('goStep ' + i + ' @' + Math.round(performance.now())); if (CALLS.length > 40) CALLS.shift();
  nStep = i; const s = N_TOUR[i]; highlight(s.seg); renderNCard(); if (interPlane) interPlane.visible = !!s.medulla;
  const [a, b] = SEG_RANGE[s.seg];
  // frame the whole segment: centre of its centre-line points
  const pts = N_PATH.pts.filter((_, j) => N_PATH.arc[j] >= a && N_PATH.arc[j] <= b).map((p) => new THREE.Vector3(...p));
  if (s.focus === 'glomerulus') pts.push(new THREE.Vector3(...N_FIXED.glomerulus));
  if (s.vr) N_VR.dvr.pts.concat(N_VR.avr.pts).forEach((p) => pts.push(new THREE.Vector3(...p)));
  const bx = new THREE.Box3().setFromPoints(pts); const c = nInner.localToWorld(bx.getCenter(new THREE.Vector3()));
  const size = bx.getSize(new THREE.Vector3()).length() * N_SCALE;
  flyTo({ target: c, pos: c.clone().add(new THREE.Vector3(0.04, 0.02, Math.max(0.2, size * (s.vr ? 2.0 : s.id === 'cd' ? 2.1 : 1.5)))) });   // the whole duct, DCT to papilla
}
function selectN(id) {
  nSel = id; setCellMode(id === 'cells' && nMode === 'structure'); nEls.forEach(({ a, el }) => el.setAttribute('aria-pressed', String(a.id === id)));
  highlight(id); renderNCard();
  if (!id) return flyTo(nView('front'));
  if (id === 'cells') { const c = nInner.localToWorld(new THREE.Vector3(-108, 425, -62)); return flyTo({ target: c, pos: c.clone().add(new THREE.Vector3(0.0, 0.004, camera.aspect < 1 ? 0.165 : 0.125)) }); }
  const t = nAnchors[id].clone();
  flyTo({ target: t, pos: t.clone().add(new THREE.Vector3(0.03, 0.02, 0.26)) });
}
function nView(which) {
  const c = nRoot.position;
  if (which === 'back') return { target: c.clone(), pos: c.clone().add(new THREE.Vector3(0, 0.05, -0.95)) };
  if (which === 'side') return { target: c.clone(), pos: c.clone().add(new THREE.Vector3(0.9, 0.08, 0.25)) };
  // the card covers the right of the screen, so aim right of centre to keep the collecting duct in view
  const k = camera.aspect >= 1 ? 1 : 0;
  return { target: c.clone().add(new THREE.Vector3(0.1 * k, -0.01, 0)), pos: c.clone().add(new THREE.Vector3(0.12 * k, 0.06, 1.02)) };
}
function setPlaying(on) {
  nPlaying = on; const f = $('#playfab'); f.classList.toggle('paused', !on);
  f.title = on ? 'Pause' : 'Play'; f.setAttribute('aria-label', on ? 'Pause animation' : 'Play animation');
}
function syncPlayFab() { $('#playfab').hidden = !(stage === 4 && (nMode !== 'structure' || cellMode)); }
onTap($('#playfab'), () => setPlaying(!nPlaying));
function tickN(dt, t) {
  syncPlayFab();
  if (!nRoot || stage !== 4) return;
  tubU.uT.value = t;
  const tq0 = performance.now(); if (nMode !== 'structure') { if (nPlaying) stepParticles(dt); drawParticles(); } PERF.sim = PERF.sim * 0.95 + (performance.now() - tq0) * 0.05;
  if (cellMode) { if (nPlaying) stepCells(dt); drawCells(); }
  if (nMode !== 'structure' || cellMode) stepIso(dt);
  stepJGA(nPlaying ? dt : 0, t); stepVaso(dt);
  const cdT = nMode === 'formation' && N_TOUR[nStep].id === 'cd' ? 0.9 : nMode === 'regulation' && REG.tab === 'adh' ? 0.12 + 0.88 * regState().adh : 0;
  tubU.uCD.value += (cdT - tubU.uCD.value) * Math.min(1, dt * 3);
}

/* ================= stage switching ================= */
const HINTS = { 4: 'Tap a numbered dot · long-press a dot to see through it · Urine formation tab plays the animation', 1: 'Hold ♂ or ♀ for 5 seconds to explore a body · tap an organ to read about it · drag to rotate', 2: 'Tap a numbered dot · long-press a dot to see through it · Back view shows the outer surface', 3: 'A = arterial blood · V = venous blood · U = urine route · pulses show the direction of flow' };
const STAGE_LAYERS = { 1: ['skin', 'bone', 'adr', 'lab'], 2: ['adr', 'lab'], 3: ['art', 'ven', 'col', 'flow', 'lab'], 4: ['ves', 'cel', 'lab'] };
function syncChrome() {
  ['st1', 'st2', 'st3', 'st4'].forEach((id, i) => { const b = $('#' + id); if (i + 1 === stage) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  ['skin', 'bone', 'adr', 'lab', 'art', 'ven', 'col', 'flow', 'ves', 'cel'].forEach((k) => ($('#ly-' + k).hidden = !STAGE_LAYERS[stage].includes(k)));
  $('.hint').textContent = HINTS[stage];
  controls.minDistance = stage === 1 ? 0.28 : stage === 4 ? 0.05 : 0.06; controls.maxDistance = stage === 1 ? 10 : stage === 4 ? 2.4 : 1.0;
  for (const x of ['m', 'f']) unitObjs[x].forEach((o) => (o.visible = stage === 1 && (focus === null || focus === x)));
  if (lsRoot) lsRoot.visible = stage === 2;
  if (vRoot) vRoot.visible = stage === 3;
  if (nRoot) nRoot.visible = stage === 4;
  if (stage !== 1) hsEls.forEach(({ el }) => el.classList.add('hidden'));
  if (stage !== 2) lsEls.forEach(({ el }) => el.classList.add('hidden'));
  if (stage !== 3) vEls.forEach(({ el }) => el.classList.add('hidden'));
  if (stage !== 4) { nEls.forEach(({ el }) => el.classList.add('hidden')); oTags.forEach((o) => (o.el.hidden = true)); }
}
async function enterStage(n, side) {
  CALLS.push('enterStage ' + n + ' @' + Math.round(performance.now()));
  const prev = stage;
  if (prev === 1 && n !== 1) lastFocus = focus;
  if (n === 2) {
    card.innerHTML = '<div class="eyebrow"><span>Stage 2</span><em>Loading</em></div><h2>Kidney L.S.</h2><p class="note">Loading the section model…</p>';
    await stageLoad('Loading kidney L.S. model…', ensureLS, () => !!lsRoot);
    stage = 2; setLSSide(side || (prev === 3 ? vSide : lsSide)); syncChrome(); selectLS(null);
  } else if (n === 3) {
    card.innerHTML = '<div class="eyebrow"><span>Stage 3</span><em>Loading</em></div><h2>Blood supply and drainage</h2><p class="note">Loading the kidney model…</p>';
    await stageLoad('Loading kidney blood-vessel model…', ensureV, () => !!vRoot);
    stage = 3; setVSide(side || lsSide); syncChrome(); selectV(null);
  } else if (n === 4) {
    card.innerHTML = '<div class="eyebrow"><span>Stage 4</span><em>Loading</em></div><h2>The nephron</h2><p class="note">Loading the nephron model…</p>';
    await stageLoad('Loading nephron model…', ensureN, () => !!nRoot);
    stage = 4; syncChrome(); if (nMode !== 'structure') setNMode(nMode); else { setNMode('structure'); selectN(null); }
  } else {
    stage = 1; syncChrome(); focusUnit(lastFocus);
  }
}
onTap($('#st1'), () => stage !== 1 && enterStage(1));
onTap($('#st2'), () => stage !== 2 && enterStage(2));
onTap($('#st3'), () => stage !== 3 && enterStage(3));
onTap($('#st4'), () => stage !== 4 && enterStage(4));

/* ================= loop ================= */
function resize() { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  stepTween(dt); controls.update();
  flowUniforms.forEach((u) => (u.uTime.value = t));
  tickN(dt, t);
  if (stage === 3 && vSel) { const s = REDUCED ? 0.12 : 0.07 + 0.06 * Math.sin(t * 3.2); (vMesh[V_ROLE[vSel]] || []).forEach((m) => m.material.emissive.setRGB(s, s * 0.8, s * 0.5)); }
  if (stage === 1 && selected && struct[selected]) {
    const s = REDUCED ? 0.14 : 0.09 + 0.07 * Math.sin(t * 3.2);
    struct[selected].meshes.forEach((m) => { m.material.emissive.setRGB(1.0 * s, 0.7 * s, 0.3 * s); });
  }
  const tr0 = performance.now(); renderer.render(scene, camera); const tr1 = performance.now(); placeHotspots(); PERF.render = (PERF.render || 0) * 0.9 + (tr1 - tr0) * 0.1; PERF.hs = (PERF.hs || 0) * 0.9 + (performance.now() - tr1) * 0.1;
  requestAnimationFrame(loop);
}

/* ================= boot ================= */
resize();
{ const v0 = fitView(overviewView()); camera.position.copy(v0.pos); controls.target.copy(v0.target); }
const bootProg = makeProgress($('#lprog'), $('#lbar'), $('#lpct'), $('#lmsg'));
(async () => {
  const list = [['bodyM', 'Loading male body…'], ['bodyF', 'Loading female body…'], ['uri', 'Loading excretory system…']], tot = list.reduce((acc, [n]) => acc + assetSize(n), 0);
  const out = []; let a = 0;
  for (const [n, m] of list) { const w = 0.9 * assetSize(n) / tot; out.push(await loadAsset(n, bootProg, a, a + w, m)); a += w; }
  bootProg.phase(0.9, 1, 'Preparing the scene…'); await nextFrame();
  return out;
})().then(([bm, bf, uri]) => {
  // the male unit keeps the loaded urinary scene; the female unit gets a copy (geometry shared)
  const uriF = uri.scene.clone(true);
  buildUnit('m', bm, uri.scene);
  buildUnit('f', bf, uriF);
  makeHotspots();
  focusUnit(null);
  bootProg.finish('Ready'); setTimeout(() => { $('#loader').style.opacity = 0; setTimeout(() => $('#loader').remove(), 500); }, 300);
  window.RDX = { testAutoCollapse(on) { CARD_AUTO = on; clearTimeout(cardTimer); }, testLowRes() { renderer.setPixelRatio(0.35); resize(); }, perf() { return { simMs: +PERF.sim.toFixed(2), renderMs: +(PERF.render || 0).toFixed(1), labelsMs: +(PERF.hs || 0).toFixed(2), particles: parts.length, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles }; }, calls() { return CALLS.slice(); }, vaso() { if (!VASO.verts) return null; const pa = VASO.geo.attributes.position, M = VASO.Mi.clone().invert(), v = new THREE.Vector3(), r = { 1: [], 2: [] }; for (const q of VASO.verts) { if (q.w < 0.99) continue; v.fromBufferAttribute(pa, q.i).applyMatrix4(M); r[q.kind].push(v.distanceTo(q.c)); } const avg = (a) => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null; return { affScale: +VASO.aff.toFixed(2), effScale: +VASO.eff.toFixed(2), affRadius: avg(r[1]), effRadius: avg(r[2]), nAff: r[1].length, nEff: r[2].length }; }, lookN(t, off) { const c = nInner.localToWorld(new THREE.Vector3(...t)); flyTo({ target: c, pos: c.clone().add(new THREE.Vector3(...off)) }); }, loopProfile(a0 = 900, a1 = 1650, bw = 75) { const bins = {}; for (const q of parts) { if (q.state !== 'move' || q.path !== 'tub') continue; const a = buildParticlePath.toArc(q.s); if (a < a0 || a > a1) continue; const k = Math.floor((a - a0) / bw); const b = (bins[k] ||= { water: 0, solute: 0 }); if (q.type === 'water') b.water++; else { b.solute++; b[q.type] = (b[q.type] || 0) + 1; } } return bins; }, where(type) { const o = {}; const add = (k) => (o[k] = (o[k] || 0) + 1); for (const q of parts) { if (q.type !== type) continue; if (q.state === 'move') add(q.path === 'tub' ? 'tubule:' + segOf(buildParticlePath.toArc(q.s)) : 'blood:' + q.path); else add(q.state + ':' + (q.xkey || '')); } o.ambientInterstitium = AMB.filter((a) => a.type === type).length; return o; }, effFit() { const ext = { rbc: 4.2, prot: 3.3 * 1.16 }; let worst = 0; for (let i = 0; i < EFF_K.length; i++) { const k = EFF_K[i], wall = 3.72 * k; for (const t in ext) worst = Math.max(worst, (ext[t] * BLOOD_SC * k + LUMEN * 0.6 * VLUMEN / LUMEN * 1.12 * k) / wall); } return { worstFillOfRadius: +worst.toFixed(2), kMin: Math.min(...EFF_K) }; }, xferStats() { return JSON.parse(JSON.stringify(XST)); }, health() { const st = {}; let bad = 0; for (const q of parts) { st[q.state] = (st[q.state] || 0) + 1; if (q.state === 'inter' && q.k > q.dwell + 1) bad++; if (q.state === 'xfer' && q.k > 1.01) bad++; } return { n: parts.length, MAXP, st, stuck: bad }; }, setReg(o) { Object.assign(REG, o); if (nMode === 'regulation') goReg(); }, regState() { return { ...regState(), reabs: JSON.parse(JSON.stringify(REABS)), FILT }; }, events() { return { ...EVT }; }, resetEvents() { for (const k in EVT) delete EVT[k]; }, shoulderReport, get nPlaying() { return nPlaying; }, partSnap() { return parts.slice(0, 40).map((p) => (p.state + ':' + p.path + ':' + (p.s || 0).toFixed(2) + ':' + (p.k || 0).toFixed(3))).join('|') + '#' + parts.length + '#' + simT.toFixed(3); }, cellSnap() { return cParts.slice(0, 30).map((p) => p.st + (p.x || 0).toFixed(2) + (p.k || 0).toFixed(3)).join('|') + '#' + cT.toFixed(3); }, struct, focusUnit, select, camera, controls, enterStage, selectLS, selectV, selectN, setNMode, goStep, get stage() { return stage; }, get nParts() { return parts.length; }, pathCount() { const c = {}; for (const p of parts) { const k = p.state === 'move' ? p.path : p.state; c[k] = (c[k] || 0) + 1; } c.protInTub = parts.filter((p) => p.type === 'prot' && p.path === 'tub').length; return c; }, simCensus(steps) { const acc = {}; for (let k = 0; k < steps; k++) { stepParticles(0.1); for (const p of parts) { if (p.state !== 'move' || p.path !== 'tub') continue; const sg = segOf(buildParticlePath.toArc(p.s)); (acc[sg] ||= {}); acc[sg][p.type] = (acc[sg][p.type] || 0) + 1 / steps; } } return acc; }, census() { const c = {}; for (const p of parts) { if (p.state !== 'move' || p.path !== 'tub') continue; const sg = segOf(buildParticlePath.toArc(p.s)); (c[sg] ||= {}); c[sg][p.type] = (c[sg][p.type] || 0) + 1; } return c; } };
  window.RDX_READY = true;
}).catch((err) => { $('#lmsg').textContent = 'Could not load the models: ' + err.message; console.error(err); });
loop();
