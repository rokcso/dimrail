import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const WORKER_ORIGIN = process.env.DIMRAIL_WORKER_ORIGIN ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // 保持 Host 为前端地址，Worker 的同源判断才能通过。
      // /sub 与 /providers 也代理上，本地后台复制的订阅链接才能直接用。
      '/api': { target: WORKER_ORIGIN, changeOrigin: false },
      '/sub': { target: WORKER_ORIGIN, changeOrigin: false },
      '/providers': { target: WORKER_ORIGIN, changeOrigin: false },
    },
  },
});
