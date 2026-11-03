'use strict';
/* В4–В6: отмена 5 с, одна оценка режима в день, среднее и «мало оценок». */
const assert = require('node:assert');
const { test } = require('node:test');
const R = require('../shared/ratings');
const { createPendingVotes } = require('../desktop/vitrina/ui/vote-timer');

/* Поддельные часы: время идёт только по команде теста. */
function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { seq += 1; timers.set(seq, { fn, at: t + ms }); return seq; },
    clearTimer: (id) => { timers.delete(id); },
    tick(ms) {
      t += ms;
      for (const [id, item] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (item.at <= t && timers.has(id)) { timers.delete(id); item.fn(); }
      }
    },
  };
}
function votesWithClock() {
  const clock = fakeClock();
  const sent = [];
  const votes = createPendingVotes({ ...clock, send: (...args) => sent.push(args) });
  return { clock, sent, votes };
}

// В4
test('В4: голос уходит ровно через 5 с, не раньше', () => {
  const { clock, sent, votes } = votesWithClock();
  votes.start('kiberpochta', 'default', 4);
  clock.tick(4999);
  assert.deepEqual(sent, []);
  assert.equal(votes.remaining('kiberpochta', 'default'), 1);
  clock.tick(1);
  assert.deepEqual(sent, [['kiberpochta', 'default', 4]]);
  assert.equal(votes.remaining('kiberpochta', 'default'), null);
});

test('В4: «Отменить» в течение 5 с снимает голос, отправки нет', () => {
  const { clock, sent, votes } = votesWithClock();
  votes.start('kiberpochta', 'default', 2);
  clock.tick(4900);
  assert.equal(votes.cancel('kiberpochta', 'default'), true);
  clock.tick(10000);
  assert.deepEqual(sent, []);
});

test('В4: после отправки отменить уже нельзя', () => {
  const { clock, sent, votes } = votesWithClock();
  votes.start('a', 'm', 5);
  clock.tick(5000);
  assert.equal(votes.cancel('a', 'm'), false);
  assert.equal(sent.length, 1);
});

test('В4: смена звёзд до отправки уходит одним голосом с новым значением, 5 с заново', () => {
  const { clock, sent, votes } = votesWithClock();
  votes.start('a', 'm', 1);
  clock.tick(3000);
  votes.start('a', 'm', 5);
  clock.tick(3000);
  assert.deepEqual(sent, []);
  clock.tick(2000);
  assert.deepEqual(sent, [['a', 'm', 5]]);
});

test('В4: голоса разных режимов не мешают друг другу', () => {
  const { clock, sent, votes } = votesWithClock();
  votes.start('a', 'x', 3);
  clock.tick(1000);
  votes.start('a', 'y', 4);
  votes.cancel('a', 'x');
  clock.tick(5000);
  assert.deepEqual(sent, [['a', 'y', 4]]);
});

// В5
const day = (iso) => R.localDay(new Date(iso));
test('В5: тот же режим второй раз в тот же день нельзя', () => {
  let state = R.dayState(null, day('2026-11-03T10:00:00'));
  assert.equal(R.hasVoted(state, 'kiberpochta', 'default'), false);
  state = R.markVoted(state, 'kiberpochta', 'default');
  const saved = JSON.parse(JSON.stringify(state)); // как после записи в state.json и чтения
  const later = R.dayState(saved, day('2026-11-03T23:59:00'));
  assert.equal(R.hasVoted(later, 'kiberpochta', 'default'), true);
});

test('В5: назавтра тот же режим можно, список очищен', () => {
  const state = R.markVoted(R.dayState(null, '2026-11-03'), 'kiberpochta', 'default');
  const tomorrow = R.dayState(JSON.parse(JSON.stringify(state)), day('2026-11-04T00:00:01'));
  assert.equal(R.hasVoted(tomorrow, 'kiberpochta', 'default'), false);
  assert.deepEqual(tomorrow, { votedOn: '2026-11-04', voted: [] });
});

test('В5: другой режим той же игры и другая игра в тот же день можно', () => {
  const state = R.markVoted(R.dayState(null, '2026-11-03'), 'tri-rezhima', 'training');
  assert.equal(R.hasVoted(state, 'tri-rezhima', 'exam'), false);
  assert.equal(R.hasVoted(state, 'kiberpochta', 'training'), false);
});

test('В5: в state.json только факт оценки, без звёзд', () => {
  const state = R.markVoted(R.dayState(null, '2026-11-03'), 'a', 'b');
  assert.deepEqual(state, { votedOn: '2026-11-03', voted: ['a/b'] });
});

test('В5: испорченный state.json считается пустым, а не ломает приложение', () => {
  for (const bad of [null, 'x', [], { votedOn: '2026-11-03', voted: 'a/b' }, { votedOn: '2026-11-03', voted: ['../x'] }]) {
    assert.deepEqual(R.dayState(bad, '2026-11-03').voted, []);
  }
});

test('В5: день считается по местной дате', () => {
  assert.equal(R.localDay(new Date(2026, 10, 3, 23, 59)), '2026-11-03');
  assert.equal(R.localDay(new Date(2026, 10, 4, 0, 0)), '2026-11-04');
});

// В6
const catalog = new Map([['labirint-robota', new Set(['training', 'exam'])], ['kiberpochta', new Set(['default'])]]);
const SAMPLE = { format: 1, games: { 'labirint-robota': {
  training: { 1: 0, 2: 1, 3: 1, 4: 4, 5: 8 },
  exam: { 1: 0, 2: 0, 3: 0, 4: 3, 5: 12 },
} } };

test('В6: среднее из примера ADR-0003: (2+3+16+40)/14 = 4.4 и (12+60)/15 = 4.8', () => {
  const r = R.parseRatings(JSON.stringify(SAMPLE));
  assert.deepEqual(R.summarize(R.countsOf(r, 'labirint-robota', 'training')), { n: 14, few: false, avg: 4.4 });
  assert.deepEqual(R.summarize(R.countsOf(r, 'labirint-robota', 'exam')), { n: 15, few: false, avg: 4.8 });
});

test('В6: среднее по игре складывает режимы: 133/29 = 4.6', () => {
  const r = R.parseRatings(JSON.stringify(SAMPLE));
  const total = R.sumCounts(['training', 'exam'].map((m) => R.countsOf(r, 'labirint-robota', m)));
  assert.deepEqual(R.summarize(total), { n: 29, few: false, avg: 4.6 });
});

test('В6: при n < 5 «мало оценок», среднее не раскрывается', () => {
  assert.deepEqual(R.summarize({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 4 }), { n: 4, few: true, avg: null });
  assert.deepEqual(R.summarize({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }), { n: 0, few: true, avg: null });
  assert.deepEqual(R.summarize({ 1: 1, 2: 0, 3: 0, 4: 0, 5: 4 }), { n: 5, few: false, avg: 4.2 });
});

test('В6: округление до одного знака: 4.45 → 4.5, 4.44 → 4.4', () => {
  // 89/20 = 4.45; 111/25 = 4.44
  assert.equal(R.summarize({ 1: 0, 2: 0, 3: 0, 4: 11, 5: 9 }).avg, 4.5);
  assert.equal(R.summarize({ 1: 0, 2: 0, 3: 0, 4: 14, 5: 11 }).avg, 4.4);
});

test('В6: голос увеличивает счётчик на 1 и не меняет старый объект', () => {
  const before = R.emptyRatings();
  const after = R.addVote(before, catalog, 'kiberpochta', 'default', 5);
  assert.deepEqual(before, { format: 1, games: {} });
  assert.deepEqual(after, { format: 1, games: { kiberpochta: { default: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 } } } });
  assert.deepEqual(R.parseRatings(JSON.stringify(after)), after);
});

test('В6: игра и режим не из каталога, дробное и внешнее значение отвергаются', () => {
  const r = R.emptyRatings();
  assert.throws(() => R.addVote(r, catalog, 'chuzhaya', 'default', 5), /игры нет/);
  assert.throws(() => R.addVote(r, catalog, 'kiberpochta', 'exam', 5), /режима нет/);
  assert.throws(() => R.addVote(r, catalog, 'constructor', 'default', 5), /игры нет/);
  for (const v of [0, 6, 4.5, '5', NaN, null]) assert.throws(() => R.addVote(r, catalog, 'kiberpochta', 'default', v), /от 1 до 5/);
});

test('В6: испорченный ratings.json распознаётся', () => {
  for (const bad of ['', '{', '[]', '{"format":2,"games":{}}', '{"format":1,"games":{"a":{"m":{"6":1}}}}',
    '{"format":1,"games":{"a":{"m":{"1":-1}}}}', '{"format":1,"games":{"a":{"m":{"1":1.5}}}}', '{"format":1,"games":{"A B":{}}}']) {
    assert.equal(R.parseRatings(bad), null, bad);
  }
  assert.deepEqual(R.parseRatings('{"format":1,"games":{"a":{"m":{"5":2}}}}').games.a.m, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 2 });
});
