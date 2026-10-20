import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 全部を1ファイルにまとめたビルド（dist-single/index.html）
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-single',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
