'use strict';
/* Основной процесс Electron для замера большой игры (redteam/big-game.js). Тот же путь, что gamePackage + openGame витрины. */
const crypto = require('crypto');
const fs = require('fs');
const { app } = require('electron');
const { readPackage } = require('../shared/package-format');
const sandbox = require('../desktop/sandbox');

sandbox.registerSchemes();
sandbox.hardenApp();

const MB = 1024 * 1024;
let peakMain = 0;
let peakAll = 0;
function sample() {
  peakMain = Math.max(peakMain, process.memoryUsage().rss);
  const all = app.getAppMetrics().reduce((sum, m) => sum + (m.memory ? m.memory.workingSetSize * 1024 : 0), 0);
  peakAll = Math.max(peakAll, all);
}

app.whenReady().then(async () => {
  await sandbox.lockDefaultSession();
  const timer = setInterval(sample, 25);
  sample();
  const base = process.memoryUsage().rss;
  const t0 = Date.now();
  const steps = {};
  const data = fs.readFileSync(process.env.BIG_GAME);
  steps.readMs = Date.now() - t0;
  const hex = crypto.createHash('sha256').update(data).digest('hex');
  steps.hashMs = Date.now() - t0;
  const pkg = await readPackage(data, {});
  steps.readPackageMs = Date.now() - t0;
  sample();
  const { window: win, loaded } = await sandbox.openGame(pkg, { show: true, fullscreen: false });
  await loaded;
  steps.loadedMs = Date.now() - t0;
  // Перемотка звука почти к концу файла: без Range Chromium может не дать перемотать
  const seek = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const a = document.getElementById('a');
    const go = () => {
      if (!Number.isFinite(a.duration)) { resolve({ ok: false, error: 'длительность неизвестна', duration: String(a.duration) }); return; }
      const target = a.duration - 5;
      const t = performance.now();
      a.addEventListener('seeked', () => resolve({ ok: Math.abs(a.currentTime - target) < 1, duration: a.duration, currentTime: a.currentTime,
        seekableEnd: a.seekable.length ? a.seekable.end(a.seekable.length - 1) : 0, seekMs: Math.round(performance.now() - t) }), { once: true });
      a.currentTime = target;
    };
    if (a.readyState >= 1) go(); else a.addEventListener('loadedmetadata', go, { once: true });
    a.addEventListener('error', () => resolve({ ok: false, error: a.error && a.error.code }), { once: true });
    setTimeout(() => resolve({ ok: false, error: 'timeout', readyState: a.readyState, currentTime: a.currentTime }), 20000);
  })`);
  sample();
  clearInterval(timer);
  const result = {
    electron: process.versions.electron, fileMb: Math.round(data.length / MB), sha256: hex.slice(0, 12), steps,
    mainBaseMb: Math.round(base / MB), mainPeakMb: Math.round(peakMain / MB), mainGrowthMb: Math.round((peakMain - base) / MB), allProcessesPeakMb: Math.round(peakAll / MB),
    seek,
  };
  fs.writeFileSync(process.env.BIG_OUT, JSON.stringify(result));
  app.exit(0);
});
