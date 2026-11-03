'use strict';
/* Программа тьютора целиком: ключ школы, игры школы, окно, IPC, пробный запуск в песочнице. */
const fs = require('fs');
const path = require('path');
const { dialog, powerSaveBlocker, session } = require('electron');
const os = require('os');
const netif = require('../../shared/netif');
const { createServer, ServerError } = require('./server');
const R = require('../../shared/ratings');
const { openGame } = require('../sandbox');
const { createSchoolKey } = require('./school-key');
const { createLibrary } = require('./library');
const { CHANNELS, EVENT_LOCKED, createTutorApi } = require('./api');
const { readText, writeAtomic } = require('./fsutil');
const W = require('./window');

const fromTutor = (win, event) => event.sender === win.webContents && event.senderFrame
  && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === W.START_URL;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/* Тип картинки по байтам: в каталоге его нет, а обложки уже проверены readPackage как PNG или WebP. */
function imageMime(data) {
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG)) return 'image/png';
  if (data.length >= 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function systemDialogs(win) {
  return {
    async pickGame() {
      const r = await dialog.showOpenDialog(win, { title: 'Опубликовать игру', buttonLabel: 'Выбрать', properties: ['openFile'], filters: [{ name: 'Игра KIBERone', extensions: ['kibgames'] }] });
      return r.canceled ? null : r.filePaths[0];
    },
    async pickBackupDir() {
      const r = await dialog.showOpenDialog(win, { title: 'Куда сохранить резервную копию школы', buttonLabel: 'Сохранить сюда', properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    },
    async pickRestoreDir() {
      const r = await dialog.showOpenDialog(win, { title: 'Папка резервной копии школы', buttonLabel: 'Восстановить', properties: ['openDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    },
    async saveSchoolFile(text) {
      const r = await dialog.showSaveDialog(win, { title: 'Файл школы для ноутбуков учеников', defaultPath: 'school.kibschool', filters: [{ name: 'Файл школы', extensions: ['kibschool'] }] });
      if (r.canceled || !r.filePath) return false;
      writeAtomic(r.filePath, text);
      return true;
    },
  };
}

/* Раздача каталога в сети (постановка М2). Выключена при каждом запуске, тьютор включает её сам и выбирает интерфейс.
   Работает и при закрытом ключе: каталог уже подписан. Пока раздача включена, ноутбук не засыпает. */
function createServe({ getLibrary, key, interfaces = () => os.networkInterfaces(), port, log }) {
  let server = null;
  let blocker = null;
  let error = null;
  let cache = { seq: -1, catalog: null, blobs: new Set() };

  function snapshot() {
    const lib = getLibrary();
    const seq = lib.seq();
    if (lib.catalogError() || !seq) return { catalog: null, seq: 0, blobs: new Set() };
    if (cache.seq !== seq) {
      const blobs = new Set();
      for (const g of lib.games()) {
        blobs.add(g.sha256);
        if (g.icon) blobs.add(g.icon.sha256);
        if (g.cover) blobs.add(g.cover.sha256);
        for (const m of g.modes) if (m.cover) blobs.add(m.cover.sha256);
      }
      cache = { seq, catalog: fs.readFileSync(lib.catalogPath), blobs };
    }
    return cache;
  }

  const list = () => netif.schoolInterfaces(interfaces());
  return {
    interfaces: () => list().map((i) => ({ name: i.name, address: i.address })),
    status: () => (server ? { on: true, name: server.name, address: server.address, error: null } : { on: false, error }),
    async start(name) {
      if (server) return;
      if (!key.exists()) throw new ServerError('Сначала создайте школу');
      const iface = list().find((i) => i.name === name);
      if (!iface) throw new ServerError('Этой сети больше нет. Выберите сеть из списка');
      const lib = getLibrary();
      const s = createServer({
        iface, fingerprint: key.info().fingerprint, snapshot, log,
        blobPath: (hex) => path.join(lib.blobsDir, hex), ...(port ? { port } : {}),
      });
      try { await s.start(); } catch (err) { error = err.message; throw err; }
      server = s;
      error = null;
      blocker = powerSaveBlocker.start('prevent-app-suspension');
    },
    async stop() {
      if (blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
      const s = server;
      server = null;
      if (s) await s.stop();
    },
  };
}

/* dataDir: папка данных. dialogs: подмена системных окон в тестах. kdf и now: только тесты. */
async function openTutor({ dataDir, appVersion, show = true, width, height, now, kdf, dialogs, log = () => {}, ui, testPreload, interfaces, port } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const clock = now || (() => Date.now());
  const key = createSchoolKey(dataDir, { now: clock, ...(kdf ? { kdf } : {}) });
  let library = null;
  const getLibrary = () => {
    if (!library) library = createLibrary(dataDir, { key, now: clock, appVersion, log });
    return library;
  };
  const ratings = () => {
    const text = readText(path.join(dataDir, 'ratings.json'));
    return (text !== null && R.parseRatings(text)) || R.emptyRatings();
  };

  const ses = session.fromPartition(W.PARTITION);
  await W.lockTutorSession(ses, log);
  W.serveTutor(ses, {
    ui: ui || W.loadUi(),
    cover: (hex) => {
      if (!key.exists()) return null;
      const data = getLibrary().coverData(hex);
      const mime = data && imageMime(data);
      return mime ? { data, mime } : null;
    },
  });
  const win = W.createTutorWindow({ ses, show, width, height, log, ...(testPreload ? { preload: testPreload } : {}) });

  /* Пробный запуск: та же песочница, что у ученика. */
  async function tryGame(pkg, mode) {
    const opened = await openGame(pkg, { mode, show, onEvent: (e) => log(`game-${e.kind}`, e.detail) });
    await opened.loaded;
  }

  const serve = createServe({ getLibrary, key, log, ...(interfaces ? { interfaces } : {}), ...(port ? { port } : {}) });
  const api = createTutorApi({
    key, getLibrary, ratings, tryGame, log, serve,
    dialogs: dialogs || systemDialogs(win),
    today: () => R.localDay(new Date(clock())),
    onSchool: () => { library = null; },
  });
  for (const channel of CHANNELS) {
    win.webContents.ipc.handle(channel, (event, ...args) => {
      if (!fromTutor(win, event)) throw new Error('Запрос не из окна тьютора');
      key.touch();
      return api[channel](...args);
    });
  }

  // Действие тьютора — нажатие мыши или клавиши в окне. Через 10 минут без них ключ затирается (Т6)
  win.webContents.on('input-event', (_event, input) => {
    if (input.type === 'mouseDown' || input.type === 'rawKeyDown' || input.type === 'keyDown') key.touch();
  });
  const idleTimer = setInterval(() => {
    if (key.checkIdle()) {
      if (library) library.cancelAll();
      if (!win.isDestroyed()) win.webContents.send(EVENT_LOCKED);
    }
  }, 5000);
  win.on('closed', () => {
    serve.stop();
    clearInterval(idleTimer);
    key.lock();
    if (library) library.cancelAll();
  });

  await win.loadURL(W.START_URL);
  return { window: win, session: ses, api, key, getLibrary, serve };
}

module.exports = { openTutor, imageMime };
