// Run3D: a recorded ORA run as a 3D scene with the agent's decision timeline. Mounts into any
//   <figure class="r3d" data-runs="RUN_ID [RUN_ID]" data-root="…/static/gallery/runs/">
// One run id: one panel. Two: compare, side by side (stacked on phones), each with its own timeline, one shared camera.
// Data (run.json + frames) loads when the figure comes near the viewport; rendering runs only while it is on screen.
// Data: site/gallery.py. The model's reasoning or thinking text is not in it.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";

const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ARM = { left: new THREE.Color(0xc6011f), right: new THREE.Color(0x008e8c) };
const MARK = new THREE.Color(0x48b0b4), PAST = new THREE.Color(0x8a8a8a);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
// A gripper that stopped short of closing: the receipt says not_reached, which is what holding an object looks like.
const held = (x) => x.a === "set_gripper" && x.code === "gripper_stalled_before_target";
const obsNo = (id) => (id ? String(+id.split("-").pop()) : "?");

const POINT_VS = `
uniform float uSize, uScale;
attribute vec3 rgb;
varying vec3 vC; varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float up = smoothstep(0.003, 0.012, position.y);
  gl_PointSize = max(1.0, uSize * uScale / -mv.z * mix(0.7, 1.0, up));
  float l = dot(rgb, vec3(0.299, 0.587, 0.114));
  vC = mix(vec3(l), rgb, 0.72) * 0.92;
  float r = length(position.xz * vec2(1.0, 1.3));
  vA = (1.0 - smoothstep(0.55, 0.85, r)) * mix(0.55, 1.0, up);
}`;
const POINT_FS = `
varying vec3 vC; varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.3, d) * vA;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vC, a);
}`;
const LINE_VS = `
uniform float uSize, uScale, uProg;
attribute float t; attribute vec3 col;
varying vec3 vC; varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uSize * uScale / -mv.z);
  vC = col; vA = step(t, uProg);
}`;
const LINE_FS = `
uniform float uAlpha;
varying vec3 vC; varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.7, d) * vA * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vC, a);
}`;
const MARK_FS = `
uniform float uAlpha;
varying vec3 vC; varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float ring = smoothstep(0.16, 0.06, abs(d - 0.66)), core = smoothstep(0.3, 0.2, d);
  float rim = smoothstep(1.0, 0.86, d) * (1.0 - min(1.0, ring + core));
  float a = max(min(1.0, ring + core * vA), 0.7 * rim) * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(mix(vec3(0.02), vC, min(1.0, ring + core * vA)), a);
}`;
const MARK_VS = `
uniform float uSize, uScale;
attribute vec3 col; attribute float fill;
varying vec3 vC; varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uScale / -mv.z;
  vC = col; vA = fill;
}`;

// Resample polylines evenly (every `step` metres) into point sprites with a running 0..1 parameter.
function sample(lines, color, step = 0.003) {
  const p = [], c = [], t = [];
  let total = 0;
  const segs = [];
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    segs.push([a, b, L, total]); total += L;
  }
  for (const [a, b, L, s0] of segs) {
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      p.push(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
      c.push(color.r, color.g, color.b);
      t.push(total ? (s0 + L * f) / total : 1);
    }
  }
  return { p, c, t };
}

function geom(attrs) {
  const g = new THREE.BufferGeometry();
  for (const [k, v, n] of attrs) g.setAttribute(k, new THREE.BufferAttribute(v, n));
  return g;
}

async function decodeJpeg(url, w, h) {
  const img = new Image();
  img.decoding = "async"; img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

// --------------------------------------------------------------------------------------------------------------------
class Panel {
  constructor(host, base, meta, shared) {
    this.base = base; this.m = meta; this.shared = shared;
    this.n = meta.timeline.length; this.sel = -1; this.frames = new Map(); this.playing = false;
    const solved = meta.official || meta.after_limit;     // after_limit: the benchmark's check passed after its step limit
    const verdict = meta.official ? "solved" : meta.after_limit ? "solved" : "not solved";
    const mode = meta.mode === "code" ? "Code mode" : "Tool calls";
    const unit = meta.mode === "code" ? "program" : "tool call";
    this.unit = unit;
    const root = this.root = el("div", "r3d-panel");
    root.innerHTML = `
      <div class="r3d-head"><b>${mode} · ${meta.decisions} decisions, <span class="${solved ? "ok" : "no"}">${verdict}</span></b>
        <span>${esc(meta.task.replace(/_/g, " "))} · layout ${meta.layout} · ${esc(meta.model)} · ${meta.motions} motions${meta.after_limit && !meta.official ? ' · <i class="r3d-late">after step limit</i>' : ""}</span></div>
      <div class="r3d-view"><div class="r3d-legend"><i class="l"></i>left arm <i class="r"></i>right arm <i class="g"></i>grasp <i class="u"></i>release</div>
        <p class="r3d-hint">Drag to rotate · double-click to reset</p></div>
      <div class="r3d-bar"><div class="r3d-ctl">
        <button type="button" data-k="prev" aria-label="Previous decision">‹</button>
        <button type="button" data-k="play" aria-label="Play through the decisions">▶</button>
        <button type="button" data-k="next" aria-label="Next decision">›</button></div>
        <div class="r3d-strip" role="group" aria-label="Decisions"></div></div>
      <div class="r3d-detail" aria-live="polite"></div>`;
    host.appendChild(root);
    this.view = root.querySelector(".r3d-view");
    this.detail = root.querySelector(".r3d-detail");
    const strip = root.querySelector(".r3d-strip");
    this.ticks = meta.timeline.map((d, i) => {
      const bad = d.motions.some((x) => !x.refused && x.status && x.status !== "reached" && !held(x));
      const ref = d.motions.some((x) => x.refused) || d.before.some((b) => !b.ok);
      const b = el("button", "r3d-tick" + (bad ? " bad" : "") + (ref ? " ref" : ""));
      b.type = "button"; b.title = `Decision ${i + 1}: ${d.label}`; b.setAttribute("aria-label", b.title);
      b.addEventListener("click", () => { this.stop(); this.select(i); });
      strip.appendChild(b);
      return b;
    });
    const end = el("button", "r3d-tick end", "");
    end.type = "button"; end.title = "End of the run"; end.setAttribute("aria-label", end.title);
    end.addEventListener("click", () => { this.stop(); this.select(this.n); });
    strip.appendChild(end); this.ticks.push(end);
    root.querySelector('[data-k="prev"]').addEventListener("click", () => { this.stop(); this.select(Math.max(0, this.sel - 1)); });
    root.querySelector('[data-k="next"]').addEventListener("click", () => { this.stop(); this.select(Math.min(this.n, this.sel + 1)); });
    this.playBtn = root.querySelector('[data-k="play"]');
    this.playBtn.addEventListener("click", () => (this.playing ? this.stop() : this.play()));
    root.tabIndex = -1;
    root.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { this.stop(); this.select(Math.min(this.n, this.sel + 1)); e.preventDefault(); }
      if (e.key === "ArrowLeft") { this.stop(); this.select(Math.max(0, this.sel - 1)); e.preventDefault(); }
    });
    this.initGL();
  }

  initGL() {
    const canvas = el("canvas", "r3d-gl");
    canvas.setAttribute("aria-hidden", "true");
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setClearColor(0, 0);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.view.prepend(canvas);
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 2, 0.05, 20);
    this.scale = { value: 800 };
    this.pointMat = new THREE.ShaderMaterial({ uniforms: { uSize: { value: 0.0058 }, uScale: this.scale },
      vertexShader: POINT_VS, fragmentShader: POINT_FS, transparent: true, depthWrite: false });
    this.prog = { value: 1 };
    this.curMat = new THREE.ShaderMaterial({ uniforms: { uSize: { value: 0.0058 }, uScale: this.scale, uProg: this.prog, uAlpha: { value: 1 } },
      vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, depthTest: false });
    this.pastMat = new THREE.ShaderMaterial({ uniforms: { uSize: { value: 0.0032 }, uScale: this.scale, uProg: { value: 1 }, uAlpha: { value: 0.45 } },
      vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, depthTest: false });
    this.markMat = new THREE.ShaderMaterial({ uniforms: { uSize: { value: 0.03 }, uScale: this.scale, uAlpha: { value: 1 } },
      vertexShader: MARK_VS, fragmentShader: MARK_FS, transparent: true, depthWrite: false, depthTest: false });
    this.cloud = null; this.cur = null; this.past = null; this.marks = null;
    // focus: where the run's paths are, pulled towards the table centre
    const all = this.m.timeline.flatMap((d) => Object.values(d.paths).flat(2));
    const c = all.length ? all.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((v) => v / all.length) : [0, 0.05, 0];
    this.focus = new THREE.Vector3(c[0] * 0.6, 0.04, c[2] * 0.6 + 0.06);
    // orbit (shared between the panels of a compare)
    const S = this.shared;
    let drag = null, lastTap = 0;
    canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); this.view.classList.add("grab"); });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      S.goal.az = Math.max(-1.25, Math.min(1.25, S.goal.az - dx * 0.0045));
      if (e.pointerType !== "touch") S.goal.el = Math.max(0.16, Math.min(1.25, S.goal.el + dy * 0.004));
      S.wakeAll();
    });
    const end = (e) => {
      if (drag && e.pointerId === drag.id) drag = null;
      this.view.classList.remove("grab");
      if (e.type === "pointerup" && e.pointerType === "touch") { if (e.timeStamp - lastTap < 320) S.reset(); lastTap = e.timeStamp; }
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("dblclick", () => S.reset());
    this.visible = true; this.raf = 0; this.last = 0;
    new IntersectionObserver((es) => { this.visible = es[0].isIntersecting; if (this.visible) this.wake(); }).observe(this.view);
    new ResizeObserver(() => this.wake()).observe(this.view);
    S.panels.push(this);
  }

  async frame(k) {
    if (this.frames.has(k)) return this.frames.get(k);
    const job = (async () => {
      const cam = this.m.camera, f = this.m.frames[k];
      const zipped = cam.depth === "zlib-u16le-mm";            // newer data: zlib-compressed depth (about 7 kB a frame)
      const [buf, rgba] = await Promise.all([
        fetch(this.base + f.file + (zipped ? ".dz" : ".bin")).then((r) => (zipped
          ? new Response(r.body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer() : r.arrayBuffer())),
        decodeJpeg(this.base + f.file + ".jpg", cam.w, cam.h),
      ]);
      const dep = new Uint16Array(buf), K = cam.K, T = cam.T, [x0, y0] = cam.rect, s = cam.stride, [ox, oy, oz] = cam.origin;
      const pos = new Float32Array(dep.length * 3), col = new Float32Array(dep.length * 3);
      let n = 0;
      for (let j = 0; j < cam.h; j++) for (let i = 0; i < cam.w; i++) {
        const q = j * cam.w + i, d = dep[q] / 1000;
        if (!d) continue;
        const xc = (x0 + i * s - K[0][2]) * d / K[0][0], yc = (y0 + j * s - K[1][2]) * d / K[1][1];
        const wx = T[0][0] * xc + T[0][1] * yc + T[0][2] * d + T[0][3];
        const wy = T[1][0] * xc + T[1][1] * yc + T[1][2] * d + T[1][3];
        const wz = T[2][0] * xc + T[2][1] * yc + T[2][2] * d + T[2][3];
        pos[n * 3] = wx - ox; pos[n * 3 + 1] = wz - oz; pos[n * 3 + 2] = -(wy - oy);
        col[n * 3] = rgba[q * 4] / 255; col[n * 3 + 1] = rgba[q * 4 + 1] / 255; col[n * 3 + 2] = rgba[q * 4 + 2] / 255;
        n++;
      }
      return geom([["position", pos.subarray(0, n * 3), 3], ["rgb", col.subarray(0, n * 3), 3]]);
    })();
    this.frames.set(k, job);
    return job;
  }

  async select(i) {
    if (i === this.sel) return;
    this.sel = i;
    const end = i >= this.n, d = end ? null : this.m.timeline[i];
    this.ticks.forEach((t, k) => t.setAttribute("aria-current", k === i ? "true" : "false"));
    const tk = this.ticks[i], st = tk.parentElement;             // keep the tick in view inside the strip, not the page
    if (tk.offsetTop < st.scrollTop || tk.offsetTop + tk.offsetHeight > st.scrollTop + st.clientHeight)
      st.scrollTop = tk.offsetTop - st.clientHeight / 2;
    this.detail.innerHTML = end ? this.endHtml() : this.decisionHtml(d);
    // paths: this decision in its arm colours, the ones before it in grey
    const before = this.m.timeline.slice(0, end ? this.n : i);
    const pastLines = [];
    for (const b of before) for (const lines of Object.values(b.paths)) pastLines.push(...lines);
    const P = sample(pastLines, PAST, 0.004);
    this.swap("past", P.p.length ? new THREE.Points(geom([["position", new Float32Array(P.p), 3], ["col", new Float32Array(P.c), 3], ["t", new Float32Array(P.t), 1]]), this.pastMat) : null);
    if (d) {
      const parts = Object.entries(d.paths).map(([arm, lines]) => sample(lines, ARM[arm] || ARM.left));
      const p = parts.flatMap((x) => x.p), c = parts.flatMap((x) => x.c), t = parts.flatMap((x) => x.t);
      this.swap("cur", p.length ? new THREE.Points(geom([["position", new Float32Array(p), 3], ["col", new Float32Array(c), 3], ["t", new Float32Array(t), 1]]), this.curMat) : null);
      const mk = d.marks;
      this.swap("marks", mk.length ? new THREE.Points(geom([["position", new Float32Array(mk.flatMap((x) => x.p)), 3],
        ["col", new Float32Array(mk.flatMap(() => [MARK.r, MARK.g, MARK.b])), 3], ["fill", new Float32Array(mk.map((x) => (x.k === "grasp" ? 1 : 0))), 1]]), this.markMat) : null);
    } else { this.swap("cur", null); this.swap("marks", null); }
    this.prog.value = REDUCE ? 1 : 0;
    this.drawT0 = performance.now();
    const k = end ? this.m.end.frame : d.frame;
    const g = await this.frame(k);
    if (this.sel !== i) return;
    if (!this.cloud) { this.cloud = new THREE.Points(g, this.pointMat); this.scene.add(this.cloud); }
    else this.cloud.geometry = g;
    this.view.classList.add("live");
    this.wake();
    // fetch the next frame ahead of time
    const nx = this.m.timeline[i + 1]; if (nx) this.frame(nx.frame);
  }

  swap(key, obj) {
    if (this[key]) { this.scene.remove(this[key]); this[key].geometry.dispose(); }
    this[key] = obj;
    if (obj) this.scene.add(obj);
  }

  decisionHtml(d) {
    const m = this.m, f = m.frames[d.frame];
    const seen = f.obs === d.obs ? `observation ${obsNo(d.obs)}` :
      `observation ${obsNo(d.obs)} <span class="dim">(cloud: nearest recorded scene, observation ${obsNo(f.obs)})</span>`;
    let h = `<div class="r3d-dh"><b>Decision ${d.i} of ${this.n}</b> <code>${esc(d.label)}</code><span>saw ${seen}</span></div>`;
    if (d.before.length) {
      const items = d.before.map((b) => `<span class="${b.ok ? "" : "x"}">${esc(b.label)}${b.ok ? "" : ` ✕ ${esc(b.why || "refused")}`}</span>`).join("");
      h += `<details class="r3d-before"><summary>${d.before.length} ${this.unit}${d.before.length > 1 ? "s" : ""} before it, without motion</summary><div>${items}</div></details>`;
    }
    if (d.program) for (const p of d.program)
      h += `<details class="r3d-code"><summary>Program <code>${esc(p.path)}</code> · ${p.lines} lines</summary><pre><code>${esc(p.text)}</code></pre></details>`;
    if (d.call) h += `<details class="r3d-code"><summary>Call <code>${esc(d.call.name)}</code> · arguments</summary><pre><code>${esc(d.call.args)}</code></pre></details>`;
    const mot = d.motions.map((x) => x.refused
      ? `<li><span class="st ref">refused</span><code>${esc(x.tool || x.a)}</code> ${esc(x.code || "")}<em>${esc(x.why || "")}</em></li>`
      : `<li><span class="st ${x.status === "reached" ? "ok" : held(x) ? "" : "bad"}">${esc(held(x) ? "stalled" : x.status || "?")}</span><code>${esc(x.a)}</code> ${esc(x.arms.join(" + "))}${x.code ? ` · ${esc(x.code)}` : ""}<em>${esc(x.sum)}</em></li>`).join("");
    h += `<div class="r3d-sec">Motions, with the supervisor's receipts</div><ol class="r3d-mot">${mot}</ol>`;
    if (d.out) h += `<details class="r3d-out"${m.mode === "code" ? " open" : ""}><summary>${m.mode === "code" ? `Printed output, last lines${d.exit ? ` · exit ${d.exit}` : ""}` : "Result"}</summary><pre>${esc(d.out)}</pre></details>`;
    return h;
  }

  endHtml() {
    const m = this.m;
    const v = m.official ? "Solved within the official step limit." : m.after_limit ? "Solved, after the official step limit." : "Not solved.";
    return `<div class="r3d-dh"><b>End of the run</b><span>observation ${obsNo(m.end.obs)}</span></div>
      <p class="r3d-endv">${esc(v)} ${m.decisions} decisions, ${m.motions} motions, ${m.model_calls ?? "?"} model calls. The benchmark's own check gave the verdict.</p>
      <p class="dim">“${esc(m.instruction || "")}”</p>`;
  }

  play() {
    this.playing = true; this.playBtn.textContent = "❚❚"; this.playBtn.setAttribute("aria-label", "Pause");
    const dwell = Math.max(800, Math.min(2400, 40000 / Math.max(1, this.n)));
    const step = () => {
      if (!this.playing) return;
      if (this.sel >= this.n) { this.stop(); return; }
      this.select(this.sel + 1);
      this.timer = setTimeout(step, dwell);
    };
    if (this.sel >= this.n) this.sel = -1;
    step();
  }

  stop() { this.playing = false; clearTimeout(this.timer); this.playBtn.textContent = "▶"; this.playBtn.setAttribute("aria-label", "Play through the decisions"); }

  wake() { if (!this.raf && this.visible && !document.hidden) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.draw(t)); } }

  draw(now) {
    this.raf = 0;
    const r = this.view.getBoundingClientRect();
    if (r.width && r.height && (r.width !== this.w || r.height !== this.h)) {
      this.w = r.width; this.h = r.height;
      this.renderer.setSize(r.width, r.height, false);
      this.camera.aspect = r.width / r.height;
      const ty = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      this.dist = Math.max(0.27 / ty, (r.width < 600 ? 0.4 : 0.52) / (ty * this.camera.aspect)) + 0.25;
      this.camera.updateProjectionMatrix();
      this.scale.value = (r.height * this.renderer.getPixelRatio()) / (2 * ty);
    }
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const S = this.shared, moving = S.step(dt, now);
    let anim = false;
    if (this.prog.value < 1) { this.prog.value = Math.min(1, (now - this.drawT0) / 900); anim = true; }
    const v = S.view, f = this.focus, D = this.dist || 2;
    this.camera.position.set(f.x + D * Math.cos(v.el) * Math.sin(v.az), f.y + D * Math.sin(v.el), f.z + D * Math.cos(v.el) * Math.cos(v.az));
    this.camera.lookAt(f);
    this.renderer.render(this.scene, this.camera);
    if (moving || anim) this.wake();
  }
}

// One camera for the panels of a figure: rotate one and the others follow.
function sharedCamera() {
  const home = { az: -0.5, el: 0.66 };
  const S = { view: { ...home }, goal: { ...home }, panels: [], t: 0 };
  S.wakeAll = () => S.panels.forEach((p) => p.wake());
  S.reset = () => { S.goal.az = home.az; S.goal.el = home.el; S.wakeAll(); };
  S.step = (dt, now) => {
    if (now === S.t) return S.moving;      // both panels draw in the same frame: step once
    S.t = now;
    const k = 1 - Math.pow(0.0009, dt);
    S.view.az += (S.goal.az - S.view.az) * k; S.view.el += (S.goal.el - S.view.el) * k;
    S.moving = Math.abs(S.goal.az - S.view.az) + Math.abs(S.goal.el - S.view.el) > 1e-4;
    if (S.moving) S.panels.forEach((p) => p.wake());
    return S.moving;
  };
  return S;
}

async function mount(fig) {
  const ids = fig.dataset.runs.trim().split(/\s+/), root = fig.dataset.root || "";
  if (!("DecompressionStream" in window)) { fig.classList.add("r3d-failed"); return; }   // very old browsers: the text stays
  let metas;
  try { metas = await Promise.all(ids.map((id) => fetch(root + id + "/run.json").then((r) => { if (!r.ok) throw r.status; return r.json(); }))); }
  catch (e) { fig.classList.add("r3d-failed"); return; }
  const grid = el("div", "r3d-grid");
  fig.insertBefore(grid, fig.querySelector("figcaption"));
  const S = sharedCamera();
  let panels;
  try { panels = metas.map((m, i) => new Panel(grid, root + ids[i] + "/", m, S)); }
  catch (e) { grid.remove(); fig.classList.add("r3d-failed"); return; }   // no WebGL: the text fallback stays
  fig.classList.add("r3d-on");
  panels.forEach((p) => p.select(0));
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
