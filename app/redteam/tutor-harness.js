'use strict';
/* Главный процесс Electron для проверок окна тьютора (этап М1). Режимы:
   tutor:         настоящее окно тьютора, К24 (разметка из .kibgames и сеть), создание школы и публикация через интерфейс;
   tutor-ipc:     настоящее окно плюс тестовый мост к сырому ipcRenderer, как если бы окно было взломано (Т12);
   tutor-control: то же окно без CSP, без закрытой сессии и с innerHTML вместо textContent: атаки обязаны сработать;
   tutor-shots:   снимки экрана для docs/img;
   tutor-serve:   раздача через окно тьютора (этап М2, С7, С8): интерфейс по имени, адреса из окна не принимаются,
                  раздача работает при закрытом ключе, после выключения соединений нет. */
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session } = require('electron');
const sandbox = require('../desktop/sandbox');
const W = require('../desktop/tutor/window');

const cfg = JSON.parse(process.env.REDTEAM_CONFIG);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAST = { N: 2 ** 10, r: 8, p: 1 }; // облегчённый scrypt: проверяется окно, а не стойкость пароля
const PASSWORD = 'пароль-тьютора-1';

sandbox.registerSchemes([W.SCHEME]);
if (cfg.mode !== 'tutor-control') sandbox.hardenApp();

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
const clickText = (win, text) => js(win, `(() => { const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
const setValue = (win, selector, value) => js(win, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; return true; })()`);
const ready = (win) => waitFor(() => js(win, "document.documentElement.dataset.ready === 'true'"));

/* Атаки на сеть из окна тьютора, как если бы в нём выполнился чужой код. */
const NET_ATTACKS = `(async () => {
  const base = 'http://${cfg.host}:${cfg.http}/hit/';
  try { await fetch(base + 'k24-fetch', { mode: 'no-cors' }); } catch (e) {}
  const img = new Image(); img.src = base + 'k24-img'; document.body.append(img);
  try { new WebSocket('ws://${cfg.host}:${cfg.http}/hit/k24-ws'); } catch (e) {}
  try { navigator.sendBeacon(base + 'k24-beacon', 'x'); } catch (e) {}
  try { new FontFace('Leak', 'url(' + base + 'k24-font)').load().catch(() => {}); } catch (e) {}
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = base + 'k24-css'; document.head.append(link);
  await new Promise((r) => setTimeout(r, 2000));
  return true;
})()`;

const PROBE = `(() => ({
  executed: typeof window.__k24 === 'undefined' ? null : window.__k24,
  rowTitle: (document.querySelector('.row-game .cell-title') || {}).textContent || null,
  rowAuthor: (document.querySelectorAll('.row-game .cell')[0] || {}).textContent || null,
  actions: (document.querySelector('.actions-title') || {}).textContent || null,
  modes: [...document.querySelectorAll('.mode-title')].map((m) => m.textContent),
  injected: document.querySelectorAll('img[src="x"], svg[onload], b[onmouseover], main script, #overlay script').length,
}))()`;

/* Школа и опубликованная игра с разметкой, напрямую через модули (для контроля и снимков). */
async function prepareSchool(dataDir, files, trustNames = {}) {
  const { createSchoolKey } = require('../desktop/tutor/school-key');
  const { createLibrary } = require('../desktop/tutor/library');
  const key = createSchoolKey(dataDir, { kdf: FAST });
  await key.create({ name: 'KIBERone Петроградская', password: PASSWORD, again: PASSWORD });
  const lib = createLibrary(dataDir, { key, appVersion: '1.1.0' });
  for (const file of files) {
    const a = await lib.inspect(file);
    await lib.publish(a.token, { confirmUnknown: a.unknownAuthor, trustName: a.unknownAuthor ? (trustNames[a.id] || '') : '' });
  }
  key.lock();
  return { key, lib };
}

/* ---------- tutor-control ---------- */
async function control() {
  const { createLibrary } = require('../desktop/tutor/library');
  const { createTutorApi, CHANNELS } = require('../desktop/tutor/api');
  const R = require('../shared/ratings');
  const { key } = await prepareSchool(cfg.dataDir, [cfg.xssFile], { 'xss-tyutor': cfg.xssAuthor });
  const lib = createLibrary(cfg.dataDir, { key, appVersion: '1.1.0' });
  const ui = W.loadUi();
  const appJs = ui.get('app.js');
  const source = appJs.data.toString('utf8');
  const marker = '/*K24*/el.textContent';
  const replaced = source.split(marker).length - 1;
  ui.set('app.js', { ...appJs, data: Buffer.from(source.split(marker).join('/*K24*/el.innerHTML')) });
  const ses = session.fromPartition('kibtutor-control');
  W.serveTutor(ses, { ui, cover: () => null, csp: null });
  const win = W.createTutorWindow({ ses, show: false, allowInsecure: true });
  win.showInactive();
  const api = createTutorApi({ key, getLibrary: () => lib, ratings: () => R.emptyRatings(), dialogs: {}, tryGame: async () => {}, today: () => '2026-11-03' });
  for (const channel of CHANNELS) win.webContents.ipc.handle(channel, (_e, ...args) => api[channel](...args));
  await win.loadURL(W.START_URL);
  await ready(win);
  await sleep(1500);
  const xss = await js(win, PROBE);
  await js(win, NET_ATTACKS);
  await sleep(500);
  finish({ replaced, xss });
}

/* ---------- tutor ---------- */
async function hardened() {
  const { openTutor } = require('../desktop/tutor');
  await sandbox.lockDefaultSession();
  const events = [];
  const picks = [cfg.xssFile];
  const dialogs = {
    pickGame: async () => picks.shift() || null,
    pickBackupDir: async () => cfg.backupDir,
    pickRestoreDir: async () => null,
    saveSchoolFile: async (text) => { fs.writeFileSync(path.join(cfg.backupDir, 'school.kibschool'), text); return true; },
  };
  const t = await openTutor({ dataDir: cfg.dataDir, appVersion: '1.1.0', show: false, kdf: FAST, dialogs, log: (kind, detail) => events.push({ kind, detail }) });
  const win = t.window;
  win.showInactive();
  win.setContentSize(1366, 768);
  await ready(win);
  const r = {};
  r.surface = await js(win, `(() => {
    let tt = 'allowed';
    try { document.createElement('div').innerHTML = '<b>x</b>'; } catch (e) { tt = 'blocked'; }
    return { trustedTypes: tt, require: typeof require, process: typeof process, k1t: Object.keys(window.k1t || {}).sort() };
  })()`);

  // Создание школы через интерфейс
  r.setupScreen = await js(win, "document.querySelector('h1') && document.querySelector('h1').textContent");
  await setValue(win, '#f-name', 'KIBERone Петроградская');
  await setValue(win, '#f-pass', 'короткий');
  await setValue(win, '#f-again', 'короткий');
  await js(win, "document.querySelector('form').requestSubmit()");
  await sleep(500);
  r.shortPassword = await js(win, "document.querySelector('.error').textContent");
  await setValue(win, '#f-pass', PASSWORD);
  await setValue(win, '#f-again', PASSWORD);
  await js(win, "document.querySelector('form').requestSubmit()");
  await waitFor(() => js(win, "!!document.querySelector('.code')"));
  r.code = await js(win, "document.querySelector('.code').textContent");
  r.doneDisabled = await js(win, "[...document.querySelectorAll('button')].find((b) => b.textContent === 'Готово').disabled");
  await click(win, '#f-wrote');
  await clickText(win, 'Готово');
  await sleep(300);

  // Публикация игры с разметкой через интерфейс: окно проверки, галочка, имя автора с разметкой
  await click(win, '#btn-main');
  await waitFor(() => js(win, "!!document.querySelector('.modal h2')"));
  await sleep(500);
  r.modal = await js(win, `(() => ({
    title: document.querySelector('.modal h2').textContent,
    facts: [...document.querySelectorAll('.facts dd')].map((d) => d.textContent),
    publishDisabled: [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Опубликовать').disabled,
    executed: typeof window.__k24 === 'undefined' ? null : window.__k24,
  }))()`);
  await js(win, `(() => { const box = document.querySelector('.modal input[type=checkbox]'); box.click(); const name = document.querySelector('.modal .warn input.input'); name.value = ${JSON.stringify(cfg.xssAuthor)}; return true; })()`);
  await js(win, "[...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Опубликовать').click()");
  await waitFor(() => js(win, "!!document.querySelector('.row-game')"));
  await sleep(500);
  r.xss = await js(win, PROBE);
  await js(win, NET_ATTACKS);
  await sleep(500);
  r.fonts = await js(win, `document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')))`);

  // Автозакрытие: тот же ключ, что у окна. Подменить часы нельзя, поэтому закрываем вручную и проверяем, что окно знает об этом
  await clickText(win, 'Школа');
  await sleep(300);
  await clickText(win, 'Закрыть ключ');
  await sleep(500);
  r.lockedHeader = await js(win, "document.getElementById('key-state').textContent");
  r.lockedLesson = await js(win, 'window.k1t.setLesson(\'xss-tyutor\', true)');
  r.events = events;
  finish(r);
}

/* ---------- tutor-ipc ---------- */
async function ipcProbe() {
  const { openTutor } = require('../desktop/tutor');
  await sandbox.lockDefaultSession();
  const ses = session.fromPartition(W.PARTITION);
  const preload = path.join(__dirname, 'vitrina-raw-preload.js');
  if (ses.registerPreloadScript) ses.registerPreloadScript({ type: 'frame', filePath: preload });
  else ses.setPreloads([preload]);
  const picked = [];
  const dialogs = {
    pickGame: async () => { picked.push('pickGame'); return cfg.goodFile; },
    pickBackupDir: async () => { picked.push('pickBackupDir'); return cfg.backupDir; },
    pickRestoreDir: async () => null,
    saveSchoolFile: async () => { picked.push('saveSchoolFile'); return true; },
  };
  const t = await openTutor({ dataDir: cfg.dataDir, appVersion: '1.1.0', show: false, kdf: FAST, dialogs });
  const win = t.window;
  await ready(win);
  const call = (channel, ...args) => js(win, `window.__raw.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})
    .then((v) => ({ ok: true, value: v }), (e) => ({ ok: false, error: String(e && e.message).slice(0, 160) }))`);
  const r = { rawReady: await js(win, 'typeof window.__raw') };
  r.unknown = {};
  for (const channel of ['fs.readFile', 'school.sign', 'key.export', 'catalog.list', 'game.launch', 'school.locked', 'state.get ', 'STATE.GET']) r.unknown[channel] = await call(channel, '/etc/passwd');

  await call('school.create', 'Школа', PASSWORD, PASSWORD);
  await call('school.lock');
  // Без входа: действия с ключом отклонены
  r.locked = {
    pick: await call('game.pick'),
    backup: await call('school.backup'),
    lesson: await call('game.lesson', 'tri-rezhima', true),
    unpublish: await call('game.unpublish', 'tri-rezhima'),
  };
  r.pickedWhileLocked = picked.slice();
  r.badArgs = {
    pickWithPath: await call('game.pick', '/etc/passwd'),
    tryPath: await call('game.try', 'file', '/etc/passwd', 'default'),
    tryCatalogPath: await call('game.try', 'catalog', '../../etc/passwd', 'default'),
    tryPendingPath: await call('game.try', 'pending', 'C:\\Windows\\notepad.exe', 'default'),
    publishBadToken: await call('game.publish', '../blobs/x', true, true, ''),
    publishStringFlags: await call('game.publish', '0'.repeat(32), 'true', 'true', ''),
    lessonString: await call('game.lesson', 'tri-rezhima', 'true'),
    unlockObject: await call('school.unlock', { password: PASSWORD }),
    unlockExtra: await call('school.unlock', PASSWORD, '/etc/passwd'),
    backupWithPath: await call('school.backup', '/tmp'),
    stateWithArg: await call('state.get', '/etc'),
  };
  // Контроль: верные вызовы работают
  r.good = { unlock: await call('school.unlock', PASSWORD) };
  r.good.pick = await call('game.pick');
  const token = r.good.pick.ok && r.good.pick.value.ok ? r.good.pick.value.game.token : null;
  r.good.publishNoConfirm = await call('game.publish', token, false, false, '');
  r.good.publish = await call('game.publish', token, true, false, '');
  r.good.lesson = await call('game.lesson', 'tri-rezhima', true);
  r.good.state = await call('state.get');
  r.good.backup = await call('school.backup');
  r.stateKeys = r.good.state.ok ? Object.keys(r.good.state.value).sort() : null;
  r.gameKeys = r.good.state.ok && r.good.state.value.games[0] ? Object.keys(r.good.state.value.games[0]).sort() : null;
  r.pickKeys = token ? Object.keys(r.good.pick.value.game).sort() : null;
  r.picked = picked;
  finish(r);
}

/* ---------- tutor-serve ---------- */
function httpGet(host, port, urlPath, headers = {}) {
  const http = require('http');
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: urlPath, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, etag: res.headers.etag || null, bytes: Buffer.concat(chunks).length }));
    });
    req.on('error', (e) => resolve({ error: e.code || String(e) }));
    req.setTimeout(5000, () => req.destroy());
  });
}

async function serveProbe() {
  const { openTutor } = require('../desktop/tutor');
  await sandbox.lockDefaultSession();
  const ses = session.fromPartition(W.PARTITION);
  const preload = path.join(__dirname, 'vitrina-raw-preload.js');
  if (ses.registerPreloadScript) ses.registerPreloadScript({ type: 'frame', filePath: preload });
  else ses.setPreloads([preload]);
  const t = await openTutor({ dataDir: cfg.dataDir, appVersion: '1.1.0', show: false, kdf: FAST, dialogs: { pickGame: async () => cfg.goodFile } });
  const win = t.window;
  await ready(win);
  const call = (channel, ...args) => js(win, `window.__raw.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})
    .then((v) => ({ ok: true, value: v }), (e) => ({ ok: false, error: String(e && e.message).slice(0, 160) }))`);
  const r = {};
  r.noSchool = await call('server.start', cfg.iface);
  await call('school.create', 'Школа', PASSWORD, PASSWORD);
  const picked = await call('game.pick');
  await call('game.publish', picked.value.game.token, true, false, '');
  const st = await call('state.get');
  r.interfaces = st.value.interfaces;
  r.offAfterStart = st.value.serve;
  r.bad = {
    byAddress: await call('server.start', cfg.host),
    path: await call('server.start', '../../etc/passwd'),
    object: await call('server.start', { name: cfg.iface }),
    extra: await call('server.start', cfg.iface, '0.0.0.0'),
    stopArg: await call('server.stop', 'x'),
  };
  r.closedBefore = await httpGet(cfg.host, 47800, '/v1/catalog');
  await call('school.lock');
  r.start = await call('server.start', cfg.iface);
  r.on = r.start.ok && r.start.value.state ? r.start.value.state.serve : null;
  r.unlocked = r.start.ok && r.start.value.state ? r.start.value.state.unlocked : null;
  r.catalog = await httpGet(cfg.host, 47800, '/v1/catalog');
  r.notModified = await httpGet(cfg.host, 47800, '/v1/catalog', { 'If-None-Match': r.catalog.etag || '' });
  r.origin = await httpGet(cfg.host, 47800, '/v1/catalog', { Origin: 'http://example.com' });
  // Вызовы шли в обход интерфейса: страница перечитывает состояние при загрузке
  await new Promise((resolve) => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
  await ready(win);
  r.dom = await js(win, "document.querySelector('.serve') ? document.querySelector('.serve').textContent : ''");
  // М3: «Скачать быстрее» — только true или false, ровно один аргумент
  r.fast = { bad: await call('server.fast', 'да'), extra: await call('server.fast', true, 1), on: await call('server.fast', true) };
  r.fast.off = await call('server.fast', false);
  r.stop = await call('server.stop');
  r.fast.whenOff = await call('server.fast', true);
  await sleep(200);
  r.after = await httpGet(cfg.host, 47800, '/v1/catalog');
  r.offState = (await call('state.get')).value.serve;
  finish(r);
}

/* ---------- tutor-shots ---------- */
async function shots() {
  const { openTutor } = require('../desktop/tutor');
  await sandbox.lockDefaultSession();
  await prepareSchool(cfg.dataDir, cfg.files, cfg.trustNames);
  fs.writeFileSync(path.join(cfg.dataDir, 'ratings.json'), JSON.stringify(cfg.ratings));
  const picks = [cfg.pickFile];
  const dialogs = { pickGame: async () => picks.shift() || null, pickBackupDir: async () => null, pickRestoreDir: async () => null, saveSchoolFile: async () => false };
  // Сети на снимках — примерные, а не сети компьютера, на котором делаются снимки
  const v4 = (address) => ({ address, netmask: '255.255.255.0', family: 'IPv4', internal: false });
  const interfaces = () => ({ 'Беспроводная сеть': [v4('192.168.1.50')], Ethernet: [v4('10.0.0.15')], 'happ-xray': [v4('172.19.0.1')] });
  const t = await openTutor({ dataDir: cfg.dataDir, appVersion: '1.1.0', show: false, kdf: FAST, dialogs, interfaces });
  const win = t.window;
  win.showInactive();
  const done = [];
  const snap = async (name) => {
    await sleep(600);
    const image = await win.webContents.capturePage();
    const file = path.join(cfg.shotDir, name);
    fs.writeFileSync(file, image.toPNG());
    done.push({ file, size: image.getSize() });
  };
  await ready(win);
  await click(win, '#btn-main'); // «Открыть ключ»
  await waitFor(() => js(win, "!!document.querySelector('#f-login')"));
  await setValue(win, '#f-login', PASSWORD);
  await js(win, "document.querySelector('.modal form').requestSubmit()");
  await waitFor(() => js(win, "document.getElementById('overlay').hidden"));
  await sleep(6500); // сообщение «Ключ школы открыт» исчезает через 6 с
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    win.setContentSize(w, h);
    await js(win, "document.querySelector('.row-game[data-id=\"tri-rezhima\"]') ? document.querySelector('.row-game[data-id=\"tri-rezhima\"]').click() : null");
    await sleep(300);
    await snap(`m1-tyutor-${w}.png`);
  }
  // М2: раздача включена. Сокет на примерном адресе открыть нельзя, поэтому снимку подставлено состояние
  const reload = async () => {
    await new Promise((resolve) => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
    await ready(win);
    await js(win, "document.querySelector('.row-game[data-id=\"tri-rezhima\"]') ? document.querySelector('.row-game[data-id=\"tri-rezhima\"]').click() : null");
  };
  t.serve.status = () => ({ on: true, name: 'Беспроводная сеть', address: '192.168.1.50', error: null, limited: true, downloading: 3, waiting: 9 });
  await reload();
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    win.setContentSize(w, h);
    await snap(`m2-razdacha-${w}.png`);
  }
  // М3: после «Скачать быстрее»
  t.serve.status = () => ({ on: true, name: 'Беспроводная сеть', address: '192.168.1.50', error: null, limited: false, downloading: 3, waiting: 2 });
  win.setContentSize(1366, 768);
  await reload();
  await snap('m3-razdacha-bystro-1366.png');
  t.serve.status = () => ({ on: false, error: null });
  win.setContentSize(1366, 768);
  await reload();
  await snap('m2-razdacha-vykl-1366.png');
  await click(win, '#btn-main');
  await waitFor(() => js(win, "!!document.querySelector('.modal h2')"));
  await snap('m1-proverka-faila-1366.png');
  await js(win, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(300);
  t.key.lock();
  win.webContents.send('school.locked');
  await sleep(300);
  await clickText(win, 'Открыть ключ');
  await snap('m1-vhod-1366.png');
  finish({ done });
}

const MODES = { tutor: hardened, 'tutor-ipc': ipcProbe, 'tutor-control': control, 'tutor-shots': shots, 'tutor-serve': serveProbe };
app.on('window-all-closed', () => {});
app.whenReady().then(MODES[cfg.mode]).catch((err) => {
  fs.writeFileSync(cfg.out, JSON.stringify({ fatal: String(err && err.stack) }));
  app.exit(4);
});
