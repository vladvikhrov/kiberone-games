'use strict';
/* Этап М2: каталог витрины по сети на настроенном ноутбуке. К15, К16, С3–С6 на уровне логики:
   сеть подменена поддельным сервером в памяти, а каталоги и игры настоящие (программа тьютора, kibpack).
   Те же атаки по настоящей сети в двух сетевых пространствах — в тесте-«взломщике». */
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { keygen, pack } = require('../kibpack/pack');
const { signCatalog } = require('../desktop/tutor/catalog-sign');
const { createNetSource } = require('../desktop/vitrina/net-source');
const { NetError } = require('../desktop/school-net');
const { makeSchool } = require('../redteam/school-fixture');

const APP = path.join(__dirname, '..');
const SERVER = '192.168.5.10';
const SUBNET = /^192\.168\.5\.\d+$/;
let tmp;
const games = {};
const hex = (d) => crypto.createHash('sha256').update(d).digest('hex');

async function packGame(name, meta, keyName = 'avtor') {
  const dir = path.join(tmp, `src-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'kibgame.json'), JSON.stringify({ id: name, version: '1.0.0', title: `Игра ${name}`, description: 'Проверка', authors: ['Автор'],
    grades: '4–5 класс', minutes: 30, topic: 'Тест', minAppVersion: '1.0.0', entry: 'index.html', ...meta }));
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><title>${name}</title><p>${crypto.randomBytes(400).toString('hex')}</p>`);
  const out = path.join(tmp, `${name}-${meta.version || '1.0.0'}.kibgames`);
  await pack(dir, { key: path.join(tmp, 'keys', `${keyName}.key.pem`), out });
  return out;
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kibnet-'));
  for (const k of ['avtor', 'chuzhoy']) keygen(k, path.join(tmp, 'keys'));
  games.tri = path.join(tmp, 'tri.kibgames');
  await pack(path.join(APP, 'testgames', 'tri-rezhima'), { key: path.join(tmp, 'keys', 'avtor.key.pem'), out: games.tri });
  games.alpha = await packGame('alpha', {});
  games.alpha2 = await packGame('alpha', { version: '2.0.0' });
  games.beta = await packGame('beta', {}, 'chuzhoy');
  games.future = await packGame('future', { minAppVersion: '9.0.0' });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/* Поддельный сервер в памяти. routes: ip -> (path) => { status, body } | NetError. Записывает порядок запросов. */
function fakeNet(routes, { discoverable = Object.keys(routes) } = {}) {
  const requests = [];
  let stopped = false;
  const net = {
    requests,
    stopCalls: 0,
    checkHost(ip) {
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) throw new NetError('Это не адрес IPv4', 'not-ip');
      if (!SUBNET.test(ip)) throw new NetError(`Адрес ${ip} не из школьной сети`, 'not-subnet');
    },
    async get(ip, p, { maxBytes, etag, file, onProgress = () => {} }) {
      if (stopped) throw new NetError('Сеть остановлена', 'stopped');
      net.checkHost(ip);
      requests.push(`${ip} ${p}`);
      const route = routes[ip];
      if (!route) throw new NetError('нет ответа', 'io');
      const r = await route(p, { etag });
      if (r instanceof Error) throw r;
      if (r.status === 304) return { status: 304 };
      if (r.status !== 200) throw new NetError(`Сервер ответил ${r.status}`, 'status');
      if (r.body.length > maxBytes) throw new NetError(`Ответ больше ${maxBytes} байт`, 'too-big');
      onProgress(r.body.length);
      if (file) fs.writeFileSync(file, r.body, { flag: 'wx' });
      return { status: 200, body: file ? undefined : r.body, sha256: hex(r.body), bytes: r.body.length };
    },
    async discover() { return stopped ? [] : discoverable.filter((ip) => routes[ip]); },
    stop() { stopped = true; net.stopCalls += 1; },
    resume() { stopped = false; },
  };
  return net;
}

/* Настоящий сервер тьютора в памяти: каталог и файлы из папки тьютора. overrides: { путь: функция }. */
function tutorRoute(t, overrides = {}) {
  return (p, { etag } = {}) => {
    if (overrides[p]) return overrides[p](p);
    if (p === '/v1/catalog') {
      if (etag === `"${t.lib.seq()}"`) return { status: 304 };
      return { status: 200, body: fs.readFileSync(t.lib.catalogPath) };
    }
    const m = /^\/v1\/blobs\/sha256\/([0-9a-f]{64})$/.exec(p);
    if (m && fs.existsSync(path.join(t.lib.blobsDir, m[1]))) return { status: 200, body: fs.readFileSync(path.join(t.lib.blobsDir, m[1])) };
    return { status: 404 };
  };
}

let clock = 1_800_000_000_000;
function source(t, net, dir, extra = {}) {
  const now = () => clock;
  const s = createNetSource({ school: t.school, net, dir, appVersion: '1.1.0', now, options: { pollMs: 1e9, retryMs: [1e9], askAfterMs: 15000 }, ...extra });
  s.load();
  return s;
}
const titles = (s) => s.games().map((g) => g.id).sort();
const stateOf = (s, id) => s.games().find((g) => g.id === id).state;

test('С3, С4: каталог и файлы по сети; порядок — обложки игр, обложки режимов, игры; повторный запуск ничего не качает, каталог 304', async () => {
  const t = await makeSchool(path.join(tmp, 't1'), { games: [games.tri, games.alpha] });
  const net = fakeNet({ [SERVER]: tutorRoute(t) });
  const dir = path.join(tmp, 's1');
  const s = source(t, net, dir);
  await s.cycle();
  assert.deepEqual(titles(s), ['alpha', 'tri-rezhima']);
  assert.ok(s.games().every((g) => g.state === 'ready'), JSON.stringify(s.games().map((g) => g.state)));
  const tri = t.lib.games().find((g) => g.id === 'tri-rezhima');
  const order = net.requests.map((r) => r.split(' ')[1]);
  assert.equal(order[0], '/v1/catalog');
  const pos = (h) => order.indexOf(`/v1/blobs/sha256/${h}`);
  const modeCovers = tri.modes.filter((m) => m.cover && m.cover.sha256 !== tri.cover.sha256).map((m) => pos(m.cover.sha256));
  const gameFiles = t.lib.games().map((g) => pos(g.sha256));
  assert.ok(pos(tri.cover.sha256) > 0 && modeCovers.every((x) => x > pos(tri.cover.sha256)), order.join('\n'));
  assert.ok(gameFiles.every((x) => x > Math.max(...modeCovers)), order.join('\n'));
  assert.equal(s.view().server, SERVER);
  assert.equal(s.view().online, true);
  const pkg = await s.gamePackage(s.games().find((g) => g.id === 'alpha'));
  assert.equal(pkg.manifest.id, 'alpha');
  s.close();

  const net2 = fakeNet({ [SERVER]: tutorRoute(t) });
  const s2 = source(t, net2, dir);
  assert.deepEqual(titles(s2), ['alpha', 'tri-rezhima'], 'каталог из кеша виден до связи');
  await s2.cycle();
  assert.deepEqual(net2.requests, [`${SERVER} /v1/catalog`], 'только запрос каталога, ответ 304');
  s2.close();
});

test('С3: снятая игра и её обложки удаляются из кеша при новом каталоге', async () => {
  const t = await makeSchool(path.join(tmp, 't2'), { games: [games.tri, games.alpha] });
  const net = fakeNet({ [SERVER]: tutorRoute(t) });
  const dir = path.join(tmp, 's2');
  const s = source(t, net, dir);
  await s.cycle();
  const tri = t.lib.games().find((g) => g.id === 'tri-rezhima');
  await t.lib.unpublish('tri-rezhima');
  await s.cycle();
  assert.deepEqual(titles(s), ['alpha']);
  const left = fs.readdirSync(path.join(dir, 'cache'));
  assert.ok(!left.includes(tri.sha256) && !left.includes(tri.cover.sha256), left.join(','));
  assert.ok(left.includes(t.lib.games()[0].sha256));
  s.close();
});

test('К15: подделка каталога не меняет витрину — без подписи, чужая школа, изменённый байт, старый и равный seq; контроль: верный принят', async () => {
  const t = await makeSchool(path.join(tmp, 't3'), { games: [games.alpha] });
  const other = await makeSchool(path.join(tmp, 't3-other'), { games: [games.alpha, games.beta], name: 'Чужая школа' });
  const dir = path.join(tmp, 's3');
  const good = fs.readFileSync(t.lib.catalogPath);
  let current = good;
  const net = fakeNet({ [SERVER]: (p) => (p === '/v1/catalog' ? { status: 200, body: current } : tutorRoute(t)(p)) });
  const s = source(t, net, dir);
  await s.cycle();
  assert.deepEqual(titles(s), ['alpha'], 'контроль: верный каталог принят');
  const oldSeq = t.lib.seq();

  const outer = JSON.parse(good);
  const payload = JSON.parse(Buffer.from(outer.payload, 'base64'));
  const forged = { ...payload, seq: payload.seq + 100, games: [...payload.games, { ...payload.games[0], id: 'vzlom', title: 'Подделка' }] };
  const flipped = Buffer.from(good);
  flipped[Math.floor(flipped.length / 2)] ^= 1;
  await t.lib.setLesson('alpha', true); // настоящий новый каталог
  const newer = fs.readFileSync(t.lib.catalogPath);
  const fakes = {
    'без подписи': Buffer.from(JSON.stringify({ payload: Buffer.from(JSON.stringify(forged)).toString('base64'), sig: outer.sig })),
    'чужая школа': fs.readFileSync(other.lib.catalogPath),
    'чужая школа, подделанный отпечаток': Buffer.from(signCatalog({ ...forged, school: t.school.fingerprint }, other.key.sign)),
    'изменённый байт': flipped,
    'не JSON': Buffer.from('<html>это не каталог</html>'),
  };
  for (const [name, body] of Object.entries(fakes)) {
    current = body;
    await s.cycle();
    assert.deepEqual(titles(s), ['alpha'], name);
  }
  current = newer;
  await s.cycle();
  assert.equal(s.games()[0].lesson, true, 'контроль: настоящий новый каталог принят');
  current = good; // откат на старый подписанный каталог
  await s.cycle();
  assert.equal(s.games()[0].lesson, true, 'старый seq отвергнут');
  assert.ok(s.view().log.some((l) => /старее/.test(l)), s.view().log.join('\n'));
  assert.ok(oldSeq < t.lib.seq());
  s.close();
});

test('К15, С5: seq хранится — после перезапуска старый подписанный каталог не принимается', async () => {
  const t = await makeSchool(path.join(tmp, 't4'), { games: [games.alpha] });
  const old = fs.readFileSync(t.lib.catalogPath);
  await t.lib.setLesson('alpha', true);
  const dir = path.join(tmp, 's4');
  const s = source(t, fakeNet({ [SERVER]: tutorRoute(t) }), dir);
  await s.cycle();
  s.close();
  fs.rmSync(path.join(dir, 'catalog.json')); // ученик удалил кеш каталога, номер остался в state.json
  const s2 = source(t, fakeNet({ [SERVER]: (p) => (p === '/v1/catalog' ? { status: 200, body: old } : tutorRoute(t)(p)) }), dir);
  await s2.cycle();
  assert.deepEqual(titles(s2), [], 'старый каталог не принят');
  s2.close();
});

test('К15, С1: из нескольких ответивших берётся наибольший seq, подделка с чужим ключом не выигрывает', async () => {
  const t = await makeSchool(path.join(tmp, 't5'), { games: [games.alpha] });
  const old = fs.readFileSync(t.lib.catalogPath);
  await t.lib.setLesson('alpha', true);
  const other = await makeSchool(path.join(tmp, 't5-other'), { games: [games.beta] });
  const payload = JSON.parse(Buffer.from(JSON.parse(fs.readFileSync(other.lib.catalogPath)).payload, 'base64'));
  const evil = Buffer.from(signCatalog({ ...payload, school: t.school.fingerprint, seq: payload.seq + 1e6 }, other.key.sign));
  const net = fakeNet({
    '192.168.5.66': (p) => (p === '/v1/catalog' ? { status: 200, body: evil } : { status: 404 }),
    '192.168.5.20': (p) => (p === '/v1/catalog' ? { status: 200, body: old } : tutorRoute(t)(p)),
    [SERVER]: tutorRoute(t),
  });
  const s = source(t, net, path.join(tmp, 's5'));
  await s.cycle();
  assert.deepEqual(titles(s), ['alpha']);
  assert.equal(s.games()[0].lesson, true);
  assert.equal(s.view().server, SERVER);
  s.close();
});

test('К16: подмена файла не попадает в кеш — другой файл, чужая игра, старая версия, больше объявленного, обрыв, зависание; после 3 неудач «не скачалась»', async () => {
  const t = await makeSchool(path.join(tmp, 't6'), { games: [games.alpha2, games.tri] });
  const g = t.lib.games().find((x) => x.id === 'alpha');
  const tri = t.lib.games().find((x) => x.id === 'tri-rezhima');
  const blobPath = `/v1/blobs/sha256/${g.sha256}`;
  const subs = {
    'другой файл': () => ({ status: 200, body: crypto.randomBytes(g.bytes) }),
    'чужая подписанная игра': () => ({ status: 200, body: fs.readFileSync(games.beta) }),
    'старая версия той же игры': () => ({ status: 200, body: fs.readFileSync(games.alpha) }),
    'больше объявленного': () => ({ status: 200, body: Buffer.concat([fs.readFileSync(path.join(t.lib.blobsDir, g.sha256)), Buffer.alloc(10)]) }),
    'обложка вместо игры': () => ({ status: 200, body: fs.readFileSync(path.join(t.lib.blobsDir, tri.cover.sha256)) }),
  };
  for (const [name, sub] of Object.entries(subs)) {
    const dir = path.join(tmp, `s6-${crypto.randomBytes(3).toString('hex')}`);
    const net = fakeNet({ [SERVER]: tutorRoute(t, { [blobPath]: sub }) });
    const s = source(t, net, dir);
    for (let i = 0; i < 4; i += 1) await s.cycle(); // при обрыве цикл заканчивается, другая игра скачается в следующем
    assert.equal(stateOf(s, 'alpha'), 'failed', name);
    assert.ok(!fs.readdirSync(path.join(dir, 'cache')).includes(g.sha256), `${name}: в кеше`);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'cache')).filter((n) => n.includes('.')), [], `${name}: недокачанные и временные файлы`);
    await assert.rejects(s.gamePackage(s.games().find((x) => x.id === 'alpha')), name);
    assert.equal(stateOf(s, 'tri-rezhima'), 'ready', `${name}: другая игра скачалась`);
    s.close();
  }
  // М3: обрыв и молчание — это связь, а не подделка: «не скачалась» не ставится, игра ждёт повтора
  for (const [name, err] of [['обрыв', 'aborted'], ['зависание', 'idle'], ['сервер занят', 'busy']]) {
    const dir = path.join(tmp, `s6-${crypto.randomBytes(3).toString('hex')}`);
    const net = fakeNet({ [SERVER]: tutorRoute(t, { [blobPath]: () => new NetError(name, err) }) });
    const s = source(t, net, dir);
    for (let i = 0; i < 6; i += 1) await s.cycle();
    assert.notEqual(stateOf(s, 'alpha'), 'failed', name);
    assert.ok(net.requests.filter((r) => r.endsWith(blobPath)).length >= 6, `${name}: повторы продолжаются`);
    s.close();
  }
  // Подменённая обложка не показывается
  const dir = path.join(tmp, 's6-cover');
  const s = source(t, fakeNet({ [SERVER]: tutorRoute(t, { [`/v1/blobs/sha256/${tri.cover.sha256}`]: () => ({ status: 200, body: crypto.randomBytes(tri.cover.bytes) }) }) }), dir);
  await s.cycle();
  assert.equal(s.games().find((x) => x.id === 'tri-rezhima').cover, null);
  assert.equal(s.coverData(tri.cover.sha256), null);
  s.close();
});

test('К16: файл в кеше, подменённый на диске, не запускается и удаляется; контроль: до подмены запускается', async () => {
  const t = await makeSchool(path.join(tmp, 't7'), { games: [games.alpha] });
  const dir = path.join(tmp, 's7');
  const s = source(t, fakeNet({ [SERVER]: tutorRoute(t) }), dir);
  await s.cycle();
  const game = s.games()[0];
  assert.equal((await s.gamePackage(game)).manifest.id, 'alpha');
  fs.copyFileSync(games.beta, path.join(dir, 'cache', game.sha256));
  await assert.rejects(s.gamePackage(game));
  assert.ok(!fs.existsSync(path.join(dir, 'cache', game.sha256)));
  assert.equal(stateOf(s, 'alpha'), 'queued', 'игра снова в очереди на загрузку');
  s.close();
});

test('С6: без сервера — каталог из кеша, скачанная игра готова, нескачанная «нужна связь»; без каталога экран «Попроси тьютора» через 15 с', async () => {
  const t = await makeSchool(path.join(tmp, 't8'), { games: [games.alpha] });
  const dir = path.join(tmp, 's8');
  const s = source(t, fakeNet({ [SERVER]: tutorRoute(t) }), dir);
  await s.cycle();
  s.close();
  await t.lib.setLesson('alpha', false);
  const ti = await makeSchool(path.join(tmp, 't8'), { games: [games.tri] }); // та же школа, новая игра
  const s2 = source(ti, fakeNet({}), dir);
  s2.cycle();
  await s2.cycle();
  assert.equal(stateOf(s2, 'alpha'), 'ready');
  assert.equal(s2.view().online, false);
  s2.close();
  // Сервер появился, каталог с новой игрой, но связь пропала до загрузки
  const net3 = fakeNet({ [SERVER]: tutorRoute(ti, { [`/v1/blobs/sha256/${ti.lib.games().find((g) => g.id === 'tri-rezhima').sha256}`]: () => new NetError('обрыв', 'io') }) });
  const s3 = source(ti, net3, dir);
  await s3.cycle();
  assert.equal(stateOf(s3, 'alpha'), 'ready');
  assert.equal(stateOf(s3, 'tri-rezhima'), 'offline');
  s3.close();

  const empty = path.join(tmp, 's8-empty');
  const start = clock;
  const s4 = source(t, fakeNet({}), empty);
  await s4.cycle();
  assert.equal(s4.view().ask, false, 'сразу экрана нет');
  clock = start + 15001;
  assert.equal(s4.view().ask, true);
  s4.close();
});

test('С6: игра для новой версии программы не качается и показана как «обнови приложение»', async () => {
  const t = await makeSchool(path.join(tmp, 't9'), { games: [games.future] });
  const net = fakeNet({ [SERVER]: tutorRoute(t) });
  const s = source(t, net, path.join(tmp, 's9'));
  await s.cycle();
  assert.equal(stateOf(s, 'future'), 'update');
  assert.ok(!net.requests.some((r) => r.includes(t.lib.games()[0].sha256)));
  s.close();
});

test('С1, К18: ручной адрес — не IPv4, не из подсети, не отвечает отвергаются; верный адрес запоминается', async () => {
  const t = await makeSchool(path.join(tmp, 't10'), { games: [games.alpha] });
  const dir = path.join(tmp, 's10');
  const net = fakeNet({ '192.168.5.77': tutorRoute(t) }, { discoverable: [] });
  const s = source(t, net, dir);
  await s.cycle();
  assert.deepEqual(titles(s), []);
  assert.deepEqual(await s.setAddress('school.local'), { ok: false, reason: 'not-ip' });
  assert.deepEqual(await s.setAddress('203.0.113.5'), { ok: false, reason: 'not-subnet' });
  assert.deepEqual(await s.setAddress('192.168.5.99'), { ok: false, reason: 'no-answer' });
  assert.ok(!net.requests.some((r) => r.startsWith('203.')), 'на чужой адрес запроса не было');
  assert.deepEqual(await s.setAddress('192.168.5.77'), { ok: true });
  await s.cycle();
  assert.deepEqual(titles(s), ['alpha']);
  assert.equal(stateOf(s, 'alpha'), 'ready');
  s.close();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))).server, '192.168.5.77');
});

test('К21 (логика): на паузе сеть остановлена, цикл ничего не запрашивает, адрес не принимается; после паузы работа продолжается', async () => {
  const t = await makeSchool(path.join(tmp, 't11'), { games: [games.alpha] });
  const net = fakeNet({ [SERVER]: tutorRoute(t) });
  const s = source(t, net, path.join(tmp, 's11'), { random: () => 0 });
  s.pause();
  assert.equal(net.stopCalls, 1);
  await s.cycle();
  assert.deepEqual(net.requests, []);
  assert.deepEqual(await s.setAddress(SERVER), { ok: false, reason: 'busy' });
  s.resume();
  await s.cycle();
  assert.deepEqual(titles(s), ['alpha']);
  s.close();
});

test('С9: тексты для ребёнка в витрине по-русски, без латиницы и технических хвостов', () => {
  const src = fs.readFileSync(path.join(APP, 'desktop', 'vitrina', 'ui', 'app.js'), 'utf8');
  const block = (name) => {
    const start = src.indexOf(`const ${name} = {`);
    assert.ok(start >= 0, name);
    return src.slice(start, src.indexOf('};', start));
  };
  const texts = [];
  for (const name of ['STATE_TEXT', 'ADDRESS_ERRORS', 'LAUNCH_ERRORS']) {
    for (const m of block(name).matchAll(/(?:tag|note|:)\s*'([^']+)'/g)) texts.push(m[1]);
  }
  for (const literal of ['Ищу программу тьютора в сети…', 'Попроси тьютора', 'Ноутбук настроен с ошибкой', 'Подключились. Каталог загружается']) {
    assert.ok(src.includes(literal), literal);
    texts.push(literal);
  }
  assert.ok(texts.length >= 12, `текстов: ${texts.length}`);
  for (const t of texts) {
    // Латиница допустима только в примере адреса
    assert.doesNotMatch(t.replace(/\d+\.\d+\.\d+\.\d+/g, ''), /[A-Za-z]/, t);
    assert.doesNotMatch(t, /Error|ECONN|ENOENT|undefined|null/, t);
  }
});
