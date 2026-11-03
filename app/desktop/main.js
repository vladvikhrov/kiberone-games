'use strict';
/* Оболочка приложения. Без файла в аргументах открывает витрину, с файлом .kibgames запускает его в песочнице.
   Ноутбук без метки школы работает как на В0: игры из папки, сети нет совсем (К4).
   Настроенный ноутбук (метка school.json в ProgramData, ADR-0002, 3.3) берёт игры только из каталога школы по сети,
   посторонние файлы не открывает, trusted-keys.json и папку games не читает (К19). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog } = require('electron');
const { PackageError, readPackage, supportsVersion } = require('../shared/package-format');
const { hardenApp, lockDefaultSession, openGame, registerSchemes } = require('./sandbox');
const { openVitrina } = require('./vitrina');
const { parseSchoolFile } = require('../shared/catalog');

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

/* Метка школы. Ставит администратор, ученик её изменить не может (ADR-0002, 3.3; У8). Из исходников: --school=файл. */
function schoolPath() {
  const arg = !app.isPackaged && process.argv.find((a) => a.startsWith('--school='));
  if (arg) return path.resolve(arg.slice('--school='.length));
  // Не из переменной ProgramData: ученик может задать свою переменную с тем же именем и подложить чужую метку
  if (process.platform === 'win32') return 'C:\\ProgramData\\KIBERone Games\\school.json';
  return '/etc/kiberone-games/school.json';
}
/* Каталог и кеш настроенного ноутбука (ADR-0002, 3.7). Из исходников: --local-data=папка. */
function localDataDir() {
  const arg = !app.isPackaged && process.argv.find((a) => a.startsWith('--local-data='));
  if (arg) return path.resolve(arg.slice('--local-data='.length));
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'KIBERone Games');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'KIBERone Games');
}
/* { school } | { error } | null, если метки нет. */
function readSchool() {
  let data;
  try { data = fs.readFileSync(schoolPath()); } catch (err) { return err.code === 'ENOENT' ? null : { error: 'Метка школы не читается' }; }
  try { return { school: parseSchoolFile(data) }; } catch (err) { return { error: err.message }; }
}
const SCHOOL = readSchool();

/* Окно ошибки с русским заголовком и кнопкой: showErrorBox на Windows пишет в заголовке «Error» (ADR-0003, раздел 6). */
async function showError(message, detail) {
  console.error(`Ошибка: ${message}`);
  if (detail) console.error(`Подробности: ${detail}`);
  if (!QUIET) await dialog.showMessageBox({ type: 'error', title: 'Игру не удалось открыть', message, buttons: ['Закрыть'], noLink: true });
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
  if (SCHOOL) {
    await showError('На этом ноутбуке игры запускаются только из каталога школы');
    return false;
  }
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
    if (err instanceof PackageError) await showError(err.message, err.detail);
    else await showError('Непредвиденная ошибка. Попробуйте ещё раз или скажите тьютору', err && err.stack);
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
    if (SCHOOL && SCHOOL.school) {
      // Сеть появляется только здесь, когда метка школы прочитана и проверена
      const { createSchoolNet } = require('./school-net');
      const { createNetSource } = require('./vitrina/net-source');
      const netSource = createNetSource({
        school: SCHOOL.school, net: createSchoolNet(), dir: localDataDir(), appVersion: app.getVersion(),
        onChange: () => { if (vitrina) vitrina.notify(); },
      });
      vitrina = await openVitrina({ dataDir: app.getPath('userData'), appVersion: app.getVersion(), netSource });
      netSource.start();
    } else {
      vitrina = await openVitrina({
        catalogDir: catalogDir(), dataDir: app.getPath('userData'), appVersion: app.getVersion(), trustedKeys: loadTrustedKeys(),
        schoolError: SCHOOL ? SCHOOL.error : null,
      });
    }
  });
}
