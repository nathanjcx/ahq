import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => ({
  plugins: [react(), {
    name: 'desktop-content-policy',
    transformIndexHtml(html) {
      return command === 'build' ? html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'"/>`) : html;
    },
  }],
  base: './', server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
