'use strict';
/* Тест-«взломщик» этапа М2: каталог и игры по сети (К4, К15–К19, К21, К23, С1, С3, С4, С6).
   Вызывается из run.js внутри его пространства (unshare -Urn). Здесь поднимаются ещё два сетевых пространства:
     ученик  10.99.1.20/24, маршрут по умолчанию через сервер, захват tcpdump всего, что уходит с этого адреса;
     сервер  10.99.1.10 (и .11, .12 для смены адреса и перенаправления), сосед 10.99.1.30, «интернет» 203.0.113.50 на lo.
   Пространства соединены veth. Наружу из пространства run.js не уходит ничего, даже если защита сломана.
   Каждая атака проверяется и без защиты (режим net-control стенда): если без защиты она не прошла, тест провален. */
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pack } = require('../kibpack/pack');
const { signCatalog } = require('../desktop/tutor/catalog-sign');
const { makeSchool } = require('./school-fixture');

const NET = { student: '10.99.1.20', server: '10.99.1.10', server2: '10.99.1.11', redirect: '10.99.1.12', neighbour: '10.99.1.30', internet: '203.0.113.50', bcast: '10.99.1.255' };
const PORTS = { http: 18080, tcp: 18081, udp: 18082 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function netChecks({ tmp, uid, gid, check, ELECTRON, APP, key }) {
  const dir = path.join(tmp, 'm2');
  fs.mkdirSync(dir, { recursive: true });
  const holders = [];

  /* ---- Пространства ---- */
  function holdNs() {
    const p = spawn('unshare', ['-n', 'sleep', 'infinity'], { stdio: 'ignore' });
    holders.push(p);
    return p.pid;
  }
  const sh = (script) => {
    const r = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Сеть М2 не поднялась: ${script}\n${r.stderr}`);
  };
  const S = holdNs();
  const T = holdNs();
  await sleep(300);
  sh(`ip link add k1lan0 type veth peer name k1lan1 && ip link set k1lan0 netns ${S} && ip link set k1lan1 netns ${T}`);
  sh(`nsenter -t ${S} -n sh -c 'ip link set lo up && ip addr add ${NET.student}/24 dev k1lan0 && ip link set k1lan0 up && ip route add default via ${NET.server}'`);
  sh(`nsenter -t ${T} -n sh -c 'ip link set lo up && ip addr add ${NET.server}/24 dev k1lan1 && ip addr add ${NET.server2}/24 dev k1lan1 && ip addr add ${NET.redirect}/24 dev k1lan1 && ip addr add ${NET.neighbour}/24 dev k1lan1 && ip link set k1lan1 up && ip addr add ${NET.internet}/32 dev lo'`);

  const cleanup = () => { for (const p of holders) { try { p.kill('SIGKILL'); } catch { /* уже нет */ } } };

  try {
    /* ---- Игры и школа ---- */
    const games = path.join(dir, 'games');
    fs.mkdirSync(games);
    const packTo = async (folder, name, keyPath = key) => (await pack(folder, { key: keyPath, out: path.join(games, `${name}.kibgames`) })).target;
    const attack = {};
    const controlDirs = {};
    for (const [name, host] of [['server', NET.server], ['sosed', NET.neighbour], ['loopback', '127.0.0.1']]) {
      const g = path.join(dir, `attack-${name}`);
      fs.cpSync(path.join(__dirname, 'game'), g, { recursive: true });
      const manifest = JSON.parse(fs.readFileSync(path.join(g, 'kibgame.json'), 'utf8'));
      fs.writeFileSync(path.join(g, 'kibgame.json'), JSON.stringify({ ...manifest, id: `vzlom-${name}`, title: `Взломщик: ${name}` }));
      fs.writeFileSync(path.join(g, 'config.js'), `window.CFG=${JSON.stringify({ host, ...PORTS, publicIp: NET.internet, marker: 'KIBM2', neighbourSecret: 'x' })};`);
      attack[name] = await packTo(g, `vzlom-${name}`);
      controlDirs[name] = g;
    }
    const xssDir = path.join(dir, 'xss');
    fs.cpSync(path.join(APP, 'testgames', 'bez-oblozhki'), xssDir, { recursive: true });
    const xm = JSON.parse(fs.readFileSync(path.join(xssDir, 'kibgame.json'), 'utf8'));
    const MARKUP = '<img src=x onerror="window.__xss=1">Разметка';
    fs.writeFileSync(path.join(xssDir, 'kibgame.json'), JSON.stringify({ ...xm, id: 'razmetka', title: MARKUP, description: '<b onmouseover="window.__xss=2">жирный</b>', topic: '<svg onload="window.__xss=3">' }));
    const xss = await packTo(xssDir, 'razmetka');
    const pochta = await packTo(path.join(APP, '..', 'games', 'kiberpochta'), 'kiberpochta');
    const tri = await packTo(path.join(APP, 'testgames', 'tri-rezhima'), 'tri-rezhima');
    const seif = await packTo(path.join(APP, '..', 'games', 'vzlomai-seif'), 'vzlomai-seif');
    const futureDir = path.join(dir, 'future');
    fs.cpSync(path.join(APP, 'testgames', 'bez-oblozhki'), futureDir, { recursive: true });
    fs.writeFileSync(path.join(futureDir, 'kibgame.json'), JSON.stringify({ ...xm, id: 'novaya-versiya', title: 'Для новой программы', minAppVersion: '9.0.0' }));
    const future = await packTo(futureDir, 'novaya-versiya');

    const tutorDir = path.join(dir, 'tutor');
    const school = await makeSchool(tutorDir, { games: [pochta, tri, xss, future, attack.server, attack.sosed, attack.loopback] });
    const schoolFile = path.join(dir, 'school.json');
    fs.writeFileSync(schoolFile, school.schoolText);
    const ready = ['kiberpochta', 'tri-rezhima', 'razmetka', 'vzlom-server', 'vzlom-sosed', 'vzlom-loopback'];

    /* ---- Процессы в пространствах ---- */
    const inNs = (pid, cmd) => ['nsenter', '-t', String(pid), '-n', '--', ...cmd];
    function nodeProc(pid, config) {
      const out = path.join(dir, `srv-${crypto.randomUUID()}.json`);
      const p = spawn(inNs(pid, [process.execPath, path.join(__dirname, 'net-server.js')])[0], inNs(pid, [process.execPath, path.join(__dirname, 'net-server.js')]).slice(1),
        { env: { ...process.env, NET_CONFIG: JSON.stringify({ ...config, out }) }, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      const readyP = new Promise((resolve, reject) => {
        p.stdout.on('data', (d) => { if (String(d).includes('READY')) resolve(); });
        p.on('exit', (code) => reject(new Error(`net-server.js завершился с кодом ${code}: ${err}`)));
      });
      return {
        ready: readyP,
        async stop() {
          if (p.exitCode !== null) return JSON.parse(fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '{}');
          const done = new Promise((r) => p.once('exit', r));
          p.kill('SIGTERM');
          await done;
          return fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
        },
      };
    }
    async function startNode(pid, config) {
      const proc = nodeProc(pid, config);
      await proc.ready;
      return proc;
    }

    /* Захват в пространстве ученика: каждый IP-пакет с отметкой времени. IGMP — служебные пакеты ядра о группах
       multicast (их шлёт ядро, когда Chromium подписывается на mDNS), как и в К4 тест их не считает. */
    function startCapture() {
      const proc = spawn('nsenter', ['-t', String(S), '-n', '--', 'tcpdump', '-Z', 'root', '-tt', '-lnni', 'any', 'ip and not igmp'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const packets = [];
      proc.stdout.on('data', (d) => packets.push(...String(d).split('\n').filter(Boolean)));
      return new Promise((resolve, reject) => {
        proc.on('error', reject);
        proc.stderr.on('data', (d) => {
          if (String(d).includes('listening')) {
            resolve({
              packets,
              stop: async () => { await sleep(400); proc.kill('SIGINT'); await new Promise((r) => proc.on('close', r)); return packets; },
            });
          }
        });
      });
    }
    /* Пакет: время в мс, откуда, куда (адрес и порт). */
    const parse = (line) => {
      const m = /^(\d+\.\d+)\s.*?IP (\d+\.\d+\.\d+\.\d+)(?:\.(\d+))? > (\d+\.\d+\.\d+\.\d+)(?:\.(\d+))?:/.exec(line);
      return m ? { t: Number(m[1]) * 1000, src: m[2], dst: m[4], dport: m[5] ? Number(m[5]) : null, line } : null;
    };
    const fromStudent = (packets) => packets.map(parse).filter((p) => p && p.src === NET.student);
    const outsideAllowed = (pk, allowed) => pk.filter((p) => !allowed.includes(p.dst));

    function runStudent(mode, extra = {}, { timeoutMs = 150000, onSignal = {} } = {}) {
      const signalDir = path.join(dir, `sig-${crypto.randomUUID()}`);
      fs.mkdirSync(signalDir);
      const home = path.join(dir, `home-${mode}-${crypto.randomUUID().slice(0, 6)}`);
      fs.mkdirSync(home, { recursive: true });
      const out = path.join(dir, `${mode}-${crypto.randomUUID()}.json`);
      const config = { mode, out, signalDir, schoolFile, dataDir: path.join(home, 'data'), ...extra };
      const cmd = ['nsenter', '-t', String(S), '-n', '--', 'unshare', '-U', `--map-user=${uid}`, `--map-group=${gid}`, '--',
        ELECTRON, '--ozone-platform=headless', `--user-data-dir=${path.join(home, 'profile')}`, ...(extra.args || [path.join(__dirname, 'net-harness.js')])];
      return new Promise((resolve) => {
        const proc = spawn(cmd[0], cmd.slice(1), { env: { ...process.env, HOME: home, DISPLAY: '', REDTEAM_CONFIG: JSON.stringify(config) }, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = '';
        proc.stdout.on('data', (d) => { log += d; });
        proc.stderr.on('data', (d) => { log += d; });
        const handled = new Set();
        const watcher = setInterval(async () => {
          for (const [name, fn] of Object.entries(onSignal)) {
            if (!handled.has(name) && fs.existsSync(path.join(signalDir, name))) {
              handled.add(name);
              const reply = await fn();
              if (reply) fs.writeFileSync(path.join(signalDir, reply), '1');
            }
          }
        }, 100);
        const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
        proc.on('exit', (code) => {
          clearTimeout(timer);
          clearInterval(watcher);
          setTimeout(() => {
            if (extra.args) { resolve({ code, log }); return; }
            if (!fs.existsSync(out)) { resolve({ fatal: `режим ${mode} не дал результата (код ${code}): ${log.slice(-1500)}` }); return; }
            const r = JSON.parse(fs.readFileSync(out, 'utf8'));
            resolve(r.fatal ? { fatal: `режим ${mode}: ${r.fatal}` } : r);
          }, 300);
        });
      });
    }

    const canaryCfg = (host, files) => ({ host, ...PORTS, files });
    const sumHits = (stats, host) => { const h = (stats.canary || {})[host] || { http: [], tcp: 0, udp: 0 }; return h.http.length + h.tcp + h.udp; };

    /* ---- А: обнаружение, каталог, загрузки, К23, К17, К21, К18 ---- */
    console.log('М2: каталог и игры по сети...');
    const localA = path.join(dir, 'local-a');
    let tCanary = await startNode(T, { mode: 'none', canaries: [canaryCfg(NET.server), canaryCfg(NET.neighbour)], traps: [{ host: NET.internet, port: 47800 }, { host: NET.internet, port: 80 }] });
    let sCanary = await startNode(S, { mode: 'none', canaries: [canaryCfg('127.0.0.1')] });
    let server = await startNode(T, { mode: 'real', tutorDir, addresses: [NET.server] });
    let capture = await startCapture();
    let serverStats = null;
    const a = await runStudent('net-main', {
      localDir: localA, expect: ready, attackGames: ['vzlom-server', 'vzlom-sosed', 'vzlom-loopback'], offlineGame: 'kiberpochta', internet: NET.internet,
    }, { onSignal: { 'stop-server': async () => { serverStats = await server.stop(); return 'server-stopped'; } } });
    const packetsA = fromStudent(await capture.stop());
    if (!serverStats) serverStats = await server.stop();
    const canT = await tCanary.stop();
    const canS = await sCanary.stop();
    if (a.fatal) throw new Error(a.fatal);

    const states = Object.fromEntries(a.list.games.map((g) => [g.id, g.state]));
    const allReady = ready.every((id) => states[id] === 'ready');
    const fromS = serverStats.requests.filter((q) => q.from === NET.student);
    check('С1', 'Витрина нашла сервер широковещанием и скачала каталог и игры', allReady && a.view.server === NET.server && fromS.length > 0,
      `за ${(a.readyMs / 1000).toFixed(1)} с, сервер ${a.view.server}, состояния: ${JSON.stringify(states)}`);

    // Порядок: обложки игр, обложки режимов, игры
    const cat = school.lib.games();
    const order = fromS.filter((q) => q.url.startsWith('/v1/blobs/')).map((q) => q.url.slice(-64));
    const pos = (h) => order.indexOf(h);
    const gameCovers = cat.filter((g) => g.cover).map((g) => pos(g.cover.sha256));
    const modeCovers = cat.flatMap((g) => g.modes.filter((m) => m.cover && (!g.cover || m.cover.sha256 !== g.cover.sha256)).map((m) => pos(m.cover.sha256)));
    const gameFiles = cat.filter((g) => g.id !== 'novaya-versiya').map((g) => pos(g.sha256));
    const orderOk = [...gameCovers, ...modeCovers, ...gameFiles].every((x) => x >= 0) && Math.max(...gameCovers) < Math.min(...modeCovers)
      && Math.max(...modeCovers) < Math.min(...gameFiles) && pos(cat.find((g) => g.id === 'novaya-versiya').sha256) === -1;
    check('С4', 'Обложки игр приходят раньше обложек режимов, те раньше игр; игра для новой программы не качается', orderOk,
      `запросов файлов: ${order.length}, обложек игр ${gameCovers.length}, режимов ${modeCovers.length}, игр ${gameFiles.length}; «Для новой программы»: ${states['novaya-versiya']}`);

    check('К23', 'Разметка из каталога по сети показана текстом и не выполнена', a.dom.xss === null && a.dom.injected === 0 && a.dom.titles.includes(MARKUP),
      `window.__xss: ${a.dom.xss}, элементов внутри названий: ${a.dom.injected}, название на экране: ${a.dom.titles.find((x) => x.includes('Разметка'))}`);

    const k17hits = sumHits(canT, NET.server) + sumHits(canT, NET.neighbour) + sumHits(canS, '127.0.0.1');
    const launched = a.games.every((g) => g.res.ok && g.attack && !g.attack.error && g.url.startsWith(`kibgame://${g.id}/`));
    check('К17', 'Игра, полученная по сети, не достучалась до сервера, соседа и loopback ученика', launched && k17hits === 0,
      `запущено: ${a.games.map((g) => `${g.id} ${g.res.ok ? 'да' : JSON.stringify(g.res)}`).join(', ')}; до приёмников дошло: сервер ${sumHits(canT, NET.server)}, сосед ${sumHits(canT, NET.neighbour)}, loopback ${sumHits(canS, '127.0.0.1')}`);

    const duringPk = a.games.map((g) => packetsA.filter((p) => p.t >= g.open + 300 && p.t <= g.close - 50));
    const during = duringPk.map((x) => x.length);
    const pausedAll = a.games.every((g) => g.paused && g.pausedLate && g.resumed);
    const off = a.offlineGame;
    check('К21', 'Пока идёт игра, ученик не шлёт ни одного пакета; без сервера игра из кеша запускается',
      during.every((n) => n === 0) && pausedAll && off.res.ok && off.text > 20,
      `${duringPk.flat().length ? `${duringPk.flat().slice(0, 3).map((p) => p.line).join(' | ')}; ` : ''}пакетов во время игр: ${during.join(', ')} (по ${Math.round((a.games[0].close - a.games[0].open) / 1000)} с, опрос каждые 3 с), сеть на паузе: ${pausedAll ? 'да' : 'нет'}; сервер выключен, Киберпочта: ${off.res.ok ? `запущена, текста ${off.text} знаков` : JSON.stringify(off.res)}`);

    const allowed = [NET.server, NET.bcast, '255.255.255.255'];
    const strayA = outsideAllowed(packetsA, allowed);
    const dnsA = packetsA.filter((p) => p.dport === 53);
    const trapA = sumHits(canT, `${NET.internet}:47800`) + sumHits(canT, `${NET.internet}:80`);
    const k18aOk = strayA.length === 0 && dnsA.length === 0 && trapA === 0 && a.addressInternet.reason === 'not-subnet' && a.addressName.reason === 'not-ip' && packetsA.length > 0;

    /* ---- Б: второй запуск, сервер на новом адресе ---- */
    console.log('М2: второй запуск и новый адрес сервера...');
    server = await startNode(T, { mode: 'real', tutorDir, addresses: [NET.server2] });
    const localB = path.join(dir, 'local-b');
    fs.cpSync(localA, localB, { recursive: true });
    const b = await runStudent('net-restart', { localDir: localB, expectServer: NET.server2 });
    const statsB = await server.stop();
    if (b.fatal) throw new Error(b.fatal);
    const reqB = statsB.requests.filter((q) => q.from === NET.student);
    const blobsB = reqB.filter((q) => q.url.startsWith('/v1/blobs/'));
    const got304 = reqB.some((q) => q.url === '/v1/catalog' && q.status === 304);
    check('С3', 'Повторный запуск ничего не качает заново, неизменный каталог — ответ 304', blobsB.length === 0 && got304 && b.list.games.filter((g) => g.state === 'ready').length === ready.length,
      `запросов файлов: ${blobsB.length}, запросы каталога: ${reqB.filter((q) => q.url === '/v1/catalog').map((q) => q.status).join(', ')}`);
    check('С6', 'Сервер вернулся с другим адресом: витрина нашла его заново', !!b.found && b.view.server === NET.server2,
      `прежний адрес ${NET.server}, найден ${b.view.server}`);

    /* ---- В1: поддельный каталог и перенаправление на «интернет» ---- */
    console.log('М2: поддельный сервер...');
    const other = await makeSchool(path.join(dir, 'tutor-other'), { games: [seif], name: 'Чужая школа' });
    const real = JSON.parse(Buffer.from(JSON.parse(fs.readFileSync(school.lib.catalogPath, 'utf8')).payload, 'base64'));
    const otherGame = JSON.parse(Buffer.from(JSON.parse(fs.readFileSync(other.lib.catalogPath, 'utf8')).payload, 'base64')).games[0];
    const forged = path.join(dir, 'forged.json');
    fs.writeFileSync(forged, signCatalog({ ...real, seq: real.seq + 1e6, games: [...real.games, { ...otherGame, id: 'podmena', title: 'Подменённая игра' }] }, other.key.sign));
    const fakeForged = { mode: 'fake', addresses: [NET.server, NET.redirect], fake: { catalog: forged, blobDir: other.lib.blobsDir, redirectFrom: NET.redirect, redirectTo: NET.internet } };
    tCanary = await startNode(T, { mode: 'none', traps: [{ host: NET.internet, port: 47800 }] });
    server = await startNode(T, fakeForged);
    const localC = path.join(dir, 'local-c');
    fs.cpSync(localB, localC, { recursive: true });
    capture = await startCapture();
    const c1 = await runStudent('net-forged', { localDir: localC, redirect: NET.redirect });
    const packetsC = fromStudent(await capture.stop());
    await server.stop();
    const trapC = sumHits(await tCanary.stop(), `${NET.internet}:47800`);
    if (c1.fatal) throw new Error(c1.fatal);
    // Контроль: та же подделка без проверки подписи
    tCanary = await startNode(T, { mode: 'none' });
    server = await startNode(T, fakeForged);
    const localC2 = path.join(dir, 'local-c2');
    fs.cpSync(localB, localC2, { recursive: true });
    const c1c = await runStudent('net-forged', { localDir: localC2, control: true });
    await server.stop();
    await tCanary.stop();
    if (c1c.fatal) throw new Error(c1c.fatal);
    const k15ok = JSON.stringify(c1.after) === JSON.stringify(c1.before) && !c1.after.includes('podmena') && c1.view.log.some((l) => /отвергнут/.test(l));
    const k15control = c1c.after.includes('podmena');
    check('К15', 'Поддельный сервер (каталог чужой школы под нашим отпечатком, больший seq) не меняет витрину', k15ok && k15control,
      `с защитой игр ${c1.after.length}, подменённой нет: ${!c1.after.includes('podmena')}; без проверки подписи подделка показана: ${k15control ? 'да' : 'НЕТ, тест пустой'}`);

    /* ---- В2: подмена файла новой игры ---- */
    console.log('М2: подмена файла...');
    const insp = await school.lib.inspect(seif);
    await school.lib.publish(insp.token, { confirmUnknown: true, confirmReplace: true, trustName: '' });
    const seifEntry = school.lib.games().find((g) => g.id === 'vzlomai-seif');
    const fakeSubst = { mode: 'fake', addresses: [NET.server], fake: { catalog: school.lib.catalogPath, blobDir: school.lib.blobsDir, blobs: { [seifEntry.sha256]: attack.server } } };
    server = await startNode(T, fakeSubst);
    const localD = path.join(dir, 'local-d');
    fs.cpSync(localB, localD, { recursive: true });
    const c2 = await runStudent('net-subst', { localDir: localD, substGame: 'vzlomai-seif' });
    await server.stop();
    if (c2.fatal) throw new Error(c2.fatal);
    server = await startNode(T, fakeSubst);
    const localD2 = path.join(dir, 'local-d2');
    fs.cpSync(localB, localD2, { recursive: true });
    const c2c = await runStudent('net-subst', { localDir: localD2, substGame: 'vzlomai-seif', control: true });
    await server.stop();
    if (c2c.fatal) throw new Error(c2c.fatal);
    const k16ok = c2.state === 'failed' && !c2.cache.includes(seifEntry.sha256) && !c2.play.res.ok;
    const k16control = c2c.state === 'ready' && c2c.play.res.ok && String(c2c.play.url).startsWith('kibgame://vzlom-server/');
    check('К16', 'Подменённый файл (чужая подписанная игра) не попадает в кеш и не запускается', k16ok && k16control,
      `с защитой: состояние ${c2.state}, в кеше: ${c2.cache.includes(seifEntry.sha256) ? 'да' : 'нет'}, запуск: ${JSON.stringify(c2.play.res)}; без проверки хеша подмена запустилась как ${c2c.play.url || JSON.stringify(c2c.play.res)}`);

    /* ---- Г: без сервера, экран «Попроси тьютора», ручной адрес ---- */
    console.log('М2: экран «Попроси тьютора»...');
    let serverD = null;
    const d = await runStudent('net-ask', { localDir: path.join(dir, 'local-e'), serverIp: NET.server, shotsDir: process.env.M2_SHOTS || null }, {
      onSignal: { 'start-server': async () => { serverD = await startNode(T, { mode: 'real', tutorDir, addresses: [NET.server] }); return 'server-started'; } },
    });
    if (serverD) await serverD.stop();
    if (d.fatal) throw new Error(d.fatal);
    check('С1', 'Без ответа через 15 с экран «Попроси тьютора», адрес из поля работает и запоминается',
      d.askShown && !d.early.ask && d.askMs >= 15000 && d.cards && d.cards.titles.length > 0 && d.state.server === NET.server,
      `экран через ${(d.askMs / 1000).toFixed(1)} с, после ввода адреса карточек: ${d.cards ? d.cards.titles.length : 0}, запомнен адрес ${d.state.server}`);

    /* ---- Д: контроль без защиты для К17 и К18 ---- */
    console.log('М2: прогон без защиты...');
    tCanary = await startNode(T, { mode: 'none', canaries: [canaryCfg(NET.server, { '/control-server/': controlDirs.server }), canaryCfg(NET.neighbour, { '/control-sosed/': controlDirs.sosed })],
      traps: [{ host: NET.internet, port: 47800 }] });
    sCanary = await startNode(S, { mode: 'none', canaries: [canaryCfg('127.0.0.1', { '/control-loopback/': controlDirs.loopback })] });
    for (const [name, g] of Object.entries(controlDirs)) for (const f of ['index.html', 'attacks.js', 'own.txt']) if (!fs.existsSync(path.join(g, f))) throw new Error(`нет ${name}/${f}`);
    capture = await startCapture();
    const e = await runStudent('net-control', {
      localDir: path.join(dir, 'local-f'), internet: NET.internet,
      controlPages: { server: `http://${NET.server}:${PORTS.http}/control-server/index.html`, sosed: `http://${NET.neighbour}:${PORTS.http}/control-sosed/index.html`, loopback: `http://127.0.0.1:${PORTS.http}/control-loopback/index.html` },
    });
    const packetsE = fromStudent(await capture.stop());
    const canTE = await tCanary.stop();
    const canSE = await sCanary.stop();
    if (e.fatal) throw new Error(e.fatal);
    const toInternet = packetsE.filter((p) => p.dst === NET.internet).length;
    const trapE = sumHits(canTE, `${NET.internet}:47800`);
    check('К18', 'Ученик шлёт пакеты только серверу и широковещанию подсети, без DNS; «интернет», имена и перенаправление отвергнуты',
      k18aOk && trapC === 0 && packetsC.every((p) => p.dst !== NET.internet) && c1.redirect && c1.redirect.reason === 'no-answer' && toInternet > 0 && trapE > 0,
      `с защитой: пакетов ученика ${packetsA.length}, на чужие адреса ${strayA.length}${strayA.length ? ` (${strayA.slice(0, 3).map((p) => p.line).join(' | ')})` : ''}, DNS ${dnsA.length}, на «интернет» 0; ручной адрес «интернета»: ${a.addressInternet.reason}, имя: ${a.addressName.reason}; перенаправление: ${c1.redirect && c1.redirect.reason}, пакетов на «интернет» после него ${packetsC.filter((p) => p.dst === NET.internet).length}`
      + `\n         без фильтра: пакетов на «интернет» ${toInternet}, соединений с ним ${trapE}`);
    const channels = ['fetch', 'xhr', 'img', 'script', 'stylesheet', 'iframe', 'beacon', 'websocket', 'worker-fetch', 'form-iframe'];
    const reached = { server: canTE.canary[NET.server], sosed: canTE.canary[NET.neighbour], loopback: canSE.canary['127.0.0.1'] };
    const silent = Object.entries(reached).flatMap(([name, h]) => channels.filter((c) => !h.http.some((u) => u === `/hit/${c}`)).map((c) => `${name}:${c}`));
    check('К17', 'Без песочницы те же атаки дошли до сервера, соседа и loopback, тест не пустой', silent.length === 0,
      silent.length ? `молчат: ${silent.join(', ')}` : `дошли ${channels.length} каналов до каждого из трёх адресов: ${Object.entries(reached).map(([n, h]) => `${n} ${h.http.length}`).join(', ')}`);

    /* ---- Е: К4 и К19 на настоящей программе ---- */
    console.log('М2: настоящая программа без метки школы и с меткой...');
    capture = await startCapture();
    const plain = await runStudent('k4', { args: [APP, '--quiet-errors'] }, { timeoutMs: 12000 });
    const packetsK4 = (await capture.stop()).map(parse).filter(Boolean);
    check('К4', 'Настоящая программа без метки школы не шлёт ни одного пакета (12 с в сети с сервером)', packetsK4.length === 0 && plain.code === null,
      `пакетов: ${packetsK4.length}, программа ${plain.code === null ? 'работала до остановки' : `завершилась с кодом ${plain.code}`}`);
    const homeTrusted = path.join(dir, 'home-k19');
    const k19 = await runStudent('k19', { args: [APP, '--quiet-errors', `--school=${schoolFile}`, `--local-data=${path.join(dir, 'local-g')}`, pochta] }, { timeoutMs: 15000 });
    const k19c = await runStudent('k19c', { args: [APP, '--quiet-errors', pochta] }, { timeoutMs: 8000 });
    check('К19', 'Настроенный ноутбук не открывает посторонний .kibgames', k19.code === 1 && /только из каталога школы/.test(k19.log) && k19c.code === 1 && /неизвестен/.test(k19c.log),
      `с меткой: код ${k19.code}, ${(k19.log.match(/Ошибка: .*/) || [''])[0]}; без метки тот же файл дошёл до проверки автора: ${(k19c.log.match(/Ошибка: .*/) || [`код ${k19c.code}`])[0]}`);
    // Испорченная метка: ноутбук считается настроенным с ошибкой — сети нет, посторонний файл не открывается
    const badSchool = path.join(dir, 'school-bad.json');
    fs.writeFileSync(badSchool, '{"format":1,"name":"Подделка","publicKey":"AAAA","fingerprint":"0000000000000000"}');
    capture = await startCapture();
    const broken = await runStudent('broken', { args: [APP, '--quiet-errors', `--school=${badSchool}`, `--local-data=${path.join(dir, 'local-h')}`] }, { timeoutMs: 10000 });
    const packetsBroken = (await capture.stop()).map(parse).filter(Boolean);
    const brokenFile = await runStudent('broken-file', { args: [APP, '--quiet-errors', `--school=${badSchool}`, pochta] }, { timeoutMs: 8000 });
    check('К19', 'Испорченная метка школы: сети нет, посторонний файл не открывается', broken.code === null && packetsBroken.length === 0 && brokenFile.code === 1 && /только из каталога школы/.test(brokenFile.log),
      `пакетов за 10 с: ${packetsBroken.length}, программа ${broken.code === null ? 'работала' : `вышла с кодом ${broken.code}`}; файл: ${(brokenFile.log.match(/Ошибка: .*/) || [`код ${brokenFile.code}`])[0]}`);
    void homeTrusted;

    /* ---- Ж: снимки для docs/img (только с M2_SHOTS=папка) ---- */
    if (process.env.M2_SHOTS) {
      console.log('М2: снимки витрины...');
      const bez = await packTo(path.join(APP, 'testgames', 'bez-oblozhki'), 'bez-oblozhki');
      const shots = await makeSchool(path.join(dir, 'tutor-shots'), { games: [pochta, tri, future, seif, bez], name: 'KIBERone Санкт-Петербург' });
      const g = (id) => shots.lib.games().find((x) => x.id === id);
      const fakeShots = { mode: 'fake', addresses: [NET.server], fake: { catalog: shots.lib.catalogPath, blobDir: shots.lib.blobsDir,
        blobs: { [g('vzlomai-seif').sha256]: attack.server }, stall: { [g('tri-rezhima').sha256]: 0.5 },
        stallAfter: { [g('tri-rezhima').sha256]: { hex: g('vzlomai-seif').sha256, count: 3 } } } };
      fs.writeFileSync(schoolFile, shots.schoolText);
      for (const [w, h] of [[1366, 768], [1920, 1080]]) {
        let srv = await startNode(T, fakeShots);
        await runStudent('net-shots', { localDir: path.join(dir, `local-shots-${w}`), width: w, height: h, settleMs: 16000, shotName: 'm2-vitrina', linkShot: w === 1366, shotsDir: process.env.M2_SHOTS }, {
          onSignal: { 'stop-server': async () => { await srv.stop(); srv = null; return 'server-stopped'; } },
        });
        if (srv) await srv.stop();
      }
      fs.writeFileSync(schoolFile, school.schoolText);
    }
  } finally {
    cleanup();
  }
};
