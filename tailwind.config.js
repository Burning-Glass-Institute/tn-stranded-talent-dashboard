/**
 * Tailwind is compiled at BUILD TIME into a real CSS asset.
 *
 * The app previously loaded cdn.tailwindcss.com (the Play CDN, v3.4.17), which
 * JIT-compiles from the live DOM in the browser. That made every deployment
 * depend on an external host at runtime: behind a firewall or air gap the app
 * still fetched its data and functioned, but rendered completely unstyled.
 *
 * Pinned to 3.4.17 -- the exact version the CDN served -- so the compiled output
 * reproduces the previous rendering. Do not upgrade to Tailwind 4 without a
 * visual diff: v4 changes the default palette to oklch and alters default border
 * and ring values, which shifts the design.
 *
 * No config was ever passed to the CDN, so this is stock defaults plus the
 * content globs. Classes are found by scanning source TEXT, not the DOM, so a
 * class name assembled at runtime (`bg-${color}-500`) would silently produce no
 * CSS. Keep class strings whole and literal in source; the codebase already does.
 */
export default {
  content: ['./index.html', './index.tsx', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
