"""Build the compact map file used by the 3D district map.

Source data (CC BY 4.0, DataMeet India community, https://github.com/datameet/maps):
  - Census 2011 district boundaries: website/docs/data/geojson/dists11.geojson
  - India composite outline:         Country/india-composite.geojson

Output: data/geo/tamil_nadu.json  (simplified; for display only, not for measuring area or distance)

Usage:
    python tools/build_geo.py <dists11.geojson> <india-composite.geojson>
"""
import json
import sys
from pathlib import Path

from shapely.geometry import shape, box, mapping, MultiPolygon, Polygon
from shapely.ops import unary_union

OUT = Path(__file__).resolve().parents[1] / "data" / "geo" / "tamil_nadu.json"
VIEW = box(74.6, 7.2, 82.6, 14.6)          # lon/lat window shown around Tamil Nadu
NEIGHBOURS = ["Kerala", "Karnataka", "Andhra Pradesh", "Puducherry"]


def polys(geom, tol, nd=3):
    """Simplify and return [[ring, ring...], ...] with rounded lon/lat."""
    g = geom.simplify(tol, preserve_topology=True)
    if g.is_empty:
        return []
    parts = list(g.geoms) if isinstance(g, MultiPolygon) else [g] if isinstance(g, Polygon) else [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon)]
    out = []
    for p in parts:
        if p.area < tol * tol * 4:
            continue
        rings = [p.exterior] + list(p.interiors)
        out.append([[[round(x, nd), round(y, nd)] for x, y in r.coords] for r in rings])
    return out


def main(dists_path, india_path):
    feats = json.load(open(dists_path))["features"]
    tn = [f for f in feats if f["properties"]["ST_NM"] == "Tamil Nadu"]
    districts = []
    for f in sorted(tn, key=lambda f: f["properties"]["DISTRICT"]):
        g = shape(f["geometry"]).buffer(0)
        rp = g.representative_point()
        districts.append({"name": f["properties"]["DISTRICT"], "anchor": [round(rp.x, 3), round(rp.y, 3)],
                          "polygons": polys(g, 0.008)})
    tn_union = unary_union([shape(f["geometry"]).buffer(0) for f in tn])
    HALO = tn_union.buffer(1.1, resolution=24).intersection(VIEW)
    neighbours = []
    for st in NEIGHBOURS:
        # clip neighbours to a soft halo around Tamil Nadu instead of a hard rectangle
        g = unary_union([shape(f["geometry"]).buffer(0) for f in feats if f["properties"]["ST_NM"] == st]).intersection(HALO)
        if g.is_empty:
            continue
        rp = g.representative_point()
        neighbours.append({"name": st, "anchor": [round(rp.x, 2), round(rp.y, 2)], "polygons": polys(g, 0.02)})
    india = unary_union([shape(f["geometry"]).buffer(0) for f in json.load(open(india_path))["features"]])
    out = {
        "attribution": "District and state boundaries: Census 2011, DataMeet India community (CC BY 4.0), simplified for display.",
        "source": "https://github.com/datameet/maps",
        "license": "https://creativecommons.org/licenses/by/4.0/",
        "note": "Census 2011 shows 32 districts; Tamil Nadu has since created more. Boundaries are simplified and for orientation only.",
        "view": list(VIEW.bounds),
        "center": [round(tn_union.centroid.x, 3), round(tn_union.centroid.y, 3)],
        "districts": districts,
        "state_outline": polys(tn_union, 0.01),
        "neighbours": neighbours,
        "seas": [{"name": "Bay of Bengal", "anchor": [81.4, 12.2]}, {"name": "Arabian Sea", "anchor": [75.3, 9.6]},
                 {"name": "Gulf of Mannar", "anchor": [79.25, 8.3]}, {"name": "Indian Ocean", "anchor": [79.4, 7.55]}],
        "india": polys(india, 0.12, 2),
        "india_bounds": [round(v, 2) for v in india.bounds],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB): {len(districts)} districts, {len(neighbours)} neighbours")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
