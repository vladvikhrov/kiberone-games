'use strict';
/* Тест-«взломщик» этапа М3 на настоящей программе ученика (Electron) в двух сетевых пространствах:
     К25  подмена при докачке: поддельный сервер отдаёт половину чужой подписанной игры, обрывает, а на Range — её хвост.
          С защитой файл не попадает в кеш и не запускается; без проверок стенда склеенная подмена запускается.
     Н7   «Играть» на большой нескачанной игре в настоящей витрине: игра встаёт первой, отмеченная тьютором загрузка
          прерывается и потом докачивается с места паузы, на кнопке процент и время, сама игра после загрузки не запускается.
   Слоты, предел скорости и расчёт времени на 15 ноутбуках — redteam/load-run.js. Логика очереди — test/m3-*.test.js. */
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pack } = require('../kibpack/pack');
const { makeSchool } = require('./school-fixture');

// Та же подсеть, что у М2 (стенд настоящего сервера знает только её), но свои пространства и свой veth
const NET = { student: '10.99.1.20', server: '10.99.1.10' };
const MB = 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function m3Checks({ tmp, uid, gid, check, ELECTRON, APP, key }) {
  const dir = path.join(tmp, 'm3');
  fs.mkdirSync(dir, { recursive: true });
  const holders = [];
  const holdNs = () => { const p = spawn('unshare', ['-n', 'sleep', 'infinity'], { stdio: 'ignore' }); holders.push(p); return p.pid; };
  const sh = (script) => {
    const r = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Сеть М3 не поднялась: ${script}\n${r.stderr}`);
  };
  const S = holdNs();
  const T = holdNs();
  await sleep(300);
  sh(`ip link add k3lan0 type veth peer name k3lan1 && ip link set k3lan0 netns ${S} && ip link set k3lan1 netns ${T}`);
  sh(`nsenter -t ${S} -n sh -c 'ip link set lo up && ip addr add ${NET.student}/24 dev k3lan0 && ip link set k3lan0 up'`);
  sh(`nsenter -t ${T} -n sh -c 'ip link set lo up && ip addr add ${NET.server}/24 dev k3lan1 && ip link set k3lan1 up'`);
  const inNs = (pid, cmd) => ['nsenter', '-t', String(pid), '-n', '--', ...cmd];

  try {
    const games = path.join(dir, 'games');
    fs.mkdirSync(games);
    const packTo = async (folder, name) => (await pack(folder, { key, out: path.join(games, `${name}.kibgames`) })).target;
    // Игра-взломщик из М2: если она запустилась, подмена прошла
    const g = path.join(dir, 'attack-server');
    fs.cpSync(path.join(__dirname, 'game'), g, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(g, 'kibgame.json'), 'utf8'));
    fs.writeFileSync(path.join(g, 'kibgame.json'), JSON.stringify({ ...manifest, id: 'vzlom-server', title: 'Взломщик: сервер' }));
    fs.writeFileSync(path.join(g, 'config.js'), 'window.CFG={};');
    const attack = await packTo(g, 'vzlom-server');
    const seif = await packTo(path.join(APP, '..', 'games', 'vzlomai-seif'), 'vzlomai-seif');
    const pochta = await packTo(path.join(APP, '..', 'games', 'kiberpochta'), 'kiberpochta');
    const big = async (id, size) => {
      const src = path.join(dir, `src-${id}`);
      fs.cpSync(path.join(APP, 'testgames', 'bez-oblozhki'), src, { recursive: true });
      const m = JSON.parse(fs.readFileSync(path.join(src, 'kibgame.json'), 'utf8'));
      fs.writeFileSync(path.join(src, 'kibgame.json'), JSON.stringify({ ...m, id, title: `Большая ${id}` }));
      fs.writeFileSync(path.join(src, 'video.webm'), crypto.randomBytes(size));
      return packTo(src, id);
    };
    const bigA = await big('bolshaya-a', 25 * MB);
    const bigB = await big('bolshaya-b', 25 * MB);

    const tutorDir = path.join(dir, 'tutor');
    const school = await makeSchool(tutorDir, { games: [pochta, seif, bigA, bigB] });
    await school.lib.setLesson('bolshaya-b', true);
    const schoolFile = path.join(dir, 'school.json');
    fs.writeFileSync(schoolFile, school.schoolText);
    const entry = (id) => school.lib.games().find((x) => x.id === id);
    if (fs.statSync(attack).size >= entry('vzlomai-seif').bytes) throw new Error('игра-взломщик больше «Сейфа»: подмена при докачке не уложится в размер');

    function startNode(pid, config) {
      const out = path.join(dir, `srv-${crypto.randomUUID()}.json`);
      const cmd = inNs(pid, [process.execPath, path.join(__dirname, 'net-server.js')]);
      const p = spawn(cmd[0], cmd.slice(1), { env: { ...process.env, NET_CONFIG: JSON.stringify({ ...config, out }) }, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      return new Promise((resolve, reject) => {
        p.stdout.on('data', (d) => {
          if (!String(d).includes('READY')) return;
          resolve({
            async stop() {
              if (p.exitCode === null) { const done = new Promise((r) => p.once('exit', r)); p.kill('SIGTERM'); await done; }
              return fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
            },
          });
        });
        p.on('exit', (code) => reject(new Error(`net-server.js завершился с кодом ${code}: ${err}`)));
      });
    }

    function runStudent(mode, extra = {}, timeoutMs = 400000) {
      const home = path.join(dir, `home-${mode}-${crypto.randomUUID().slice(0, 6)}`);
      fs.mkdirSync(home, { recursive: true });
      const out = path.join(dir, `${mode}-${crypto.randomUUID()}.json`);
      const signalDir = path.join(home, 'sig');
      fs.mkdirSync(signalDir);
      const config = { mode, out, signalDir, schoolFile, dataDir: path.join(home, 'data'), localDir: path.join(home, 'local'), ...extra };
      const cmd = ['nsenter', '-t', String(S), '-n', '--', 'unshare', '-U', `--map-user=${uid}`, `--map-group=${gid}`, '--',
        ELECTRON, '--ozone-platform=headless', `--user-data-dir=${path.join(home, 'profile')}`, path.join(__dirname, 'net-harness.js')];
      return new Promise((resolve) => {
        const proc = spawn(cmd[0], cmd.slice(1), { env: { ...process.env, HOME: home, DISPLAY: '', REDTEAM_CONFIG: JSON.stringify(config) }, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = '';
        proc.stdout.on('data', (d) => { log += d; });
        proc.stderr.on('data', (d) => { log += d; });
        const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
        proc.on('exit', (code) => {
          clearTimeout(timer);
          setTimeout(() => {
            if (!fs.existsSync(out)) { resolve({ fatal: `режим ${mode} не дал результата (код ${code}): ${log.slice(-1500)}` }); return; }
            const r = JSON.parse(fs.readFileSync(out, 'utf8'));
            resolve(r.fatal ? { fatal: `режим ${mode}: ${r.fatal}` } : { ...r, cache: fs.existsSync(path.join(config.localDir, 'cache')) ? fs.readdirSync(path.join(config.localDir, 'cache')) : [] });
          }, 300);
        });
      });
    }

    /* ---- К25: подмена при докачке ---- */
    console.log('М3: подмена при докачке...');
    const seifEntry = entry('vzlomai-seif');
    const fakeSplit = { mode: 'fake', addresses: [NET.server], fake: { catalog: school.lib.catalogPath, blobDir: school.lib.blobsDir,
      split: { [seifEntry.sha256]: { file: attack, bytes: seifEntry.bytes } } } };
    let srv = await startNode(T, fakeSplit);
    const k = await runStudent('net-subst', { substGame: 'vzlomai-seif' });
    const statsK = await srv.stop();
    if (k.fatal) throw new Error(k.fatal);
    srv = await startNode(T, fakeSplit);
    const kc = await runStudent('net-subst', { substGame: 'vzlomai-seif', control: true });
    const statsKc = await srv.stop();
    if (kc.fatal) throw new Error(kc.fatal);
    const seifReq = (stats) => stats.requests.filter((q) => q.url.endsWith(seifEntry.sha256));
    const ranges = seifReq(statsK).filter((q) => q.range).length;
    const k25ok = k.state === 'failed' && !k.cache.includes(seifEntry.sha256) && !k.play.res.ok && ranges >= 3
      && k.view.log.some((l) => /не скачалась \(3 из 3\)/.test(l));
    const k25control = kc.state === 'ready' && kc.play.res.ok && String(kc.play.url).startsWith('kibgame://vzlom-server/') && seifReq(statsKc).some((q) => q.range);
    check('К25', 'Подмена при докачке (чужая игра по частям под видом продолжения) не попадает в кеш и не запускается', k25ok && k25control,
      `с защитой: ${k.state}, запросов «Сейфа» ${seifReq(statsK).length}, из них докачек ${ranges}, в кеше: ${k.cache.includes(seifEntry.sha256) ? 'да' : 'нет'}, запуск: ${JSON.stringify(k.play.res)}; `
      + `без проверок стенда склеенная подмена запустилась как ${kc.play.url || JSON.stringify(kc.play.res)}`);

    /* ---- Н7: «Играть» первой через настоящую витрину ---- */
    console.log('М3: «Играть» на большой нескачанной игре...');
    srv = await startNode(T, { mode: 'real', tutorDir, addresses: [NET.server], rate: 6 * MB });
    const p = await runStudent('net-priority', { bigGame: 'bolshaya-a', lessonGame: 'bolshaya-b', shotsDir: process.env.M3_SHOTS || null });
    const statsP = await srv.stop();
    if (p.fatal) throw new Error(p.fatal);
    const hexA = entry('bolshaya-a').sha256;
    const hexB = entry('bolshaya-b').sha256;
    const seq = statsP.requests.filter((q) => q.from === NET.student && (q.url.endsWith(hexA) || q.url.endsWith(hexB)))
      .map((q) => `${q.url.endsWith(hexA) ? 'A' : 'Б'}${q.range ? '+' : ''}`);
    // Б качалась сама, А встала первой, Б докачана с места паузы (с Range)
    const orderOk = seq[0] === 'Б' && seq.indexOf('A') > 0 && seq.slice(seq.indexOf('A') + 1).includes('Б+') && !seq.slice(0, seq.indexOf('A')).includes('A');
    check('Н7', '«Играть» на большой игре: она первая, загрузка отмеченной игры на паузе и потом докачана, на кнопке процент и время, сама не запускается',
      !!p.before && !!p.during && p.during.disabled && !!p.ready && p.windowsAfterReady === 0 && !!p.lessonAfter && p.play.res.ok && orderOk,
      `до нажатия: А ${p.before && p.before.a}, Б ${p.before && `${p.before.b} ${p.before.bProgress} %`}; на кнопке «${p.during && p.during.label}», `
      + `Б в это время: ${p.lessonDuring && p.lessonDuring.state}; после загрузки «${p.ready && p.ready.label}», окон игры: ${p.windowsAfterReady}; запросы: ${seq.join(' → ')}; запуск: ${JSON.stringify(p.play.res)}${p.listAfter ? `; витрина: ${p.listAfter.join(', ')}; журнал: ${p.logAfter.join(' | ')}` : ''}${p.lastButton ? `; кнопка: ${JSON.stringify(p.lastButton)}` : ''}`);
  } finally {
    for (const h of holders) { try { h.kill('SIGKILL'); } catch { /* уже нет */ } }
  }
};
