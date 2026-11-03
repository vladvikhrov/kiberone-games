'use strict';
/* Окно программы тьютора: та же модель защиты, что у витрины (ADR-0002, 4.1; ADR-0003, 5.3).
   Своя схема kibtutor://, сессия только в памяти, без Node и сети. Окно показывает названия и имена из чужих .kibgames,
   поэтому CSP без inline-скриптов и с Trusted Types: строка в innerHTML падает с ошибкой. */
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

const SCHEME = 'kibtutor';
const START_URL = `${SCHEME}://app/index.html`;
const PARTITION = 'kibtutor-panel'; // без persist: только память

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  `img-src ${SCHEME}:`,
  "font-src 'self'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types 'none'",
].join('; ');

const UI_MIME = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  woff2: 'font/woff2', txt: 'text/plain; charset=utf-8',
};

/* Файлы интерфейса читаются один раз в память. Шрифты — те же файлы, что у витрины ученика. */
function loadUi(dir = path.join(__dirname, 'ui'), fontsDir = path.join(__dirname, '..', 'vitrina', 'ui', 'fonts')) {
  const files = new Map();
  const add = (d, prefix) => {
    for (const item of fs.readdirSync(d, { withFileTypes: true })) {
      const ext = item.name.slice(item.name.lastIndexOf('.') + 1);
      if (item.isFile() && UI_MIME[ext]) files.set(`${prefix}${item.name}`, { data: fs.readFileSync(path.join(d, item.name)), mime: UI_MIME[ext] });
    }
  };
  add(dir, '');
  add(fontsDir, 'fonts/');
  return files;
}

/* ui: Map путь -> { data, mime }. cover: (hex) => { data, mime } | null. csp: null только в контрольном прогоне теста. */
function serveTutor(ses, { ui, cover, csp = CSP }) {
  if (ses.protocol.isProtocolHandled(SCHEME)) ses.protocol.unhandle(SCHEME);
  ses.protocol.handle(SCHEME, (request) => {
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...(csp ? { 'Content-Security-Policy': csp } : {}) };
    const notFound = () => new Response('Not found', { status: 404, headers });
    if (request.method !== 'GET') return notFound();
    let url;
    try { url = new URL(request.url); } catch { return notFound(); }
    let file = null;
    if (url.host === 'app') {
      let name;
      try { name = decodeURIComponent(url.pathname.slice(1)); } catch { return notFound(); }
      file = ui.get(name) || null;
    } else if (url.host === 'cover' && /^\/[0-9a-f]{64}$/.test(url.pathname)) {
      file = cover(url.pathname.slice(1));
    }
    if (!file) return notFound();
    return new Response(file.data, { status: 200, headers: { ...headers, 'Content-Type': file.mime } });
  });
}

const isTutorUrl = (url) => /^kibtutor:\/\/(app|cover)\//.test(url);

async function lockTutorSession(ses, log = () => {}) {
  ses.setSpellCheckerEnabled(false);
  ses.setPermissionRequestHandler((_c, permission, callback) => { log('permission', permission); callback(false); });
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (event, item) => { log('download', item.getFilename()); event.preventDefault(); });
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isTutorUrl(details.url);
    log(allowed ? 'request' : 'network', details.url.slice(0, 200));
    callback({ cancel: !allowed });
  });
  await ses.setProxy({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:9', proxyBypassRules: '<-loopback>' });
}

function createTutorWindow({ ses, preload = path.join(__dirname, 'preload.js'), show = true, width = 1366, height = 768, log = () => {}, allowInsecure = false }) {
  const win = new BrowserWindow({
    show: false, title: 'KIBERone Сервер', backgroundColor: '#D6D9DC', autoHideMenuBar: true,
    width, height, minWidth: 900, minHeight: 600, useContentSize: true,
    webPreferences: {
      session: ses,
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: allowInsecure, // true только в контрольном прогоне теста
      webviewTag: false,
      spellcheck: false,
      navigateOnDragDrop: false,
      devTools: false,
      safeDialogs: true,
    },
  });
  win.setMenu(null);
  const contents = win.webContents;
  const stay = (event) => { log('navigation', String(event.url).slice(0, 200)); event.preventDefault(); };
  contents.on('will-navigate', stay);
  contents.on('will-frame-navigate', (event) => { if (!event.isMainFrame || event.url !== START_URL) stay(event); });
  contents.on('will-redirect', stay);
  contents.setWindowOpenHandler(({ url }) => { log('window', String(url).slice(0, 200)); return { action: 'deny' }; });
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  contents.on('page-title-updated', (event) => event.preventDefault());
  if (show) win.once('ready-to-show', () => { win.maximize(); win.show(); });
  return win;
}

module.exports = { SCHEME, START_URL, PARTITION, CSP, loadUi, serveTutor, lockTutorSession, createTutorWindow, isTutorUrl };
