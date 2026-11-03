'use strict';
/* Витрина целиком: каталог, окно, IPC, запуск игр в песочнице, оценки.
   Источник каталога: папка с .kibgames (ноутбук без метки школы, как на В0) или подписанный каталог школы по сети
   (настроенный ноутбук, net-source.js). schoolError: метка школы есть, но испорчена — витрина пустая, сети нет. */
const { session } = require('electron');
const { readPackage } = require('../../shared/package-format');
const { openGame } = require('../sandbox');
const { loadCatalog } = require('./catalog');
const { createStore } = require('./store');
const { CHANNELS, EVENT_CLOSED, EVENT_CHANGED, createApi } = require('./api');
const W = require('./window');

/* Сообщение пришло из главного кадра нашей страницы, а не из чего-то, что в окно попало. */
const fromVitrina = (win, event) => event.sender === win.webContents && event.senderFrame
  && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === W.START_URL;

async function openVitrina({
  catalogDir, dataDir, appVersion, trustedKeys = {}, netSource = null, schoolError = null,
  show = true, width, height, now, log = () => {},
}) {
  let getCatalog;
  let covers;
  if (netSource) {
    getCatalog = () => ({ games: netSource.games(), skipped: [], missing: false, net: netSource.view() });
    covers = { get: (hex) => netSource.coverData(hex) };
  } else if (schoolError) {
    const empty = { games: [], skipped: [], missing: false, net: { configured: true, broken: true } };
    getCatalog = () => empty;
    covers = new Map();
  } else {
    const catalog = await loadCatalog(catalogDir, { trustedKeys, appVersion });
    getCatalog = () => catalog;
    covers = catalog.covers;
  }
  const store = createStore(dataDir, now ? { now } : {});
  const played = new Set();

  const ses = session.fromPartition(W.PARTITION);
  await W.lockVitrinaSession(ses, log);
  W.serveVitrina(ses, { ui: W.loadUi(), covers: () => covers });
  const win = W.createVitrinaWindow({ ses, show, width, height, log });

  /* Пакет проверяется заново перед каждым запуском: между показом и запуском файл могли заменить. */
  async function packageFor(game) {
    if (netSource) return netSource.gamePackage(game);
    const pkg = await readPackage(game.file, { trustedKeys });
    const m = pkg.manifest;
    if (m.id !== game.id || m.version !== game.version || pkg.trust.keyId !== game.keyId) return null;
    return pkg;
  }

  async function launch(game, mode) {
    let pkg;
    try {
      pkg = await packageFor(game);
      if (!pkg) return { ok: false, reason: 'changed' };
    } catch (err) {
      log('launch-error', String(err && err.message));
      return { ok: false, reason: 'failed' };
    }
    // Пока идёт игра, программа не шлёт ни одного пакета (К21)
    if (netSource) netSource.pause();
    try {
      const opened = await openGame(pkg, { mode: mode.id, show, onEvent: (e) => log(`game-${e.kind}`, e.detail) });
      if (!opened.alreadyOpen) {
        opened.window.once('closed', () => {
          if (netSource) netSource.resume();
          if (win.isDestroyed()) return;
          win.webContents.send(EVENT_CLOSED, { id: game.id, mode: mode.id });
          win.focus();
        });
      }
      await opened.loaded;
      return { ok: true };
    } catch (err) {
      if (netSource) netSource.resume();
      log('launch-error', String(err && err.message));
      return { ok: false, reason: 'failed' };
    }
  }

  const api = createApi({ getCatalog, store, launch, played, setAddress: netSource ? (ip) => netSource.setAddress(ip) : null });
  for (const channel of CHANNELS) {
    win.webContents.ipc.handle(channel, (event, ...args) => {
      if (!fromVitrina(win, event)) throw new Error('Запрос не из окна витрины');
      return api[channel](...args);
    });
  }
  const notify = () => { if (!win.isDestroyed()) win.webContents.send(EVENT_CHANGED); };
  win.on('closed', () => { if (netSource) netSource.close(); });
  await win.loadURL(W.START_URL);
  return { window: win, session: ses, api, played, getCatalog, notify };
}

module.exports = { openVitrina };
