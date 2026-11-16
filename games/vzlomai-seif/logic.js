/* ========================================================================
   Взломай сейф 5 — «Секретный канал: хранилище». Логика без интерфейса.
   Сигналы (вспышки), договорённости-«словари», алфавит из 5 вспышек.
   Работает и в браузере (window.ChannelLogic), и в Node (require).
   ======================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChannelLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const bitsOf = (v, n) => Array.from({ length: n }, (_, i) => (Math.floor(v / Math.pow(2, n - 1 - i)) % 2));
  const valueOf = (bits) => bits.reduce((s, b, i) => s + (b ? Math.pow(2, bits.length - 1 - i) : 0), 0);
  const capacity = (n) => Math.pow(2, n);
  const patterns = (n) => Array.from({ length: capacity(n) }, (_, v) => bitsOf(v, n));
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const minSlots = (k) => { let n = 0; while (capacity(n) < k) n++; return n; };
  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

  function flashWord(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return n + ' вспышка';
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return n + ' вспышки';
    return n + ' вспышек';
  }

  /* ---------- уровень 1: два варианта ---------- */
  const STATE = [{ name: 'ЗАКРЫТ' }, { name: 'ОТКРЫТ' }];
  const STATE_BOOK = [[0], [1]];

  /* ---------- уровень 2: четыре сейфа ---------- */
  const SAFES = [
    { name: 'Красный', color: '#FF4D5E' },
    { name: 'Синий', color: '#4D9BFF' },
    { name: 'Зелёный', color: '#34D17A' },
    { name: 'Жёлтый', color: '#FFC933' }
  ];

  /* Проверка договорённости: book[i] — сигнал (вспышки) для i-го варианта. */
  function validateBook(book, n, names) {
    if (capacity(n) < names.length) {
      return { ok: false, kind: 'few', text: 'С ' + (n === 1 ? 'одной вспышкой' : flashWord(n)) + ' получается всего ' + capacity(n) + ' разных сигнала, а сейфов ' + names.length + '. Напарник их перепутает. Что можно добавить?' };
    }
    for (let i = 0; i < book.length; i++) for (let j = i + 1; j < book.length; j++) {
      if (same(book[i], book[j])) return { ok: false, kind: 'dup', i, j, text: 'Сигналы для «' + names[i] + '» и «' + names[j] + '» одинаковые. Напарник не поймёт, какой открывать.' };
    }
    return { ok: true, kind: 'ok', text: '' };
  }
  const decodeBook = (book, bits) => book.findIndex((b) => same(b, bits));

  /* Угадай, сколько разных сигналов даст n вспышек. */
  function diagnoseCount(choice, n) {
    const right = capacity(n);
    if (choice === right) return { ok: true, text: 'Да, ' + right + '. Каждая новая вспышка удваивает число сигналов: 2, 4, 8, 16…' };
    if (choice < right) return { ok: false, text: 'Больше. Посмотри: с одной вспышкой 2 сигнала, с двумя 4. Каждая новая вспышка удваивает.' };
    return { ok: false, text: 'Меньше. Ты прибавляешь, а нужно удваивать: 2, 4, … каждая новая вспышка даёт вдвое больше.' };
  }

  /* ---------- уровень 3: буквы ---------- */
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const LETTER_SLOTS = minSlots(LETTERS.length);          // 5
  const letterBits = (ch) => bitsOf(LETTERS.indexOf(ch) + 1, LETTER_SLOTS);   // A = 00001
  const LETTER_BOOK = LETTERS.map(letterBits);
  const WORDS = [['CAT', 'кот'], ['DOG', 'собака'], ['SUN', 'солнце'], ['BOX', 'коробка'], ['MAP', 'карта'], ['FOX', 'лиса']];

  function diagnoseSlots(n, count) {
    const cap = capacity(n);
    if (cap < count) return { ok: false, kind: 'few', text: 'С ' + flashWord(n) + ' получится ' + cap + ' разных сигналов, а букв ' + count + '. Не хватит.' };
    if (n > minSlots(count)) return { ok: false, kind: 'over', text: flashWord(n) + ' дадут ' + cap + ' сигналов. Хватит, но одна вспышка лишняя: чем короче сигнал, тем быстрее передача. Попробуй меньше.' };
    return { ok: true, kind: 'ok', text: flashWord(n) + ' дают ' + cap + ' сигналов. Букв ' + count + ', значит хватает и даже остаётся.' };
  }

  function toLatin(text, max) {
    const T = { А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'ZH', З: 'Z', И: 'I', Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'KH', Ц: 'TS', Ч: 'CH', Ш: 'SH', Щ: 'SCH', Ъ: '', Ы: 'Y', Ь: '', Э: 'E', Ю: 'YU', Я: 'YA' };
    return String(text).toUpperCase().split('').map((c) => (T[c] !== undefined ? T[c] : c)).join('').replace(/[^A-Z]/g, '').slice(0, max || 6);
  }

  function makeRun(rng) {
    const t = [];
    while (t.length < 3) { const v = Math.floor(rng() * SAFES.length); if (t[t.length - 1] !== v && (t.length < 2 || v !== t[t.length - 2])) t.push(v); }
    return { safeTargets: t, word: pick(WORDS, rng) };
  }


  /* ---------- версия 5: хранилище ---------- */
  const FINAL_WORD = 'BINARY';
  const FINAL_RU = 'двоичный';
  const weights = (n) => Array.from({ length: n }, (_, i) => Math.pow(2, n - 1 - i));
  const litWeights = (v, n) => weights(n).filter((_, i) => bitsOf(v, n)[i]);
  const PICS = [
    { name: 'сердце', rows: [10, 31, 31, 14, 4] },
    { name: 'домик', rows: [4, 14, 31, 17, 31] },
    { name: 'ёлка', rows: [4, 14, 31, 4, 4] },
    { name: 'улыбка', rows: [10, 10, 0, 17, 14] }
  ];
  const NUM_POOL = [[3, 5], [6, 7], [10, 11, 12, 13, 14]];

  function threeNoRepeat(rng, k) {
    const t = [];
    while (t.length < 3) { const v = Math.floor(rng() * k); if (t[t.length - 1] !== v && (t.length < 2 || v !== t[t.length - 2])) t.push(v); }
    return t;
  }
  function makeRun5(rng) {
    return {
      safeTargets: threeNoRepeat(rng, 4),
      rounds: threeNoRepeat(rng, 4),
      word: pick(WORDS, rng),
      nums: NUM_POOL.map((p) => pick(p, rng)),
      pic: pick(PICS, rng)
    };
  }

  /* Какой сейф и где стоит: уровни идут по порядку. */
  function nextSafe(done, total) {
    for (let i = 0; i < total; i++) if (!done[i]) return i;
    return total;
  }

  return { FINAL_WORD, FINAL_RU, weights, litWeights, PICS, NUM_POOL, makeRun5, nextSafe, bitsOf, valueOf, capacity, patterns, same, minSlots, flashWord, STATE, STATE_BOOK, SAFES, validateBook, decodeBook,
    diagnoseCount, LETTERS, LETTER_SLOTS, letterBits, LETTER_BOOK, WORDS, diagnoseSlots, toLatin, makeRun };
});
