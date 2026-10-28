// One shared glossary: the "i" tooltips, the assistant, the PDFs and the Young Minds glossary all read from here,
// so a term is explained the same way everywhere. `plain` = one sentence for adults, `kid` = for young learners.
export const GLOSSARY = {
  tsr: { term: "TSR (time to sustained recovery)", plain: "How many months after the outbreak peak it takes until cases stay at or below the normal level for 3 months in a row.", kid: "How many months it takes for sickness to calm down and stay calm." },
  delta_tsr: { term: "ΔTSR (recovery delay)", plain: "Extra months to recover under a changed climate compared with the normal (baseline) climate; positive means slower.", kid: "How many extra months it takes to calm down when the weather changes." },
  threshold: { term: "Endemic threshold", plain: "The usual number of cases for that calendar month (1.2 × the 2015–2021 median); at or below it counts as normal.", kid: "The usual amount of sickness for that time of year." },
  t0: { term: "t0 (reference peak)", plain: "The month the outbreak peaks in the baseline series; every scenario measures recovery from this same month.", kid: "The month when the most people were sick." },
  censored: { term: "Censored (not recovered)", plain: "No sustained recovery happened before Dec 2024, so the recovery time is shown as a minimum (≥).", kid: "It had not calmed down yet when our pretend data ended." },
  interruption: { term: "Interruption", plain: "A new wave of cases that starts before sustained recovery and pushes recovery back.", kid: "When sickness goes up again before it has fully calmed down." },
  secondary_wave: { term: "Secondary wave", plain: "After cases fall for at least a month, they rise above the threshold and to at least 1.2 × the latest low for 2 months in a row.", kid: "A second bump of sickness after the first one." },
  insufficient: { term: "Insufficient data", plain: "More than 30% of the months after the peak have no reported cases, so no recovery time is given instead of a guess.", kid: "Too many pages missing from the diary to tell." },
  baseline: { term: "Baseline climate", plain: "The generated climate with no change applied; every scenario is compared with it.", kid: "The normal weather, before we change anything." },
  scenario: { term: "Climate scenario", plain: "A hypothetical change to rain or temperature, applied to all districts, for a controlled experiment, not a projection.", kid: "A pretend weather change, like more rain or hotter days." },
  mask: { term: "Reporting completeness", plain: "Removes some months of case reports to test how recovery estimates cope with missing data; nothing is filled in.", kid: "Pretending some pages of the diary are missing." },
  spread: { term: "p10–p90 spread", plain: "The range of recovery times across 50 noisy copies of the data; 8 in 10 copies fall inside it.", kid: "How much the answer wobbles if the counting is a bit noisy." },
  episode: { term: "Outbreak episode", plain: "Starts in a month above the threshold and ends when cases stay at or below it for 3 months.", kid: "One stretch of extra sickness, from start to calm." },
  matched_delta: { term: "Matched ΔTSR", plain: "A scenario's episode minus the baseline episode that starts in the same month; both must recover.", kid: "Comparing the same sickness bump with and without the weather change." },
  outbreak_month: { term: "Outbreak month", plain: "A month whose cases are above the endemic threshold.", kid: "A month with more sickness than usual." },
  mae: { term: "MAE (mean absolute error)", plain: "The average size of a forecast's miss, in cases per 100,000; smaller is better.", kid: "How far off a guess is, on average." },
  rmse: { term: "RMSE", plain: "Like MAE but big misses count more; smaller is better.", kid: "How far off a guess is, counting big mistakes extra." },
  bias: { term: "Bias", plain: "Average of prediction minus actual; negative means the model predicts too few cases.", kid: "Whether a guess is usually too low or too high." },
  correlation: { term: "Correlation (r)", plain: "How closely two series move together, from −1 to +1; it does not prove cause.", kid: "Whether two things go up and down together." },
  per100k: { term: "Cases per 100,000", plain: "Cases scaled to the population so districts of different sizes can be compared.", kid: "Sickness counted as if every town had the same number of people." },
  synthetic: { term: "Synthetic data", plain: "Computer-generated data for research; not real Tamil Nadu cases, not a forecast and not health advice.", kid: "Pretend data made by a computer, just for learning." },
};

export function term(id) { return GLOSSARY[id]?.term || id; }
export function plain(id) { return GLOSSARY[id]?.plain || ""; }
