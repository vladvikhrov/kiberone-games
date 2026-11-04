'use strict';
/* Скрипт «ученика со своей программой» для теста-«взломщика» М4: шлёт голоса прямо по HTTP, мимо витрины,
   с выбранного адреса своего сетевого пространства. Конфигурация в VOTE_CONFIG:
   { server, port, votes: [{ from, body?, raw?, headers? }] }. Печатает JSON: статус и время отправки каждого запроса. */
const http = require('http');

const cfg = JSON.parse(process.env.VOTE_CONFIG);

function send(v) {
  const payload = v.raw !== undefined ? Buffer.from(v.raw, 'utf8') : Buffer.from(JSON.stringify(v.body));
  const headers = { 'Content-Type': 'application/json', 'Content-Length': payload.length, ...(v.headers || {}) };
  for (const [k, val] of Object.entries(headers)) if (val === null) delete headers[k];
  const at = Date.now();
  return new Promise((resolve) => {
    const req = http.request({ host: cfg.server, port: cfg.port || 47800, path: v.path || '/v1/votes', method: v.method || 'POST', localAddress: v.from, agent: false, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, at, day: res.headers['x-k1-day'] || null }));
    });
    req.setTimeout(10000, () => req.destroy());
    req.on('error', (err) => resolve({ status: 0, at, error: err.code }));
    if (v.chunked) { req.write(payload.subarray(0, 5)); req.end(payload.subarray(5)); } else req.end(payload);
  });
}

(async () => {
  const out = [];
  for (const v of cfg.votes) out.push(await send(v));
  process.stdout.write(`${JSON.stringify(out)}\n`);
})();
