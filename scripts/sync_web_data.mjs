/**
 * Sync the R-built view store into public/data/ (prebuild / predev).
 * ==================================================================
 * Copies output/reports/web/*.json (source of truth) plus the curated county
 * GeoJSON into dashboard/public/data/, where Vite serves them as static assets
 * fetched at runtime. Fails loudly if the store is missing, the schema version
 * drifts, or a required top-level key is absent — trading a silent `undefined`
 * in the browser for a build-time error.
 *
 * public/data/ is generated (gitignored); the source of truth stays in output/.
 */
import { readFileSync, existsSync, mkdirSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dashboardDir = resolve(here, '..');
const repoRoot = resolve(dashboardDir, '..');

// Source of truth for the view store. In the monorepo it is the pipeline output
// (output/reports/web/); in the standalone published mirror there is no output/ tree,
// so we fall back to the committed viewstore/ snapshot that the export script writes.
const monorepoWebDir = join(repoRoot, 'output', 'reports', 'web');
const standaloneWebDir = join(dashboardDir, 'viewstore');
const webDir = existsSync(monorepoWebDir) ? monorepoWebDir : standaloneWebDir;
const curatedCounties = join(dashboardDir, 'src', 'data', 'reference', 'tn-counties.json');
const outDir = join(dashboardDir, 'public', 'data');

const SCHEMA_VERSION = 1;

// file -> required top-level keys
const REQUIRED = {
  'meta.json': ['schema_version', 'geographies', 'sectors', 'cohorts', 'thresholds', 'vintages'],
  'geo_sector.json': [],           // object keyed by "geo|sector"; checked structurally below
  'pathways.json': ['by_origin'],
  'skills.json': ['by_pair', 'cross_pathway'],
  'reference.json': ['occupations', 'occupation_sector_demand'],
};

function die(msg) {
  console.error(`\n[sync_web_data] ERROR: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(webDir)) {
  die(`view store not found at ${webDir}. Run Rscript R/reports/build_web_views.R first.`);
}
if (!existsSync(curatedCounties)) {
  die(`curated county GeoJSON not found at ${curatedCounties}.`);
}

mkdirSync(outDir, { recursive: true });

// Validate + copy each view-store file.
const parsed = {};
for (const [file, keys] of Object.entries(REQUIRED)) {
  const src = join(webDir, file);
  if (!existsSync(src)) die(`required file missing: ${src}`);
  let json;
  try {
    json = JSON.parse(readFileSync(src, 'utf8'));
  } catch (e) {
    die(`${file} is not valid JSON: ${e.message}`);
  }
  for (const k of keys) {
    if (!(k in json)) die(`${file} is missing required key "${k}".`);
  }
  parsed[file] = json;
  copyFileSync(src, join(outDir, file));
}

// Schema version gate.
if (parsed['meta.json'].schema_version !== SCHEMA_VERSION) {
  die(`meta.json schema_version is ${parsed['meta.json'].schema_version}, expected ${SCHEMA_VERSION}. `
    + `Update the app or the pipeline before building.`);
}

// Structural spot-check on geo_sector: a real slice must carry stats + cohorts.
const gsKeys = Object.keys(parsed['geo_sector.json']);
if (gsKeys.length === 0) die('geo_sector.json is empty.');
const sample = parsed['geo_sector.json'][gsKeys[0]];
if (!sample.stats || !sample.cohorts) {
  die('geo_sector.json slices are missing "stats"/"cohorts" — schema changed upstream.');
}

// Freshness canary: the store should not predate the newest next-steps output it
// summarizes (a stale build would silently ship old pathways). Warn, don't fail —
// vintages can legitimately differ during development.
const nsDir = join(repoRoot, 'output', 'next_steps');
if (existsSync(nsDir)) {
  const webNewest = Math.max(...Object.keys(REQUIRED).map(f => statSync(join(webDir, f)).mtimeMs));
  const nsFiles = readdirSync(nsDir).filter(f => f.endsWith('.csv'));
  if (nsFiles.length) {
    const nsNewest = Math.max(...nsFiles.map(f => statSync(join(nsDir, f)).mtimeMs));
    if (nsNewest > webNewest) {
      console.warn('[sync_web_data] WARNING: output/next_steps has files newer than the view store — '
        + 're-run R/reports/build_web_views.R to pick them up.');
    }
  }
}

// Curated map geometry (not part of the view store, but served the same way).
copyFileSync(curatedCounties, join(outDir, 'tn-counties.json'));

const files = [...Object.keys(REQUIRED), 'tn-counties.json'];
console.log(`[sync_web_data] synced ${files.length} files -> public/data/  (${files.join(', ')})`);
