// Run3D: a recorded ORA run as the head camera's picture in 3D, with the agent's decision timeline. Mounts into any
//   <figure class="r3d" data-runs="RUN_ID [RUN_ID]" data-root="…/static/gallery/runs/">
// One run id: one panel. Two: compare, side by side (stacked on phones), each with its own timeline, one shared view.
//
// The 3D view opens at the head camera's own pose, framed on the region the run's paths cover, so it reads as the
// camera image; dragging tilts it a little (it is one camera's depth: the far side is empty), Ctrl/Cmd + wheel, a
// pinch or the buttons zoom. The inset is the image the model saw, with the same paths projected on it; clicking it
// swaps the two. The first state is the whole run (final scene, every path); the ticks step through the decisions.
// Paths, badges, marks and picking are drawn on a 2D canvas over each view with that view's projection.
// Colour inside the viewer: teal = right arm, light = left arm (both over a dark casing); red only on "x refused".
// Data (run.json + frames, schema ora-site.run3d.v2) loads when the figure comes near the viewport: site/gallery.py.
// The model's reasoning or thinking text is not in it.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";

const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TOUCH = matchMedia("(hover: none), (pointer: coarse)").matches;
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || "");
const DEG = Math.PI / 180;
const TILT_AZ = 30 * DEG, TILT_EL = 20 * DEG, ZOOM_MAX = 4, TOP_EL = 84 * DEG;
const SPLAT = 1.12;      // a square's side over its sample's footprint
const ARM = { left: [242, 243, 245], right: [72, 176, 180] }, PLAIN = [150, 150, 150], INK = "10,10,10";   // the arms' colours are read from the CSS at mount
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const words = (s) => String(s ?? "").replace(/_/g, " ");
// A gripper that stopped short of closing: the receipt says not_reached, which is what holding an object looks like.
const held = (x) => x.a === "set_gripper" && x.code === "gripper_stalled_before_target";
const failed = (x) => !x.refused && x.status && x.status !== "reached" && !held(x);
const obsNo = (id) => (id ? String(+id.split("-").pop()) : "?");
const armsOf = (x) => (x.arms && x.arms.length ? x.arms : []);
const armText = (x) => { const a = armsOf(x); if (!a.length) return ""; const what = x.a === "set_gripper" ? "gripper" : "arm"; return a.length > 1 ? `both ${what}s` : `${a[0]} ${what}`; };
const outcome = (x) => (x.refused ? "refused" : held(x) ? "stalled" : words(x.status || "no receipt"));
const toolText = (x) => (x.tool || x.a || "motion") + (x.phase ? ` · ${words(x.phase)}` : x.grip ? ` · ${x.grip}` : "");
function counts(d) {
  const run = d.motions.filter((x) => !x.refused).length, ref = d.motions.filter((x) => x.refused).length, bad = d.motions.filter(failed).length;
  return plural(run, "motion") + (ref ? `, ${ref} refused` : "") + (bad ? `, ${bad} not reached` : "");
}

// The cloud: one square per depth sample (every 2nd pixel), as large as the sample's footprint on its surface (a little
// over 1), so surfaces close up when seen from the camera; uGrow widens the squares as the view leaves the camera's
// pose. Each square shows the patch of the head camera's image it covers (uMap), not one flat colour: from the
// camera's pose the cloud is that image at its full resolution, also when zoomed in.
// What the default frame holds of the image is at full strength; beyond the frame it fades into the page (uFrame: the
// frame's centre and half size as tangents in the head camera, uHead: scene to head camera), and what is not on or
// over the table (floor, walls, the robot's base) is dimmer. No blending: nearer points win.
const POINT_VS = `
uniform float uScale, uGrow, uMargin, uDim;
uniform vec2 uTexel;
uniform vec4 uFrame, uTable;
uniform mat4 uHead;
attribute vec2 at;
attribute vec2 sz;
varying vec2 vAt, vSpan;
varying float vW;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vec4 hc = uHead * vec4(position, 1.0);
  vec2 o = max(abs(hc.xy / max(-hc.z, 0.001) - uFrame.xy) - uFrame.zw, 0.0);
  float w = 1.0 - smoothstep(0.02, uMargin, length(o));
  vec2 off = max(max(uTable.xy - position.xz, position.xz - uTable.zw), 0.0);
  w *= mix(uDim, 1.0, (1.0 - smoothstep(0.0, 0.2, length(off))) * smoothstep(-0.09, -0.03, position.y));
  if (w < 0.02) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  // off the camera's pose the sample grid is turned against the pixel grid and slanted surfaces open up: larger squares
  float k = (1.0 + (sz.y - 1.0) * uGrow) * (1.0 + 0.4 * uGrow);
  gl_PointSize = max(1.0, sz.x * k * uScale / -mv.z);
  vAt = at; vSpan = uTexel * k; vW = w;
}`;
const POINT_FS = `
uniform sampler2D uMap;
uniform vec3 uBg;
varying vec2 vAt, vSpan;
varying float vW;
void main(){
  vec3 c = texture2D(uMap, vAt + (gl_PointCoord - 0.5) * vSpan).rgb;
  c = min(pow(c, vec3(0.84)) * 1.1, 1.0);
  gl_FragColor = vec4(mix(uBg, c, vW), 1.0);
}`;

async function loadImage(url) {
  const img = new Image();
  img.decoding = "async"; img.src = url;
  await img.decode();
  return img;
}

// --------------------------------------------------------------------------------------------------------------------
// One view for the panels of a figure. The camera is the head camera's own rig: at the "camera" preset it sits at the
// head camera's pose and the frame is a crop of its image (the box of every planned path, padded), so the cloud is the
// photo. Tilting turns the whole rig about the focus (the middle of the run's region), within a few degrees.
function sharedView(metas) {
  const cam = metas[0].camera, T = cam.T, o = cam.origin, K = cam.K, [IW, IH] = cam.size, ASPECT = 4 / 3, PAD = 0.15, TH_MIN = 0.45;
  const sv = (j) => new THREE.Vector3(T[0][j], T[2][j], -T[1][j]);          // a camera axis (OpenCV: x right, y down, z forward) in the scene
  const C = new THREE.Vector3(T[0][3] - o[0], T[2][3] - o[2], -(T[1][3] - o[1]));
  const q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(sv(0), sv(1).negate(), sv(2).negate()));
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], pts = [];
  for (const m of metas) {
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.region.min[k]); hi[k] = Math.max(hi[k], m.region.max[k]); }
    for (const d of m.timeline) {
      for (const x of d.motions) for (const arm in x.path || {}) for (const p of x.path[arm]) pts.push(new THREE.Vector3(p[0], p[1], p[2]));
      for (const mk of d.marks) pts.push(new THREE.Vector3(mk.p[0], mk.p[1], mk.p[2]));
    }
  }
  const F = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
  // the rig turned by a about the vertical and lifted by e, about the focus
  const pose = (a, e) => { const R = new THREE.Quaternion().setFromEuler(new THREE.Euler(-e, a, 0, "YXZ")); return { p: C.clone().sub(F).applyQuaternion(R).add(F), q: R.multiply(q0) }; };
  // the frame that holds every path point from a pose: its centre (cx, cy) and half height th, as tangents of view angles
  const fit = (a, e, inImage) => {
    const { p, q } = pose(a, e), inv = q.clone().invert();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const pt of pts) { const v = pt.clone().sub(p).applyQuaternion(inv); if (v.z > -0.05) continue; x0 = Math.min(x0, v.x / -v.z); x1 = Math.max(x1, v.x / -v.z); y0 = Math.min(y0, v.y / -v.z); y1 = Math.max(y1, v.y / -v.z); }
    if (x0 > x1) { x0 = y0 = -0.2; x1 = y1 = 0.2; }
    let th = Math.max(((y1 - y0) / 2) * (1 + 2 * PAD), ((x1 - x0) / 2 / ASPECT) * (1 + 2 * PAD), TH_MIN), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (inImage) {                                             // never wider than the image, never past its edges
      const ix0 = -K[0][2] / K[0][0], ix1 = (IW - K[0][2]) / K[0][0], iy0 = -(IH - K[1][2]) / K[1][1], iy1 = K[1][2] / K[1][1];
      th = Math.min(th, (iy1 - iy0) / 2, (ix1 - ix0) / 2 / ASPECT);
      cx = clamp(cx, ix0 + th * ASPECT, ix1 - th * ASPECT); cy = clamp(cy, iy0 + th, iy1 - th);
    }
    return { th, cx, cy };
  };
  const elev = Math.asin(clamp(sv(2).y * -1, -1, 1));           // how steeply the head camera looks down
  const eTop = Math.max(0, TOP_EL - elev), eMax = Math.max(0, 88 * DEG - elev);
  const presets = { camera: { a: 0, e: 0, ...fit(0, 0, true) }, top: { a: 0, e: eTop, ...fit(0, eTop, false) } };
  const home = (name) => ({ ...presets[name], zoom: 1, tx: 0, ty: 0 });
  // the inset takes the upper corner with fewer path points under it (about 0.37 of the frame each way)
  let nl = 0, nr = 0;
  { const f = presets.camera, inv = q0.clone().invert();
    for (const pt of pts) { const v = pt.clone().sub(C).applyQuaternion(inv), x = (v.x / -v.z - f.cx) / (f.th * ASPECT), y = (v.y / -v.z - f.cy) / f.th; if (y > 0.26) { if (x > 0.26) nr++; else if (x < -0.26) nl++; } } }
  const head = new THREE.Matrix4().compose(C, q0, new THREE.Vector3(1, 1, 1)).invert();      // scene -> head camera (x right, y up, looking down -z)
  const S = { lo, hi, C, F, head, pose, presets, preset: "camera", view: home("camera"), goal: home("camera"), panels: [], t: 0, moving: false, insetLeft: nr > nl };
  const bound = () => {
    const p = presets[S.preset], g = S.goal;
    g.a = clamp(g.a, p.a - TILT_AZ, p.a + TILT_AZ);
    g.e = clamp(g.e, p.e - TILT_EL, Math.min(p.e + TILT_EL, eMax));
    g.zoom = clamp(g.zoom, 1, ZOOM_MAX);
    g.tx = clamp(g.tx, 1 - g.zoom, g.zoom - 1); g.ty = clamp(g.ty, 1 - g.zoom, g.zoom - 1);
  };
  S.wakeAll = () => S.panels.forEach((p) => p.wake());
  S.snap = () => { Object.assign(S.view, S.goal); S.wakeAll(); };
  S.tilt = (da, de) => { S.goal.a += da; S.goal.e += de; bound(); S.snap(); };
  // zoom to z keeping the point at (px, py), in the view's -1..1 coordinates, where it is
  S.zoomTo = (z, px = 0, py = 0, snap = false) => {
    const g = S.goal, z1 = clamp(z, 1, ZOOM_MAX), r = z1 / g.zoom;
    g.tx = px - r * (px - g.tx); g.ty = py - r * (py - g.ty); g.zoom = z1; bound();
    if (snap) S.snap(); else S.wakeAll();
    S.panels.forEach((p) => p.syncControls());
  };
  S.pan = (dx, dy) => { S.goal.tx += dx; S.goal.ty += dy; bound(); S.snap(); };
  S.reset = () => { S.goal = home(S.preset); S.wakeAll(); S.panels.forEach((p) => p.syncControls()); };
  S.setPreset = (name) => { S.preset = name; S.reset(); };
  // how far the view is from the camera's own pose, 0..1 (widens the samples on slanted surfaces)
  S.away = () => clamp(Math.hypot(S.view.a, S.view.e) / (12 * DEG), 0, 1);
  S.step = (now) => {
    if (now === S.t) return S.moving;      // the panels of a compare draw in the same frame: step once
    const dt = Math.min(0.05, (now - S.t) / 1000); S.t = now;
    const k = REDUCE ? 1 : 1 - Math.pow(0.0006, dt);
    let rest = 0;
    for (const key of ["a", "e", "th", "cx", "cy", "zoom", "tx", "ty"]) { const d = S.goal[key] - S.view[key]; S.view[key] += d * k; rest += Math.abs(d * (1 - k)); }
    S.moving = rest > 2e-4;
    if (!S.moving) Object.assign(S.view, S.goal);
    return S.moving;
  };
  return S;
}

// --------------------------------------------------------------------------------------------------------------------
class Panel {
  constructor(host, base, meta, shared) {
    this.base = base; this.m = meta; this.S = shared;
    this.n = meta.timeline.length; this.sel = null; this.frames = new Map(); this.playing = false;
    this.items = []; this.dots = []; this.rings = []; this.rows = new Map(); this.hover = null; this.pin = null; this.prog = 1; this.pinU = 1; this.swapped = false;
    const solved = meta.official || meta.after_limit;     // after_limit: the benchmark's check passed after its step limit
    const mode = meta.mode === "code" ? "Code mode" : "Tool calls";
    this.unit = meta.mode === "code" ? "program" : "tool call";
    const root = this.root = el("div", "r3d-panel");
    const zoomHint = TOUCH ? "pinch to zoom" : `${MAC ? "Cmd" : "Ctrl"} + scroll to zoom`;
    root.innerHTML = `
      <div class="r3d-head"><b>${mode}</b><span class="r3d-verdict${solved ? " ok" : ""}">${solved ? "✓ Solved" : "Not solved"}${meta.after_limit && !meta.official ? " after the step limit" : ""}</span>
        <span class="r3d-meta">${esc(words(meta.task))} · layout ${meta.layout} · ${esc(meta.model)} · ${plural(meta.decisions, "decision")} · ${plural(meta.motions, "motion")}</span></div>
      <div class="r3d-view" tabindex="0" role="group" aria-label="3D view of the run from the head camera. Drag to tilt, plus and minus to zoom, 0 to reset.">
        <div class="r3d-v r3d-v3 is-main"><canvas class="r3d-gl" aria-hidden="true"></canvas><canvas class="r3d-ov" aria-hidden="true"></canvas></div>
        <div class="r3d-v r3d-v2 is-pip"><img alt="" draggable="false"><canvas class="r3d-ov" aria-hidden="true"></canvas></div>
        <button type="button" class="r3d-swap" aria-pressed="false" title="Swap the head camera image and the 3D view"><span>Head camera</span></button>
        <div class="r3d-legend"><span><i class="l"></i>Left arm</span><span><i class="r"></i>Right arm</span><span><i class="g"></i>Grasp</span><span><i class="u"></i>Release</span></div>
        <div class="r3d-vc" role="group" aria-label="View">
          <div class="r3d-seg"><button type="button" data-k="camera" aria-pressed="true" title="The head camera's own view">Camera</button><button type="button" data-k="top" aria-pressed="false" title="Looking down at the table">Top</button></div>
          <div class="r3d-seg"><button type="button" data-k="out" aria-label="Zoom out">−</button><button type="button" data-k="in" aria-label="Zoom in">+</button><button type="button" data-k="reset" title="Back to this view's start (double-click, or 0)">Reset</button></div>
        </div>
        <p class="r3d-hint">Drag to tilt · ${zoomHint}</p>
      </div>
      <div class="r3d-bar"><div class="r3d-ctl">
        <button type="button" data-k="prev" aria-label="Previous decision">‹</button>
        <button type="button" data-k="play" aria-label="Play through the decisions">▶</button>
        <button type="button" data-k="next" aria-label="Next decision">›</button></div>
        <div class="r3d-strip${this.n <= 16 ? " num" : ""}" role="group" aria-label="Decisions"></div></div>
      <div class="r3d-detail"><div class="r3d-scroll"></div></div>
      <div class="r3d-tip" role="tooltip" hidden></div>`;
    host.appendChild(root);
    const q = (s) => root.querySelector(s);
    this.view = q(".r3d-view"); this.scroller = q(".r3d-scroll"); this.tip = q(".r3d-tip");
    this.view.classList.toggle("inset-left", shared.insetLeft);
    this.v3 = { el: q(".r3d-v3"), ov: q(".r3d-v3 .r3d-ov") }; this.v2 = { el: q(".r3d-v2"), ov: q(".r3d-v2 .r3d-ov"), img: q(".r3d-v2 img") };
    for (const v of [this.v3, this.v2]) v.ctx = v.ov.getContext("2d");
    this.font = getComputedStyle(q(".r3d-legend")).fontFamily || "monospace";
    for (const [arm, sel] of [["left", ".r3d-legend .l"], ["right", ".r3d-legend .r"]]) {     // one source for the arms' colours: the stylesheet
      const c = (getComputedStyle(q(sel)).backgroundColor.match(/[\d.]+/g) || []).map(Number);
      if (c.length >= 3 && (c[3] ?? 1) > 0) ARM[arm] = c.slice(0, 3);
    }
    this.swapBtn = q(".r3d-swap");
    this.swapBtn.addEventListener("click", () => this.swap());
    this.vc = q(".r3d-vc");
    this.vc.addEventListener("click", (e) => {
      const k = e.target.closest("button")?.dataset.k, S = this.S;
      if (!k) return;
      this.used();
      if (k === "in") S.zoomTo(S.goal.zoom * 1.5); else if (k === "out") S.zoomTo(S.goal.zoom / 1.5);
      else if (k === "reset") S.reset(); else S.setPreset(k);
    });
    this.buildStrip(q(".r3d-strip"));
    q('[data-k="prev"]').addEventListener("click", () => { this.stop(); this.select(Math.max(-1, this.sel - 1)); });
    q('[data-k="next"]').addEventListener("click", () => { this.stop(); this.select(Math.min(this.n - 1, this.sel + 1)); });
    this.playBtn = q('[data-k="play"]');
    this.playBtn.addEventListener("click", () => (this.playing ? this.stop() : this.play()));
    root.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("pre")) return;
      const S = this.S, k = e.key;
      if (k === "ArrowRight") { this.stop(); this.select(Math.min(this.n - 1, this.sel + 1)); }
      else if (k === "ArrowLeft") { this.stop(); this.select(Math.max(-1, this.sel - 1)); }
      else if (k === "+" || k === "=") { this.used(); S.zoomTo(S.goal.zoom * 1.5); }
      else if (k === "-" || k === "_") { this.used(); S.zoomTo(S.goal.zoom / 1.5); }
      else if (k === "0") { this.used(); S.reset(); }
      else if (k === "Escape" && this.pin != null) this.setPin(null);
      else return;
      e.preventDefault();
    });
    this.scroller.addEventListener("pointerover", (e) => { const r = e.target.closest("[data-g]"); if (r && e.pointerType !== "touch") this.setHover(+r.dataset.g, "row"); });
    this.scroller.addEventListener("pointerout", (e) => { if (e.target.closest("[data-g]") && !e.relatedTarget?.closest?.("[data-g]")) this.setHover(null); });
    this.scroller.addEventListener("focusin", (e) => { const r = e.target.closest("[data-g]"); if (r && r.matches(":focus-visible")) this.setHover(+r.dataset.g, "row"); });
    this.scroller.addEventListener("focusout", (e) => { if (e.target.closest("[data-g]")) this.setHover(null); });
    this.scroller.addEventListener("click", (e) => {
      const r = e.target.closest("button[data-g]"); if (!r) return;
      const g = +r.dataset.g;
      if (this.sel < 0) { this.stop(); this.select(g); } else this.setPin(this.pin === g ? null : g);
    });
    this.initGL();
    this.initPointer();
  }

  // ---------------------------------------------------------------------------------------------------- timeline
  buildStrip(strip) {
    this.strip = strip;
    const mk = (cls, text, tip) => { const b = el("button", "r3d-tick" + cls, text); b.type = "button"; b.dataset.tip = tip; b.setAttribute("aria-label", tip); strip.appendChild(b); return b; };
    this.ticks = [mk(" all", "All", `Whole run · ${plural(this.n, "decision")}`)];
    this.m.timeline.forEach((d, i) => {
      const flag = d.motions.some((x) => x.refused || failed(x)) || d.before.some((b) => !b.ok);
      this.ticks.push(mk(flag ? " flag" : "", `<span>${i + 1}</span>`, `Decision ${i + 1} · ${d.label} · ${counts(d)}`));
    });
    this.ticks.forEach((b, k) => {
      b.addEventListener("click", () => { this.stop(); this.select(k - 1); });
      b.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") this.tipFor(b); });
      b.addEventListener("pointerleave", () => this.tipHide());
      b.addEventListener("focus", () => { if (b.matches(":focus-visible")) this.tipFor(b); });
      b.addEventListener("blur", () => this.tipHide());
    });
    // press and drag across the ticks; a strip that scrolls sideways on touch keeps its scroll and takes taps
    let scrub = null;
    const at = (x, y) => {
      let best = 0, bd = 1e9;
      this.ticks.forEach((t, k) => { const r = t.getBoundingClientRect(), d = Math.max(r.left - x, 0, x - r.right) + 4 * Math.max(r.top - y, 0, y - r.bottom); if (d < bd) { bd = d; best = k; } });
      return best;
    };
    const go = (e) => { const k = at(e.clientX, e.clientY); this.stop(); this.select(k - 1); this.tipFor(this.ticks[k]); };
    strip.addEventListener("pointerdown", (e) => {
      if (e.button || (e.pointerType === "touch" && strip.scrollWidth > strip.clientWidth + 2)) return;
      scrub = e.pointerId; strip.setPointerCapture(e.pointerId); strip.classList.add("scrub"); go(e); e.preventDefault();
    });
    strip.addEventListener("pointermove", (e) => { if (scrub === e.pointerId) go(e); });
    const end = (e) => { if (scrub === e.pointerId) { scrub = null; strip.classList.remove("scrub"); if (e.pointerType === "touch") this.tipHide(); } };
    strip.addEventListener("pointerup", end); strip.addEventListener("pointercancel", end);
  }

  // a small label above a tick, or under the pointer on a path (kept inside the stage)
  tipShow(html, cx, top, above) {
    const t = this.tip, R = this.root.getBoundingClientRect(), B = above ? R : this.view.getBoundingClientRect();
    t.innerHTML = html; t.hidden = false;
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = clamp(cx - w / 2, B.left + 6, Math.max(B.left + 6, B.right - w - 6)) - R.left + "px";
    t.style.top = (above ? top - h - 8 : top + 16 + h > B.bottom ? top - h - 12 : top + 16) - R.top + "px";
  }
  tipFor(tick) { const r = tick.getBoundingClientRect(); this.tipShow(esc(tick.dataset.tip), r.left + r.width / 2, r.top, true); }
  tipHide() { this.tip.hidden = true; }

  // ---------------------------------------------------------------------------------------------------------- 3D
  initGL() {
    const canvas = this.v3.el.querySelector(".r3d-gl"), m = this.m, S = this.S;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "low-power" });
    this.renderer.setClearColor(0x0a0a0a, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.05, 20);
    this.pv = new THREE.Matrix4();
    const fr = S.presets.camera, tb = m.camera.table || [-9, -9, 9, 9];
    this.uni = { uScale: { value: 800 }, uGrow: { value: 0 }, uMargin: { value: 0.4 }, uDim: { value: 0.32 }, uBg: { value: new THREE.Vector3(10 / 255, 10 / 255, 10 / 255) },
      uMap: { value: null }, uTexel: { value: new THREE.Vector2((m.camera.stride * SPLAT) / m.camera.size[0], (m.camera.stride * SPLAT) / m.camera.size[1]) },
      uFrame: { value: new THREE.Vector4(fr.cx, fr.cy, fr.th * 4 / 3, fr.th) }, uTable: { value: new THREE.Vector4(...tb) }, uHead: { value: S.head } };
    this.pointMat = new THREE.ShaderMaterial({ uniforms: this.uni, vertexShader: POINT_VS, fragmentShader: POINT_FS });
    this.cloud = null;
    // scene -> image: the head camera's own projection, for the inset
    const cam = m.camera, T = cam.T, o = cam.origin;
    const w2c = new THREE.Matrix4().set(...T[0], ...T[1], ...T[2], ...T[3]).invert().elements;      // column-major
    const K = cam.K, [IW, IH] = cam.size;
    this.toImage = (p) => {
      const x = p[0] + o[0], y = -p[2] + o[1], z = p[1] + o[2];
      const xc = w2c[0] * x + w2c[4] * y + w2c[8] * z + w2c[12], yc = w2c[1] * x + w2c[5] * y + w2c[9] * z + w2c[13], zc = w2c[2] * x + w2c[6] * y + w2c[10] * z + w2c[14];
      return zc > 0.02 ? [(K[0][0] * xc / zc + K[0][2]) / IW, (K[1][1] * yc / zc + K[1][2]) / IH] : null;
    };
    this.visible = true; this.raf = 0;
    // draw only while on screen. Entries arrive in batches: the last one is the current state.
    new IntersectionObserver((es) => { this.visible = es[es.length - 1].isIntersecting; if (this.visible) this.wake(); }).observe(this.view);
    new ResizeObserver(() => this.wake()).observe(this.view);
    document.addEventListener("visibilitychange", () => this.wake());
    canvas.addEventListener("webglcontextrestored", () => this.wake());
    S.panels.push(this);
  }

  // drag tilts, shift + drag pans, two fingers pinch and pan, Ctrl/Cmd + wheel zooms; a plain wheel is the page's
  initPointer() {
    const S = this.S, stage = this.view, ptrs = new Map();
    let drag = null, pinch = null, lastTap = 0;
    const ndc = (x, y) => { const r = this.v3.el.getBoundingClientRect(); return [((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2]; };
    const two = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || (e.pointerType === "mouse" && e.button !== 0)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
      if (ptrs.size === 1) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, far: 0, pan: e.shiftKey };
      else if (ptrs.size === 2) { drag = null; pinch = { ...two(), zoom: S.goal.zoom }; }
      this.tipHide();
    });
    stage.addEventListener("pointermove", (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) { if (e.pointerType === "mouse" && !e.target.closest("button")) this.pick(e.clientX, e.clientY, false); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pinch && ptrs.size >= 2) {
        if (this.swapped) return;
        const t = two(), r = this.v3.el.getBoundingClientRect(), [px, py] = ndc(t.x, t.y);
        S.pan(((t.x - pinch.x) / r.width) * 2, (-(t.y - pinch.y) / r.height) * 2);
        S.zoomTo((pinch.zoom * t.d) / pinch.d, px, py, true);
        pinch.x = t.x; pinch.y = t.y; pinch.zoom = S.goal.zoom; pinch.d = t.d;
        this.used();
      } else if (drag && drag.id === e.pointerId) {
        drag.far += Math.abs(dx) + Math.abs(dy);
        if (drag.far < 4 || this.swapped) return;
        const r = this.v3.el.getBoundingClientRect();
        stage.classList.add("grab"); this.used();
        if (drag.pan) S.pan((dx / r.width) * 2, (-dy / r.height) * 2);
        else S.tilt((-dx / r.width) * 2.2 * TILT_AZ, e.pointerType === "touch" ? 0 : (dy / r.height) * 2.2 * TILT_EL);
      }
    });
    const end = (e) => {
      if (!ptrs.delete(e.pointerId)) return;
      stage.classList.remove("grab");
      if (ptrs.size < 2) pinch = null;
      if (drag && drag.id === e.pointerId) {
        if (e.type === "pointerup" && drag.far < 4) {
          if (e.pointerType === "touch" && e.timeStamp - lastTap < 320) { S.reset(); this.used(); }
          else this.pick(e.clientX, e.clientY, true);
          lastTap = e.timeStamp;
        }
        drag = null;
      }
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("pointerleave", () => { if (!ptrs.size) { this.tipHide(); stage.classList.remove("onpath"); if (this.hover?.from === "path") this.setHover(null); } });
    stage.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) { S.reset(); this.used(); } });
    stage.addEventListener("wheel", (e) => {
      if (!(e.ctrlKey || e.metaKey) || this.swapped) return;         // a plain wheel scrolls the page
      e.preventDefault();
      const k = e.deltaMode === 1 ? 0.06 : Math.abs(e.deltaY) < 40 ? 0.012 : 0.0028;   // lines, a pinch on a trackpad, a mouse wheel
      const [px, py] = ndc(e.clientX, e.clientY);
      S.zoomTo(S.goal.zoom * Math.exp(-e.deltaY * k), px, py);
      this.used();
    }, { passive: false });
    // two fingers belong to the view (touch-action: pan-y leaves one-finger vertical swipes to the page)
    const two_ = (e) => { if (e.touches.length > 1 && e.cancelable) e.preventDefault(); };
    stage.addEventListener("touchstart", two_, { passive: false });
    stage.addEventListener("touchmove", two_, { passive: false });
    // Safari's trackpad pinch
    let g0 = 1;
    stage.addEventListener("gesturestart", (e) => { e.preventDefault(); g0 = S.goal.zoom; });
    stage.addEventListener("gesturechange", (e) => { e.preventDefault(); if (!ptrs.size && !this.swapped) { const [px, py] = ndc(e.clientX, e.clientY); S.zoomTo(g0 * e.scale, px, py, true); this.used(); } });
  }

  used() { this.view.classList.add("used"); }

  syncControls() {
    const S = this.S;
    this.vc.querySelectorAll("[data-k=camera],[data-k=top]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.k === S.preset ? "true" : "false"));
    this.vc.querySelector("[data-k=in]").disabled = S.goal.zoom >= ZOOM_MAX - 1e-3;
    this.vc.querySelector("[data-k=out]").disabled = S.goal.zoom <= 1 + 1e-3;
    this.view.dataset.zoom = S.goal.zoom.toFixed(2);
  }

  swap() {
    this.swapped = !this.swapped;
    this.v3.el.classList.toggle("is-main", !this.swapped); this.v3.el.classList.toggle("is-pip", this.swapped);
    this.v2.el.classList.toggle("is-main", this.swapped); this.v2.el.classList.toggle("is-pip", !this.swapped);
    this.view.classList.toggle("swapped", this.swapped);
    this.swapBtn.setAttribute("aria-pressed", this.swapped ? "true" : "false");
    this.swapBtn.firstElementChild.textContent = this.swapped ? "3D view" : "Head camera";
    this.used(); this.tipHide(); this.wake();
  }

  // ------------------------------------------------------------------------------------------------------- frames
  async frame(k) {
    if (this.frames.has(k)) { const j = this.frames.get(k); this.frames.delete(k); this.frames.set(k, j); return j; }
    const job = (async () => {
      const cam = this.m.camera, f = this.m.frames[k], url = this.base + f.file;
      const [buf, img] = await Promise.all([
        fetch(url + ".dz").then((r) => new Response(r.body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer()),
        loadImage(url + "." + cam.image),
      ]);
      const w = cam.w, h = cam.h, s = cam.stride, K = cam.K, T = cam.T, [ox, oy, oz] = cam.origin, [IW, IH] = cam.size;
      const dep = new Uint16Array(buf);
      for (let j = 0; j < h; j++) for (let i = 1, q = j * w + 1; i < w; i++, q++) dep[q] += dep[q - 1];      // undo the row deltas
      const P = new Float32Array(w * h * 3);
      for (let j = 0, q = 0; j < h; j++) for (let i = 0; i < w; i++, q++) {
        const d = dep[q] / 1000;
        if (!d) continue;
        const xc = (i * s - K[0][2]) * d / K[0][0], yc = (j * s - K[1][2]) * d / K[1][1];
        P[q * 3] = T[0][0] * xc + T[0][1] * yc + T[0][2] * d + T[0][3] - ox;
        P[q * 3 + 1] = T[2][0] * xc + T[2][1] * yc + T[2][2] * d + T[2][3] - oz;
        P[q * 3 + 2] = -(T[1][0] * xc + T[1][1] * yc + T[1][2] * d + T[1][3] - oy);
      }
      const pos = new Float32Array(w * h * 3), at = new Float32Array(w * h * 2), sz = new Float32Array(w * h * 2);
      let n = 0;
      for (let j = 0, q = 0; j < h; j++) for (let i = 0; i < w; i++, q++) {
        if (!dep[q]) continue;
        const foot = (dep[q] / 1000) * s / K[0][0];        // the sample's size on a surface facing the camera
        let grow = 1;                                     // and how much further its neighbours on the same surface are
        for (const nb of [i + 1 < w ? q + 1 : -1, j + 1 < h ? q + w : -1, i ? q - 1 : -1, j ? q - w : -1]) {
          if (nb < 0 || !dep[nb]) continue;
          const r = Math.hypot(P[nb * 3] - P[q * 3], P[nb * 3 + 1] - P[q * 3 + 1], P[nb * 3 + 2] - P[q * 3 + 2]) / foot;
          if (r < 2.6 && r > grow) grow = r;
        }
        pos[n * 3] = P[q * 3]; pos[n * 3 + 1] = P[q * 3 + 1]; pos[n * 3 + 2] = P[q * 3 + 2];
        at[n * 2] = (i * s + 0.5) / IW; at[n * 2 + 1] = (j * s + 0.5) / IH;      // where the sample is in the image
        sz[n * 2] = foot * SPLAT; sz[n * 2 + 1] = grow;
        n++;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos.slice(0, n * 3), 3));
      geo.setAttribute("at", new THREE.BufferAttribute(at.slice(0, n * 2), 2));
      geo.setAttribute("sz", new THREE.BufferAttribute(sz.slice(0, n * 2), 2));
      const tex = new THREE.Texture(img);
      tex.flipY = false; tex.generateMipmaps = false; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
      return { geo, tex, src: img.src, drop() { geo.dispose(); tex.dispose(); } };
    })();
    this.frames.set(k, job);
    if (this.frames.size > 8) {                            // keep a few frames; drop the one used longest ago
      const [old, j] = this.frames.entries().next().value;
      this.frames.delete(old);
      j.then((f) => { f.dropped = true; if (this.shown !== f) f.drop(); }, () => {});
    }
    return job;
  }

  // ------------------------------------------------------------------------------------------------------- states
  // i = -1: the whole run (final scene, every path); 0..n-1: one decision (the scene it saw, its motions' paths)
  async select(i) {
    if (i === this.sel) return;
    this.sel = i;
    const all = i < 0, d = all ? null : this.m.timeline[i];
    this.ticks.forEach((t, k) => { t.setAttribute("aria-current", k === i + 1 ? "true" : "false"); t.classList.toggle("past", k > 0 && k < i + 1); });
    const tk = this.ticks[i + 1], st = this.strip;              // keep the tick in view inside the strip, not the page
    if (tk.offsetLeft < st.scrollLeft || tk.offsetLeft + tk.offsetWidth > st.scrollLeft + st.clientWidth) st.scrollLeft = tk.offsetLeft - st.clientWidth / 2;
    if (tk.offsetTop < st.scrollTop || tk.offsetTop + tk.offsetHeight > st.scrollTop + st.clientHeight) st.scrollTop = tk.offsetTop - st.clientHeight / 2;
    this.hover = null; this.pin = null; this.tipHide();
    this.scroller.innerHTML = all ? this.runHtml() : this.decisionHtml(d);
    this.scroller.scrollTop = 0;
    this.rows = new Map([...this.scroller.querySelectorAll("[data-g]")].map((r) => [+r.dataset.g, r]));
    // what is drawn: g groups the paths a row stands for (a decision in the whole run, a motion in a decision)
    const items = [], dots = [], rings = [];
    const add = (pts, arm, g, n, o) => {
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]));
      if (pts.length > 1) items.push({ pts, arm, g, n, o, cum, len: cum[cum.length - 1] || 1e-6 });
    };
    if (all) this.m.timeline.forEach((dd, di) => {
      const o = this.n > 1 ? di / (this.n - 1) : 1;
      dd.motions.forEach((x) => { for (const arm in x.path || {}) add(x.path[arm], arm, di, null, o); });
      dd.marks.forEach((mk) => dots.push({ p: mk.p, arm: mk.arm, k: mk.k, g: di, o }));
    });
    else {
      d.motions.forEach((x, mi) => {
        for (const arm in x.path || {}) add(x.path[arm], arm, mi, mi + 1, 1);
        for (const arm in x.at || {}) rings.push({ p: x.at[arm], arm, g: mi });
      });
      d.marks.forEach((mk) => dots.push({ p: mk.p, arm: mk.arm, k: mk.k, g: mk.m, o: 1 }));
    }
    let s0 = 0;
    for (const it of items) { it.s0 = s0; s0 += it.len; }
    this.items = items; this.dots = dots; this.rings = rings; this.total = s0 || 1;
    this.prog = REDUCE || all ? 1 : 0; this.t0 = performance.now();
    const k = all ? this.m.end.frame : d.frame;
    let f;
    try { f = await this.frame(k); } catch (e) { this.frames.delete(k); return; }
    if (this.sel !== i) return;
    if (!this.cloud) { this.cloud = new THREE.Points(f.geo, this.pointMat); this.cloud.frustumCulled = false; this.scene.add(this.cloud); }
    else this.cloud.geometry = f.geo;
    this.uni.uMap.value = f.tex;
    if (this.shown && this.shown !== f && this.shown.dropped) this.shown.drop();
    this.shown = f;
    if (this.v2.img.src !== f.src) this.v2.img.src = f.src;
    this.view.classList.add("live");
    this.t0 = performance.now();
    this.wake();
    const nx = this.m.timeline[i + 1]; if (nx) this.frame(nx.frame).catch(() => {});     // the next frame, ahead of time
  }

  hot() { return this.hover ? this.hover.g : this.pin; }

  setHover(g, from) {
    const was = this.hot();
    this.hover = g == null ? null : { g, from };
    if (this.hot() !== was) this.mark(from === "path");
  }

  setPin(g) {
    this.pin = g; this.pinU = REDUCE ? 1 : 0; this.pinT0 = performance.now();
    this.rows.forEach((r, k) => { if (r.tagName === "BUTTON") r.setAttribute("aria-pressed", k === g ? "true" : "false"); });
    this.mark(false);
  }

  mark(reveal) {
    const h = this.hot();
    this.rows.forEach((r, k) => r.classList.toggle("hot", k === h));
    const row = reveal && h != null && this.rows.get(h);
    if (row) {                                                // bring the row into view inside the list, not the page
      const a = row.getBoundingClientRect(), b = this.scroller.getBoundingClientRect();
      if (a.top < b.top) this.scroller.scrollTop -= b.top - a.top + 8; else if (a.bottom > b.bottom) this.scroller.scrollTop += a.bottom - b.bottom + 8;
    }
    this.wake();
  }

  // the path nearest to the pointer on the large view: hover shows what it is, a click opens or pins it
  pick(x, y, click) {
    const v = this.swapped ? this.v2 : this.v3, r = v.el.getBoundingClientRect(), px = x - r.left, py = y - r.top;
    let best = null, bd = click && TOUCH ? 18 : 10;
    for (const h of v.hit || []) {
      const s = h.s;
      for (let k = 1; k < s.length; k++) {
        const ax = s[k - 1][0], ay = s[k - 1][1], bx = s[k][0] - ax, by = s[k][1] - ay, L = bx * bx + by * by;
        const t = L ? clamp(((px - ax) * bx + (py - ay) * by) / L, 0, 1) : 0, dd = Math.hypot(px - ax - t * bx, py - ay - t * by);
        if (dd < bd) { bd = dd; best = h.it; }
      }
    }
    this.view.classList.toggle("onpath", !!best);
    if (!best) { if (!click) { this.tipHide(); if (this.hover?.from === "path") this.setHover(null); } else if (this.sel >= 0 && this.pin != null) this.setPin(null); return; }
    if (click) { if (this.sel < 0) { this.stop(); this.select(best.g); } else this.setPin(this.pin === best.g ? null : best.g); return; }
    this.setHover(best.g, "path");
    const html = this.sel < 0
      ? `<b>Decision ${best.g + 1}</b> · ${esc(this.m.timeline[best.g].label)} · ${counts(this.m.timeline[best.g])}`
      : ((x_) => `<b>${best.g + 1}</b> · ${esc(toolText(x_))} · ${esc(armText(x_))} · ${esc(outcome(x_))}`)(this.m.timeline[this.sel].motions[best.g]);
    this.tipShow(html, x, y, false);
  }

  // ------------------------------------------------------------------------------------------------------- detail
  runHtml() {
    const m = this.m;
    const v = m.official ? "Solved within the official step limit." : m.after_limit ? "Solved, after the official step limit." : "Not solved.";
    const rows = m.timeline.map((d, i) => {
      const arms = [...new Set(d.motions.flatMap((x) => Object.keys(x.path || {})))].sort();
      return `<li><button type="button" class="r3d-row" data-g="${i}"><i class="r3d-n">${i + 1}</i><span class="r3d-what"><code>${esc(d.label)}</code></span>
        <span class="r3d-arms">${arms.map((a) => `<i class="${a[0]}" title="${a} arm"></i>`).join("")}</span><em>${counts(d)}</em></button></li>`;
    }).join("");
    return `<div class="r3d-dh"><b>Whole run</b><span>the final scene (observation ${obsNo(m.end.obs)}) with every planned path; later decisions are brighter</span></div>
      <p class="r3d-endv">${esc(v)} ${plural(m.decisions, "decision")}, ${plural(m.motions, "motion")}, ${m.model_calls ?? "?"} model calls. The benchmark's own check gave the verdict.</p>
      <p class="dim">“${esc(m.instruction || "")}”</p>
      <h4 class="r3d-sec">Decisions</h4><ol class="r3d-rows">${rows}</ol>`;
  }

  decisionHtml(d) {
    const m = this.m, f = m.frames[d.frame];
    const seen = f.obs === d.obs ? `saw observation ${obsNo(d.obs)}` : `saw observation ${obsNo(d.obs)}; the scene shown is observation ${obsNo(f.obs)}, the last one recorded before it`;
    let h = `<div class="r3d-dh"><b>Decision ${d.i} of ${this.n}</b><code>${esc(d.label)}</code><span>${seen}</span></div>`;
    const mot = d.motions.map((x, k) => {
      const arms = armsOf(x), cls = x.refused ? "x" : arms.length > 1 ? "lr" : arms.length ? arms[0][0] : "";
      const head = `<i class="r3d-n ${cls}">${k + 1}</i><span class="r3d-what"><code>${esc(toolText(x))}</code>${armText(x) ? " " + esc(armText(x)) : ""}</span>`;
      if (x.refused) return `<li><div class="r3d-row off">${head}<span class="r3d-st no">× refused</span><em>${esc(words(x.code || ""))}${x.why && x.why !== x.code ? ": " + esc(x.why) : ""}</em></div></li>`;
      const st = failed(x) ? `<span class="r3d-st x">! ${esc(outcome(x))}</span>` : `<span class="r3d-st"${held(x) ? ' title="The gripper stopped before its target opening: it is holding something"' : ""}>${esc(outcome(x))}</span>`;
      const body = `${head}${st}<em>${x.code && !held(x) ? esc(words(x.code)) + ": " : ""}${esc(x.sum)}</em>`;
      return x.path || x.at ? `<li><button type="button" class="r3d-row" data-g="${k}" aria-pressed="false">${body}</button></li>` : `<li><div class="r3d-row off">${body}</div></li>`;
    }).join("");
    h += `<h4 class="r3d-sec">Motions and the supervisor's receipts</h4><ol class="r3d-rows">${mot}</ol>`;
    if (d.before.length) {
      const items = d.before.map((b) => `<span>${b.ok ? "" : "× "}${esc(b.label)}${b.ok ? "" : ` ${esc(words(b.why || "refused"))}`}</span>`).join("");
      h += `<details class="r3d-before"><summary>${plural(d.before.length, this.unit)} before it, without motion</summary><div>${items}</div></details>`;
    }
    if (d.program) for (const p of d.program)
      h += `<details class="r3d-code"><summary>Program <code>${esc(p.path)}</code> · ${plural(p.lines, "line")}</summary><pre><code>${esc(p.text)}</code></pre></details>`;
    if (d.call) h += `<details class="r3d-code"><summary>Call <code>${esc(d.call.name)}</code> · arguments</summary><pre><code>${esc(d.call.args)}</code></pre></details>`;
    if (d.out) h += `<details class="r3d-out"><summary>${m.mode === "code" ? `Printed output, last lines${d.exit ? ` · exit ${d.exit}` : ""}` : "Result"}</summary><pre>${esc(d.out)}</pre></details>`;
    return h;
  }

  play() {
    this.playing = true; this.playBtn.textContent = "❚❚"; this.playBtn.setAttribute("aria-label", "Pause");
    const dwell = Math.max(900, Math.min(2400, 40000 / Math.max(1, this.n)));
    let next = this.sel >= this.n - 1 ? 0 : this.sel + 1;
    const step = () => {
      if (!this.playing) return;
      if (next >= this.n) { this.stop(); this.select(-1); return; }
      this.select(next++);
      this.timer = setTimeout(step, dwell);
    };
    step();
  }

  stop() { this.playing = false; clearTimeout(this.timer); this.playBtn.textContent = "▶"; this.playBtn.setAttribute("aria-label", "Play through the decisions"); }

  wake() { if (!this.raf && this.visible && !document.hidden) this.raf = requestAnimationFrame((t) => this.draw(t)); }

  // ------------------------------------------------------------------------------------------------------ drawing
  draw(now) {
    this.raf = 0;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    for (const v of [this.v3, this.v2]) {
      const r = v.el.getBoundingClientRect();
      v.w = r.width; v.h = r.height;
      const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
      if (v.ov.width !== W || v.ov.height !== H) { v.ov.width = W; v.ov.height = H; }
    }
    const v3 = this.v3, S = this.S;
    if (!v3.w || !v3.h) return;
    if (v3.w !== this.gw || v3.h !== this.gh || dpr !== this.dpr) { this.gw = v3.w; this.gh = v3.h; this.dpr = dpr; this.renderer.setPixelRatio(dpr); this.renderer.setSize(v3.w, v3.h, false); }
    const moving = S.step(now), s = S.view, cam = this.camera, at = S.pose(s.a, s.e);
    cam.position.copy(at.p); cam.quaternion.copy(at.q);
    const aspect = v3.w / v3.h, th = s.th * Math.max(1, 4 / 3 / aspect);           // the frame stays whole in a narrower stage
    cam.fov = (2 * Math.atan(th)) / DEG; cam.aspect = aspect; cam.updateProjectionMatrix();
    // the frame's centre moved to the middle (a crop of the picture, not a turn of the camera), then zoom and pan
    cam.projectionMatrix.premultiply(new THREE.Matrix4().set(s.zoom, 0, 0, s.tx - (s.zoom * s.cx) / (th * aspect), 0, s.zoom, 0, s.ty - (s.zoom * s.cy) / th, 0, 0, 1, 0, 0, 0, 0, 1));
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.updateMatrixWorld();
    this.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.uni.uScale.value = ((v3.h * dpr) / (2 * th)) * s.zoom;
    this.uni.uGrow.value = S.away();
    this.renderer.render(this.scene, cam);
    let anim = false;
    if (this.prog < 1) { this.prog = Math.min(1, (now - this.t0) / 800); anim = this.prog < 1; }
    if (this.pin != null && this.pinU < 1) { this.pinU = Math.min(1, (now - this.pinT0) / 1100); anim = this.pinU < 1; }
    const e = this.pv.elements;
    this.paint(v3, (p) => {
      const w = e[3] * p[0] + e[7] * p[1] + e[11] * p[2] + e[15];
      return w > 0.02 ? [((e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12]) / w * 0.5 + 0.5) * v3.w, (0.5 - (e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13]) / w * 0.5) * v3.h] : null;
    });
    const v2 = this.v2;
    if (v2.w) this.paint(v2, (p) => { const q = this.toImage(p); return q && [q[0] * v2.w, q[1] * v2.h]; });
    if (moving || anim) this.wake();
  }

  // paths (a dark casing under the arm's colour), grasp and release marks, numbered badges, the marker on a pinned path
  paint(v, proj) {
    const g = v.ctx, k = v.ov.width / v.w, small = v.w < 300, hot = this.hot(), all = this.sel < 0;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, v.w, v.h);
    g.lineCap = "round"; g.lineJoin = "round";
    const lw = small ? 1.5 : v.w < 480 ? 2.2 : 2.6, br = small ? 5.5 : 8.5;
    const shade = (it) => (hot == null ? (all ? 0.5 + 0.5 * it.o : 1) : it.g === hot ? 1 : 0.22);
    const upto = this.prog * this.total;
    v.hit = [];
    const order = hot == null ? this.items : [...this.items.filter((it) => it.g !== hot), ...this.items.filter((it) => it.g === hot)];
    const badges = [];
    for (const it of order) {
      const f = clamp((upto - it.s0) / it.len, 0, 1);
      if (f <= 0) continue;
      const s = [];
      for (let i = 0; i < it.pts.length; i++) {
        const lim = f * it.len;
        if (it.cum[i] <= lim) { const q = proj(it.pts[i]); if (q) s.push(q); continue; }
        const a = it.pts[i - 1], b = it.pts[i], t = (lim - it.cum[i - 1]) / (it.cum[i] - it.cum[i - 1] || 1), q = proj([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
        if (q) s.push(q);
        break;
      }
      if (s.length < 2) continue;
      v.hit.push({ it, s });
      const a = shade(it), w = lw + (hot != null && it.g === hot ? 1 : 0), col = ARM[it.arm] || PLAIN;
      g.beginPath(); g.moveTo(s[0][0], s[0][1]);
      for (let i = 1; i < s.length; i++) g.lineTo(s[i][0], s[i][1]);
      g.strokeStyle = `rgba(${INK},${0.8 * a * a})`; g.lineWidth = w + (small ? 1.6 : 2.6); g.stroke();
      g.strokeStyle = rgba(col, a); g.lineWidth = w; g.stroke();
      if (it.n != null) badges.push({ x: s[0][0], y: s[0][1], it, a });
      if (!all && f >= 1) {                                    // where it ends: an arrowhead
        const q = s[s.length - 1];
        let p = s[s.length - 2];
        for (let i = s.length - 2; i >= 0 && Math.hypot(q[0] - s[i][0], q[1] - s[i][1]) < 5; i--) p = s[i];
        const ang = Math.atan2(q[1] - p[1], q[0] - p[0]), L = small ? 5 : 8.5;
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 1) {
          g.beginPath(); g.moveTo(q[0] + Math.cos(ang) * L * 0.45, q[1] + Math.sin(ang) * L * 0.45);
          g.lineTo(q[0] - Math.cos(ang - 0.5) * L, q[1] - Math.sin(ang - 0.5) * L); g.lineTo(q[0] - Math.cos(ang + 0.5) * L, q[1] - Math.sin(ang + 0.5) * L); g.closePath();
          g.fillStyle = rgba(col, a); g.strokeStyle = `rgba(${INK},${0.8 * a})`; g.lineWidth = small ? 1 : 1.4; g.fill(); g.stroke();
        }
      }
    }
    for (const dt of this.dots) {                               // grasp: a filled dot; release: a ring
      const q = proj(dt.p); if (!q) continue;
      const a = hot == null ? (all ? 0.5 + 0.5 * dt.o : 1) : dt.g === hot ? 1 : 0.22, r = small ? 3 : 5, col = ARM[dt.arm] || PLAIN;
      g.beginPath(); g.arc(q[0], q[1], r + 1.6, 0, 7); g.fillStyle = `rgba(${INK},${0.8 * a * a})`; g.fill();
      g.beginPath(); g.arc(q[0], q[1], r, 0, 7);
      if (dt.k === "grasp") { g.fillStyle = rgba(col, a); g.fill(); }
      else { g.fillStyle = `rgba(${INK},${a})`; g.fill(); g.strokeStyle = rgba(col, a); g.lineWidth = small ? 1.2 : 1.8; g.stroke(); }
    }
    if (hot != null && !all) for (const rg of this.rings) {       // a gripper row: where the gripper was
      if (rg.g !== hot) continue;
      const q = proj(rg.p); if (!q) continue;
      g.beginPath(); g.arc(q[0], q[1], small ? 7 : 11, 0, 7);
      g.strokeStyle = `rgba(${INK},.8)`; g.lineWidth = small ? 3 : 4.4; g.stroke();
      g.strokeStyle = rgba(ARM[rg.arm] || PLAIN, 1); g.lineWidth = small ? 1.4 : 2; g.stroke();
    }
    // numbered badges at the starts; one that would sit on another moves aside
    badges.sort((a, b) => a.it.g - b.it.g);
    const placed = [];
    g.textAlign = "center"; g.textBaseline = "middle"; g.font = `600 ${small ? 7.5 : 10.5}px ${this.font}`;
    for (const b of badges) {
      let x = b.x, y = b.y;
      for (let t = 0; t < 8 && placed.some((p) => Math.hypot(p[0] - x, p[1] - y) < br * 2 + 1); t++) { const ang = -Math.PI / 2 + (t * Math.PI) / 3; x = b.x + Math.cos(ang) * (br * 2 + 2); y = b.y + Math.sin(ang) * (br * 2 + 2); }
      placed.push([x, y]);
      g.beginPath(); g.arc(x, y, br + 1.5, 0, 7); g.fillStyle = `rgba(${INK},${0.85 * b.a})`; g.fill();
      g.beginPath(); g.arc(x, y, br, 0, 7); g.fillStyle = rgba(ARM[b.it.arm] || PLAIN, b.a < 1 ? 0.45 : 1); g.fill();
      g.fillStyle = `rgba(${INK},${b.a < 1 ? 0.7 : 1})`; g.fillText(String(b.it.n), x, y + 0.5);
    }
    if (this.pin != null && !all) for (const it of this.items) {  // the marker runs along the pinned path
      if (it.g !== this.pin) continue;
      const lim = this.pinU * it.len;
      let i = 1; while (i < it.cum.length - 1 && it.cum[i] < lim) i++;
      const a = it.pts[i - 1], b = it.pts[i], t = clamp((lim - it.cum[i - 1]) / (it.cum[i] - it.cum[i - 1] || 1), 0, 1);
      const q = proj([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); if (!q) continue;
      g.beginPath(); g.arc(q[0], q[1], small ? 5.5 : 8.5, 0, 7); g.fillStyle = `rgba(${INK},.92)`; g.fill();
      g.strokeStyle = rgba(ARM[it.arm] || PLAIN, 1); g.lineWidth = small ? 1.4 : 2; g.stroke();
      g.beginPath(); g.arc(q[0], q[1], small ? 1.6 : 2.6, 0, 7); g.fillStyle = rgba(ARM[it.arm] || PLAIN, 1); g.fill();
    }
  }
}

async function mount(fig) {
  const ids = fig.dataset.runs.trim().split(/\s+/), root = fig.dataset.root || "";
  if (!("DecompressionStream" in window)) { fig.classList.add("r3d-failed"); return; }   // very old browsers: the text stays
  let metas;
  try {
    metas = await Promise.all(ids.map((id) => fetch(root + id + "/run.json").then((r) => { if (!r.ok) throw r.status; return r.json(); })));
    if (metas.some((m) => m.schema !== "ora-site.run3d.v2")) throw new Error("schema");
  } catch (e) { fig.classList.add("r3d-failed"); return; }
  const grid = el("div", "r3d-grid");
  fig.insertBefore(grid, fig.querySelector("figcaption"));
  let S, panels;
  try { S = sharedView(metas); panels = metas.map((m, i) => new Panel(grid, root + ids[i] + "/", m, S)); }
  catch (e) { grid.remove(); fig.classList.add("r3d-failed"); return; }   // no WebGL: the text fallback stays
  fig.classList.add("r3d-on");
  fig.r3d = { S, panels };
  panels.forEach((p) => { p.syncControls(); p.select(-1); });
}

function init() {
  const figs = document.querySelectorAll("figure.r3d[data-runs]");
  if (!("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    mount(e.target);
  }), { rootMargin: "400px 0px" });
  figs.forEach((f) => io.observe(f));
}
init();
