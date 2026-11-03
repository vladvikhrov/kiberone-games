'use strict';
/* Окно витрины (ADR-0002, 4.1; ADR-0003, 5.3): своя схема kibapp://, своя сессия в памяти, без Node и сети.
   Тексты каталога пишутся чужими авторами, поэтому окно не выполняет разметку: CSP без inline-скриптов
   и Trusted Types, при которых присваивание строки в innerHTML падает с ошибкой. */
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

const SCHEME = 'kibapp';
const START_URL = `${SCHEME}://app/index.html`;
const PARTITION = 'kibapp-vitrina'; // без persist: только память

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

/* Файлы интерфейса читаются один раз при старте в память. Окно не может попросить ничего, кроме этого списка. */
function loadUi(dir = path.join(__dirname, 'ui')) {
  const files = new Map();
  const walk = (d, prefix) => {
    for (const item of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) walk(path.join(d, item.name), rel);
      else {
        const ext = item.name.slice(item.name.lastIndexOf('.') + 1);
        if (UI_MIME[ext]) files.set(rel, { data: fs.readFileSync(path.join(d, item.name)), mime: UI_MIME[ext] });
      }
    }
  };
  walk(dir, '');
  return files;
}

/* ui: Map путь -> { data, mime }. covers: () => Map sha256 -> { data, mime }. csp: null только в контрольном прогоне теста. */
function serveVitrina(ses, { ui, covers, csp = CSP }) {
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
      file = covers().get(url.pathname.slice(1)) || null;
    }
    if (!file) return notFound();
    return new Response(file.data, { status: 200, headers: { ...headers, 'Content-Type': file.mime } });
  });
}

const isVitrinaUrl = (url) => /^kibapp:\/\/(app|cover)\//.test(url);

/* Сеть и разрешения сессии витрины закрыты так же, как у игр. */
async function lockVitrinaSession(ses, log = () => {}) {
  ses.setSpellCheckerEnabled(false);
  ses.setPermissionRequestHandler((_c, permission, callback) => { log('permission', permission); callback(false); });
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (event, item) => { log('download', item.getFilename()); event.preventDefault(); });
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isVitrinaUrl(details.url);
    log(allowed ? 'request' : 'network', details.url.slice(0, 200));
    callback({ cancel: !allowed });
  });
  await ses.setProxy({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:9', proxyBypassRules: '<-loopback>' });
}

function createVitrinaWindow({ ses, show = true, width = 1366, height = 768, log = () => {}, allowInsecure = false }) {
  const win = new BrowserWindow({
    show: false, title: 'K1 Игры', backgroundColor: '#D6D9DC', autoHideMenuBar: true,
    width, height, minWidth: 720, minHeight: 540, useContentSize: true,
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'preload.js'),
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
  // Окно витрины никуда не переходит: единственная страница загружается из основного процесса
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

module.exports = { SCHEME, START_URL, PARTITION, CSP, loadUi, serveVitrina, lockVitrinaSession, createVitrinaWindow, isVitrinaUrl };
