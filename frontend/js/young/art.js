// Original simple SVG art for the Young Minds mode (made here from basic shapes; no characters or mascots from
// anywhere else). Colours come from CSS variables so Day and Night both work.

export const sun = (size = 90) => `<svg class="art art-sun" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
  <g class="sun-rays">${Array.from({ length: 12 }, (_, i) => `<rect x="47" y="2" width="6" height="16" rx="3" transform="rotate(${i * 30} 50 50)"/>`).join("")}</g>
  <circle cx="50" cy="50" r="26"/><circle class="art-face" cx="41" cy="46" r="3"/><circle class="art-face" cx="59" cy="46" r="3"/>
  <path class="art-smile" d="M40 57 Q50 66 60 57" fill="none" stroke-width="3" stroke-linecap="round"/></svg>`;

export const cloud = (size = 140, rain = false) => `<svg class="art art-cloud${rain ? " raining" : ""}" width="${size}" height="${size * 0.75}" viewBox="0 0 140 105" aria-hidden="true">
  <g class="cloud-body"><circle cx="45" cy="45" r="25"/><circle cx="75" cy="35" r="30"/><circle cx="102" cy="50" r="22"/><rect x="25" y="45" width="95" height="27" rx="13"/></g>
  ${rain ? `<g class="rain-drops">${[38, 58, 78, 98].map((x, i) => `<path class="drop d${i}" d="M${x} 82 q-5 9 0 13 q5 -4 0 -13z"/>`).join("")}</g>` : ""}</svg>`;

export const mosquito = (size = 70) => `<svg class="art art-mosquito" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
  <ellipse class="wing" cx="40" cy="30" rx="18" ry="10" transform="rotate(-25 40 30)"/><ellipse class="wing" cx="62" cy="28" rx="18" ry="10" transform="rotate(25 62 28)"/>
  <ellipse class="body" cx="50" cy="52" rx="12" ry="20"/><circle class="body" cx="50" cy="28" r="10"/>
  <circle class="art-eye" cx="46" cy="26" r="3"/><circle class="art-eye" cx="55" cy="26" r="3"/>
  <path class="leg" d="M40 55 L22 70 M40 62 L26 82 M60 55 L78 70 M60 62 L74 82 M50 32 L50 14" fill="none" stroke-width="3" stroke-linecap="round"/></svg>`;

export const puddle = (size = 120) => `<svg class="art art-puddle" width="${size}" height="${size * 0.4}" viewBox="0 0 120 48" aria-hidden="true"><ellipse cx="60" cy="28" rx="56" ry="16"/><ellipse class="shine" cx="40" cy="24" rx="14" ry="4"/></svg>`;

export const thermometer = (size = 60) => `<svg class="art art-thermo" width="${size}" height="${size * 1.6}" viewBox="0 0 50 80" aria-hidden="true"><rect class="tube" x="19" y="4" width="12" height="52" rx="6"/><rect class="mercury" x="22" y="22" width="6" height="36" rx="3"/><circle class="mercury" cx="25" cy="64" r="11"/></svg>`;

/** The guide: an original smiling raindrop. */
export const buddy = (size = 64) => `<svg class="art art-buddy" width="${size}" height="${size * 1.2}" viewBox="0 0 80 96" aria-hidden="true">
  <path class="drop-body" d="M40 4 C40 4 8 46 8 62 a32 32 0 0 0 64 0 C72 46 40 4 40 4z"/>
  <circle class="art-face" cx="30" cy="60" r="4"/><circle class="art-face" cx="50" cy="60" r="4"/>
  <path class="art-smile" d="M28 72 Q40 82 52 72" fill="none" stroke-width="3.5" stroke-linecap="round"/><ellipse class="shine" cx="26" cy="40" rx="5" ry="9"/></svg>`;

export const badgeIcon = (kind) => ({
  wizard: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" class="b-ring"/><path class="b-mark" d="M20 44 L32 14 L44 44 Z"/><circle class="b-star" cx="32" cy="34" r="4"/></svg>`,
  quiz: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" class="b-ring"/><path class="b-mark" d="M20 33 L29 42 L45 22" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  map: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" class="b-ring"/><path class="b-mark" d="M32 14 a12 12 0 0 1 12 12 c0 9 -12 22 -12 22 s-12 -13 -12 -22 a12 12 0 0 1 12 -12z"/><circle class="b-star" cx="32" cy="26" r="4"/></svg>`,
  words: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" class="b-ring"/><rect class="b-mark" x="18" y="18" width="28" height="30" rx="3"/><path class="b-star-line" d="M24 28 h16 M24 35 h16 M24 42 h10" stroke-width="3" stroke-linecap="round"/></svg>`,
}[kind] || "");
