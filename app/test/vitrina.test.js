'use strict';
/* В2: запреты стиля в CSS витрины. В9 (модульная часть): IPC витрины принимает только свои каналы и свои id.
   Каталог: группы по полю grades, плохие файлы не попадают на витрину. */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { CHANNELS, createApi } = require('../desktop/vitrina/api');
const { groupsOf, loadCatalog } = require('../desktop/vitrina/catalog');
const { createStore } = require('../desktop/vitrina/store');
const { keygen, pack } = require('../kibpack/pack');

const UI = path.join(__dirname, '..', 'desktop', 'vitrina', 'ui');
const css = fs.readFileSync(path.join(UI, 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(UI, 'app.js'), 'utf8');

// В2
test('В2: градиент только у штриховки заглушки', () => {
  const gradients = css.match(/[a-z-]*gradient\([^;]*\)/g) || [];
  assert.deepEqual(gradients, ['repeating-linear-gradient(45deg, #E2E5E8 0 10px, #F0F2F3 10px 20px)']);
});
test('В2: нет blur и backdrop-filter', () => {
  assert.doesNotMatch(css, /blur|backdrop-filter/i);
  assert.doesNotMatch(appJs, /blur\(|backdropFilter|backdrop-filter/);
});
test('В2: border-radius только 0', () => {
  for (const m of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) assert.match(m[1].trim(), /^0(px)?$/, m[0]);
  assert.doesNotMatch(appJs, /borderRadius|border-radius/);
});
test('В2: тени без размытия: у box-shadow не больше трёх длин или третья равна 0', () => {
  const shadows = [...css.matchAll(/box-shadow\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(shadows.length > 5);
  for (const value of shadows) {
    for (const one of value.split(/,(?![^(]*\))/)) {
      const lengths = one.match(/-?\d+(\.\d+)?px|\b0\b/g) || [];
      assert.ok(lengths.length <= 3 || /^0(px)?$/.test(lengths[2]), `тень с размытием: ${one}`);
      if (lengths.length === 3) assert.match(lengths[2], /^0(px)?$/, `тень с размытием: ${one}`);
    }
  }
});
test('В2: нет внешних адресов в интерфейсе, шрифты свои', () => {
  // Имя пространства SVG похоже на адрес, но запросом не является
  for (const text of [css, html, appJs.replace("'http://www.w3.org/2000/svg'", '')]) assert.doesNotMatch(text, /https?:\/\/|\/\/fonts\.|@import/);
  const fonts = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(fonts.length === 4 && fonts.every((f) => f.startsWith('fonts/') && fs.existsSync(path.join(UI, f))), fonts.join());
  assert.ok(fs.existsSync(path.join(UI, 'fonts', 'OFL-golos-text.txt')) && fs.existsSync(path.join(UI, 'fonts', 'OFL-jetbrains-mono.txt')));
});
test('В2/К23: в коде окна нет innerHTML, insertAdjacentHTML, document.write, eval и inline-обработчиков в разметке', () => {
  const code = appJs.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(html, /\son[a-z]+=|<script>[^<]|style=/i);
  assert.equal(appJs.split('/*K23*/el.textContent').length - 1, 1, 'метка для контрольного прогона К23');
});
test('В12: анимации учитывают prefers-reduced-motion', () => {
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(appJs, /prefers-reduced-motion: reduce/);
});

// Группы
test('группы из поля grades', () => {
  assert.deepEqual(groupsOf('4–5 класс'), ['middle']);
  assert.deepEqual(groupsOf('дошкольники и 1 класс'), ['junior']);
  assert.deepEqual(groupsOf('1–11 класс'), ['junior', 'middle', 'senior']);
  assert.deepEqual(groupsOf('7–9 класс'), ['senior']);
  assert.deepEqual(groupsOf('3–4 класс'), ['junior', 'middle']);
  assert.deepEqual(groupsOf('12–14 лет'), ['senior']);
  assert.deepEqual(groupsOf('для всех'), []);
});

// IPC
function fakeApi() {
  const catalog = { games: [
    { id: 'tri-rezhima', title: 'Три', state: 'ready', groups: [], cover: null, multiMode: true, file: '/secret/path.kibgames', keyId: 'k',
      modes: [{ id: 'training', title: 'Т', about: '', cover: null }, { id: 'exam', title: 'Э', about: '', cover: null }] },
    { id: 'chuzhaya', title: 'Чужая', state: 'untrusted', groups: [], cover: null, multiMode: false, file: '/x', keyId: 'z',
      modes: [{ id: 'default', title: 'Чужая', about: '', cover: null }] },
  ], skipped: [], covers: new Map(), missing: false };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vapi-'));
  const launched = [];
  const api = createApi({ getCatalog: () => catalog, store: createStore(dir), played: new Set(),
    launch: async (g, m) => { launched.push(`${g.id}/${m.id}`); return { ok: true }; } });
  return { api, launched, dir };
}

test('В9: ровно три канала и событие, без server.setAddress на этапе В0', () => {
  assert.deepEqual([...CHANNELS], ['catalog.list', 'game.launch', 'vote.send']);
  assert.deepEqual(Object.keys(fakeApi().api).sort(), [...CHANNELS].sort());
});

test('В9: чужой id игры и режима, пути, объекты и лишние аргументы отклоняются', async () => {
  const { api, launched } = fakeApi();
  for (const args of [['nope', 'training'], ['../x', 'training'], [{ id: 'tri-rezhima' }, 'training'], ['tri-rezhima', 'nope'],
    ['tri-rezhima', '../../custom.html'], ['tri-rezhima'], ['tri-rezhima', 'training', 'x'], ['constructor', 'default'], ['__proto__', 'default']]) {
    await assert.rejects(api['game.launch'](...args), Error, JSON.stringify(args));
  }
  assert.deepEqual(launched, []);
  assert.throws(() => api['catalog.list']('/etc'), /без аргументов|аргументов/);
});

test('В9: игра автора не из списка школы не запускается из витрины', async () => {
  const { api, launched } = fakeApi();
  assert.deepEqual(await api['game.launch']('chuzhaya', 'default'), { ok: false, reason: 'untrusted' });
  assert.deepEqual(launched, []);
});

test('В9: оценка только после запуска режима, только 1–5, повтор в тот же день отклонён', async () => {
  const { api, dir } = fakeApi();
  assert.deepEqual(api['vote.send']('tri-rezhima', 'training', 5), { ok: false, reason: 'not-played' });
  assert.deepEqual(await api['game.launch']('tri-rezhima', 'training'), { ok: true });
  for (const v of [0, 6, 2.5, '5', null]) assert.throws(() => api['vote.send']('tri-rezhima', 'training', v), /от 1 до 5/);
  const first = api['vote.send']('tri-rezhima', 'training', 5);
  assert.equal(first.ok, true);
  assert.equal(first.game.modes[0].rating.n, 1);
  assert.equal(first.game.modes[0].votedToday, true);
  assert.deepEqual(api['vote.send']('tri-rezhima', 'training', 4), { ok: false, reason: 'already' });
  assert.deepEqual(api['vote.send']('tri-rezhima', 'exam', 4), { ok: false, reason: 'not-played' });
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'ratings.json'), 'utf8'));
  assert.deepEqual(saved.games['tri-rezhima'].training, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 });
});

test('В9: окно не получает путей к файлам и ключей', () => {
  const { api } = fakeApi();
  const text = JSON.stringify(api['catalog.list']());
  assert.doesNotMatch(text, /secret|kibgames|keyId|"file"/);
});

test('каталог: битый файл и чужой автор видны как пропуск и состояние, а не как готовая игра', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vcat-'));
  const key = keygen('c', path.join(tmp, 'keys')).keyPath;
  const dir = path.join(tmp, 'games');
  fs.mkdirSync(dir);
  const { target } = await pack(path.join(__dirname, '..', 'testgames', 'tri-rezhima'), { key, out: path.join(dir, 'a.kibgames') });
  fs.copyFileSync(target, path.join(dir, 'b-dubl.kibgames'));
  fs.writeFileSync(path.join(dir, 'c-bitaya.kibgames'), 'не игра');
  const plain = await loadCatalog(dir, { appVersion: '1.0.0' });
  assert.equal(plain.games.length, 1);
  assert.equal(plain.games[0].state, 'untrusted');
  assert.equal(plain.skipped.length, 2);
  assert.deepEqual(plain.games[0].modes.map((m) => m.id), ['training', 'timed', 'custom']);
  assert.equal(plain.covers.size, 3);
  assert.equal(plain.games[0].modes[2].cover, plain.games[0].cover, 'режим без обложки берёт обложку игры');
  const old = await loadCatalog(dir, { appVersion: '0.9.0', trustedKeys: { [plain.games[0].keyId]: 'Тест' } });
  assert.equal(old.games[0].state, 'update');
  assert.equal((await loadCatalog(path.join(tmp, 'nет'), { appVersion: '1.0.0' })).missing, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('ratings.json и state.json с BOM (Блокнот, PowerShell 5) читаются', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vbom-'));
  fs.writeFileSync(path.join(dir, 'ratings.json'), '﻿{"format":1,"games":{"a":{"default":{"5":7}}}}');
  const today = require('../shared/ratings').localDay(new Date());
  fs.writeFileSync(path.join(dir, 'state.json'), `﻿{"votedOn":"${today}","voted":["a/default"]}`);
  const store = createStore(dir);
  assert.equal(store.ratings().games.a.default['5'], 7);
  assert.deepEqual(store.day().voted, ['a/default']);
});

test('испорченный ratings.json откладывается в сторону, а не затирается', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vbad-'));
  fs.writeFileSync(path.join(dir, 'ratings.json'), '{"format":1,"games":{"a":{"m":{"9":1}}}}');
  const store = createStore(dir);
  assert.deepEqual(store.ratings(), { format: 1, games: {} });
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('ratings.json.bad-')));
});
