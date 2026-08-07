import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves a project site under /<repo>/. The deploy workflow sets
  // VITE_BASE=/tn-stranded-talent-dashboard/ (the PUBLIC mirror's repo name, see
  // tools/publish_dashboard/templates/deploy-pages.yml); local dev/preview stays
  // at '/'. Any asset link must go through import.meta.env.BASE_URL -- a
  // root-absolute href resolves fine in dev and 404s in production.
  base: process.env.VITE_BASE || '/',
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
