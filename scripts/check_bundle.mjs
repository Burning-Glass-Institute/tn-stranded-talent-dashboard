/**
 * Bundle guard (postbuild).
 * =========================
 * Enforces the whole point of the refactor: no cell-level microdata is compiled
 * into the JS the browser downloads to run the app. Scans dist/assets (the JS/CSS
 * bundle) for size and for raw microdata column names, and asserts no spreadsheet
 * leaks into dist. The view-store JSON under dist/data/ is the SANCTIONED, fetched
 * view surface and is reported for information only — it is not counted against the
 * bundle budget (it is fetched on demand and browser-cached, and it is exactly the
 * aggregates rendered on screen).
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, '..', 'dist');

const MAX_BUNDLE_BYTES = 2.5 * 1024 * 1024;   // total JS+CSS
const MAX_ASSET_BYTES = 1.5 * 1024 * 1024;    // any single JS/CSS asset

// Raw microdata column names that must never be compiled into the app bundle.
const FORBIDDEN_TOKENS = [
  'n_pdl_current', 'implied_duration_sample', 'oews_calibrated_employment',
  'estimated_stalled_both', 'estimated_stalled_only', 'suppress_flag',
  'n_unweighted', 'perwt', 'cross_tabulated_data',
];

function die(msg) {
  console.error(`\n[check_bundle] FAIL: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(distDir)) die(`dist/ not found — run "npm run build" first.`);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push({ path: p, size: st.size });
  }
  return out;
}

const all = walk(distDir);
const rel = (p) => p.slice(distDir.length + 1);

// 1. No spreadsheets anywhere in dist.
const sheets = all.filter(f => ['.csv', '.xlsx', '.xls'].includes(extname(f.path).toLowerCase()));
if (sheets.length) die(`spreadsheet(s) leaked into dist: ${sheets.map(f => rel(f.path)).join(', ')}`);

// 2. JS/CSS bundle: size caps.
const bundle = all.filter(f => ['.js', '.css'].includes(extname(f.path).toLowerCase()));
const bundleBytes = bundle.reduce((s, f) => s + f.size, 0);
const kb = (b) => `${(b / 1024).toFixed(0)} KB`;

for (const f of bundle) {
  if (f.size > MAX_ASSET_BYTES) die(`asset ${rel(f.path)} is ${kb(f.size)} (cap ${kb(MAX_ASSET_BYTES)}).`);
}
if (bundleBytes > MAX_BUNDLE_BYTES) {
  die(`JS+CSS bundle totals ${kb(bundleBytes)} (cap ${kb(MAX_BUNDLE_BYTES)}). `
    + `Something large is being bundled instead of fetched.`);
}

// 3. No raw microdata column names in the bundle.
for (const f of bundle) {
  const text = readFileSync(f.path, 'utf8');
  const hits = FORBIDDEN_TOKENS.filter(t => text.includes(t));
  if (hits.length) {
    die(`asset ${rel(f.path)} contains forbidden microdata token(s): ${hits.join(', ')}. `
      + `Microdata must be fetched as a view, never bundled.`);
  }
}

// 4. Report (informational) the fetched view-store payload.
const dataDir = join(distDir, 'data');
let dataReport = 'none';
if (existsSync(dataDir)) {
  const files = readdirSync(dataDir).map(n => ({ n, size: statSync(join(dataDir, n)).size }));
  dataReport = files.map(f => `${f.n} ${kb(f.size)}`).join(', ');
}

console.log(`[check_bundle] OK`);
console.log(`  JS+CSS bundle: ${kb(bundleBytes)} across ${bundle.length} asset(s) (cap ${kb(MAX_BUNDLE_BYTES)})`);
console.log(`  fetched views (dist/data/, not bundled): ${dataReport}`);
