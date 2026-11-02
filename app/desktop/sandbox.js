'use strict';
/* Песочница игр. Игра считается недоверенной: она может быть написана кем угодно.
   Защита многослойная, чтобы ошибка в одном слое не открывала дорогу наружу:
   системная песочница Chromium, отдельная сессия в памяти, сетевой фильтр, нерабочий прокси,
   запрет DNS, CSP, запрет переходов и всех разрешений. */
const { app, BrowserWindow, dialog, protocol, session } = require('electron');
const { MIME, extensionOf } = require('../shared/package-format');

const SCHEME = 'kibgame';

const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/* Вызывать до готовности приложения. */
function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/* Настройки всего приложения. Вызывать до готовности приложения. */
function hardenApp() {
  app.enableSandbox();
  const switches = {
    'host-resolver-rules': 'MAP * ~NOTFOUND', // ни одного DNS-запроса
    'force-webrtc-ip-handling-policy': 'disable_non_proxied_udp',
    'no-pings': true,
    'disable-background-networking': true,
    'disable-component-update': true,
    'disable-domain-reliability': true,
    'disable-sync': true,
  };
  for (const [name, value] of Object.entries(switches)) {
    if (value === true) app.commandLine.appendSwitch(name);
    else app.commandLine.appendSwitch(name, value);
  }
  // Запасной слой для любого содержимого, в том числе созданного не через openGame
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

const isOwnUrl = (url, id) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${SCHEME}:` && parsed.host === id;
  } catch { return false; }
};

/* Сессия одна на игру и автора, а окно могут открыть снова: журнал меняем, обработчики ставим один раз. */
const sessionLogs = new WeakMap();
const runningGames = new Map(); // id игры -> окно

async function lockSession(ses, id, log) {
  const known = sessionLogs.has(ses);
  sessionLogs.set(ses, log);
  if (known) return;
  log = (kind, detail) => sessionLogs.get(ses)(kind, detail);
  ses.setSpellCheckerEnabled(false); // проверка орфографии скачивает словари из интернета
  ses.setPermissionRequestHandler((_c, permission, callback) => { log('permission', permission); callback(false); });
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (event, item) => { log('download', item.getFilename()); event.preventDefault(); });
  ses.webRequest.onBeforeRequest((details, callback) => {
    const { url } = details;
    const allowed = isOwnUrl(url, id) || url.startsWith('data:') || url.startsWith('blob:');
    if (!allowed) log('network', url.slice(0, 200));
    callback({ cancel: !allowed });
  });
  // Прокси никуда не ведёт: то, что обойдёт фильтр (например WebRTC), тоже не выйдет наружу
  await ses.setProxy({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:9', proxyBypassRules: '<-loopback>' });
}

/* Файлы отдаются только из проверенной копии в памяти, диск здесь не участвует вообще. */
function serveGame(ses, pkg) {
  const { id } = pkg.manifest;
  if (ses.protocol.isProtocolHandled(SCHEME)) ses.protocol.unhandle(SCHEME);
  ses.protocol.handle(SCHEME, (request) => {
    const headers = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
    const notFound = () => new Response('Not found', { status: 404, headers });
    if (request.method !== 'GET' || !isOwnUrl(request.url, id)) return notFound();
    let name;
    try { name = `game/${decodeURIComponent(new URL(request.url).pathname.slice(1))}`; } catch { return notFound(); }
    const data = pkg.files.get(name);
    if (!data || !pkg.manifest.files[name]) return notFound();
    return new Response(data, { status: 200, headers: { ...headers, 'Content-Type': MIME[extensionOf(name)] } });
  });
}

function guardWindow(win, id, log) {
  const contents = win.webContents;
  const stay = (event, url) => {
    if (!isOwnUrl(url, id)) { log('navigation', String(url).slice(0, 200)); event.preventDefault(); }
  };
  contents.on('will-navigate', (event) => stay(event, event.url));
  contents.on('will-frame-navigate', (event) => stay(event, event.url));
  contents.on('will-redirect', (event) => stay(event, event.url));
  contents.setWindowOpenHandler(({ url }) => { log('window', String(url).slice(0, 200)); return { action: 'deny' }; });
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  // Игра не может отказаться закрываться через beforeunload: окно на весь экран заблокировало бы ноутбук
  contents.on('will-prevent-unload', (event) => event.preventDefault());

  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const reload = input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r');
    if (reload) { event.preventDefault(); contents.reload(); return; }
    if (input.key === 'Escape') {
      event.preventDefault();
      dialog.showMessageBox(win, {
        type: 'question', buttons: ['Продолжить игру', 'Выйти'], defaultId: 0, cancelId: 0,
        title: 'Выход из игры', message: 'Выйти из игры? Прогресс будет потерян.',
      }).then(({ response }) => { if (response === 1 && !win.isDestroyed()) win.destroy(); }); // destroy сработает и у зависшей игры
    }
  });
}

/* Открывает проверенный пакет (результат readPackage). Возвращает окно и обещание загрузки. */
async function openGame(pkg, { show = true, fullscreen = true, onEvent = () => {} } = {}) {
  const { id, entry, title } = pkg.manifest;
  const log = (kind, detail) => onEvent({ kind, detail });

  // Одновременно работает одна копия: файл с тем же id не может подменить запущенную игру
  const running = runningGames.get(id);
  if (running && !running.isDestroyed()) {
    log('already-open', id);
    if (running.isVisible()) running.focus();
    return { window: running, url: running.webContents.getURL(), loaded: Promise.resolve(), alreadyOpen: true };
  }

  // Без префикса persist: сессия живёт только в памяти. Автор входит в имя, чтобы чужая игра с тем же id не видела данных
  const ses = session.fromPartition(`kibgame-${id}-${pkg.trust.keyId}`);
  await lockSession(ses, id, log);
  serveGame(ses, pkg);

  const win = new BrowserWindow({
    show, fullscreen, title, backgroundColor: '#2B4C7E', autoHideMenuBar: true,
    width: 1920, height: 1080,
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      navigateOnDragDrop: false,
      devTools: false,
      safeDialogs: true,
    },
  });
  win.setMenu(null);
  guardWindow(win, id, log);
  runningGames.set(id, win);
  win.on('closed', () => { if (runningGames.get(id) === win) runningGames.delete(id); });
  // Упавшая игра оставила бы пустое окно на весь экран
  win.webContents.on('render-process-gone', (_e, details) => {
    log('crash', details.reason);
    if (!win.isDestroyed()) win.destroy();
    if (show) dialog.showErrorBox('Игра завершилась с ошибкой', `Игру «${title}» пришлось закрыть. Запустите её снова.`);
  });

  const url = `${SCHEME}://${id}/${entry.replace(/^game\//, '').split('/').map(encodeURIComponent).join('/')}`;
  return { window: win, url, loaded: win.loadURL(url) };
}

/* Закрывает сеть и разрешения и у сессии по умолчанию, в которой игр нет. */
async function lockDefaultSession() {
  await lockSession(session.defaultSession, '', () => {});
}

module.exports = { SCHEME, CSP, registerSchemes, hardenApp, openGame, lockDefaultSession, isOwnUrl };
