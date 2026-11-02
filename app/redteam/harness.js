'use strict';
/* Главный процесс Electron на время теста. Режимы:
   hardened: настоящая песочница, control: те же атаки без защиты,
   second-run: второй запуск, ищет следы первого, screenshot: снимки настоящих игр. */
const fs = require('fs');
const { app, BrowserWindow, session } = require('electron');
const { readPackage } = require('../shared/package-format');
const sandbox = require('../desktop/sandbox');

const cfg = JSON.parse(process.env.REDTEAM_CONFIG);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAV = ['nav-location', 'nav-meta-refresh', 'nav-form', 'nav-open', 'nav-anchor-blank', 'nav-file', 'nav-file-open',
  'nav-mailto', 'nav-custom-protocol', 'nav-register-protocol', 'nav-download'];
// Без защиты эти действия запустили бы внешние программы на компьютере
const NOT_IN_CONTROL = new Set(['nav-mailto', 'nav-custom-protocol', 'nav-register-protocol']);

if (cfg.mode !== 'control') { sandbox.registerSchemes(); sandbox.hardenApp(); }
// Контрольная страница идёт по http, а API устройств браузер даёт только безопасным адресам
if (cfg.mode === 'control') app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', `http://${cfg.host}:${cfg.http}`);
// Виртуальные камера и микрофон: иначе отказ из-за отсутствия устройства выглядел бы как защита
app.commandLine.appendSwitch('use-fake-device-for-media-stream');

function finish(result) {
  fs.writeFileSync(cfg.out, JSON.stringify(result, null, 1));
  app.exit(0);
}

/* Системная песочница на Linux видна снаружи: seccomp 2 и отдельное пространство имён. */
function sandboxState(pid) {
  if (process.platform === 'win32') {
    const metric = app.getAppMetrics().find((m) => m.pid === pid) || {};
    return { platform: 'win32', sandboxed: metric.sandboxed, integrityLevel: metric.integrityLevel };
  }
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
  return {
    seccomp: (status.match(/^Seccomp:\s*(\d)/m) || [])[1],
    noNewPrivs: (status.match(/^NoNewPrivs:\s*(\d)/m) || [])[1],
    ownUserNs: fs.readlinkSync(`/proc/${pid}/ns/user`) !== fs.readlinkSync('/proc/self/ns/user'),
    ownPidNs: fs.readlinkSync(`/proc/${pid}/ns/pid`) !== fs.readlinkSync('/proc/self/ns/pid'),
    noSandboxFlag: cmdline.includes('--no-sandbox'),
  };
}

async function attackRun(win, start, restore) {
  const js = (code, gesture = false) => win.webContents.executeJavaScript(code, gesture);
  const channels = await js('window.__channels');
  const local = await js('window.__start()');
  const devices = await js('window.__devices()', true);

  const navigation = {};
  const startWindows = BrowserWindow.getAllWindows().length;
  for (const name of NAV) {
    if (cfg.mode === 'control' && NOT_IN_CONTROL.has(name)) continue;
    await js(`window.__navigate(${JSON.stringify(name)})`, true).catch(() => {});
    await sleep(900);
    navigation[name] = {
      urlStayed: win.webContents.getURL() === start,
      windows: BrowserWindow.getAllWindows().length - startWindows,
    };
    for (const extra of BrowserWindow.getAllWindows()) if (cfg.mode === 'control' && !cfg.keep.includes(extra.id) && extra !== win) extra.destroy();
    if (win.webContents.getURL() !== start) await restore();
  }
  return { channels, local, devices, navigation };
}

async function hardened() {
  await sandbox.lockDefaultSession();
  const events = [];
  const neighbourPkg = await readPackage(cfg.neighbourFile);
  const neighbour = await sandbox.openGame(neighbourPkg, { show: false, fullscreen: false });
  await neighbour.loaded;

  const game = await sandbox.openGame(await readPackage(cfg.gameFile), {
    show: false, fullscreen: false, onEvent: (e) => events.push(e),
  });
  await game.loaded;
  const attacks = await attackRun(game.window, game.url, () => game.window.loadURL(game.url));

  const contents = game.window.webContents;
  const js = (code) => contents.executeJavaScript(code);
  await js('window.__writeStorage()');
  const beforeReload = await js('window.__readStorage()');
  await new Promise((resolve) => { contents.once('did-finish-load', resolve); contents.reload(); });
  const afterReload = await js('window.__readStorage()');

  const state = sandboxState(contents.getOSProcessId());
  const neighbourState = sandboxState(neighbour.window.webContents.getOSProcessId());
  const neighbourOwn = await neighbour.window.webContents.executeJavaScript(
    "fetch('secret.txt').then(r=>r.text()).catch(()=>'')",
  );

  // Игра с тем же id, но другим автором, не должна подменить уже запущенную
  const impostor = await sandbox.openGame(await readPackage(cfg.impostorFile), { show: false, fullscreen: false });
  await impostor.loaded;
  await new Promise((resolve) => {
    neighbour.window.webContents.once('did-finish-load', resolve);
    neighbour.window.webContents.reload();
  });
  const afterImpostor = await neighbour.window.webContents.executeJavaScript("fetch('secret.txt').then(r=>r.text()).catch(()=>'')");

  // Игра не должна мешать себя закрыть: иначе ноутбук ученика остаётся заблокирован полноэкранным окном
  const trap = await sandbox.openGame(await readPackage(cfg.gameFile), { show: false, fullscreen: false });
  await trap.loaded;
  await game.window.webContents.executeJavaScript(
    "window.onbeforeunload = (e) => { e.preventDefault(); e.returnValue = 'нельзя'; return 'нельзя'; }; document.body.click(); true", true,
  );
  game.window.close();
  await sleep(2000);
  const closable = game.window.isDestroyed();
  if (!closable) game.window.destroy();

  // Настоящие игры: должны работать в той же песочнице
  const realGames = {};
  for (const file of cfg.realGames) {
    const pkg = await readPackage(file);
    const errors = [];
    const opened = await sandbox.openGame(pkg, { show: false, fullscreen: false });
    opened.window.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
    await opened.loaded;
    await sleep(1500);
    const text = await opened.window.webContents.executeJavaScript('document.body.innerText.length');
    realGames[pkg.manifest.id] = { errors, text };
    opened.window.destroy();
  }

  finish({ attacks, events, beforeReload, afterReload, state, neighbourState, neighbourOwn, afterImpostor, closable, realGames });
}

async function secondRun() {
  await sandbox.lockDefaultSession();
  const game = await sandbox.openGame(await readPackage(cfg.gameFile), { show: false, fullscreen: false });
  await game.loaded;
  finish({ storage: await game.window.webContents.executeJavaScript('window.__readStorage()') });
}

async function control() {
  const start = `http://${cfg.host}:${cfg.http}/control/index.html`;
  const win = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:control' } });
  cfg.keep = [win.id];
  session.fromPartition('persist:control').on('will-download', (event) => event.preventDefault());
  await win.loadURL(start);
  const attacks = await attackRun(win, start, () => win.loadURL(start));
  await win.loadURL(start);
  await win.webContents.executeJavaScript('window.__writeStorage()');
  await sleep(4000); // данные успевают записаться на диск
  await session.fromPartition('persist:control').flushStorageData();
  await sleep(500);
  finish({ attacks });
}

async function screenshot() {
  await sandbox.lockDefaultSession();
  const shots = {};
  for (const file of cfg.realGames) {
    const pkg = await readPackage(file);
    const opened = await sandbox.openGame(pkg, { show: true, fullscreen: false });
    await opened.loaded;
    await sleep(2500);
    const image = await opened.window.webContents.capturePage();
    const path = `${cfg.shotDir}/${pkg.manifest.id}.png`;
    fs.writeFileSync(path, image.toPNG());
    shots[pkg.manifest.id] = path;
    opened.window.destroy();
  }
  finish({ shots });
}

const MODES = { hardened, control, 'second-run': secondRun, screenshot };
app.on('window-all-closed', () => {});
app.whenReady().then(MODES[cfg.mode]).catch((err) => {
  fs.writeFileSync(cfg.out, JSON.stringify({ fatal: String(err && err.stack) }));
  app.exit(4);
});
