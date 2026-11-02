'use strict';
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const yazl = require('yazl');
const { readPackage, PackageError, LIMITS, sha256, supportsVersion } = require('../shared/package-format');
const { keygen, pack } = require('../kibpack/pack');

let tmp, keyPath;
const META = { id: 'demo', version: '1.0.0', title: 'Демо', description: 'Проверка', authors: ['Автор'],
  grades: '4–5 класс', minutes: 30, topic: 'Тест', entry: 'index.html', minAppVersion: '1.0.0' };

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kibpack-'));
  keyPath = keygen('test', path.join(tmp, 'keys')).keyPath;
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function gameFolder(extra = {}, meta = META) {
  const dir = fs.mkdtempSync(path.join(tmp, 'game-'));
  fs.writeFileSync(path.join(dir, 'kibgame.json'), JSON.stringify(meta));
  const files = { 'index.html': '<!doctype html><title>Демо</title>', 'js/game.js': 'let a = 1;', ...extra };
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}
const out = () => path.join(tmp, `${crypto.randomUUID()}.kibgames`);

/* Собирает архив вручную, как это сделал бы злоумышленник, и подписывает его настоящим ключом. */
async function forged({ mutate = (m) => m, extra = [], skip = [], sign = true } = {}) {
  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
  const pub = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const body = Buffer.from('<!doctype html>');
  const manifest = mutate({ ...META, format: 1, entry: 'game/index.html', publicKey: pub, files: { 'game/index.html': sha256(body) } });
  const bytes = Buffer.from(JSON.stringify(manifest));
  const zip = new yazl.ZipFile();
  const base = [['manifest.json', bytes], ['game/index.html', body]];
  if (sign) base.push(['manifest.sig', crypto.sign(null, bytes, privateKey)]);
  for (const [name, data] of base) if (!skip.includes(name)) zip.addBuffer(data, name);
  for (const [name, data, opts] of extra) zip.addBuffer(data, name, opts || {});
  zip.end();
  const target = out();
  await new Promise((res, rej) => zip.outputStream.pipe(fs.createWriteStream(target)).on('close', res).on('error', rej));
  return target;
}
const rejects = (file, re) => assert.rejects(readPackage(file), (e) => e instanceof PackageError && re.test(e.message));

test('собранный файл проходит проверку', async () => {
  const { target } = await pack(gameFolder(), { key: keyPath, out: out() });
  const { manifest, files, trust } = await readPackage(target);
  assert.equal(manifest.id, 'demo');
  assert.ok(files.has('game/js/game.js'));
  assert.ok(!files.has('game/kibgame.json'));
  assert.equal(trust.trusted, false);
});

test('сборка воспроизводима: одинаковая папка даёт одинаковый файл', async () => {
  const dir = gameFolder();
  const a = await pack(dir, { key: keyPath, out: out() });
  const b = await pack(dir, { key: keyPath, out: out() });
  assert.ok(fs.readFileSync(a.target).equals(fs.readFileSync(b.target)));
});

test('ключ из списка школы даёт имя из списка, а не из манифеста', async () => {
  const { target } = await pack(gameFolder(), { key: keyPath, out: out() });
  const { trust } = await readPackage(target);
  const again = await readPackage(target, { trustedKeys: { [trust.keyId]: 'Школа: Влад' } });
  assert.deepEqual([again.trust.trusted, again.trust.name], [true, 'Школа: Влад']);
});

test('имя вроде __proto__ или constructor не делает ключ доверенным', async () => {
  const { target } = await pack(gameFolder(), { key: keyPath, out: out() });
  const { trust } = await readPackage(target, { trustedKeys: JSON.parse('{"__proto__":"x"}') });
  assert.equal(trust.trusted, false);
});

test('подделка: изменённый файл игры', async () => {
  await rejects(await forged({ skip: ['game/index.html'], extra: [['game/index.html', Buffer.from('<script>evil()</script>')]] }), /изменён после подписи/);
});

test('подделка: изменённый манифест при старой подписи', async () => {
  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
  const original = Buffer.from('{}');
  const file = await forged({ skip: ['manifest.sig'], extra: [['manifest.sig', crypto.sign(null, original, privateKey)]] });
  await rejects(file, /Подпись не сходится/);
});

test('подделка: чужой ключ подменён вместе с подписью не выдаётся за доверенный', async () => {
  const { target } = await pack(gameFolder(), { key: keyPath, out: out() });
  const { trust } = await readPackage(target);
  const otherKey = keygen('other', path.join(tmp, 'keys')).keyPath;
  const { target: faked } = await pack(gameFolder(), { key: otherKey, out: out() });
  const result = await readPackage(faked, { trustedKeys: { [trust.keyId]: 'Влад' } });
  assert.equal(result.trust.trusted, false);
});

test('нет подписи', async () => { await rejects(await forged({ sign: false }), /не подписана/); });
test('нет манифеста', async () => { await rejects(await forged({ skip: ['manifest.json'] }), /нет манифеста/); });
test('лишний файл, не указанный в манифесте', async () => {
  await rejects(await forged({ extra: [['game/extra.js', Buffer.from('1')]] }), /Лишний файл/);
});
test('запрещённый тип файла', async () => {
  await rejects(await forged({ extra: [['game/virus.exe', Buffer.from('MZ')]] }), /запрещены/);
});
test('файл вне папки game', async () => {
  await rejects(await forged({ extra: [['autorun.inf', Buffer.from('x')]] }), /вне папки/);
});
test('поток NTFS в имени файла', async () => {
  await rejects(await forged({ mutate: (m) => ({ ...m, files: { ...m.files, 'game/a.js:evil': 'sha256:' + '0'.repeat(64) } }) }), /Недопустимый путь/);
});
test('зарезервированное имя Windows', async () => {
  await rejects(await forged({ extra: [['game/nul.js', Buffer.from('x')]] }), /Недопустимый путь/);
});
test('символическая ссылка', async () => {
  await rejects(await forged({ extra: [['game/link.js', Buffer.from('/etc/passwd'), { mode: 0o120777 }]] }), /Символические/);
});
test('дубль имени с другим регистром', async () => {
  await rejects(await forged({ extra: [['game/Index.html', Buffer.from('x')]] }), /дважды/);
});
test('точка входа вне игры', async () => {
  await rejects(await forged({ mutate: (m) => ({ ...m, entry: '../index.html' }) }), /entry/);
});
test('неизвестное поле манифеста, например разрешения', async () => {
  await rejects(await forged({ mutate: (m) => ({ ...m, permissions: ['network'] }) }), /Неизвестное поле/);
});
test('будущая версия формата', async () => {
  await rejects(await forged({ mutate: (m) => ({ ...m, format: 2 }) }), /другой версии/);
});

test('выход из папки: путь с .. в архиве', async () => {
  // yazl не даст записать «..», поэтому правим байты: длина имени совпадает
  const evil = await forged({ extra: [['game/xx/evil.js', Buffer.from('1')]] });
  const bytes = fs.readFileSync(evil);
  const patched = Buffer.from(bytes.toString('latin1').split('game/xx/evil.js').join('game/../evil.js'), 'latin1');
  const target = out();
  fs.writeFileSync(target, patched);
  await assert.rejects(readPackage(target), PackageError);
});

test('ZIP-бомба: распакованный размер больше лимита', { timeout: 120000 }, async () => {
  const zeros = Buffer.alloc(LIMITS.totalBytes + 1024);
  const file = await forged({ extra: [['game/bomb.txt', zeros]] });
  assert.ok(fs.statSync(file).size < 2 * 1024 * 1024, 'архив должен быть маленьким');
  await rejects(file, /слишком большая/);
});

test('мусор вместо архива', async () => {
  const target = out();
  fs.writeFileSync(target, 'это не zip');
  await rejects(target, /повреждён/);
});

test('сборка предупреждает о внешних шрифтах', async () => {
  const dir = gameFolder({ 'index.html': '<link rel="stylesheet" href="https://fonts.googleapis.com/css2">' });
  const { warnings } = await pack(dir, { key: keyPath, out: out() });
  assert.equal(warnings.length, 1);
});

test('keygen не создаёт ключ внутри git и не перезаписывает старый', () => {
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  assert.throws(() => keygen('a', path.join(repo, 'keys')), /git/);
  assert.throws(() => keygen('test', path.join(tmp, 'keys')), /уже существует/);
});

test('имя с управляющими символами не проходит: так подделывают автора на экране', async () => {
  await rejects(await forged({ mutate: (m) => ({ ...m, authors: ['Влад\u202e'] }) }), /authors/);
  await rejects(await forged({ mutate: (m) => ({ ...m, title: 'Игра\nСистемное сообщение' }) }), /title/);
});

test('сравнение версий идёт по числам, а не по строкам', () => {
  assert.equal(supportsVersion('1.10.0', '1.9.0'), true);
  assert.equal(supportsVersion('1.0.0', '1.0.1'), false);
  assert.equal(supportsVersion('1.0.0', '1.0.0'), true);
});
