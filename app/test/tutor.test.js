'use strict';
/* Этап М1. Т16 (автоматическая часть): запреты стиля в CSS окна тьютора, как В2.
   Т12 (модульная часть): IPC окна тьютора принимает только свои каналы и аргументы, путей к файлам не отдаёт. */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { CHANNELS, createTutorApi, ApiError } = require('../desktop/tutor/api');
const { createSchoolKey } = require('../desktop/tutor/school-key');
const { createLibrary } = require('../desktop/tutor/library');
const R = require('../shared/ratings');
const { keygen, pack } = require('../kibpack/pack');

const UI = path.join(__dirname, '..', 'desktop', 'tutor', 'ui');
const FONTS = path.join(__dirname, '..', 'desktop', 'vitrina', 'ui', 'fonts');
const css = fs.readFileSync(path.join(UI, 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(UI, 'app.js'), 'utf8');

test('Т16: нет градиентов, blur и backdrop-filter', () => {
  assert.doesNotMatch(css, /gradient|blur|backdrop-filter/i);
  assert.doesNotMatch(appJs, /gradient|blur\(|backdropFilter|backdrop-filter/);
});
test('Т16: border-radius только 0', () => {
  for (const m of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) assert.match(m[1].trim(), /^0(px)?$/, m[0]);
  assert.doesNotMatch(appJs, /borderRadius|border-radius/);
});
test('Т16: тени без размытия', () => {
  const shadows = [...css.matchAll(/box-shadow\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(shadows.length > 4);
  for (const value of shadows) {
    for (const one of value.split(/,(?![^(]*\))/)) {
      const lengths = one.match(/-?\d+(\.\d+)?px|\b0\b/g) || [];
      if (lengths.length >= 3) assert.match(lengths[2], /^0(px)?$/, `тень с размытием: ${one}`);
    }
  }
});
test('Т16: акцент #FF5B14 только у полосы «ТЬЮТОР», знака K1 и рамки фокуса', () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /var\(--accent\)|#FF5B14/i.test(m[2])).map((m) => m[1].trim());
  for (const selector of rules) assert.match(selector, /^(:root|\.stripe|\.k1-mark|[^{]*focus-visible[^{]*)$/, selector);
});
test('Т16: нет внешних адресов, шрифты — файлы витрины', () => {
  for (const text of [css, html, appJs.replace("'http://www.w3.org/2000/svg'", '')]) assert.doesNotMatch(text, /https?:\/\/|\/\/fonts\.|@import/);
  const fonts = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(fonts.length === 4 && fonts.every((f) => f.startsWith('fonts/') && fs.existsSync(path.join(FONTS, f.slice(6)))), fonts.join());
});
test('К24: в коде окна нет innerHTML, document.write, eval и inline-обработчиков', () => {
  const code = appJs.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(html, /\son[a-z]+=|<script>[^<]|style=/i);
  assert.equal(appJs.split('/*K24*/el.textContent').length - 1, 1, 'метка для контрольного прогона К24');
  assert.match(css, /prefers-reduced-motion: reduce/);
});

/* ---------- IPC без Electron ---------- */

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASSWORD = 'длинный-пароль-1';
let tmp;
let gameFile;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kibtapi-'));
  const key = keygen('t', path.join(tmp, 'keys')).keyPath;
  gameFile = path.join(tmp, 'tri.kibgames');
  await pack(path.join(__dirname, '..', 'testgames', 'tri-rezhima'), { key, out: gameFile });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function setup() {
  const dir = fs.mkdtempSync(path.join(tmp, 'data-'));
  const key = createSchoolKey(dir, { kdf: FAST });
  let lib = null;
  const getLibrary = () => { if (!lib) lib = createLibrary(dir, { key, appVersion: '1.1.0' }); return lib; };
  const opened = [];
  const api = createTutorApi({
    key, getLibrary, ratings: () => R.emptyRatings(), today: () => '2026-11-03',
    dialogs: { pickGame: async () => { opened.push('pick'); return gameFile; }, pickBackupDir: async () => path.join(tmp), pickRestoreDir: async () => null, saveSchoolFile: async () => true },
    tryGame: async () => { opened.push('try'); },
    onSchool: () => { lib = null; },
  });
  return { dir, api, opened };
}

test('Т12: каналы — ровно список, у каждого есть обработчик', () => {
  const { api } = setup();
  assert.deepEqual(Object.keys(api).sort(), [...CHANNELS].sort());
});

test('Т12: лишние и неверные аргументы отклоняются, пути не принимаются', async () => {
  const { api } = setup();
  await api['school.create']('Школа', PASSWORD, PASSWORD);
  const bad = [
    ['state.get', '/etc'], ['game.pick', '/etc/passwd'], ['school.backup', 'C:\\Users'], ['school.unlock', { p: 1 }],
    ['game.try', 'file', '/etc/passwd', 'default'], ['game.try', 'catalog', '../x', 'default'], ['game.try', 'pending', 'x', 'default'],
    ['game.publish', '../../x', true, true, ''], ['game.publish', '0'.repeat(32), 1, true, ''], ['game.lesson', 'tri-rezhima', 'true'],
    ['game.unpublish', '..'], ['school.recover', 'a', 'b'],
  ];
  for (const [channel, ...args] of bad) {
    await assert.rejects(async () => api[channel](...args), ApiError, `${channel} ${JSON.stringify(args)}`);
  }
});

test('Т12: без входа действия с ключом отклонены, окно выбора файла не открывается; после входа работают', async () => {
  const { api, opened } = setup();
  await api['school.create']('Школа', PASSWORD, PASSWORD);
  await api['school.lock']();
  for (const [channel, ...args] of [['game.pick'], ['school.backup'], ['game.lesson', 'tri-rezhima', true], ['game.unpublish', 'tri-rezhima']]) {
    const r = await api[channel](...args);
    assert.equal(r.ok, false, channel);
    assert.match(r.error, /закрыт/, channel);
  }
  assert.deepEqual(opened, []);
  assert.equal((await api['school.unlock'](PASSWORD)).ok, true);
  const picked = await api['game.pick']();
  assert.equal(picked.ok, true);
  assert.equal(picked.game.sha256, undefined);
  const text = JSON.stringify(picked);
  assert.ok(!text.includes(tmp), 'путь к файлу ушёл в окно');
  const r = await api['game.publish'](picked.game.token, true, false, '');
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r.state).includes(tmp));
  assert.deepEqual(r.state.games.map((g) => g.id), ['tri-rezhima']);
  assert.equal((await api['game.try']('catalog', 'tri-rezhima', 'custom')).ok, true);
  assert.equal((await api['game.try']('catalog', 'tri-rezhima', 'exam')).ok, true); // режим проверяет песочница
});

test('Т12: ошибки окну по-русски, без текста библиотек', async () => {
  const { api } = setup();
  const r = await api['school.unlock'](PASSWORD);
  assert.equal(r.ok, false);
  assert.match(r.error, /Школа ещё не создана/);
  await api['school.create']('Школа', PASSWORD, PASSWORD);
  const weak = await api['school.recover']('x', '123', '123');
  assert.match(weak.error, /не меньше 10 знаков/);
});
