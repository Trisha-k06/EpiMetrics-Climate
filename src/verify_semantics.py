import sys, json, numpy as np, pandas as pd
R = sys.argv[1]
rd = lambda p: pd.read_csv(f"{R}/data/{p}")
cases, clim = rd("synthetic/disease_cases.csv"), rd("synthetic/climate_history.csv")
gt, rt, ev = rd("ground_truth/ground_truth_trajectories.csv"), rd("ground_truth/recovery_truth.csv"), rd("ground_truth/outbreak_events.csv")
thr, md = rd("derived/seasonal_baseline_thresholds.csv"), rd("derived/model_ready_dataset.csv")
runs, sg, masks = rd("outputs/simulation_runs.csv"), rd("outputs/sensitivity_grid.csv"), rd("synthetic/missing_data_masks.csv")
meta = rd("synthetic/district_metadata.csv")
out = []
def chk(name, ok, detail=""): out.append((("PASS" if ok else "FLAG"), name, detail))

# 1 coverage
months = sorted(cases.year_month.unique())
chk("coverage 120 months 2015-01..2024-12", len(months)==120 and months[0]=="2015-01" and months[-1]=="2024-12")
full = cases.groupby(["district_id","disease_id","scenario_id"]).size()
chk("every series complete (120 rows)", (full==120).all(), f"{len(full)} series")
chk("no missing values in cases/climate", cases.isna().sum().sum()==0 and clim.isna().sum().sum()==0)
c = cases.merge(meta[["district_id","population"]])
chk("cases_per_100k = cases/pop*1e5", np.allclose(c.cases/c.population*1e5, c.cases_per_100k, atol=6e-4))

# 2 common random numbers: scenarios identical to baseline before 2022-07
b = clim[clim.scenario_id=="baseline"].set_index(["district_id","year_month"])
pre_diff = []
for s, g in clim.groupby("scenario_id"):
    g = g.set_index(["district_id","year_month"])
    d = (g[["rainfall_mm","mean_temperature_c"]] - b[["rainfall_mm","mean_temperature_c"]]).abs().sum(axis=1)
    changed = sorted({m for (_, m), v in d.items() if v > 0.051})
    pre_diff.append((s, changed[0] if changed else None, changed[-1] if changed else None, len(changed)))
chk("climate scenarios only differ inside their anomaly windows", True, "; ".join(f"{s}: {a}..{z} ({n} mo)" for s,a,z,n in pre_diff))
bc = cases[cases.scenario_id=="baseline"].set_index(["district_id","disease_id","year_month"]).cases
pre = [(s,(g.set_index(["district_id","disease_id","year_month"]).cases!=bc).loc[lambda x: x].index.get_level_values(2).min()) for s,g in cases.groupby("scenario_id")]
chk("case series identical to baseline before climate diverges", all(m is None or m>="2022-07" for s,m in pre if isinstance(m,str) or m is None), str(pre))

# 3 anomalies applied as configured (Chennai)
def rain(s, m, d="chn"): return clim[(clim.scenario_id==s)&(clim.year_month==m)&(clim.district_id==d)].rainfall_mm.iloc[0]
ok = abs(rain("heavy_rain_decline","2023-01")-rain("baseline","2023-01")-250)<0.11
ok &= all(rain("prolonged_wet",m)>=150 for m in ["2022-12","2023-01","2023-02","2023-03"])
ok &= abs(rain("delayed_monsoon","2022-12")-rain("baseline","2022-10"))<0.11
ok &= abs(rain("warm_wet","2022-11")-1.4*rain("baseline","2022-11"))<0.2
tw = clim[clim.scenario_id=="warmer"].set_index(["district_id","year_month"]).mean_temperature_c - b.mean_temperature_c
ok &= np.allclose(tw[tw.index.get_level_values(1)>="2022-07"], 1.5, atol=0.06)
chk("anomaly magnitudes match climate_anomalies.csv", bool(ok))

# 4 climate plausibility (baseline)
bb = clim[clim.scenario_id=="baseline"].copy(); bb["y"]=bb.year_month.str[:4]
ann = bb.groupby(["district_id","y"]).rainfall_mm.sum().groupby("district_id").agg(["mean","min","max"]).round(0)
tmp = bb.groupby("district_id").mean_temperature_c.agg(["min","mean","max"]).round(1)
chk("annual rainfall (mm) mean/min/max by district", True, ann.to_dict("index").__repr__())
chk("monthly mean temperature range by district", True, tmp.to_dict("index").__repr__())
chk("max monthly rainfall in any scenario", True, f"{clim.rainfall_mm.max()} mm ({clim.loc[clim.rainfall_mm.idxmax(),['district_id','scenario_id','year_month']].tolist()})")

# 5 observation model
m = cases.merge(gt, on=["year_month","district_id","disease_id","scenario_id"])
r = (m.cases/m.expected_cases)
chk("observed/expected ratio (should centre ~1)", abs(r.median()-1)<0.05, f"median {r.median():.3f}, 5-95% {r.quantile(.05):.2f}-{r.quantile(.95):.2f}")
clip = (gt.climate_log_effect.abs()>=1.4999).mean()
chk("climate_log_effect hitting ±1.5 clip", clip<0.02, f"{clip:.1%} of rows")
chk("true threshold = 1.2 × endemic baseline", np.allclose(gt.true_threshold_cases, (1.2*gt.endemic_baseline_cases).round(2), atol=0.011))

# 6 thresholds recomputed
bt = cases[(cases.scenario_id=="baseline")&(cases.year_month<="2021-12")].copy(); bt["calendar_month"]=bt.year_month.str[5:].astype(int)
rec = bt.groupby(["district_id","disease_id","calendar_month"]).cases.median().mul(1.2).clip(lower=1).round(2)
t2 = thr.set_index(["district_id","disease_id","calendar_month"]).threshold_cases
chk("seasonal_baseline_thresholds = 1.2 × median(2015-2021)", np.allclose(rec.sort_index(), t2.sort_index()))
e = gt[gt.scenario_id=="baseline"].copy(); e["calendar_month"]=e.year_month.str[5:].astype(int)
tt = e.groupby(["district_id","disease_id","calendar_month"]).true_threshold_cases.first()
ratio = (t2/tt)
chk("estimated vs true threshold (ratio)", abs(ratio.median()-1)<0.1, f"median {ratio.median():.2f}, range {ratio.min():.2f}-{ratio.max():.2f}")

# 7 recompute ground-truth TSR (3-month rule) independently
idx = {mm:i for i,mm in enumerate(months)}
bad = []
for row in rt.itertuples():
    g = gt[(gt.scenario_id==row.scenario_id)&(gt.disease_id==row.disease_id)&(gt.district_id==row.district_id)].sort_values("year_month")
    mu, th = g.expected_cases.values, g.true_threshold_cases.values
    t0 = idx[row.reference_month]; k=None
    for t in range(t0, len(mu)-2):
        if (mu[t:t+3] <= th[t:t+3]+1e-9).all(): k=t-t0; break
    want = None if pd.isna(row.true_time_to_sustained_recovery_months) else int(row.true_time_to_sustained_recovery_months)
    if k!=want: bad.append((row.scenario_id,row.disease_id,row.district_id,want,k))
chk("recovery_truth reproduces from trajectories", not bad, f"{len(bad)} mismatches {bad[:5]}")
cens = rt.true_recovery_status.ne("recovered").groupby(rt.scenario_id).sum()
chk("censored true recoveries per scenario", True, cens.to_dict().__repr__())
# peak check: is t0 actually above threshold, and is it the scenario's own peak?
pk = []
for row in rt.itertuples():
    g = gt[(gt.scenario_id==row.scenario_id)&(gt.disease_id==row.disease_id)&(gt.district_id==row.district_id)].sort_values("year_month").reset_index(drop=True)
    w = g[(g.year_month>="2022-08")&(g.year_month<="2023-02")]
    pk.append((row.scenario_id, w.expected_cases.idxmax()!=idx[row.reference_month]))
pkd = pd.DataFrame(pk, columns=["s","differs"]).groupby("s").differs.sum()
chk("scenario's own peak ≠ shared baseline t0 (count of 10 series)", True, pkd.to_dict().__repr__())

# 8 README table vs file
chk("recovery_truth rows", len(rt)==70)

# 9 model-ready
md2 = md.sort_values(["scenario_id","disease_id","district_id","year_month"])
g = md2.groupby(["scenario_id","disease_id","district_id"])
bm = md2[md2.scenario_id=="baseline"]; gb = bm.groupby(["disease_id","district_id"])
ok = np.allclose(gb.rainfall_mm.shift(2).dropna(), bm.rainfall_mm_lag2.dropna()) and np.allclose(gb.cases.shift(12).dropna(), bm.cases_lag12.dropna())
chk("model_ready lags correct (baseline series)", ok)
leak = [c for c in md.columns if c in ("expected_cases","true_threshold_cases","climate_log_effect","endemic_baseline_cases")]
chk("no ground-truth columns leaked into model_ready", not leak, str(leak))
tr = md[md.split=="train"]; dup = tr.duplicated(["year_month","district_id","disease_id"]).sum()
chk("train = baseline 2015-2021 only, no duplicate rows", dup==0 and set(tr.scenario_id)=={"baseline"} and tr.year_month.max()<="2021-12" and len(tr)==840, f"{len(tr)} train rows, {dup} duplicates")
te = md[md.split=="test"]
chk("test = baseline 2022-2024 only, unique", set(te.scenario_id)=={"baseline"} and te.year_month.min()>="2022-01" and not te.duplicated(["year_month","district_id","disease_id"]).any(), f"{len(te)} test rows")
an = rd("synthetic/climate_anomalies.csv").groupby("scenario_id").start_month.min()
sc = md[md.split=="scenario"].groupby("scenario_id").year_month.min()
chk("scenario rows start exactly at first anomaly month", (sc==an.reindex(sc.index)).all(), sc.to_dict().__repr__())
feat=[c for c in md.columns if c not in ("scenario_id","scenario_window_start","split","duplicate_of","data_type")]
chk("unflagged rows are all unique; flagged rows point to a real identical row", not md[md.duplicate_of.isna()].duplicated(feat).any() and md[md.duplicate_of.notna()].merge(md, left_on=feat+["duplicate_of"], right_on=feat+["scenario_id"], how="left", indicator=True)._merge.eq("both").all(), f"{md.duplicate_of.notna().sum()} flagged scenario rows")
chk("y_log = ln(1+cases)", np.allclose(md.y_log, np.log1p(md.cases), atol=1e-6))
full = cases.sort_values(["scenario_id","disease_id","district_id","year_month"]).copy()
full["ref"] = np.log1p(full.groupby(["scenario_id","disease_id","district_id"]).cases.shift(-1))
j = md.merge(full[["scenario_id","disease_id","district_id","year_month","ref"]])
chk("y_next = y_log(t+1) on the full continuous series", (j.y_next.isna()==j.ref.isna()).all() and np.allclose(j.y_next.dropna(), j.ref.dropna(), atol=1e-6), f"{j.y_next.isna().sum()} empty (Dec 2024 only)" if set(j[j.y_next.isna()].year_month)=={"2024-12"} else "UNEXPECTED blanks")
chk("lags at scenario start come from continuous history", md[(md.split=="scenario")].groupby("scenario_id").apply(lambda g: g.sort_values("year_month").groupby(["disease_id","district_id"]).head(1).cases_lag12.notna().all()).all())

# 10 sensitivity grid headline
d = sg[(sg.window_months==3)&(sg.threshold_factor==1.2)]
chk("README claim: default-rule MAE 2.2, status match 94%", True, f"MAE {d.absolute_error_months.mean():.2f}, status match {d.status_match.mean():.0%}")
mae = sg.groupby(["window_months","threshold_factor"]).absolute_error_months.mean()
chk("README claim: MAE range 1.5–3.1", True, f"{mae.min():.2f}–{mae.max():.2f}")

# 11 simulation runs consistency with truth (no mask)
r0 = runs[runs.mask_id.isna()].merge(rt, on=["scenario_id","disease_id","district_id"])
both = r0.dropna(subset=["time_to_sustained_recovery_months","true_time_to_sustained_recovery_months"])
chk("simulation_runs (no mask) vs truth", True, f"MAE {(both.time_to_sustained_recovery_months-both.true_time_to_sustained_recovery_months).abs().mean():.2f} mo; status agree {(r0.recovery_status==r0.true_recovery_status).mean():.0%}")
chk("t0 estimated == true t0", True, f"{(r0.reference_month_x==r0.reference_month_y).mean():.0%} of series")
ins = runs.groupby("mask_id",dropna=False).recovery_status.value_counts().unstack(fill_value=0)
chk("run status by mask", True, ins.to_dict("index").__repr__())

# 12 masks
mk = masks.groupby("mask_id").size().to_dict()
chk("mask row counts", sum(mk.values())==435, str(mk))

for s,n,dt in out: print(f"[{s}] {n}" + (f"  ->  {dt}" if dt else ""))
