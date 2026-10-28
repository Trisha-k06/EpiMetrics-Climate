// Schematic outline of Tamil Nadu as [lon, lat] points, clockwise from the north-east coast.
// Hand-simplified and approximate: for placing the five districts on the map only,
// not for measuring distance or area. The map always says "schematic, not to scale".
export const TN_OUTLINE = [
  [80.33, 13.52], [80.29, 13.08], [80.20, 12.60], [79.98, 12.10], [79.86, 11.45], [79.84, 10.80],
  [79.88, 10.30], [79.55, 10.30], [79.20, 10.05], [79.05, 9.55], [79.28, 9.28], [78.92, 9.18],
  [78.42, 9.02], [78.16, 8.78], [77.88, 8.38], [77.55, 8.08], [77.22, 8.32], [77.18, 8.82],
  [77.12, 9.40], [77.26, 9.92], [77.08, 10.32], [76.84, 10.62], [76.66, 10.92], [76.44, 11.30],
  [76.33, 11.62], [76.86, 11.82], [77.42, 11.96], [77.68, 12.32], [77.94, 12.70], [78.38, 12.64],
  [78.56, 12.96], [79.14, 13.10], [79.58, 13.32], [79.98, 13.50],
];

export const PROJ = { lon0: 78.3, lat0: 10.8, k: 1.15 };

// [lon, lat] → planar x (east) and y (north) in map units.
export function project(lon, lat) {
  const c = Math.cos((PROJ.lat0 * Math.PI) / 180);
  return [(lon - PROJ.lon0) * PROJ.k * c, (lat - PROJ.lat0) * PROJ.k];
}
