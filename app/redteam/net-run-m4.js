'use strict';
/* Тест-«взломщик» этапа М4: оценки по сети, настоящий сервер тьютора и настоящая программа ученика в двух сетевых пространствах.
     К20а  скрипт ученика шлёт 20 одинаковых голосов: посчитан один. Контроль: без множества HMAC посчитаны все 20.
     К27   мусор (чужая игра, чужой режим, кривые значения, большое тело, chunked, Origin) не меняет ratings.json.
           Контроль: без проверки каталога ключ vzlom в файле.
     К20б  после голосов в папке тьютора нет адреса-метки ученика и времени голосов. Контроль: вариант с журналом — метка найдена.
     К28   оценка во время игры не уходит, пока окно игры открыто (журнал сервера: ни одного запроса ученика), и уходит после
           закрытия; без сервера голос ждёт в памяти, «Отправлю тьютору, когда будет связь», и уходит, когда сервер вернулся.
           Контроль: без паузы сети голос приходит на сервер во время игры.
     Р2    витрина показывает рейтинг с сервера на карточке.
   Голоса вне слотов и предела скорости (К29) — test/m4-votes.test.js и redteam/load-run.js. */
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pack } = require('../kibpack/pack');
const { makeSchool } = require('./school-fixture');
const R = require('../shared/ratings');

// Подсеть стенда настоящего сервера (net-server.js знает только её), свои пространства и свой veth
const NET = { student: '10.99.1.20', label: '10.99.1.201', other: '10.99.1.21', server: '10.99.1.10' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Поиск метки во всех файлах папки: текстом UTF-8 и UTF-16 и байтами. */
function findOnDisk(dir, needles) {
  const found = [];
  const walk = (d) => {
    for (const item of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) {
        const data = fs.readFileSync(full);
        for (const n of needles) if (data.includes(n)) { found.push(path.relative(dir, full)); break; }
      }
    }
  };
  walk(dir);
  return [...new Set(found)];
}

module.exports = async function m4Checks({ tmp, uid, gid, check, ELECTRON, APP, key }) {
  const dir = path.join(tmp, 'm4');
  fs.mkdirSync(dir, { recursive: true });
  const holders = [];
  const holdNs = () => { const p = spawn('unshare', ['-n', 'sleep', 'infinity'], { stdio: 'ignore' }); holders.push(p); return p.pid; };
  const sh = (script) => {
    const r = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Сеть М4 не поднялась: ${script}\n${r.stderr}`);
  };
  const S = holdNs();
  const T = holdNs();
  await sleep(300);
  sh(`ip link add k4lan0 type veth peer name k4lan1 && ip link set k4lan0 netns ${S} && ip link set k4lan1 netns ${T}`);
  // Первый адрес — основной: с него ходит программа ученика. Метка и второй ноутбук — для скрипта
  sh(`nsenter -t ${S} -n sh -c 'ip link set lo up && ip addr add ${NET.student}/24 dev k4lan0 && ip addr add ${NET.label}/24 dev k4lan0 && ip addr add ${NET.other}/24 dev k4lan0 && ip link set k4lan0 up'`);
  sh(`nsenter -t ${T} -n sh -c 'ip link set lo up && ip addr add ${NET.server}/24 dev k4lan1 && ip link set k4lan1 up'`);
  const inNs = (pid, cmd) => ['nsenter', '-t', String(pid), '-n', '--', ...cmd];

  try {
    const games = path.join(dir, 'games');
    fs.mkdirSync(games);
    const packTo = async (folder, name) => (await pack(folder, { key, out: path.join(games, `${name}.kibgames`) })).target;
    const pochta = await packTo(path.join(APP, '..', 'games', 'kiberpochta'), 'kiberpochta');
    const tri = await packTo(path.join(APP, 'testgames', 'tri-rezhima'), 'tri-rezhima');
    const tutorDir = path.join(dir, 'tutor');
    const school = await makeSchool(tutorDir, { games: [pochta, tri] });
    // Пять оценок Киберпочты уже есть: витрина должна показать среднее 4.4 с сервера (Р2)
    fs.writeFileSync(path.join(tutorDir, 'ratings.json'), JSON.stringify({ format: 1, games: { kiberpochta: { default: { 1: 0, 2: 0, 3: 0, 4: 3, 5: 2 } } } }));
    const controlDir = path.join(dir, 'tutor-control');
    fs.cpSync(tutorDir, controlDir, { recursive: true });
    const schoolFile = path.join(dir, 'school.json');
    fs.writeFileSync(schoolFile, school.schoolText);
    const ratingsOf = (d) => R.parseRatings(fs.readFileSync(path.join(d, 'ratings.json'), 'utf8'));
    const count = (d, g, m) => Object.values(R.countsOf(ratingsOf(d), g, m)).reduce((a, b) => a + b, 0);

    function startNode(config) {
      const out = path.join(dir, `srv-${crypto.randomUUID()}.json`);
      const cmd = inNs(T, [process.execPath, path.join(__dirname, 'net-server.js')]);
      const p = spawn(cmd[0], cmd.slice(1), { env: { ...process.env, NET_CONFIG: JSON.stringify({ addresses: [NET.server], ...config, out }) }, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      return new Promise((resolve, reject) => {
        p.stdout.on('data', (d) => {
          if (!String(d).includes('READY')) return;
          resolve({
            async stop() {
              if (p.exitCode === null) { const done = new Promise((r) => p.once('exit', r)); p.kill('SIGTERM'); await done; }
              return fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { requests: [] };
            },
          });
        });
        p.on('exit', (code) => reject(new Error(`net-server.js завершился с кодом ${code}: ${err}`)));
      });
    }
    function voteScript(votes) {
      const cmd = inNs(S, [process.execPath, path.join(__dirname, 'vote-client.js')]);
      const r = spawnSync(cmd[0], cmd.slice(1), { env: { ...process.env, VOTE_CONFIG: JSON.stringify({ server: NET.server, votes }) }, encoding: 'utf8', timeout: 120000 });
      if (r.status !== 0) throw new Error(`vote-client.js: ${r.stderr}`);
      return JSON.parse(r.stdout.trim());
    }

    const same = Array.from({ length: 20 }, () => ({ from: NET.label, body: { game: 'tri-rezhima', mode: 'timed', value: 5 } }));
    const valid = [...same, { from: NET.other, body: { game: 'tri-rezhima', mode: 'timed', value: 4 } }, { from: NET.label, body: { game: 'tri-rezhima', mode: 'custom', value: 2 } }];
    const garbage = [
      { from: NET.label, body: { game: 'vzlom', mode: 'default', value: 5 } },
      { from: NET.label, body: { game: 'tri-rezhima', mode: 'vzlom', value: 5 } },
      { from: NET.label, body: { game: 'kiberpochta', mode: 'timed', value: 5 } },
      { from: NET.label, body: { game: 'kiberpochta', mode: 'default', value: 6 } },
      { from: NET.label, body: { game: 'kiberpochta', mode: 'default', value: '5' } },
      { from: NET.label, body: { game: 'kiberpochta', mode: 'default', value: 5, who: 'Петя' } },
      { from: NET.label, raw: '{"game":"kiberpochta","mode":"default","value":5,"__proto__":{}}' },
      { from: NET.label, raw: `{"game":"kiberpochta","mode":"default","value":5,"pad":"${'x'.repeat(300)}"}` },
      { from: NET.label, body: { game: 'kiberpochta', mode: 'default', value: 5 }, chunked: true, headers: { 'Content-Length': null } },
      { from: NET.label, body: { game: 'kiberpochta', mode: 'default', value: 5 }, headers: { Origin: 'http://evil.example' } },
      { from: NET.label, body: { game: 'kiberpochta', mode: 'default', value: 5 }, headers: { 'Content-Type': 'text/plain' } },
    ];

    /* ---- К20а, К27, К20б: скрипт ученика против настоящего сервера ---- */
    console.log('М4: голоса скриптом с ноутбука ученика...');
    let srv = await startNode({ mode: 'real', tutorDir });
    const before = count(tutorDir, 'tri-rezhima', 'timed');
    const r1 = voteScript(valid);
    const bytesAfterValid = fs.readFileSync(path.join(tutorDir, 'ratings.json'));
    const r2 = voteScript(garbage);
    const bytesAfterGarbage = fs.readFileSync(path.join(tutorDir, 'ratings.json'));
    await srv.stop();
    const timed = count(tutorDir, 'tri-rezhima', 'timed') - before;
    const times = [...r1, ...r2].map((x) => x.at);
    const needles = [Buffer.from(NET.label), Buffer.from(NET.label, 'utf16le'), Buffer.from(NET.label.split('.').map(Number)),
      ...times.flatMap((t) => [String(t), String(Math.floor(t / 1000))].map((x) => Buffer.from(x)))];

    console.log('М4: те же голоса без защиты (контроль)...');
    srv = await startNode({ mode: 'real', tutorDir: controlDir, votesControl: true });
    const c1 = voteScript(valid);
    const c2 = voteScript(garbage);
    await srv.stop();
    const timedControl = count(controlDir, 'tri-rezhima', 'timed');
    const controlText = fs.readFileSync(path.join(controlDir, 'ratings.json'), 'utf8');
    const foundControl = findOnDisk(controlDir, needles);

    const statuses = (list) => list.map((x) => x.status).join(' ');
    check('К20а', 'Повторный голос за день не считается: 20 одинаковых голосов скриптом — +1', timed === 2 && r1[0].status === 204 && r1.slice(1, 20).every((x) => x.status === 409)
      && r1[20].status === 204 && r1[21].status === 204 && timedControl === 21,
      `с защитой: первый голос ${r1[0].status}, повторы: ${r1.slice(1, 20).filter((x) => x.status === 409).length} из 19 получили 409, второй ноутбук ${r1[20].status}, другой режим ${r1[21].status}; режим «На время» +${timed} (метка +1, второй ноутбук +1). `
      + `Без множества HMAC: ${timedControl} голоса (20 + 1)`);
    const garbageOk = r2.every((x) => x.status >= 400 && x.status < 500) && bytesAfterGarbage.equals(bytesAfterValid);
    check('К27', 'Мусор не попадает в ratings.json: чужие игры и режимы, кривые значения, лишние поля, большое тело, chunked, Origin',
      garbageOk && controlText.includes('vzlom'),
      `ответы ${statuses(r2)}, файл ${bytesAfterGarbage.equals(bytesAfterValid) ? 'побайтно прежний' : 'ИЗМЕНИЛСЯ'}; без проверки каталога: ${controlText.includes('vzlom') ? 'vzlom в файле' : 'vzlom не появился'} (${statuses(c2)})`);
    const found = findOnDisk(tutorDir, needles);
    check('К20б', 'В папке тьютора нет адреса ученика и времени голоса', found.length === 0 && foundControl.length > 0,
      `метка ${NET.label} и время ${times.length} запросов: найдено ${found.length ? found.join(', ') : 'нигде'}; вариант с журналом: ${foundControl.join(', ') || 'не найдено'} (${c1.length} голосов)`);

    /* ---- К28 и Р2: настоящая программа ученика ---- */
    function runStudent(mode, extra = {}, timeoutMs = 240000) {
      const home = path.join(dir, `home-${mode}-${crypto.randomUUID().slice(0, 6)}`);
      fs.mkdirSync(home, { recursive: true });
      const out = path.join(dir, `${mode}-${crypto.randomUUID()}.json`);
      const signalDir = path.join(home, 'sig');
      fs.mkdirSync(signalDir);
      const config = { mode, out, signalDir, schoolFile, dataDir: path.join(home, 'data'), localDir: path.join(home, 'local'), ...extra };
      const cmd = ['nsenter', '-t', String(S), '-n', '--', 'unshare', '-U', `--map-user=${uid}`, `--map-group=${gid}`, '--',
        ELECTRON, '--ozone-platform=headless', `--user-data-dir=${path.join(home, 'profile')}`, path.join(__dirname, 'net-harness.js')];
      return { signalDir, done: new Promise((resolve) => {
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
            resolve(r.fatal ? { fatal: `режим ${mode}: ${r.fatal}` } : r);
          }, 300);
        });
      }) };
    }
    /* Ученик в Electron, сервер выключается и включается по его сигналам. Возвращает результат и журнал обоих серверов. */
    async function voteRun(tDir, extra) {
      let s = await startNode({ mode: 'real', tutorDir: tDir });
      const requests = [];
      const run = runStudent('net-vote', { game: 'tri-rezhima', modeA: 'training', modeB: 'timed', ratedGame: 'kiberpochta', ...extra });
      const has = (n) => fs.existsSync(path.join(run.signalDir, n));
      let finished = false;
      const watcher = (async () => {
        while (!finished) {
          if (has('stop-server') && !has('server-stopped') && s) { requests.push(...(await s.stop()).requests); s = null; fs.writeFileSync(path.join(run.signalDir, 'server-stopped'), '1'); }
          if (has('start-server') && !has('server-started') && !s) { s = await startNode({ mode: 'real', tutorDir: tDir }); fs.writeFileSync(path.join(run.signalDir, 'server-started'), '1'); }
          await sleep(100);
        }
      })();
      const r = await run.done;
      finished = true;
      await watcher;
      if (s) requests.push(...(await s.stop()).requests);
      return { r, requests };
    }

    console.log('М4: оценка в настоящей витрине, во время игры и без сервера...');
    const trainingBefore = count(tutorDir, 'tri-rezhima', 'training');
    const timedBefore = count(tutorDir, 'tri-rezhima', 'timed');
    const { r: v, requests } = await voteRun(tutorDir, { shotsDir: process.env.M4_SHOTS || null });
    if (v.fatal) throw new Error(v.fatal);
    const fromStudent = requests.filter((q) => q.from && q.from.replace(/^::ffff:/, '') === NET.student);
    const during = fromStudent.filter((q) => q.t > v.open + 200 && q.t < v.close);
    const postAfter = fromStudent.find((q) => q.method === 'POST' && q.url === '/v1/votes' && q.t >= v.close);

    console.log('М4: без паузы сети (контроль)...');
    const ctlDir2 = path.join(dir, 'tutor-control-2');
    fs.cpSync(tutorDir, ctlDir2, { recursive: true });
    const { r: vc, requests: reqC } = await voteRun(ctlDir2, { control: true });
    if (vc.fatal) throw new Error(vc.fatal);
    const duringC = reqC.filter((q) => q.from && q.from.replace(/^::ffff:/, '') === NET.student && q.t > vc.open + 200 && q.t < vc.close);

    const k28 = v.voteDuring && v.voteDuring.ok && v.pendingDuring === true && during.length === 0 && !!postAfter && !!v.sentAfter
      && count(tutorDir, 'tri-rezhima', 'training') === trainingBefore + 1
      && v.pendingOffline === true && /когда будет связь/.test(v.textOffline || '') && /ушла тьютору/.test(v.textOnline || '') && v.pendingOnline === false
      && count(tutorDir, 'tri-rezhima', 'timed') === timedBefore + 1;
    check('К28', 'Пока идёт игра, голос не уходит, после закрытия уходит; без сервера ждёт в памяти и уходит, когда сервер вернулся',
      k28 && duringC.some((q) => q.method === 'POST'),
      `игра открыта ${Math.round((v.close - v.open) / 100) / 10} с, запросов ученика за это время ${during.length}, голос в очереди: ${v.pendingDuring}; `
      + `после закрытия POST через ${postAfter ? postAfter.t - v.close : '—'} мс, «Тренировка» +${count(tutorDir, 'tri-rezhima', 'training') - trainingBefore}. `
      + `Без сервера: «${v.textOffline}», в очереди ${v.pendingOffline}; сервер вернулся: «${v.textOnline}», «На время» +${count(tutorDir, 'tri-rezhima', 'timed') - timedBefore}. `
      + `Без паузы сети за время игры пришло ${duringC.length} запросов, из них голосов ${duringC.filter((q) => q.method === 'POST').length}`);
    check('Р2', 'Витрина показывает рейтинг с сервера на карточке', !!v.rated && v.rated.avg === 4.4 && v.rated.n === 5 && /4\.4/.test(v.cardText || ''),
      `рейтинг Киберпочты ${JSON.stringify(v.rated)}, на карточке «${v.cardText}»`);
  } finally {
    for (const h of holders) { try { h.kill('SIGKILL'); } catch { /* уже нет */ } }
  }
};
