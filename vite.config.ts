import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves a project site under /<repo>/. The deploy workflow sets
  // VITE_BASE=/tennessee_stranded_talent/; local dev/preview stays at '/'.
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
