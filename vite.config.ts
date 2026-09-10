import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => ({
  base: './',
  plugins: [react()],
  html: command === 'serve' ? { cspNonce: process.env.AHQ_DEV_CSP_NONCE } : undefined,
  // The desktop renderer and imported Studio scene must share their React and Three runtimes.
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'] },
  server: { port: 5173, strictPort: true },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/') || id.includes('/node_modules/@react-three/'))
            return 'three';
        },
      },
    },
  },
}));
