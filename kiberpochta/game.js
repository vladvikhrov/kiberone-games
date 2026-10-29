/* ========================================================================
   Киберпочта — логика игры. Тексты лежат в data.js.
   Прогресс хранится в sessionStorage: переживает F5, пропадает при закрытии вкладки.
   ======================================================================== */
(function () {
  'use strict';

  var D = window.KP_DATA;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var screen = $('#screen');

  var SHIFTS = [
    { id: 'mail', name: 'Сортировка писем', count: D.mail.length, max: D.mail.length * 3 },
    { id: 'pass', name: 'Пароли', count: D.passwords.length, max: D.passwords.length * 2 },
    { id: 'share', name: 'Что можно выкладывать', count: D.share.length, max: D.share.length },
    { id: 'dict', name: 'Словарь', count: D.dict.length, max: D.dict.length }
  ];

  /* ---------- состояние ---------- */
  var KEY = 'kiberpochta_v1';
  function fresh() {
    return {
      name: '', screen: 'start', anatomyDone: false,
      mail: { i: 0, stars: [] }, pass: { i: 0, stars: [] }, share: { i: 0, stars: [] },
      dict: { stars: null }, memo: [], muted: false
    };
  }
  var S = fresh();
  try { var raw = sessionStorage.getItem(KEY); if (raw) S = Object.assign(fresh(), JSON.parse(raw)); } catch (e) {}
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  function sum(a) { return a.reduce(function (s, x) { return s + x; }, 0); }
  function shiftStars(id) { return id === 'dict' ? (S.dict.stars || 0) : sum(S[id].stars); }
  function shiftDone(id) {
    if (id === 'dict') return S.dict.stars !== null;
    return S[id].stars.length >= SHIFTS.find(function (s) { return s.id === id; }).count;
  }
  function totalStars() { return SHIFTS.reduce(function (s, x) { return s + shiftStars(x.id); }, 0); }
  function totalMax() { return SHIFTS.reduce(function (s, x) { return s + x.max; }, 0); }

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function starsHtml(n, max) {
    var s = '';
    for (var i = 0; i < max; i++) s += i < n ? '★' : '<span class="off">★</span>';
    return '<span class="stars" aria-label="' + n + ' из ' + max + '">' + s + '</span>';
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ---------- звук: синтез через WebAudio, без файлов ---------- */
  var AC = null;
  function ctx() {
    if (S.muted) return null;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === 'suspended') AC.resume();
      return AC;
    } catch (e) { return null; }
  }
  function tone(f, d, type, v, t0) {
    var a = ctx(); if (!a) return;
    var t = a.currentTime + (t0 || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + d + 0.02);
  }
  function noise(d, freq, v) {
    var a = ctx(); if (!a) return;
    var len = Math.floor(a.sampleRate * d), buf = a.createBuffer(1, len, a.sampleRate), ch = buf.getChannelData(0);
    for (var i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    var src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = v;
    src.connect(f); f.connect(g); g.connect(a.destination); src.start();
  }
  var sfx = {
    stamp: function () { noise(0.16, 700, 0.6); tone(70, 0.16, 'sine', 0.3); },
    ok: function () { tone(660, 0.14, 'triangle', 0.07); tone(990, 0.2, 'triangle', 0.07, 0.1); },
    bad: function () { tone(150, 0.25, 'square', 0.035); },
    mark: function () { tone(1046, 0.09, 'sine', 0.06); },
    tick: function () { tone(1400, 0.03, 'square', 0.015); },
    slide: function () { noise(0.22, 2600, 0.07); }
  };
  $('#snd').addEventListener('click', function () {
    S.muted = !S.muted; save(); paintSound();
    if (!S.muted) sfx.tick();
  });
  function paintSound() {
    var b = $('#snd');
    b.textContent = S.muted ? 'Звук выключен' : 'Звук включён';
    b.setAttribute('aria-pressed', String(!S.muted));
  }

  /* ---------- общий каркас ---------- */
  function paintBar() {
    var h = '';
    SHIFTS.forEach(function (sh, k) {
      var cls = 'shift' + (S.screen === sh.id ? ' cur' : '') + (shiftDone(sh.id) ? ' done' : '');
      h += '<button type="button" class="' + cls + '" data-go="' + sh.id + '"><span class="n">' + (k + 1) + '</span>' + esc(sh.name) + '</button>';
    });
    $('#shifts').innerHTML = h;
    $('#who').textContent = S.name ? 'Оператор ' + S.name : '';
    $('#total').textContent = S.screen === 'start' ? '' : '★ ' + totalStars();
    $('#shifts').hidden = S.screen === 'start';
  }
  var freshMemo = -1;
  function paintMemo() {
    var h = '';
    if (!S.memo.length) h = '<li class="empty">Сюда попадут правила, которые ты узнаешь на смене.</li>';
    S.memo.forEach(function (m, k) { h += '<li' + (k === freshMemo ? ' class="fresh"' : '') + '>' + esc(m) + '</li>'; });
    $('#memoList').innerHTML = h;
    freshMemo = -1;
  }
  function addMemo(t) {
    if (!t || S.memo.indexOf(t) !== -1) return;
    S.memo.push(t); freshMemo = S.memo.length - 1; save(); paintMemo();
  }
  function go(id) {
    S.screen = id; save();
    document.querySelector('.layout').classList.toggle('solo', id === 'start');
    paintBar(); paintMemo();
    ({ start: renderStart, mail: renderMail, pass: renderPass, share: renderShare, dict: renderDict, final: renderFinal })[id]();
    window.scrollTo(0, 0);
  }
  $('#shifts').addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]'); if (b) go(b.dataset.go);
  });
  function nextAfter(id) {
    var k = SHIFTS.findIndex(function (s) { return s.id === id; });
    return k < SHIFTS.length - 1 ? SHIFTS[k + 1] : null;
  }
  function nextButton(id) {
    var n = nextAfter(id);
    return n ? '<button type="button" class="btn" data-go="' + n.id + '">Дальше: ' + esc(n.name.toLowerCase()) + '</button>'
             : '<button type="button" class="btn" data-go="final">Получить удостоверение</button>';
  }
  screen.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]'); if (b) go(b.dataset.go);
  });

  /* ---------- старт ---------- */
  function renderStart() {
    var has = totalStars() > 0 || S.anatomyDone;
    screen.innerHTML =
      '<section class="start">' +
        '<h1 class="title">Киберпочта</h1>' +
        '<p class="lead">Ты оператор киберпочты. Сюда приходят сообщения: одни настоящие, другие подбросили мошенники. Настоящие ты доставляешь, ловушки ловишь.</p>' +
        '<label for="nm">Как тебя зовут</label>' +
        '<input id="nm" maxlength="16" autocomplete="off" value="' + esc(S.name) + '">' +
        '<div class="actions">' +
          '<button type="button" class="btn" id="begin">' + (has ? 'Продолжить смену' : 'Начать смену') + '</button>' +
          (has ? '<button type="button" class="btn ghost" id="reset">Начать заново</button>' : '') +
        '</div>' +
        '<p class="hint">Звёзды дают за точность, а не за скорость. Не торопись.</p>' +
      '</section>';
    var nm = $('#nm');
    if (!S.name) nm.focus();
    nm.addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#begin').click(); });
    $('#begin').addEventListener('click', function () {
      var v = nm.value.trim();
      if (!v) { nm.focus(); nm.placeholder = 'Сначала напиши имя'; sfx.bad(); return; }
      S.name = v; save(); sfx.tick();
      var first = SHIFTS.find(function (s) { return !shiftDone(s.id); });
      go(first ? first.id : 'final');
    });
    var r = $('#reset');
    if (r) r.addEventListener('click', function () {
      var m = S.muted; S = fresh(); S.muted = m; save(); go('start');
    });
  }

  /* ---------- письмо: разметка ---------- */
  function norm(x) { return x == null ? null : (typeof x === 'string' ? { t: x } : x); }
  function partsOf(m) {
    var p = [];
    p.push({ k: 'from', cls: 'p-from', v: norm(m.from) });
    p.push({ k: 'addr', cls: 'p-addr', v: norm(m.addr) });
    if (m.subject) p.push({ k: 'subject', cls: 'p-subject', v: norm(m.subject) });
    (m.body || []).forEach(function (b, i) { p.push({ k: 'b' + i, cls: 'p-text', v: norm(b), body: true }); });
    if (m.link) p.push({ k: 'link', cls: 'p-link', v: norm(m.link), body: true });
    if (m.file) p.push({ k: 'file', cls: 'p-file', v: norm(m.file), body: true });
    return p;
  }
  function letterHtml(m, extraCls) {
    var parts = partsOf(m), head = '', body = '';
    parts.forEach(function (p) {
      var el = '<div class="part ' + p.cls + '" data-k="' + p.k + '"><span class="pt">' + esc(p.v.t) + '</span></div>';
      if (p.body) body += el; else head += el;
    });
    return '<article class="letter ' + (extraCls || '') + '" id="letter">' +
      '<span class="channel">' + esc(m.channel) + '</span>' + head +
      '<div class="letter-body">' + body + '</div></article>';
  }
  function stamp(kind) {
    var L = $('#letter'), desk = L.parentNode;
    var s = document.createElement('div');
    s.className = 'stamp ' + kind + ' hit';
    s.textContent = kind === 'trap' ? 'Ловушка' : 'Настоящее';
    L.appendChild(s);
    sfx.stamp();
    if (!reduce) { desk.classList.remove('thump'); void desk.offsetWidth; desk.classList.add('thump'); }
  }

  /* ---------- смена 1: знакомство с письмом ---------- */
  var ANAT_NAMES = { from: 'Отправитель', addr: 'Адрес', subject: 'Тема', b0: 'Текст', link: 'Ссылка', file: 'Вложение' };
  function renderAnatomy() {
    var A = D.anatomy, seen = {};
    var m = { channel: A.channel, from: A.from, addr: A.addr, subject: A.subject, body: A.body, link: A.link, file: A.file };
    var need = Object.keys(ANAT_NAMES).length;
    screen.innerHTML =
      '<div class="head"><h2>Из чего состоит письмо</h2><p>Изучено <b id="anCnt">0</b> из ' + need + '</p></div>' +
      '<p class="task">Нажми на каждую часть письма и прочитай, что это.</p>' +
      '<div class="anat"><div class="desk">' + letterHtml(m, 'enter') + '</div>' +
      '<div class="anat-note" id="anNote">Начни с имени отправителя наверху.</div></div>' +
      '<div class="actions"><button type="button" class="btn" id="anGo" disabled>К письмам</button>' +
      '<button type="button" class="btn ghost" id="anSkip">Пропустить</button></div>';
    $$('.letter .part').forEach(function (p) { p.tabIndex = 0; p.setAttribute('role', 'button'); });
    function pick(p) {
      var k = p.dataset.k;
      seen[k] = 1; p.classList.add('seen'); sfx.mark();
      $('#anNote').innerHTML = '<b>' + ANAT_NAMES[k] + '</b>' + esc(A.notes[k === 'b0' ? 'body' : k]);
      var n = Object.keys(seen).length;
      $('#anCnt').textContent = n;
      if (n >= need) $('#anGo').disabled = false;
    }
    $('#letter').addEventListener('click', function (e) { var p = e.target.closest('.part'); if (p) pick(p); });
    $('#letter').addEventListener('keydown', function (e) {
      var p = e.target.closest('.part'); if (p && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(p); }
    });
    function done() { S.anatomyDone = true; save(); renderMail(); }
    $('#anGo').addEventListener('click', done);
    $('#anSkip').addEventListener('click', done);
  }

  /* ---------- смена 1: сортировка ---------- */
  function renderMail() {
    if (!S.anatomyDone) { renderAnatomy(); return; }
    var i = S.mail.i;
    if (i >= D.mail.length) { renderMailDone(); return; }
    var m = D.mail[i];
    var clues = partsOf(m).filter(function (p) { return p.v.clue; });
    var st = { phase: 'decide', found: 0, misses: 0 };

    screen.innerHTML =
      '<div class="head"><h2>Сортировка писем</h2><p>Письмо ' + (i + 1) + ' из ' + D.mail.length + '</p></div>' +
      '<div class="desk">' + letterHtml(m, 'enter') + '</div>' +
      '<div class="decide" id="decide">' +
        '<button type="button" class="btn real" data-v="real">Доставить</button>' +
        '<button type="button" class="btn trap" data-v="trap">Ловушка</button>' +
      '</div>' +
      '<div class="fb" id="fb"></div>';
    sfx.slide();

    $('#decide').addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b || st.phase !== 'decide') return;
      var v = b.dataset.v, right = v === m.verdict;
      $('#decide').remove();
      stamp(m.verdict);
      if (right && m.verdict === 'trap') startHunt();
      else if (right) finish(3, true);
      else { setTimeout(sfx.bad, 250); revealClues(); finish(0, false); }
    });

    function startHunt() {
      st.phase = 'hunt';
      var L = $('#letter'); L.classList.add('hunt');
      $$('.part', L).forEach(function (p) { p.tabIndex = 0; p.setAttribute('role', 'button'); });
      $('#fb').innerHTML =
        '<p class="verdict good">Верно, это ловушка.</p>' +
        '<p class="why">Теперь найди улики: нажимай на подозрительные места в письме.</p>' +
        '<p class="found" id="found">Найдено 0 из ' + clues.length + '</p>' +
        '<div class="actions"><button type="button" class="btn ghost" id="giveup">Покажи улики</button></div>';
      L.addEventListener('click', onHunt);
      L.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHunt(e); } });
      $('#giveup').addEventListener('click', function () { revealClues(); endHunt(2); });
    }
    function onHunt(e) {
      if (st.phase !== 'hunt') return;
      var p = e.target.closest('.part'); if (!p || p.classList.contains('hit')) return;
      var part = partsOf(m).find(function (x) { return x.k === p.dataset.k; });
      if (part.v.clue) {
        markClue(p, part.v.clue); st.found++; sfx.mark();
        $('#found').textContent = 'Найдено ' + st.found + ' из ' + clues.length;
        if (st.found >= clues.length) endHunt(st.misses <= 1 ? 3 : 2);
      } else {
        st.misses++; sfx.tick();
        p.classList.remove('miss'); void p.offsetWidth; p.classList.add('miss');
        $('#found').textContent = 'Здесь всё в порядке. Найдено ' + st.found + ' из ' + clues.length;
      }
    }
    function markClue(p, text) {
      if (p.classList.contains('hit')) return;
      p.classList.add('hit');
      var n = document.createElement('span'); n.className = 'note'; n.textContent = text; p.appendChild(n);
    }
    function revealClues() {
      clues.forEach(function (c) { markClue($('.part[data-k="' + c.k + '"]'), c.v.clue); });
    }
    function endHunt(stars) {
      st.phase = 'done';
      $('#letter').classList.remove('hunt');
      $$('#letter .part').forEach(function (p) { p.removeAttribute('tabindex'); p.removeAttribute('role'); });
      finish(stars, true);
    }
    function finish(stars, right) {
      st.phase = 'done';
      S.mail.stars[i] = stars; S.mail.i = i + 1; save();
      if (stars > 0) sfx.ok();
      var head = right
        ? (m.verdict === 'real' ? 'Верно, это настоящее сообщение.' : 'Ловушка поймана.')
        : (m.verdict === 'real' ? 'Это было настоящее сообщение.' : 'Это была ловушка.');
      var last = i + 1 >= D.mail.length;
      $('#fb').innerHTML =
        '<p class="verdict ' + (right ? 'good' : 'bad') + '">' + head + '</p>' +
        '<p class="why">' + esc(m.explain) + '</p>' +
        '<p style="margin-top:.5rem">' + starsHtml(stars, 3) + '</p>' +
        '<div class="actions"><button type="button" class="btn" id="next">' + (last ? 'Итоги сортировки' : 'Следующее письмо') + '</button></div>';
      if (m.memo) addMemo(m.memo);
      paintBar();
      var nx = $('#next'); nx.focus({ preventScroll: true });
      nx.addEventListener('click', function () {
        var L = $('#letter');
        if (reduce) { renderMail(); return; }
        L.classList.add(m.verdict === 'real' ? 'out-real' : 'out-trap');
        setTimeout(renderMail, 380);
      });
    }
  }
  function renderMailDone() {
    var s = shiftStars('mail'), max = SHIFTS[0].max;
    var caught = D.mail.filter(function (m, k) { return m.verdict === 'trap' && S.mail.stars[k] > 0; }).length;
    var traps = D.mail.filter(function (m) { return m.verdict === 'trap'; }).length;
    screen.innerHTML =
      '<div class="head"><h2>Сортировка закончена</h2><p>★ ' + s + ' из ' + max + '</p></div>' +
      '<p class="task">Поймано ловушек: ' + caught + ' из ' + traps + '. Правила, которые ты узнал, лежат в памятке справа.</p>' +
      '<div class="actions">' + nextButton('mail') + '</div>';
  }

  /* ---------- смена 2: пароли ---------- */
  var GUESSES_PER_SEC = 1e10;   // мощный компьютер перебирает 10 млрд вариантов в секунду
  function poolSize(p) {
    var n = 0;
    if (/[a-z]/.test(p)) n += 26;
    if (/[A-Z]/.test(p)) n += 26;
    if (/[0-9]/.test(p)) n += 10;
    if (/[^a-zA-Z0-9]/.test(p)) n += 33;
    return n;
  }
  function crackSeconds(o) { return o.flag ? 0.001 : Math.pow(poolSize(o.p), o.p.length) / 2 / GUESSES_PER_SEC; }
  function crackText(o) {
    if (o.flag === 'common') return 'Мгновенно: он есть в списке популярных паролей';
    if (o.flag === 'personal') return 'За минуту, если подбирает тот, кто тебя знает';
    var s = crackSeconds(o), n;
    if (s < 1) return 'Меньше секунды';
    if (s < 60) { n = Math.round(s); return n + ' ' + plural(n, 'секунда', 'секунды', 'секунд'); }
    if (s < 3600) { n = Math.round(s / 60); return n + ' ' + plural(n, 'минута', 'минуты', 'минут'); }
    if (s < 86400) { n = Math.round(s / 3600); return n + ' ' + plural(n, 'час', 'часа', 'часов'); }
    var y = s / 31557600;
    if (y < 1) { n = Math.round(s / 86400); return n + ' ' + plural(n, 'день', 'дня', 'дней'); }
    if (y < 1000) { n = Math.round(y); return n + ' ' + plural(n, 'год', 'года', 'лет'); }
    if (y < 1e6) return 'Тысячи лет';
    if (y < 1e9) return 'Миллионы лет';
    return 'Миллиарды лет';
  }
  function meterWidth(o) {
    var l = Math.log10(Math.max(crackSeconds(o), 0.001));   // от -3 до ~18
    return Math.max(3, Math.min(100, (l + 3) / 21 * 100));
  }
  function renderPass() {
    var i = S.pass.i;
    if (i >= D.passwords.length) { renderPassDone(); return; }
    var q = D.passwords[i];
    var strongKey = crackSeconds(q.a) >= crackSeconds(q.b) ? 'a' : 'b';
    var order = Math.random() < 0.5 ? ['a', 'b'] : ['b', 'a'];
    var h = '<div class="head"><h2>Пароли</h2><p>Пара ' + (i + 1) + ' из ' + D.passwords.length + '</p></div>' +
      '<p class="task">Какой пароль дольше подбирать? Нажми на него.</p><div class="pairs" id="pairs">';
    order.forEach(function (k) {
      h += '<button type="button" class="pw" data-k="' + k + '"><code>' + esc(q[k].p) + '</code><span class="time"></span><span class="meter"><i></i></span></button>';
    });
    screen.innerHTML = h + '</div><div class="fb" id="fb"></div>';

    $('#pairs').addEventListener('click', function (e) {
      var b = e.target.closest('.pw'); if (!b || b.disabled) return;
      var right = b.dataset.k === strongKey;
      b.classList.add('picked');
      $$('.pw').forEach(function (x) {
        var o = q[x.dataset.k];
        x.disabled = true;
        x.classList.toggle('strong', x.dataset.k === strongKey);
        $('.time', x).textContent = crackText(o);
        requestAnimationFrame(function () { $('.meter i', x).style.width = meterWidth(o) + '%'; });
      });
      var stars = right ? 2 : 0;
      S.pass.stars[i] = stars; S.pass.i = i + 1; save();
      if (right) sfx.ok(); else sfx.bad();
      paintBar();
      $('#fb').innerHTML =
        '<p class="verdict ' + (right ? 'good' : 'bad') + '">' + (right ? 'Верно.' : 'Нет, надёжнее другой.') + '</p>' +
        '<p class="why">' + esc(q.explain) + '</p>' +
        '<p style="margin-top:.5rem">' + starsHtml(stars, 2) + '</p>' +
        '<div class="actions"><button type="button" class="btn" id="next">' + (i + 1 >= D.passwords.length ? 'Правила паролей' : 'Следующая пара') + '</button></div>';
      $('#next').addEventListener('click', renderPass);
      $('#next').focus({ preventScroll: true });
    });
  }
  function renderPassDone() {
    D.passwordRules.forEach(addMemo);
    var h = '<div class="head"><h2>Правила надёжного пароля</h2><p>★ ' + shiftStars('pass') + ' из ' + SHIFTS[1].max + '</p></div>' +
      '<div class="rules"><ul>';
    D.passwordRules.forEach(function (r) { h += '<li>' + esc(r) + '</li>'; });
    screen.innerHTML = h + '</ul></div><div class="actions">' + nextButton('pass') + '</div>';
  }

  /* ---------- смена 3: что можно выкладывать ---------- */
  function binName(id) { return D.bins.find(function (b) { return b.id === id; }).name; }
  function renderShare() {
    var i = S.share.i;
    if (i >= D.share.length) { renderShareDone(); return; }
    var c = D.share[i];
    var counts = {};
    D.share.slice(0, i).forEach(function (x) { counts[x.bin] = (counts[x.bin] || 0) + 1; });
    var h = '<div class="head"><h2>Что можно выкладывать</h2><p>Карточка ' + (i + 1) + ' из ' + D.share.length + '</p></div>' +
      '<p class="task">Кому можно рассказать или показать это? Выбери коробку.</p>' +
      '<div class="share-stage"><div class="scard enter" id="scard">' + esc(c.t) + '</div><div class="bins" id="bins">';
    D.bins.forEach(function (b) {
      var n = counts[b.id] || 0;
      h += '<button type="button" class="bin" data-b="' + b.id + '">' + esc(b.name) + '<span class="cnt">' + n + ' ' + plural(n, 'карточка', 'карточки', 'карточек') + '</span></button>';
    });
    screen.innerHTML = h + '</div></div><div class="fb" id="fb"></div>';
    sfx.slide();

    $('#bins').addEventListener('click', function (e) {
      var b = e.target.closest('.bin'); if (!b || b.disabled) return;
      var right = b.dataset.b === c.bin, target = $('.bin[data-b="' + c.bin + '"]');
      $$('.bin').forEach(function (x) { x.disabled = true; });
      b.classList.add(right ? 'right' : 'wrong');
      if (!right) target.classList.add('right');
      flyInto($('#scard'), target);
      var stars = right ? 1 : 0;
      S.share.stars[i] = stars; S.share.i = i + 1; save();
      if (right) sfx.ok(); else sfx.bad();
      paintBar();
      $('#fb').innerHTML =
        '<p class="verdict ' + (right ? 'good' : 'bad') + '">' + (right ? 'Верно.' : 'Правильно: «' + esc(binName(c.bin)) + '».') + '</p>' +
        '<p class="why">' + esc(c.why) + '</p>' +
        '<div class="actions"><button type="button" class="btn" id="next">' + (i + 1 >= D.share.length ? 'Итоги' : 'Следующая карточка') + '</button></div>';
      $('#next').addEventListener('click', renderShare);
      $('#next').focus({ preventScroll: true });
    });
  }
  function flyInto(card, bin) {
    if (reduce || !card.animate) { card.style.visibility = 'hidden'; return; }
    var a = card.getBoundingClientRect(), t = bin.getBoundingClientRect();
    var dx = (t.left + t.width / 2) - (a.left + a.width / 2), dy = (t.top + t.height / 2) - (a.top + a.height / 2);
    card.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.25)', opacity: 0 }
    ], { duration: 450, easing: 'cubic-bezier(.5,0,.7,.4)', fill: 'forwards' });
  }
  function renderShareDone() {
    addMemo('Пароль, коды и данные карты не говорят никому. Адрес и телефон — только знакомым в жизни.');
    screen.innerHTML =
      '<div class="head"><h2>Карточки разложены</h2><p>★ ' + shiftStars('share') + ' из ' + SHIFTS[2].max + '</p></div>' +
      '<p class="task">Простое правило: если по этому можно найти тебя или войти в твой аккаунт, это не для всех.</p>' +
      '<div class="actions">' + nextButton('share') + '</div>';
  }

  /* ---------- смена 4: словарь ---------- */
  var PAIR_TINTS = ['#FFE08A', '#BFE3D0', '#C9D8F5', '#F6C9CF', '#E2D3F3', '#F9D7B5'];
  function renderDict() {
    if (S.dict.stars !== null) { renderDictDone(); return; }
    var errors = 0, matched = 0, sel = null;
    var terms = shuffle(D.dict.map(function (x, k) { return k; }));
    var defs = shuffle(D.dict.map(function (x, k) { return k; }));
    var h = '<div class="head"><h2>Словарь оператора</h2><p>Ошибок: <b id="err">0</b></p></div>' +
      '<p class="task">Нажми на слово, потом на его объяснение.</p><div class="match"><div class="col" id="terms">';
    terms.forEach(function (k) { h += '<button type="button" class="tile term" data-k="' + k + '">' + esc(D.dict[k].term) + '</button>'; });
    h += '</div><div class="col" id="defs">';
    defs.forEach(function (k) { h += '<button type="button" class="tile def" data-k="' + k + '">' + esc(D.dict[k].def) + '</button>'; });
    screen.innerHTML = h + '</div></div><div class="fb" id="fb"></div>';

    $('#terms').addEventListener('click', function (e) {
      var b = e.target.closest('.tile'); if (!b || b.disabled) return;
      $$('#terms .tile').forEach(function (x) { x.classList.remove('sel'); });
      b.classList.add('sel'); sel = b; sfx.tick();
    });
    $('#defs').addEventListener('click', function (e) {
      var b = e.target.closest('.tile'); if (!b || b.disabled) return;
      if (!sel) {
        b.classList.remove('no'); void b.offsetWidth; b.classList.add('no');
        return;
      }
      if (b.dataset.k === sel.dataset.k) {
        var tint = PAIR_TINTS[matched % PAIR_TINTS.length];
        [sel, b].forEach(function (x) { x.disabled = true; x.classList.remove('sel'); x.classList.add('paired'); x.style.background = tint; });
        sel = null; matched++; sfx.ok();
        if (matched >= D.dict.length) {
          S.dict.stars = Math.max(0, D.dict.length - errors); save(); paintBar();
          $('#fb').innerHTML = '<p class="verdict good">Все слова на месте.</p>' +
            '<p style="margin-top:.5rem">' + starsHtml(S.dict.stars, D.dict.length) + '</p>' +
            '<div class="actions">' + nextButton('dict') + '</div>';
        }
      } else {
        errors++; $('#err').textContent = errors; sfx.bad();
        b.classList.remove('no'); void b.offsetWidth; b.classList.add('no');
      }
    });
  }
  function renderDictDone() {
    var h = '<div class="head"><h2>Словарь оператора</h2><p>★ ' + S.dict.stars + ' из ' + D.dict.length + '</p></div><div class="rules"><ul>';
    D.dict.forEach(function (x) { h += '<li><b>' + esc(x.term) + '</b>: ' + esc(x.def.charAt(0).toLowerCase() + x.def.slice(1)) + '</li>'; });
    screen.innerHTML = h + '</ul></div><div class="actions">' + nextButton('dict') +
      '<button type="button" class="btn ghost" id="redo">Пройти ещё раз</button></div>';
    $('#redo').addEventListener('click', function () { S.dict.stars = null; save(); paintBar(); renderDict(); });
  }

  /* ---------- удостоверение ---------- */
  function renderFinal() {
    var t = totalStars(), rank = D.ranks.find(function (r) { return t >= r.min; }).name;
    var d = new Date(), date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    var rows = '';
    SHIFTS.forEach(function (sh) {
      rows += '<tr><td>' + esc(sh.name) + '</td><td>' + (shiftDone(sh.id) ? '★ ' + shiftStars(sh.id) + ' из ' + sh.max : 'не пройдено') + '</td></tr>';
    });
    screen.innerHTML =
      '<article class="cert" id="cert">' +
        '<p class="org">Киберпочта</p>' +
        '<h2>Удостоверение оператора</h2>' +
        '<div class="name">' + esc(S.name || 'Оператор') + '</div>' +
        '<p class="rank">Звание: <b>' + esc(rank) + '</b></p>' +
        '<table>' + rows + '<tr class="sum"><td>Всего</td><td>★ ' + t + ' из ' + totalMax() + '</td></tr></table>' +
        '<p class="date">' + esc(date) + '</p>' +
      '</article>' +
      '<div class="actions cert-actions">' +
        '<button type="button" class="btn ghost" data-go="mail">Вернуться к сменам</button>' +
        '<button type="button" class="btn ghost" id="again">Новый оператор</button>' +
      '</div>';
    setTimeout(function () {
      var c = $('#cert'); if (!c) return;
      var s = document.createElement('div'); s.className = 'stamp hit'; s.textContent = 'Проверено';
      c.appendChild(s); sfx.stamp();
    }, reduce ? 0 : 350);
    $('#again').addEventListener('click', function () { var m = S.muted; S = fresh(); S.muted = m; save(); go('start'); });
  }

  /* ---------- запуск ---------- */
  paintSound();
  go(S.screen || 'start');
})();
