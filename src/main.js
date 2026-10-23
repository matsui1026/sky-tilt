import './ui/styles.css';
import { App } from './app.js';

const params = new URLSearchParams(location.search);
const debug = params.get('debug') === '1';

const app = new App(document.getElementById('app'), { debug, forceTutorial: params.get('tutorial') === '1' });
if (debug) window.__app = app;

// ピンチズームやダブルタップズームを抑止
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

// オフライン対応（本番の通常ビルドのみ。1 ファイル版・デバッグ時は登録しない）
if ('serviceWorker' in navigator && import.meta.env.PROD && !debug && !__SINGLE_FILE__ && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
