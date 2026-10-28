"""API tests. The reference numbers are the printed outputs of notebooks 01–07."""
import math
import time

import numpy as np
import pandas as pd
import pytest

from backend import app as app_module
from backend.data import ROOT

TOL = 0.002


def close(a, b, tol=TOL):
    return a is not None and abs(a - b) <= tol


# ---------------------------------------------------------------------------- recovery engine
def test_engine_matches_simulation_runs_all_280_rows():
    res = app_module.store.engine_vs_runs()
    assert res["rows"] == 280
    assert res["mismatches"] == []


def test_simulation_cbe_dengue_delayed_monsoon(get):
    r = get("/simulations", district="cbe", disease="dengue", scenario="delayed_monsoon")
    assert r.status_code == 200
    b = r.json()
    assert b["synthetic"] is True
    assert b["reference"]["t0_month"] == "2022-11"
    rec = b["recovery"]
    assert rec["baseline"]["tsr_months"] == 3
    assert rec["scenario"]["tsr_months"] == 13
    assert rec["delta_tsr_months"] == 10 and rec["delta_status"] == "computed"
    interrupting = [w for w in b["waves"]["scenario"] if w["interrupts_recovery"]]
    assert len(interrupting) == 1 and interrupting[0]["onset_month"] == "2023-06"
    assert rec["scenario"]["interruption_count"] == 1
    assert len(b["months"]) == len(b["threshold_cases"]) == len(b["series"]["scenario"]["observed_cases"]) == 120


def test_simulation_matches_runs_for_every_mask(get):
    runs = pd.read_csv(ROOT / "data/outputs/simulation_runs.csv")
    for r in runs[(runs.district_id == "chn") & (runs.disease_id == "dengue")].itertuples():
        mask = r.mask_id if isinstance(r.mask_id, str) else "none"
        b = get("/simulations", district="chn", disease="dengue", scenario=r.scenario_id,
                **({} if mask == "none" else {"mask": mask})).json()
        sc = b["recovery"]["scenario"]
        assert sc["status"] == r.recovery_status
        tsr = None if math.isnan(r.time_to_sustained_recovery_months) else int(r.time_to_sustained_recovery_months)
        assert sc["tsr_months"] == tsr
        assert b["reference"]["t0_month"] == r.reference_month


def test_masked_months_are_null_and_outage_is_insufficient(get):
    gap = get("/simulations", district="cbe", disease="dengue", scenario="baseline", mask="cases_gap_3m").json()
    i = gap["months"].index("2023-01")
    assert gap["series"]["baseline"]["observed_cases"][i:i + 3] == [None, None, None]
    assert gap["request"]["mask"] == "cases_gap_3m"
    out = get("/simulations", district="cbe", disease="dengue", scenario="baseline", mask="cases_outage_9m").json()
    assert out["recovery"]["baseline"]["status"] == "insufficient_data"
    assert out["recovery"]["delta_status"] == "undefined"


def test_recovery_matrix_35_cells(get):
    for mask in (None, "mar_10pct"):
        b = get("/recovery-matrix", disease="dengue", **({"mask": mask} if mask else {})).json()
        assert len(b["cells"]) == 35
        assert b["request"]["mask"] == mask


def test_meta_and_districts(get):
    m = get("/meta").json()
    assert m["synthetic"] and len(m["districts"]) == 5 and len(m["scenarios"]) == 7
    assert {"flood_exposure_index", "population_density_per_km2"} <= set(m["districts"][0])
    assert [x["id"] for x in m["masks"]] == ["none", "mar_10pct", "cases_gap_3m", "cases_outage_9m"]
    d = get("/districts").json()
    cbe = next(x for x in d["districts"] if x["id"] == "cbe")
    assert cbe["outbreak_peak"]["dengue"]["t0_month"] == "2022-11"
    assert cbe["outbreak_peak"]["dengue"]["per_100k"] > 0


def test_validation_shape(get):
    b = get("/validation", role="analyst", disease="dengue").json()
    assert len(b["rows"]) == 140  # 35 series × 4 masks
    assert {s["mask"] for s in b["summary_by_mask"]} == {None, "mar_10pct", "cases_gap_3m", "cases_outage_9m"}
    assert any(s["is_default"] for s in b["sensitivity"])


# ---------------------------------------------------------------------------- notebooks 01–02
def test_data_audit_all_pass(get):
    b = get("/analytics/data-audit").json()
    assert b["all_pass"] and len(b["checks"]) == 6
    assert b["split"]["train"]["rows"] == 840 and b["split"]["test"]["rows"] == 360
    assert len(b["catalog"]) == 19


def test_notebook02_correlations(get):
    b = get("/analytics/eda", district="chn", disease="dengue").json()
    lag = {(r["variable"], r["lag"]): r for r in b["lag_correlations"]}
    for l, ref in zip(range(4), (0.333, 0.442, 0.416, 0.271)):
        assert close(lag[("rainfall_mm", l)]["dengue"], ref)
    assert close(lag[("mean_temperature_c", 0)]["dengue"], -0.584)
    assert close(lag[("mean_temperature_c", 3)]["malaria"], 0.489)
    dm = next(r for r in b["case_changes"] if r["scenario"] == "delayed_monsoon")
    assert dm["months_changed"] == 15 and close(dm["largest_increase_per_100k"], 2.828)
    assert set(b["scenario_period"]["cases_per_100k"]) == set(app_module.store.scenario_ids)


# ---------------------------------------------------------------------------- notebooks 03–05
def test_notebook03_seasonal_naive(get):
    d = get("/analytics/forecast-summary", disease="dengue").json()
    p = {m["id"]: m for m in d["pooled"]}
    assert close(p["seasonal_naive"]["mae"], 1.101) and close(p["seasonal_naive"]["rmse"], 2.383)
    assert close(p["seasonal_naive"]["bias"], -0.650)
    m = {x["id"]: x for x in get("/analytics/forecast-summary", disease="malaria").json()["pooled"]}
    assert close(m["seasonal_naive"]["mae"], 0.357) and close(m["seasonal_naive"]["rmse"], 0.634)
    chn = next(r for r in d["districts"] if r["district"] == "chn")
    assert close(chn["seasonal_naive"], 1.133)


def test_notebook04_random_forest_pooled(get):
    p = {m["id"]: m for m in get("/analytics/forecast-summary", disease="dengue").json()["pooled"]}
    assert close(p["random_forest"]["mae"], 1.054) and close(p["random_forest"]["rmse"], 2.183)


def test_notebook05_chn_dengue(get):
    b = get("/analytics/forecasts", district="chn", disease="dengue").json()
    m = {x["id"]: x for x in b["models"]}
    for k, (mae, rmse) in {"arima": (1.232, 2.489), "sarima": (1.080, 2.445),
                           "sarimax": (0.932, 2.284), "sarimax_lagged": (0.948, 2.290)}.items():
        assert close(m[k]["mae"], mae), (k, m[k]["mae"])
        assert close(m[k]["rmse"], rmse), (k, m[k]["rmse"])
        assert m[k]["converged"] is True
        assert len(m[k]["predictions"]) == 36
    assert m["random_forest"]["feature_importance"] and len(m["random_forest"]["feature_importance"]) == 14
    assert m["seasonal_naive"]["mae_outbreak"] > m["seasonal_naive"]["mae_other"]
    assert len(b["outbreak_months"]) == 36 and any(b["outbreak_months"])


# ---------------------------------------------------------------------------- notebooks 06–07
def test_episode_totals_and_matching(get):
    b = get("/analytics/episodes", disease="dengue").json()
    assert b["totals"] == {"episodes": 602, "recovered": 578, "unresolved": 24, "interruptions": 429}
    m = b["matched"]
    assert m["climate_episodes"] == 510 and m["matched_episodes"] == 497
    assert close(m["matching_coverage_pct"], 97.45, 0.005)
    assert m["valid_delta_tsr_pairs"] == 483 and close(m["mean_delta_tsr_months"], 0.321)
    base = {r["disease"]: r["episodes"] for r in b["by_scenario"] if r["scenario"] == "baseline"}
    assert base == {"dengue": 39, "malaria": 53}
    sens = {r["sustained_months"]: r["total_episodes"] for r in b["sensitivity"] if r["disease"] == "dengue"}
    assert sens == {2: 53, 3: 39, 4: 35}
    assert [t["pass"] for t in b["unit_tests"]] == [True, True, True, True]


def test_episodes_equal_published_csv_row_for_row():
    ref = pd.read_csv(ROOT / "data/derived/recovery_analysis/recovery_episode_results.csv")
    mine = app_module.analytics.episode_table(3)
    assert len(mine) == len(ref) == 602
    ref = ref.assign(outbreak_onset=ref.outbreak_onset.str[:7], recovery_date=ref.recovery_date.str[:7])
    for col in ("district_id", "disease_id", "scenario_id", "outbreak_onset", "recovery_status"):
        assert mine[col].tolist() == ref[col].tolist(), col
    assert mine.episode_number.tolist() == ref.episode_number.tolist()
    assert mine.recovery_interruptions.tolist() == ref.recovery_interruptions.tolist()
    assert np.array_equal(mine.recovery_months.to_numpy(float), ref.recovery_months.to_numpy(float), equal_nan=True)
    assert [None if pd.isna(x) else x for x in mine.recovery_date] == [None if pd.isna(x) else x for x in ref.recovery_date]


# ---------------------------------------------------------------------------- security
def test_401_without_token(client):
    for path in ("/meta", "/simulations?district=cbe&disease=dengue&scenario=baseline", "/analytics/episodes?disease=dengue"):
        r = client.get(f"/api/v1{path}")
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "unauthorized"


def test_401_with_garbage_token(client):
    r = client.get("/api/v1/meta", headers={"Authorization": "Bearer not.a.token"})
    assert r.status_code == 401


def test_health_and_login_are_public(client):
    assert client.get("/api/v1/health").status_code == 200


def test_403_for_viewer(client, get, tokens):
    assert get("/validation", disease="dengue").status_code == 403
    assert get("/validation", disease="dengue").json()["error"]["code"] == "forbidden"
    h = {"Authorization": f"Bearer {tokens['viewer']}"}
    assert client.post("/api/v1/exports", json={"kind": "report_pdf"}, headers=h).status_code == 403
    assert client.post("/api/v1/integrity/verify", headers=h).status_code == 403
    assert get("/audit-log").status_code == 403
    ha = {"Authorization": f"Bearer {tokens['analyst']}"}
    assert client.post("/api/v1/exports", json={"kind": "report_pdf", "district": "cbe"}, headers=ha).status_code == 200
    assert client.post("/api/v1/integrity/verify", headers=ha).status_code == 403


def test_integrity_scope_by_role(get):
    assert get("/integrity").json()["scope"] == "summary"
    assert get("/integrity").json()["files"] == []
    admin = get("/integrity", role="admin").json()
    if admin.get("scope") == "full":
        assert admin["files"]


def test_429_after_five_bad_passwords(client):
    for i in range(4):
        assert client.post("/api/v1/auth/login", json={"username": "analyst", "password": "wrong"}).status_code == 401
    r = client.post("/api/v1/auth/login", json={"username": "analyst", "password": "wrong"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_attempts"
    # locked even with the right password
    r = client.post("/api/v1/auth/login", json={"username": "analyst", "password": "analyst-demo-2026"})
    assert r.status_code == 429 and "Retry-After" in r.headers


def test_unknown_user_is_401_not_404(client):
    r = client.post("/api/v1/auth/login", json={"username": "nobody", "password": "x"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "bad_credentials"


def test_400_bad_id_and_404_unknown_id(get):
    r = get("/simulations", district="CBE;drop", disease="dengue", scenario="baseline")
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_request"
    r = get("/simulations", district="xx", disease="dengue", scenario="baseline")
    assert r.status_code == 404 and r.json()["error"]["code"] == "unknown_district"
    assert get("/simulations", district="cbe", disease="dengue", scenario="baseline", mask="nope").status_code == 404
    assert get("/simulations", district="cbe").status_code == 400  # missing parameters
    assert get("/no-such-endpoint").status_code == 404
    assert get("/no-such-endpoint").json()["error"]["code"] == "unknown_endpoint"


def test_logout_revokes_token(client):
    t = client.post("/api/v1/auth/login", json={"username": "viewer", "password": "viewer-demo-2026"}).json()["token"]
    h = {"Authorization": f"Bearer {t}"}
    assert client.get("/api/v1/auth/me", headers=h).status_code == 200
    assert client.post("/api/v1/auth/logout", headers=h).status_code == 200
    assert client.get("/api/v1/auth/me", headers=h).status_code == 401


def test_sliding_refresh_and_expiry(client, monkeypatch):
    monkeypatch.setenv("EPIMETRICS_SESSION_MINUTES", "0.05")  # 3 s session, refresh after 1 s
    t = client.post("/api/v1/auth/login", json={"username": "viewer", "password": "viewer-demo-2026"}).json()
    assert t["expires_in"] == 3
    h = {"Authorization": f"Bearer {t['token']}"}
    time.sleep(1.2)
    r = client.get("/api/v1/auth/me", headers=h)
    assert r.status_code == 200 and r.headers.get("X-Session-Token")
    time.sleep(3.2)
    assert client.get("/api/v1/auth/me", headers=h).status_code == 401


def test_security_headers_and_static_site(client, get):
    r = get("/meta")
    assert r.headers["Cache-Control"] == "no-store"
    assert "script-src 'self'" in r.headers["Content-Security-Policy"]
    assert r.headers["X-Frame-Options"] == "DENY" and r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["Referrer-Policy"] == "no-referrer"
    page = client.get("/")
    assert page.status_code == 200 and "<html" in page.text.lower()
    assert "Content-Security-Policy" in page.headers


def test_no_nan_in_any_json(get):
    # JSON parsing in TestClient would accept NaN tokens; check the raw text instead.
    for path, params in [("/simulations", dict(district="tnj", disease="malaria", scenario="irregular_rain", mask="mar_10pct")),
                         ("/analytics/eda", dict(district="mdu", disease="malaria")),
                         ("/analytics/forecasts", dict(district="try", disease="malaria")),
                         ("/analytics/episodes", dict(disease="malaria")),
                         ("/validation", dict(disease="malaria"))]:
        r = get(path, role="admin", **params)
        assert r.status_code == 200, path
        assert "NaN" not in r.text and "Infinity" not in r.text, path


def test_validate_runs_semantics_and_unit_tests(client, tokens):
    r = client.post("/api/v1/integrity/validate", headers={"Authorization": f"Bearer {tokens['admin']}"})
    assert r.status_code == 200
    b = r.json()
    assert b["semantic"]["total"] == 34 and b["semantic"]["passed"] == 34
    assert b["all_pass"] and b["total"] == 34 + 1 + 4
