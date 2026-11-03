'use strict';
/* Этап М1, Т10, Т11, Т15: публикация игр в программе тьютора и тексты ошибок. */
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { keygen, pack } = require('../kibpack/pack');
const { readPackage, PackageError, keyId } = require('../shared/package-format');
const { verifyCatalog } = require('../shared/catalog');
const { createSchoolKey } = require('../desktop/tutor/school-key');
const { createLibrary, LibraryError } = require('../desktop/tutor/library');

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASSWORD = 'длинный-пароль-1';
const APP = path.join(__dirname, '..');
let tmp;
const files = {};

const META = { id: 'demo', version: '1.0.0', title: 'Демо', description: 'Проверка', authors: ['Автор А'],
  grades: '4–5 класс', minutes: 30, topic: 'Тест', minAppVersion: '1.0.0', entry: 'index.html' };

async function packGame(name, keyName, meta) {
  const dir = path.join(tmp, `src-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'kibgame.json'), JSON.stringify({ ...META, ...meta }));
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><title>${name}</title>`);
  const out = path.join(tmp, `${name}.kibgames`);
  await pack(dir, { key: path.join(tmp, 'keys', `${keyName}.key.pem`), out });
  return out;
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiblib-'));
  for (const k of ['avtor', 'samozvanets']) keygen(k, path.join(tmp, 'keys'));
  files.v1 = await packGame('v1', 'avtor', {});
  files.v2 = await packGame('v2', 'avtor', { version: '1.1.0', title: 'Демо 2' });
  files.v05 = await packGame('v05', 'avtor', { version: '0.5.0' });
  files.impostor = await packGame('impostor', 'samozvanets', { version: '9.0.0', authors: ['Автор А'] });
  files.other = await packGame('other', 'samozvanets', { id: 'drugaya', title: 'Другая' });
  files.tri = path.join(tmp, 'tri.kibgames');
  await pack(path.join(APP, 'testgames', 'tri-rezhima'), { key: path.join(tmp, 'keys', 'avtor.key.pem'), out: files.tri });
  // К11: битый файл и подделка (байт в середине настоящей игры), как в комплекте для Windows
  files.bitaya = path.join(tmp, 'bitaya.kibgames');
  fs.writeFileSync(files.bitaya, 'это не игра');
  const flipped = fs.readFileSync(files.tri);
  flipped[Math.floor(flipped.length / 2)] ^= 0xff;
  files.poddelka = path.join(tmp, 'poddelka.kibgames');
  fs.writeFileSync(files.poddelka, flipped);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const avtorKey = () => keyId(crypto.createPublicKey(crypto.createPrivateKey(fs.readFileSync(path.join(tmp, 'keys', 'avtor.key.pem'))))
  .export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'));

async function setup({ trustAuthor = false } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'data-'));
  let t = 1_793_700_000_000;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  const key = createSchoolKey(dir, { kdf: FAST, now });
  await key.create({ name: 'Школа', password: PASSWORD, again: PASSWORD });
  if (trustAuthor) fs.writeFileSync(path.join(dir, 'trusted-keys.json'), JSON.stringify({ [avtorKey()]: 'Иван Петров' }));
  const lib = createLibrary(dir, { key, now, appVersion: '1.1.0' });
  const catalogBytes = () => (fs.existsSync(lib.catalogPath) ? fs.readFileSync(lib.catalogPath) : null);
  const verify = () => verifyCatalog(fs.readFileSync(lib.catalogPath), { schoolKey: key.publicKey() });
  return { dir, key, lib, now, catalogBytes, verify };
}
const blobNames = (lib) => fs.readdirSync(lib.blobsDir).filter((n) => !n.startsWith('.')).sort();
const hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

test('Т10: битый и подделанный файл не публикуются никогда, каталог не меняется', async () => {
  const { lib, catalogBytes } = await setup({ trustAuthor: true });
  const a = await lib.inspect(files.v1);
  await lib.publish(a.token);
  const before = catalogBytes();
  for (const file of [files.bitaya, files.poddelka]) {
    const err = await lib.inspect(file).catch((e) => e);
    assert.ok(err instanceof PackageError, String(err));
    assert.ok(['damaged', 'tampered'].includes(err.kind));
  }
  assert.deepEqual(catalogBytes(), before);
  assert.deepEqual(fs.readdirSync(lib.blobsDir).filter((n) => n.startsWith('.incoming')), []);
});

test('Т10: неизвестный автор — без подтверждения каталог не меняется, с подтверждением игра в каталоге без имени автора', async () => {
  const { lib, catalogBytes, verify } = await setup();
  const a = await lib.inspect(files.v1);
  assert.equal(a.unknownAuthor, true);
  assert.deepEqual(a.warnings, ['unknown']);
  await assert.rejects(lib.publish(a.token), (e) => e instanceof LibraryError && /Автор неизвестен/.test(e.message));
  assert.equal(catalogBytes(), null);
  await lib.publish(a.token, { confirmUnknown: true });
  const g = verify().games[0];
  assert.equal(g.author, null);
  assert.deepEqual(lib.trustedKeys(), {});
});

test('Т10: неизвестного автора можно внести в список доверия школы под своим именем', async () => {
  const { lib, verify } = await setup();
  const a = await lib.inspect(files.v1);
  await lib.publish(a.token, { confirmUnknown: true, trustName: 'Иван Петров' });
  assert.equal(verify().games[0].author, 'Иван Петров');
  assert.deepEqual(lib.trustedKeys(), { [a.authorKey]: 'Иван Петров' });
  const b = await lib.inspect(files.v2);
  assert.equal(b.unknownAuthor, false);
  await assert.rejects(lib.publish(b.token, { trustName: 'Другое имя' }), /уже есть в списке доверия/);
  await assert.rejects(lib.publish(a.token, {}), /не ждёт решения/);
});

test('Т10 (К13): самозванец с тем же id и другим ключом — только после отдельного подтверждения замены', async () => {
  const { lib, catalogBytes, verify } = await setup({ trustAuthor: true });
  await lib.publish((await lib.inspect(files.v1)).token);
  const before = catalogBytes();
  const imp = await lib.inspect(files.impostor);
  assert.equal(imp.replace, true);
  assert.deepEqual(imp.warnings, ['unknown', 'replace']);
  await assert.rejects(lib.publish(imp.token, { confirmUnknown: true }), /подтвердите замену/);
  await assert.rejects(lib.publish(imp.token, { confirmReplace: true }), /Автор неизвестен/);
  assert.deepEqual(catalogBytes(), before);
  assert.equal(verify().games[0].authorKey, avtorKey());
  await lib.publish(imp.token, { confirmUnknown: true, confirmReplace: true });
  const g = verify().games[0];
  assert.equal(g.version, '9.0.0');
  assert.notEqual(g.authorKey, avtorKey());
});

test('Т10: старая и та же версия того же автора отвергаются без вопросов, новая заменяет и сохраняет дату и отметку занятия', async () => {
  const { lib, key, now, catalogBytes, verify } = await setup({ trustAuthor: true });
  await lib.publish((await lib.inspect(files.v1)).token);
  await lib.setLesson('demo', true);
  const before = catalogBytes();
  await assert.rejects(lib.inspect(files.v05), /уже версия 1\.0\.0/);
  await assert.rejects(lib.inspect(files.v1), /уже версия 1\.0\.0/);
  assert.deepEqual(catalogBytes(), before);
  now.advance(3 * 86_400_000);
  assert.equal(key.unlocked(), false); // за три дня панель закрылась сама
  await key.unlock(PASSWORD);
  const b = await lib.inspect(files.v2);
  assert.equal(b.update, true);
  await lib.publish(b.token);
  const g = verify().games[0];
  assert.equal(g.version, '1.1.0');
  assert.equal(g.publishedAt, '2026-11-03');
  assert.equal(g.lesson, true);
});

test('Т10: при закрытом ключе ничего не публикуется и не меняется', async () => {
  const { lib, key, catalogBytes } = await setup({ trustAuthor: true });
  const a = await lib.inspect(files.v1);
  key.lock();
  await assert.rejects(lib.publish(a.token), /Ключ школы закрыт/);
  await assert.rejects(lib.inspect(files.v2), /Ключ школы закрыт/);
  await assert.rejects(lib.setLesson('demo', true), /Ключ школы закрыт/);
  assert.equal(catalogBytes(), null);
});

test('Т11: обложки «Трёх режимов» в blobs побайтно равны обложкам из файла, у режимов свои, после снятия блобы удалены', async () => {
  const { lib, verify } = await setup({ trustAuthor: true });
  const pkg = await readPackage(files.tri);
  const a = await lib.inspect(files.tri);
  await lib.publish(a.token);
  const g = verify().games.find((x) => x.id === 'tri-rezhima');
  const fileBytes = fs.readFileSync(files.tri);
  assert.equal(g.sha256, hex(fileBytes));
  assert.equal(g.bytes, fileBytes.length);
  assert.deepEqual(fs.readFileSync(lib.blobPath(g.sha256)), fileBytes);
  const expectCover = (p) => {
    const data = pkg.files.get(p);
    return { sha256: hex(data), bytes: data.length };
  };
  assert.deepEqual(g.cover, expectCover('game/cover.png'));
  assert.deepEqual(g.modes.map((m) => [m.id, m.cover]), [
    ['training', expectCover('game/cover-training.png')],
    ['timed', expectCover('game/cover-timed.png')],
    ['custom', expectCover('game/cover.png')], // режим без своей обложки берёт обложку игры
  ]);
  for (const ref of [g.cover, ...g.modes.map((m) => m.cover)]) assert.deepEqual(fs.readFileSync(lib.blobPath(ref.sha256)), pkg.files.get(Object.keys(pkg.manifest.files).find((p) => hex(pkg.files.get(p)) === ref.sha256)));
  assert.equal(blobNames(lib).length, 4); // игра и три разные обложки

  await lib.publish((await lib.inspect(files.other)).token, { confirmUnknown: true });
  const otherSha = verify().games.find((x) => x.id === 'drugaya').sha256;
  await lib.unpublish('tri-rezhima');
  assert.deepEqual(blobNames(lib), [otherSha]);
  assert.deepEqual(verify().games.map((x) => x.id), ['drugaya']);
});

test('Т11: проверяется копия, а не исходный файл: подмена файла после выбора ничего не меняет', async () => {
  const { lib, verify } = await setup({ trustAuthor: true });
  const src = path.join(tmp, 'menyaetsya.kibgames');
  fs.copyFileSync(files.v1, src);
  const a = await lib.inspect(src);
  fs.copyFileSync(files.bitaya, src);
  await lib.publish(a.token);
  assert.equal(verify().games[0].sha256, hex(fs.readFileSync(files.v1)));
});

test('каталог на диске проверяется при запуске; seq растёт с каждой публикацией; отмена удаляет временный файл', async () => {
  const { dir, key, lib, now, verify } = await setup({ trustAuthor: true });
  await lib.publish((await lib.inspect(files.v1)).token);
  const s1 = verify().seq;
  await lib.setLesson('demo', true);
  const s2 = verify().seq;
  assert.ok(s2 > s1);
  const again = createLibrary(dir, { key, now, appVersion: '1.1.0' });
  assert.deepEqual(again.games().map((g) => g.id), ['demo']);
  assert.equal(again.catalogError(), null);
  const b = await again.inspect(files.v2);
  assert.equal(again.cancel(b.token), true);
  assert.deepEqual(fs.readdirSync(again.blobsDir).filter((n) => n.startsWith('.incoming')), []);
  fs.writeFileSync(lib.catalogPath, fs.readFileSync(lib.catalogPath, 'utf8').replace(/"sig":"./, '"sig":"A'));
  const broken = createLibrary(dir, { key, now, appVersion: '1.1.0' });
  assert.match(broken.catalogError(), /не прошёл проверку/);
  assert.deepEqual(broken.games(), []);
  // Испорченный каталог не должен стоить файлов прежних игр: новая публикация их не удаляет
  const before = fs.readdirSync(broken.blobsDir).filter((n) => !n.startsWith('.'));
  await broken.publish((await broken.inspect(files.other)).token, { confirmUnknown: true });
  const after = fs.readdirSync(broken.blobsDir).filter((n) => !n.startsWith('.'));
  assert.ok(before.every((n) => after.includes(n)), 'файлы прежних игр на месте');
  assert.equal(broken.catalogError(), null);
});

test('Т15: ошибки файлов по-русски, без текста библиотек, «повреждён» и «изменён после подписи» различаются', async () => {
  const errs = {};
  for (const name of ['bitaya', 'poddelka']) errs[name] = await readPackage(files[name]).catch((e) => e);
  assert.equal(errs.bitaya.kind, 'damaged');
  assert.match(errs.bitaya.message, /^Файл повреждён/);
  assert.ok(errs.bitaya.detail, 'техническая причина сохранена для журнала');
  assert.ok(!errs.bitaya.message.includes(errs.bitaya.detail));
  for (const [name, err] of Object.entries(errs)) {
    // Латиница допустима только в именах файлов внутри архива (game/…, *.png)
    const words = err.message.split(/\s+/).filter((w) => !/[/.]/.test(w));
    assert.ok(!words.some((w) => /[A-Za-z]/.test(w)), `${name}: ${err.message}`);
  }
  // Изменённый после подписи файл: подпись и хеши
  const yazl = require('yazl');
  const yauzl = require('yauzl');
  const entries = await new Promise((resolve, reject) => {
    const out = new Map();
    yauzl.open(files.v1, { lazyEntries: true }, (err, zip) => {
      if (err) { reject(err); return; }
      zip.on('entry', (e) => zip.openReadStream(e, (er, s) => { const c = []; s.on('data', (d) => c.push(d)); s.on('end', () => { out.set(e.fileName, Buffer.concat(c)); zip.readEntry(); }); }));
      zip.on('end', () => resolve(out));
      zip.readEntry();
    });
  });
  entries.set('game/index.html', Buffer.from('<script>evil()</script>'));
  const z = new yazl.ZipFile();
  for (const [n, d] of entries) z.addBuffer(d, n);
  z.end();
  const changed = path.join(tmp, 'izmenyon.kibgames');
  await new Promise((res) => z.outputStream.pipe(fs.createWriteStream(changed)).on('close', res));
  const err = await readPackage(changed).catch((e) => e);
  assert.equal(err.kind, 'tampered');
  assert.match(err.message, /^Файл изменён после подписи/);
});
