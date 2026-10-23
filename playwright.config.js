import { defineConfig } from '@playwright/test';

// モバイル横向き（844×390、タッチ、DPR 3）で本番ビルド（dist/）をテストする。
// ブラウザは端末にインストール済みの Microsoft Edge（Chromium）を使う。CI では PW_CHANNEL=chromium で同梱 Chromium を使う。
const channel = process.env.PW_CHANNEL || 'msedge';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'reports/e2e-results.json' }]],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    channel: channel === 'chromium' ? undefined : channel,
    // WebRtcHideLocalIpsWithMdns: 同じ PC の 2 ページ間で WebRTC をつなぐため（2 人プレイのテスト）
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-features=WebRtcHideLocalIpsWithMdns'] },
    trace: 'off',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
