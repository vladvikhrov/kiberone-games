'use strict';
/* В7: поля cover и modes. Каждый плохой случай отвергается, а верный манифест принимается (контроль). */
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const yazl = require('yazl');
const { readPackage, PackageError, sha256, gameModes, checkManifest } = require('../shared/package-format');
const { keygen, pack } = require('../kibpack/pack');

let tmp, keyPath, privateKey, publicKey;
const META = { id: 'demo', version: '1.0.0', title: 'Демо', description: 'Проверка', authors: ['Автор'],
  grades: '4–5 класс', minutes: 30, topic: 'Тест', minAppVersion: '1.0.0' };

/* Настоящий PNG 1×1 и настоящий WebP, плюс заголовок JPEG с EXIF */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.from('Exif\0\0GPS', 'latin1'), Buffer.alloc(32)]);
const HTML = Buffer.from('<!doctype html><title>x</title>');

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kibcover-'));
  keyPath = keygen('cover', path.join(tmp, 'keys')).keyPath;
  privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
  publicKey = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/* Собирает и подписывает архив вручную: так проверяется приложение, а не kibpack. */
async function build(files, extra = {}) {
  const all = { 'game/index.html': HTML, ...files };
  const manifest = { ...META, format: 1, entry: 'game/index.html', ...extra, publicKey,
    files: Object.fromEntries(Object.entries(all).map(([n, d]) => [n, sha256(d)])) };
  const bytes = Buffer.from(JSON.stringify(manifest));
  const zip = new yazl.ZipFile();
  zip.addBuffer(bytes, 'manifest.json');
  zip.addBuffer(crypto.sign(null, bytes, privateKey), 'manifest.sig');
  for (const [name, data] of Object.entries(all)) zip.addBuffer(data, name);
  zip.end();
  const target = path.join(tmp, `${crypto.randomUUID()}.kibgames`);
  await new Promise((res, rej) => zip.outputStream.pipe(fs.createWriteStream(target)).on('close', res).on('error', rej));
  return target;
}
const rejects = async (files, extra, re) => assert.rejects(readPackage(await build(files, extra)),
  (e) => e instanceof PackageError && re.test(e.message));
const modes = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, title: `Режим ${i}` }));

test('контроль: верный манифест с обложками и тремя режимами принимается', async () => {
  const file = await build({ 'game/cover.png': PNG, 'game/b.webp': WEBP, 'game/exam.html': HTML }, {
    cover: 'game/cover.png',
    modes: [
      { id: 'training', title: 'Тренировка', about: 'С подсказками', cover: 'game/b.webp' },
      { id: 'exam', title: 'Экзамен', entry: 'game/exam.html' },
      { id: 'free', title: 'Свободный' },
    ],
  });
  const { manifest } = await readPackage(file);
  assert.deepEqual(gameModes(manifest).map((m) => [m.id, m.entry, m.cover, m.about]), [
    ['training', 'game/index.html', 'game/b.webp', 'С подсказками'],
    ['exam', 'game/exam.html', 'game/cover.png', 'Проверка'],
    ['free', 'game/index.html', 'game/cover.png', 'Проверка'],
  ]);
});

test('без modes у игры один режим default', () => {
  assert.deepEqual(gameModes({ ...META, entry: 'game/index.html' }).map((m) => [m.id, m.title, m.cover]), [['default', 'Демо', null]]);
});

test('JPEG отвергается', () => rejects({ 'game/cover.jpg': JPEG }, { cover: 'game/cover.jpg' }, /только PNG или WebP/));
test('подмена расширения: JPEG с именем .png', () => rejects({ 'game/cover.png': JPEG }, { cover: 'game/cover.png' }, /не совпадает с содержимым/));
test('подмена расширения: PNG с именем .webp', () => rejects({ 'game/cover.webp': PNG }, { cover: 'game/cover.webp' }, /не совпадает с содержимым/));
test('обложка режима тоже проверяется по байтам', () => rejects({ 'game/m.png': JPEG },
  { modes: [{ id: 'a', title: 'А', cover: 'game/m.png' }] }, /не совпадает с содержимым/));
test('обложка больше 512 КБ', () => {
  const big = Buffer.concat([PNG, Buffer.alloc(512 * 1024)]);
  return rejects({ 'game/cover.png': big }, { cover: 'game/cover.png' }, /больше 512 КБ/);
});
test('ровно 512 КБ проходит', async () => {
  const exact = Buffer.concat([PNG, Buffer.alloc(512 * 1024 - PNG.length)]);
  await readPackage(await build({ 'game/cover.png': exact }, { cover: 'game/cover.png' }));
});
test('путь обложки вне game/: значок в корне', () => rejects({}, { cover: 'icon.png' }, /в папке game/));
test('путь обложки с выходом из папки', () => rejects({}, { cover: 'game/../cover.png' }, /Недопустимый путь/));
test('обложки нет среди файлов игры', () => rejects({}, { cover: 'game/none.png' }, /нет в игре/));
test('обложка не строка', () => rejects({}, { cover: { path: 'game/a.png' } }, /в папке game/));

test('13 режимов', () => rejects({}, { modes: modes(13) }, /от 1 до 12/));
test('12 режимов проходят', async () => { await readPackage(await build({}, { modes: modes(12) })); });
test('пустой список режимов', () => rejects({}, { modes: [] }, /от 1 до 12/));
test('modes не список', () => rejects({}, { modes: { a: 1 } }, /от 1 до 12/));
for (const id of ['Exam', 'a/b', '', 'режим', 'a'.repeat(41), '../x', 'a b', 5]) {
  test(`плохой id режима: ${JSON.stringify(id)}`, () => rejects({}, { modes: [{ id, title: 'Р' }] }, /id только латиница/));
}
test('повтор id режима', () => rejects({}, { modes: [{ id: 'a', title: 'А' }, { id: 'a', title: 'Б' }] }, /уже есть/));
test('entry режима вне game/', () => rejects({}, { modes: [{ id: 'a', title: 'А', entry: '../index.html' }] }, /entry/));
test('entry режима в корне архива', () => rejects({}, { modes: [{ id: 'a', title: 'А', entry: 'manifest.json' }] }, /entry/));
test('entry режима не HTML', () => rejects({ 'game/a.js': Buffer.from('1') }, { modes: [{ id: 'a', title: 'А', entry: 'game/a.js' }] }, /entry/));
test('entry режима нет в файлах', () => rejects({}, { modes: [{ id: 'a', title: 'А', entry: 'game/none.html' }] }, /entry/));
test('лишнее поле режима', () => rejects({}, { modes: [{ id: 'a', title: 'А', permissions: ['net'] }] }, /неизвестное поле/));
test('поле __proto__ в режиме', () => rejects({}, { modes: [JSON.parse('{"id":"a","title":"А","__proto__":{"x":1}}')] }, /неизвестное поле/));
test('описание режима длиннее 120 знаков', () => rejects({}, { modes: [{ id: 'a', title: 'А', about: 'я'.repeat(121) }] }, /до 120/));
test('название режима с управляющими символами', () => rejects({}, { modes: [{ id: 'a', title: 'А‮' }] }, /название/));
test('режим не объект', () => rejects({}, { modes: ['a'] }, /нужен объект/));

test('путь constructor в files не считается существующим', () => {
  assert.throws(() => checkManifest({ ...META, format: 1, entry: 'game/index.html', publicKey,
    files: { 'game/index.html': sha256(HTML) }, cover: 'game/constructor.png' }), /нет в игре/);
});

/* kibpack: пути в kibgame.json от папки игры, обложки проверяются до записи файла */
function folder(meta, files) {
  const dir = fs.mkdtempSync(path.join(tmp, 'src-'));
  fs.writeFileSync(path.join(dir, 'kibgame.json'), JSON.stringify({ ...META, entry: 'index.html', ...meta }));
  for (const [name, data] of Object.entries({ 'index.html': HTML, ...files })) fs.writeFileSync(path.join(dir, name), data);
  return dir;
}

test('kibpack собирает игру с обложками и режимами, приложение её принимает', async () => {
  const dir = folder({ cover: 'cover.png', modes: [{ id: 'a', title: 'А', cover: 'a.webp' }, { id: 'b', title: 'Б', entry: 'b.html' }] },
    { 'cover.png': PNG, 'a.webp': WEBP, 'b.html': HTML });
  const out = path.join(tmp, 'ok.kibgames');
  const { warnings } = await pack(dir, { key: keyPath, out });
  assert.deepEqual(warnings, ['minAppVersion поднят с 1.0.0 до 1.1.0: обложки и режимы понимает только приложение 1.1.0 и новее']);
  const { manifest } = await readPackage(out);
  assert.equal(manifest.minAppVersion, '1.1.0');
  assert.equal(manifest.cover, 'game/cover.png');
  assert.deepEqual(manifest.modes, [{ id: 'a', title: 'А', cover: 'game/a.webp' }, { id: 'b', title: 'Б', entry: 'game/b.html' }]);
});

test('kibpack не трогает minAppVersion игры без обложек и режимов и не опускает более новую', async () => {
  const plain = await pack(folder({}, {}), { key: keyPath, out: path.join(tmp, 'plain.kibgames') });
  assert.equal(plain.manifest.minAppVersion, '1.0.0');
  const newer = await pack(folder({ cover: 'cover.png', minAppVersion: '2.0.0' }, { 'cover.png': PNG }), { key: keyPath, out: path.join(tmp, 'newer.kibgames') });
  assert.equal(newer.manifest.minAppVersion, '2.0.0');
  assert.ok(!newer.warnings.some((w) => /minAppVersion/.test(w)));
});

test('kibpack предупреждает, если обложки нет', async () => {
  const { warnings } = await pack(folder({}, {}), { key: keyPath, out: path.join(tmp, 'nocover.kibgames') });
  assert.ok(warnings.some((w) => /нет обложки/.test(w)));
});

test('kibpack не собирает игру с JPEG под видом PNG и не оставляет файла', async () => {
  const out = path.join(tmp, 'bad.kibgames');
  await assert.rejects(pack(folder({ cover: 'cover.png' }, { 'cover.png': JPEG }), { key: keyPath, out }), /не совпадает/);
  assert.equal(fs.existsSync(out), false);
});

test('kibpack отвергает 13 режимов', async () => {
  await assert.rejects(pack(folder({ modes: modes(13) }, {}), { key: keyPath, out: path.join(tmp, 'm13.kibgames') }), /от 1 до 12/);
});
