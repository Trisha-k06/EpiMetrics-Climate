// 3D map of Tamil Nadu's real districts (Three.js / WebGL) with a 2D SVG fallback.
// Boundaries: Census 2011, DataMeet India community (CC BY 4.0), simplified. Study districts are raised,
// coloured by the chosen layer and carry a pole; every value shown comes from the API
// (mapValuesFromCells for /recovery-matrix results, mapValuesFromProfiles for /districts profiles).
import { token, currentTheme } from "./theme.js";
import { esc, fmtInt, monthLabel } from "./format.js";

const K = 1.15;
let geoPromise = null;
export function loadGeo() {
  if (!geoPromise) geoPromise = fetch("data/geo/tamil_nadu.json").then((r) => { if (!r.ok) throw new Error("Map boundaries could not be loaded"); return r.json(); });
  return geoPromise;
}

let threePromise = null;
function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (!threePromise) {
    threePromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/three.min.js";
      s.onload = () => (window.THREE ? resolve(window.THREE) : reject(new Error("3D library missing")));
      s.onerror = () => reject(new Error("Could not load the 3D library"));
      document.head.appendChild(s);
    });
  }
  return threePromise;
}
function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ---------- colour ramps (display only) ----------
const HOT = ["#E8CF9C", "#F2A55B", "#E9743A", "#D4442B", "#9E1C1C"];
const COOL = ["#D3F0EC", "#7FCDC2", "#2B9C90", "#14665F"];
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const s = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(s));
  return mix(stops[i], stops[i + 1], s - i);
}
export function valueColor(v, legend) {
  if (v == null) return token("--ink-3") || "#8899aa";
  if (v < 0) return ramp(COOL, Math.min(1, -v / (legend?.minAbs || 6)));
  return ramp(HOT, v / (legend?.max || 10));
}

function makeProjector(center) {
  const [lon0, lat0] = center, c = Math.cos((lat0 * Math.PI) / 180);
  return (lon, lat) => [(lon - lon0) * K * c, (lat - lat0) * K];
}

function legendHTML(legend) {
  if (!legend) return "";
  const stops = HOT.map((c, i) => `${c} ${(i / (HOT.length - 1)) * 100}%`).join(", ");
  const ticks = legend.ticks.map((t, i) => `<span style="bottom:${(i / (legend.ticks.length - 1)) * 100}%">${esc(t)}</span>`).join("");
  return `<p class="ml-title">${esc(legend.title)}</p>
    <div class="ml-scale"><div class="ml-bar" style="background:linear-gradient(to top, ${stops})"></div><div class="ml-ticks">${ticks}</div></div>
    ${legend.divergent ? `<p class="ml-row"><span class="ml-sw" style="background:${COOL[2]}"></span>faster than baseline</p>` : ""}
    ${legend.censoredNote === false ? "" : '<p class="ml-row"><span class="ml-sw ml-hatch"></span>not recovered: value is a minimum</p>'}
    ${legend.note ? `<p class="ml-row">${esc(legend.note)}</p>` : ""}`;
}

function insetSVG(geo) {
  const [x0, y0, x1, y1] = geo.india_bounds, c = Math.cos((22 * Math.PI) / 180);
  const W = 120, H = Math.round((W * (y1 - y0)) / ((x1 - x0) * c));
  const px = (lon) => ((lon - x0) * c / ((x1 - x0) * c)) * W, py = (lat) => H - ((lat - y0) / (y1 - y0)) * H;
  const path = (polys) => polys.map((p) => p.map((r) => r.map(([a, b], i) => `${i ? "L" : "M"}${px(a).toFixed(1)} ${py(b).toFixed(1)}`).join("") + "Z").join("")).join("");
  const tn = geo.state_outline;
  const [cx, cy] = [px(geo.center[0]), py(geo.center[1])];
  return `<svg viewBox="-4 -4 ${W + 8} ${H + 8}" aria-hidden="true"><path d="${path(geo.india)}" class="in-india"/><path d="${path(tn)}" class="in-tn"/></svg><span class="in-name">India</span><span class="in-tn-name" style="top:${((cy + 4) / (H + 8)) * 100}%">Tamil Nadu</span>`;
}

/**
 * districts: meta.districts. opts: { onSelect(id), compact }
 * returns { update(values, selectedId, legend), dispose(), mode }
 */
export async function createDistrictMap(container, districts, opts = {}) {
  container.classList.add("map3d");
  if (opts.compact) container.classList.add("compact");
  const geo = await loadGeo();
  const proj = makeProjector(geo.center);
  const byName = new Map(geo.districts.map((d) => [d.name.toLowerCase(), d]));
  const study = new Map(); // api id → geo district
  for (const d of districts) {
    const g = byName.get(d.name.toLowerCase());
    if (g) study.set(d.id, g);
  }

  container.innerHTML = `
    <div class="map-legend" aria-hidden="true"></div>
    <div class="map-inset" aria-hidden="true">${insetSVG(geo)}</div>
    <div class="map-compass" aria-hidden="true"><svg viewBox="-20 -20 40 40"><circle r="18" class="cp-ring"/><g class="cp-needle"><path d="M0 -14 L5 4 L0 1 L-5 4 Z" class="cp-n"/><text y="-17" text-anchor="middle" class="cp-label">N</text></g></svg></div>
    <div class="map-scale" aria-hidden="true"><div class="ms-bar"></div><span class="ms-label"></span></div>
    <p class="map-attrib">Boundaries: Census 2011, <a href="${esc(geo.source)}" target="_blank" rel="noopener">DataMeet</a> (CC BY 4.0), simplified · results are synthetic</p>
    <div class="map-tip" hidden></div>`;
  const legendEl = container.querySelector(".map-legend");
  const tipEl = container.querySelector(".map-tip");
  // Hover card: the district profile from the API (opts.tipFor), or just the district name.
  function showTip(id, name, anchorEl, x, y) {
    const html = id && opts.tipFor ? opts.tipFor(id) : null;
    if (html) tipEl.innerHTML = html; else tipEl.textContent = id ? `${name} · study district, select for details` : `${name} · not in this study`;
    tipEl.classList.toggle("map-tip-card", !!html);
    tipEl.hidden = false;
    const r = container.getBoundingClientRect();
    let px = x, py = y;
    if (anchorEl) { const a = anchorEl.getBoundingClientRect(); px = a.left - r.left + a.width / 2; py = a.bottom - r.top + 6; }
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    const left = Math.max(4, Math.min(px + 12, r.width - w - 4));
    const top = Math.max(4, Math.min(py + 12, r.height - h - 4));
    tipEl.style.transform = `translate(${left}px, ${top}px)`;
  }
  const geoLabels = [];
  const addGeoLabel = (text, lonlat, cls) => {
    const el = document.createElement("span");
    el.className = `map-geo-label ${cls}`;
    el.textContent = text;
    el.setAttribute("aria-hidden", "true");
    container.appendChild(el);
    geoLabels.push({ el, xy: proj(...lonlat) });
  };
  for (const n of geo.neighbours) if (n.name !== "Puducherry") addGeoLabel(n.name, n.anchor, "gl-state");
  for (const s of geo.seas) addGeoLabel(s.name, s.anchor, "gl-sea");
  addGeoLabel("Tamil Nadu", [78.15, 9.25], "gl-tn");

  const labelsHost = document.createElement("div");
  labelsHost.setAttribute("role", "group");
  labelsHost.setAttribute("aria-label", "Study districts on the map");
  container.appendChild(labelsHost);
  const labels = new Map();
  for (const d of districts) {
    if (!study.has(d.id)) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "map-label";
    b.dataset.id = d.id;
    b.setAttribute("aria-pressed", "false");
    b.innerHTML = `<span>${esc(d.name)}</span>`;
    b.addEventListener("click", () => opts.onSelect?.(d.id));
    b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") showTip(d.id, null, b); });
    b.addEventListener("pointerleave", () => { tipEl.hidden = true; });
    labelsHost.appendChild(b);
    labels.set(d.id, b);
  }
  const setLabel = (id, v, selected) => {
    const b = labels.get(id), d = districts.find((x) => x.id === id);
    b.setAttribute("aria-pressed", String(selected));
    b.innerHTML = `<span>${esc(d.name)}</span>${v ? `<b style="--v:${v.color}">${esc(v.text)}</b>${v.sub ? `<span class="ml-sub">${esc(v.sub)}</span>` : ""}` : ""}`;
    b.setAttribute("aria-label", `${d.name}${v ? `: ${v.text}${v.sub ? `, ${v.sub}` : ""}` : ""}`);
  };

  let THREE = null;
  if (webglAvailable()) { try { THREE = await loadThree(); } catch { THREE = null; } }
  if (!THREE) return fallback2D(container, geo, proj, study, labels, setLabel, legendEl, showTip, tipEl);

  // ---------- scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute("aria-hidden", "true");
  container.insertBefore(renderer.domElement, container.firstChild);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  const target = new THREE.Vector3(0.1, 0.3, 0.6);
  const view = { az: 0.18, polar: 0.82, radius: 10 };
  const home = { az: 0.18, polar: 0.82 };
  const placeCamera = () => {
    camera.position.set(target.x + view.radius * Math.sin(view.polar) * Math.sin(view.az), target.y + view.radius * Math.cos(view.polar), target.z + view.radius * Math.sin(view.polar) * Math.cos(view.az));
    camera.lookAt(target);
  };
  const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.95);
  sun.position.set(-5, 9, 7);
  scene.add(sun);

  const toShape = (rings) => {
    const sh = new THREE.Shape(rings[0].map(([a, b]) => new THREE.Vector2(...proj(a, b))));
    for (const h of rings.slice(1)) sh.holes.push(new THREE.Path(h.map(([a, b]) => new THREE.Vector2(...proj(a, b)))));
    return sh;
  };
  const extrude = (polys, depth) => {
    const g = new THREE.ExtrudeGeometry(polys.map(toShape), { depth, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  };
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  // sea
  const [vx0, vy0, vx1, vy1] = geo.view;
  const [sx0, sz0] = proj(vx0, vy0), [sx1, sz1] = proj(vx1, vy1);
  const seaGeo = track(new THREE.PlaneGeometry(160, 160));
  seaGeo.rotateX(-Math.PI / 2);
  const seaMat = track(new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.05 }));
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.position.set(0, -0.02, 0);
  scene.add(sea);

  // neighbouring states
  const nbMat = track(new THREE.MeshStandardMaterial({ roughness: 0.95 }));
  const nbEdgeMat = track(new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 }));
  for (const n of geo.neighbours) {
    const g = track(extrude(n.polygons, 0.06));
    scene.add(new THREE.Mesh(g, nbMat));
    scene.add(new THREE.LineSegments(track(new THREE.EdgesGeometry(g, 25)), nbEdgeMat));
  }

  // Tamil Nadu districts
  const BASE = 0.2;
  const edgeMat = track(new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 }));
  const distMeshes = [];
  const studyParts = new Map();
  geo.districts.forEach((d, i) => {
    const g = track(extrude(d.polygons, BASE));
    const mat = track(new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.02 }));
    const mesh = new THREE.Mesh(g, mat);
    mesh.userData = { name: d.name, shade: ((i * 37) % 11) / 10 };
    const edges = new THREE.LineSegments(track(new THREE.EdgesGeometry(g, 25)), edgeMat);
    const grp = new THREE.Group();
    grp.add(mesh, edges);
    scene.add(grp);
    distMeshes.push(mesh);
    for (const [id, gd] of study) if (gd === d) { mesh.userData.id = id; studyParts.set(id, { grp, mesh, mat }); }
  });
  const outlineMat = track(new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 }));
  for (const p of geo.state_outline) {
    const pts = p[0].map(([a, b]) => { const [x, y] = proj(a, b); return new THREE.Vector3(x, BASE + 0.005, -y); });
    scene.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(pts)), outlineMat));
  }

  // poles on the study districts
  const poleGeo = track(new THREE.CylinderGeometry(0.075, 0.075, 1, 24));
  const capGeo = track(new THREE.SphereGeometry(0.13, 24, 16));
  const ringGeo = track(new THREE.RingGeometry(0.2, 0.3, 48));
  ringGeo.rotateX(-Math.PI / 2);
  const poles = new Map();
  for (const [id, gd] of study) {
    const [x, y] = proj(...gd.anchor);
    const mat = track(new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.2, emissiveIntensity: 1 }));
    const pole = new THREE.Mesh(poleGeo, mat);
    const capMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const cap = new THREE.Mesh(capGeo, capMat);
    const ringMat = track(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    const ring = new THREE.Mesh(ringGeo, ringMat);
    scene.add(pole, cap, ring);
    poles.set(id, { pole, cap, ring, mat, capMat, ringMat, x, z: -y, h: 0.1, target: 0.1, lift: 0, liftTarget: 0, color: "#888888", censored: false, selected: false });
  }

  const C = (v) => new THREE.Color(v);
  function applyTheme() {
    const night = currentTheme() === "dark";
    seaMat.color = C(night ? "#06172a" : "#b9d6ea");
    nbMat.color = C(night ? "#1b2638" : "#e4e7ea");
    nbEdgeMat.color = C(night ? "#6f86a3" : "#8b97a3");
    edgeMat.color = C(night ? "#a9e4d4" : "#4f6f5a");
    outlineMat.color = C(token("--accent") || "#3DE0E6");
    hemi.groundColor = C(night ? "#0b1a2a" : "#8fa2b0");
    for (const m of distMeshes) {
      const s = m.userData.shade;
      const base = night ? mix("#1d4636", "#2c5a3f", s) : mix("#c9dfb9", "#b3d1a1", s);
      m.material.color = C(base);
      m.material.emissive = C("#000000");
    }
    for (const id of studyParts.keys()) paintStudy(id);
  }
  function paintStudy(id) {
    const p = poles.get(id), part = studyParts.get(id);
    const col = C(p.color);
    part.mat.color = col;
    part.mat.emissive = col.clone().multiplyScalar(currentTheme() === "dark" ? 0.1 : 0.02);
    p.mat.color = col;
    p.mat.emissive = col.clone().multiplyScalar(currentTheme() === "dark" ? 0.5 : 0.2);
    p.capMat.color = p.censored ? C(token("--warn") || "#FFC14D") : C("#ffffff");
    p.ringMat.color = C(p.selected ? token("--accent") || "#3DE0E6" : p.color);
  }
  applyTheme();
  const onTheme = () => applyTheme();
  window.addEventListener("themechange", onTheme);

  // ---------- interaction ----------
  let auto = !reduceMotion();
  let dragging = false, moved = 0, lastX = 0, lastY = 0, idleSince = performance.now(), holding = false;
  container.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") holding = true; });
  container.addEventListener("pointerleave", () => { holding = false; idleSince = performance.now(); tipEl.hidden = true; });
  container.addEventListener("focusin", () => { holding = true; });
  container.addEventListener("focusout", () => { holding = false; idleSince = performance.now(); });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), el = renderer.domElement;
  const pick = (e) => {
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...distMeshes, ...[...poles.values()].map((p) => p.pole)]);
    if (!hits.length) return null;
    const o = hits[0].object;
    if (o.userData.id || o.userData.name) return o.userData;
    for (const [id, p] of poles) if (p.pole === o) return { id, name: districts.find((d) => d.id === id)?.name };
    return null;
  };
  el.addEventListener("pointerdown", (e) => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; container.classList.add("dragging"); el.setPointerCapture?.(e.pointerId); });
  el.addEventListener("pointermove", (e) => {
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      view.az -= dx * 0.008;
      view.polar = Math.min(1.2, Math.max(0.35, view.polar - dy * 0.006));
      lastX = e.clientX; lastY = e.clientY; idleSince = performance.now();
      tipEl.hidden = true;
      return;
    }
    if (e.pointerType !== "mouse") return;
    const hit = pick(e);
    if (!hit) { tipEl.hidden = true; el.style.cursor = ""; return; }
    const r = container.getBoundingClientRect();
    showTip(hit.id, hit.name, null, e.clientX - r.left, e.clientY - r.top);
    el.style.cursor = hit.id ? "pointer" : "";
  });
  el.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    container.classList.remove("dragging");
    if (moved < 6) { const hit = pick(e); if (hit?.id) opts.onSelect?.(hit.id); }
    idleSince = performance.now();
  });
  el.addEventListener("pointercancel", () => { dragging = false; container.classList.remove("dragging"); });

  const tools = document.createElement("div");
  tools.className = "map-tools";
  tools.innerHTML = `<button type="button" data-act="spin" aria-pressed="${auto}">Auto-rotate</button><button type="button" data-act="reset">Reset view</button>`;
  container.appendChild(tools);
  tools.querySelector('[data-act="spin"]').addEventListener("click", (e) => { auto = !auto; e.currentTarget.setAttribute("aria-pressed", String(auto)); });
  tools.querySelector('[data-act="reset"]').addEventListener("click", () => { view.az = home.az; view.polar = home.polar; idleSince = performance.now(); });

  // ---------- overlays ----------
  const v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
  const needle = container.querySelector(".cp-needle");
  const scaleBar = container.querySelector(".ms-bar"), scaleLabel = container.querySelector(".ms-label");
  const KM_PER_UNIT = 111.32 / K;
  const TOP_CLEAR = 46;
  const toScreen = (x, y, z) => {
    v3.set(x, y, z).project(camera);
    return [((v3.x + 1) / 2) * container.clientWidth, ((1 - v3.y) / 2) * container.clientHeight];
  };
  function placeOverlays() {
    const W = container.clientWidth;
    // compass: screen direction of north (-z)
    const [ax, ay] = toScreen(0, BASE, 0), [bx, by] = toScreen(0, BASE, -1);
    needle.setAttribute("transform", `rotate(${((Math.atan2(bx - ax, ay - by) * 180) / Math.PI).toFixed(1)})`);
    // scale bar along the screen's horizontal
    const rx = Math.cos(view.az), rz = -Math.sin(view.az);
    const [cx, cy] = toScreen(0, BASE, 0), [dx, dy] = toScreen(rx, BASE, rz);
    const pxPerKm = Math.hypot(dx - cx, dy - cy) / KM_PER_UNIT;
    const km = [25, 50, 100, 200].find((k) => k * pxPerKm >= 55) || 200;
    scaleBar.style.width = `${Math.round(km * pxPerKm)}px`;
    scaleLabel.textContent = `${km} km (approx.)`;
    for (const g of geoLabels) {
      const [x, y] = toScreen(g.xy[0], 0.1, -g.xy[1]);
      g.el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    // study labels: nearest first, stacked upward, leader lines
    const items = [];
    for (const [id, p] of poles) {
      const [sx, sy] = toScreen(p.x, BASE + p.lift + p.h + 0.18, p.z);
      items.push({ id, p, sx, sy, z: v3.z });
    }
    items.sort((a, b) => (b.p.selected - a.p.selected) || a.z - b.z);
    const placed = [];
    for (const it of items) {
      const w = it.p.lw || 90, h = it.p.lh || 44;
      let left = Math.min(Math.max(4, it.sx - w / 2), W - w - 4), top = it.sy - h - 6;
      for (let k = 0; k < 8; k++) {
        const hit = placed.find((q) => left < q.left + q.w + 4 && left + w + 4 > q.left && top < q.top + q.h + 4 && top + h + 4 > q.top);
        if (!hit) break;
        top = hit.top - h - 4;
      }
      top = Math.max(TOP_CLEAR, top);
      placed.push({ left, top, w, h });
      const ln = leaderLines.get(it.id);
      ln.setAttribute("x1", (left + w / 2).toFixed(1)); ln.setAttribute("y1", (top + h).toFixed(1));
      ln.setAttribute("x2", it.sx.toFixed(1)); ln.setAttribute("y2", (it.sy + 2).toFixed(1));
      const lb = labels.get(it.id);
      lb.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
      lb.style.zIndex = String(100 - placed.length);
    }
  }
  const leaders = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leaders.setAttribute("class", "map-leaders");
  leaders.setAttribute("aria-hidden", "true");
  const leaderLines = new Map();
  for (const id of poles.keys()) { const ln = document.createElementNS("http://www.w3.org/2000/svg", "line"); leaders.appendChild(ln); leaderLines.set(id, ln); }
  container.insertBefore(leaders, labelsHost);

  // ---------- loop ----------
  let raf = 0, visible = true;
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    view.radius = (w < 520 ? 11 : 8.6) * (opts.compact ? 1.08 : 1);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(() => { resize(); if (!raf) { placeCamera(); renderer.render(scene, camera); placeOverlays(); } });
  ro.observe(container);
  resize();
  const io = new IntersectionObserver((en) => { visible = en[0].isIntersecting; if (visible && !raf) raf = requestAnimationFrame(tick); });
  io.observe(container);

  function stepPoles(t, instant) {
    for (const [id, p] of poles) {
      const k = instant || reduceMotion() ? 1 : 0.08;
      p.h += (p.target - p.h) * k;
      p.lift += (p.liftTarget - p.lift) * k;
      const part = studyParts.get(id);
      part.grp.position.y = p.lift;
      const top = BASE + p.lift;
      p.pole.scale.y = Math.max(p.h, 0.001);
      p.pole.position.set(p.x, top + p.h / 2, p.z);
      p.cap.position.set(p.x, top + p.h + 0.06, p.z);
      p.ring.position.set(p.x, top + 0.01, p.z);
      const pulse = reduceMotion() ? 0 : (Math.sin(t * 3) + 1) / 2;
      const s = p.selected ? 1 + pulse * 0.6 : p.censored ? 1 + pulse * 0.35 : 1;
      p.ring.scale.set(s, 1, s);
      p.ringMat.opacity = p.selected ? 0.9 - pulse * 0.4 : 0.5;
    }
  }
  function tick(now) {
    raf = 0;
    if (!visible) return;
    if (auto && !dragging && !holding && now - idleSince > 1500) view.az += 0.002;
    placeCamera();
    stepPoles(now / 1000, false);
    renderer.render(scene, camera);
    placeOverlays();
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  return {
    mode: "3d",
    update(values, selectedId, legend) {
      legendEl.innerHTML = legendHTML(legend);
      for (const [id, p] of poles) {
        const v = values[id];
        p.target = v ? Math.max(0.12, Math.min(2.4, v.height)) : 0.12;
        p.liftTarget = v ? 0.12 : 0;
        p.color = v?.color || "#888888";
        p.censored = !!v?.censored;
        p.selected = id === selectedId;
        paintStudy(id);
        setLabel(id, v, p.selected);
        const lb = labels.get(id);
        p.lw = lb.offsetWidth; p.lh = lb.offsetHeight;
      }
      if (!visible || reduceMotion()) { placeCamera(); stepPoles(0, true); renderer.render(scene, camera); placeOverlays(); }
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      window.removeEventListener("themechange", onTheme);
      for (const d of disposables) d.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss?.();
      container.innerHTML = "";
    },
  };
}

// ---------- 2D fallback (no WebGL) ----------
function fallback2D(container, geo, proj, study, labels, setLabel, legendEl, showTip, tipEl) {
  const [vx0, vy0, vx1, vy1] = geo.view;
  const [x0, y0] = proj(vx0 + 1.2, vy0 + 0.5), [x1, y1] = proj(vx1 - 1.2, vy1 - 0.5);
  const W = 400, H = (W * (y1 - y0)) / (x1 - x0);
  const sx = (x) => ((x - x0) / (x1 - x0)) * W, sy = (y) => H - ((y - y0) / (y1 - y0)) * H;
  const path = (polys) => polys.map((p) => p.map((r) => r.map(([a, b], i) => { const [x, y] = proj(a, b); return `${i ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`; }).join("") + "Z").join("")).join("");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "map2d");
  const distIds = new Map([...study].map(([id, g]) => [g, id]));
  svg.innerHTML = geo.neighbours.map((n) => `<path d="${path(n.polygons)}" class="m2-nb"/>`).join("") +
    geo.districts.map((d) => `<path d="${path(d.polygons)}" class="m2-d" ${distIds.has(d) ? `data-id="${distIds.get(d)}"` : ""}><title>${esc(d.name)}</title></path>`).join("");
  container.insertBefore(svg, container.firstChild);
  svg.setAttribute("aria-hidden", "true");
  svg.addEventListener("pointermove", (e) => {
    const p = e.target.closest?.("path.m2-d");
    if (!p || e.pointerType !== "mouse") { tipEl.hidden = true; return; }
    const r = container.getBoundingClientRect();
    showTip(p.dataset.id || null, p.querySelector("title")?.textContent || "", null, e.clientX - r.left, e.clientY - r.top);
  });
  svg.addEventListener("pointerleave", () => { tipEl.hidden = true; });
  container.querySelector(".map-compass")?.remove();
  container.querySelector(".map-scale")?.remove();
  const place = () => {
    const r = svg.getBoundingClientRect(), cr = container.getBoundingClientRect(), CW = container.clientWidth;
    const items = [...study].map(([id, g]) => {
      const [x, y] = proj(...g.anchor), b = labels.get(id);
      return { b, px: r.left - cr.left + (sx(x) / W) * r.width, py: r.top - cr.top + (sy(y) / H) * r.height, w: b.offsetWidth, h: b.offsetHeight, sel: b.getAttribute("aria-pressed") === "true" };
    }).sort((a, b) => (b.sel - a.sel) || b.py - a.py);
    const placed = [];
    for (const it of items) {
      let left = Math.min(Math.max(4, it.px - it.w / 2), CW - it.w - 4), top = it.py - it.h - 4;
      for (let k = 0; k < 8; k++) {
        const hit = placed.find((q) => left < q.left + q.w + 4 && left + it.w + 4 > q.left && top < q.top + q.h + 4 && top + it.h + 4 > q.top);
        if (!hit) break;
        top = hit.top - it.h - 4;
      }
      placed.push({ left, top: Math.max(4, top), w: it.w, h: it.h });
      it.b.style.transform = `translate(${left.toFixed(1)}px, ${Math.max(4, top).toFixed(1)}px)`;
    }
  };
  for (const g of container.querySelectorAll(".map-geo-label")) g.remove();
  const ro = new ResizeObserver(place);
  ro.observe(container);
  return {
    mode: "2d",
    update(values, selectedId, legend) {
      legendEl.innerHTML = legendHTML(legend);
      for (const [id] of study) {
        const v = values[id];
        svg.querySelector(`[data-id="${id}"]`)?.setAttribute("style", `fill:${v?.color || "var(--ink-3)"}`);
        setLabel(id, v, id === selectedId);
      }
      place();
    },
    dispose() { ro.disconnect(); container.innerHTML = ""; },
  };
}

/** Map values for one scenario from recovery-matrix cells (display only). Returns { values, legend }. */
export function mapValuesFromCells(cells, scenarioId, metric = "delta") {
  const values = {};
  let legend;
  const rows = cells.filter((x) => x.scenario === scenarioId);
  if (metric === "interruptions") {
    legend = { title: "Interruptions before recovery (waves)", max: 4, ticks: ["0", "1", "2", "3", "≥ 4"] };
    for (const c of rows) values[c.district] = { height: c.interruption_count * 0.42, value: c.interruption_count, text: `${c.interruption_count} ${c.interruption_count === 1 ? "wave" : "waves"}`, sub: "before recovery", censored: c.status === "not_recovered_within_horizon" };
  } else if (metric === "above") {
    legend = { title: "Months above threshold after t0", max: 12, ticks: ["0", "3", "6", "9", "≥ 12"] };
    for (const c of rows) values[c.district] = { height: c.months_above_threshold * 0.12, value: c.months_above_threshold, text: `${c.months_above_threshold} mo`, sub: "above threshold", censored: c.status === "not_recovered_within_horizon" };
  } else if (scenarioId === "baseline") {
    legend = { title: "Baseline recovery time, TSR (months)", max: 12, ticks: ["0", "3", "6", "9", "≥ 12"] };
    for (const c of rows) values[c.district] = { height: (c.tsr_months ?? 0) * 0.12, value: c.tsr_months, text: `TSR ${c.tsr_months ?? "—"} mo`, sub: "baseline", censored: false };
  } else {
    legend = { title: "ΔTSR · extra recovery time (months)", max: 10, minAbs: 6, divergent: true, ticks: ["0", "2", "4", "6", "8", "≥ 10"] };
    for (const c of rows) {
      if (c.delta_status === "computed") {
        const v = c.delta_tsr_months;
        values[c.district] = { height: Math.abs(v) * 0.17, value: v, text: `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)} mo`, sub: `TSR ${c.tsr_months} mo`, censored: false };
      } else if (c.delta_status === "lower_bound") {
        values[c.district] = { height: c.delta_tsr_lower_bound_months * 0.17, value: c.delta_tsr_lower_bound_months, text: `≥ +${c.delta_tsr_lower_bound_months} mo`, sub: "not recovered", censored: true };
      } else {
        values[c.district] = { height: 0.1, value: null, text: "n/a", sub: c.status?.replaceAll("_", " "), censored: false };
      }
    }
  }
  for (const v of Object.values(values)) v.color = valueColor(v.value, legend);
  return { values, legend };
}

/** Map layers. "result" uses /recovery-matrix; the others use the district profiles from /districts. */
export const MAP_LAYERS = [
  { id: "result", label: "Recovery result" },
  { id: "peak", label: "Outbreak peak per 100k" },
  { id: "flood", label: "Flood exposure" },
  { id: "density", label: "Population density" },
];

/** Map values for a profile layer from /districts (display only). Returns { values, legend }. */
export function mapValuesFromProfiles(profiles, layer, disease) {
  const pick = {
    peak: (d) => d.outbreak_peak?.[disease]?.per_100k,
    flood: (d) => d.flood_exposure_index,
    density: (d) => d.population_density_per_km2,
  }[layer];
  const vals = profiles.map((d) => [d.id, pick(d)]).filter(([, v]) => v != null);
  const max = Math.max(...vals.map(([, v]) => v), 1e-9);
  const round = (v, nd) => Math.round(v * 10 ** nd) / 10 ** nd;
  const cfg = {
    peak: { title: `Reference outbreak peak, ${disease} cases per 100,000`, text: (v) => `${round(v, 1)}`, sub: "per 100k at t0", nd: 1 },
    flood: { title: "Flood exposure index (0–1, synthetic profile)", text: (v) => round(v, 2).toFixed(2), sub: "flood exposure", nd: 2 },
    density: { title: "Population density (people per km²)", text: (v) => fmtInt(v), sub: "per km²", nd: 0 },
  }[layer];
  const legend = { title: cfg.title, max, ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => (layer === "density" ? fmtInt(Math.round(max * f)) : String(round(max * f, cfg.nd)))),
    censoredNote: false, note: layer === "flood" ? "Recorded in the dataset but not used by generator v0.1.0" : null };
  const values = {};
  for (const [id, v] of vals) values[id] = { height: (v / max) * 2.2, value: v, text: cfg.text(v), sub: cfg.sub, censored: false, color: valueColor(v, legend) };
  return { values, legend };
}

/** Hover card with the district profile from /districts (all synthetic or illustrative values). */
export function districtTip(d, extra = "") {
  if (!d) return "";
  const peak = Object.entries(d.outbreak_peak || {}).map(([k, p]) => `<div class="tt-row"><span>${esc(k[0].toUpperCase() + k.slice(1))} peak (${esc(monthLabel(p.t0_month, "short"))})</span><b>${esc(p.per_100k)} /100k</b></div>`).join("");
  return `<div class="tt-title">${esc(d.name)} <span class="small">· ${esc(d.climate_zone)}</span></div>
    <div class="tt-row"><span>Population (illustrative)</span><b>${fmtInt(d.population_illustrative)}</b></div>
    <div class="tt-row"><span>Density per km²</span><b>${fmtInt(d.population_density_per_km2)}</b></div>
    <div class="tt-row"><span>Urbanisation</span><b>${esc(d.urbanisation_pct)}%</b></div>
    <div class="tt-row"><span>Flood exposure</span><b>${esc(d.flood_exposure_index)}</b></div>
    <div class="tt-row"><span>Drainage index</span><b>${esc(d.drainage_index)}</b></div>
    <div class="tt-row"><span>Water storage index</span><b>${esc(d.water_storage_index)}</b></div>
    ${peak}${extra}<div class="small" style="margin-top:4px">Synthetic profile · select to open</div>`;
}
