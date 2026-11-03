'use strict';
/* IPC окна витрины. Четыре канала (ADR-0002, 4.1) и события game.closed и catalog.changed из основного процесса.
   Каждый аргумент из окна считается недоверенным: окно показывает тексты чужих авторов. */
const R = require('../../shared/ratings');

const CHANNELS = Object.freeze(['catalog.list', 'game.launch', 'vote.send', 'server.setAddress']);
const EVENT_CLOSED = 'game.closed';
const EVENT_CHANGED = 'catalog.changed';
const IP_TEXT = /^[0-9.]{7,15}$/;
const ID = /^[a-z0-9-]{1,40}$/;

class ApiError extends Error {}
const bad = (message) => { throw new ApiError(message); };

/* getCatalog: () => { games, skipped, missing, net? }. store: createStore. launch: (game, mode) => Promise<{ ok, reason? }>.
   played: Set "игра/режим", которые запускались в этом окне приложения.
   setAddress: (ip) => Promise<{ ok, reason? }>, только на настроенном ноутбуке. */
function createApi({ getCatalog, store, launch, played, setAddress = null }) {
  const findGame = (id) => {
    if (typeof id !== 'string' || !ID.test(id)) bad('Неверный id игры');
    return getCatalog().games.find((g) => g.id === id) || bad('Такой игры нет на витрине');
  };
  const findMode = (game, id) => {
    if (typeof id !== 'string' || !ID.test(id)) bad('Неверный id режима');
    return game.modes.find((m) => m.id === id) || bad('Такого режима нет в игре');
  };
  const arity = (args, n, name) => { if (args.length !== n) bad(`${name}: нужно аргументов: ${n}`); };

  const day = () => store.day();
  /* То, что видит окно: без путей к файлам и ключей. */
  function gameView(g, today = day()) {
    const ratings = store.ratings();
    const counts = g.modes.map((m) => R.countsOf(ratings, g.id, m.id));
    return {
      id: g.id, title: g.title, description: g.description, grades: g.grades, minutes: g.minutes, topic: g.topic,
      author: g.author, byTutor: !!g.byTutor, state: g.state, progress: g.progress || 0, groups: g.groups, cover: g.cover, multiMode: g.multiMode,
      rating: R.summarize(R.sumCounts(counts)),
      modes: g.modes.map((m, i) => ({
        id: m.id, title: m.title, about: m.about, cover: m.cover, rating: R.summarize(counts[i]),
        played: played.has(`${g.id}/${m.id}`), votedToday: R.hasVoted(today, g.id, m.id),
      })),
    };
  }

  return {
    'catalog.list': (...args) => {
      arity(args, 0, 'catalog.list');
      const catalog = getCatalog();
      const today = day();
      return {
        games: catalog.games.map((g) => gameView(g, today)), skipped: catalog.skipped.length, missing: catalog.missing,
        net: catalog.net || { configured: false },
      };
    },
    'game.launch': async (...args) => {
      arity(args, 2, 'game.launch');
      const game = findGame(args[0]);
      const mode = findMode(game, args[1]);
      if (game.state !== 'ready') return { ok: false, reason: game.state };
      const result = await launch(game, mode);
      if (result.ok) played.add(`${game.id}/${mode.id}`);
      return { ok: !!result.ok, ...(result.ok ? {} : { reason: String(result.reason || 'failed') }) };
    },
    'vote.send': (...args) => {
      arity(args, 3, 'vote.send');
      const game = findGame(args[0]);
      const mode = findMode(game, args[1]);
      const value = args[2];
      if (!Number.isInteger(value) || value < 1 || value > 5) bad('Оценка: целое число от 1 до 5');
      // Оценить можно только то, что запускали в этом окне: окно витрины само по себе этого не докажет
      if (!played.has(`${game.id}/${mode.id}`)) return { ok: false, reason: 'not-played' };
      const map = new Map(getCatalog().games.map((g) => [g.id, new Set(g.modes.map((m) => m.id))]));
      const result = store.vote(map, game.id, mode.id, value);
      return result.ok ? { ok: true, game: gameView(game) } : result;
    },
    'server.setAddress': async (...args) => {
      arity(args, 1, 'server.setAddress');
      const ip = args[0];
      if (typeof ip !== 'string' || !IP_TEXT.test(ip)) return { ok: false, reason: 'not-ip' };
      if (!setAddress) return { ok: false, reason: 'not-configured' };
      const result = await setAddress(ip);
      return { ok: !!result.ok, ...(result.ok ? {} : { reason: String(result.reason) }) };
    },
  };
}

module.exports = { CHANNELS, EVENT_CLOSED, EVENT_CHANGED, createApi, ApiError };
