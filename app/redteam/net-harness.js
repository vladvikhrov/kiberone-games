'use strict';
/* Главный процесс Electron в сетевом пространстве «ученика» (этап М2). Собирает витрину из настоящих модулей:
   createSchoolNet + createNetSource + openVitrina, как desktop/main.js на настроенном ноутбуке.
   Режимы:
   net-main     настоящая защита: обнаружение, каталог, загрузки, К23, К17, К21, ручной адрес «интернета»;
   net-restart  второй запуск с тем же кешем: ничего не качает заново, находит сервер на новом адресе;
   net-forged   поддельный сервер с подделанным каталогом и перенаправлением; каталог не меняется;
   net-subst    поддельный сервер с подменой файла новой игры; игра не попадает в кеш и не запускается;
   net-ask      сервера нет: через 15 с экран «Попроси тьютора», адрес вводится в поле;
   net-control  без защиты: стенд подменяет фильтр и проверки (desktop/school-net.js filter, net-source.js checks).
                Подделки обязаны пройти, атаки игры без песочницы обязаны дойти, иначе тест провален.
   net-shots    снимки новых экранов для docs/img.
   net-vote     оценки по сети (М4, К28, Р2): рейтинг с сервера на карточке, голос во время игры уходит после её закрытия,
                голос без сервера ждёт в памяти и уходит, когда сервер вернулся. С control: true пауза сети снята. */
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session } = require('electron');
/* Заставка М5 закрывает окно на 3 с и съедает первую клавишу. Стенду она мешает, поэтому убирается сразу после загрузки страницы.
   Снимок самой заставки — redteam/splash-shots.js. */
app.on('web-contents-created', (_e, wc) => {
  wc.on('dom-ready', () => { wc.executeJavaScript("document.getElementById('splash')?.remove()").catch(() => {}); });
});
const sandbox = require('../desktop/sandbox');

const cfg = JSON.parse(process.env.REDTEAM_CONFIG);
const CONTROL = cfg.mode === 'net-control' || cfg.control === true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP_VERSION = require('../package.json').version;

sandbox.registerSchemes();
if (cfg.mode !== 'net-control') sandbox.hardenApp();

function finish(result) {
  fs.writeFileSync(cfg.out, JSON.stringify(result, null, 1));
  app.exit(0);
}
async function waitFor(fn, ms = 30000, step = 250) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) return value;
    await sleep(step);
  }
}
const signal = (name) => fs.writeFileSync(path.join(cfg.signalDir, name), String(Date.now()));
const waitSignal = (name, ms = 30000) => waitFor(() => fs.existsSync(path.join(cfg.signalDir, name)), ms, 100);
const js = (win, code) => win.webContents.executeJavaScript(code, true);

/* Контроль: защита снята подменой функций в загруженных модулях. В рабочем коде такого переключателя нет. */
function disableProtection() {
  const { filter } = require('../desktop/school-net');
  filter.host = () => ({ name: 'любой' });
  filter.broadcast = () => true;
  const { checks } = require('../desktop/vitrina/net-source');
  const { readPackage } = require('../shared/package-format');
  checks.catalog = (bytes) => JSON.parse(Buffer.from(JSON.parse(String(bytes)).payload, 'base64').toString('utf8'));
  checks.blob = () => {};
  checks.hash = () => true;
  checks.game = (data) => readPackage(data);
}

async function openStudent({ localDir = cfg.localDir, options = {} } = {}) {
  const { parseSchoolFile } = require('../shared/catalog');
  const { createSchoolNet } = require('../desktop/school-net');
  const { createNetSource } = require('../desktop/vitrina/net-source');
  const { openVitrina } = require('../desktop/vitrina');
  const school = parseSchoolFile(fs.readFileSync(cfg.schoolFile));
  let v = null;
  const src = createNetSource({
    school, net: createSchoolNet(), dir: localDir, appVersion: APP_VERSION,
    options: { pollMs: 3000, jitterMs: 500, retryMs: [1500, 1500, 3000], minRetryAfterMs: 1000, discoverMs: 1200, resumeMinMs: 1500, resumeMaxMs: 2000, ...options },
    onChange: () => { if (v) v.notify(); },
  });
  v = await openVitrina({ dataDir: cfg.dataDir, appVersion: APP_VERSION, netSource: src, show: false, width: cfg.width || 1366, height: cfg.height || 768 });
  src.start();
  return { v, src, win: v.window, list: () => v.api['catalog.list']() };
}

const gameWindows = (vitrina) => BrowserWindow.getAllWindows().filter((w) => w !== vitrina && !w.isDestroyed());

/* Запуск через IPC витрины (тот же путь, что у кнопки «Играть»), атаки игры, ожидание, закрытие. */
async function playGame(s, id, { attack = false, holdMs = 0 } = {}) {
  const open = Date.now();
  const res = await s.v.api['game.launch'](id, 'default');
  const r = { id, res, open, paused: s.src.paused() };
  if (!res.ok) return r;
  const win = await waitFor(() => gameWindows(s.win)[0], 5000);
  r.url = win.webContents.getURL();
  r.text = (await js(win, 'document.body ? document.body.innerText.length : 0').catch(() => -1));
  if (attack) r.attack = await js(win, 'window.__start()').catch((e) => ({ error: String(e) }));
  if (holdMs) await sleep(holdMs);
  r.pausedLate = s.src.paused();
  r.close = Date.now();
  win.destroy();
  await sleep(300);
  r.resumed = !s.src.paused();
  return r;
}

const readyAll = (ids) => async (s) => {
  const l = await s.list();
  return ids.every((id) => l.games.some((g) => g.id === id && g.state === 'ready')) && l;
};

async function domState(win) {
  return js(win, `({
    titles: [...document.querySelectorAll('.card-title')].map((e) => e.textContent),
    injected: document.querySelectorAll('.card-title *, .card .meta *').length,
    xss: window.__xss === undefined ? null : window.__xss,
    status: (document.getElementById('status') || {}).textContent,
    ask: !document.getElementById('ask').hidden,
    askText: document.getElementById('ask').textContent,
    tags: [...document.querySelectorAll('.card .tag')].map((e) => e.textContent),
  })`);
}

/* ---------- net-main ---------- */
async function netMain() {
  await sandbox.lockDefaultSession();
  const s = await openStudent();
  const start = Date.now();
  const list = await waitFor(() => readyAll(cfg.expect)(s), 60000);
  const r = { readyMs: Date.now() - start, list: list || await s.list(), view: s.src.view() };
  await sleep(500);
  r.dom = await domState(s.win);
  // К17 и К21: игра по сети пытается достучаться до сервера, соседа и loopback, сеть ученика на это время молчит
  r.games = [];
  for (const id of cfg.attackGames) r.games.push(await playGame(s, id, { attack: true, holdMs: 4500 }));
  // К21, вторая часть: сервер выключен, игра из кеша запускается и работает
  signal('stop-server');
  await waitSignal('server-stopped');
  await sleep(500);
  r.offlineGame = await playGame(s, cfg.offlineGame, { holdMs: 1500 });
  // К18: адрес «интернета» в поле ручного ввода
  r.addressInternet = await s.v.api['server.setAddress'](cfg.internet);
  r.addressName = await s.v.api['server.setAddress']('example.com');
  r.cache = fs.readdirSync(path.join(cfg.localDir, 'cache'));
  finish(r);
}

/* ---------- net-restart ---------- */
async function netRestart() {
  await sandbox.lockDefaultSession();
  const s = await openStudent();
  const r = { before: (await s.list()).games.map((g) => `${g.id}:${g.state}`) };
  r.found = await waitFor(async () => s.src.view().server === cfg.expectServer && s.src.view().online, 40000);
  await sleep(4000); // ещё один опрос: ответ 304
  r.view = s.src.view();
  r.list = await s.list();
  finish(r);
}

/* ---------- net-forged и net-subst (с защитой и без) ---------- */
async function netForged() {
  await sandbox.lockDefaultSession();
  if (CONTROL) disableProtection();
  const s = await openStudent();
  const r = { before: (await s.list()).games.map((g) => g.id).sort() };
  await sleep(cfg.waitMs || 9000);
  r.after = (await s.list()).games.map((g) => g.id).sort();
  r.view = s.src.view();
  r.dom = await domState(s.win);
  if (cfg.redirect) r.redirect = await s.v.api['server.setAddress'](cfg.redirect);
  finish(r);
}

async function netSubst() {
  await sandbox.lockDefaultSession();
  if (CONTROL) disableProtection();
  const s = await openStudent();
  const r = {};
  r.state = await waitFor(async () => {
    const g = (await s.list()).games.find((x) => x.id === cfg.substGame);
    return g && (g.state === 'failed' || g.state === 'ready') && g.state;
  }, 40000);
  r.cache = fs.readdirSync(path.join(cfg.localDir, 'cache'));
  r.play = await playGame(s, cfg.substGame, { holdMs: 500 });
  r.view = s.src.view();
  finish(r);
}

/* ---------- net-ask ---------- */
async function netAsk() {
  await sandbox.lockDefaultSession();
  const start = Date.now();
  const s = await openStudent({ options: { askAfterMs: 15000 } });
  const r = {};
  r.early = await domState(s.win);
  r.askShown = await waitFor(async () => (await domState(s.win)).ask, 25000);
  r.askMs = Date.now() - start;
  r.askDom = await domState(s.win);
  if (cfg.shotsDir) await shot(s.win, 'm2-poprosi-tyutora');
  signal('start-server');
  await waitSignal('server-started');
  // Ребёнок вводит адрес в поле и нажимает «Подключиться»
  await js(s.win, `(() => { const i = document.getElementById('ask-ip'); i.value = ${JSON.stringify(cfg.serverIp)}; i.form.requestSubmit(); })()`);
  r.cards = await waitFor(async () => { const d = await domState(s.win); return d.titles.length > 0 && d; }, 20000);
  r.view = s.src.view();
  r.state = JSON.parse(fs.readFileSync(path.join(cfg.localDir, 'state.json'), 'utf8'));
  finish(r);
}

/* ---------- net-control: К17 и К18 без защиты ---------- */
async function netControl() {
  disableProtection();
  const r = {};
  // К18: без фильтра ученик подключается к адресу «интернета»
  const s = await openStudent();
  r.addressInternet = await s.v.api['server.setAddress'](cfg.internet);
  // К17: страница атак без песочницы (обычное окно, сессия по умолчанию без замков) против каждого адреса
  r.pages = {};
  for (const [name, url] of Object.entries(cfg.controlPages)) {
    const win = new BrowserWindow({ show: false, webPreferences: { session: session.fromPartition(`control-${name}`) } });
    await win.loadURL(url).catch(() => {});
    r.pages[name] = await js(win, 'window.__start()').catch((e) => ({ error: String(e) }));
    await sleep(1500);
    win.destroy();
  }
  finish(r);
}

/* ---------- net-shots ---------- */
async function shot(win, name) {
  win.showInactive();
  win.setContentSize(cfg.width || 1366, cfg.height || 768);
  await sleep(900);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(cfg.shotsDir, `${name}-${cfg.width || 1366}.png`), img.toPNG());
}
async function netShots() {
  await sandbox.lockDefaultSession();
  const s = await openStudent();
  await waitFor(async () => (await s.list()).games.length > 0, 30000);
  await sleep(cfg.settleMs || 1500);
  await shot(s.win, cfg.shotName || 'm2-vitrina-set');
  if (cfg.linkShot) {
    signal('stop-server');
    await waitSignal('server-stopped');
    await waitFor(async () => !s.src.view().online, 20000);
    await sleep(800);
    await shot(s.win, 'm2-vitrina-net-svyazi');
    await js(s.win, "document.querySelector('.btn-status').click()");
    await shot(s.win, 'm2-svyaz');
  }
  finish({ ok: true });
}

app.on('window-all-closed', () => {});
/* ---------- net-priority (М3, Н7): «Играть» на нескачанной большой игре через настоящую витрину ---------- */
async function netPriority() {
  await sandbox.lockDefaultSession();
  const s = await openStudent();
  const r = {};
  const game = (id) => async () => (await s.list()).games.find((g) => g.id === id);
  // Отмеченная тьютором большая игра уже качается сама, большая без отметки ждёт кнопки
  r.before = await waitFor(async () => {
    if (!(await game(cfg.bigGame)())) return false;
    const a = await game(cfg.bigGame)();
    const b = await game(cfg.lessonGame)();
    return a && b && a.state === 'ondemand' && b.state === 'downloading' && b.progress >= 5 && { a: a.state, b: b.state, bProgress: b.progress };
  }, 60000);
  if (!r.before) { r.logBefore = s.src.view().log.slice(-12); finish(r); return; }
  // Ребёнок открывает карточку и нажимает «Играть»
  const clickOn = (selector) => js(s.win, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  const button = () => js(s.win, `(() => { const b = document.querySelector('.btn-play'); const n = document.querySelector('.side-note');
    return b ? { label: b.textContent, disabled: b.disabled, note: n ? n.textContent : '' } : null; })()`);
  r.cardClicked = await waitFor(() => clickOn(`.card[data-id="${cfg.bigGame}"]`), 10000);
  r.labelBefore = await waitFor(button, 5000);
  r.playClicked = await clickOn('.btn-play');
  r.during = await waitFor(async () => {
    const d = await button();
    return d && /Скачивается \d+ % · (ещё \d+ мин|меньше минуты)/.test(d.label) && d;
  }, 30000);
  if (!r.during) r.lastButton = await button();
  r.lessonDuring = await game(cfg.lessonGame)();
  if (cfg.shotsDir) await shot(s.win, 'm3-igrat-skachivaetsya');
  r.ready = await waitFor(async () => {
    const d = await button();
    return d && d.label === 'Играть' && !d.disabled && d;
  }, 90000);
  r.windowsAfterReady = gameWindows(s.win).length; // сама игра не запускается (решение Влада)
  r.lessonAfter = await waitFor(async () => { const b = await game(cfg.lessonGame)(); return !!b && b.state === 'ready'; }, 60000);
  if (!r.lessonAfter) { r.listAfter = (await s.list()).games.map((x) => `${x.id}:${x.state}`); r.logAfter = s.src.view().log.slice(-12); }
  r.play = await playGame(s, cfg.bigGame, { holdMs: 500 });
  r.view = s.src.view();
  finish(r);
}

/* ---------- net-vote (М4) ---------- */
async function netVote() {
  await sandbox.lockDefaultSession();
  const s = await openStudent();
  // Контроль К28: сеть не останавливается на время игры. В рабочем коде такого переключателя нет
  if (CONTROL) s.src.pause = () => {};
  const r = {};
  const game = async (id) => (await s.list()).games.find((g) => g.id === id);
  r.ready = await waitFor(async () => {
    const a = await game(cfg.game);
    const b = await game(cfg.ratedGame);
    return a && b && a.state === 'ready' && b.state === 'ready' && b.rating.n > 0;
  }, 60000);
  // Р2: рейтинг с сервера на карточке
  r.rated = (await game(cfg.ratedGame)).rating;
  r.cardText = await js(s.win, `(() => { const c = document.querySelector('.card[data-id="${cfg.ratedGame}"] .rating-line'); return c ? c.textContent : null; })()`);
  // К28: оценка поставлена во время игры (окно игры открыто), сеть в это время молчит
  const launch = await s.v.api['game.launch'](cfg.game, cfg.modeA);
  const win = await waitFor(() => gameWindows(s.win)[0], 5000);
  r.open = Date.now();
  await sleep(700);
  r.voteDuring = await s.v.api['vote.send'](cfg.game, cfg.modeA, 5);
  await sleep(4000);
  r.pendingDuring = s.src.votePending(cfg.game, cfg.modeA);
  r.close = Date.now();
  if (win) win.destroy();
  r.launch = launch;
  r.sentAfter = await waitFor(() => !s.src.votePending(cfg.game, cfg.modeA) && Date.now(), 20000, 100);
  // Сервер пропал: ребёнок играет в игру из кеша и ставит оценку в окне — голос ждёт в памяти
  signal('stop-server');
  await waitSignal('server-stopped');
  await waitFor(() => !s.src.view().online, 20000);
  const launch2 = await s.v.api['game.launch'](cfg.game, cfg.modeB);
  r.launchOffline = launch2;
  const win2 = await waitFor(() => gameWindows(s.win)[0], 5000);
  await sleep(500);
  if (win2) win2.destroy();
  // После закрытия игры витрина сама открывает окно оценки этого режима
  r.rateOpen = await waitFor(() => js(s.win, "!!document.querySelector('.modal.rate')"), 5000);
  await js(s.win, "document.querySelectorAll('.modal.rate .star')[2].click()");
  const panel = () => js(s.win, "(() => { const p = document.querySelector('.modal.rate .done, .modal.rate .rate-hint'); return p ? p.textContent : null; })()");
  r.textOffline = await waitFor(async () => { const t = await panel(); return t && t.startsWith('Спасибо') && t; }, 9000);
  r.pendingOffline = s.src.votePending(cfg.game, cfg.modeB);
  if (cfg.shotsDir) await shot(s.win, 'm4-ocenka-zhdet-svyazi');
  signal('start-server');
  await waitSignal('server-started');
  r.textOnline = await waitFor(async () => { const t = await panel(); return t && t.includes('ушла тьютору') && t; }, 30000);
  r.pendingOnline = s.src.votePending(cfg.game, cfg.modeB);
  if (cfg.shotsDir) await shot(s.win, 'm4-ocenka-ushla');
  r.view = s.src.view();
  finish(r);
}

const MODES = { 'net-vote': netVote, 'net-priority': netPriority, 'net-main': netMain, 'net-restart': netRestart, 'net-forged': netForged, 'net-subst': netSubst, 'net-ask': netAsk, 'net-control': netControl, 'net-shots': netShots };
app.whenReady().then(() => MODES[cfg.mode]()).catch((err) => finish({ fatal: String(err && err.stack) }));
