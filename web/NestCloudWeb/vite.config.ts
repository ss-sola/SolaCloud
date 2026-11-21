import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

function resolveManualChunk(id: string) {
  const normalizedId = id.replace(/\\/g, '/');

  if (normalizedId.includes('/src/modules/system/pages/')) {
    return 'system-pages';
  }

  if (normalizedId.includes('/node_modules/monaco-editor/')) {
    return 'monaco-editor';
  }

  if (normalizedId.includes('/node_modules/three/')) {
    return 'three-engine';
  }

  if (normalizedId.includes('/node_modules/@react-three/')) {
    return 'three-react';
  }

  if (
    normalizedId.includes('/node_modules/docx-preview/') ||
    normalizedId.includes('/node_modules/xlsx/')
  ) {
    return 'office-viewer';
  }

  return undefined;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx'],
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: resolveManualChunk,
      },
    },
  },
});
