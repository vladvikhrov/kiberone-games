'use strict';
/* Программа тьютора «KIBERone Сервер» (ADR-0002, 2.1). Этап М1: ключ школы, публикация, подписанный каталог, без сети.
   Собирается отдельно (builder-tutor.json), в сборку ученика эта папка не входит. */
const os = require('os');
const path = require('path');
const { app, dialog } = require('electron');
const { hardenApp, lockDefaultSession, registerSchemes } = require('../sandbox');
const { SCHEME } = require('./window');
const { openTutor } = require('./index');

if (app.isPackaged && process.argv.slice(1).some((arg) => arg.startsWith('-'))) {
  console.error('Ошибка: программа не принимает ключи запуска');
  app.exit(2);
}

/* Данные тьютора: %LOCALAPPDATA%\KIBERone Server (ADR-0002, 3.7), на Linux ~/.local/share/KIBERone Server.
   Из исходников папку можно указать ключом --data=папка. */
function dataDir() {
  const arg = !app.isPackaged && process.argv.find((a) => a.startsWith('--data='));
  if (arg) return path.resolve(arg.slice('--data='.length));
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'KIBERone Server');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'KIBERone Server');
}

const DATA = dataDir();
// Версия программы ученика, под которую публикуются игры: обе программы собираются из одного package.json
const VERSION = require('../../package.json').version;
app.setName('KIBERone Сервер');
app.setPath('userData', path.join(DATA, 'electron')); // кеш Chromium отдельно от файлов школы
registerSchemes([SCHEME]);
hardenApp();

let tutor = null;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (tutor && !tutor.window.isDestroyed()) { tutor.window.show(); tutor.window.focus(); }
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    await lockDefaultSession();
    tutor = await openTutor({ dataDir: DATA, appVersion: VERSION, log: (kind, detail) => { if (kind !== 'request') console.error(`[${kind}] ${detail}`); } });
  }).catch(async (err) => {
    console.error(err);
    await dialog.showMessageBox({ type: 'error', title: 'KIBERone Сервер', message: 'Программа не запустилась', detail: 'Подробности в журнале программы', buttons: ['Закрыть'] });
    app.exit(1);
  });
}
