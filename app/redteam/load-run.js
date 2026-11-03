'use strict';
/* Нагрузочный стенд этапа М3 (постановка, Н1–Н6). Только Linux, без root: всё внутри unshare -Urn.
   Пространство сервера с мостом kb0 (10.99.2.1/24) и 15 пространств учеников (10.99.2.10–24), каждое своим veth в мост.
   Скорость всей сети ограничивает netem на мосте, со стороны сервера: 20, 50, 150 Мбит/с.
   Сервер — настоящий desktop/tutor/server.js, ученики — 15 процессов Node с настоящими school-net.js и net-source.js.
   Игра 20 МБ, отмечена «На этом занятии». Расчёт раздела 6 ADR-0002 линеен по объёму: для 200 МБ время в 10 раз больше.
   Запуск: node redteam/load-run.js [--quick] (quick: только 50 Мбит/с, слоты и предел). Итог — строки OK/ПРОВАЛ и таблица. */
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.argv.includes('--in-namespace')) {
  const r = spawnSync('unshare', ['-Urn', process.execPath, __filename, '--in-namespace', ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

const { keygen, pack } = require('../kibpack/pack');
const { makeSchool } = require('./school-fixture');

const APP = path.join(__dirname, '..');
const MB = 1024 * 1024;
const N = 15;
const SERVER = '10.99.2.1';
const QUICK = process.argv.includes('--quick');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(id, name, ok, detail = '') {
  results.push({ id, ok });
  console.log(`${ok ? 'OK    ' : 'ПРОВАЛ'} ${id.padEnd(4)} ${name}${detail ? `\n         ${detail}` : ''}`);
}
const sh = (script) => {
  const r = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${script}\n${r.stderr}`);
};

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kibload-'));
  const holders = [];
  const holdNs = () => { const p = spawn('unshare', ['-n', 'sleep', 'infinity'], { stdio: 'ignore' }); holders.push(p); return p.pid; };
  try {
    /* ---- Сеть ---- */
    const T = holdNs();
    const C = Array.from({ length: N }, holdNs);
    await sleep(400);
    sh(`nsenter -t ${T} -n sh -c 'ip link set lo up && ip link add kb0 type bridge && ip addr add ${SERVER}/24 dev kb0 && ip link set kb0 up'`);
    C.forEach((pid, i) => {
      sh(`ip link add lan${i} type veth peer name kp${i} && ip link set lan${i} netns ${pid} && ip link set kp${i} netns ${T}`);
      sh(`nsenter -t ${T} -n sh -c 'ip link set kp${i} master kb0 && ip link set kp${i} up'`);
      sh(`nsenter -t ${pid} -n sh -c 'ip link set lo up && ip link set lan${i} name lan0 && ip addr add 10.99.2.${10 + i}/24 dev lan0 && ip link set lan0 up'`);
    });
    const limit = (mbit) => sh(`nsenter -t ${T} -n tc qdisc replace dev kb0 root netem delay 2ms rate ${mbit}mbit limit 100000`);

    /* ---- Школа и игра 20 МБ ---- */
    const key = keygen('load', path.join(tmp, 'keys')).keyPath;
    const src = path.join(tmp, 'src');
    fs.cpSync(path.join(APP, 'testgames', 'bez-oblozhki'), src, { recursive: true });
    const m = JSON.parse(fs.readFileSync(path.join(src, 'kibgame.json'), 'utf8'));
    fs.writeFileSync(path.join(src, 'kibgame.json'), JSON.stringify({ ...m, id: 'nagruzka', title: 'Нагрузка' }));
    fs.writeFileSync(path.join(src, 'video.webm'), crypto.randomBytes(20 * MB));
    const gameFile = (await pack(src, { key, out: path.join(tmp, 'nagruzka.kibgames') })).target;
    const tutorDir = path.join(tmp, 'tutor');
    const school = await makeSchool(tutorDir, { games: [gameFile] });
    await school.lib.setLesson('nagruzka', true);
    const schoolFile = path.join(tmp, 'school.json');
    fs.writeFileSync(schoolFile, school.schoolText);
    const size = school.lib.games()[0].bytes;
    const hex = school.lib.games()[0].sha256;

    /* ---- Процессы ---- */
    const node = (pid, config) => {
      const p = spawn('nsenter', ['-t', String(pid), '-n', '--', process.execPath, path.join(__dirname, 'load-node.js')], {
        env: { ...process.env, LOAD_CONFIG: JSON.stringify(config) }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const waiters = [];
      let buf = '';
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const msg = JSON.parse(buf.slice(0, i));
          buf = buf.slice(i + 1);
          const w = waiters.findIndex((x) => x.match(msg));
          if (w >= 0) waiters.splice(w, 1)[0].resolve(msg);
        }
      });
      const next = (match, ms = 900000) => new Promise((resolve, reject) => {
        waiters.push({ match, resolve });
        setTimeout(() => reject(new Error(`нет ответа от процесса стенда: ${err.slice(-800)}`)), ms).unref();
      });
      return { p, next, send: (cmd) => p.stdin.write(`${cmd}\n`), kill: () => { try { p.kill('SIGKILL'); } catch { /* уже нет */ } } };
    };
    async function startServer({ rate = 0, slots = 3 } = {}) {
      const s = node(T, { role: 'server', tutorDir, address: SERVER, network: '10.99.2.0', broadcast: '10.99.2.255', rate, slots });
      await s.next((x) => x.ready);
      s.stats = async () => { s.send('stats'); return (await s.next((x) => x.stats)).stats; };
      s.cmd = async (c) => { s.send(c); return s.next((x) => x.ok === c); };
      return s;
    }
    let run = 0;
    function startClients(count = N, options = {}) {
      run += 1;
      const t0 = Date.now();
      return C.slice(0, count).map((pid, i) => {
        const dir = path.join(tmp, `c${run}-${i}`);
        const c = node(pid, { role: 'client', schoolFile, dir, server: SERVER, game: 'nagruzka', t0, options });
        c.dir = dir;
        c.ip = `10.99.2.${10 + i}`;
        c.done = c.next((x) => x.done !== undefined);
        return c;
      });
    }
    const partOf = (c) => { try { return fs.statSync(path.join(c.dir, 'cache', `${hex}.part`)).size; } catch { return 0; } };
    const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
    const sec = (ms) => `${(ms / 1000).toFixed(1)} с`;
    /* Скорость отдачи по скользящим окнам 10 с (шаг 1 с), Мбит/с. from и to — номера отрезков по 100 мс. */
    const windows = (timeline, from, to) => {
      const out = [];
      for (let t = from; t + 100 <= to; t += 10) {
        let sum = 0;
        for (let k = t; k < t + 100; k += 1) sum += timeline[k] || 0;
        out.push((sum * 8) / 10 / 1e6);
      }
      return out;
    };
    const table = [];

    /* ---- Н3 и Н1: 15 ноутбуков, игра 20 МБ, предел снят ---- */
    for (const mbit of QUICK ? [50] : [20, 50, 150]) {
      console.log(`Нагрузка: ${mbit} Мбит/с, 15 ноутбуков...`);
      limit(mbit);
      const srv = await startServer({ rate: 0 });
      const clients = startClients();
      const done = (await Promise.all(clients.map((c) => c.done))).map((x) => x.done).sort((a, b) => a - b);
      const st = await srv.stats();
      srv.kill();
      const total = Object.values(st.byIp).reduce((a, b) => a + b, 0);
      const calc = (N * size * 8) / (mbit * 1e6) * 1000;
      const avg = done.reduce((a, b) => a + b, 0) / done.length;
      table.push({ mbit, first: done[0], avg, last: done[N - 1], calc, total, maxBusy: st.maxBusy, s503: st.status[503] || 0 });
      const dev = Math.abs(done[N - 1] - calc) / calc;
      check('Н3', `${mbit} Мбит/с: последний ноутбук получил игру за время расчёта ±30 %`, dev <= 0.3,
        `расчёт ${sec(calc)}, первый ${sec(done[0])}, средний ${sec(avg)} (${(avg / done[N - 1]).toFixed(2)} от последнего), последний ${sec(done[N - 1])}, отклонение ${Math.round(dev * 100)} %; для 200 МБ: последний ${(done[N - 1] * 10 / 60000).toFixed(1)} мин`);
      check('Н1', `${mbit} Мбит/с: одновременно не больше 3 больших ответов`, st.maxBusy <= 3 && st.maxBusy >= 1 && (st.status[503] || 0) > 0,
        `наибольшее число занятых слотов ${st.maxBusy}, ответов 503: ${st.status[503] || 0}, отдано ${(total / MB).toFixed(0)} МБ на ${(N * size / MB).toFixed(0)} МБ`);
    }

    /* ---- Н1, контроль: без слотов ---- */
    console.log('Нагрузка: контроль без слотов...');
    limit(50);
    {
      const srv = await startServer({ rate: 0, slots: N });
      const clients = startClients();
      await Promise.all(clients.map((c) => c.done));
      const st = await srv.stats();
      srv.kill();
      check('Н1', 'Контроль: без слотов (15) сервер отдаёт больше 3 файлов сразу, проверка не пустая', st.maxBusy > 3, `наибольшее число одновременных ответов ${st.maxBusy}`);
    }

    /* ---- Н2: предел 30 Мбит/с при сети 150, потом «Скачать быстрее» ---- */
    console.log('Нагрузка: предел скорости и «Скачать быстрее»...');
    limit(150);
    {
      const srv = await startServer({ rate: 30e6 / 8 });
      const clients = startClients();
      const t0 = Date.now();
      await sleep(30000);
      const fastAt = (await srv.cmd('fast')).t;
      await Promise.all(clients.map((c) => c.done));
      const st = await srv.stats();
      srv.kill();
      const slot = (t) => Math.floor(t / 100);
      const before = windows(st.timeline, slot(t0) + 30, slot(fastAt));
      const after = windows(st.timeline, slot(fastAt) + 5, slot(fastAt) + 105);
      const maxBefore = Math.max(...before);
      const maxAfter = after.length ? Math.max(...after) : 0;
      check('Н2', 'Предел 30 Мбит/с соблюдается в каждом окне 10 с, «Скачать быстрее» его снимает', maxBefore <= 31.5 && maxBefore >= 20 && maxAfter > 100,
        `с пределом: наибольшее за 10 с ${maxBefore.toFixed(1)} Мбит/с (окон ${before.length}), после «Скачать быстрее» ${maxAfter.toFixed(1)} Мбит/с при сети 150 Мбит/с`);
    }

    if (!QUICK) {
      /* ---- Н4: обрыв на 50 %, один ноутбук ---- */
      const fourth = {};
      for (const mode of ['докачка', 'контроль']) {
        console.log(`Нагрузка: обрыв на 50 % (${mode})...`);
        limit(50);
        const srv = await startServer({ rate: 2 * MB });
        const [c] = startClients(1, { retryMs: [1000] });
        await waitFor(() => partOf(c) >= size / 2, 60000);
        const st1 = await srv.stats();
        await srv.cmd('stop');
        await sleep(1500);
        if (mode === 'контроль') fs.rmSync(path.join(c.dir, 'cache', `${hex}.part`), { force: true }); // как на М2: недокачанное выброшено
        await srv.cmd('start');
        await c.done;
        const st2 = await srv.stats();
        srv.kill();
        fourth[mode] = { before: st1.byIp[c.ip] || 0, after: (st2.byIp[c.ip] || 0) - (st1.byIp[c.ip] || 0) };
      }
      check('Н4', 'Обрыв на 50 %: после обрыва отдана только вторая половина; без .part — вдвое больше',
        fourth['докачка'].after <= size * 0.55 && fourth['контроль'].after >= fourth['докачка'].after * 1.8,
        `до обрыва ${(fourth['докачка'].before / MB).toFixed(1)} МБ, после: с докачкой ${(fourth['докачка'].after / MB).toFixed(1)} МБ, без докачки ${(fourth['контроль'].after / MB).toFixed(1)} МБ (игра ${(size / MB).toFixed(1)} МБ)`);

      /* ---- Н5: сервер пропал на 30 с при 50 % у класса ---- */
      console.log('Нагрузка: перезапуск сервера посреди загрузки, 15 ноутбуков...');
      limit(50);
      {
        const srv = await startServer({ rate: 0 });
        const clients = startClients();
        await waitFor(async () => Object.values((await srv.stats()).byIp).reduce((a, b) => a + b, 0) >= (N * size) / 2, 120000);
        await srv.cmd('stop');
        await sleep(30000);
        await srv.cmd('start');
        const res = await Promise.all(clients.map((c) => c.done));
        const st = await srv.stats();
        srv.kill();
        const per = clients.map((c) => st.byIp[c.ip] || 0);
        const failed = res.filter((x) => x.failed).length;
        check('Н5', 'Сервер пропал на 30 с посреди загрузки: все 15 ноутбуков получили игру, «не скачалась» нет, загруженное не потеряно',
          res.length === N && failed === 0 && Math.max(...per) <= size * 1.1,
          `получили ${res.length}, «не скачалась» ${failed}, больше всего отдано одному ноутбуку ${(Math.max(...per) / MB).toFixed(1)} МБ при игре ${(size / MB).toFixed(1)} МБ`);
      }

      /* ---- Н6: класс включил ноутбуки разом, сервера нет 30 с. Когда он появился, приходят не все в одну секунду ---- */
      for (const mode of ['сдвиг', 'контроль']) {
        console.log(`Нагрузка: класс ждёт сервер (${mode === 'сдвиг' ? 'сдвиг ±30 %' : 'без сдвига'})...`);
        const srv = await startServer({ rate: 0 });
        await srv.cmd('stop');
        const clients = startClients(N, mode === 'контроль' ? { retrySpread: 0 } : {});
        await sleep(30000);
        const back = Date.now();
        await srv.cmd('start');
        await sleep(30000);
        const st = await srv.stats();
        for (const c of clients) c.kill();
        srv.kill();
        const firsts = clients.map((c) => (st.requests.find((q) => q.ip === c.ip && q.t >= back) || {}).t).filter(Boolean);
        const perSec = {};
        for (const t of firsts) perSec[Math.floor((t - back) / 1000)] = (perSec[Math.floor((t - back) / 1000)] || 0) + 1;
        const peak = Math.max(0, ...Object.values(perSec));
        const detail = `первые запросы ${firsts.length} ноутбуков за ${firsts.length ? sec(Math.max(...firsts) - Math.min(...firsts)) : '—'}, наибольшее число в одну секунду ${peak}`;
        if (mode === 'сдвиг') check('Н6', 'Сервер появился: класс приходит не разом, не больше 5 первых запросов в одну секунду', firsts.length === N && peak <= 5, detail);
        else check('Н6', 'Контроль: без сдвига ±30 % класс приходит в одну-две секунды, проверка не пустая', peak > 5, detail);
      }
    }

    console.log('\nМбит/с | расчёт | первый | средний | последний | 503 | слотов');
    for (const r of table) console.log(`${r.mbit} | ${sec(r.calc)} | ${sec(r.first)} | ${sec(r.avg)} | ${sec(r.last)} | ${r.s503} | ${r.maxBusy}`);
  } finally {
    for (const h of holders) { try { h.kill('SIGKILL'); } catch { /* уже нет */ } }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nИтог: ${results.length - failed} из ${results.length} проверок нагрузки выполнено.`);
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
