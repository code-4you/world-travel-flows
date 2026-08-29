/* World Travel Flows — every cross-border trip on Earth, 1995-2022, from the
 * Global Transnational Mobility Dataset 2.0 (Recchi, Deutschmann & Vespe).
 * Sibling of World Migration Flows. MIT licensed. */

"use strict";

/* Multi-year periods for the Decade-style dropdown */
const PERIODS = [
  { id: "1995_2000", label: "1995–2000" },
  { id: "2000_2010", label: "2000–2010" },
  { id: "2010_2020", label: "2010–2020" },
  { id: "2020_2023", label: "2020–2022" },
];
const EARLY_PERIODS = [];
const ALL_PERIODS = () => [...EARLY_PERIODS, ...PERIODS];
/* Whole-map aggregate view; in the Decade dropdown but not the play cycle */
const TOTAL_PERIOD = { id: "1995_2023", label: "All years (1995–2022)" };
/* Single-year transitions: UNU-CRIS annual series 1960-1989, then the
 * Gaskin & Abel deep-learning estimates for 1990-2023 */
const YEAR_MIN = 1995, YEAR_MAX = 2023;
const YEAR_PERIODS = Array.from({ length: YEAR_MAX - YEAR_MIN }, (_, i) => {
  const y = YEAR_MIN + i;
  return { id: `${y}_${y + 1}`, label: `${y}–${y + 1}` };
});
function isYearId(id) {
  const m = /^(\d{4})_(\d{4})$/.exec(id || "");
  return !!m && +m[2] === +m[1] + 1;
}
function periodLabel(id) {
  if (id === TOTAL_PERIOD.id) return "1995–2022";
  const p = ALL_PERIODS().find((x) => x.id === id) || YEAR_PERIODS.find((x) => x.id === id);
  return p ? p.label : id.replace("_", "–");
}
/* Named migration events for the Events dropdown: year range (start years of
 * yearly transitions) and the countries the view focuses on */
const EVENTS = [
  { id: "sept11", name: "9/11 aftermath", y0: 2001, y1: 2002, c: ["US"] },
  { id: "sars", name: "SARS outbreak", y0: 2003, y1: 2003, c: ["CN", "HK"] },
  { id: "china-boom", name: "Chinese tourism boom", y0: 2004, y1: 2019, c: ["CN"] },
  { id: "dubai", name: "Dubai boom", y0: 2013, y1: 2019, c: ["AE"] }, // AE inbound reporting begins ~2013
  { id: "arab-spring", name: "Arab Spring tourism crash", y0: 2011, y1: 2013, c: ["EG", "TN"] },
  { id: "cuba-thaw", name: "US–Cuba thaw", y0: 2015, y1: 2017, c: ["CU"] },
  { id: "covid", name: "COVID-19 travel shutdown", y0: 2020, y1: 2022, c: [] },
  { id: "russia-isolation", name: "Russia isolated", y0: 2022, y1: 2022, c: ["RU"] },
];
const eventYearIds = (ev) => {
  const ids = [];
  for (let y = ev.y0; y <= ev.y1; y++) ids.push(`${y}_${y + 1}`);
  return ids;
};

const DEFAULT_PERIOD = TOTAL_PERIOD.id; // land on the full 1960-2024 view
const FALLBACK_YEAR = "2022_2023"; // newest year

/* data-source notices, switched per view */
const NOTE_MODELED =
  "International visitor flows by country of residence (GTMD 2.0) — trips " +
  "of ANY purpose under 12 months, overnight and same-day, harmonized from " +
  "UN Tourism, air-passenger and migration statistics. Modeled estimates, " +
  "not direct counts.";
const NOTE_REPORTED = NOTE_MODELED;
const PLAY_STEP_MS = 6000; // decades
const YEAR_STEP_MS = 2000; // years
const MAX_PARTICLES = 6800;
const BASE_ZOOM = 1.6;

const COLOR_IN = "rgba(64, 120, 255, 0.55)";
const COLOR_IN_STROKE = "rgba(120, 160, 255, 0.9)";
const COLOR_OUT = "rgba(230, 55, 45, 0.5)";
const COLOR_OUT_STROKE = "rgba(255, 110, 100, 0.9)";
const COLOR_SELECTED = "rgba(255, 206, 58, 0.95)";

const state = {
  period: DEFAULT_PERIOD,
  selected: "", // ISO2 or "" for all
  event: null, // active EVENTS entry, or null
  eventFocus: [], // ISO2 list the active event highlights
  extYears: {}, // reported-data years: {periodId: [covered ISO2s]}
  playing: false,
  playTimer: null,
  flows: {}, // periodId -> flows json
  countries: {},
  routes: [], // {from:{lon,lat}, to, mag, p0,p1,p2 (px), len}
  particles: [], // {r: routeIdx, t, dt}
  circles: [], // {iso2, x, y, r, net, gain}
  hover: null,
};

/* Self-hosted basemap: Natural Earth 50m country polygons rendered as dark
 * shapes — no tile provider, no API key, nothing external to break */
const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {
      countries: { type: "geojson", data: "assets/countries.geojson" },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0a0a0c" } },
      {
        id: "land",
        type: "fill",
        source: "countries",
        paint: { "fill-color": "#212126" },
      },
      {
        id: "borders",
        type: "line",
        source: "countries",
        paint: { "line-color": "#37373e", "line-width": 0.6 },
      },
    ],
  },
  center: [12, 24],
  zoom: BASE_ZOOM,
  minZoom: 0.8,
  maxZoom: 5.5,
  renderWorldCopies: true, // world repeats when panning east/west
  attributionControl: false,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.dragRotate.disable();
map.touchZoomRotate.disableRotation();

const pCanvas = document.getElementById("particles");
const cCanvas = document.getElementById("circles");
const pCtx = pCanvas.getContext("2d");
const cCtx = cCanvas.getContext("2d");
const tooltip = document.getElementById("tooltip");

/* Pre-rendered dot sprites: yellow (default), blue (arriving at the selected
 * country), red (leaving it) */
function makeSprite(core, mid) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 16;
  const g = cv.getContext("2d");
  const grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, core);
  grad.addColorStop(0.35, mid);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 16);
  return cv;
}
const SPRITES = {
  flow: makeSprite("rgba(255, 235, 150, 1)", "rgba(255, 206, 58, 0.8)"),
  in: makeSprite("rgba(190, 210, 255, 1)", "rgba(80, 130, 255, 0.85)"),
  out: makeSprite("rgba(255, 180, 170, 1)", "rgba(240, 70, 55, 0.85)"),
};

function resizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  for (const cv of [pCanvas, cCanvas]) {
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
    cv.style.width = innerWidth + "px";
    cv.style.height = innerHeight + "px";
    cv.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function fmt(n) {
  return (n > 0 ? "+" : "") + n.toLocaleString("en-US");
}

/* ---------- data ---------- */

async function loadPeriod(id) {
  if (!state.flows[id]) {
    const res = await fetch(`data/flows_${id}.json`);
    state.flows[id] = await res.json();
  }
  return state.flows[id];
}

/* Shortest-longitude unwrap so routes cross the nearest edge */
function unwrapLon(fromLon, toLon) {
  let d = toLon - fromLon;
  if (d > 180) return toLon - 360;
  if (d < -180) return toLon + 360;
  return toLon;
}

/* Rebuild route list + particles for current period/selection.
 * flows[a][b] = gross migration b->a, so each direction is its own route. */
function rebuildRoutes() {
  const flows = state.flows[state.period];
  if (!flows) return;
  const C = state.countries;
  const sel = state.selected;
  const [py1, py2] = state.period.split("_").map(Number);
  const span = Math.max(1, (py2 || 0) - (py1 || 0));
  const routes = [];
  let totalMag = 0;

  const focus = state.eventFocus; // multi-country focus from an active event
  const focused = !sel && focus.length > 0;
  for (const a in flows) {
    if (!C[a]) continue;
    for (const b in flows[a]) {
      if (b === a || !C[b]) continue;
      if (sel && a !== sel && b !== sel) continue;
      if (focused && !focus.includes(a) && !focus.includes(b)) continue;
      const mag = flows[a][b]; // gross b -> a
      // in the all-countries view, keep only substantial routes for legibility;
      // cutoffs scale with the period length (a year carries ~1/10 of a decade)
      const min = sel || focused ? 5000 * span : 150000 * span;
      if (mag < min) continue;
      let sprite = SPRITES.flow;
      if (sel) sprite = a === sel ? SPRITES.in : SPRITES.out;
      else if (focused) {
        const toFocus = focus.includes(a), fromFocus = focus.includes(b);
        if (toFocus && !fromFocus) sprite = SPRITES.in;
        else if (fromFocus && !toFocus) sprite = SPRITES.out;
      }
      routes.push({ from: C[b], to: C[a], mag, sprite });
      totalMag += mag;
    }
  }

  const perParticle = Math.max(1080, totalMag / MAX_PARTICLES);
  const particles = [];
  routes.forEach((r, i) => {
    const n = Math.max(1, Math.min(1800, Math.round(r.mag / perParticle)));
    for (let k = 0; k < n; k++) {
      particles.push({
        r: i,
        t: Math.random(),
        o: (Math.random() - 0.5) * 6, // slight perpendicular skew, like the original
        v: 0.85 + Math.random() * 0.3, // tiny speed variation
      });
    }
  });
  state.routes = routes;
  state.particles = particles;
  projectRoutes();
  pCtx.clearRect(0, 0, innerWidth, innerHeight);
}

/* Candidate world-copy offsets; content is drawn once per visible copy */
const KS = [-2, -1, 0, 1, 2];

function worldWidth() {
  return map.project([180, 0]).x - map.project([-180, 0]).x;
}

/* Project route endpoints to screen px; straight lines (p1 = midpoint keeps
 * the quadratic-bezier particle math while degenerating it to a segment) */
function projectRoutes() {
  state.worldW = worldWidth();
  for (const r of state.routes) {
    const p0 = map.project([r.from.lon, r.from.lat]);
    const p2 = map.project([unwrapLon(r.from.lon, r.to.lon), r.to.lat]);
    r.p0 = p0;
    r.p2 = p2;
    r.p1 = { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 };
    r.len = Math.hypot(p2.x - p0.x, p2.y - p0.y) || 1;
    // unit normal, for each particle's slight off-line skew
    r.nx = -(p2.y - p0.y) / r.len;
    r.ny = (p2.x - p0.x) / r.len;
  }
}

/* animate = true when the data changed (period/selection) -> tween radii;
 * false for view changes (pan/zoom), which must track instantly */
function rebuildCircles(animate) {
  const flows = state.flows[state.period];
  if (!flows) return;
  const C = state.countries;
  const sel = state.selected;
  const circles = [];

  // entries: [iso2, grossIn, grossOut, net] — each circle shows BOTH volumes
  const entries = [];
  if (!sel) {
    const gin = {}, gout = {};
    for (const a in flows) {
      for (const b in flows[a]) {
        if (b === a) continue;
        gin[a] = (gin[a] || 0) + flows[a][b];
        gout[b] = (gout[b] || 0) + flows[a][b];
      }
    }
    for (const iso2 in flows) {
      if (!C[iso2]) continue;
      entries.push([iso2, gin[iso2] || 0, gout[iso2] || 0, flows[iso2][iso2] || 0]);
    }
  } else {
    // partners = anyone with a flow to or from the selected country;
    // their in/out are the two directions of the pair with the selection
    const partners = new Set(Object.keys(flows[sel] || {}));
    for (const c in flows) if (flows[c][sel]) partners.add(c);
    partners.delete(sel);
    let inSel = 0, outSel = 0;
    const pEntries = [];
    for (const p of partners) {
      if (!C[p]) continue;
      const ip = (flows[p] || {})[sel] || 0; // selected -> partner
      const op = (flows[sel] || {})[p] || 0; // partner -> selected
      inSel += op;
      outSel += ip;
      pEntries.push([p, ip, op, ip - op]);
    }
    entries.push([sel, inSel, outSel, (flows[sel] || {})[sel] || 0], ...pEntries);
  }
  let maxVol = 1;
  for (const [, gin, gout] of entries) maxVol = Math.max(maxVol, gin, gout);

  state.worldW = worldWidth();
  const zoomScale = Math.pow(2, (map.getZoom() - BASE_ZOOM) * 0.6);
  for (const [iso2, gin, gout, net] of entries) {
    const c = C[iso2];
    const big = Math.max(gin, gout), small = Math.min(gin, gout);
    if (!big) continue;
    const pt = map.project([c.lon, c.lat]);
    const r = (3 + 34 * Math.sqrt(big / maxVol)) * zoomScale;
    circles.push({
      iso2,
      x: pt.x,
      y: pt.y,
      r,
      net,
      gin,
      gout,
      bigIn: gin >= gout, // outer circle color: blue if inflow dominates
      innerRatio: Math.sqrt(small / big), // nested circle, area-true
      balanced: small / big >= 0.95, // near-equal -> half blue / half red
    });
  }
  circles.sort((a, b) => b.r - a.r); // big first so small stay hoverable
  state.circles = circles;
  if (animate) startCircleTween();
  else {
    cancelAnimationFrame(state.tweenRaf);
    rememberRadii();
    drawCircles();
  }
}

/* Smooth ~1s grow/shrink between data states */
const TWEEN_MS = 1000;

function rememberRadii() {
  state.prevRadii = Object.fromEntries(state.circles.map((c) => [c.iso2, c.r]));
}

function startCircleTween() {
  cancelAnimationFrame(state.tweenRaf);
  const prev = state.prevRadii || {};
  for (const c of state.circles) {
    c.r0 = prev[c.iso2] || 0;
    c.r1 = c.r;
  }
  // t0 comes from the rAF callback itself: performance.now() here can be
  // LATER than the first frame's timestamp, which would make t negative,
  // produce negative radii, and crash ctx.arc — killing the animation loop.
  let t0 = null;
  const tick = (now) => {
    if (t0 === null) t0 = now;
    const t = Math.min(1, Math.max(0, (now - t0) / TWEEN_MS));
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
    for (const c of state.circles) c.r = Math.max(0, c.r0 + (c.r1 - c.r0) * e);
    drawCircles();
    if (t < 1) state.tweenRaf = requestAnimationFrame(tick);
    else rememberRadii();
  };
  state.tweenRaf = requestAnimationFrame(tick);
}

/* ---------- drawing ---------- */

function drawCircles() {
  cCtx.clearRect(0, 0, innerWidth, innerHeight);
  const W = state.worldW || Infinity;
  for (const c of state.circles) {
    const selectedOne = c.iso2 === state.selected || state.eventFocus.includes(c.iso2);
    const r = Math.max(0, c.r); // a negative radius would throw and kill drawing
    const bigFill = c.bigIn ? COLOR_IN : COLOR_OUT;
    const bigStroke = c.bigIn ? COLOR_IN_STROKE : COLOR_OUT_STROKE;
    const smallFill = c.bigIn ? COLOR_OUT : COLOR_IN;
    for (const k of KS) {
      const x = c.x + k * W;
      if (x + r < 0 || x - r > innerWidth) continue;
      if (c.balanced) {
        // near-equal in/out: half blue (left) / half red (right)
        cCtx.beginPath();
        cCtx.arc(x, c.y, r, Math.PI / 2, (3 * Math.PI) / 2);
        cCtx.closePath();
        cCtx.fillStyle = COLOR_IN;
        cCtx.fill();
        cCtx.beginPath();
        cCtx.arc(x, c.y, r, -Math.PI / 2, Math.PI / 2);
        cCtx.closePath();
        cCtx.fillStyle = COLOR_OUT;
        cCtx.fill();
      } else {
        cCtx.beginPath();
        cCtx.arc(x, c.y, r, 0, Math.PI * 2);
        cCtx.fillStyle = bigFill;
        cCtx.fill();
        // the smaller flow nested on top, area-proportional
        const ri = r * c.innerRatio;
        if (ri > 1) {
          cCtx.beginPath();
          cCtx.arc(x, c.y, ri, 0, Math.PI * 2);
          cCtx.fillStyle = smallFill;
          cCtx.fill();
        }
      }
      cCtx.beginPath();
      cCtx.arc(x, c.y, r, 0, Math.PI * 2);
      cCtx.lineWidth = selectedOne ? 2.5 : 1;
      cCtx.strokeStyle = selectedOne
        ? COLOR_SELECTED
        : c.balanced
          ? "rgba(200, 200, 210, 0.7)"
          : bigStroke;
      cCtx.stroke();
    }
  }
  if (state.hover) drawHoverRing(state.hover);
}

function drawHoverRing(c) {
  const W = state.worldW || Infinity;
  for (const k of KS) {
    const x = c.x + k * W;
    if (x + c.r < 0 || x - c.r > innerWidth) continue;
    cCtx.beginPath();
    cCtx.arc(x, c.y, c.r + 2, 0, Math.PI * 2);
    cCtx.lineWidth = 2;
    cCtx.strokeStyle = "rgba(255,255,255,0.9)";
    cCtx.stroke();
  }
}

function frame() {
  // crisp dots, no fading trail
  pCtx.clearRect(0, 0, innerWidth, innerHeight);
  pCtx.globalCompositeOperation = "lighter";

  const routes = state.routes;
  const W = state.worldW || Infinity;
  for (const p of state.particles) {
    const r = routes[p.r];
    if (!r || !r.p0) continue;
    p.t += (1.6 * p.v) / r.len; // ~constant px speed
    if (p.t > 1) p.t -= 1;
    const t = p.t, u = 1 - t;
    const x = u * u * r.p0.x + 2 * u * t * r.p1.x + t * t * r.p2.x + r.nx * p.o;
    const y = u * u * r.p0.y + 2 * u * t * r.p1.y + t * t * r.p2.y + r.ny * p.o;
    for (const k of KS) {
      const xx = x + k * W;
      if (xx > -10 && xx < innerWidth + 10) pCtx.drawImage(r.sprite, xx - 2.28, y - 2.28, 4.55, 4.55);
    }
  }
  requestAnimationFrame(frame);
}

/* ---------- interaction ---------- */

function hitTest(mx, my) {
  // smallest circle wins so islands inside big circles stay reachable;
  // every visible world copy is tested
  const W = state.worldW || Infinity;
  let best = null;
  for (const c of state.circles) {
    for (const k of KS) {
      const d = Math.hypot(mx - (c.x + k * W), my - c.y);
      if (d <= Math.max(c.r, 6) && (!best || c.r < best.r)) best = c;
    }
  }
  return best;
}

map.getCanvas().parentElement.addEventListener("mousemove", (e) => {
  const c = hitTest(e.clientX, e.clientY);
  if (c !== state.hover) {
    state.hover = c;
    drawCircles();
  }
  if (!c) {
    tooltip.style.display = "none";
    return;
  }
  tooltip.innerHTML = tooltipHtml(c);
  tooltip.style.display = "block";
  tooltip.style.left = Math.min(e.clientX + 14, innerWidth - 260) + "px";
  tooltip.style.top = Math.min(e.clientY + 14, innerHeight - 240) + "px";
});

function tooltipHtml(c) {
  const flows = state.flows[state.period];
  const C = state.countries;
  const sel = state.selected;
  const name = C[c.iso2].name;
  const label = periodLabel(state.period);
  const cls = c.net >= 0 ? "gain" : "loss";

  // hovering a partner while a country is selected: show the pair, both ways
  if (sel && c.iso2 !== sel) {
    const sName = C[sel].name;
    const toSel = (flows[sel] || {})[c.iso2] || 0;
    const fromSel = (flows[c.iso2] || {})[sel] || 0;
    return (
      `<div class="name">${name}</div>` +
      `<div>${name} &rarr; ${sName}: <span class="gain">${toSel.toLocaleString("en-US")}</span></div>` +
      `<div>${sName} &rarr; ${name}: <span class="loss">${fromSel.toLocaleString("en-US")}</span></div>` +
      `<div>Net for ${name}: <span class="${cls}">${fmt(c.net)}</span></div>`
    );
  }

  // top 5 origins (into this country) and destinations (out of it)
  const row = flows[c.iso2] || {};
  const origins = Object.entries(row)
    .filter(([b]) => b !== c.iso2 && C[b])
    .sort((x, y) => y[1] - x[1])
    .slice(0, 5);
  const dests = [];
  for (const d in flows) {
    if (d !== c.iso2 && flows[d][c.iso2] && C[d]) dests.push([d, flows[d][c.iso2]]);
  }
  dests.sort((x, y) => y[1] - x[1]);
  const list = (items, arrow) =>
    items
      .map(([iso2, v]) => `<div class="mini">${arrow} ${C[iso2].name}: ${v.toLocaleString("en-US")}</div>`)
      .join("");
  const none = `<div class="mini">none recorded above 100</div>`;
  return (
    `<div class="name">${name}</div>` +
    `<div>Travel balance ${label} (in − out): <span class="${cls}">${fmt(c.net)}</span></div>` +
    `<div><span class="gain">In: ${(c.gin || 0).toLocaleString("en-US")}</span> &middot; ` +
    `<span class="loss">Out: ${(c.gout || 0).toLocaleString("en-US")}</span></div>` +
    `<div class="sub">Top origins</div>` + (origins.length ? list(origins, "&larr;") : none) +
    `<div class="sub">Top destinations</div>` + (dests.length ? list(dests.slice(0, 5), "&rarr;") : none)
  );
}

async function setPeriod(id) {
  // load BEFORE switching: map interactions fire rebuilds at any moment, and
  // a period whose data hasn't arrived yet would make them throw
  await loadPeriod(id);
  state.period = id;
  const ds = document.getElementById("decade-select");
  ds.value =
    id === TOTAL_PERIOD.id || ALL_PERIODS().some((p) => p.id === id) ? id : "";
  ds.classList.toggle("active", ds.value !== "");
  const ys = document.getElementById("year-select");
  ys.value = isYearId(id) ? id : "";
  ys.classList.toggle("active", ys.value !== "");
  document.getElementById("event-select").classList.toggle("active", !!state.event);
  // never touch the URL mid-playback: rapid replaceState calls can interrupt
  // map dragging; the URL is synced once when playback stops instead
  if (!state.event && !state.playing) syncUrl();
  // data-source notice: reported statistics (2024+) or model-based estimates
  const note = document.getElementById("source-note");
  note.textContent = NOTE_MODELED;
  note.classList.add("show");
  // big year watermark for single-year views only (not decades)
  const lbl = document.getElementById("period-label");
  lbl.classList.toggle("show", isYearId(id));
  lbl.textContent = isYearId(id) ? id.slice(0, 4) : "";
  rebuildRoutes();
  rebuildCircles(true);
}

/* Reported-data years available for a given selection */
function extYearIdsFor(iso2) {
  if (!iso2) return [];
  return Object.keys(state.extYears)
    .filter((id) => state.extYears[id].includes(iso2))
    .sort();
}

async function setCountry(iso2) {
  clearEvent();
  // reported years exist only for covered countries: leaving one (or
  // deselecting) while such a year is shown falls back to the newest
  // globally complete year
  if (state.extYears[state.period] && (!iso2 || !state.extYears[state.period].includes(iso2))) {
    await setPeriod(FALLBACK_YEAR);
  }
  if (iso2 && !(state.flows[state.period] || {})[iso2]) iso2 = "";
  state.selected = iso2;
  document.getElementById("country-select").value = iso2;
  // offer this country's reported years in the Year dropdown
  const ys = document.getElementById("year-select");
  ys.querySelectorAll("option.ext").forEach((o) => o.remove());
  for (const id of extYearIdsFor(iso2)) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = id.slice(0, 4);
    o.className = "ext";
    ys.appendChild(o);
  }
  if (ys.querySelector(`option[value="${state.period}"]`)) ys.value = state.period;
  updateLegend();
  rebuildRoutes();
  rebuildCircles(true);
  syncUrl();
}

function updateLegend() {
  const directional = state.selected || state.eventFocus.length;
  document.getElementById("legend-flow").innerHTML = directional
    ? `<i class="dot in"></i> arriving &nbsp;<i class="dot out"></i> leaving`
    : `<i class="dot flow"></i> travel flow`;
}

/* keep the address bar shareable: ?e=<event> or ?c=<country>&p=<period>,
 * and the document title descriptive for search engines */
function syncUrl() {
  const q = new URLSearchParams();
  if (state.event) q.set("e", state.event.id);
  else {
    if (state.selected) q.set("c", state.selected);
    q.set("p", state.period);
  }
  history.replaceState(null, "", "?" + q.toString());
  if (state.event) document.title = `${state.event.name} — World Travel Flows`;
  else if (state.selected && state.countries[state.selected])
    document.title = `${state.countries[state.selected].name} travel ${periodLabel(state.period)} — World Travel Flows`;
  else document.title = "World Travel Flows";
}

/* ---------- events ---------- */

function clearEvent() {
  if (!state.event) return;
  state.event = null;
  state.eventFocus = [];
  document.getElementById("event-select").value = "";
  document.getElementById("event-label").classList.remove("show");
  updateLegend();
}

/* Point the view at an event (focus countries + overlay), without playback */
function applyEvent(ev) {
  state.event = ev;
  state.eventFocus = ev.c.slice();
  state.selected = "";
  document.getElementById("country-select").value = "";
  document.getElementById("event-select").value = ev.id;
  const lbl = document.getElementById("event-label");
  lbl.innerHTML = `<div class="t"></div><div class="y"></div>`;
  lbl.querySelector(".t").textContent = ev.name;
  lbl.querySelector(".y").textContent = `${ev.y0}–${ev.y1 + 1}`;
  lbl.classList.add("show");
  updateLegend();
}

/* User picked an event: focus it and loop through its years */
function setEvent(id) {
  const ev = EVENTS.find((x) => x.id === id);
  if (!ev) return;
  stopPlay();
  applyEvent(ev);
  state.playing = "play-events";
  document.getElementById("play-events").innerHTML = "&#9646;&#9646;";
  const ids = eventYearIds(ev);
  let i = 0;
  setPeriod(ids[i]);
  state.playTimer = setInterval(() => {
    i = (i + 1) % ids.length;
    setPeriod(ids[i]);
  }, YEAR_STEP_MS);
  syncUrl();
}

/* Tour: play every event's year range in sequence, looping forever */
function startEventsTour() {
  stopPlay();
  state.playing = "play-events";
  document.getElementById("play-events").innerHTML = "&#9646;&#9646;";
  const flat = EVENTS.flatMap((ev) => eventYearIds(ev).map((pid) => ({ ev, pid })));
  let i = 0;
  const step = () => {
    const { ev, pid } = flat[i];
    if (state.event !== ev) {
      applyEvent(ev);
      syncUrl();
    }
    setPeriod(pid);
  };
  step();
  state.playTimer = setInterval(() => {
    i = (i + 1) % flat.length;
    step();
  }, YEAR_STEP_MS);
}

function stopPlay() {
  const wasPlaying = state.playing;
  state.playing = "";
  clearInterval(state.playTimer);
  document.getElementById("play").innerHTML = "&#9654;";
  document.getElementById("play-years").innerHTML = "&#9654;";
  document.getElementById("play-events").innerHTML = "&#9654;";
  if (wasPlaying) syncUrl(); // land the URL on wherever playback stopped
}

/* Cycle through a period sequence chronologically, looping forever.
 * btnId identifies which play button drives it (decades or years). */
function startPlay(btnId, seq, stepMs) {
  stopPlay();
  state.playing = btnId;
  document.getElementById(btnId).innerHTML = "&#9646;&#9646;";
  // resume from the period currently shown if it's part of this sequence
  let i = Math.max(0, seq.findIndex((p) => p.id === state.period));
  setPeriod(seq[i].id);
  state.playTimer = setInterval(() => {
    i = (i + 1) % seq.length;
    setPeriod(seq[i].id);
  }, stepMs);
}

/* ---------- init ---------- */

async function init() {
  resizeCanvases();

  const decadeSelect = document.getElementById("decade-select");
  for (const p of [...ALL_PERIODS(), TOTAL_PERIOD]) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label;
    decadeSelect.appendChild(o);
  }
  decadeSelect.addEventListener("change", () => {
    if (!decadeSelect.value) return;
    stopPlay();
    clearEvent();
    setPeriod(decadeSelect.value);
  });

  const eventSelect = document.getElementById("event-select");
  for (const ev of EVENTS) {
    const o = document.createElement("option");
    o.value = ev.id;
    o.textContent = `${ev.name} (${ev.y0}–${ev.y1 + 1})`;
    eventSelect.appendChild(o);
  }
  eventSelect.addEventListener("change", () => {
    if (eventSelect.value) setEvent(eventSelect.value);
    else {
      stopPlay();
      clearEvent();
      syncUrl();
      rebuildRoutes();
      rebuildCircles(true);
    }
  });
  document.getElementById("play-events").addEventListener("click", () => {
    if (state.playing === "play-events") stopPlay();
    else if (eventSelect.value) setEvent(eventSelect.value);
    else startEventsTour();
  });

  const yearSelect = document.getElementById("year-select");
  for (const p of YEAR_PERIODS) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.id.slice(0, 4);
    yearSelect.appendChild(o);
  }
  yearSelect.addEventListener("change", () => {
    if (!yearSelect.value) return;
    stopPlay();
    clearEvent();
    setPeriod(yearSelect.value);
  });

  document.getElementById("mobile-continue").addEventListener("click", () =>
    document.getElementById("mobile-warning").classList.add("dismissed")
  );

  document.getElementById("play").addEventListener("click", () => {
    if (state.playing === "play") stopPlay();
    else {
      clearEvent();
      startPlay("play", ALL_PERIODS(), PLAY_STEP_MS);
    }
  });
  document.getElementById("play-years").addEventListener("click", () => {
    if (state.playing === "play-years") stopPlay();
    else {
      clearEvent();
      // include this country's reported years (e.g. 2024) at the end
      const seq = [...YEAR_PERIODS, ...extYearIdsFor(state.selected).map((id) => ({ id }))];
      startPlay("play-years", seq, YEAR_STEP_MS);
    }
  });

  // click a country circle on the map to select it; click empty space to clear
  let downAt = null;
  const mapEl = map.getCanvas().parentElement;
  mapEl.addEventListener("mousedown", (e) => (downAt = [e.clientX, e.clientY]));
  mapEl.addEventListener("mouseup", (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 5) return; // it was a pan, not a click
    const c = hitTest(e.clientX, e.clientY);
    setCountry(c && c.iso2 !== state.selected ? c.iso2 : "");
  });

  state.countries = await (await fetch("data/countries.json")).json();
  try {
    state.extYears = await (await fetch("data/extended_years.json")).json();
  } catch {
    state.extYears = {};
  }

  const select = document.getElementById("country-select");
  Object.entries(state.countries)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .forEach(([iso2, c]) => {
      const o = document.createElement("option");
      o.value = iso2;
      o.textContent = c.name;
      select.appendChild(o);
    });
  select.addEventListener("change", () => setCountry(select.value));

  // Explore menu: crawlable links to events and per-country yearly playback
  const menu = document.getElementById("explore-menu");
  document.getElementById("explore-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && e.target.id !== "explore-btn") menu.classList.remove("open");
  });
  const cc = document.getElementById("explore-countries");
  Object.entries(state.countries)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .forEach(([iso2, c]) => {
      const a = document.createElement("a");
      a.href = `?c=${iso2}&play=years`;
      a.textContent = c.name;
      cc.appendChild(a);
    });

  // shareable state: ?p=<period>&c=<ISO2>&lon=&lat=&z=, e.g. ?p=2010_2020&c=US
  const params = new URLSearchParams(location.search);
  const lon = parseFloat(params.get("lon")), lat = parseFloat(params.get("lat")), z = parseFloat(params.get("z"));
  if (Number.isFinite(lon) && Number.isFinite(lat)) map.setCenter([lon, lat]);
  if (Number.isFinite(z)) map.setZoom(z);
  let p = params.get("p");
  if (/^\d{4}$/.test(p) && +p >= YEAR_MIN && +p < YEAR_MAX) p = `${p}_${+p + 1}`;
  const c = (params.get("c") || "").toUpperCase();
  const valid =
    p === TOTAL_PERIOD.id ||
    ALL_PERIODS().some((x) => x.id === p) ||
    YEAR_PERIODS.some((x) => x.id === p) ||
    // reported years are valid only together with a covered country
    (state.extYears[p] && c && state.extYears[p].includes(c));
  const startPeriod = valid ? p : DEFAULT_PERIOD;
  await loadPeriod(startPeriod);
  const evParam = params.get("e");
  if (evParam && EVENTS.some((x) => x.id === evParam)) {
    await setPeriod(startPeriod);
    setEvent(evParam); // event links open playing
  } else {
    if (c && state.countries[c]) state.selected = c;
    await setPeriod(startPeriod);
    if (state.selected) {
      const sel = state.selected;
      await setCountry(sel);
      // ?c=XX&play=years: replay this country's history year by year
      if (params.get("play") === "years") {
        startPlay("play-years", YEAR_PERIODS, YEAR_STEP_MS);
        state.selected = sel; // startPlay must not drop the selection
      }
    }
  }

  map.on("move", () => {
    // an exception here would permanently break MapLibre's drag/zoom
    // handlers (the map "freezes" while everything else keeps running)
    try {
      projectRoutes();
      rebuildCircles();
    } catch (err) {
      console.error(err);
    }
  });
  window.addEventListener("resize", () => {
    resizeCanvases();
    projectRoutes();
    rebuildCircles();
  });

  requestAnimationFrame(frame);
}

// Not gated on map "load": the overlay only needs map.project(), which works
// from construction — so slow basemap tiles never block the visualization.
init();
