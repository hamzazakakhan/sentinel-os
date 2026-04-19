import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/graphql': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          apollo: ['@apollo/client', 'graphql'],
          charts: ['recharts', 'd3'],
          map: ['maplibre-gl', 'react-map-gl'],
        },
      },
    },
  },
});
