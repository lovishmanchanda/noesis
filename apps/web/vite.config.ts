import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The engine needs cross-origin isolation (for cancelling Python work), so every response in
// development and preview carries these headers. Hosting config is in public/_headers.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  server: { headers: isolation, fs: { allow: ['../..'] } },
  preview: { headers: isolation },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
