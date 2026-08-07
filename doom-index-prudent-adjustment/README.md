# Doom Index fiscal input trace: `prudent_adjustment_pct_gdp`

Public note + reproduction script for the Task Node task **"Trace and
Reproduce the Doom Index Fiscal Input"** (500 PFT, Network). Target site:
[goodalexander.github.io](https://github.com/goodalexander/goodalexander.github.io),
commit [`5d7e729`](https://github.com/goodalexander/goodalexander.github.io/commit/5d7e729929b26d962f485f74e7d5bfc029e5b6f4)
("Make Doom Index inputs current through 2026").

## The indicator

`prudent_adjustment_pct_gdp`, labeled **"Recurring prudent-course
adjustment / GDP"**, is one of five indicators (weight 15/100) in the Doom
Index's "Fiscal constraint" component. Registered at
[`static/doom-thesis/doom-index-indicator-registry.json:16`](https://github.com/goodalexander/goodalexander.github.io/blob/5d7e729929b26d962f485f74e7d5bfc029e5b6f4/static/doom-thesis/doom-index-indicator-registry.json#L16).
Current published value: **7.933349032808561%**.

## Where it's stored (exact paths + lines, at commit `5d7e729`)

| File | Line | What's there |
|---|---|---|
| `static/doom-thesis/doom-index-indicator-registry.json` | 16 | Registers the indicator id, label, weight, source label "Doom fiscal sustainability model" |
| `static/doom-thesis/doom-index-score.json` | 139–145 | Scored entry: `raw_value: 7.933349032808561` |
| `static/doom-thesis/data.json` | 2034 (`sustainability.summary`) | Full computed breakdown — every input and intermediate value the formula uses |
| `static/doom-thesis/fiscal-sustainability-scenarios.csv` | 4 | The "Prudent course: cap residual gap at 100% of GDP" scenario row (1 of 5 scenarios in the CSV) |
| `static/doom-thesis/latest-release-manifest.json` | 55 | Build-log snapshot with an identical breakdown (confirms build-to-build stability) |

## How it's actually built — traced through `scripts/build-doom-thesis-data.py`

`build-doom-thesis-data.py` does **not** compute this value: a `grep -n
"prudent"` across the whole file returns zero matches. Instead, lines
292–301 show it reads `fiscal_sustainability_funding_scenarios.csv` and
`fiscal_sustainability_summary.json` from an external `doom_root` directory
— a private data-pipeline input that is **not part of this public repo** —
and lines 1568–1574 copy those files, unmodified, into the published
`static/doom-thesis/` output. This is exactly why the task brief calls the
number "not independently traceable": the *pipeline* that produces the raw
scenario numbers lives outside this repository.

**What is traceable, and what this script proves:** the site's own published
outputs (`data.json`, the CSV, the score file) disclose every input value
the formula uses. Given those disclosed inputs, the arithmetic from input to
final `7.933349032808561%` is fully public and independently reproducible —
see `reproduce.js`, which does exactly that using only Node.js built-ins,
matching the published value to within floating-point rounding
(`-2.66e-15`).

## The formula (reproduced in `reproduce.js`)

```
GDP                       = current_receipts_trillions / (current_receipts_pct_gdp / 100)
annuity_factor            = r / (1 - (1+r)^-n)              where r = 2.3% real discount rate, n = 75 years
residual_gap_trillions    = GDP * reasonable_residual_gap_pct_gdp(100%)
program_gap_pv_reduction  = current_program_gap_trillions(94.6) - residual_gap_trillions
annual_program_gap_funding = program_gap_pv_reduction * annuity_factor
target_deficit_trillions  = GDP * target_deficit_pct_gdp(3%)
annual_deficit_correction = baseline_deficit_trillions(1.8045...) - target_deficit_trillions
total_adjustment          = annual_deficit_correction + annual_program_gap_funding
prudent_adjustment_pct_gdp = total_adjustment / GDP * 100
```

## Parameter table: sourced vs. model assumption

| Parameter | Value | Classification | Source / note |
|---|---|---|---|
| `current_program_gap_trillions` | 94.6 | Sourced | SSA/CMS Trustees + Treasury Statement of Social Insurance ([SSA 2026 Trustees Report](https://www.ssa.gov/oact/TR/2026/), [Treasury SOSI](https://fiscal.treasury.gov/accounting/us-financial-report/statements-of-social-insurance)) |
| `current_receipts_trillions` | 5.37776... | Sourced | Treasury [Monthly Treasury Statement](https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/), trailing 12mo |
| `baseline_deficit_trillions` | 1.80451... | Sourced | Treasury MTS FY2026 unified-deficit run-rate |
| `funding_horizon_years` | 75 | Sourced (convention) | Matches the standard SSA/CMS Trustees 75-year actuarial window |
| **`reasonable_residual_gap_pct_gdp`** | **100%** | **Model assumption** | The "prudent course" scenario pick — the CSV has 4 other scenarios (0%, 50%, 100%, 200%, fully-funded/uncapped); 100% is the model author's policy choice, not a CBO/Trustees figure |
| **`real_discount_rate_pct`** | **2.3%** | **Model assumption** | Not individually cited to one specific CBO/Trustees publication anywhere in this repo's published files |
| **`target_deficit_pct_gdp`** | **3%** | **Model assumption** | The model's own policy target (`data.json` → `sustainability.summary.definition`), not a number CBO or Treasury publishes as a target |

Cited government sources used above (checked live, not assumed):
[CBO, The Budget and Economic Outlook: 2026 to 2036](https://www.cbo.gov/publication/61882) ·
[SSA, 2026 OASDI Trustees Report](https://www.ssa.gov/oact/TR/2026/) ·
[Treasury, Statements of Social Insurance](https://fiscal.treasury.gov/accounting/us-financial-report/statements-of-social-insurance) ·
[Treasury, Monthly Treasury Statement](https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/).

## The one concrete discrepancy found — recommended patch for Board Manager

**File:** [`static/doom-thesis/doom-index-framework.json:128`](https://github.com/goodalexander/goodalexander.github.io/blob/5d7e729929b26d962f485f74e7d5bfc029e5b6f4/static/doom-thesis/doom-index-framework.json#L128)
(`components[3].claims[1].note`)

The prose says:

> "...none reaches the **8.33%-of-GDP** recurring prudent adjustment on a
> simple annualized budget-window basis..."

The live, published, and reproduced value is **7.93%** (7.933349032808561%),
not 8.33% — a **0.40 percentage-point** gap. This looks like a stale
narrative figure left over from before commit `5d7e729` refreshed the
underlying data/CSV/JSON files but didn't touch this hand-written sentence.
**Exact patch:** in `doom-index-framework.json` line 128, replace
`8.33%-of-GDP` with `7.93%-of-GDP` (and re-check the derived
`required_to_largest_us_precedent_multiple` framing, currently correctly
computed elsewhere as `5.98x` off the 7.93% figure — e.g.
`latest-release-manifest.json:55` — so only this one prose sentence is
stale, not the underlying math).

## Files in this package

- `reproduce.js` — the Node.js (built-ins only) reproduction script.
- `source-excerpts/` — the minimal published-source excerpts the script
  reads, each tagged with its exact origin file/line in the target repo
  (`data-sustainability-summary.json`, `fiscal-sustainability-scenarios.csv`,
  `registry-entry.json`, `score-entry.json`, `framework-stale-claim.json`).
- `output.txt` — unedited output of `node reproduce.js`.

## Exact run command

```
node reproduce.js
```

Requires only the Node.js runtime — no `npm install`, no network access at
run time (all inputs are the committed source-excerpt files).

## Pull-request check

Confirmed live via GitHub (`goodalexander/goodalexander.github.io/pulls`):
**0 open, 0 closed** pull requests on the target repo — nothing already
covers this input.
