// 3D district map (Three.js / WebGL) with a 2D SVG fallback.
// Pillar heights and labels show values the caller read from the API; this module computes nothing.
import { TN_OUTLINE, project } from "./geo.js";
import { token, currentTheme } from "./theme.js";
import { esc } from "./format.js";

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
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const toneVar = { slower: "--d-p3", faster: "--d-n3", same: "--ink-3", na: "--ink-3" };

/**
 * districts: meta.districts (with location)
 * opts: { onSelect(id), compact, hud }
 * returns { update(values, selectedId), dispose() }
 * values: { [id]: { height: number >= 0, text, sub, tone: "slower"|"faster"|"same"|"na", censored } }
 */
export async function createDistrictMap(container, districts, opts = {}) {
  container.classList.add("map3d");
  if (opts.compact) container.classList.add("compact");
  container.innerHTML = `<div class="map-hud" aria-hidden="true"><span>Schematic outline · locations approximate · not to scale</span><span class="map-hint">Drag to rotate · rotation pauses while you point at the map</span></div>`;
  const labelsHost = document.createElement("div");
  labelsHost.setAttribute("role", "group");
  labelsHost.setAttribute("aria-label", "Districts on the map");
  container.appendChild(labelsHost);
  const labels = new Map();
  for (const d of districts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "map-label";
    b.dataset.id = d.id;
    b.setAttribute("aria-pressed", "false");
    b.innerHTML = `<span>${esc(d.name)}</span>`;
    b.addEventListener("click", () => opts.onSelect?.(d.id));
    labelsHost.appendChild(b);
    labels.set(d.id, b);
  }
  const setLabel = (id, v, selected) => {
    const b = labels.get(id);
    const d = districts.find((x) => x.id === id);
    b.setAttribute("aria-pressed", String(selected));
    b.innerHTML = `<span>${esc(d.name)}</span>${v ? `<b>${esc(v.text)}</b>${v.sub ? `<span class="ml-sub">${esc(v.sub)}</span>` : ""}` : ""}`;
    b.setAttribute("aria-label", `${d.name}${v ? `: ${v.text}${v.sub ? `, ${v.sub}` : ""}` : ""}`);
  };

  let THREE = null;
  if (webglAvailable()) {
    try { THREE = await loadThree(); } catch { THREE = null; }
  }
  if (!THREE) return fallback2D(container, districts, labels, setLabel);

  // ---------- scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  container.insertBefore(renderer.domElement, container.firstChild);
  renderer.domElement.setAttribute("aria-hidden", "true");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  const target = new THREE.Vector3(0, 0.9, 0.1);
  const view = { az: 0, polar: 0.88, radius: 9.2 };
  const placeCamera = () => {
    camera.position.set(
      target.x + view.radius * Math.sin(view.polar) * Math.sin(view.az),
      target.y + view.radius * Math.cos(view.polar),
      target.z + view.radius * Math.sin(view.polar) * Math.cos(view.az));
    camera.lookAt(target);
  };

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(4, 9, 6);
  scene.add(sun);
  const glowLight = new THREE.PointLight(0xffffff, 0.6, 30);
  glowLight.position.set(0, 4, 0);
  scene.add(glowLight);

  const DEPTH = 0.32;
  const shape = new THREE.Shape(TN_OUTLINE.map(([lon, lat]) => new THREE.Vector2(...project(lon, lat))));
  const landGeo = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
  landGeo.rotateX(-Math.PI / 2);
  const landMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15, transparent: true, opacity: 0.94 });
  const land = new THREE.Mesh(landGeo, landMat);
  scene.add(land);
  const edgeGeo = new THREE.EdgesGeometry(landGeo, 30);
  const edgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85 });
  scene.add(new THREE.LineSegments(edgeGeo, edgeMat));
  const gridPts = [];
  for (let i = -13; i <= 13.001; i += 0.5) gridPts.push(-13, 0, i, 13, 0, i, i, 0, -13, i, 0, 13);
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPts, 3));
  const gridMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.22 });
  const grid = new THREE.LineSegments(gridGeo, gridMat);
  grid.position.y = -0.02;
  scene.add(grid);

  const pillarGeo = new THREE.CylinderGeometry(0.2, 0.2, 1, 40);
  const ringGeo = new THREE.RingGeometry(0.3, 0.42, 56);
  ringGeo.rotateX(-Math.PI / 2);
  const capGeo = new THREE.SphereGeometry(0.11, 24, 16);
  const pillars = new Map();
  for (const d of districts) {
    if (!d.location) continue;
    const [x, y] = project(d.location.lon, d.location.lat);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.2, transparent: true, opacity: 0.93 });
    const mesh = new THREE.Mesh(pillarGeo, mat);
    mesh.position.set(x, DEPTH, -y);
    mesh.userData.id = d.id;
    const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(x, DEPTH + 0.02, -y);
    const cap = new THREE.Mesh(capGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    cap.position.set(x, DEPTH, -y);
    scene.add(mesh, ring, cap);
    pillars.set(d.id, { mesh, ring, cap, mat, ringMat, h: 0.05, target: 0.05, tone: "na", censored: false, selected: false, x, z: -y });
  }

  const color = (v) => new THREE.Color(token(v) || "#888888");
  function applyTheme() {
    const night = currentTheme() === "dark";
    landMat.color = new THREE.Color(night ? "#0E2342" : "#D9E6F0");
    landMat.emissive = color("--accent").multiplyScalar(night ? 0.12 : 0.02);
    edgeMat.color = color("--accent");
    gridMat.color = color("--accent");
    gridMat.opacity = night ? 0.22 : 0.3;
    glowLight.color = color("--accent");
    for (const p of pillars.values()) paintPillar(p);
  }
  function paintPillar(p) {
    const c = color(toneVar[p.tone] || "--ink-3");
    p.mat.color = c;
    p.mat.emissive = c.clone().multiplyScalar(currentTheme() === "dark" ? 0.45 : 0.15);
    p.ringMat.color = color(p.selected ? "--accent" : toneVar[p.tone] || "--ink-3");
    p.cap.material.color = p.censored ? color("--warn") : c.clone().lerp(new THREE.Color("#ffffff"), 0.35);
  }
  applyTheme();
  const onTheme = () => applyTheme();
  window.addEventListener("themechange", onTheme);

  // ---------- interaction ----------
  let auto = !reduceMotion();
  let dragging = false, moved = 0, lastX = 0, lastY = 0, idleSince = performance.now();
  // Hold still while the user is pointing at or tabbing through the map, so labels are easy to select.
  let holding = false;
  container.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") holding = true; });
  container.addEventListener("pointerleave", () => { holding = false; idleSince = performance.now(); });
  container.addEventListener("focusin", () => { holding = true; });
  container.addEventListener("focusout", () => { holding = false; idleSince = performance.now(); });
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const el = renderer.domElement;
  el.addEventListener("pointerdown", (e) => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; container.classList.add("dragging"); el.setPointerCapture?.(e.pointerId); });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    view.az -= dx * 0.008;
    view.polar = Math.min(1.25, Math.max(0.45, view.polar - dy * 0.006));
    lastX = e.clientX; lastY = e.clientY;
    idleSince = performance.now();
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    container.classList.remove("dragging");
    if (moved < 6) {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects([...pillars.values()].map((p) => p.mesh))[0];
      if (hit) opts.onSelect?.(hit.object.userData.id);
    }
    idleSince = performance.now();
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", () => { dragging = false; container.classList.remove("dragging"); });

  const tools = document.createElement("div");
  tools.className = "map-tools";
  tools.innerHTML = `<button type="button" data-act="spin" aria-pressed="${auto}">Auto-rotate</button><button type="button" data-act="reset">Reset view</button>`;
  container.appendChild(tools);
  tools.querySelector('[data-act="spin"]').addEventListener("click", (e) => { auto = !auto; e.currentTarget.setAttribute("aria-pressed", String(auto)); });
  tools.querySelector('[data-act="reset"]').addEventListener("click", () => { view.az = 0; view.polar = 0.88; idleSince = performance.now(); });

  const leaders = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leaders.setAttribute("class", "map-leaders");
  leaders.setAttribute("aria-hidden", "true");
  const leaderLines = new Map();
  for (const id of pillars.keys()) {
    const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
    leaders.appendChild(ln);
    leaderLines.set(id, ln);
  }
  container.insertBefore(leaders, labelsHost);

  // ---------- loop ----------
  let raf = 0, visible = true;
  const v3 = new THREE.Vector3();
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    view.radius = (w < 520 ? 11.5 : 9.2) * (opts.compact ? 1.05 : 1);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  const io = new IntersectionObserver((en) => { visible = en[0].isIntersecting; if (visible && !raf) raf = requestAnimationFrame(tick); });
  io.observe(container);

  // Labels sit above their pillars; nearer labels keep their spot and farther ones stack above them.
  const TOP_CLEAR = 46; // keep labels below the Auto-rotate / Reset buttons
  function placeLabels() {
    const W = container.clientWidth, H = container.clientHeight;
    const items = [];
    for (const p of pillars.values()) {
      v3.set(p.x, DEPTH + p.h + 0.25, p.z).project(camera);
      items.push({ p, sx: ((v3.x + 1) / 2) * W, sy: ((1 - v3.y) / 2) * H, z: v3.z });
    }
    items.sort((a, b) => (b.p.selected - a.p.selected) || a.z - b.z);
    const placed = [];
    for (const it of items) {
      const w = it.p.lw || 90, h = it.p.lh || 44;
      let left = Math.min(Math.max(4, it.sx - w / 2), W - w - 4);
      let top = it.sy - h - 4;
      for (let k = 0; k < 8; k++) {
        const hit = placed.find((r) => left < r.left + r.w + 4 && left + w + 4 > r.left && top < r.top + r.h + 4 && top + h + 4 > r.top);
        if (!hit) break;
        top = hit.top - h - 4;
      }
      top = Math.max(TOP_CLEAR, top);
      placed.push({ left, top, w, h });
      const ln = leaderLines.get(it.p.mesh.userData.id);
      ln.setAttribute("x1", (left + w / 2).toFixed(1)); ln.setAttribute("y1", (top + h).toFixed(1));
      ln.setAttribute("x2", it.sx.toFixed(1)); ln.setAttribute("y2", (it.sy + 2).toFixed(1));
      const lb = labels.get(it.p.mesh.userData.id);
      lb.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
      lb.style.zIndex = String(100 - placed.length);
    }
  }

  function tick(now) {
    raf = 0;
    if (!visible) return;
    const t = now / 1000;
    if (auto && !dragging && !holding && now - idleSince > 1500) {
      view.az += 0.0025;
    }
    placeCamera();
    for (const p of pillars.values()) {
      p.h += (p.target - p.h) * (reduceMotion() ? 1 : 0.08);
      p.mesh.scale.y = Math.max(p.h, 0.001);
      p.mesh.position.y = DEPTH + p.h / 2;
      p.cap.position.y = DEPTH + p.h + 0.04;
      const pulse = reduceMotion() ? 0 : (Math.sin(t * 3) + 1) / 2;
      const s = p.selected ? 1 + pulse * 0.5 : p.censored ? 1 + pulse * 0.3 : 1;
      p.ring.scale.set(s, 1, s);
      p.ringMat.opacity = p.selected ? 0.85 - pulse * 0.4 : p.censored ? 0.55 : 0.28;
    }
    placeLabels();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  return {
    mode: "3d",
    update(values, selectedId) {
      for (const [id, p] of pillars) {
        const v = values[id];
        p.target = v ? Math.max(0.12, Math.min(4.2, v.height)) : 0.12;
        p.tone = v?.tone || "na";
        p.censored = !!v?.censored;
        p.selected = id === selectedId;
        paintPillar(p);
        setLabel(id, v, p.selected);
        const lb = labels.get(id);
        p.lw = lb.offsetWidth; p.lh = lb.offsetHeight;
      }
      // draw one frame now, even if the map is off screen
      for (const p of pillars.values()) if (reduceMotion() || !visible) p.h = p.target;
      for (const p of pillars.values()) { p.mesh.scale.y = p.h; p.mesh.position.y = DEPTH + p.h / 2; p.cap.position.y = DEPTH + p.h + 0.04; }
      placeCamera(); placeLabels(); renderer.render(scene, camera);
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      window.removeEventListener("themechange", onTheme);
      [landGeo, edgeGeo, gridGeo, pillarGeo, ringGeo, capGeo].forEach((g) => g.dispose());
      scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
      renderer.dispose();
      renderer.forceContextLoss?.();
      container.innerHTML = "";
    },
  };
}

// 2D schematic for browsers without WebGL.
function fallback2D(container, districts, labels, setLabel) {
  const pts = TN_OUTLINE.map(([lon, lat]) => project(lon, lat));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const pad = 0.6, minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const W = 400, H = (W * (maxY - minY)) / (maxX - minX);
  const sx = (x) => ((x - minX) / (maxX - minX)) * W, sy = (y) => H - ((y - minY) / (maxY - minY)) * H;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join("") + "Z";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;inset:8% 10%;width:80%;height:84%";
  svg.innerHTML = `<path d="${d}" style="fill:var(--surface-2);stroke:var(--accent);stroke-width:1.5"/>`;
  container.insertBefore(svg, container.firstChild);
  container.querySelector(".map-hint").textContent = "2D view (3D not available on this device)";
  const place = () => {
    const r = svg.getBoundingClientRect(), cr = container.getBoundingClientRect();
    const CW = container.clientWidth;
    const items = districts.filter((dd) => dd.location).map((dd) => {
      const [x, y] = project(dd.location.lon, dd.location.lat);
      const b = labels.get(dd.id);
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
      top = Math.max(4, top);
      placed.push({ left, top, w: it.w, h: it.h });
      it.b.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    }
  };
  const ro = new ResizeObserver(place);
  ro.observe(container);
  return {
    mode: "2d",
    update(values, selectedId) { for (const dd of districts) setLabel(dd.id, values[dd.id], dd.id === selectedId); place(); },
    dispose() { ro.disconnect(); container.innerHTML = ""; },
  };
}

/** Turn recovery-matrix cells for one scenario into map values (display only). */
export function mapValuesFromCells(cells, scenarioId, metric = "delta") {
  const out = {};
  for (const c of cells.filter((x) => x.scenario === scenarioId)) {
    if (metric === "interruptions") {
      out[c.district] = { height: c.interruption_count * 0.9, text: `${c.interruption_count} ${c.interruption_count === 1 ? "wave" : "waves"}`, sub: "before recovery", tone: c.interruption_count ? "slower" : "same", censored: c.status === "not_recovered_within_horizon" };
    } else if (metric === "above") {
      out[c.district] = { height: c.months_above_threshold * 0.2, text: `${c.months_above_threshold} mo`, sub: "above threshold", tone: c.months_above_threshold > 4 ? "slower" : "same", censored: c.status === "not_recovered_within_horizon" };
    } else if (c.scenario === "baseline") {
      out[c.district] = { height: (c.tsr_months ?? 0) * 0.22, text: `TSR ${c.tsr_months ?? "—"} mo`, sub: "baseline", tone: "same", censored: false };
    } else if (c.delta_status === "computed") {
      const v = c.delta_tsr_months;
      out[c.district] = { height: Math.abs(v) * 0.32, text: `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)} mo`, sub: `TSR ${c.tsr_months} mo`, tone: v > 0 ? "slower" : v < 0 ? "faster" : "same", censored: false };
    } else if (c.delta_status === "lower_bound") {
      out[c.district] = { height: c.delta_tsr_lower_bound_months * 0.32, text: `≥ +${c.delta_tsr_lower_bound_months} mo`, sub: "not recovered", tone: "slower", censored: true };
    } else {
      out[c.district] = { height: 0.1, text: "n/a", sub: c.status?.replaceAll("_", " "), tone: "na", censored: false };
    }
  }
  return out;
}
