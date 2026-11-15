/* ========================================================================
   Взломай сейф 5 — «Секретный канал: хранилище». Интерфейс.
   Комната с видом сверху: герой ходит, подходит к сейфам (уровням), в каждом
   сейфе буква. Шесть букв складываются в слово BINARY для главной двери.
   Идея уровней: один фонарик (горит / не горит), двоичный код ребёнок
   изобретает сам. Логика лежит в logic.js. Звук — WebAudio.
   ======================================================================== */
(function () {
  'use strict';

  var X = window.ChannelLogic;
  var app = document.getElementById('app');
  var LOOT = X.FINAL_WORD.split('');
  var TOTAL = 6;

  /* ---------- помощники ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    (function add(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c == null || c === false) continue;
        if (Array.isArray(c)) add(c);
        else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    })(Array.prototype.slice.call(arguments, 2));
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function zeros(n) { return Array.from({ length: n }, function () { return 0; }); }

  /* ---------- сохранение (только во вкладке) ---------- */
  var KEY = 'vzlomai-seif-5:v1';
  var G = { done: [], run: null, cur: -1, hero: { x: 500, y: 430 }, started: false, finished: false, introSeen: false, lastLoot: -1 };
  (function () {
    try { var v = JSON.parse(sessionStorage.getItem(KEY)); if (v && Array.isArray(v.done)) { G.done = v.done; G.started = !!v.started; G.finished = !!v.finished; } } catch (e) { /* ничего */ }
  })();
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify({ done: G.done, started: G.started, finished: G.finished })); } catch (e) { /* ничего */ } }

  /* ---------- звук ---------- */
  var sound = true, ac = null;
  function ctxAudio() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, d, type, vol, delay, slide) {
    if (!sound) return;
    var a = ctxAudio(); if (!a) return;
    var t0 = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t0 + d);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.1, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + d + 0.02);
  }
  var sfx = {
    on: function (i) { tone(380 + (i || 0) * 60, 0.09, 'triangle', 0.1); },
    off: function () { tone(220, 0.07, 'triangle', 0.07); },
    click: function () { tone(520, 0.05, 'triangle', 0.06); },
    flash: function () { tone(880, 0.22, 'sine', 0.1); },
    ok: function () { tone(660, 0.1, 'sine', 0.12); tone(990, 0.16, 'sine', 0.1, 0.08); },
    bad: function () { tone(190, 0.28, 'sawtooth', 0.09, 0, -90); },
    unlock: function () { tone(120, 0.12, 'square', 0.12, 0, -40); tone(300, 0.08, 'square', 0.08, 0.14); tone(520, 0.3, 'triangle', 0.1, 0.25); },
    win: function () { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.12, i * 0.1); }); },
    zoom: function () { tone(160, 0.6, 'sine', 0.08, 0, 260); }
  };

  /* ---------- служебное ---------- */
  var UI = {};
  var timers = [], loop = null, R = null;
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function cleanup() {
    timers.forEach(clearTimeout); timers = [];
    if (loop) { clearInterval(loop); loop = null; }
    R = null; UI = {};
  }
  function flash(green) {
    var f = document.getElementById('flash'); f.className = 'flash' + (green ? ' green' : '');
    void f.offsetWidth; f.className += ' go';
  }
  function renderHud(pop) {
    var box = document.getElementById('locks'); clear(box);
    if (!G.started) return;
    var l = h('div', { class: 'hudl', 'aria-label': 'Найденные буквы' });
    LOOT.forEach(function (ch, i) { l.appendChild(h('b', { class: (G.done[i] ? 'got' : '') + (pop === i ? ' pop' : ''), text: G.done[i] ? ch : '?' })); });
    box.appendChild(l);
  }

  /* ---------- общие части экрана задания ---------- */
  function say(text, tone2) {
    if (!UI.say) return;
    UI.say.textContent = text; UI.chef.className = 'chef' + (tone2 === 'good' ? ' good' : tone2 === 'bad' ? ' bad' : '');
  }
  function lamp(o) {
    var b = h('button', { type: 'button', class: 'lamp' + (o.small ? ' sm' : ''), 'aria-pressed': String(!!o.on), 'aria-label': o.aria || 'Лампочка' },
      h('span', { class: 'bulb' }), h('span', { class: 'wt', text: o.label == null ? '' : String(o.label) }));
    if (o.disabled) b.disabled = true; else b.addEventListener('click', o.onToggle);
    return b;
  }
  function setLamp(b, on) { b.setAttribute('aria-pressed', String(!!on)); }
  function safeBox(kids) {
    UI.inside = h('div', { class: 'inside' });
    UI.door = h('div', { class: 'door' }, kids);
    UI.safe = h('div', { class: 'safe' }, UI.inside, UI.door);
    return UI.safe;
  }
  function openSafe(title, text, extra) {
    clear(UI.inside);
    UI.inside.appendChild(h('div', null, h('div', { class: 'gold', text: title }), text ? h('p', { text: text }) : null, extra || null));
    UI.safe.classList.add('open'); sfx.unlock(); flash(true);
  }
  function reward(title, text, extra) {
    var letter = h('div', { class: 'gold', style: 'font-size:64px;margin-top:6px', text: LOOT[G.cur] });
    openSafe(title, text, h('div', null, extra || null, h('p', { text: 'В сейфе буква:' }), letter));
    levelDone();
  }
  function sideBox(chefText, goalNode) {
    UI.say = h('div', { class: 'say', 'aria-live': 'polite', text: chefText });
    UI.chef = h('div', { class: 'chef' }, h('div', { class: 'face' }), h('div', null, h('span', { class: 'tag', text: 'ШЕФ' }), UI.say));
    var side = h('aside', { class: 'side' }, UI.chef);
    if (goalNode) side.appendChild(h('div', { class: 'task' }, h('span', { class: 'tl', text: 'ЗАДАНИЕ' }), goalNode));
    UI.side = side;
    return side;
  }
  function hintButton(fn) {
    UI.hintBtn = h('button', { type: 'button', class: 'btn small ghost', text: 'Подсказка', onclick: function () { sfx.click(); fn(); } });
    return UI.hintBtn;
  }
  function nextButton(label, shown) {
    UI.next = h('button', { type: 'button', class: 'btn primary', text: label || 'Дальше', hidden: !shown, onclick: function () { sfx.click(); showRoom(); } });
    return UI.next;
  }
  function page(stage, side) {
    clear(app); app.appendChild(h('div', { class: 'step' }, h('div', { class: 'stage' }, stage), side));
  }
  function levelDone() {
    G.done[G.cur] = true; G.lastLoot = G.cur; save(); renderHud();
    if (UI.next) { UI.next.hidden = false; UI.next.textContent = 'Забрать букву «' + LOOT[G.cur] + '»'; }
    if (UI.hintBtn) UI.hintBtn.hidden = true;
  }
  function dots(bits, big) {
    var d = h('span', { class: 'dots' + (big ? ' lg' : '') });
    bits.forEach(function (b) { d.appendChild(h('i', { class: b ? 'on' : '' })); });
    return d;
  }
  function chipEl(o) { return h('span', { class: 'chip2' + (o.color ? '' : ' nodot'), style: o.color ? '--c:' + o.color : null, text: o.name }); }
  function bookPanel(title, outcomes, book, cols, letters) {
    var g = h('div', { class: 'book c' + (cols || 1) });
    outcomes.forEach(function (o, i) {
      g.appendChild(h('div', { class: 'bk' }, letters ? h('span', { class: 'l', text: o.name }) : chipEl(o), dots(book[i])));
    });
    return h('div', { class: 'panel' }, h('h3', { text: title }), letters ? h('div', { class: 'scroll' }, g) : g);
  }
  function opts(values, onPick) {
    var box = h('div', { class: 'opts' });
    values.forEach(function (v) {
      box.appendChild(h('button', { type: 'button', class: 'opt', text: String(v), onclick: function (e) {
        ctxAudio(); var b = e.currentTarget; var ok = onPick(v);
        if (!ok) { b.classList.remove('no'); void b.offsetWidth; b.classList.add('no'); }
      } }));
    });
    return box;
  }
  function picGrid(rows, big) {
    var g = h('div', { class: 'sk' + (big ? ' big' : '') }), cells = [];
    rows.forEach(function () { for (var c = 0; c < 5; c++) { var i = h('i'); cells.push(i); g.appendChild(i); } });
    g.update = function (rws) { rws.forEach(function (v, r) { X.bitsOf(v, 5).forEach(function (b, c) { cells[r * 5 + c].className = b ? 'on' : ''; }); }); };
    g.update(rows);
    return g;
  }

  /* ========== отправка сигнала: общий механизм ========== */
  function sender(o) {
    var n = o.n, bits = zeros(n), t = 0, locked = false, got = '';
    var lampEls = bits.map(function (_, i) {
      return lamp({ small: n >= 4, label: i + 1, aria: 'Вспышка ' + (i + 1), onToggle: function () {
        if (locked) return; ctxAudio();
        bits[i] = bits[i] ? 0 : 1; setLamp(lampEls[i], bits[i]); if (bits[i]) sfx.on(i); else sfx.off();
        lampEls[i].classList.remove('hintglow');
      } });
    });
    var beam = h('div', { class: 'beam watch', text: 'тихо' });
    var missionEl = h('div', { class: 'mission' }), trip = h('div', { class: 'trip' });
    var msg = h('div', { class: 'msg msgb', 'aria-live': 'polite' });
    var wordEl = h('div', { class: 'word' }), chipsBox = h('div', { class: 'chips' }), chipEls = [];
    if (o.reaction === 'chips') o.outcomes.forEach(function (oc) { var c = chipEl(oc); chipEls.push(c); chipsBox.appendChild(c); });
    var sendBtn = h('button', { type: 'button', class: 'btn go', text: 'Отправить сигнал', onclick: send });
    var duo = h('div', { class: 'duo' },
      h('div', { class: 'room' }, h('h4', { text: 'Твой фонарик' }), h('div', { class: 'lamps' }, lampEls)),
      h('div', { class: 'room' }, h('h4', { text: 'Окно напарника' }), beam));
    function drawWord() {
      clear(wordEl);
      o.word.split('').forEach(function (ch, i) { wordEl.appendChild(document.createTextNode(i < got.length ? ch : '_')); });
    }
    function showMission() {
      clear(missionEl); missionEl.appendChild(o.label(o.targets[t]));
      trip.textContent = 'Задание ' + (t + 1) + ' из ' + o.targets.length;
    }
    page(safeBox([trip, missionEl, duo, o.reaction === 'chips' ? chipsBox : wordEl, msg, h('div', { class: 'actions' }, sendBtn)]),
      sideBox(o.chef, o.goal));
    UI.side.appendChild(o.bookNode);
    UI.side.appendChild(h('div', { class: 'actions' }, nextButton(), hintButton(function () {
      var b = o.book[o.targets[t]];
      b.forEach(function (v, i) { if (v) lampEls[i].classList.add('hintglow'); });
      say('Подсвечены вспышки, которые нужно включить по договорённости.', '');
    })));
    if (o.reaction === 'word') drawWord();
    showMission();

    function send() {
      if (locked) return; ctxAudio(); locked = true; sendBtn.disabled = true; msg.textContent = ''; msg.className = 'msg msgb';
      var seq = bits.slice();
      seq.forEach(function (b, i) {
        later(function () {
          beam.className = 'beam watch' + (b ? ' on' : ''); beam.textContent = 'вспышка ' + (i + 1);
          lampEls.forEach(function (l, j) { l.classList.toggle('nudge', j === i); });
          if (b) sfx.flash();
        }, i * 800);
      });
      later(function () {
        lampEls.forEach(function (l) { l.classList.remove('nudge'); }); beam.className = 'beam watch'; beam.textContent = 'тихо';
        decode(seq);
      }, n * 800 + 300);
    }
    function decode(seq) {
      var idx = X.decodeBook(o.book, seq), want = o.targets[t];
      chipEls.forEach(function (c) { c.classList.remove('hit', 'bad'); });
      if (idx < 0) { fail('Напарник не понял сигнал: такого в договорённости нет.'); return; }
      if (o.reaction === 'chips') chipEls[idx].classList.add(idx === want ? 'hit' : 'bad');
      if (idx !== want) { fail('Напарник понял «' + o.outcomes[idx].name + '», а нужно было «' + o.outcomes[want].name + '». Проверь по договорённости справа.'); return; }
      sfx.ok(); flash(true); msg.className = 'msg msgb good'; msg.textContent = o.okText ? o.okText(idx) : 'Напарник всё понял.';
      if (o.reaction === 'word') { got += o.outcomes[idx].name; drawWord(); }
      t++;
      if (t >= o.targets.length) { later(o.onDone, 1100); return; }
      later(function () {
        bits = zeros(n); lampEls.forEach(function (l) { setLamp(l, 0); l.classList.remove('hintglow'); });
        chipEls.forEach(function (c) { c.classList.remove('hit', 'bad'); });
        msg.textContent = ''; msg.className = 'msg msgb'; locked = false; sendBtn.disabled = false; showMission();
      }, 1400);
    }
    function fail(text) {
      sfx.bad(); msg.className = 'msg msgb bad'; msg.textContent = text; locked = false; sendBtn.disabled = false;
    }
  }

  /* ========== сейф 1: один сигнал ========== */
  function lvSignal() {
    sender({
      n: 1, outcomes: X.STATE, book: X.STATE_BOOK, targets: [1, 0, 1], reaction: 'chips',
      chef: 'Агент, у нас с напарником одно окно и один фонарик. Договорились: свет значит ОТКРЫТ, темно значит ЗАКРЫТ. Нажми на лампочку, чтобы включить вспышку, и отправь.',
      goal: h('div', { class: 'tt' }, 'Передай напарнику ', h('b', { text: 'состояние сейфа' }), ' одной вспышкой.'),
      bookNode: bookPanel('Договорённость', X.STATE, X.STATE_BOOK, 1),
      label: function (idx) { return h('div', null, 'Сейф ', h('b', { text: X.STATE[idx].name }), '. Скажи об этом напарнику.'); },
      okText: function (idx) { return idx === 0 ? 'Темнота тоже сигнал: напарник понял «ЗАКРЫТ».' : 'Свет: напарник понял «ОТКРЫТ».'; },
      onDone: function () { reward('Связь есть!', 'Одна вспышка передаёт одно из двух: да или нет.'); }
    });
  }

  /* ========== сейф 2: четыре цвета ========== */
  function lvFour() {
    var n = 1, book = X.SAFES.map(function () { return zeros(n); });
    var names = X.SAFES.map(function (s) { return s.name; });
    var ctlN = h('div', { class: 'n' }), cap = h('div', { class: 'cap' }), rowsBox = h('div', { class: 'sendrows', style: 'gap:8px;width:100%;align-items:center' });
    var listBox = h('div', { class: 'chips', style: 'max-width:480px' }), listOn = false, msg = h('div', { class: 'msg msgb' });
    var minus = h('button', { type: 'button', 'aria-label': 'Меньше вспышек', text: '−', onclick: function () { setN(n - 1); } });
    var plus = h('button', { type: 'button', 'aria-label': 'Больше вспышек', text: '+', onclick: function () { setN(n + 1); } });
    function setN(v) {
      v = Math.max(1, Math.min(4, v)); if (v === n) return; sfx.click(); n = v;
      book = X.SAFES.map(function () { return zeros(n); }); msg.textContent = ''; redraw();
    }
    function redraw() {
      ctlN.textContent = X.flashWord(n); cap.textContent = 'Разных сигналов: ' + X.capacity(n);
      minus.disabled = n <= 1; plus.disabled = n >= 4; clear(rowsBox);
      X.SAFES.forEach(function (s, i) {
        var row = h('div', { class: 'edrow' }, chipEl(s), h('div', { class: 'lamps' }, book[i].map(function (b, j) {
          var l = lamp({ small: true, on: b, label: j + 1, aria: s.name + ', вспышка ' + (j + 1), onToggle: function () {
            ctxAudio(); book[i][j] = book[i][j] ? 0 : 1; setLamp(l, book[i][j]); if (book[i][j]) sfx.on(j); else sfx.off(); mark();
          } });
          return l;
        })));
        rowsBox.appendChild(row);
      });
      mark(); drawList();
    }
    function mark() {
      var rows = rowsBox.querySelectorAll('.edrow');
      for (var i = 0; i < rows.length; i++) {
        var dup = book.some(function (b, j) { return j !== i && X.same(b, book[i]); });
        rows[i].className = 'edrow' + (dup ? ' bad' : '');
      }
    }
    function drawList() {
      clear(listBox); if (!listOn) return;
      X.patterns(n).forEach(function (p) { listBox.appendChild(h('span', { class: 'chip2 nodot' }, dots(p))); });
    }
    var showBtn = h('button', { type: 'button', class: 'btn small ghost', text: 'Показать все сигналы', onclick: function () { sfx.click(); listOn = !listOn; showBtn.textContent = listOn ? 'Спрятать сигналы' : 'Показать все сигналы'; drawList(); } });
    var okBtn = h('button', { type: 'button', class: 'btn go', text: 'Договорились', onclick: function () {
      ctxAudio(); var r = X.validateBook(book, n, names);
      if (!r.ok) { sfx.bad(); msg.className = 'msg msgb bad'; msg.textContent = r.text; say(r.text, 'bad'); return; }
      sfx.ok(); flash(true); missions();
    } });
    page(safeBox([h('div', { class: 'trip', text: 'Договорись с напарником' }),
      h('div', { class: 'mission', text: 'Сейфов четыре. Придумай свой сигнал для каждого.' }),
      h('div', { class: 'ctl' }, minus, ctlN, plus), cap, rowsBox, showBtn, listBox, msg,
      h('div', { class: 'actions' }, okBtn)]),
      sideBox('Теперь цветных сейфов четыре, и напарник должен понять, какой открывать. Сигнал состоит из вспышек. Придумай для каждого сейфа свою комбинацию.',
        h('div', { class: 'tt' }, 'У каждого сейфа ', h('b', { text: 'свой сигнал' }), ', одинаковых быть не должно.')));
    redraw();

    function missions() {
      sender({
        n: n, outcomes: X.SAFES, book: book, targets: G.run.safeTargets, reaction: 'chips',
        chef: 'Договорённость готова. Теперь открывай сейфы: найди сигнал справа и отправь его.',
        goal: h('div', { class: 'tt' }, 'Открой нужный ', h('b', { text: 'сейф' }), ' сигналом.'),
        bookNode: bookPanel('Ваша договорённость', X.SAFES, book, 1),
        label: function (idx) { return h('div', null, 'Открой ', chipEl(X.SAFES[idx]), ' сейф'); },
        okText: function (idx) { return 'Напарник открыл ' + X.SAFES[idx].name + ' сейф.'; },
        onDone: predict
      });
    }
    function predict() {
      var patBox = h('div', { class: 'chips', style: 'max-width:420px;margin-top:10px' });
      X.patterns(3).forEach(function (p) { patBox.appendChild(h('span', { class: 'chip2 nodot' }, dots(p))); });
      var q = h('div', { class: 'q', text: 'Вы справились с ' + X.flashWord(n) + '. А сколько разных сигналов дадут 3 вспышки?' });
      var o = opts([6, 8, 9, 12], function (v) {
        var r = X.diagnoseCount(v, 3);
        if (r.ok) { sfx.ok(); say(r.text, 'good'); reward('Каждая вспышка удваивает!', '1 вспышка: 2 сигнала. 2: 4. 3: 8. Вот они все:', patBox); return true; }
        sfx.bad(); say(r.text, 'bad'); return false;
      });
      page(safeBox([h('div', { class: 'trip', text: 'Проверка' }), q, o]),
        sideBox('Смотри, что получилось: с одной вспышкой 2 сигнала, с двумя 4. Угадай, что будет дальше.', null));
      UI.side.appendChild(h('div', { class: 'actions' }, nextButton()));
    }
  }

  /* ========== сейф 3: перехват (читаем вспышки) ========== */
  function lvIntercept() {
    var book = [[0, 0], [0, 1], [1, 0], [1, 1]], rounds = G.run.rounds, t = 0, busy = false, solved = false;
    var beam = h('div', { class: 'beam watch', text: 'тихо' }), seen = h('div', { class: 'sendrows', style: 'min-height:34px' });
    var msg = h('div', { class: 'msg msgb', 'aria-live': 'polite' }), trip = h('div', { class: 'trip' }), chipEls = [];
    var chips = h('div', { class: 'chips' });
    X.SAFES.forEach(function (s, i) {
      var c = h('button', { type: 'button', class: 'chip2', style: '--c:' + s.color + ';cursor:pointer', text: s.name, disabled: true, onclick: function () { answer(i); } });
      chipEls.push(c); chips.appendChild(c);
    });
    var again = h('button', { type: 'button', class: 'btn small ghost', text: 'Смотреть ещё раз', disabled: true, onclick: function () { sfx.click(); play(); } });
    function setChips(on) { chipEls.forEach(function (c) { c.disabled = !on; }); again.disabled = !on; }
    function play() {
      if (busy) return; ctxAudio(); busy = true; setChips(false); clear(seen); msg.textContent = ''; msg.className = 'msg msgb';
      var seq = book[rounds[t]];
      seq.forEach(function (b, i) {
        later(function () { beam.className = 'beam watch' + (b ? ' on' : ''); beam.textContent = 'вспышка ' + (i + 1); if (b) sfx.flash(); }, i * 900);
      });
      later(function () {
        beam.className = 'beam watch'; beam.textContent = 'тихо';
        clear(seen); seen.appendChild(h('div', null, h('span', { class: 'trip', style: 'white-space:nowrap', text: 'Ты увидел:' }), dots(seq, true)));
        busy = false; setChips(true);
      }, seq.length * 900 + 300);
    }
    function showRound() { trip.textContent = 'Перехват ' + (t + 1) + ' из ' + rounds.length; clear(seen); msg.textContent = ''; chipEls.forEach(function (c) { c.classList.remove('hit', 'bad'); }); later(play, 700); }
    function answer(i) {
      if (busy || solved) return; ctxAudio();
      if (i === rounds[t]) {
        sfx.ok(); flash(true); chipEls[i].classList.add('hit'); msg.className = 'msg msgb good'; msg.textContent = 'Верно! Охранник открывал ' + X.SAFES[i].name + ' сейф.'; setChips(false); t++;
        if (t >= rounds.length) { solved = true; later(function () { reward('Перехват удался!', 'Ты прочитал сигналы охраны так же, как это делает напарник.'); }, 1000); }
        else later(showRound, 1500);
      } else {
        sfx.bad(); chipEls[i].classList.add('bad'); msg.className = 'msg msgb bad'; msg.textContent = 'Нет, сигнал был другой. Сравни вспышки, которые ты увидел, с договорённостью справа.';
        later(function () { chipEls[i].classList.remove('bad'); }, 600);
      }
    }
    page(safeBox([trip, h('div', { class: 'mission', text: 'Охранник мигает фонарём. Какой сейф он собирается открыть?' }),
      h('div', { class: 'room', style: 'width:min(100%,360px)' }, h('h4', { text: 'Окно охраны' }), beam), seen, chips, msg, h('div', { class: 'actions' }, again)]),
      sideBox('Теперь наоборот: сигнал приходит к тебе. Смотри на вспышки и сверяй с договорённостью справа.', h('div', { class: 'tt' }, 'Прочитай сигнал и выбери ', h('b', { text: 'сейф' }), '.')));
    UI.side.appendChild(bookPanel('Договорённость охраны', X.SAFES, book, 1));
    UI.side.appendChild(h('div', { class: 'actions' }, nextButton()));
    showRound();
  }

  /* ========== сейф 4: алфавит ========== */
  function lvLetters() {
    var q = h('div', { class: 'q', text: 'В алфавите 26 букв, и у каждой должен быть свой сигнал. Сколько вспышек нужно на одну букву?' });
    var o = opts([3, 4, 5, 6], function (v) {
      var r = X.diagnoseSlots(v, 26);
      if (r.ok) { sfx.ok(); flash(true); say(r.text, 'good'); later(table, 1500); return true; }
      sfx.bad(); say(r.text, 'bad'); return false;
    });
    page(safeBox([h('div', { class: 'trip', text: 'Алфавит' }), q, o]),
      sideBox('Теперь передаём буквы, то есть целые слова. Сколько вспышек в одном сигнале, решай ты. Но их должно хватить на все буквы.',
        h('div', { class: 'tt' }, 'Выбери ', h('b', { text: 'длину сигнала' }), ' для одной буквы.')));
    UI.side.appendChild(h('div', { class: 'actions' }, nextButton()));

    function table() {
      var g = h('div', { class: 'book c2', style: 'gap:6px 26px;max-width:600px' });
      X.LETTERS.forEach(function (ch, i) { g.appendChild(h('div', { class: 'bk' }, h('span', { class: 'l', text: ch }), dots(X.LETTER_BOOK[i]))); });
      var go = h('button', { type: 'button', class: 'btn primary', text: 'К заданию', onclick: function () { sfx.click(); words(); } });
      page(safeBox([h('div', { class: 'trip', text: 'Таблица букв' }), h('div', { class: 'scroll', style: 'max-height:52vh;width:100%;display:flex;justify-content:center' }, g), h('div', { class: 'actions' }, go)]),
        sideBox('Договорились так: буквы идут по порядку. Сигналы друг за другом, как счёт вспышками. Первая буква А это самый простой сигнал.', null));
    }
    function words() {
      var w = G.run.word, targets = w[0].split('').map(function (c) { return X.LETTERS.indexOf(c); });
      var outcomes = X.LETTERS.map(function (c) { return { name: c }; });
      sender({
        n: X.LETTER_SLOTS, outcomes: outcomes, book: X.LETTER_BOOK, targets: targets, reaction: 'word', word: w[0],
        chef: 'Передай слово по буквам. Для каждой буквы найди сигнал в таблице справа.',
        goal: h('div', { class: 'tt' }, 'Передай слово ', h('b', { text: w[0] }), ' («' + w[1] + '»).'),
        bookNode: bookPanel('Таблица букв', outcomes, X.LETTER_BOOK, 2, true),
        label: function (idx) { return h('div', null, 'Передай букву ', h('b', { text: X.LETTERS[idx] })); },
        okText: function (idx) { return 'Напарник принял букву ' + X.LETTERS[idx] + '.'; },
        onDone: function () { reward('Слово передано!', w[0] + ' значит «' + w[1] + '». Напарник прочитал его по вашей таблице.'); }
      });
    }
  }

  /* ========== сейф 5: числовой замок ========== */
  function lvNumber() {
    var n = 4, ws = X.weights(n), bits = zeros(n), t = 0, locked = false, targets = G.run.nums;
    var lines = ['Это кодовый замок, ему нужно число. У каждой лампочки свой вес, он подписан. Включай лампочки так, чтобы вместе вышло нужное число.',
      'Заметил? Для каждого числа способ только один. И каждая лампочка вдвое больше соседней, как и в таблице букв сигналы шли по счёту.',
      'Последнее число. Начни с самой большой лампочки, которая помещается.'];
    var lampEls = ws.map(function (w, i) {
      return lamp({ label: w, aria: 'Лампочка с весом ' + w, onToggle: function () {
        if (locked) return; ctxAudio();
        bits[i] = bits[i] ? 0 : 1; setLamp(lampEls[i], bits[i]); if (bits[i]) sfx.on(i); else sfx.off();
        lampEls[i].classList.remove('hintglow'); update();
      } });
    });
    var cur = h('div', { class: 'v', text: '0' }), need = h('div', { class: 'v', text: String(targets[0]) }), sumEl = h('div', { class: 'sumline' }), trip = h('div', { class: 'trip' });
    var screen = h('div', { class: 'screen' }, h('div', null, h('div', { class: 'k', text: 'Набрано' }), cur), h('div', null, h('div', { class: 'k', text: 'Нужно' }), need));
    function showTrip() { trip.textContent = 'Число ' + (t + 1) + ' из ' + targets.length; need.textContent = String(targets[t]); }
    page(safeBox([trip, screen, h('div', { class: 'lamps' }, lampEls), sumEl]),
      sideBox(lines[0], h('div', { class: 'tt' }, 'Набери ', h('b', { text: 'число' }), ' лампочками.')));
    UI.side.appendChild(h('div', { class: 'actions' }, nextButton(), hintButton(function () {
      X.litWeights(targets[t], n).forEach(function (w) { lampEls[ws.indexOf(w)].classList.add('hintglow'); });
      say('Подсвеченные лампочки нужно включить.', '');
    })));
    showTrip();
    function update() {
      var v = X.valueOf(bits); cur.textContent = String(v);
      sumEl.textContent = v ? X.litWeights(v, n).join(' + ') + ' = ' + v : '';
      cur.className = 'v' + (v > targets[t] ? ' over' : '');
      if (v === targets[t]) {
        locked = true; cur.className = 'v ok'; sfx.ok(); flash(true);
        later(function () {
          t++;
          if (t >= targets.length) { reward('Замок открыт!', 'Числа тоже можно записать вспышками: каждая лампочка вдвое больше соседней.'); return; }
          bits = zeros(n); lampEls.forEach(function (b) { setLamp(b, 0); b.classList.remove('hintglow'); });
          cur.textContent = '0'; cur.className = 'v'; sumEl.textContent = ''; locked = false; showTrip(); say(lines[t], '');
        }, 900);
      }
    }
  }

  /* ========== сейф 6: картинка из чисел ========== */
  function lvPicture() {
    var pic = G.run.pic, rowsNeed = pic.rows, n = 5, ws = X.weights(n), grid = rowsNeed.map(function () { return zeros(n); }), finished = false;
    var preview = picGrid(zeros(rowsNeed.length), false), rowsBox = h('div', { class: 'rows' });
    var rowEls = rowsNeed.map(function (need, r) {
      var lampEls = ws.map(function (w, c) {
        return lamp({ small: true, label: w, aria: 'Ряд ' + (r + 1) + ', вес ' + w, onToggle: function () {
          if (finished) return; ctxAudio();
          grid[r][c] = grid[r][c] ? 0 : 1; setLamp(lampEls[c], grid[r][c]); if (grid[r][c]) sfx.on(c); else sfx.off();
          lampEls[c].classList.remove('hintglow'); update();
        } });
      });
      var curEl = h('div', { class: 'cur', text: '0' });
      return { row: h('div', { class: 'row' }, h('div', { class: 'need', text: String(need) }), h('div', { class: 'lamps' }, lampEls), curEl), lampEls: lampEls, curEl: curEl };
    });
    rowEls.forEach(function (o) { rowsBox.appendChild(o.row); });
    page(safeBox([h('div', { class: 'trip', text: 'Картинка от шефа' }), h('div', { class: 'parcel' }, rowsBox, preview)]),
      sideBox('Это сейф-картинка. Слева числа, по одному на ряд. Набери каждое число лампочками, и справа появится рисунок. Лампочка горит: клетка закрашена.',
        h('div', { class: 'tt' }, 'В каждом ряду набери ', h('b', { text: 'число слева' }), '.')));
    UI.side.appendChild(h('div', { class: 'actions' }, nextButton(), hintButton(function () {
      for (var r = 0; r < rowsNeed.length; r++) {
        if (X.valueOf(grid[r]) !== rowsNeed[r]) { X.litWeights(rowsNeed[r], n).forEach(function (w) { rowEls[r].lampEls[ws.indexOf(w)].classList.add('hintglow'); }); break; }
      }
      say('Подсвечены лампочки в первом неверном ряду.', '');
    })));
    function update() {
      var all = true;
      rowEls.forEach(function (o, r) {
        var v = X.valueOf(grid[r]); o.curEl.textContent = String(v);
        var ok = v === rowsNeed[r]; o.row.className = 'row' + (ok ? ' done' : ''); if (!ok) all = false;
      });
      preview.update(grid.map(function (g) { return X.valueOf(g); }));
      if (all && !finished) { finished = true; sfx.win(); reward('Картинка собрана!', 'Это «' + pic.name + '». Ряды лампочек превратились в числа, а числа в рисунок.', picGrid(pic.rows, true)); }
    }
  }

  /* ========== главная дверь: слово BINARY ========== */
  function lvFinal() {
    G.cur = -1;
    var w = X.FINAL_WORD, targets = w.split('').map(function (c) { return X.LETTERS.indexOf(c); });
    var outcomes = X.LETTERS.map(function (c) { return { name: c }; });
    sender({
      n: X.LETTER_SLOTS, outcomes: outcomes, book: X.LETTER_BOOK, targets: targets, reaction: 'word', word: w,
      chef: 'Главная дверь. Все шесть букв собраны, осталось передать слово напарнику, по таблице букв. Это последнее задание.',
      goal: h('div', { class: 'tt' }, 'Передай слово ', h('b', { text: w }), ' по буквам.'),
      bookNode: bookPanel('Таблица букв', outcomes, X.LETTER_BOOK, 2, true),
      label: function (idx) { return h('div', null, 'Передай букву ', h('b', { text: X.LETTERS[idx] })); },
      okText: function (idx) { return 'Напарник принял букву ' + X.LETTERS[idx] + '.'; },
      onDone: showVictory
    });
  }

  /* ========== терминал: секретка для двоих ========== */
  function lvSecret() {
    G.cur = -1;
    var area = h('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:12px;width:100%' });
    var outcomes = X.LETTERS.map(function (c) { return { name: c }; });
    page(safeBox([h('div', { class: 'trip', text: 'Терминал: секретка для двоих' }), area]),
      sideBox('Это игра для двоих за одним компьютером. Игрок 1 придумывает слово, потом компьютер передают игроку 2. Он видит только вспышки и расшифровывает по таблице.', null));
    UI.side.appendChild(bookPanel('Таблица букв', outcomes, X.LETTER_BOOK, 2, true));
    UI.side.appendChild(h('div', { class: 'actions' }, nextButton('Вернуться в комнату', true)));
    stageA();
    function stageA() {
      clear(area);
      var input = h('input', { class: 'nin', maxlength: 12, placeholder: 'Секретное слово', 'aria-label': 'Секретное слово', autocomplete: 'off' });
      function go() { var w = X.toLatin(input.value, 6); if (!w) return; ctxAudio(); sfx.click(); handoff(w); }
      area.appendChild(h('div', { class: 'mission', text: 'Игрок 1: напиши слово (до 6 букв). Игрок 2 пока отвернись.' }));
      area.appendChild(input);
      area.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn go', text: 'Спрятать слово', onclick: go })));
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    }
    function handoff(word) {
      clear(area);
      area.appendChild(h('div', { class: 'q', text: 'Слово спрятано. Игрок 1, отвернись и передай компьютер игроку 2.' }));
      area.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', text: 'Я игрок 2, готов', onclick: function () { sfx.click(); stageB(word); } })));
    }
    function stageB(word) {
      clear(area);
      area.appendChild(h('div', { class: 'mission', text: 'Игрок 2: прочитай вспышки и угадай слово' }));
      var rows = h('div', { class: 'sendrows' });
      word.split('').forEach(function (ch, i) { rows.appendChild(h('div', null, h('b', { text: String(i + 1) }), dots(X.letterBits(ch), true))); });
      area.appendChild(rows);
      var guess = h('input', { class: 'nin', maxlength: 8, placeholder: 'Что за слово?', 'aria-label': 'Догадка', autocomplete: 'off' });
      var msg = h('div', { class: 'msg msgb' });
      function go() {
        if (X.toLatin(guess.value, 6) === word) { msg.className = 'msg msgb good'; msg.textContent = 'Верно! Слово: ' + word + '. Теперь поменяйтесь.'; sfx.win(); flash(true); }
        else { msg.className = 'msg msgb bad'; msg.textContent = 'Нет, попробуй ещё. Сверяй каждый ряд с таблицей.'; sfx.bad(); }
      }
      guess.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      area.appendChild(guess); area.appendChild(msg);
      area.appendChild(h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn go', text: 'Проверить', onclick: go }),
        h('button', { type: 'button', class: 'btn small ghost', text: 'Сдаюсь, покажи', onclick: function () { msg.className = 'msg msgb'; msg.textContent = 'Слово: ' + word; } }),
        h('button', { type: 'button', class: 'btn small', text: 'Новое слово', onclick: function () { sfx.click(); stageA(); } })));
    }
  }

  var LEVELS = [lvSignal, lvFour, lvIntercept, lvLetters, lvNumber, lvPicture];
  var NAMES = ['Один сигнал', 'Четыре цвета', 'Перехват', 'Алфавит', 'Числовой замок', 'Картинка'];

  /* ========== комната ========== */
  var SAFES = [{ x: 170, y: 215 }, { x: 340, y: 215 }, { x: 660, y: 215 }, { x: 830, y: 215 }, { x: 330, y: 475 }, { x: 690, y: 475 }];
  var DOOR = { x: 500, y: 86 }, DESK = { x: 130, y: 480 };
  var SOLID = SAFES.map(function (p) { return [p.x - 52, p.y - 62, p.x + 52, p.y + 62]; }).concat([[55, 440, 205, 520]]);
  var KEYS = {};

  function showRoom() {
    cleanup(); renderHud(G.lastLoot); G.lastLoot = -1; clear(app);
    var first = X.nextSafe(G.done, TOTAL), objs = [];
    var floor = h('div', { class: 'floor' }), wrap = h('div', { class: 'roomwrap' }, floor), stage = h('div', { class: 'roomstage' }, wrap);
    floor.appendChild(h('div', { class: 'tiles' })); floor.appendChild(h('div', { class: 'wall' })); floor.appendChild(h('div', { class: 'rug' }));
    [[45, 190], [955, 190], [955, 565], [45, 565]].forEach(function (p) { floor.appendChild(h('div', { class: 'plant', style: 'left:' + p[0] + 'px;top:' + p[1] + 'px' })); });

    SAFES.forEach(function (p, i) {
      var cls = G.done[i] ? ' done' : i === first ? ' next' : ' later';
      var el = h('div', { class: 'obj sf' + cls, style: 'left:' + p.x + 'px;top:' + p.y + 'px', 'data-i': String(i), role: 'button', 'aria-label': 'Сейф ' + (i + 1) + ': ' + NAMES[i] },
        h('span', { class: 'nm', text: '№' + (i + 1) }), h('span', { class: 'dl' }), h('span', { class: 'ld' }, h('i'), h('i'), h('i')), h('span', { class: 'lootl', text: LOOT[i] }));
      floor.appendChild(el); objs.push({ k: 'safe', i: i, x: p.x, y: p.y, fx: p.x, fy: p.y + 90, el: el });
    });
    var allDone = first >= TOTAL;
    var slots = h('div', { class: 'slots2' }, LOOT.map(function (ch, i) { return h('b', { text: G.done[i] ? ch : '' }); }));
    var door = h('div', { class: 'obj bigdoor' + (allDone ? ' ready' : ''), style: 'left:' + DOOR.x + 'px;top:' + DOOR.y + 'px', role: 'button', 'aria-label': 'Главная дверь' }, h('span', { class: 'nm', text: 'ГЛАВНАЯ ДВЕРЬ' }), slots);
    floor.appendChild(door); objs.push({ k: 'door', x: DOOR.x, y: DOOR.y, fx: DOOR.x, fy: 175, el: door });
    var termOn = !!G.done[3];
    var desk = h('div', { class: 'obj desk' + (termOn ? '' : ' off'), style: 'left:' + DESK.x + 'px;top:' + DESK.y + 'px', role: 'button', 'aria-label': 'Терминал' });
    floor.appendChild(desk); objs.push({ k: 'term', x: DESK.x, y: DESK.y, fx: DESK.x, fy: 556, el: desk });
    var hero = h('div', { class: 'hero', 'aria-hidden': 'true' }, h('div', { class: 'shadow' }), h('div', { class: 'body' }), h('div', { class: 'head' }));
    floor.appendChild(hero); floor.appendChild(h('div', { class: 'vig' }));
    var prompt = h('div', { class: 'rprompt', hidden: true });
    stage.appendChild(prompt);
    app.appendChild(stage);

    R = { floor: floor, wrap: wrap, stage: stage, hero: hero, prompt: prompt, objs: objs, target: null, goal: null, near: null, busy: false, toast: null };
    if (!G.introSeen && !G.done.some(Boolean)) {
      var intro = h('div', { class: 'chef rintro' }, h('div', { class: 'face' }), h('div', null, h('span', { class: 'tag', text: 'ШЕФ' }),
        h('div', { class: 'say', text: 'Агент, в хранилище шесть сейфов, в каждом буква. Вместе они дадут слово для главной двери. Иди к светящемуся сейфу: стрелки или WASD, либо кликни по полу. У сейфа нажми Пробел.' })));
      stage.appendChild(intro); R.intro = intro; G.introSeen = true;
      later(function () { if (intro.parentNode) intro.parentNode.removeChild(intro); }, 14000);
    }
    objs.forEach(function (o) { o.el.addEventListener('click', function (e) { e.stopPropagation(); clickObj(o); }); });
    floor.addEventListener('click', function (e) {
      var rc = floor.getBoundingClientRect(), s = rc.width / 1000;
      var x = Math.max(28, Math.min(972, (e.clientX - rc.left) / s)), y = Math.max(165, Math.min(595, (e.clientY - rc.top) / s));
      if (blocked(x, y)) return;
      R.target = { x: x, y: y }; R.goal = null; ctxAudio();
    });
    function fit() { if (!R) return; var s = Math.max(.3, Math.min(stage.clientWidth / 1000, stage.clientHeight / 620)); floor.style.transform = 'scale(' + s + ')'; wrap.style.width = (1000 * s) + 'px'; wrap.style.height = (620 * s) + 'px'; }
    R.fit = fit; later(fit, 0); fit();
    placeHero(); var last = Date.now();
    loop = setInterval(function () { var now = Date.now(), dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now; tick(dt); }, 16);
  }

  function blocked(x, y) {
    if (x < 28 || x > 972 || y < 165 || y > 595) return true;
    for (var i = 0; i < SOLID.length; i++) { var r = SOLID[i]; if (x > r[0] - 12 && x < r[2] + 12 && y > r[1] - 8 && y < r[3] + 14) return true; }
    return false;
  }
  function step(dx, dy, dt) {
    var H = G.hero, sp = 270 * dt, nx = H.x + dx * sp, ny = H.y + dy * sp, moved = false;
    if (!blocked(nx, ny)) { H.x = nx; H.y = ny; moved = true; }
    else if (dx && !blocked(nx, H.y)) { H.x = nx; moved = true; }
    else if (dy && !blocked(H.x, ny)) { H.y = ny; moved = true; }
    if (moved && Math.abs(dx) > 0.2) R.left = dx < 0;
    return moved;
  }
  function placeHero(walking) {
    R.hero.style.left = G.hero.x + 'px'; R.hero.style.top = G.hero.y + 'px';
    R.hero.className = 'hero' + (walking ? ' walk' : '') + (R.left ? ' left' : '');
  }
  function tick(dt) {
    if (!R || R.busy) return;
    var dx = 0, dy = 0, moving = false;
    if (KEYS.ArrowLeft || KEYS.KeyA) dx -= 1; if (KEYS.ArrowRight || KEYS.KeyD) dx += 1;
    if (KEYS.ArrowUp || KEYS.KeyW) dy -= 1; if (KEYS.ArrowDown || KEYS.KeyS) dy += 1;
    if (dx || dy) {
      R.target = null; R.goal = null; var l = Math.hypot(dx, dy); moving = step(dx / l, dy / l, dt);
      if (R.intro && R.intro.parentNode) R.intro.parentNode.removeChild(R.intro);
    } else if (R.target) {
      var vx = R.target.x - G.hero.x, vy = R.target.y - G.hero.y, d = Math.hypot(vx, vy);
      if (d < 7) { var g = R.goal; R.target = null; R.goal = null; if (g) enter(g); }
      else {
        moving = step(vx / d, vy / d, dt);
        if (!moving) { var g2 = R.goal; R.target = null; R.goal = null; if (g2 && dist(g2) < 125) enter(g2); }
      }
    }
    if (!R) return;
    placeHero(moving); updateNear();
  }
  function dist(o) { return Math.hypot(o.x - G.hero.x, o.y - G.hero.y); }
  function objText(o) {
    var first = X.nextSafe(G.done, TOTAL);
    if (o.k === 'safe') return G.done[o.i] ? 'Сейф №' + (o.i + 1) + ' открыт' : o.i === first ? 'Пробел или E: открыть сейф №' + (o.i + 1) + ' «' + NAMES[o.i] + '»' : 'Сначала открой сейф №' + (first + 1);
    if (o.k === 'door') return first >= TOTAL ? 'Пробел или E: передать слово главной двери' : 'Дверь откроется, когда будут все 6 букв';
    return G.done[3] ? 'Пробел или E: терминал (игра для двоих)' : 'Терминал включится после сейфа №4';
  }
  function updateNear() {
    var best = null, bd = 118;
    R.objs.forEach(function (o) { var d = dist(o); if (d < bd) { bd = d; best = o; } });
    if (best !== R.near) {
      if (R.near) R.near.el.classList.remove('near');
      R.near = best;
      if (best) best.el.classList.add('near');
      R.prompt.hidden = !best; if (best) R.prompt.textContent = objText(best);
    }
  }
  function toast(text) {
    if (!R) return;
    if (R.toast && R.toast.parentNode) R.toast.parentNode.removeChild(R.toast);
    R.toast = h('div', { class: 'rtoast', role: 'status', text: text }); R.stage.appendChild(R.toast);
    var t = R.toast; later(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
  }
  function clickObj(o) {
    if (!R || R.busy) return; ctxAudio();
    if (dist(o) < 118) { enter(o); return; }
    R.target = { x: o.fx, y: o.fy }; R.goal = o;
  }
  function enter(o) {
    if (!R || R.busy) return;
    var first = X.nextSafe(G.done, TOTAL);
    if (o.k === 'safe') {
      if (G.done[o.i]) { toast('Этот сейф уже открыт. Буква «' + LOOT[o.i] + '» у тебя.'); sfx.click(); return; }
      if (o.i !== first) { toast('Сначала открой сейф №' + (first + 1) + '.'); sfx.bad(); return; }
      zoomTo(o, function () { G.cur = o.i; LEVELS[o.i](); });
    } else if (o.k === 'door') {
      if (first < TOTAL) { toast('Дверь откроется, когда соберёшь все 6 букв. Сейчас: ' + G.done.filter(Boolean).length + ' из 6.'); sfx.bad(); return; }
      zoomTo(o, lvFinal);
    } else {
      if (!G.done[3]) { toast('Терминал включится после сейфа №4.'); sfx.bad(); return; }
      zoomTo(o, lvSecret);
    }
  }
  function zoomTo(o, cb) {
    R.busy = true; R.prompt.hidden = true; sfx.zoom();
    R.wrap.style.transformOrigin = (o.x / 10) + '% ' + (o.y / 6.2) + '%';
    R.wrap.classList.add('zoom');
    later(function () { cleanup(); cb(); }, 700);
  }
  window.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (!R) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
    if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') { if (R.near) { ctxAudio(); enter(R.near); } return; }
    KEYS[e.code] = true;
  });
  window.addEventListener('keyup', function (e) { KEYS[e.code] = false; });
  window.addEventListener('blur', function () { KEYS = {}; });
  window.addEventListener('resize', function () { if (R && R.fit) R.fit(); });

  /* ========== экраны ========== */
  function showTitle() {
    cleanup(); renderHud(); clear(app);
    var cont = G.started && G.done.some(Boolean) && !G.finished;
    var btns = h('div', { class: 'btns' });
    btns.appendChild(h('button', { type: 'button', class: 'btn primary', text: cont ? 'Продолжить' : 'Войти в хранилище', onclick: function () {
      ctxAudio(); sfx.unlock(); if (!G.run) G.run = X.makeRun5(Math.random);
      if (!cont) { G.done = []; G.hero = { x: 500, y: 430 }; G.finished = false; }
      G.started = true; save(); showRoom();
    } }));
    if (cont) btns.appendChild(h('button', { type: 'button', class: 'btn', text: 'Начать заново', onclick: function () { ctxAudio(); G.run = X.makeRun5(Math.random); G.done = []; G.hero = { x: 500, y: 430 }; G.finished = false; G.started = true; G.introSeen = false; save(); showRoom(); } }));
    app.appendChild(h('div', { class: 'title' },
      h('div', null,
        h('h1', null, 'Секретный ', h('span', { text: 'канал' })),
        h('p', { class: 'lead' }, 'В хранилище шесть сейфов, и в каждом буква. Вместе они дают слово для главной двери. А общаться с напарником можно только ', h('b', { text: 'вспышками фонарика' }), '.'),
        btns,
        h('p', { class: 'small', text: 'Ходить: стрелки или WASD, либо клик по полу. Открыть: Пробел.' })),
      h('div', { class: 'vault', 'aria-hidden': 'true' }, h('div', { class: 'ring' }), h('div', { class: 'core' }))));
  }

  function showVictory() {
    cleanup(); G.finished = true; G.started = true; save(); renderHud(); clear(app); sfx.win();
    var rows = h('div', { class: 'sendrows' });
    X.FINAL_WORD.split('').forEach(function (ch) {
      var b = X.letterBits(ch);
      rows.appendChild(h('div', null, h('b', { text: ch }), dots(b, true), h('span', { class: 'led', style: 'color:var(--cyan);font-size:22px;letter-spacing:.2em', text: b.join('') })));
    });
    app.appendChild(h('div', { class: 'finish' },
      h('h1', { text: 'Дверь открыта!' }),
      h('div', { class: 'letters' }, LOOT.map(function (c) { return h('b', { text: c }); })),
      h('div', { class: 'big', text: 'BINARY по-английски «двоичный». Ты передал его только вспышками.' }),
      rows,
      h('ul', null,
        h('li', null, h('b', { text: 'Вспышка это 1, темнота это 0. ' }), 'Из двух сигналов вы собрали сейфы, буквы, числа и картинку. Это двоичный код.'),
        h('li', null, h('b', { text: 'n вспышек дают 2 в степени n сигналов. ' }), 'Поэтому для 26 букв хватило 5 вспышек, а для картинки хватило чисел от 0 до 31.'),
        h('li', null, h('b', { text: 'Так работает компьютер. ' }), 'У него вместо фонарика крошечные переключатели, их миллиарды. Фото, музыка, видео в твоём телефоне это длинные ряды нулей и единиц.')),
      h('div', { class: 'actions', style: 'justify-content:center' },
        h('button', { type: 'button', class: 'btn primary', text: 'В комнату', onclick: showRoom }),
        h('button', { type: 'button', class: 'btn', text: 'В меню', onclick: showTitle }))));
  }

  document.getElementById('brand').addEventListener('click', showTitle);
  document.getElementById('snd').addEventListener('click', function (e) {
    sound = !sound; e.currentTarget.setAttribute('aria-pressed', String(sound)); e.currentTarget.textContent = sound ? 'Звук включён' : 'Звук выключен'; if (sound) sfx.click();
  });
  showTitle();
})();
