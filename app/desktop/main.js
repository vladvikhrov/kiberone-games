'use strict';
/* Оболочка приложения. Без файла в аргументах открывает витрину (этап В0: игры из папки),
   с файлом .kibgames сразу запускает его в песочнице, как раньше. */
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const { PackageError, readPackage, supportsVersion } = require('../shared/package-format');
const { hardenApp, lockDefaultSession, openGame, registerSchemes } = require('./sandbox');
const { openVitrina } = require('./vitrina');

/* Установленному приложению ключи запуска не нужны. Ключ вроде --no-sandbox в ярлыке отключил бы защиту,
   а Chromium читает такие ключи раньше нашего кода, поэтому при них просто не запускаемся. */
if (app.isPackaged && process.argv.slice(1).some((arg) => arg.startsWith('-'))) {
  console.error('Ошибка: приложение не принимает ключи запуска');
  app.exit(2);
}

const QUIET = process.argv.includes('--quiet-errors'); // для автотестов: без диалоговых окон

registerSchemes();
hardenApp();

const fileFromArgs = (argv) => argv.slice(1).find((arg) => !arg.startsWith('-') && arg.toLowerCase().endsWith('.kibgames'));
/* Папка игр витрины. Из исходников её можно указать ключом --catalog=папка, у установленного приложения ключей нет. */
function catalogDir() {
  const arg = !app.isPackaged && process.argv.find((a) => a.startsWith('--catalog='));
  return arg ? path.resolve(arg.slice('--catalog='.length)) : path.join(app.getPath('userData'), 'games');
}
let vitrina = null;

function showError(message) {
  console.error(`Ошибка: ${message}`);
  if (!QUIET) dialog.showErrorBox('Игру не удалось открыть', message);
}

/* Список доверия школы: { "отпечаток ключа": "имя" }. Испорченный файл значит пустой список. */
function loadTrustedKeys() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'trusted-keys.json'), 'utf8'));
    return list && typeof list === 'object' && !Array.isArray(list) ? list : {};
  } catch { return {}; }
}

/* Подпись доказывает только то, что файл не менялся. Имя автора в файле может быть любым. */
async function confirmUnknownAuthor({ manifest, trust }) {
  if (trust.trusted) return true;
  const message = `Автор игры «${manifest.title}» неизвестен этой школе`;
  if (QUIET) { console.error(`Ошибка: ${message}`); return false; }
  const { response } = await dialog.showMessageBox({
    type: 'warning', buttons: ['Не запускать', 'Запустить'], defaultId: 0, cancelId: 0, title: 'Неизвестный автор', message,
    detail: `Автор называет себя: ${manifest.authors.join(', ')}. Проверить это нельзя.\nОтпечаток ключа: ${trust.keyId}\n\nИгра не сможет выйти в интернет или прочитать файлы компьютера, но её содержимое никто не проверял. Запускайте, только если знаете, откуда этот файл.`,
  });
  return response === 1;
}

async function launch(file) {
  try {
    const pkg = await readPackage(file, { trustedKeys: loadTrustedKeys() });
    if (!supportsVersion(app.getVersion(), pkg.manifest.minAppVersion)) {
      throw new PackageError(`Для этой игры нужна версия приложения ${pkg.manifest.minAppVersion} или новее`);
    }
    if (!(await confirmUnknownAuthor(pkg))) return false;
    const { loaded } = await openGame(pkg);
    await loaded;
    return true;
  } catch (err) {
    showError(err instanceof PackageError ? err.message : `Непредвиденная ошибка: ${err.message}`);
    return false;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const file = fileFromArgs(argv);
    if (file) launch(file);
    else if (vitrina && !vitrina.window.isDestroyed()) { vitrina.window.show(); vitrina.window.focus(); }
  });
  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(async () => {
    await lockDefaultSession();
    const file = fileFromArgs(process.argv);
    if (file) {
      if (!(await launch(file))) app.exit(1);
      return;
    }
    vitrina = await openVitrina({
      catalogDir: catalogDir(), dataDir: app.getPath('userData'), appVersion: app.getVersion(), trustedKeys: loadTrustedKeys(),
    });
  });
}
