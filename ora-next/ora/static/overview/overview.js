// Overview page motion: the 3D section (lazy) and the numbers that count up once.
// Everything here is an enhancement: with JavaScript off the page reads the same, and nothing waits on it to show.
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const idle = (f) => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 1200 }) : setTimeout(f, 300));

// 1. The 3D section: load three.js and the data only once the page itself has loaded and the scene is near view.
const box = document.getElementById("scene");
if (box && !("IntersectionObserver" in window)) box.classList.add("nogl");
if (box && "IntersectionObserver" in window) {
  const go = () => import("./scene.js")
    .then((m) => m.start(box, { reduce }))
    .then((s) => { if (!s) box.classList.add("nogl"); })
    .catch(() => box.classList.add("nogl"));
  const io = new IntersectionObserver((es) => {
    if (!es.some((e) => e.isIntersecting)) return;
    io.disconnect();
    if (document.readyState === "complete") idle(go); else addEventListener("load", () => idle(go), { once: true });
  }, { rootMargin: "300px 0px" });
  io.observe(box);
}

// 2. The numbers count up once, the first time they come into view.
if (!reduce && "IntersectionObserver" in window) {
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    const el = e.target, to = parseFloat(el.dataset.to), dec = (el.dataset.to.split(".")[1] || "").length;
    const t0 = performance.now(), dur = 1300 + 120 * [...el.closest(".nums").querySelectorAll("[data-to]")].indexOf(el);
    el.textContent = (0).toFixed(dec);
    const step = (now) => {
      const x = Math.min(1, (now - t0) / dur);
      el.textContent = (to * ease(x)).toFixed(dec);
      if (x < 1) requestAnimationFrame(step); else el.textContent = el.dataset.to;
    };
    requestAnimationFrame(step);
  }), { threshold: 0.6 });
  document.querySelectorAll(".nums [data-to]").forEach((el) => io.observe(el));
}
