// Display formatting only. Every value comes from the API; nothing here derives recovery results.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function monthLabel(ym, style = "long") {
  if (!ym) return "—";
  const [y, m] = ym.split("-");
  const mon = MONTHS[Number(m) - 1];
  return style === "short" ? `${mon} ${y.slice(2)}` : `${mon} ${y}`;
}

export function fmtInt(n) { return n == null ? "—" : Number(n).toLocaleString("en-IN"); }

export function plural(n, one, many = `${one}s`) { return `${n} ${n === 1 ? one : many}`; }

export const STATUS = {
  recovered: { label: "Recovered", tone: "good", icon: "check" },
  not_recovered_within_horizon: { label: "Not recovered by horizon", tone: "warn", icon: "clock" },
  insufficient_data: { label: "Insufficient data", tone: "crit", icon: "alert" },
};

const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  minus: '<path d="M5 12h14"/>',
};

export function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`; }

export function statusPill(status) {
  const s = STATUS[status] || { label: status ? String(status) : "Not provided by the API", tone: "neutral", icon: "minus" };
  return `<span class="pill pill-${s.tone}">${icon(s.icon)}${esc(s.label)}</span>`;
}

// TSR text from a RecoveryBlock: value, lower bound, or status.
export function tsrText(block, horizonEnd) {
  if (!block) return { value: "—", unit: "", note: "Not provided by the API" };
  if (block.status === "recovered" && block.tsr_months != null) {
    return { value: String(block.tsr_months), unit: block.tsr_months === 1 ? "month" : "months",
      note: `Recovered ${monthLabel(block.recovery_month)}, confirmed ${monthLabel(block.recovery_confirmed_month)}` };
  }
  if (block.status === "not_recovered_within_horizon") {
    return { value: block.tsr_lower_bound_months != null ? `≥ ${block.tsr_lower_bound_months}` : "—", unit: "months",
      note: `No sustained recovery by ${monthLabel(horizonEnd)} (censored)` };
  }
  if (block.status === "insufficient_data") return { value: "—", unit: "", note: "Too many missing months to assess recovery" };
  return { value: "—", unit: "", note: "Not provided by the API" };
}

export function deltaText(rec) {
  if (!rec) return { value: "—", unit: "", note: "Not provided by the API", tone: "neutral" };
  if (rec.delta_status === "computed" && rec.delta_tsr_months != null) {
    const d = rec.delta_tsr_months;
    return { value: d > 0 ? `+${d}` : String(d), unit: Math.abs(d) === 1 ? "month" : "months",
      note: d > 0 ? "Recovery takes longer than baseline" : d < 0 ? "Recovery is faster than baseline" : "Same recovery time as baseline",
      tone: d > 0 ? "slower" : d < 0 ? "faster" : "same" };
  }
  if (rec.delta_status === "lower_bound" && rec.delta_tsr_lower_bound_months != null) {
    return { value: `≥ +${rec.delta_tsr_lower_bound_months}`, unit: "months", note: "Scenario never recovered, so the delay is at least this long", tone: "slower" };
  }
  return { value: "—", unit: "", note: "Delay cannot be determined for this selection", tone: "neutral" };
}

export function anomalyText(a) {
  const span = a.start_month === a.end_month ? monthLabel(a.start_month) : `${monthLabel(a.start_month)} – ${monthLabel(a.end_month)}`;
  const what = {
    monsoon_shift: `rainfall pattern shifted ${a.magnitude} months later`,
    heavy_rain: `+${a.magnitude} mm extreme rainfall`,
    prolonged_wet: `rainfall held at ≥ ${a.magnitude} mm per month`,
    rainfall_pct: `rainfall +${a.magnitude}%`,
    irregular_rain: `+${a.magnitude} mm every ${a.period_months}${a.period_months === 2 ? "nd" : "th"} month`,
    temperature_shift: `temperature +${a.magnitude} °C`,
  }[a.type] || `${a.type} (${a.magnitude} ${a.unit})`;
  return `${span}: ${what}`;
}

export function byId(list, id) { return list.find((x) => x.id === id); }

// Index range of months shown on charts.
export function rangeIdx(months, start, end) {
  const i0 = Math.max(0, months.indexOf(start));
  const j = months.indexOf(end);
  return [i0, j < 0 ? months.length - 1 : j];
}

// The disclaimer body without its leading "Synthetic data — research demonstration only." sentence.
export function disclaimerBody(meta) {
  return String(meta?.disclaimer || "").replace(/^Synthetic data\s*[—-]\s*research demonstration only\.\s*/i, "");
}
