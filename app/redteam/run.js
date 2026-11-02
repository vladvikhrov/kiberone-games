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
const lanIp = () => Object.values(os.networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address || '127.0.0.1';
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

  canary.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nИтог: ${results.length - failed} из ${results.length} критериев выполнено.`);
  if (process.argv.includes('--dump')) console.log(JSON.stringify({ hard, control }, null, 1));
  return failed ? 1 : 0;
}

main().then((code) => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(code); }).catch((err) => {
  console.error(err);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
