'use strict';
/* Витрина целиком: каталог из папки, окно, IPC, запуск игр в песочнице, оценки. */
const { session } = require('electron');
const { readPackage } = require('../../shared/package-format');
const { openGame } = require('../sandbox');
const { loadCatalog } = require('./catalog');
const { createStore } = require('./store');
const { CHANNELS, EVENT_CLOSED, createApi } = require('./api');
const W = require('./window');

/* Сообщение пришло из главного кадра нашей страницы, а не из чего-то, что в окно попало. */
const fromVitrina = (win, event) => event.sender === win.webContents && event.senderFrame
  && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === W.START_URL;

async function openVitrina({ catalogDir, dataDir, appVersion, trustedKeys = {}, show = true, width, height, now, log = () => {} }) {
  const catalog = await loadCatalog(catalogDir, { trustedKeys, appVersion });
  const store = createStore(dataDir, now ? { now } : {});
  const played = new Set();

  const ses = session.fromPartition(W.PARTITION);
  await W.lockVitrinaSession(ses, log);
  W.serveVitrina(ses, { ui: W.loadUi(), covers: () => catalog.covers });
  const win = W.createVitrinaWindow({ ses, show, width, height, log });

  /* Файл перечитывается и проверяется заново: между показом и запуском его могли заменить. */
  async function launch(game, mode) {
    try {
      const pkg = await readPackage(game.file, { trustedKeys });
      const m = pkg.manifest;
      if (m.id !== game.id || m.version !== game.version || pkg.trust.keyId !== game.keyId) return { ok: false, reason: 'changed' };
      const opened = await openGame(pkg, { mode: mode.id, onEvent: (e) => log(`game-${e.kind}`, e.detail) });
      if (!opened.alreadyOpen) {
        opened.window.once('closed', () => {
          if (win.isDestroyed()) return;
          win.webContents.send(EVENT_CLOSED, { id: game.id, mode: mode.id });
          win.focus();
        });
      }
      await opened.loaded;
      return { ok: true };
    } catch (err) {
      log('launch-error', String(err && err.message));
      return { ok: false, reason: 'failed' };
    }
  }

  const api = createApi({ getCatalog: () => catalog, store, launch, played });
  for (const channel of CHANNELS) {
    win.webContents.ipc.handle(channel, (event, ...args) => {
      if (!fromVitrina(win, event)) throw new Error('Запрос не из окна витрины');
      return api[channel](...args);
    });
  }
  await win.loadURL(W.START_URL);
  return { window: win, session: ses, api, played, catalog };
}

module.exports = { openVitrina };
