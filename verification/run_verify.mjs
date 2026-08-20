/**
 * One-command verification of a built dashboard:  npm run verify
 * ==============================================================
 * Serves dist/ with Vite's preview server, runs the headless render smoke test
 * (verification/smoke_test.mjs) against it, and exits with the smoke test's
 * status. This is the post-build / post-data-refresh acceptance check: it proves
 * every geography x sector (x cohort) slice renders without errors.
 *
 * Requirements:
 *   - a completed `npm run build` (checked below)
 *   - Playwright's Chromium:  npx playwright install chromium
 *     (on a fresh Linux host:  npx playwright install --with-deps chromium)
 *   - the same VITE_BASE the build used, if any -- the preview server resolves
 *     the base path from vite.config.ts at startup, so a mismatch serves the
 *     app at a path its assets were not built for.
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { preview } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');

if (!existsSync(join(appDir, 'dist', 'index.html'))) {
  console.error('\n[verify] ERROR: dist/index.html not found -- run "npm run build" first.\n');
  process.exit(1);
}

const server = await preview({ root: appDir, preview: { port: 4174, strictPort: false } });
const url = server.resolvedUrls?.local?.[0];
if (!url) {
  console.error('\n[verify] ERROR: preview server started but resolved no local URL.\n');
  process.exit(1);
}
console.log(`[verify] previewing dist/ at ${url}`);

// The smoke test must run in a CHILD process awaited asynchronously: the preview
// server lives in THIS process, so a synchronous exec would freeze the event loop
// and the server could never answer the browser it is being tested with.
const code = await new Promise((done) => {
  const child = spawn(process.execPath, [join(here, 'smoke_test.mjs'), url], { stdio: 'inherit' });
  child.on('error', (e) => { console.error(`\n[verify] failed to launch smoke test: ${e.message}\n`); done(1); });
  child.on('exit', (c) => done(c ?? 1));
});
if (code !== 0) {
  console.error('[verify] If Chromium is missing, run: npx playwright install chromium');
}

await server.close();
process.exit(code);
