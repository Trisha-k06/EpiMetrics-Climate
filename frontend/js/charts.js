// SVG charts. They draw what the API returns; positions come from months the API supplies
// (t0, recovery_month, wave onsets). No recovery logic lives here.
import { esc, monthLabel, fmtInt } from "./format.js";

const observers = new WeakMap();

function onResize(el, draw) {
  observers.get(el)?.disconnect();
  let w = 0;
  let raf = 0;
  const ro = new ResizeObserver((entries) => {
    const nw = Math.round(entries[0].contentRect.width);
    if (nw && nw !== w) { w = nw; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => draw(nw)); }
  });
  ro.observe(el);
  observers.set(el, ro);
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function ticks(min, max, count) {
  const step = niceStep((max - min) / count || 1);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const out = [];
  for (let v = lo; v <= hi + step * 0.001; v += step) out.push(+v.toFixed(6));
  return { ticks: out, max: out[out.length - 1], min: out[0] };
}

function tooltipEl(el) {
  let t = el.querySelector(".tooltip");
  if (!t) { t = document.createElement("div"); t.className = "tooltip"; t.hidden = true; t.setAttribute("role", "status"); el.appendChild(t); }
  return t;
}
function placeTooltip(el, t, x, y) {
  t.hidden = false;
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  const W = el.clientWidth;
  let left = x + 14;
  if (left + w > W) left = Math.max(0, x - w - 14);
  t.style.left = `${left}px`;
  t.style.top = `${Math.max(0, y - h / 2)}px`;
}

/**
 * Time chart over a month range.
 * cfg: { months, range:[i0,i1], height, unit, yFloorZero, series:[{label, values, color, width, dash}],
 *        steps:{label, values, color}, bands:[{start,end,label}], vlines:[{month,label,color,dash,row}],
 *        markers:[{month, value, color, label}], ariaLabel, valueFmt }
 */
export function timeChart(el, cfg) {
  el.classList.add("chart");
  let first = true;
  const draw = (W) => {
    const animate = first; first = false;
    const { months, range: [i0, i1] } = cfg;
    const n = i1 - i0 + 1;
    const H = cfg.height || (W < 520 ? 240 : 320);
    const ml = W < 520 ? 44 : 56, mr = 14, mt = cfg.topPad ?? 26, mb = 30;
    const pw = W - ml - mr, ph = H - mt - mb;
    const step = pw / n;
    const x = (i) => ml + (i - i0 + 0.5) * step;
    const vis = (arr) => arr.slice(i0, i1 + 1).filter((v) => v != null);
    const all = [...cfg.series.flatMap((s) => vis(s.values)), ...(cfg.steps ? vis(cfg.steps.values) : [])];
    let lo = cfg.yFloorZero === false ? Math.min(...all) : 0;
    let hi = Math.max(...all, 1);
    if (cfg.yFloorZero === false) { const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad; }
    const T = ticks(lo, hi, W < 520 ? 4 : 5);
    const y = (v) => mt + ph - ((v - T.min) / (T.max - T.min)) * ph;
    const fmt = cfg.valueFmt || ((v) => fmtInt(v));
    const idx = (m) => months.indexOf(m);
    const inRange = (i) => i >= i0 && i <= i1;
    const parts = [];

    // grid + y axis labels
    for (const t of T.ticks) {
      parts.push(`<line class="grid-line" x1="${ml}" x2="${W - mr}" y1="${y(t)}" y2="${y(t)}"/>`);
      parts.push(`<text x="${ml - 8}" y="${y(t) + 4}" text-anchor="end" class="num">${fmt(t)}</text>`);
    }
    if (cfg.unit) parts.push(`<text x="2" y="${mt - 12}" text-anchor="start" class="axis-label">${esc(cfg.unit)}</text>`);
    // x axis labels: Jan (and Jul when roomy)
    const yearsOnly = n > 60 || step < 9;
    for (let i = i0; i <= i1; i++) {
      const m = months[i];
      const mm = m.slice(5);
      if (mm === "01" || (!yearsOnly && mm === "07" && step > 12)) {
        parts.push(`<line x1="${x(i)}" x2="${x(i)}" y1="${mt + ph}" y2="${mt + ph + 4}" style="stroke:var(--line)"/>`);
        parts.push(`<text x="${x(i)}" y="${mt + ph + 18}" text-anchor="middle">${yearsOnly ? m.slice(0, 4) : monthLabel(m, "short")}</text>`);
      }
    }
    // anomaly bands
    for (const b of cfg.bands || []) {
      const s = Math.max(idx(b.start), i0), e = Math.min(idx(b.end), i1);
      if (s < 0 || e < s) continue;
      const bx = x(s) - step / 2, bw = (e - s + 1) * step;
      parts.push(`<rect x="${bx}" y="${mt}" width="${bw}" height="${ph}" style="fill:var(--anomaly);stroke:var(--anomaly-line);stroke-width:1;stroke-dasharray:3 3" rx="2"/>`);
      if (b.label && bw > 60) parts.push(`<text x="${bx + 6}" y="${mt + 14}" class="mark-label" style="fill:var(--ink-2)">${esc(b.label)}</text>`);
    }
    parts.push(`<line class="baseline-axis" x1="${ml}" x2="${W - mr}" y1="${mt + ph}" y2="${mt + ph}"/>`);
    // threshold step line
    if (cfg.steps) {
      let d = "";
      for (let i = i0; i <= i1; i++) {
        const v = cfg.steps.values[i];
        if (v == null) continue;
        const xl = x(i) - step / 2, xr = x(i) + step / 2;
        d += `${d ? "L" : "M"}${xl.toFixed(1)} ${y(v).toFixed(1)}L${xr.toFixed(1)} ${y(v).toFixed(1)}`;
      }
      parts.push(`<path d="${d}" style="fill:none;stroke:${cfg.steps.color};stroke-width:1.5;stroke-dasharray:5 4"/>`);
    }
    // vertical reference lines (t0, recovery months)
    const tags = [];
    for (const v of cfg.vlines || []) {
      const i = idx(v.month);
      if (!inRange(i)) continue;
      const vx = cfg.vlineAtStart ? x(i) - step / 2 : x(i);
      parts.push(`<line x1="${vx}" x2="${vx}" y1="${mt}" y2="${mt + ph}" style="stroke:${v.color};stroke-width:${v.width || 1.5};stroke-dasharray:${v.dash || "none"}"/>`);
      if (v.label && (v.top || W >= 520)) tags.push({ x: vx, label: v.label, color: v.color, row: v.row || 0, top: v.top });
    }
    // series lines
    for (const s of cfg.series) {
      let d = "";
      for (let i = i0; i <= i1; i++) {
        const v = s.values[i];
        if (v == null) { d += " "; continue; }
        d += `${d && !d.endsWith(" ") ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      }
      parts.push(`<path${animate && !s.dash ? ' class="draw-line" pathLength="1"' : ""} d="${d.trim()}" style="fill:none;stroke:${s.color};stroke-width:${s.width || 2};stroke-linejoin:round;stroke-linecap:round;${s.dash ? `stroke-dasharray:${s.dash}` : ""}"/>`);
    }
    // markers (secondary waves)
    for (const mk of cfg.markers || []) {
      const i = idx(mk.month);
      if (!inRange(i) || mk.value == null) continue;
      const cx = x(i), cy = y(mk.value);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="6" style="fill:${mk.color};stroke:var(--surface);stroke-width:2"/>`);
      if (mk.label && W >= 520) parts.push(`<text x="${cx}" y="${cy - 12}" text-anchor="middle" class="mark-label">${esc(mk.label)}</text>`);
    }
    // tags for vertical lines, stacked by row to avoid collisions
    for (const t of tags) {
      const ty = t.top ? mt - 10 : mt + ph - 10 - t.row * 18;
      const right = t.x > ml + pw * 0.7;
      const tx = right ? t.x - 6 : t.x + 6;
      parts.push(`<text x="${tx}" y="${ty}" text-anchor="${right ? "end" : "start"}" class="mark-label">${esc(t.label)}</text>`);
    }
    // hover layer
    parts.push(`<line class="hover-x" x1="0" x2="0" y1="${mt}" y2="${mt + ph}" style="stroke:var(--ink-3);stroke-width:1;opacity:0"/>`);
    cfg.series.forEach((s, k) => parts.push(`<circle class="hover-dot" data-k="${k}" r="4.5" cx="-10" cy="-10" style="fill:${s.color};stroke:var(--surface);stroke-width:2;opacity:0"/>`));
    parts.push(`<rect class="hover-zone" x="${ml}" y="${mt}" width="${pw}" height="${ph}" style="fill:transparent;cursor:crosshair"/>`);

    el.querySelector("svg")?.remove();
    el.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(cfg.ariaLabel || "")}">${parts.join("")}</svg>`);
    const svg = el.querySelector("svg");
    const tt = tooltipEl(el);
    const hx = svg.querySelector(".hover-x");
    const dots = [...svg.querySelectorAll(".hover-dot")];
    const zone = svg.querySelector(".hover-zone");
    const show = (evt) => {
      const r = svg.getBoundingClientRect();
      const px = (evt.clientX - r.left) * (W / r.width);
      const i = Math.min(i1, Math.max(i0, Math.round((px - ml) / step - 0.5) + i0));
      hx.setAttribute("x1", x(i)); hx.setAttribute("x2", x(i)); hx.style.opacity = 1;
      dots.forEach((d, k) => {
        const v = cfg.series[k].values[i];
        if (v == null) { d.style.opacity = 0; return; }
        d.setAttribute("cx", x(i)); d.setAttribute("cy", y(v)); d.style.opacity = 1;
      });
      const rows = cfg.series.map((s) => `<div class="tt-row"><span><span class="swatch" style="background:${s.color}"></span>${esc(s.label)}</span><b>${s.values[i] == null ? "—" : fmt(s.values[i])}${cfg.unitShort ? ` ${cfg.unitShort}` : ""}</b></div>`);
      if (cfg.steps) rows.push(`<div class="tt-row"><span><span class="swatch swatch-line"></span>${esc(cfg.steps.label)}</span><b>${fmt(cfg.steps.values[i])}</b></div>`);
      const notes = (cfg.notesAt?.(months[i]) || []).map((t) => `<div class="small" style="margin-top:4px">${esc(t)}</div>`).join("");
      tt.innerHTML = `<div class="tt-title">${monthLabel(months[i])}</div>${rows.join("")}${notes}`;
      placeTooltip(el, tt, x(i) * (r.width / W), (evt.clientY - r.top));
    };
    const hide = () => { tt.hidden = true; hx.style.opacity = 0; dots.forEach((d) => (d.style.opacity = 0)); };
    zone.addEventListener("pointermove", show);
    zone.addEventListener("pointerdown", show);
    zone.addEventListener("pointerleave", hide);
  };
  onResize(el, draw);
}

/**
 * Recovery track: one row per series, drawn on the same month axis as the case chart.
 * Bars span from t0 to the API's recovery_month (recovering) and recovery_month → recovery_confirmed_month (confirmation).
 */
export function recoveryTrack(el, { months, range: [i0, i1], t0, rows, horizonEnd, ariaLabel }) {
  el.classList.add("chart");
  const draw = (W) => {
    const n = i1 - i0 + 1;
    const ml = W < 520 ? 44 : 56, mr = 14;
    const pw = W - ml - mr, step = pw / n;
    const rowH = 54, top = 8;
    const H = top + rows.length * rowH + 24;
    const xs = (i) => ml + (i - i0) * step; // month start edge
    const idx = (m) => months.indexOf(m);
    const clamp = (i) => Math.min(Math.max(i, i0), i1 + 1);
    const parts = [];
    const ti = idx(t0);
    rows.forEach((r, k) => {
      const yTop = top + k * rowH;
      const by = yTop + 22, bh = 16;
      const b = r.block || {};
      let label = `${r.label}`;
      if (b.status === "recovered") label += ` · TSR ${b.tsr_months} ${b.tsr_months === 1 ? "month" : "months"}`;
      else if (b.status === "not_recovered_within_horizon") label += ` · not recovered by ${monthLabel(horizonEnd)} (TSR ≥ ${b.tsr_lower_bound_months} months)`;
      else if (b.status === "insufficient_data") label += " · insufficient data";
      parts.push(`<text x="${ml}" y="${yTop + 14}" class="mark-label" style="fill:var(--ink)">${esc(label)}</text>`);
      parts.push(`<rect x="${ml}" y="${by}" width="${pw}" height="${bh}" rx="3" style="fill:var(--surface-2)"/>`);
      if (ti >= 0 && b.status === "recovered" && b.recovery_month) {
        const ri = idx(b.recovery_month), ci = idx(b.recovery_confirmed_month);
        const x1 = xs(clamp(ti)) + step / 2, x2 = xs(clamp(ri));
        if (x2 > x1) parts.push(`<rect x="${x1}" y="${by}" width="${x2 - x1}" height="${bh}" rx="3" style="fill:${r.color};fill-opacity:.32"/>`);
        const x3 = xs(clamp(ci + 1));
        if (x3 > x2) parts.push(`<rect x="${x2}" y="${by}" width="${x3 - x2}" height="${bh}" rx="3" style="fill:${r.color}"/>`);
      } else if (ti >= 0 && b.status === "not_recovered_within_horizon") {
        const x1 = xs(clamp(ti)) + step / 2, x2 = xs(i1 + 1);
        parts.push(`<rect x="${x1}" y="${by}" width="${x2 - x1 - 8}" height="${bh}" rx="3" style="fill:${r.color};fill-opacity:.32"/>`);
        parts.push(`<path d="M${x2 - 9} ${by - 2}L${x2} ${by + bh / 2}L${x2 - 9} ${by + bh + 2}Z" style="fill:${r.color}"/>`);
      }
      for (const w of r.waves || []) {
        const wi = idx(w.onset_month);
        if (wi < i0 || wi > i1) continue;
        const cx = xs(wi) + step / 2, cy = by + bh / 2;
        const d = `M${cx} ${cy - 8}L${cx + 8} ${cy}L${cx} ${cy + 8}L${cx - 8} ${cy}Z`;
        parts.push(w.interrupts_recovery
          ? `<path d="${d}" style="fill:var(--ink);stroke:var(--surface);stroke-width:2"><title>Secondary wave from ${monthLabel(w.onset_month)} interrupts recovery</title></path>`
          : `<path d="${d}" style="fill:var(--surface);stroke:var(--ink);stroke-width:2"><title>Wave from ${monthLabel(w.onset_month)} after recovery</title></path>`);
      }
    });
    if (ti >= i0 && ti <= i1) {
      const tx = xs(ti) + step / 2;
      parts.push(`<line x1="${tx}" x2="${tx}" y1="${top + 18}" y2="${H - 18}" style="stroke:var(--ink-2);stroke-width:1.5;stroke-dasharray:4 3"/>`);
      parts.push(`<text x="${tx}" y="${H - 4}" text-anchor="middle" class="mark-label">t0 peak · ${monthLabel(t0, "short")}</text>`);
    }
    el.querySelector("svg")?.remove();
    el.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(ariaLabel || "")}">${parts.join("")}</svg>`);
  };
  onResize(el, draw);
}

/** Validation scatter: true TSR (x) vs estimated TSR (y) with p10–p90 bars. */
export function scatterChart(el, { points, ariaLabel }) {
  el.classList.add("chart");
  const draw = (W) => {
    const H = W < 520 ? 300 : 360;
    const ml = 48, mr = 16, mt = 16, mb = 40;
    const pw = W - ml - mr, ph = H - mt - mb;
    const vals = points.flatMap((p) => [p.x, p.y, p.p90 ?? p.y]).filter((v) => v != null);
    const T = ticks(0, Math.max(...vals, 4) + 1, 5);
    const sx = (v) => ml + (v / T.max) * pw;
    const sy = (v) => mt + ph - (v / T.max) * ph;
    const parts = [];
    for (const t of T.ticks) {
      parts.push(`<line class="grid-line" x1="${ml}" x2="${W - mr}" y1="${sy(t)}" y2="${sy(t)}"/>`);
      parts.push(`<text x="${ml - 8}" y="${sy(t) + 4}" text-anchor="end" class="num">${t}</text>`);
      parts.push(`<text x="${sx(t)}" y="${mt + ph + 16}" text-anchor="middle" class="num">${t}</text>`);
    }
    parts.push(`<text x="${ml + pw / 2}" y="${H - 4}" text-anchor="middle" class="axis-label">True TSR from noise-free ground truth (months)</text>`);
    parts.push(`<text x="${14}" y="${mt + ph / 2}" text-anchor="middle" class="axis-label" transform="rotate(-90 14 ${mt + ph / 2})">Estimated TSR (months)</text>`);
    parts.push(`<line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(T.max)}" y2="${sy(T.max)}" style="stroke:var(--ink-3);stroke-width:1.5;stroke-dasharray:5 4"/>`);
    parts.push(`<text x="${sx(T.max) - 4}" y="${sy(T.max) + 14}" text-anchor="end" class="mark-label">estimate = truth</text>`);
    for (const p of points) {
      if (p.p10 != null && p.p90 != null) parts.push(`<line x1="${sx(p.x)}" x2="${sx(p.x)}" y1="${sy(p.p10)}" y2="${sy(p.p90)}" style="stroke:var(--accent);stroke-width:1.5;opacity:.45"/>`);
    }
    for (const p of points) parts.push(`<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="5.5" style="fill:var(--accent);fill-opacity:.8;stroke:var(--surface);stroke-width:2"/>`);
    parts.push(`<rect class="hover-zone" x="${ml}" y="${mt}" width="${pw}" height="${ph}" style="fill:transparent"/>`);
    el.querySelector("svg")?.remove();
    el.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(ariaLabel || "")}">${parts.join("")}</svg>`);
    const svg = el.querySelector("svg");
    const tt = tooltipEl(el);
    svg.querySelector(".hover-zone").addEventListener("pointermove", (evt) => {
      const r = svg.getBoundingClientRect();
      const px = (evt.clientX - r.left) * (W / r.width), py = (evt.clientY - r.top) * (H / r.height);
      let best = null, bd = 18 * 18;
      for (const p of points) {
        const d = (sx(p.x) - px) ** 2 + (sy(p.y) - py) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) { tt.hidden = true; return; }
      const same = points.filter((p) => p.x === best.x && p.y === best.y);
      tt.innerHTML = `<div class="tt-title">True ${best.x} · estimated ${best.y} months</div>` +
        same.slice(0, 8).map((p) => `<div class="tt-row"><span>${esc(p.label)}</span><b>${p.p10 != null ? `${p.p10}–${p.p90}` : "—"}</b></div>`).join("") +
        (same.length > 8 ? `<div class="small">+${same.length - 8} more</div>` : "") +
        `<div class="small" style="margin-top:4px">Right column: p10–p90 across replicates</div>`;
      placeTooltip(el, tt, sx(best.x) * (r.width / W), sy(best.y) * (r.height / H));
    });
    svg.querySelector(".hover-zone").addEventListener("pointerleave", () => (tt.hidden = true));
  };
  onResize(el, draw);
}
