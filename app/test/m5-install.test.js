'use strict';
/* Этап М5: значки и установщики. Проверяются файлы, из которых electron-builder соберёт установщики:
   NSIS-скрипты, настройки сборки, значки. Сами установщики собираются и ставятся только на Windows (windows-m5.md). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const tutor = JSON.parse(read('builder-tutor.json'));
const studentNsh = read('build/installer.nsh');
const tutorNsh = read('build/tutor/installer.nsh');

/* Размеры из каталога .ico: ширина 0 значит 256 */
function icoSizes(file) {
  const b = fs.readFileSync(path.join(APP, file));
  assert.equal(b.readUInt16LE(0), 0);
  assert.equal(b.readUInt16LE(2), 1, 'тип 1 — значок');
  const n = b.readUInt16LE(4);
  return Array.from({ length: n }, (_, i) => b[6 + i * 16] || 256).sort((a, c) => a - c);
}

test('И2: в обоих .ico 8 размеров от 16 до 256, значки ученика и тьютора разные', () => {
  for (const f of ['build/icon.ico', 'build/tutor/icon.ico']) assert.deepEqual(icoSizes(f), [16, 20, 24, 32, 40, 48, 64, 256], f);
  assert.notDeepEqual(fs.readFileSync(path.join(APP, 'build/icon.ico')), fs.readFileSync(path.join(APP, 'build/tutor/icon.ico')));
});

test('И2: значки подключены к exe, установщику и файлам .kibgames', () => {
  assert.equal(pkg.build.win.icon, 'build/icon.ico');
  assert.equal(pkg.build.nsis.installerIcon, 'build/icon.ico');
  assert.equal(pkg.build.fileAssociations[0].icon, 'build/icon.ico');
  assert.equal(pkg.build.fileAssociations[0].ext, 'kibgames');
  assert.equal(tutor.win.icon, 'build/tutor/icon.ico');
  assert.equal(tutor.nsis.installerIcon, 'build/tutor/icon.ico');
});

test('Обе программы ставятся для всех пользователей, версия 1.2.0, NSIS-скрипты подключены', () => {
  assert.equal(pkg.version, '1.2.0');
  for (const c of [pkg.build, tutor]) {
    assert.equal(c.nsis.perMachine, true);
    assert.equal(c.nsis.oneClick, false);
    assert.ok(fs.existsSync(path.join(APP, c.nsis.include)), c.nsis.include);
  }
  assert.equal(tutor.nsis.deleteAppDataOnUninstall, false, 'ключ школы и оценки остаются после удаления');
});

test('И13: Electron fuses те же, что на М4, у обеих программ', () => {
  const expected = {
    runAsNode: false, enableCookieEncryption: true, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true, loadBrowserProcessSpecificV8Snapshot: false, grantFileProtocolExtraPrivileges: false,
  };
  assert.deepEqual(pkg.build.electronFuses, expected);
  assert.deepEqual(tutor.electronFuses, expected);
});

test('И6, И7: метка пишется туда, откуда её читает программа, с правами только на чтение для учеников', () => {
  const main = read('desktop/main.js');
  const fromMain = main.match(/return '(C:\\\\ProgramData\\\\[^']+)'/)[1].replace(/\\\\/g, '\\');
  const label = studentNsh.match(/!define K1_LABEL "([^"]+)"/)[1];
  assert.equal(label, fromMain);
  assert.equal(studentNsh.match(/!define K1_DIR "([^"]+)"/)[1], path.win32.dirname(fromMain));
  const acl = studentNsh.match(/!define K1_ACL '([^']+)'/)[1];
  assert.match(acl, /\/inheritance:r/);
  assert.match(acl, /\*S-1-5-32-544:\(OI\)\(CI\)F/);
  assert.match(acl, /\*S-1-5-18:\(OI\)\(CI\)F/);
  assert.match(acl, /\*S-1-5-32-545:\(OI\)\(CI\)RX/);
  assert.doesNotMatch(acl, /S-1-5-32-545:\([^)]*\)\([^)]*\)(F|M|W)/, 'ученикам только чтение');
  assert.match(studentNsh, /\/setowner \*S-1-5-32-544/, 'владелец папки — Администраторы');
  // М5, Windows: явные правила ученика снимаются, права с (OI)(CI) — только на папку (с /T у файла пустой список доступа)
  const lock = studentNsh.slice(studentNsh.indexOf('!macro K1_LOCK_DIR'), studentNsh.indexOf('!macroend'));
  assert.ok(lock.indexOf('/setowner') < lock.indexOf('/reset /T') && lock.indexOf('/reset /T') < lock.indexOf('${K1_ACL}'), 'владелец, сброс, права');
  assert.match(lock, /\$\{K1_ACL\} \/C \/Q'/);
  assert.doesNotMatch(lock, /\$\{K1_ACL\}[^']*\/T/, 'права с (OI)(CI) не применяются к файлам через /T');
  assert.match(studentNsh, /\$EXEDIR\\school\.kibschool/);
  assert.doesNotMatch(studentNsh, /\$APPDATA|\$PROGRAMDATA|%ProgramData%/i, 'путь не из переменных');
  // Папка-ссылка (junction) снимается: проверка атрибута FILE_ATTRIBUTE_REPARSE_POINT
  assert.match(studentNsh, /GetFileAttributesW/);
  assert.match(studentNsh, /0x400/);
  // М5, Windows («замок»): прежняя папка отодвигается переименованием и создаётся заново, до копирования метки
  const fresh = studentNsh.slice(studentNsh.indexOf('!macro K1_FRESH_DIR'));
  assert.match(fresh, /takeown \/F "\$\{K1_DIR\}" \/A'[\s\S]*Rename "\$\{K1_DIR\}" "\$R4"[\s\S]*CreateDirectory "\$\{K1_DIR\}"[\s\S]*K1_LOCK_DIR/);
  assert.doesNotMatch(fresh, /takeown[^']*\/R/, 'без /R: takeown /R спрашивает Y/N на языке системы');
  const install = studentNsh.slice(studentNsh.indexOf('!macro customInstall'), studentNsh.indexOf('!macro customUnInstall'));
  assert.ok(install.indexOf('K1_FRESH_DIR') < install.indexOf('CopyFiles /SILENT "$R9"'));
  // Отодвинутая папка ученика удаляется только rmdir /s (ссылки внутри не проходит), а не RMDir /r
  assert.match(studentNsh, /cmd \/c rmdir \/s \/q "\$R4"/);
  assert.doesNotMatch(studentNsh, /RMDir \/r/);
});

test('Метка снимается при удалении, но не при обновлении', () => {
  const un = studentNsh.slice(studentNsh.indexOf('!macro customUnInstall'));
  assert.match(un, /\$\{IfNot\} \$\{isUpdated\}[\s\S]*Delete "\$\{K1_LABEL\}"[\s\S]*\$\{EndIf\}/);
});

test('И4: правило брандмауэра тьютора — TCP и UDP на порт сервера, своя подсеть, все профили, только программа тьютора', () => {
  const port = tutorNsh.match(/!define K1_PORT "(\d+)"/)[1];
  assert.match(read('desktop/tutor/server.js') + read('shared/netif.js'), new RegExp(`\\b${port}\\b`));
  const name = tutorNsh.match(/!define K1_RULE "([^"]+)"/)[1];
  assert.match(name, /^[\x20-\x7e]+$/, 'имя правила латиницей');
  const adds = [...tutorNsh.matchAll(/netsh advfirewall firewall add rule ([^']+)'/g)].map((m) => m[1]);
  assert.equal(adds.length, 2);
  for (const a of adds) {
    assert.match(a, /name="\$\{K1_RULE\}"/);
    assert.match(a, /dir=in action=allow/);
    assert.match(a, /program="\$INSTDIR\\kiberone-server\.exe"/);
    assert.match(a, /localport=\$\{K1_PORT\}/);
    assert.match(a, /remoteip=localsubnet/);
    assert.match(a, /profile=any/);
  }
  assert.deepEqual(adds.map((a) => a.match(/protocol=(\w+)/)[1]).sort(), ['TCP', 'UDP']);
  assert.equal(tutor.executableName, 'kiberone-server');
  // Перед добавлением старые правила удаляются, при удалении программы (не при обновлении) — тоже
  const install = tutorNsh.slice(tutorNsh.indexOf('!macro customInstall'), tutorNsh.indexOf('!macro customUnInstall'));
  assert.ok(install.indexOf('K1_RULE_DELETE') < install.indexOf('add rule'));
  const un = tutorNsh.slice(tutorNsh.indexOf('!macro customUnInstall'));
  assert.match(un, /\$\{IfNot\} \$\{isUpdated\}[\s\S]*K1_RULE_DELETE[\s\S]*\$\{EndIf\}/);
  assert.match(tutorNsh, /delete rule name="\$\{K1_RULE\}"/);
  // У ученика правил нет
  assert.doesNotMatch(studentNsh, /netsh|advfirewall/);
});

test('Заставка: текст только из index.html, без innerHTML, уходит сама и по клавише', () => {
  for (const dir of ['desktop/vitrina/ui', 'desktop/tutor/ui']) {
    const js = read(`${dir}/splash.js`);
    const html = read(`${dir}/index.html`);
    assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    assert.match(js, /textContent/);
    assert.match(js, /prefers-reduced-motion/);
    assert.match(js, /keydown/);
    assert.match(html, /id="splash"/);
    assert.match(html, /<script src="splash\.js" defer><\/script>/);
  }
});
