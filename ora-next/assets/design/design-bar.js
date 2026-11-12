/* Design preview bar (pre-launch tool): switch the site's typefaces live and keep the choice across pages.
   Loaded without defer in <head>, so the choice applies before first paint. One file for the ORA site and the
   FastRUA page (same origin, so localStorage carries the choice between them). Remove the <script> tag at launch.

   Choices (data attributes on <html>; also ?font=…&labels=…&mark=… in the URL, which wins and is saved):
     font    geist | plex | archivo     the text family and its monospace companion
     labels  mono | pixel               small data labels in the monospace, or in Departure Mono (a pixel face)
     mark    type | pixel               the ORA wordmark set in the text family, or drawn on the logo's pixel grid
   The script tag may carry data-labels="<selector list>": the label elements, snapped to 11 px in pixel mode. */
(function () {
  var me = document.currentScript, base = me.src.replace(/[^/]*$/, ""), root = document.documentElement;
  var KEY = "fastrua-design", GROUPS = [
    { key: "font", name: "Text", options: [["geist", "Geist"], ["plex", "IBM Plex"], ["archivo", "Archivo"]] },
    { key: "labels", name: "Labels", options: [["mono", "Mono"], ["pixel", "Pixel"]] },
    { key: "mark", name: "Wordmark", options: [["type", "Type"], ["pixel", "Pixel"]], needs: "[data-wordmark]" }
  ];
  var WEB = {
    plex: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap",
    archivo: "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..900&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
  };
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}
  try {
    var q = new URLSearchParams(location.search);
    GROUPS.forEach(function (g) { var v = q.get(g.key); if (v && g.options.some(function (o) { return o[0] === v; })) state[g.key] = v; });
  } catch (e) {}

  var FALL = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif', MFALL = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
  var labels = me.getAttribute("data-labels") || "";
  var css = [
    '@font-face{font-family:"Departure Mono";src:url("' + base + 'DepartureMono-Regular.woff2") format("woff2");font-display:swap}',
    ':root[data-font="plex"]{--sans:"IBM Plex Sans",' + FALL + ';--mono:"IBM Plex Mono",' + MFALL + "}",
    ':root[data-font="plex"] :is(h1,h2,h3){letter-spacing:-.02em}',
    ':root[data-font="archivo"]{--sans:"Archivo",' + FALL + ';--mono:"IBM Plex Mono",' + MFALL + "}",
    ':root[data-font="archivo"] :is(h1,h2,h3){font-stretch:112%;letter-spacing:-.025em}',
    ':root[data-font="archivo"] h1.wordmark{font-stretch:125%;font-weight:800;letter-spacing:-.04em}',
    ':root[data-labels="pixel"]{--label:"Departure Mono",var(--mono)}',
    labels ? ':root[data-labels="pixel"] :is(' + labels + "){font-size:11px;letter-spacing:.02em;-webkit-font-smoothing:none}" : "",
    ".wm-pix{display:none}",
    ':root[data-mark="pixel"] .wm-type{display:none}',
    ':root[data-mark="pixel"] .wm-pix{display:inline-block}',
    /* the bar: its own system font and neutral colours, so it never changes with the choice */
    "#dbar{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147483000;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px 14px;max-width:calc(100vw - 16px);padding:7px 10px;background:#161616;border:1px solid #2e2e2e;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.55);font:500 12px/1 system-ui,-apple-system,'Segoe UI',sans-serif;color:#b0b0b0;letter-spacing:0}",
    "#dbar[hidden]{display:none}",
    "#dbar .g{display:flex;align-items:center;gap:6px}",
    "#dbar .seg{display:flex;border:1px solid #2e2e2e;border-radius:7px;overflow:hidden}",
    "#dbar button{font:inherit;color:#b0b0b0;background:none;border:0;padding:6px 9px;cursor:pointer;white-space:nowrap}",
    "#dbar .seg button+button{border-left:1px solid #2e2e2e}",
    "#dbar .seg button[aria-pressed=true]{background:#f0f0f0;color:#0a0a0a}",
    "#dbar button:focus-visible,#dchip:focus-visible{outline:2px solid #48b0b4;outline-offset:2px}",
    "#dbar .x{padding:6px 7px;border:1px solid #2e2e2e;border-radius:7px}",
    "#dchip{position:fixed;right:12px;bottom:12px;z-index:2147483000;font:600 12px/1 system-ui,sans-serif;color:#b0b0b0;background:#161616;border:1px solid #2e2e2e;border-radius:8px;padding:8px 10px;cursor:pointer}",
    "#dchip[hidden]{display:none}",
    "@media print{#dbar,#dchip{display:none}}"
  ].join("\n");
  var st = document.createElement("style"); st.id = "design-bar-css"; st.textContent = css; document.head.appendChild(st);

  var loaded = {};
  function fonts(name) {
    if (!WEB[name] || loaded[name]) return;
    loaded[name] = 1;
    var l = document.createElement("link"); l.rel = "stylesheet"; l.href = WEB[name]; document.head.appendChild(l);
  }
  function apply() {
    GROUPS.forEach(function (g) {
      var v = state[g.key];
      if (v && v !== g.options[0][0]) root.setAttribute("data-" + g.key, v); else root.removeAttribute("data-" + g.key);
    });
    fonts(state.font);
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  apply();

  function build() {
    var bar = document.createElement("div"); bar.id = "dbar"; bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Design preview");
    var chip = document.createElement("button"); chip.id = "dchip"; chip.type = "button"; chip.textContent = "Aa"; chip.title = "Design preview: typefaces";
    GROUPS.forEach(function (g) {
      if (g.needs && !document.querySelector(g.needs)) return;
      var wrap = document.createElement("span"); wrap.className = "g";
      var name = document.createElement("span"); name.textContent = g.name; wrap.appendChild(name);
      var seg = document.createElement("span"); seg.className = "seg";
      g.options.forEach(function (o) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = o[1];
        b.setAttribute("aria-pressed", String((state[g.key] || g.options[0][0]) === o[0]));
        b.addEventListener("click", function () {
          state[g.key] = o[0]; apply();
          seg.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        });
        seg.appendChild(b);
      });
      wrap.appendChild(seg); bar.appendChild(wrap);
    });
    var link = document.createElement("button"); link.type = "button"; link.className = "x"; link.textContent = "Copy link"; link.title = "Copy a link that opens this page with these choices";
    link.addEventListener("click", function () {
      var u = new URL(location.href);
      GROUPS.forEach(function (g) { u.searchParams.set(g.key, state[g.key] || g.options[0][0]); });
      var done = function () { link.textContent = "Copied"; setTimeout(function () { link.textContent = "Copy link"; }, 1200); };
      try { navigator.clipboard.writeText(u.href).then(done, function () {}); } catch (e) {}
    });
    bar.appendChild(link);
    var hide = document.createElement("button"); hide.type = "button"; hide.className = "x"; hide.textContent = "Hide"; hide.title = "Collapse the bar";
    function show(open) {
      bar.hidden = !open; chip.hidden = open; state.bar = open ? "open" : "closed";
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    }
    hide.addEventListener("click", function () { show(false); });
    chip.addEventListener("click", function () { show(true); });
    bar.appendChild(hide);
    document.body.appendChild(bar); document.body.appendChild(chip);
    show(state.bar ? state.bar === "open" : window.innerWidth >= 640);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();
