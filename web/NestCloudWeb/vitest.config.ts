import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // 使用 jsdom 的浏览器存储，避免 Node 的同名全局属性遮挡 localStorage。
    execArgv: ['--no-experimental-webstorage'],
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['json'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/main.tsx', 'src/**/*.d.ts', 'src/__tests__/**'],
    },
  },
});
