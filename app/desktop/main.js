'use strict';
/* Оболочка приложения: открывает .kibgames и запускает игру в песочнице.
   Библиотека и интерфейс появятся на этапе 3. */
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const { PackageError, readPackage, supportsVersion } = require('../shared/package-format');
const { hardenApp, lockDefaultSession, openGame, registerSchemes } = require('./sandbox');

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
  });
  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(async () => {
    await lockDefaultSession();
    let file = fileFromArgs(process.argv);
    if (!file) {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Выберите игру', properties: ['openFile'], filters: [{ name: 'Игры KIBERone', extensions: ['kibgames'] }],
      });
      if (canceled) { app.quit(); return; }
      [file] = filePaths;
    }
    if (!(await launch(file))) app.exit(1);
  });
}
