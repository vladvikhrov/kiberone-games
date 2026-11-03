'use strict';
/* Этап М2, К18 (фильтр): сетевой модуль ученика отказывает до открытия сокета.
   Настоящие подключения в двух сетевых пространствах проверяет тест-«взломщик». */
const assert = require('node:assert');
const dgram = require('node:dgram');
const { test } = require('node:test');
const { createSchoolNet, NetError } = require('../desktop/school-net');

const v4 = (address, netmask) => ({ address, netmask, family: 'IPv4', internal: false });
const IFACES = { Ethernet: [v4('192.168.1.50', '255.255.255.0')], 'happ-xray': [v4('172.19.0.1', '255.255.255.0')] };

test('К18: адреса не из школьной подсети, имена, IPv6, адрес VPN и широковещательный адрес отвергаются до подключения', async () => {
  const net = createSchoolNet({ interfaces: () => IFACES, port: 9 });
  assert.equal(net.checkHost('192.168.1.10').name, 'Ethernet');
  const cases = { 'example.com': 'not-ip', localhost: 'not-ip', '::1': 'not-ip', '203.0.113.5': 'not-subnet', '8.8.8.8': 'not-subnet',
    '172.19.0.5': 'not-subnet', '192.168.1.255': 'not-subnet', '192.168.1.0': 'not-subnet', '127.0.0.1': 'not-subnet', '192.168.2.1': 'not-subnet' };
  for (const [ip, code] of Object.entries(cases)) {
    await assert.rejects(net.get(ip, '/v1/catalog', { maxBytes: 10 }), (e) => e instanceof NetError && e.code === code, ip);
  }
  await assert.rejects(net.get('192.168.1.10', '/v1/../catalog', { maxBytes: 10 }), (e) => e.code === 'path');
  assert.equal(net.active(), 0, 'ни одного запроса не начато');
});

test('К4, К18: без школьных интерфейсов обнаружение ничего не отправляет; после stop запросы не начинаются', async () => {
  const sent = [];
  const original = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function send(...args) { sent.push(args[2]); return original.apply(this, args); };
  try {
    const none = createSchoolNet({ interfaces: () => ({ 'happ-xray': IFACES['happ-xray'], lo: [{ ...v4('127.0.0.1', '255.0.0.0'), internal: true }] }) });
    assert.deepEqual(await none.discover('0123456789abcdef', 100), []);
    assert.deepEqual(sent, []);
  } finally {
    dgram.Socket.prototype.send = original;
  }
  const net = createSchoolNet({ interfaces: () => IFACES });
  net.stop();
  await assert.rejects(net.get('192.168.1.10', '/v1/catalog', { maxBytes: 10 }), (e) => e.code === 'stopped');
  assert.deepEqual(await net.discover('0123456789abcdef', 100), []);
  net.resume();
});
