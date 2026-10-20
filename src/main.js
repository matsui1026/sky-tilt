import './ui/styles.css';
import { App } from './app.js';

const params = new URLSearchParams(location.search);
const debug = params.get('debug') === '1';

const app = new App(document.getElementById('app'), { debug, forceTutorial: params.get('tutorial') === '1' });
if (debug) window.__app = app;

// ピンチズームやダブルタップズームを抑止
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
