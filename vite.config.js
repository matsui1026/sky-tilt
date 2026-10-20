import { defineConfig } from 'vite';

// 通常ビルド（GitHub Pages 用）。相対パスにしてサブディレクトリ配信でも動くようにする。
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
});
