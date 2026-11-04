#!/usr/bin/env node
'use strict';
/* Тест-«взломщик». Запуск: npm run test:redteam
   Всё идёт в отдельном сетевом пространстве Linux: сюда попадает любой исходящий пакет, а наружу не уходит ничего,
   даже если защита сломана. Приёмник и захват трафика работают вне Electron, поэтому им нельзя соврать из приложения.
   Прогон без защиты обязателен: если какая-то атака не сработала и там, тест провален, а не пройден. */
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { keygen, pack } = require('../kibpack/pack');
const { readPackage } = require('../shared/package-format');

const APP = path.resolve(__dirname, '..');
const ELECTRON = path.join(APP, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
/* --portable: для Windows и других систем без сетевых пространств. Внутри такого прогона нет захвата трафика,
   поэтому К4 не проверяется и выводится как НЕ ПРОВЕРЕНО, а атаки идут на настоящий адрес этого компьютера. */
const PORTABLE = process.argv.includes('--portable');
const IN_NS = process.argv.includes('--in-namespace') || PORTABLE;
// Адрес школьной сети, а не VPN (находка 5 ОТЧЁТ-WINDOWS.md): тот же выбор, что у программ
const lanIp = () => (require('../shared/netif').schoolInterfaces()[0] || {}).address || '127.0.0.1';
const HOST = PORTABLE ? lanIp() : '10.99.0.1';
// 203.0.113.0/24 зарезервирован для примеров и никуда не ведёт: прогон без защиты никого не побеспокоит
const PUBLIC_IP = PORTABLE ? '203.0.113.1' : '93.184.216.34';
/* Electron 45 скачивает программу не при npm ci, а по отдельной команде. Без неё тест падал бы с ENOENT. */
if (!fs.existsSync(ELECTRON)) {
  console.log('Скачиваю Electron...');
  const installed = spawnSync(process.execPath, [path.join(APP, 'node_modules/electron/install.js')], { stdio: 'inherit' });
  if (installed.status !== 0 || !fs.existsSync(ELECTRON)) { console.error('Electron не скачался'); process.exit(1); }
}
const PORTS = { http: 18080, tcp: 18081, udp: 18082 };
const MARKER = `KIBLEAKMARKER${crypto.randomBytes(8).toString('hex')}`;
const NEIGHBOUR_SECRET = `KIBNEIGHBOUR${crypto.randomBytes(8).toString('hex')}`;

if (!IN_NS) {
  const uid = String(process.getuid());
  const gid = String(process.getgid());
  const outer = spawnSync('unshare', ['-Urn', process.execPath, __filename, '--in-namespace', uid, gid, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(outer.status === null ? 1 : outer.status);
}

const [uid, gid] = process.argv.slice(process.argv.indexOf('--in-namespace') + 1);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'redteam-'));

function setupNetwork() {
  if (PORTABLE) return;
  const script = `ip link set lo up && ip link add dummy0 type dummy && ip addr add ${HOST}/24 dev dummy0 && ip link set dummy0 up && ip route add default dev dummy0`;
  const r = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Сеть теста не поднялась: ${r.stderr}`);
}

/* Приёмник: считает всё, что до него дошло. */
function startCanary(gameDir) {
  const hits = { http: [], tcp: 0, udp: 0, dns: 0 };
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url.startsWith('/control/')) {
      const file = path.join(gameDir, path.basename(url));
      const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.txt': 'text/plain' }[path.extname(file)] || 'application/octet-stream';
      if (fs.existsSync(file)) { res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(file)); return; }
      res.writeHead(404); res.end(); return;
    }
    hits.http.push(url);
    if (url.includes('eventsource')) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(); return; }
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
    res.end('hit');
  });
  server.on('upgrade', (req, socket) => { hits.http.push(req.url.split('?')[0]); socket.destroy(); });
  const tcp = net.createServer((socket) => { hits.tcp += 1; socket.destroy(); });
  const udp = dgram.createSocket('udp4');
  udp.on('message', () => { hits.udp += 1; });
  const dns = dgram.createSocket('udp4');
  dns.on('message', () => { hits.dns += 1; });
  dns.on('error', () => {});

  return new Promise((resolve) => {
    server.listen(PORTS.http, HOST, () => tcp.listen(PORTS.tcp, HOST, () => udp.bind(PORTS.udp, HOST, () => {
      const ready = () => resolve({
        hits,
        reset() { hits.http = []; hits.tcp = 0; hits.udp = 0; hits.dns = 0; },
        close() { server.closeAllConnections?.(); server.close(); tcp.close(); udp.close(); if (!PORTABLE) dns.close(); },
      });
      if (PORTABLE) ready(); else dns.bind(53, '127.0.0.53', ready);
    })));
  });
}

/* Захват всех пакетов на всех интерфейсах, кроме служебных пакетов самого ядра. */
function startCapture() {
  if (PORTABLE) return Promise.resolve({ packets: [], stop: async () => {} });
  const proc = spawn('tcpdump', ['-Z', 'root', '-lnni', 'any', 'not igmp and not icmp6'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const packets = [];
  proc.stdout.on('data', (d) => packets.push(...d.toString().split('\n').filter(Boolean)));
  return new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.stderr.on('data', (d) => {
      if (String(d).includes('listening')) resolve({ packets, stop: async () => {
        await new Promise((r) => setTimeout(r, 400));
        proc.kill('SIGINT');
        await new Promise((r) => proc.on('close', r));
      } });
    });
  });
}

/* Обычный запуск от обычного пользователя внутри пространства. Ключа --no-sandbox здесь нет намеренно. */
function runElectron(args, env, timeoutMs = 120000) {
  const home = env.HOME;
  fs.mkdirSync(home, { recursive: true });
  return new Promise((resolve) => {
    const profile = `--user-data-dir=${path.join(home, 'profile')}`;
    const command = PORTABLE ? [ELECTRON, profile, ...args]
      : ['unshare', '-U', `--map-user=${uid}`, `--map-group=${gid}`, '--', ELECTRON, '--ozone-platform=headless', profile, ...args];
    const proc = spawn(command[0], command.slice(1), {
      env: { ...process.env, ...env, ...(PORTABLE ? {} : { DISPLAY: '' }) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.stdout.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    // exit, а не close: дочерний процесс может держать каналы вывода и после смерти основного
    proc.on('exit', (code) => { clearTimeout(timer); setTimeout(() => resolve({ code, stderr }), 300); });
  });
}

async function harnessRun(mode, base, home) {
  const out = path.join(tmp, `${mode}-${crypto.randomUUID()}.json`);
  const cfg = { ...base, mode, out };
  const { code, stderr } = await runElectron([path.join(__dirname, 'harness.js')], { HOME: home, REDTEAM_CONFIG: JSON.stringify(cfg) });
  if (!fs.existsSync(out)) throw new Error(`Режим ${mode} не дал результата (код ${code}):\n${stderr.slice(-2000)}`);
  const result = JSON.parse(fs.readFileSync(out, 'utf8'));
  if (result.fatal) throw new Error(`Режим ${mode}: ${result.fatal}`);
  return result;
}

/* Метку ищем и в UTF-8, и в UTF-16: так Chromium хранит строки в localStorage. */
function findOnDisk(dir, needle) {
  const variants = [Buffer.from(needle, 'utf8'), Buffer.from(needle, 'utf16le')];
  const found = [];
  const walk = (d) => {
    for (const item of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) {
        const data = fs.readFileSync(full);
        if (variants.some((v) => data.includes(v))) found.push(path.relative(dir, full));
      }
    }
  };
  walk(dir);
  return found;
}

const results = [];
function check(id, name, ok, detail = '') {
  results.push({ id, ok });
  console.log(`${ok ? 'OK    ' : 'ПРОВАЛ'} ${id.padEnd(4)} ${name}${detail ? `\n         ${detail}` : ''}`);
}

async function main() {
  setupNetwork();

  // Игры собираются настоящим kibpack и открываются настоящей проверкой
  const key = keygen('redteam', path.join(tmp, 'keys')).keyPath;
  // --m2: только проверки этапа М2 (для отладки, итог считается по ним же)
  // --m3: только проверки этапа М3 на настоящей программе (нагрузка — отдельно, redteam/load-run.js)
  // --m4: только проверки этапа М4 (оценки по сети) на настоящих сервере и программе
  if (process.argv.includes('--m4') && !PORTABLE) {
    await require('./net-run-m4')({ tmp, uid, gid, check, ELECTRON, APP, key });
    const failedM4 = results.filter((r) => !r.ok).length;
    console.log(`\nИтог: ${results.length - failedM4} из ${results.length} критериев выполнено.`);
    return failedM4 ? 1 : 0;
  }
  if (process.argv.includes('--m3') && !PORTABLE) {
    await require('./net-run-m3')({ tmp, uid, gid, check, ELECTRON, APP, key });
    const failedM3 = results.filter((r) => !r.ok).length;
    console.log(`\nИтог: ${results.length - failedM3} из ${results.length} критериев выполнено.`);
    return failedM3 ? 1 : 0;
  }
  if (process.argv.includes('--m2') && !PORTABLE) {
    await require('./net-run')({ tmp, uid, gid, check, ELECTRON, APP, key });
    const failedM2 = results.filter((r) => !r.ok).length;
    console.log(`\nИтог: ${results.length - failedM2} из ${results.length} критериев выполнено.`);
    return failedM2 ? 1 : 0;
  }
  const gameDir = path.join(tmp, 'game');
  fs.cpSync(path.join(__dirname, 'game'), gameDir, { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'config.js'), `window.CFG=${JSON.stringify({ host: HOST, ...PORTS, publicIp: PUBLIC_IP, marker: MARKER, neighbourSecret: NEIGHBOUR_SECRET })};`);
  const neighbourDir = path.join(tmp, 'neighbour');
  fs.cpSync(path.join(__dirname, 'neighbour'), neighbourDir, { recursive: true });
  fs.writeFileSync(path.join(neighbourDir, 'secret.txt'), NEIGHBOUR_SECRET);

  const packTo = async (folder, name) => (await pack(folder, { key, out: path.join(tmp, name) })).target;
  const gameFile = await packTo(gameDir, 'redteam.kibgames');
  const neighbourFile = await packTo(neighbourDir, 'neighbour.kibgames');
  const realGames = [
    await packTo(path.join(APP, '..', 'games', 'kiberpochta'), 'kiberpochta.kibgames'),
    await packTo(path.join(APP, '..', 'games', 'vzlomai-seif'), 'vzlomai-seif.kibgames'),
  ];
  // Самозванец: тот же id, что у соседней игры, но другой автор и другое содержимое
  const impostorKey = keygen('impostor', path.join(tmp, 'keys')).keyPath;
  const impostorDir = path.join(tmp, 'impostor');
  fs.cpSync(path.join(__dirname, 'neighbour'), impostorDir, { recursive: true });
  fs.writeFileSync(path.join(impostorDir, 'secret.txt'), 'IMPOSTOR');
  const impostorFile = (await pack(impostorDir, { key: impostorKey, out: path.join(tmp, 'impostor.kibgames') })).target;

  const base = { host: HOST, ...PORTS, gameFile, neighbourFile, impostorFile, realGames };
  const canary = await startCanary(gameDir);

  // Контрольный прогон: защиты нет, атаки обязаны дойти
  console.log('Прогон без защиты...');
  const controlHome = path.join(tmp, 'home-control');
  let capture = await startCapture();
  const control = await harnessRun('control', base, controlHome);
  await capture.stop();
  const controlPackets = capture.packets.length;
  const controlHits = new Set(canary.hits.http.map((u) => u.replace('/hit/', '')));
  if (canary.hits.tcp) controlHits.add('preconnect');
  if (canary.hits.udp) controlHits.add('webrtc-udp');
  if (capture.packets.some((p) => p.includes(PUBLIC_IP))) controlHits.add('public-ip-packet');
  for (const name of Object.keys(control.attacks.navigation)) {
    if (!['nav-file', 'nav-file-open', 'nav-download'].includes(name)) control.attacks.channels.push(name);
  }
  const expected = control.attacks.channels.filter((c) => !(PORTABLE && c === 'public-ip-packet'));
  const silent = expected.filter((c) => !controlHits.has(c));
  const controlDisk = findOnDisk(controlHome, MARKER);
  canary.reset();

  // Настоящий прогон
  console.log('Прогон с защитой...\n');
  const home = path.join(tmp, 'home');
  capture = await startCapture();
  const hard = await harnessRun('hardened', base, home);
  await capture.stop();
  const hardHits = JSON.parse(JSON.stringify(canary.hits));
  const hardPackets = capture.packets.slice();
  const disk = findOnDisk(home, MARKER);

  capture = await startCapture();
  const second = await harnessRun('second-run', base, home);
  // Настоящая оболочка с настоящей игрой: сама она тоже не должна выходить в сеть
  // Автор здесь в списке доверия школы, поэтому оболочка должна запустить игру без вопросов
  const liveHome = path.join(tmp, 'home-live');
  fs.mkdirSync(path.join(liveHome, 'profile'), { recursive: true });
  const { trust: liveTrust } = await readPackage(realGames[0]);
  fs.writeFileSync(path.join(liveHome, 'profile', 'trusted-keys.json'), JSON.stringify({ [liveTrust.keyId]: 'Тест' }));
  const live = await runElectron([APP, '--quiet-errors', realGames[0]], { HOME: liveHome }, 8000);
  await capture.stop();

  const { local, devices, navigation } = hard.attacks;
  const bad = (obj) => Object.entries(obj).filter(([, v]) => v !== 'blocked' && v !== 'works').map(([k, v]) => `${k}: ${v}`);
  const pick = (...names) => Object.fromEntries(names.map((n) => [n, local[n]]));

  // К1: настоящие игры. Шрифты Сейфа с Google заблокированы намеренно, это известный долг этапа 0
  const gameIssues = Object.entries(hard.realGames).flatMap(([id, g]) => [
    ...(g.text < 20 ? [`${id}: пустой экран`] : []),
    ...g.errors.filter((e) => !e.includes('fonts.googleapis.com')).map((e) => `${id}: ${e.slice(0, 200)}`),
  ]);
  // Код null: оболочка работала, пока тест её не остановил
  if (live.code !== null) gameIssues.push(`оболочка завершилась сама с кодом ${live.code}: ${live.stderr.slice(-200)}`);
  check('К1', 'Настоящие игры работают в песочнице', gameIssues.length === 0 && local['own-file'] === 'works',
    gameIssues.join('; ') || Object.entries(hard.realGames).map(([id, g]) => `${id}: текста ${g.text} знаков`).join(', '));

  const hardTotal = hardHits.http.length + hardHits.tcp + hardHits.udp + hardHits.dns;
  check('К2', `Сетевые атаки не дошли до приёмника (${hard.attacks.channels.length} каналов)`,
    hardTotal === 0 && local['webrtc-ip'] === 'blocked', hardTotal ? JSON.stringify(hardHits) : `webrtc-ip: ${local['webrtc-ip']}`);

  check('К3', 'Без защиты сработал каждый канал, тест не пустой', silent.length === 0,
    silent.length ? `молчат: ${silent.join(', ')}` : `дошло каналов: ${expected.length}`);

  if (PORTABLE) console.log('НЕ ПРОВЕРЕНО К4   Захват пакетов в этом режиме не работает, проверьте вручную');
  else check('К4', 'Ни одного исходящего пакета с защитой, захват работает', hardPackets.length === 0 && capture.packets.length === 0 && controlPackets > 0,
    `с защитой: ${hardPackets.length}, второй запуск и оболочка: ${capture.packets.length}, без защиты: ${controlPackets}${hardPackets.length ? `\n         ${hardPackets.slice(0, 8).join('\n         ')}` : ''}`);

  const fileLeaks = bad(pick('file-fetch', 'file-xhr', 'path-traversal', 'node-globals', 'service-worker'));
  check('К5', 'Нет доступа к файлам и Node', fileLeaks.length === 0, fileLeaks.join('; '));

  const neighbourLeaks = bad(pick('neighbour-fetch', 'neighbour-page', 'neighbour-storage', 'neighbour-iframe'));
  const neighbourIsReal = hard.neighbourOwn === NEIGHBOUR_SECRET;
  check('К6', 'Соседняя игра недоступна, при этом сама читает свой файл', neighbourLeaks.length === 0 && neighbourIsReal, neighbourLeaks.join('; '));

  // Без защиты виртуальные устройства должны открываться: значит, отказ с защитой настоящий
  const deviceLeaks = bad(devices);
  const controlDevices = control.attacks.devices;
  const controlOpen = ['camera', 'microphone'].every((d) => controlDevices[d] === 'LEAK');
  check('К7', `Устройства недоступны (${Object.keys(devices).length} проверок)`, deviceLeaks.length === 0 && controlOpen,
    `${deviceLeaks.join('; ')}${controlOpen ? 'без защиты камера и микрофон открылись' : `без защиты: ${JSON.stringify(controlDevices)}`}`);

  const moved = Object.entries(navigation).filter(([, v]) => !v.urlStayed || v.windows !== 0).map(([k]) => k);
  const logged = (kind, text) => hard.events.some((e) => e.kind === kind && e.detail.includes(text));
  // Переходы на file: Chromium отклоняет сам, до наших обработчиков, поэтому их проверяет moved, а не журнал
  const required = [['navigation', 'mailto:'], ['navigation', 'kibleak:'], ['navigation', '/hit/nav-location'],
    ['window', '/hit/nav-open'], ['download', 'leak.txt']];
  const refused = required.filter(([k, t]) => !logged(k, t)).map(([k, t]) => `${k} ${t}`);
  check('К8', 'Окно не уводится, новые окна, внешние программы и скачивание отклонены', moved.length === 0 && refused.length === 0,
    moved.length || refused.length ? `ушло: ${moved.join(', ')}; нет в журнале: ${refused.join(', ')}` : `отказов в журнале: ${hard.events.length}`);

  const marks = second.storage;
  const leftovers = [marks.session, marks.local, marks.indexed].filter(Boolean);
  const reloadKept = hard.beforeReload.session === MARKER && hard.afterReload.session === MARKER;
  check('К9', 'На диске нет следов, F5 сохраняет прогресс', disk.length === 0 && leftovers.length === 0 && reloadKept && controlDisk.length > 0,
    `след с защитой: ${disk.length ? disk.join(', ') : 'нет'}; без защиты метка найдена в файлах: ${controlDisk.length}; F5: ${reloadKept ? 'сохранил' : 'потерял'}`);

  const states = [hard.state, hard.neighbourState];
  const sandboxOk = states.every((s) => (s.platform === 'win32'
    ? s.sandboxed === true && ['untrusted', 'low'].includes(s.integrityLevel)
    : s.seccomp === '2' && s.ownUserNs && s.ownPidNs && !s.noSandboxFlag));
  check('К10', 'Системная песочница включена', sandboxOk, JSON.stringify(hard.state));

  check('К12', 'Игру нельзя сделать незакрываемой через beforeunload', hard.closable === true);
  check('К13', 'Файл с тем же id не подменяет запущенную игру', hard.afterImpostor === NEIGHBOUR_SECRET, `после самозванца: ${hard.afterImpostor}`);

  // К11: запуск настоящей оболочки
  const broken = path.join(tmp, 'broken.kibgames');
  const tampered = path.join(tmp, 'tampered.kibgames');
  fs.writeFileSync(broken, 'это не игра');
  const original = fs.readFileSync(gameFile);
  const flipped = Buffer.from(original);
  flipped[Math.floor(flipped.length / 2)] ^= 0xff;
  fs.writeFileSync(tampered, flipped);
  const shell = (file) => runElectron([APP, '--quiet-errors', file], { HOME: path.join(tmp, 'home-shell') }, 25000);
  const a = await shell(broken);
  const b = await shell(tampered);
  const clear = (r) => r.code === 1 && /Ошибка: /.test(r.stderr);
  check('К11', 'Сломанный и поддельный файлы не запускаются', clear(a) && clear(b),
    `сломанный: ${(a.stderr.match(/Ошибка: .*/) || [`код ${a.code}`])[0]}; поддельный: ${(b.stderr.match(/Ошибка: .*/) || [`код ${b.code}`])[0]}`);

  const unknown = await shell(realGames[0]);
  check('К14', 'Неизвестный автор не запускается без подтверждения', unknown.code === 1 && /неизвестен/.test(unknown.stderr), (unknown.stderr.match(/Ошибка: .*/) || [`код ${unknown.code}`])[0]);

  await vitrinaChecks({ key, canary, realGames });
  await tutorChecks({ key, canary });
  if (PORTABLE) console.log('НЕ ПРОВЕРЕНО К15–К19, К21, К25, К20а, К20б, К27, К28, С1, С3, С4, С6, Н7, Р2   Нужны сетевые пространства Linux, на Windows — windows-m2.md, windows-m3.md, windows-m4.md');
  else {
    await require('./net-run')({ tmp, uid, gid, check, ELECTRON, APP, key });
    await require('./net-run-m3')({ tmp, uid, gid, check, ELECTRON, APP, key });
    await require('./net-run-m4')({ tmp, uid, gid, check, ELECTRON, APP, key });
  }

  canary.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nИтог: ${results.length - failed} из ${results.length} критериев выполнено.`);
  if (process.argv.includes('--dump')) console.log(JSON.stringify({ hard, control }, null, 1));
  return failed ? 1 : 0;
}

/* ---------- Окно витрины, этап В0: К23, В3–В5, В9, В11, В12 ---------- */
async function vitrinaRun(mode, cfg, home) {
  const out = path.join(tmp, `${mode}-${crypto.randomUUID()}.json`);
  const { code, stderr } = await runElectron([path.join(__dirname, 'vitrina-harness.js')], { HOME: home, REDTEAM_CONFIG: JSON.stringify({ ...cfg, mode, out }) }, 180000);
  if (!fs.existsSync(out)) throw new Error(`Режим ${mode} не дал результата (код ${code}):\n${stderr.slice(-2000)}`);
  const result = JSON.parse(fs.readFileSync(out, 'utf8'));
  if (result.fatal) throw new Error(`Режим ${mode}: ${result.fatal}`);
  return result;
}

async function vitrinaChecks({ key, canary, realGames }) {
  // Игра, у которой в названии, описании и режиме разметка со скриптом. Название до 80 знаков по правилам формата
  const xssTitle = `<img src=x onerror="__k23=1;fetch('http://${HOST}:${PORTS.http}/hit/k23-xss')">`;
  const xssDir = path.join(tmp, 'xss');
  fs.mkdirSync(xssDir);
  fs.writeFileSync(path.join(xssDir, 'index.html'), '<!doctype html><title>x</title>');
  fs.writeFileSync(path.join(xssDir, 'kibgame.json'), JSON.stringify({
    id: 'xss-nazvanie', version: '1.0.0', title: xssTitle, description: '<script>__k23=2</script><svg onload="__k23=3"></svg> описание',
    authors: ['<img src=x onerror=__k23=5>'], grades: '4–5 класс', minutes: 5, topic: 'Тест', entry: 'index.html', minAppVersion: '1.0.0',
    modes: [{ id: 'a', title: '<b onmouseover=__k23=4>Режим</b>', about: '<svg onload=__k23=6></svg>' }, { id: 'b', title: 'Обычный' }],
  }));
  const catalogDir = path.join(tmp, 'vitrina-games');
  fs.mkdirSync(catalogDir);
  fs.copyFileSync(realGames[0], path.join(catalogDir, 'kiberpochta.kibgames'));
  await pack(path.join(APP, 'testgames', 'tri-rezhima'), { key, out: path.join(catalogDir, 'tri-rezhima.kibgames') });
  await pack(xssDir, { key, out: path.join(catalogDir, 'xss.kibgames') });
  const { trust } = await readPackage(realGames[0]);
  const trustedKeys = { [trust.keyId]: 'Тест' };
  const cfg = (name) => {
    const dataDir = path.join(tmp, `vdata-${name}`);
    fs.mkdirSync(dataDir, { recursive: true });
    return { host: HOST, http: PORTS.http, catalogDir, dataDir, trustedKeys };
  };
  const k23Hits = () => new Set(canary.hits.http.filter((u) => u.startsWith('/hit/k23-')).map((u) => u.replace('/hit/', '')));
  const NET = ['k23-xss', 'k23-fetch', 'k23-img', 'k23-ws', 'k23-beacon', 'k23-font', 'k23-css'];

  console.log('\nВитрина: прогон без защиты...');
  canary.reset();
  let capture = await startCapture();
  const control = await vitrinaRun('vitrina-control', cfg('control'), path.join(tmp, 'home-vcontrol'));
  await capture.stop();
  const controlHits = k23Hits();
  const controlPackets = capture.packets.length;

  console.log('Витрина: прогон с защитой...\n');
  canary.reset();
  capture = await startCapture();
  const hard = await vitrinaRun('vitrina', cfg('hard'), path.join(tmp, 'home-vitrina'));
  const ipc = await vitrinaRun('vitrina-ipc', cfg('ipc'), path.join(tmp, 'home-vipc'));
  // Настоящая оболочка без файла открывает витрину: она тоже не должна выходить в сеть
  const liveHome = path.join(tmp, 'home-vlive');
  fs.mkdirSync(path.join(liveHome, 'profile'), { recursive: true });
  fs.writeFileSync(path.join(liveHome, 'profile', 'trusted-keys.json'), JSON.stringify(trustedKeys));
  const live = await runElectron([APP, `--catalog=${catalogDir}`], { HOME: liveHome }, 10000);
  await capture.stop();
  const hardHits = canary.hits.http.length + canary.hits.tcp + canary.hits.udp + canary.hits.dns;
  const hardPackets = capture.packets.slice();

  // К23
  const silent = NET.filter((c) => !controlHits.has(c));
  const x = hard.xss;
  const shownAsText = x.cardTitle === xssTitle && x.modalTitle === xssTitle && x.tabText.includes('<b onmouseover=__k23=4>Режим</b>');
  check('К23', 'Окно витрины не выполняет разметку из каталога и не выходит в сеть',
    control.replaced === 1 && control.xss.executed !== null && silent.length === 0
      && x.executed === null && x.injected === 0 && shownAsText && hard.surface.trustedTypes === 'blocked' && hardHits === 0
      && (PORTABLE || hardPackets.length === 0),
    `без защиты: скрипт из названия выполнился (${control.xss.executed}), дошли ${controlHits.size} из ${NET.length} каналов${silent.length ? `, молчат: ${silent.join(', ')}` : ''};`
    + `\n         с защитой: скрипт ${x.executed === null ? 'не выполнился' : `ВЫПОЛНИЛСЯ (${x.executed})`}, название показано текстом: ${shownAsText ? 'да' : `нет (${x.cardTitle})`},`
    + ` innerHTML: ${hard.surface.trustedTypes}, до приёмника дошло: ${hardHits}, пакетов: ${PORTABLE ? 'не проверено' : hardPackets.length}`);

  // В9
  const rejected = (r) => r && !r.ok;
  const unknownOk = Object.values(ipc.unknown).every(rejected);
  const b = ipc.badArgs;
  const badOk = ['launchUnknownGame', 'launchPathGame', 'launchUnknownMode', 'launchPathMode', 'launchObject', 'launchExtraArg', 'voteSix',
    'voteString', 'voteUnknownGame', 'listWithArg', 'addressExtra'].every((k) => rejected(b[k])) && b.voteUnplayed.ok && b.voteUnplayed.value.reason === 'not-played'
    && b.addressFolder.ok && b.addressFolder.value.reason === 'not-configured' && b.addressPath.ok && b.addressPath.value.reason === 'not-ip';
  const goodOk = ipc.rawReady === 'object' && ipc.good.list.ok && ipc.good.launch.ok && ipc.good.launch.value.ok === true
    && ipc.good.vote.ok && ipc.good.vote.value.ok === true && ipc.good.voteAgain.value.reason === 'already';
  const keysOk = JSON.stringify(hard.surface.k1) === JSON.stringify(['catalogList', 'launch', 'onCatalogChanged', 'onGameClosed', 'setAddress', 'vote'])
    && hard.surface.require === 'undefined' && hard.surface.process === 'undefined';
  check('В9', 'IPC витрины: только свои каналы, чужие id и аргументы отклонены', unknownOk && badOk && goodOk && keysOk,
    `неизвестные каналы: ${unknownOk ? 'отклонены' : JSON.stringify(ipc.unknown)}; плохие аргументы: ${badOk ? 'отклонены' : JSON.stringify(b)};`
    + ` верные вызовы: ${goodOk ? 'работают' : JSON.stringify(ipc.good).slice(0, 300)}; окну видно: ${hard.surface.k1.join(', ')}, require: ${hard.surface.require}`);

  // В3
  const v3 = hard.custom && hard.custom.url === 'kibgame://tri-rezhima/custom.html?mode=custom' && hard.custom.text.includes('режим: custom')
    && hard.afterClose.includes('Как тебе?') && hard.afterClose.includes('Три режима · Свой путь') && hard.plainUrl === 'kibgame://kiberpochta/index.html';
  check('В3', '«Играть» открывает выбранный режим, после закрытия окно оценки этого режима', v3,
    `адрес игры: ${hard.custom && hard.custom.url}; без режимов: ${hard.plainUrl}; после закрытия: ${hard.afterClose.replace(/\s+/g, ' ').slice(0, 60)}`);

  // В4 и В5 через настоящий интерфейс (модульные тесты: test/ratings.test.js)
  const customCounts = (r) => r && r.games['tri-rezhima'] && r.games['tri-rezhima'].custom;
  const v4 = hard.counting.includes('Записали: 4 из 5') && !customCounts(hard.afterUndo.ratings) && !customCounts(hard.at45)
    && JSON.stringify(customCounts(hard.afterSend.ratings)) === JSON.stringify({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 }) && hard.afterSend.text.includes('Спасибо');
  check('В4', 'В интерфейсе: «Отменить» снимает голос, иначе он уходит через 5 с', v4,
    `после отмены и 5 с: ${JSON.stringify(customCounts(hard.afterUndo.ratings) || 'нет записи')}; через 4,5 с: ${JSON.stringify(customCounts(hard.at45) || 'нет записи')}; через 6 с: ${JSON.stringify(customCounts(hard.afterSend.ratings))}`);
  const v5 = hard.afterSend.state && hard.afterSend.state.voted.includes('tri-rezhima/custom') && hard.again.includes('Ты уже оценил этот режим сегодня')
    && hard.againIpc.reason === 'already';
  check('В5', 'В интерфейсе: второй раз в тот же день тот же режим не оценить', v5,
    `state.json: ${JSON.stringify(hard.afterSend.state)}; повторный голос: ${hard.againIpc.reason}`);

  // В11
  const requests = hard.events.filter((e) => e.kind === 'request').map((e) => e.detail);
  const foreign = requests.filter((u) => !u.startsWith('kibapp://'));
  const fontsOk = hard.fonts.includes('Golos Text') && hard.fonts.includes('JetBrains Mono');
  check('В11', 'Витрина без сети: шрифты свои, внешних обращений 0', fontsOk && foreign.length === 0 && hardHits === 0
    && live.code === null && (PORTABLE || (hardPackets.length === 0 && controlPackets > 0)),
    `шрифты: ${[...new Set(hard.fonts)].join(', ')}; запросов окна: ${requests.length}, из них не kibapp: ${foreign.length};`
    + ` пакетов с защитой и в настоящей оболочке: ${PORTABLE ? 'не проверено' : hardPackets.length}, без защиты: ${controlPackets}; оболочка: ${live.code === null ? 'работала' : `вышла с кодом ${live.code}`}`);

  // В12 (автоматическая часть)
  const small = hard.sizes.filter((s) => s.w < 44 || s.h < 44 || (s.cls.includes('star') && (s.w < 64 || s.h < 64)));
  const kb = hard.kbOpen.cls.includes('btn-play') && hard.kbTabs.every((a) => a.inModal) && hard.kbClosed.overlayHidden && hard.kbClosed.focus.id === 'tri-rezhima';
  const motion = hard.motionNormal > 0 && hard.motionReduced === 0 && hard.motionMatch === true;
  check('В12', 'Клавиатура, кнопки от 44 px, без анимаций при prefers-reduced-motion', small.length === 0 && kb && motion,
    `кнопок проверено: ${hard.sizes.length}, меньше нормы: ${small.length ? JSON.stringify(small) : 0}; клавиатура: ${kb ? 'Enter открыл, фокус на «Играть», Tab не вышел из окна, Esc закрыл, фокус на карточке' : JSON.stringify({ open: hard.kbOpen, tabs: hard.kbTabs, closed: hard.kbClosed })};`
    + ` анимаций при открытии: обычно ${hard.motionNormal}, с reduced-motion ${hard.motionReduced}`);
}

/* ---------- Этап М1: окно программы тьютора ---------- */

async function tutorRun(mode, cfg, home) {
  const out = path.join(tmp, `${mode}-${crypto.randomUUID()}.json`);
  const { code, stderr } = await runElectron([path.join(__dirname, 'tutor-harness.js')], { HOME: home, REDTEAM_CONFIG: JSON.stringify({ ...cfg, mode, out }) }, 180000);
  if (!fs.existsSync(out)) throw new Error(`Режим ${mode} не дал результата (код ${code}):\n${stderr.slice(-2000)}`);
  const result = JSON.parse(fs.readFileSync(out, 'utf8'));
  if (result.fatal) throw new Error(`Режим ${mode}: ${result.fatal}`);
  return result;
}

async function tutorChecks({ key, canary }) {
  // Игра, у которой разметка со скриптом в названии, описании, авторе и режимах. Тьютор вносит автора под именем с разметкой
  const xssTitle = `<img src=x onerror="__k24=1;fetch('http://${HOST}:${PORTS.http}/hit/k24-xss')">`;
  const xssAuthor = `<img src=x onerror="__k24=7;fetch('http://${HOST}:${PORTS.http}/hit/k24-xss')">`;
  const xssDir = path.join(tmp, 'xss-tutor');
  fs.mkdirSync(xssDir);
  fs.writeFileSync(path.join(xssDir, 'index.html'), '<!doctype html><title>x</title>');
  fs.writeFileSync(path.join(xssDir, 'kibgame.json'), JSON.stringify({
    id: 'xss-tyutor', version: '1.0.0', title: xssTitle, description: '<script>__k24=2</script><svg onload="__k24=3"></svg> описание',
    authors: ['<img src=x onerror=__k24=5>'], grades: '4–5 класс', minutes: 5, topic: '<svg onload=__k24=8></svg>', entry: 'index.html', minAppVersion: '1.0.0',
    modes: [{ id: 'a', title: '<b onmouseover=__k24=4>Режим</b>', about: '<svg onload=__k24=6></svg>' }, { id: 'b', title: 'Обычный' }],
  }));
  const xssFile = path.join(tmp, 'xss-tyutor.kibgames');
  await pack(xssDir, { key, out: xssFile });
  const goodFile = path.join(tmp, 'tri-rezhima-tutor.kibgames');
  await pack(path.join(APP, 'testgames', 'tri-rezhima'), { key, out: goodFile });
  const cfg = (name) => {
    const dataDir = path.join(tmp, `tdata-${name}`);
    const backupDir = path.join(tmp, `tbackup-${name}`);
    fs.mkdirSync(backupDir, { recursive: true });
    return { host: HOST, http: PORTS.http, dataDir, backupDir, xssFile, xssAuthor, goodFile };
  };
  const hits = () => new Set(canary.hits.http.filter((u) => u.startsWith('/hit/k24-')).map((u) => u.replace('/hit/', '')));
  const NET = ['k24-xss', 'k24-fetch', 'k24-img', 'k24-ws', 'k24-beacon', 'k24-font', 'k24-css'];

  console.log('\nОкно тьютора: прогон без защиты...');
  canary.reset();
  let capture = await startCapture();
  const control = await tutorRun('tutor-control', cfg('control'), path.join(tmp, 'home-tcontrol'));
  await capture.stop();
  const controlHits = hits();
  const controlPackets = capture.packets.length;

  console.log('Окно тьютора: прогон с защитой...\n');
  canary.reset();
  capture = await startCapture();
  const hard = await tutorRun('tutor', cfg('hard'), path.join(tmp, 'home-tutor'));
  const ipc = await tutorRun('tutor-ipc', cfg('ipc'), path.join(tmp, 'home-tipc'));
  // Настоящая программа тьютора без школы: окно открывается и не выходит в сеть
  const live = await runElectron([path.join(APP, 'desktop', 'tutor', 'main.js'), `--data=${path.join(tmp, 'tdata-live')}`], { HOME: path.join(tmp, 'home-tlive') }, 10000);
  await capture.stop();
  const hardHits = canary.hits.http.length + canary.hits.tcp + canary.hits.udp + canary.hits.dns;
  const hardPackets = capture.packets.slice();

  // К24 (Т13)
  const silent = NET.filter((c) => !controlHits.has(c));
  const x = hard.xss;
  const shownAsText = x.rowTitle === xssTitle && x.rowAuthor === xssAuthor && hard.modal.title === xssTitle
    && hard.modal.facts.includes('<img src=x onerror=__k24=5>') && x.modes.includes('<b onmouseover=__k24=4>Режим</b>');
  check('К24', 'Окно тьютора не выполняет разметку из .kibgames и не выходит в сеть',
    control.replaced === 1 && control.xss.executed !== null && silent.length === 0
      && x.executed === null && hard.modal.executed === null && x.injected === 0 && shownAsText && hard.surface.trustedTypes === 'blocked'
      && hardHits === 0 && (PORTABLE || (hardPackets.length === 0 && controlPackets > 0)) && live.code === null,
    `без защиты: скрипт выполнился (${control.xss.executed}), дошли ${controlHits.size} из ${NET.length} каналов${silent.length ? `, молчат: ${silent.join(', ')}` : ''};`
    + `\n         с защитой: скрипт ${x.executed === null ? 'не выполнился' : `ВЫПОЛНИЛСЯ (${x.executed})`}, название и автор показаны текстом: ${shownAsText ? 'да' : `нет (${x.rowTitle} / ${x.rowAuthor})`},`
    + ` innerHTML: ${hard.surface.trustedTypes}, до приёмника дошло: ${hardHits}, пакетов: ${PORTABLE ? 'не проверено' : `${hardPackets.length} (без защиты ${controlPackets})`};`
    + ` настоящая программа: ${live.code === null ? 'работала' : `вышла с кодом ${live.code}`}`);

  // Т12
  const rejected = (r) => r && !r.ok;
  const refused = (r) => r && r.ok && r.value && r.value.ok === false;
  const unknownOk = Object.values(ipc.unknown).every(rejected);
  const lockedOk = Object.values(ipc.locked).every((r) => refused(r) && /закрыт/.test(r.value.error)) && ipc.pickedWhileLocked.length === 0;
  const badOk = Object.values(ipc.badArgs).every(rejected);
  const g = ipc.good;
  const goodOk = ipc.rawReady === 'object' && g.unlock.ok && g.unlock.value.ok && g.pick.ok && g.pick.value.ok
    && refused(g.publishNoConfirm) && g.publish.ok && g.publish.value.ok && g.lesson.ok && g.lesson.value.ok
    && g.state.ok && g.state.value.games.length === 1 && g.state.value.games[0].lesson === true && g.backup.ok && g.backup.value.ok
    && g.snapshot.ok && g.snapshot.value.ok && /^\{\s*"format": 1/.test(ipc.snapshotText || '') && ipc.picked.some((x) => /^saveRatings ocenki-\d{4}-\d{2}-\d{2}\.json$/.test(x));
  const leak = JSON.stringify(ipc.good).includes(tmp) || (ipc.pickKeys || []).includes('sha256');
  const keysOk = JSON.stringify(hard.surface.k1t) === JSON.stringify(['backup', 'cancel', 'createSchool', 'lock', 'onLocked', 'pickGame', 'publish', 'recover', 'restoreSchool', 'saveRatings', 'saveSchoolFile', 'setFast', 'setLesson', 'startServer', 'state', 'stopServer', 'tryGame', 'unlock', 'unpublish'])
    && hard.surface.require === 'undefined' && hard.surface.process === 'undefined';
  check('Т12', 'IPC окна тьютора: только свои каналы, без путей к файлам, без входа действия с ключом отклонены',
    unknownOk && lockedOk && badOk && goodOk && !leak && keysOk,
    `неизвестные каналы: ${unknownOk ? 'отклонены' : JSON.stringify(ipc.unknown)}; без входа: ${lockedOk ? 'отклонено, окно выбора файла не открывалось' : JSON.stringify({ locked: ipc.locked, picked: ipc.pickedWhileLocked })};`
    + ` плохие аргументы и пути: ${badOk ? 'отклонены' : JSON.stringify(ipc.badArgs)}; верные вызовы: ${goodOk ? 'работают' : JSON.stringify(g).slice(0, 400)};`
    + ` пути в ответах окну: ${leak ? 'ЕСТЬ' : 'нет'}; окну видно: ${hard.surface.k1t.length} функций, require: ${hard.surface.require}`);

  // Интерфейс тьютора целиком: создание школы, код, публикация с подтверждением, закрытие ключа
  const ui = /не меньше 10 знаков/.test(hard.shortPassword) && /^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}-[0-9A-Z]{6}$/.test(hard.code) && hard.doneDisabled === true
    && hard.modal.publishDisabled === true && hard.lockedHeader === 'ключ школы закрыт' && hard.lockedLesson.ok === false
    && hard.fonts.includes('Golos Text') && hard.fonts.includes('JetBrains Mono');
  check('М1', 'Окно тьютора: школа, код восстановления, публикация с подтверждением, закрытие ключа', ui,
    `короткий пароль: «${hard.shortPassword}»; код: ${hard.code}; «Готово» до галочки: ${hard.doneDisabled ? 'неактивна' : 'активна'};`
    + ` «Опубликовать» до подтверждения: ${hard.modal.publishDisabled ? 'неактивна' : 'активна'}; после «Закрыть ключ»: «${hard.lockedHeader}», отметка занятия: ${hard.lockedLesson.error}`);

  // С7, С8: раздача через окно тьютора. Вне захвата: здесь сеть нужна по замыслу
  if (PORTABLE) { console.log('НЕ ПРОВЕРЕНО С7   Раздача через окно тьютора проверяется в сетевом пространстве Linux'); return; }
  const sv = await tutorRun('tutor-serve', { ...cfg('serve'), iface: 'dummy0', host: HOST }, path.join(tmp, 'home-tserve'));
  const refusedSv = (x) => x && x.ok && x.value && x.value.ok === false;
  const rejectedSv = (x) => x && !x.ok;
  const badSv = refusedSv(sv.bad.byAddress) && refusedSv(sv.bad.path) && rejectedSv(sv.bad.object) && rejectedSv(sv.bad.extra) && rejectedSv(sv.bad.stopArg);
  const svOk = refusedSv(sv.noSchool) && sv.offAfterStart.on === false && sv.closedBefore.error && sv.interfaces.some((i) => i.name === 'dummy0' && i.address === HOST)
    && sv.start.ok && sv.start.value.ok && sv.unlocked === false && sv.on.on && sv.on.address === HOST && sv.catalog.status === 200 && sv.notModified.status === 304
    && sv.origin.status === 403 && sv.dom.includes(HOST) && sv.stop.value.ok && sv.after.error && sv.offState.on === false;
  check('С7', 'Раздача: выключена при запуске, включается по выбранной сети, работает при закрытом ключе, после выключения соединений нет', svOk,
    `до включения: ${sv.closedBefore.error}; сети в списке: ${sv.interfaces.map((i) => `${i.name} ${i.address}`).join(', ')}; при закрытом ключе: каталог ${sv.catalog.status}, повтор ${sv.notModified.status}, Origin ${sv.origin.status};`
    + ` на экране: «${(sv.dom.match(/Адрес для учеников\s*[\d.]+/) || [sv.dom.slice(0, 60)])[0]}»; после выключения: ${sv.after.error || sv.after.status}`);
  const fastOk = rejectedSv(sv.fast.bad) && rejectedSv(sv.fast.extra) && sv.fast.on.ok && sv.fast.on.value.ok && sv.fast.on.value.state.serve.limited === false
    && sv.fast.off.value.state.serve.limited === true && sv.on.limited === true && /до 30 Мбит\/с · качают 0 · ждут 0/.test(sv.dom) && refusedSv(sv.fast.whenOff);
  check('Н2', '«Скачать быстрее» через окно тьютора: снимает и возвращает предел, неверные аргументы и вызов при выключенной раздаче отклонены', fastOk,
    `после включения: ${sv.on.limited ? 'предел стоит' : 'предела нет'}; «Скачать быстрее»: ${sv.fast.on.ok && sv.fast.on.value.state ? (sv.fast.on.value.state.serve.limited ? 'предел остался' : 'предел снят') : JSON.stringify(sv.fast.on)}; `
    + `строка «${(sv.dom.match(/до 30 Мбит\/с[^А-Я]*ждут \d+/) || ['нет'])[0]}»; раздача выключена: ${sv.fast.whenOff.value && sv.fast.whenOff.value.error}`);
  check('С8', 'IPC раздачи: сеть только по имени из списка, адрес, путь, объект и лишние аргументы отклонены', badSv && keysOk,
    `адрес вместо имени: ${sv.bad.byAddress.value && sv.bad.byAddress.value.error}; путь: ${sv.bad.path.value && sv.bad.path.value.error}; объект и лишний аргумент: отклонены ${rejectedSv(sv.bad.object) && rejectedSv(sv.bad.extra)}`);
}

main().then((code) => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(code); }).catch((err) => {
  console.error(err);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
