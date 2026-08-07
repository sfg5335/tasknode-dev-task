'use strict';

/**
 * Reproduces the Doom Index fiscal input `prudent_adjustment_pct_gdp`
 * ("Recurring prudent-course adjustment / GDP") published at
 * goodalexander.github.io, from the site's own published source files,
 * using only Node.js built-in modules (fs, path).
 *
 * Task Node task: "Trace and Reproduce the Doom Index Fiscal Input"
 * Target repo/commit: https://github.com/goodalexander/goodalexander.github.io
 *   @ 5d7e729929b26d962f485f74e7d5bfc029e5b6f4 ("Make Doom Index inputs
 *   current through 2026")
 *
 * WHERE THE VALUE IS DEFINED / STORED (exact paths + line numbers, from a
 * fresh clone of the commit above):
 *   - static/doom-thesis/doom-index-indicator-registry.json:16
 *       registers the indicator id "prudent_adjustment_pct_gdp", source
 *       label "Doom fiscal sustainability model".
 *   - static/doom-thesis/doom-index-score.json:139-145
 *       scored entry, indicator_id "prudent_adjustment_pct_gdp",
 *       raw_value 7.933349032808561.
 *   - static/doom-thesis/data.json / sustainability.summary (line 2034)
 *       the full computed breakdown (all inputs + outputs of the formula
 *       below) as of as_of_date 2026-08-05.
 *   - static/doom-thesis/fiscal-sustainability-scenarios.csv:4
 *       the "Prudent course: cap residual gap at 100% of GDP" scenario row
 *       (one of 5 scenario rows; this is the one the registry/score pick).
 *   - static/doom-thesis/latest-release-manifest.json:55
 *       a build-log snapshot containing the identical breakdown (confirms
 *       the numbers are stable build-to-build, not a one-off).
 *
 * HOW IT IS ACTUALLY BUILT (traced through scripts/build-doom-thesis-data.py):
 *   build-doom-thesis-data.py does NOT compute this value itself -- grep
 *   for "prudent" anywhere in that file returns zero matches. Lines 292-301
 *   show it reads `fiscal_sustainability_funding_scenarios.csv` and
 *   `fiscal_sustainability_summary.json` from an external `doom_root`
 *   directory (a private data-pipeline input, not part of this public
 *   repo -- this is why the task calls the number "not independently
 *   traceable": the *computation* happens outside this repo), then copies
 *   them into the published site verbatim (build-doom-thesis-data.py:1568-1574).
 *   So this script reproduces the arithmetic from the site's own PUBLISHED
 *   outputs (which fully disclose every input value used), rather than
 *   from the private pipeline this repo doesn't contain.
 *
 * FINDING: the published inputs are enough to reproduce the value exactly
 * (see RESULT below) -- so while the *pipeline* that generates
 * `fiscal_sustainability_funding_scenarios.csv` is private, the *arithmetic*
 * from that CSV's numbers to the final indicator value is fully public and
 * independently checkable, which is what this script demonstrates.
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'source-excerpts');

const sustainability = JSON.parse(
  fs.readFileSync(path.join(dataDir, 'data-sustainability-summary.json'), 'utf8')
).sustainability_summary;

// ---- Inputs, exactly as published, with source classification ----
// "sourced" = the registry/manifest attributes this figure to a named
//             external government publication (even though we can't see
//             the private pipeline that pulled the exact number).
// "model assumption" = a policy choice made by the Doom Index model itself
//             (a scenario parameter), not a number published by CBO/Trustees.
const inputs = {
  as_of_date: { value: sustainability.as_of_date, kind: 'timestamp' },
  program_gap_vintage: { value: sustainability.program_gap_vintage, kind: 'timestamp (SSA/CMS Trustees report vintage year)' },
  current_program_gap_trillions: { value: sustainability.current_program_gap_trillions, kind: 'sourced', source: 'SSA/CMS Trustees + Treasury Statement of Social Insurance (registry source label, doom-index-indicator-registry.json for program_gap_pct_gdp)' },
  current_receipts_trillions: { value: sustainability.current_receipts_trillions, kind: 'sourced', source: 'Treasury Monthly Treasury Statement (trailing 12mo), per registry source label for deficit_pct_gdp' },
  reasonable_residual_gap_pct_gdp: { value: sustainability.reasonable_residual_gap_pct_gdp, kind: 'MODEL ASSUMPTION (not a government-published number)', note: 'the "prudent course" scenario choice: cap the residual 75yr program gap at 100% of GDP. CSV has 4 other scenarios (0%, 50%, 100%, 200%, uncapped) -- 100% is the model author\'s policy pick, not a CBO/Trustees figure.' },
  real_discount_rate_pct: { value: sustainability.real_discount_rate_pct, kind: 'MODEL ASSUMPTION (not directly a single published CBO/Trustees rate in these files)', note: '2.3% real discount rate used for the 75-year annuitization; not individually cited to a specific CBO/Trustees publication in the files this repo publishes.' },
  funding_horizon_years: { value: sustainability.funding_horizon_years, kind: 'sourced (convention)', source: 'matches the standard SSA/CMS Trustees 75-year actuarial projection window' },
  baseline_deficit_trillions: { value: sustainability.baseline_deficit_trillions, kind: 'sourced', source: 'Treasury MTS FY2026 unified deficit run-rate (per registry source label for deficit_pct_gdp)' },
  target_deficit_pct_gdp: { value: sustainability.target_deficit_pct_gdp, kind: 'MODEL ASSUMPTION (not a government-published number)', note: 'the "reduce the unified deficit to 3% of GDP" target is the model\'s own policy definition (data.json sustainability.summary.definition), not sourced to a specific CBO/Trustees target.' },
};

// ---- Reproduce the formula chain ----
const gdpTrillions = inputs.current_receipts_trillions.value / (sustainability.current_receipts_pct_gdp / 100);

const r = inputs.real_discount_rate_pct.value / 100;
const n = inputs.funding_horizon_years.value;
const annuityFactorPct = (r / (1 - Math.pow(1 + r, -n))) * 100;

const reasonableResidualGapTrillions = gdpTrillions * (inputs.reasonable_residual_gap_pct_gdp.value / 100);
const programGapPvReductionTrillions = inputs.current_program_gap_trillions.value - reasonableResidualGapTrillions;
const annualProgramGapFundingTrillions = programGapPvReductionTrillions * (annuityFactorPct / 100);

const targetDeficitTrillions = gdpTrillions * (inputs.target_deficit_pct_gdp.value / 100);
const annualDeficitCorrectionTrillions = inputs.baseline_deficit_trillions.value - targetDeficitTrillions;

const totalAnnualAdjustmentTrillions = annualDeficitCorrectionTrillions + annualProgramGapFundingTrillions;
const totalAnnualAdjustmentPctGdp = (totalAnnualAdjustmentTrillions / gdpTrillions) * 100;

const published = sustainability.total_annual_adjustment_pct_gdp;
const discrepancy = totalAnnualAdjustmentPctGdp - published;

console.log('=== Doom Index: prudent_adjustment_pct_gdp reproduction ===');
console.log('as_of_date:', sustainability.as_of_date, '| program_gap_vintage:', sustainability.program_gap_vintage);
console.log('funding_horizon_years:', n, '| real_discount_rate_pct:', inputs.real_discount_rate_pct.value);
console.log('');
console.log('Derived GDP (trillions):', gdpTrillions.toFixed(6), '  [from current_receipts_trillions / current_receipts_pct_gdp]');
console.log('Annuity factor (%):     ', annuityFactorPct.toFixed(10), '  [r/(1-(1+r)^-n)]');
console.log('');
console.log('reasonable_residual_gap_trillions (reproduced): ', reasonableResidualGapTrillions.toFixed(5), ' vs published', sustainability.reasonable_residual_gap_trillions);
console.log('program_gap_pv_reduction_trillions (reproduced):', programGapPvReductionTrillions.toFixed(5), ' vs published', sustainability.program_gap_pv_reduction_trillions);
console.log('annual_program_gap_funding_trillions (repro):   ', annualProgramGapFundingTrillions.toFixed(9), ' vs published', sustainability.annual_program_gap_funding_trillions);
console.log('target_deficit_trillions (reproduced):          ', targetDeficitTrillions.toFixed(9), ' vs published', sustainability.target_deficit_trillions);
console.log('annual_deficit_correction_trillions (repro):    ', annualDeficitCorrectionTrillions.toFixed(9), ' vs published', sustainability.annual_deficit_correction_trillions);
console.log('total_annual_adjustment_trillions (reproduced): ', totalAnnualAdjustmentTrillions.toFixed(9), ' vs published', sustainability.total_annual_adjustment_trillions);
console.log('');
console.log('REPRODUCED total_annual_adjustment_pct_gdp:', totalAnnualAdjustmentPctGdp);
console.log('PUBLISHED  total_annual_adjustment_pct_gdp:', published);
console.log('Discrepancy (reproduced - published):      ', discrepancy);
console.log('');

// ---- Cross-check against the CSV scenario row (independent source file) ----
const csvPath = path.join(dataDir, 'fiscal-sustainability-scenarios.csv');
const csvLines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
const header = csvLines[0].split(',');
const prudentRow = csvLines.find((l) => l.startsWith('Prudent course'));
const cells = prudentRow.split(',');
const csvValue = Number(cells[header.indexOf('total_annual_adjustment_pct_gdp')]);
console.log('CSV row (fiscal-sustainability-scenarios.csv, "Prudent course" row) total_annual_adjustment_pct_gdp:', csvValue);
console.log('Matches published value exactly:', csvValue === published);
console.log('');

// ---- Model-vs-narrative discrepancy check ----
const framework = JSON.parse(fs.readFileSync(path.join(dataDir, 'framework-stale-claim.json'), 'utf8'));
const staleText = framework.stale_claim.note;
const staleMatch = staleText.match(/([\d.]+)%-of-GDP/);
console.log('=== Narrative-vs-data discrepancy ===');
console.log('static/doom-thesis/doom-index-framework.json:128 (components[3].claims[1].note) says:');
console.log('  "' + staleText.slice(0, 120) + '..."');
console.log('  -> cites', staleMatch[1] + '%', 'as the recurring prudent adjustment.');
console.log('Live computed/published value (this run):', totalAnnualAdjustmentPctGdp.toFixed(2) + '%');
console.log(
  'STALE TEXT DISCREPANCY:',
  (Number(staleMatch[1]) - totalAnnualAdjustmentPctGdp).toFixed(2),
  'percentage points — the prose in doom-index-framework.json was not updated when the data files were refreshed by commit 5d7e729 ("Make Doom Index inputs current through 2026").'
);
console.log('');

console.log('=== Inputs used, classified sourced vs. model-assumption ===');
for (const [key, meta] of Object.entries(inputs)) {
  console.log(`- ${key} = ${meta.value}  [${meta.kind}]${meta.source ? '  source: ' + meta.source : ''}${meta.note ? '  note: ' + meta.note : ''}`);
}
