'use strict';
/* Этап М2, С2: какая сеть считается школьной. VPN и виртуальные адаптеры — нет (находка 5 ОТЧЁТ-WINDOWS.md). */
const assert = require('node:assert');
const { test } = require('node:test');
const N = require('../shared/netif');

const v4 = (address, netmask, extra = {}) => ({ address, netmask, family: 'IPv4', internal: false, mac: '00:00:00:00:00:00', ...extra });

// Набор как на ПК Влада из ОТЧЁТ-WINDOWS.md и типичный ноутбук с Windows 11
const WINDOWS = {
  'happ-xray': [v4('172.19.0.1', '255.255.255.0')],
  Ethernet: [v4('192.168.1.50', '255.255.255.0'), { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', internal: false }],
  'Беспроводная сеть': [v4('10.20.30.40', '255.255.0.0')],
  'vEthernet (WSL (Hyper-V firewall))': [v4('172.28.112.1', '255.255.240.0')],
  Tailscale: [v4('100.101.102.103', '255.255.255.255')],
  'Подключение по локальной сети* 10': [v4('192.168.137.1', '255.255.255.0')],
  'OpenVPN Data Channel Offload': [v4('10.8.0.6', '255.255.255.0')],
  'Loopback Pseudo-Interface 1': [v4('127.0.0.1', '255.0.0.0', { internal: true })],
};
const LINUX = {
  lo: [v4('127.0.0.1', '255.0.0.0', { internal: true })],
  wlp3s0: [v4('192.168.0.23', '255.255.255.0')],
  docker0: [v4('172.17.0.1', '255.255.0.0')],
  tun0: [v4('10.66.0.2', '255.255.255.0')],
  wg0: [v4('10.7.0.2', '255.255.255.0')],
  'br-3f2a1b': [v4('172.18.0.1', '255.255.0.0')],
  enp2s0: [v4('203.0.113.7', '255.255.255.0')], // публичный адрес в локальной сети тоже школьная сеть
  odd: [v4('10.1.1.1', '255.0.255.0')],
};

test('С2: Windows — Ethernet, Wi-Fi и мобильный хот-спот школьные; happ-xray, vEthernet, Tailscale, OpenVPN и loopback нет', () => {
  const names = N.schoolInterfaces(WINDOWS).map((i) => i.name).sort();
  assert.deepEqual(names, ['Ethernet', 'Подключение по локальной сети* 10', 'Беспроводная сеть'].sort());
  const eth = N.schoolInterfaces(WINDOWS).find((i) => i.name === 'Ethernet');
  assert.deepEqual({ ...eth }, { name: 'Ethernet', address: '192.168.1.50', netmask: '255.255.255.0', prefix: 24, network: '192.168.1.0', broadcast: '192.168.1.255' });
  const wifi = N.schoolInterfaces(WINDOWS).find((i) => i.name === 'Беспроводная сеть');
  assert.equal(wifi.broadcast, '10.20.255.255');
  const reasons = Object.fromEntries(N.describeInterfaces(WINDOWS).map((d) => [d.name, d.reason]));
  assert.match(reasons['happ-xray'], /VPN/);
  assert.match(reasons.Tailscale, /VPN|\/32/);
  assert.equal(reasons.Ethernet, null);
});

test('С2: Linux — только wlp3s0 и enp2s0; docker, tun, wg, мосты и сломанная маска отброшены', () => {
  assert.deepEqual(N.schoolInterfaces(LINUX).map((i) => i.name).sort(), ['enp2s0', 'wlp3s0']);
});

test('С2: адрес узла только из подсети школьного интерфейса, не адрес сети и не широковещательный', () => {
  const list = N.schoolInterfaces(WINDOWS);
  assert.equal(N.hostInterface('192.168.1.10', list).name, 'Ethernet');
  assert.equal(N.hostInterface('10.20.99.1', list).name, 'Беспроводная сеть');
  for (const ip of ['192.168.1.0', '192.168.1.255', '172.19.0.5', '100.101.102.1', '8.8.8.8', '203.0.113.1', '127.0.0.1', '10.8.0.1', '192.168.2.10']) {
    assert.equal(N.hostInterface(ip, list), null, ip);
  }
  assert.deepEqual(N.broadcastTargets(list).sort(), ['10.20.255.255', '192.168.1.255', '192.168.137.255', '255.255.255.255']);
  assert.deepEqual(N.broadcastTargets([]), []);
});

test('С2: строгий IPv4-литерал: имена, IPv6, ведущие нули, короткая и восьмеричная записи не проходят', () => {
  for (const ip of ['192.168.1.10', '10.0.0.1', '0.0.0.0', '255.255.255.255']) assert.ok(N.isIPv4(ip), ip);
  for (const ip of ['example.com', 'localhost', '::1', '::ffff:192.168.1.1', '192.168.001.10', '0x7f.0.0.1', '10.1', '2130706433',
    '192.168.1.256', ' 192.168.1.1', '192.168.1.1 ', '192.168.1.1/24', '192.168.1.1:80', '', null, 12]) assert.ok(!N.isIPv4(ip), String(ip));
  assert.equal(N.prefixOf('255.255.255.0'), 24);
  assert.equal(N.prefixOf('255.255.0.0'), 16);
  assert.equal(N.prefixOf('255.255.255.255'), 32);
  assert.equal(N.prefixOf('0.0.0.0'), 0);
  assert.equal(N.prefixOf('255.0.255.0'), -1);
});
