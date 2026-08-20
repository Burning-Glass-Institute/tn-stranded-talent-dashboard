/**
 * Headless render smoke test.
 * ===========================
 * Drives the built dashboard in Chromium across every geography × sector (× cohort)
 * and asserts nothing throws and no "undefined"/"NaN"/"[object Object]" reaches the
 * DOM. Zero-worker slices and the Region (tn_only) geographies are exactly where a
 * lookup rewrite tends to break, so they are all covered. Also exercises the
 * Section-04 path (occupation → destination → lazy-loaded skills → strategy panels).
 *
 * Usage: LD_LIBRARY_PATH=<alsa> node verification/smoke_test.mjs <baseUrl>
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:4174';
const BAD = /\bundefined\b|NaN|\[object Object\]/;

const failures = [];
const record = (where, detail) => failures.push(`${where}: ${detail}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message.split('\n')[0]));
page.on('console', m => { if (m.type() === 'error') pageErrors.push(`console: ${m.text().split('\n')[0]}`); });

let skillsFetched = false;
page.on('response', r => { if (r.url().includes('/data/skills.json')) skillsFetched = true; });

await page.goto(BASE, { waitUntil: 'networkidle' });
// Dashboard mounts after initData(): the sector <select> appears with real options.
await page.waitForSelector('select', { timeout: 15000 });
await page.waitForFunction(() => document.querySelectorAll('select option').length > 1, { timeout: 15000 });

const scan = async (where) => {
  const txt = await page.locator('main').innerText();
  const m = txt.match(BAD);
  if (m) record(where, `DOM contains "${m[0]}"`);
  if (pageErrors.length) { record(where, `pageerror: ${pageErrors[0]}`); pageErrors.length = 0; }
};

// Enumerate controls from the live page.
const sectors = await page.$$eval('select option', els => els.map(e => e.value));
const geographies = ['All', 'Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Other MSA', 'East', 'Middle', 'West'];
// Data keys stay 'Other MSA'; the legend renders the display label (TennesseeMap
// geoLabel), so the button is found by what the user actually sees.
const geoButton = g =>
  g === 'All' ? 'All Tennessee' : g === 'Other MSA' ? 'Other & Rural TN' : g;

const clickGeo = async (g) => page.getByRole('button', { name: geoButton(g), exact: true }).first().click();
const clickCohort = async (c) => {
  if (c === 'All Stranded') await page.getByRole('button', { name: /^All \(/ }).click();
  else await page.getByText(c === 'Stalled' ? 'Career Stalled' : c, { exact: true }).first().click();
};

console.log(`Smoke: ${geographies.length} geographies × ${sectors.length} sectors`);

// ---- Phase 1: every geo × sector at the default (All Stranded) cohort ----
let n1 = 0;
for (const g of geographies) {
  await clickGeo(g);
  for (const s of sectors) {
    await page.locator('select').selectOption(s);
    await page.waitForTimeout(40);
    await scan(`P1 ${g} | ${s}`);
    n1++;
  }
}
console.log(`  Phase 1: scanned ${n1} geo×sector slices`);

// ---- Phase 2: cohort cycling (All geo × all sectors, then all geos × Manufacturing) ----
let n2 = 0;
const cohorts = ['Low Wage', 'Underemployed', 'Stalled', 'All Stranded'];
await clickGeo('All');
for (const s of sectors) {
  await page.locator('select').selectOption(s);
  for (const c of cohorts) { await clickCohort(c); await page.waitForTimeout(30); await scan(`P2 All|${s}|${c}`); n2++; }
}
const mfg = sectors.includes('Manufacturing') ? 'Manufacturing' : sectors[0];
for (const g of geographies) {
  await clickGeo(g);
  await page.locator('select').selectOption(mfg);
  for (const c of cohorts) { await clickCohort(c); await page.waitForTimeout(30); await scan(`P2 ${g}|${mfg}|${c}`); n2++; }
}
console.log(`  Phase 2: scanned ${n2} cohort views`);

// ---- Phase 3: Section-04 path (occupation → destination → skills → strategies) ----
let n3 = 0;
const deepSlices = [['All', mfg], ['Memphis', 'Health Care and Social Assistance'], ['East', 'Retail Trade']];
for (const [g, s] of deepSlices) {
  if (!sectors.includes(s)) continue;
  await clickGeo(g);
  await page.locator('select').selectOption(s);
  await clickCohort('All Stranded');
  await page.waitForTimeout(150);
  // Occupation auto-selects; find the destination cards (each shows a "Wage Gain" row).
  const destCard = page.locator('div.cursor-pointer').filter({ hasText: 'Wage Gain' }).first();
  if (await destCard.count() === 0) {
    // Valid state when the top occupation has no screened pathways — the app shows a
    // "No pathway data available" message. Verify that branch renders cleanly, too.
    const noData = await page.getByText('No pathway data available', { exact: false }).count();
    if (noData === 0) record(`P3 ${g}|${s}`, 'no destination cards AND no "no pathway data" message');
    await scan(`P3 ${g}|${s} (empty-pathways branch)`);
    n3++;
    continue;
  }
  await destCard.click();
  // Skills lazy-load fires on destination select; give it a beat, then open strategy panels.
  await page.waitForTimeout(400);
  for (const h of ['Strategy: Career Advancement Pathways', 'Strategy: Credentials & Licensing',
                   'Strategy: Employer Mobility Within Occupation', 'Strategy: Cross-Pathway Skill Acquisition']) {
    const hdr = page.getByText(h, { exact: true }).first();
    if (await hdr.count() > 0) { await hdr.click(); await page.waitForTimeout(80); }
  }
  await scan(`P3 ${g}|${s} (section 04)`);
  n3++;
}
console.log(`  Phase 3: exercised ${n3} deep Section-04 slices; skills.json fetched: ${skillsFetched}`);

await browser.close();

if (!skillsFetched) failures.push('Section-04: skills.json was never fetched (lazy-load path not exercised)');

console.log('');
if (failures.length === 0) {
  console.log(`SMOKE PASS — ${n1 + n2} slice scans + ${n3} deep paths, 0 failures, 0 page errors.`);
  process.exit(0);
} else {
  console.log(`SMOKE FAIL — ${failures.length} issue(s):`);
  for (const f of failures.slice(0, 30)) console.log('  - ' + f);
  process.exit(1);
}
