'use strict';
/* Какая сеть считается школьной (ADR-0002, 3.4, 4.1; постановка М2). Общий модуль обеих программ, без ввода-вывода:
   на вход список интерфейсов в виде os.networkInterfaces(), на выход подходящие интерфейсы и проверка адреса.
   Школьная сеть — подсеть самого интерфейса. VPN и виртуальные адаптеры школьной сетью не считаются
   (находка 5 ОТЧЁТ-WINDOWS.md: адаптер happ-xray 172.19.0.1 был выбран первым). */
const os = require('os');

/* Имена адаптеров VPN, туннелей и виртуальных машин. Совпадение по слову внутри имени, без учёта регистра. */
const VIRTUAL_NAME = /(vpn|happ|xray|v2ray|clash|sing-?box|hiddify|outline|nekoray|tun\d*|tap\d*|utun|wg\d*|wireguard|openvpn|tailscale|zerotier|hamachi|radmin|nordlynx|proton|warp|cloudflare|vethernet|hyper-?v|virtualbox|vbox|vmware|vmnet|docker|br-[0-9a-f]|veth[0-9a-f]|virbr|wsl|loopback|npcap|bluetooth)/i;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/* Строгий IPv4-литерал: четыре числа 0–255 без ведущих нулей. Имена, IPv6, «010.1.1.1» и «1.1» не проходят. */
const isIPv4 = (s) => typeof s === 'string' && IPV4.test(s);

const toInt = (ip) => ip.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
const toIp = (n) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');

function prefixOf(mask) {
  if (!isIPv4(mask)) return -1;
  const n = toInt(mask);
  const inverted = ~n >>> 0;
  const bits = inverted === 0 ? 32 : Math.clz32(inverted); // число единиц в начале маски
  const expected = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return expected === n ? bits : -1; // маска должна быть сплошной: единицы, потом нули
}

/* Почему интерфейс не школьный, или null, если подходит. */
function rejectReason(name, a) {
  if (!a || (a.family !== 'IPv4' && a.family !== 4)) return 'не IPv4';
  if (a.internal) return 'loopback';
  if (!isIPv4(a.address) || a.address.startsWith('127.')) return 'loopback';
  if (VIRTUAL_NAME.test(name)) return 'VPN или виртуальный адаптер';
  const prefix = prefixOf(a.netmask);
  if (prefix < 0) return 'неверная маска';
  if (prefix > 30) return 'адрес без подсети (/31, /32), так бывает у VPN';
  if (prefix < 8) return 'слишком широкая маска';
  return null;
}

/* Подходящие интерфейсы: [{ name, address, netmask, prefix, network, broadcast }]. ifaces — os.networkInterfaces(). */
function schoolInterfaces(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const a of list || []) {
      if (rejectReason(name, a)) continue;
      const prefix = prefixOf(a.netmask);
      const mask = toInt(a.netmask);
      const network = (toInt(a.address) & mask) >>> 0;
      out.push({ name, address: a.address, netmask: a.netmask, prefix, network: toIp(network), broadcast: toIp((network | ~mask) >>> 0) });
    }
  }
  return out;
}

/* Все интерфейсы с причиной отказа: для журнала тьютора. */
function describeInterfaces(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const a of list || []) if (a && (a.family === 'IPv4' || a.family === 4)) out.push({ name, address: a.address, reason: rejectReason(name, a) });
  }
  return out;
}

const inSubnet = (ip, iface) => isIPv4(ip) && ((toInt(ip) & toInt(iface.netmask)) >>> 0) === toInt(iface.network);

/* Интерфейс, в подсети которого лежит адрес узла, или null. Адрес сети и широковещательный адрес узлом не считаются. */
function hostInterface(ip, list) {
  if (!isIPv4(ip)) return null;
  return list.find((i) => inSubnet(ip, i) && ip !== i.network && ip !== i.broadcast) || null;
}

/* Куда можно слать запрос обнаружения: широковещательные адреса подсетей и 255.255.255.255. */
function broadcastTargets(list) {
  const set = new Set(list.map((i) => i.broadcast));
  if (list.length) set.add('255.255.255.255');
  return [...set];
}

module.exports = { schoolInterfaces, describeInterfaces, rejectReason, hostInterface, inSubnet, broadcastTargets, isIPv4, prefixOf, VIRTUAL_NAME };
