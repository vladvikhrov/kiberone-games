'use strict';
/* Снимки заставки М5 для docs/img: node_modules/.bin/electron redteam/splash-shots.js [папка].
   Страницы открываются файлом, без моста window.k1: на снимке видна только заставка, она закрывает всё окно. */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const APP = path.resolve(__dirname, '..');
const out = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('-') && !a.endsWith('.js')) || path.join(APP, '..', 'docs', 'img'));
const pages = [
  ['m5-zastavka-uchenik', path.join(APP, 'desktop', 'vitrina', 'ui', 'index.html')],
  ['m5-zastavka-tyutor', path.join(APP, 'desktop', 'tutor', 'ui', 'index.html')],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanup = [];
process.on('exit', () => { for (const f of cleanup) try { fs.unlinkSync(f); } catch {} });
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, useContentSize: true, width: 1366, height: 768, webPreferences: { sandbox: true, contextIsolation: true } });
  for (const [name, file] of pages) {
    // Шрифты тьютора лежат у витрины, а страница ждёт их в ui/fonts: для снимка подкладываем ссылку
    const fonts = path.join(path.dirname(file), 'fonts');
    let linked = false;
    if (!fs.existsSync(fonts)) { fs.symlinkSync(path.join(APP, 'desktop', 'vitrina', 'ui', 'fonts'), fonts); linked = true; cleanup.push(fonts); }
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
      win.setContentSize(w, h);
      await win.loadFile(file).catch((e) => console.error('загрузка:', e.message));
      await sleep(1700);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(out, `${name}-${w}.png`), img.toPNG());
    }
    if (linked) fs.unlinkSync(fonts);
  }
  console.log('Снимки заставки в', out);
  app.quit();
});
