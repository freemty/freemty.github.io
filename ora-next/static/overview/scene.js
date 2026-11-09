// The Overview's 3D section: one real head-camera observation of an ORA run, lifted to 3D, with the left gripper's
// planned path. Data: scene.json + scene.bin, written by `python3 site/overview.py scene`.
// Drag to rotate, double-click (double-tap) to reset. Renders only while on screen; still when motion is reduced.
// The points rise from the table plane once, then a light runs along the path; the quoted message follows it.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";

// The series pair of the site's charts: dark orange for the arm's path, deep teal for its grasps and the progress marker.
const PATH = new THREE.Color(0xc6011f), GRASP = new THREE.Color(0x008e8c);

const POINT_VS = `
uniform float uSize, uScale, uLift, uGrade, uFade;
uniform vec2 uFocus;
attribute vec3 rgb;
varying vec3 vC; varying float vA;
void main(){
  vec3 p = position;
  float r = length((p.xz - uFocus) * vec2(1.0, 1.35));
  float k = clamp(uLift * 1.7 - r * 0.9, 0.0, 1.0);
  k = 1.0 - pow(1.0 - k, 3.0);
  p.y *= k;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float up = smoothstep(0.003, 0.012, position.y);   // 0 on the table top, 1 for what stands on it
  gl_PointSize = max(1.0, uSize * uScale / -mv.z * mix(0.62, 1.0, up));
  vec3 c = rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vC = mix(vec3(l), c, uGrade) * 0.92;             // the camera's own colours, a little desaturated
  vA = (1.0 - smoothstep(uFade * 0.62, uFade, r)) * (0.25 + 0.75 * k) * mix(0.5, 1.0, up);
}`;
const POINT_FS = `
varying vec3 vC; varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.28, d) * vA;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vC, a);
}`;
// The path: flat dark orange, drawn so far; the part still ahead is faint.
const PATH_VS = `
uniform float uSize, uScale, uProg, uTrail;
attribute float t;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float behind = step(t, uProg);
  vA = mix(0.14, uTrail, behind);
  gl_PointSize = max(1.0, uSize * uScale / -mv.z);
}`;
const PATH_FS = `
uniform vec3 uColor;
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.7, d) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;
// The progress marker: one deep-teal dot where the path is being drawn.
const DOT_VS = `
uniform float uSize, uScale;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uScale / -mv.z;
}`;
const DOT_FS = `
uniform vec3 uColor; uniform float uShow;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.62, 0.5, d), rim = smoothstep(1.0, 0.86, d);
  if (rim * uShow < 0.02) discard;
  gl_FragColor = vec4(mix(vec3(0.02), uColor * 1.15, core), rim * uShow);
}`;
const MARK_VS = `
uniform float uSize, uScale, uProg;
attribute float t;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float hit = smoothstep(0.0, 0.02, uProg - t) * exp(-max(0.0, uProg - t) * 14.0);
  vA = step(t, uProg + 0.0005) * (0.8 + 0.2 * hit);
  gl_PointSize = uSize * uScale / -mv.z * (1.0 + 0.9 * hit);
}`;
const MARK_FS = `
uniform vec3 uColor;
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float ring = smoothstep(0.07, 0.03, abs(d - 0.33)) + smoothstep(0.13, 0.08, d);   // teal ring and centre
  float rim = smoothstep(0.5, 0.42, d) * (1.0 - min(1.0, ring));                     // a dark rim sets it off the points
  float a = max(min(1.0, ring), 0.75 * rim) * vA;
  if (a < 0.02) discard;
  gl_FragColor = vec4(mix(vec3(0.01, 0.04, 0.045), uColor * 1.2, min(1.0, ring)), a);
}`;

export async function start(box, { reduce = false } = {}) {
  const base = new URL(".", import.meta.url);
  const [meta, buf] = await Promise.all([
    fetch(new URL("scene.json", base)).then((r) => r.json()),
    fetch(new URL("scene.bin", base)).then((r) => r.arrayBuffer()),
  ]);
  const n = meta.n, q = new Uint16Array(buf, 0, n * 3), rgb8 = new Uint8Array(buf, n * 6, n * 3);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const k = i % 3;
    pos[i] = meta.lo[k] + (q[i] / 65535) * (meta.hi[k] - meta.lo[k]);
  }

  const canvas = document.createElement("canvas");
  canvas.className = "scene-gl";
  canvas.setAttribute("aria-hidden", "true");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (e) {
    return null;                                     // no WebGL: the figure is left out
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const holder = box.querySelector(".stage3d") || box;
  holder.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 2, 0.05, 20);
  const focus = new THREE.Vector3(-0.1, 0.03, 0.09);   // a little left of centre: where the tower and the path are

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("rgb", new THREE.BufferAttribute(rgb8, 3, true));
  const pu = { uSize: { value: 0.0062 }, uScale: { value: 800 }, uLift: { value: reduce ? 1 : 0 },
               uGrade: { value: 0.72 }, uFade: { value: 0.86 }, uFocus: { value: new THREE.Vector2(focus.x, focus.z) } };
  scene.add(new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: pu, vertexShader: POINT_VS, fragmentShader: POINT_FS, transparent: true, depthWrite: false })));

  // The planned path, resampled evenly along its length.
  const curve = new THREE.CatmullRomCurve3(meta.path.map((p) => new THREE.Vector3(...p)), false, "centripetal");
  const raw = meta.path.length - 1, SUB = 10;
  curve.arcLengthDivisions = raw * SUB;
  const lens = curve.getLengths(), total = lens[raw * SUB], along = (i) => lens[Math.min(i, raw) * SUB] / total;
  const m = 1400, pp = curve.getSpacedPoints(m - 1), pts = new Float32Array(m * 3), tt = new Float32Array(m);
  pp.forEach((v, i) => { pts.set([v.x, v.y, v.z], i * 3); tt[i] = i / (m - 1); });
  const pathG = new THREE.BufferGeometry();
  pathG.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  pathG.setAttribute("t", new THREE.BufferAttribute(tt, 1));
  const prog = { value: reduce ? 1 : 0 }, trail = { value: 1 };
  const shared = { uScale: pu.uScale, uProg: prog };
  scene.add(new THREE.Points(pathG, new THREE.ShaderMaterial({
    uniforms: { ...shared, uSize: { value: 0.0056 }, uTrail: trail, uColor: { value: PATH } },
    vertexShader: PATH_VS, fragmentShader: PATH_FS, transparent: true, depthWrite: false, depthTest: false })));
  // Grasps: where the gripper closed, placed along the path by arc length.
  const mk = meta.grasps.map((i) => ({ p: meta.path[i], t: along(i) }));
  // The operator's messages: each one shows from the point along the path where it arrived.
  const quotes = [...box.querySelectorAll(".said q")], said = meta.said.map((x) => along(x.at));
  let shown = -1;
  const sayAt = (p) => {
    let k = 0;
    said.forEach((a, i) => { if (p >= a) k = i; });
    if (k !== shown) { quotes.forEach((q, i) => q.classList.toggle("on", i === k)); shown = k; }
  };
  const mg = new THREE.BufferGeometry();
  mg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mk.flatMap((x) => x.p)), 3));
  mg.setAttribute("t", new THREE.BufferAttribute(new Float32Array(mk.map((x) => x.t)), 1));
  scene.add(new THREE.Points(mg, new THREE.ShaderMaterial({
    uniforms: { ...shared, uSize: { value: 0.042 }, uColor: { value: GRASP } },
    vertexShader: MARK_VS, fragmentShader: MARK_FS, transparent: true, depthWrite: false, depthTest: false })));

  const dotG = new THREE.BufferGeometry(), dotP = new Float32Array(3), show = { value: 0 };
  dotG.setAttribute("position", new THREE.BufferAttribute(dotP, 3));
  scene.add(new THREE.Points(dotG, new THREE.ShaderMaterial({
    uniforms: { uScale: pu.uScale, uSize: { value: 0.022 }, uColor: { value: GRASP }, uShow: show },
    vertexShader: DOT_VS, fragmentShader: DOT_FS, transparent: true, depthWrite: false, depthTest: false })));
  const moveDot = (p) => {
    const i = Math.round(p * (m - 1)) * 3;
    dotP[0] = pts[i]; dotP[1] = pts[i + 1]; dotP[2] = pts[i + 2];
    dotG.attributes.position.needsUpdate = true;
    show.value = p < 0.999 ? trail.value : 0;
  };

  // Orbit by hand: drag to rotate, double-click / double-tap to reset. No wheel zoom, so the page still scrolls.
  const home = { az: -0.5, el: 0.66 };
  const view = { az: home.az, el: home.el }, goal = { az: home.az, el: home.el };
  let touched = false, dragging = null, lastTap = 0;
  const clampGoal = () => {
    goal.az = Math.max(-1.25, Math.min(1.25, goal.az));
    goal.el = Math.max(0.16, Math.min(1.25, goal.el));
  };
  canvas.addEventListener("pointerdown", (e) => {
    dragging = { x: e.clientX, y: e.clientY, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    box.classList.add("grab");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
    dragging.x = e.clientX; dragging.y = e.clientY;
    touched = true;
    goal.az -= dx * 0.0045;
    if (e.pointerType !== "touch") goal.el += dy * 0.004;
    clampGoal(); wake();
  });
  const end = (e) => {
    if (dragging && e.pointerId === dragging.id) dragging = null;
    box.classList.remove("grab");
    if (e.type === "pointerup" && e.pointerType === "touch") {
      if (e.timeStamp - lastTap < 320) reset();
      lastTap = e.timeStamp;
    }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("dblclick", () => reset());
  function reset() { touched = false; goal.az = home.az; goal.el = home.el; wake(); }

  // Size: fit the table's width in the view, a bit tighter on narrow screens.
  let w = 0, h = 0, dist = 2;
  function resize() {
    const r = holder.getBoundingClientRect();
    if (!r.width || !r.height || (r.width === w && r.height === h)) return;
    w = r.width; h = r.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const halfW = w < 600 ? 0.38 : 0.54, halfH = 0.27;
    const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    dist = Math.max(halfH / ty, halfW / (ty * camera.aspect)) + 0.25;
    camera.updateProjectionMatrix();
    pu.uScale.value = (h * renderer.getPixelRatio()) / (2 * ty);
    wake();
  }
  new ResizeObserver(resize).observe(holder);

  // Run only while on screen and the tab is visible; with reduced motion, render on demand only.
  let visible = true, raf = 0, t0 = performance.now(), last = t0;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) wake(); }).observe(box);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });
  function wake() { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  const LIFT = 1.9, LOOP = 15, DRAW = 10.5, OUT = 1.2;
  let clock = 0;
  function frame(now) {
    raf = 0;
    resize();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let moving = false;
    if (!reduce) {
      clock += dt;
      pu.uLift.value = Math.min(1, clock / LIFT);
      const c = Math.max(0, clock - LIFT * 0.7) % LOOP;
      prog.value = Math.min(1, c / DRAW);
      sayAt(prog.value);
      trail.value = c > LOOP - OUT ? Math.max(0, (LOOP - c) / OUT) : 1;
      moveDot(prog.value);
      if (!touched && !dragging) goal.az = home.az + 0.2 * Math.sin(clock * (2 * Math.PI / 24));
      moving = true;
    }
    const k = 1 - Math.pow(0.0009, dt);              // smooth, frame-rate independent follow
    view.az += (goal.az - view.az) * k;
    view.el += (goal.el - view.el) * k;
    if (Math.abs(goal.az - view.az) + Math.abs(goal.el - view.el) > 1e-4) moving = true;
    camera.position.set(
      focus.x + dist * Math.cos(view.el) * Math.sin(view.az),
      focus.y + dist * Math.sin(view.el),
      focus.z + dist * Math.cos(view.el) * Math.cos(view.az));
    camera.lookAt(focus);
    renderer.render(scene, camera);
    if (moving || dragging) wake();
  }
  resize();
  sayAt(prog.value);
  wake();
  box.classList.add("live");
  if (!reduce) box.classList.add("anim");
  return { renderer, canvas, meta, settle: () => { clock = LIFT + DRAW + 1; } };
}
