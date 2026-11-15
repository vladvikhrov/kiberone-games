/* ========================================================================
   Кукловод — интерфейс и отрисовка.
   Логика проверки лежит в logic.js, уровни в levels.js.
   Прогресс хранится во вкладке (sessionStorage) и пропадает при закрытии.
   Звук — WebAudio, без файлов.
   ======================================================================== */
(function () {
  'use strict';

  var L = window.PuppetLogic, CH = window.PuppetLevels, PARTS = L.PARTS;
  var COL = { x: '#4DB2FF', y: '#FF9F43', n: '#C58BFF', good: '#5BE38A', bad: '#FF6B7A', gold: '#FFD24D', stage: '#1B2547', curtain: '#A8222F' };
  var app = document.getElementById('app');
  var ORDER = ['legR', 'legL', 'body', 'head', 'armR', 'armL'];

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
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function span(cls, text) { return h('span', { class: cls, text: String(text) }); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function plural(n, a, b, c) { var m = n % 10, m100 = n % 100; if (m === 1 && m100 !== 11) return a; if (m >= 2 && m <= 4 && (m100 < 10 || m100 >= 20)) return b; return c; }

  /* ---------- сохранение ---------- */
  var KEY = 'kukolovod:v1';
  var P = (function () {
    try { var v = JSON.parse(sessionStorage.getItem(KEY)); if (v && v.prog) return v; } catch (e) { /* без хранилища тоже работает */ }
    return { prog: {} };
  })();
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* ничего */ } }
  function keyOf(ci, li) { return CH[ci].id + '/' + CH[ci].levels[li].id; }
  function chapterDone(ci) { return CH[ci].levels.every(function (_, li) { return !!P.prog[keyOf(ci, li)]; }); }
  function totalStars() {
    var s = 0, max = 0;
    CH.forEach(function (c, ci) { c.levels.forEach(function (_, li) { max += 3; var p = P.prog[keyOf(ci, li)]; if (p) s += p.stars; }); });
    return { s: s, max: max };
  }

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
    click: function () { tone(520, 0.05, 'triangle', 0.06); },
    tick: function () { tone(880, 0.03, 'square', 0.03); },
    ok: function (i) { var b = 523 * Math.pow(1.122, Math.min(i || 0, 8)); tone(b, 0.1, 'sine', 0.12); tone(b * 1.5, 0.16, 'sine', 0.09, 0.07); },
    bad: function () { tone(190, 0.28, 'sawtooth', 0.09, 0, -90); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.12, i * 0.1); }); }
  };

  /* ---------- состояние ---------- */
  var S = {
    screen: 'home', ci: 0, li: 0, level: null, round: 0, vals: {}, t: 0, playing: false, onEnd: null, played: false,
    fails: 0, hints: 0, guides: 0, result: {}, focus: null, mouse: null, done: false, particles: [], floaters: []
  };
  var UI = {}, ST = null;

  /* ---------- вид сцены: координаты 0..100, как в «Фильме» ---------- */
  function makeView(side) {
    var xMin = -15, xMax = 114, yMin = -17, yMax = 116;
    var s = Math.min(side / (xMax - xMin), side / (yMax - yMin));
    var ox = (side - s * (xMax - xMin)) / 2, oy = (side - s * (yMax - yMin)) / 2;
    return { s: s, side: side,
      px: function (x) { return ox + (x - xMin) * s; }, py: function (y) { return side - (oy + (y - yMin) * s); },
      wx: function (px) { return xMin + (px - ox) / s; }, wy: function (py) { return yMin + ((side - py) - oy) / s; } };
  }
  function stageSide(level) {
    var w = app.clientWidth || 1000, hh = (app.clientHeight || 700) - (level && level.timed ? 72 : 0);
    var side = w < 1100 ? Math.min(w - 32, 560) : Math.min(hh - 28, w - 32 - 372 - 16);
    return Math.max(340, Math.min(740, Math.floor(side)));
  }
  function makeStage(level) {
    var side = stageSide(level), dpr = window.devicePixelRatio || 1;
    var canvas = h('canvas', { width: Math.round(side * dpr), height: Math.round(side * dpr), 'aria-label': 'Сцена с куклой' });
    canvas.style.width = side + 'px'; canvas.style.height = side + 'px';
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ST = { canvas: canvas, ctx: ctx, side: side, V: makeView(side), level: level };
    canvas.addEventListener('mousemove', function (e) { var r = canvas.getBoundingClientRect(); S.mouse = { px: e.clientX - r.left, py: e.clientY - r.top }; });
    canvas.addEventListener('mouseleave', function () { S.mouse = null; });
    return canvas;
  }
  window.addEventListener('resize', function () {
    if (!ST || S.screen !== 'level') return;
    var side = stageSide(ST.level); if (side === ST.side) return;
    var dpr = window.devicePixelRatio || 1;
    ST.canvas.width = Math.round(side * dpr); ST.canvas.height = Math.round(side * dpr);
    ST.canvas.style.width = side + 'px'; ST.canvas.style.height = side + 'px';
    ST.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ST.side = side; ST.V = makeView(side);
  });

  /* ---------- рисование ---------- */
  function rr(c, x, y, w, hgt, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hgt, r); c.arcTo(x + w, y + hgt, x, y + hgt, r);
    c.arcTo(x, y + hgt, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); }
  function label(c, text, x, y, color, align, size, weight) {
    c.font = (weight || 700) + ' ' + (size || 13) + 'px "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace';
    c.fillStyle = color; c.textAlign = align || 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y);
  }
  function dashLine(c, x0, y0, x1, y1, color, width, alpha) {
    c.save(); c.globalAlpha = alpha == null ? 1 : alpha; c.strokeStyle = color; c.lineWidth = width || 2; c.setLineDash([7, 6]);
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.restore();
  }
  function arrow(c, x, y, dx, dy, color) {
    c.fillStyle = color; c.beginPath(); c.moveTo(x + dx * 9, y + dy * 9);
    c.lineTo(x - dy * 6 - dx * 2, y + dx * 6 - dy * 2); c.lineTo(x + dy * 6 - dx * 2, y - dx * 6 - dy * 2); c.closePath(); c.fill();
  }

  function drawStage(c, V, t) {
    var side = V.side;
    c.fillStyle = '#140E26'; c.fillRect(0, 0, side, side);
    // прожектор
    var g = c.createRadialGradient(V.px(50), V.py(55), 10, V.px(50), V.py(55), side * 0.75);
    g.addColorStop(0, 'rgba(255,236,190,.16)'); g.addColorStop(1, 'rgba(255,236,190,0)');
    c.fillStyle = g; c.fillRect(0, 0, side, side);
    // сцена
    var x0 = V.px(-5), x1 = V.px(105), y0 = V.py(105), y1 = V.py(-5);
    c.fillStyle = '#4B3A7A'; rr(c, x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8, 14); c.fill();
    c.fillStyle = COL.stage; rr(c, x0, y0, x1 - x0, y1 - y0, 11); c.fill();
    // сетка
    c.lineWidth = 1;
    for (var k = 0; k <= 100; k += 10) {
      c.strokeStyle = 'rgba(255,255,255,' + (k % 50 === 0 ? '.20' : '.10') + ')';
      c.beginPath(); c.moveTo(V.px(k), y0 + 4); c.lineTo(V.px(k), y1 - 4); c.stroke();
      c.beginPath(); c.moveTo(x0 + 4, V.py(k)); c.lineTo(x1 - 4, V.py(k)); c.stroke();
    }
    // оси
    var fs = clamp(V.s * 2.6, 11, 14), ay = V.py(0), ax = V.px(0);
    c.strokeStyle = COL.x; c.lineWidth = 3; c.beginPath(); c.moveTo(x0 + 6, ay); c.lineTo(x1 + 8, ay); c.stroke(); arrow(c, x1 + 10, ay, 1, 0, COL.x);
    c.strokeStyle = COL.y; c.beginPath(); c.moveTo(ax, y1 - 6); c.lineTo(ax, y0 - 8); c.stroke(); arrow(c, ax, y0 - 10, 0, -1, COL.y);
    for (var q = 0; q <= 100; q += 10) {
      c.lineWidth = 2; c.strokeStyle = COL.x; c.beginPath(); c.moveTo(V.px(q), ay - 4); c.lineTo(V.px(q), ay + 4); c.stroke();
      label(c, q, V.px(q), y1 + 14, COL.x, 'center', fs);
      c.strokeStyle = COL.y; c.beginPath(); c.moveTo(ax - 4, V.py(q)); c.lineTo(ax + 4, V.py(q)); c.stroke();
      label(c, q, x0 - 12, V.py(q), COL.y, 'right', fs);
    }
    label(c, 'X — вбок →', x1 - 2, y1 + 32, COL.x, 'right', 13);
    label(c, 'Y — вверх ↑', ax + 14, y0 - 18, COL.y, 'left', 13);
    // занавес: боковые складки и верхняя кайма
    for (var i = 0; i < 4; i++) {
      c.fillStyle = i % 2 ? '#7E1A25' : COL.curtain;
      c.fillRect(i * 3, 0, 3, side); c.fillRect(side - 12 + i * 3, 0, 3, side);
    }
    c.fillStyle = COL.curtain; c.fillRect(0, 0, side, 10);
    for (var j = 0; j < side; j += 18) { c.beginPath(); c.arc(j + 9, 10, 9, 0, Math.PI); c.fill(); }
  }

  /* Форма детали: заливка, обводка или пунктирный призрак. */
  function shape(c, V, pid, vals, st) {
    var def = PARTS[pid];
    c.save(); c.globalAlpha = st.alpha == null ? 1 : st.alpha;
    if (def.kind === 'circle') {
      circle(c, V.px(vals['head.x']), V.py(vals['head.y']), vals['head.r'] * V.s + (st.grow || 0));
      if (st.fill) { c.fillStyle = st.fill; c.fill(); }
      if (st.stroke) { c.strokeStyle = st.stroke; c.lineWidth = st.width || 2; if (st.dash) c.setLineDash(st.dash); c.stroke(); }
    } else if (def.kind === 'rect') {
      var w = vals['body.w'] * V.s, hh = vals['body.h'] * V.s, gx = st.grow || 0;
      rr(c, V.px(vals['body.x']) - w / 2 - gx, V.py(vals['body.y']) - hh / 2 - gx, w + gx * 2, hh + gx * 2, 3 + gx);
      if (st.fill) { c.fillStyle = st.fill; c.fill(); }
      if (st.stroke) { c.strokeStyle = st.stroke; c.lineWidth = st.width || 2; if (st.dash) c.setLineDash(st.dash); c.stroke(); }
    } else {
      c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath();
      c.moveTo(V.px(vals[pid + '.x1']), V.py(vals[pid + '.y1'])); c.lineTo(V.px(vals[pid + '.x2']), V.py(vals[pid + '.y2']));
      c.lineWidth = L.THICK * V.s + (st.grow || 0); c.strokeStyle = st.fill || st.stroke || '#fff'; c.stroke();
      if (st.dash) { c.lineWidth = 2; c.setLineDash(st.dash); c.strokeStyle = st.stroke; c.beginPath(); c.moveTo(V.px(vals[pid + '.x1']), V.py(vals[pid + '.y1'])); c.lineTo(V.px(vals[pid + '.x2']), V.py(vals[pid + '.y2'])); c.stroke(); }
    }
    c.restore();
  }

  function drawPuppet(c, V, vals, show, opt) {
    ORDER.forEach(function (pid) {
      if (show.indexOf(pid) < 0) return;
      if (opt.ghost) { shape(c, V, pid, vals, { fill: 'rgba(255,210,77,.22)', stroke: COL.gold, dash: [7, 5], width: 2.5, alpha: 0.95 }); return; }
      if (opt.result && opt.result[pid] !== undefined) shape(c, V, pid, vals, { fill: opt.result[pid] ? COL.good : COL.bad, grow: 9, alpha: 0.55 });
      shape(c, V, pid, vals, { fill: PARTS[pid].color });
    });
  }

  function drawStrings(c, V, vals, show) {
    var by = V.py(108);
    var list = [['head', 50, vals['head.x'], vals['head.y'] + vals['head.r']], ['armR', 62, vals['armR.x2'], vals['armR.y2']], ['armL', 38, vals['armL.x2'], vals['armL.y2']],
      ['legR', 56, vals['legR.x2'], vals['legR.y2']], ['legL', 44, vals['legL.x2'], vals['legL.y2']]];
    c.save(); c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 1.2;
    list.forEach(function (it) { if (show.indexOf(it[0]) < 0) return; c.beginPath(); c.moveTo(V.px(it[1]), by); c.lineTo(V.px(it[2]), V.py(it[3])); c.stroke(); });
    c.fillStyle = '#B07A3A'; rr(c, V.px(36), by - 4, V.px(64) - V.px(36), 8, 3); c.fill();
    c.restore();
  }

  function drawProjection(c, V, p, alpha, withNumbers, emphX, emphY) {
    var ax = V.px(0), ay = V.py(0), px = V.px(p.x), py = V.py(p.y);
    dashLine(c, px, py, px, ay, COL.x, emphX ? 3 : 2, alpha);
    dashLine(c, px, py, ax, py, COL.y, emphY ? 3 : 2, alpha);
    c.save(); c.globalAlpha = alpha; c.fillStyle = COL.x; circle(c, px, ay, 5); c.fill(); c.fillStyle = COL.y; circle(c, ax, py, 5); c.fill(); c.restore();
    if (withNumbers) { label(c, p.x, px, V.py(-9), COL.x, 'center', 17); label(c, p.y, V.px(-9), py, COL.y, 'center', 17); }
  }

  function burst(px, py, color, n) {
    for (var i = 0; i < (n || 16); i++) {
      var a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 120;
      S.particles.push({ x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.7 + Math.random() * 0.4, max: 1.1, color: color || COL.gold });
    }
  }
  function drawFx(c, dt) {
    S.particles = S.particles.filter(function (p) { p.life -= dt; return p.life > 0; });
    S.particles.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; c.globalAlpha = clamp(p.life / p.max, 0, 1); c.fillStyle = p.color; circle(c, p.x, p.y, 3); c.fill(); });
    c.globalAlpha = 1;
  }

  /* ---------- значения полей ---------- */
  function initVals() {
    var lv = S.level, base = L.baseValues(lv), v = {};
    lv.edit.forEach(function (f) { v[f] = { mode: 'num', value: (lv.start && lv.start[f] !== undefined) ? lv.start[f] : base[f], raw: '' }; });
    return v;
  }
  /* Полные значения всех полей в момент t. */
  function curVals(t) {
    var lv = S.level, v = L.baseValues(lv);
    lv.edit.forEach(function (f) { var sp = S.vals[f]; v[f] = sp.mode === 'num' ? sp.value : L.evalSpec(sp, t); });
    return v;
  }
  function goalVals() {
    var lv = S.level;
    if (lv.free) return null;
    return lv.rounds ? L.targetPose(lv, S.round) : L.targetAt(lv, S.t);
  }

  /* ---------- главный цикл ---------- */
  var lastTs = 0, clockT = 0;
  function frame(ts) {
    var dt = Math.min(0.05, (ts - lastTs) / 1000 || 0); lastTs = ts; clockT += dt;
    if (S.screen === 'level' && ST) { updateTime(dt); drawLevel(dt, clockT); }
    requestAnimationFrame(frame);
  }

  function drawLevel(dt, t) {
    var c = ST.ctx, V = ST.V, lv = S.level, show = lv.show;
    drawStage(c, V, t);
    var vals = curVals(S.t), goal = goalVals();
    drawStrings(c, V, vals, show);
    if (goal) drawPuppet(c, V, goal, show, { ghost: true });
    // подсказки: линии от точек цели к осям
    if (S.guides >= 1 && lv.rounds) targetPoints(goal).forEach(function (p) { drawProjection(c, V, p, 0.9, S.guides >= 2); });
    drawPuppet(c, V, vals, show, { result: S.result });
    drawMarks(c, V, vals, lv);
    drawFocus(c, V, vals, t);
    drawHover(c, V, lv);
    if (lv.timed) drawClock(c, V);
    drawFx(c, dt);
  }

  function targetPoints(goal) {
    var lv = S.level, out = [], seen = {};
    lv.edit.forEach(function (f) {
      var s = L.splitId(f), b = L.keyBase(s.key); if (b !== 'x' && b !== 'y') return;
      var n = s.key.slice(b.length), id = s.part + n; if (seen[id]) return; seen[id] = 1;
      out.push(L.pointOf(goal, s.part, 'x' + n));
    });
    return out;
  }

  /* Метки точек: номера 1 и 2 на линии, названия частей тела. */
  function drawMarks(c, V, vals, lv) {
    if (lv.free || lv.timed) return;
    L.editedParts(lv).forEach(function (pid) {
      var def = PARTS[pid]; if (def.kind !== 'line') return;
      var both = lv.edit.indexOf(pid + '.x1') >= 0;
      [1, 2].forEach(function (n) {
        var p = { x: vals[pid + '.x' + n], y: vals[pid + '.y' + n] }, px = V.px(p.x), py = V.py(p.y);
        if (both) {
          c.fillStyle = COL.gold; circle(c, px, py, 10); c.fill(); label(c, n, px, py, '#3A2A00', 'center', 13, 800);
        } else {
          c.strokeStyle = '#fff'; c.lineWidth = 2; circle(c, px, py, 6); c.stroke();
          if (lv.hover) label(c, def.names[n - 1], px + (px > V.side / 2 ? 12 : -12), py - 14, '#fff', px > V.side / 2 ? 'left' : 'right', 13);
        }
      });
    });
  }

  /* Поле в фокусе: подсвечиваем точку на сцене и рисуем пунктир к осям. */
  function drawFocus(c, V, vals, t) {
    if (!S.focus) return;
    var s = L.splitId(S.focus), b = L.keyBase(s.key), pulse = 1 + Math.sin(t * 7) * 0.2;
    if (b === 'x' || b === 'y') {
      var p = L.pointOf(vals, s.part, s.key), px = V.px(p.x), py = V.py(p.y);
      drawProjection(c, V, p, 1, false, b === 'x', b === 'y');
      c.strokeStyle = b === 'x' ? COL.x : COL.y; c.lineWidth = 3; circle(c, px, py, 14 * pulse); c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = 1.5; circle(c, px, py, 5); c.stroke();
    } else {
      shape(c, V, s.part, vals, { stroke: COL.n, width: 3, grow: 6 * pulse, alpha: 0.95 });
    }
  }

  function drawHover(c, V, lv) {
    if (!S.mouse || !lv.hover) return;
    var wx = Math.round(V.wx(S.mouse.px)), wy = Math.round(V.wy(S.mouse.py));
    if (wx < 0 || wy < 0 || wx > 100 || wy > 100) return;
    var px = V.px(wx), py = V.py(wy);
    drawProjection(c, V, { x: wx, y: wy }, 0.85, false);
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 2; circle(c, px, py, 8); c.stroke();
    if (lv.hover !== true) return;
    var txt = '(' + wx + ', ' + wy + ')';
    c.font = '700 15px "Cascadia Mono", Consolas, monospace';
    var tw = c.measureText(txt).width + 16, bx = clamp(px + 14, 14, ST.side - tw - 16), by = clamp(py - 34, 14, ST.side - 30);
    c.fillStyle = 'rgba(12,6,26,.9)'; rr(c, bx, by, tw, 26, 8); c.fill();
    label(c, txt, bx + tw / 2, by + 13, '#fff', 'center', 15);
  }

  function drawClock(c, V) {
    var txt = 'time = ' + Math.round(S.t);
    c.font = '800 24px "Cascadia Mono", Consolas, monospace';
    var w = c.measureText(txt).width + 26, x = V.side - w - 20, y = 18;
    c.fillStyle = 'rgba(12,6,26,.92)'; rr(c, x, y, w, 42, 10); c.fill();
    c.strokeStyle = COL.gold; c.lineWidth = 2; rr(c, x, y, w, 42, 10); c.stroke();
    label(c, txt, x + w / 2, y + 22, '#fff', 'center', 24, 800);
  }

  /* ---------- время ---------- */
  function updateTime(dt) {
    if (!S.playing) return;
    var before = Math.round(S.t);
    S.t = Math.min(100, S.t + dt * 28);
    if (UI.slider) UI.slider.value = Math.round(S.t);
    if (Math.round(S.t) !== before) { refreshFields(); if (Math.round(S.t) % 10 === 0) sfx.tick(); }
    if (S.t >= 100) {
      S.playing = false; S.played = true; if (UI.play) UI.play.textContent = '▶ Полёт';
      if (S.onEnd) { var f = S.onEnd; S.onEnd = null; f(); }
    }
  }
  function togglePlay() {
    ctxAudio();
    if (S.playing) { S.playing = false; UI.play.textContent = '▶ Полёт'; return; }
    if (S.t >= 100) S.t = 0;
    S.playing = true; UI.play.textContent = '❚❚ Пауза'; sfx.click();
  }

  /* ---------- панель: поля чисел ---------- */
  function say(text, tone) {
    if (!UI.say) return;
    UI.say.textContent = text; UI.bubble.className = 'bubble' + (tone === 'good' ? ' good' : tone === 'bad' ? ' bad' : '');
  }
  function avatar() {
    var cv = h('canvas', { width: 112, height: 112 }); cv.style.width = '56px'; cv.style.height = '56px';
    var c = cv.getContext('2d'); c.scale(2, 2); c.fillStyle = '#1B2547'; c.fillRect(0, 0, 56, 56);
    c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 1; c.beginPath(); c.moveTo(28, 0); c.lineTo(28, 14); c.stroke();
    c.fillStyle = '#E5333B'; circle(c, 28, 26, 12); c.fill(); c.fillStyle = '#fff'; circle(c, 23, 24, 2.4); c.fill(); circle(c, 33, 24, 2.4); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(28, 28, 6, 0.2, Math.PI - 0.2); c.stroke();
    c.fillStyle = '#3A3AD6'; c.fillRect(18, 40, 20, 16);
    return cv;
  }
  function bubbleBox(text) {
    UI.say = h('div', { class: 'say', 'aria-live': 'polite', text: text });
    UI.bubble = h('div', { class: 'bubble' }, avatar(), h('div', null, h('span', { class: 'tag', text: 'КУКЛОВОД' }), UI.say));
    return UI.bubble;
  }

  var MODE_LABELS = [['num', 'число'], ['time', 'time'], ['inv', '100 − time']];

  function fieldBox(fid) {
    var lv = S.level, sp = S.vals[fid], key = L.splitId(fid).key, b = L.keyBase(key);
    var cls = b === 'x' ? 'fx' : b === 'y' ? 'fy' : 'fn';
    var name = b === 'x' ? 'X' : b === 'y' ? 'Y' : ({ r: 'Радиус', w: 'Длина', h: 'Высота' })[b];
    var input = h('input', { type: 'number', inputmode: 'numeric', id: 'f-' + fid.replace('.', '-'), 'aria-label': L.fieldLabel(fid) });
    input.value = sp.value;
    function setNum(n) { sp.value = n; sp.raw = String(n); input.value = n; clearResult(); }
    input.addEventListener('input', function () {
      sp.raw = input.value; var n = Number(input.value);
      if (input.value !== '' && Number.isFinite(n)) sp.value = n;
      clearResult();
    });
    input.addEventListener('focus', function () { S.focus = fid; });
    input.addEventListener('blur', function () { if (S.focus === fid) S.focus = null; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doCheck(); } });
    function bump(d) { var cur = Number.isFinite(Number(input.value)) && input.value !== '' ? Number(input.value) : sp.value; setNum(clamp(cur + d, 0, L.maxOf(key))); }
    function hold(d) {
      return function (e) {
        e.preventDefault(); if (input.disabled) return; input.focus(); bump(d);
        var timer = setTimeout(function () { var iv = setInterval(function () { bump(d); }, 60); stop = function () { clearInterval(iv); }; }, 380), stop = function () { clearTimeout(timer); };
        var end = function () { stop(); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
        window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
      };
    }
    var minus = h('button', { type: 'button', text: '−', 'aria-label': 'Меньше', onpointerdown: hold(-1) });
    var plus = h('button', { type: 'button', text: '+', 'aria-label': 'Больше', onpointerdown: hold(1) });
    var box = h('div', { class: 'field ' + cls }, h('label', { for: input.id, text: name }), h('div', { class: 'stepper' }, minus, input, plus));
    var sel = null;
    if (lv.timeFields && lv.timeFields.indexOf(fid) >= 0) {
      sel = h('select', { class: 'mode', 'aria-label': 'Чем заполнить поле' });
      MODE_LABELS.forEach(function (m) { sel.appendChild(h('option', { value: m[0], text: m[1] })); });
      sel.addEventListener('change', function () {
        sp.mode = sel.value; var moving = sp.mode !== 'num';
        input.disabled = moving; minus.disabled = moving; plus.disabled = moving;
        if (!moving) input.value = sp.value;
        clearResult(); refreshFields(); updateFree(); sfx.click();
      });
      box.appendChild(sel);
    }
    UI.fields[fid] = { input: input, sel: sel, minus: minus, plus: plus };
    return box;
  }

  function refreshFields() {
    Object.keys(UI.fields || {}).forEach(function (f) {
      var sp = S.vals[f], ui = UI.fields[f];
      if (sp.mode !== 'num') ui.input.value = Math.round(L.evalSpec(sp, S.t));
    });
  }
  function clearResult() {
    if (Object.keys(S.result).length) S.result = {};
    if (UI.fb && UI.fb.firstChild && !S.done) clear(UI.fb);
  }

  function partCard(pid) {
    var lv = S.level, def = PARTS[pid];
    var keys = def.keys.filter(function (k) { return lv.edit.indexOf(pid + '.' + k) >= 0; });
    var both = def.kind === 'line' && keys.length === 4;
    var title = def.label + (def.kind === 'line' && !both ? ' · ' + def.names[1] : '');
    var card = h('div', { class: both ? 'box' : 'box part' });
    card.appendChild(h('h3', { text: title, title: def.kind === 'line' && !both ? def.names[0] + ' стоит на месте' : '' }));
    if (both) {
      [1, 2].forEach(function (n) {
        var pt = h('div', { class: 'pt' }, h('div', { class: 'pt-title' }, h('span', { class: 'badge', text: String(n) }), (n === 1 ? 'Начальная' : 'Конечная') + ' точка'));
        pt.appendChild(fieldBox(pid + '.x' + n)); pt.appendChild(fieldBox(pid + '.y' + n)); card.appendChild(pt);
      });
    } else {
      var row = h('div', { class: 'pt' }); keys.forEach(function (k) { row.appendChild(fieldBox(pid + '.' + k)); }); card.appendChild(row);
    }
    return card;
  }

  function journalBox() {
    var done = CH.filter(function (_, ci) { return chapterDone(ci); });
    var det = h('details', { class: 'journal' }, h('summary', { text: 'Записи кукловода (' + done.length + '/' + CH.length + ')' }));
    var ul = h('ul');
    if (!done.length) ul.appendChild(h('li', { text: 'Здесь появятся правила, которые ты открыл. Пройди главу целиком.' }));
    done.forEach(function (c) { ul.appendChild(h('li', null, h('b', { text: c.title + '. ' }), c.rule)); });
    det.appendChild(ul); return det;
  }

  /* ---------- проверка ---------- */
  function readNumbers() {
    var lv = S.level;
    for (var i = 0; i < lv.edit.length; i++) {
      var f = lv.edit[i], sp = S.vals[f];
      if (sp.mode !== 'num') continue;
      var raw = UI.fields[f].input.value, n = Number(raw);
      if (raw === '' || !L.validValue(f, n)) { return { ok: false, text: 'Поле «' + L.fieldLabel(f) + '»: нужно целое число от 0 до ' + L.maxOf(L.splitId(f).key) + '.' }; }
      sp.value = n;
    }
    return { ok: true };
  }

  function fbRow(ok, head, text, note) {
    return h('div', { class: 'row ' + (ok ? 'ok' : 'bad') }, h('b', { text: ok ? '✓' : '✗' }), head ? span('', head + ': ') : null, text || '', note ? h('span', { class: 'note', text: note }) : null);
  }

  function doCheck() {
    var lv = S.level; if (S.done || S.playing) return;
    ctxAudio();
    var rn = readNumbers();
    if (!rn.ok) { say(rn.text, 'bad'); sfx.bad(); return; }
    clear(UI.fb);
    if (lv.free) return showFree();
    if (lv.rounds) {
      var res = L.checkPose(lv, S.round, curVals(0));
      S.result = {};
      res.parts.forEach(function (p) {
        S.result[p.id] = p.ok;
        UI.fb.appendChild(fbRow(p.ok, PARTS[p.id].label, p.ok ? 'на месте' : p.issues.join('. ') + '.', p.note));
      });
      if (res.ok) return roundDone();
      S.fails++; sfx.bad(); say('Почти! Часть деталей ещё не на месте. Смотри на красные подсветки.', 'bad');
    } else {
      var specs = {}; lv.edit.forEach(function (f) { specs[f] = S.vals[f]; });
      var ar = L.checkAnim(lv, specs);
      if (ar.ok) return animDone();
      S.fails++; sfx.bad(); say('Сравни с пунктирной куклой: нажми «Полёт» и посмотри, что движется не так.', 'bad');
      ar.issues.forEach(function (it) { UI.fb.appendChild(fbRow(false, '', it.text)); });
    }
  }

  function roundDone() {
    var lv = S.level, V = ST.V;
    sfx.ok(S.round); burst(V.px(50), V.py(50), COL.gold, 28);
    if (S.round + 1 < lv.rounds.length) {
      say('Раунд пройден! Следующая поза.', 'good');
      setTimeout(function () { if (S.screen === 'level' && S.level === lv) nextRound(); }, 1000);
    } else {
      say('Все позы собраны!', 'good'); S.done = true; setTimeout(function () { if (S.screen === 'level' && S.level === lv) winLevel(); }, 900);
    }
  }
  function nextRound() {
    S.round++; S.vals = initVals(); S.result = {}; S.guides = 0; clear(UI.fb); rebuildCards(); updateRoundLabel(); say(S.level.story ? roundHint() : '', 'info');
  }
  function roundHint() { return 'Поза «' + S.level.rounds[S.round].label + '». Поставь числа так, чтобы кукла совпала с пунктиром.'; }
  function updateRoundLabel() {
    if (!UI.round) return;
    UI.round.firstChild.textContent = 'Поза: ' + S.level.rounds[S.round].label;
    UI.round.lastChild.textContent = (S.round + 1) + ' / ' + S.level.rounds.length;
  }

  function animDone() {
    var lv = S.level;
    S.done = true; sfx.ok(3); say('Все части двигаются правильно! Смотри представление.', 'good');
    S.t = 0; S.playing = true; UI.play.textContent = '❚❚ Пауза';
    S.onEnd = function () { setTimeout(function () { if (S.screen === 'level' && S.level === lv) winLevel(); }, 600); };
  }

  function updateFree() {
    if (!UI.showBtn) return;
    var specs = {}; S.level.edit.forEach(function (f) { specs[f] = S.vals[f]; });
    var n = L.movingCount(specs);
    UI.showBtn.disabled = n < 2;
    UI.freeNote.textContent = 'Оживлено частей: ' + n + (n < 2 ? '. Нужно хотя бы две.' : '. Можно показывать!');
  }
  function showFree() { /* кнопка «Показать» запускает полёт и завершает уровень */ }
  function startShow() {
    var lv = S.level; if (S.done) return;
    var specs = {}; lv.edit.forEach(function (f) { specs[f] = S.vals[f]; });
    if (L.movingCount(specs) < 2) { say('Оживи хотя бы две части: выбери time или 100 − time.', 'bad'); sfx.bad(); return; }
    S.done = true; S.t = 0; S.playing = true; UI.play.textContent = '❚❚ Пауза'; sfx.ok(2); say('Занавес! Смотри своё представление.', 'good');
    S.onEnd = function () { setTimeout(function () { if (S.screen === 'level' && S.level === lv) winLevel(); }, 500); };
  }

  function hint() {
    var lv = S.level, max = lv.rounds ? 3 : 1;
    if (S.hints >= max) { say('Больше подсказок нет. Спроси тьютора или внимательно посмотри на сцену.', 'info'); return; }
    S.hints++; sfx.click();
    if (S.hints === 1) say(lv.hint, 'info');
    else if (S.hints === 2) { S.guides = 1; say('Смотри: пунктирные линии идут от нужных точек к осям. Они показывают, где искать числа.', 'info'); }
    else { S.guides = 2; say('На осях подписаны нужные числа. Попробуй понять, как они связаны с точками.', 'info'); }
    UI.hintBtn.textContent = 'Подсказка (' + (max - S.hints) + ')';
  }

  /* ---------- конец уровня ---------- */
  function winLevel() {
    var lv = S.level, k = keyOf(S.ci, S.li), stars = L.stars(S.fails, S.hints);
    S.playing = false;
    var wasDone = chapterDone(S.ci), prev = P.prog[k];
    P.prog[k] = { stars: Math.max(prev ? prev.stars : 0, stars) }; save(); updateBar(); sfx.win();
    var nowDone = !wasDone && chapterDone(S.ci), next = nextLevel();
    var win = h('div', { class: 'win' }, h('h2', { text: 'Представление удалось!' }),
      h('div', { class: 'stars', 'aria-label': stars + ' из 3 звёзд' }, span('', '★'.repeat(stars)), span('off', '★'.repeat(3 - stars))),
      nowDone ? h('div', { class: 'rule' }, h('b', { text: 'НОВАЯ ЗАПИСЬ КУКЛОВОДА' }), CH[S.ci].rule) : null,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', text: 'Ещё раз', onclick: function () { startLevel(S.ci, S.li); } }),
        next ? h('button', { type: 'button', class: 'btn primary', text: next.label, onclick: function () { startLevel(next.ci, next.li); } }) : h('button', { type: 'button', class: 'btn primary', text: 'К главам', onclick: showChapters })));
    UI.stage.appendChild(h('div', { class: 'modal' }, win));
  }
  function nextLevel() {
    var c = CH[S.ci];
    if (S.li + 1 < c.levels.length) return { ci: S.ci, li: S.li + 1, label: 'Дальше' };
    if (S.ci + 1 < CH.length) return { ci: S.ci + 1, li: 0, label: 'Следующая глава' };
    return null;
  }

  /* ---------- экран уровня ---------- */
  function rebuildCards() {
    UI.fields = {};
    clear(UI.cards);
    L.editedParts(S.level).forEach(function (pid) { UI.cards.appendChild(partCard(pid)); });
    if (UI.fields && !S.level.rounds) refreshFields();
  }

  function startLevel(ci, li) {
    ctxAudio();
    S.screen = 'level'; S.ci = ci; S.li = li; S.level = CH[ci].levels[li];
    var lv = S.level; lv.timed = !lv.rounds;
    S.round = 0; S.t = 0; S.playing = false; S.onEnd = null; S.played = false; S.fails = 0; S.hints = 0; S.guides = 0;
    S.result = {}; S.focus = null; S.mouse = null; S.done = false; S.particles = [];
    S.vals = initVals(); UI = { fields: {} };
    var canvas = makeStage(lv);
    UI.stage = h('div', { class: 'stage' }, canvas);
    var panel = h('aside', { class: 'panel' });
    clear(app); app.appendChild(h('div', { class: 'level' }, UI.stage, panel));

    panel.appendChild(bubbleBox(lv.story));
    if (lv.rounds) {
      UI.round = h('div', { class: 'goal' }, h('span', { text: '' }), h('b', { text: '' })); panel.appendChild(UI.round); updateRoundLabel();
    }
    UI.cards = h('div', { class: 'cards-col' }); UI.cards.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    panel.appendChild(UI.cards); rebuildCards();
    UI.fb = h('div', { class: 'fb', 'aria-live': 'polite' });
    UI.hintBtn = h('button', { type: 'button', class: 'btn small ghost', text: 'Подсказка (' + (lv.rounds ? 3 : 1) + ')', onclick: hint });
    var acts = h('div', { class: 'actions' });
    if (lv.free) {
      UI.showBtn = h('button', { type: 'button', class: 'btn primary grow', text: 'Показать ★', onclick: startShow });
      acts.appendChild(UI.showBtn); acts.appendChild(UI.hintBtn);
      UI.freeNote = h('div', { class: 'fixedpt' }); panel.appendChild(UI.freeNote); updateFree();
    } else {
      acts.appendChild(h('button', { type: 'button', class: 'btn primary grow', text: 'Проверить', onclick: doCheck })); acts.appendChild(UI.hintBtn);
    }
    panel.appendChild(acts); panel.appendChild(UI.fb);
    panel.appendChild(journalBox());

    if (lv.timed) {
      UI.play = h('button', { type: 'button', class: 'btn small', text: '▶ Полёт', onclick: togglePlay });
      UI.slider = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, 'aria-label': 'Время' });
      UI.slider.addEventListener('input', function () { S.playing = false; UI.play.textContent = '▶ Полёт'; S.t = Number(UI.slider.value); refreshFields(); sfx.tick(); });
      UI.stage.appendChild(h('div', { class: 'bar-under' }, UI.play, span('num', '0'), UI.slider, span('num', '100')));
    }
    crumbs(['Кукловод', CH[ci].title, lv.title]);
  }

  /* ---------- шапка, главная, главы ---------- */
  function updateBar() { var t = totalStars(); document.getElementById('total').textContent = '★ ' + t.s + ' / ' + t.max; }
  function crumbs(parts) {
    var box = document.getElementById('crumbs'); clear(box);
    parts.forEach(function (p, i) { if (i) box.appendChild(h('span', { class: 'sep', text: '›' })); box.appendChild(i === parts.length - 1 ? h('b', { text: p }) : h('span', { text: p })); });
  }

  function heroArt(side) {
    var dpr = window.devicePixelRatio || 1, cv = h('canvas', { width: side * dpr, height: side * dpr, 'aria-hidden': 'true' });
    cv.style.width = side + 'px'; cv.style.height = side + 'px';
    var c = cv.getContext('2d'); c.scale(dpr, dpr);
    var V = makeView(side), vals = Object.assign({}, L.NEUTRAL, { 'armR.x2': 82, 'armR.y2': 75, 'armL.x2': 22, 'armL.y2': 62, 'legR.x2': 78, 'legL.x2': 30 });
    drawStage(c, V, 0); drawStrings(c, V, vals, ORDER); drawPuppet(c, V, vals, ORDER, {});
    return cv;
  }

  function showHome() {
    S.screen = 'home'; ST = null; UI = {}; S.playing = false;
    crumbs(['Главное меню']);
    var cards = h('div', { class: 'cards' });
    CH.forEach(function (c, ci) {
      var dots = h('span', { class: 'dots' });
      c.levels.forEach(function (_, li) { var p = P.prog[keyOf(ci, li)]; dots.appendChild(h('span', { class: 'dot' + (p ? ' done' : ''), title: p ? p.stars + ' из 3' : 'Не пройден', text: p ? '★' : String(li + 1) })); });
      cards.appendChild(h('button', { type: 'button', class: 'card', onclick: function () { var first = 0; for (var i = 0; i < c.levels.length; i++) { if (!P.prog[keyOf(ci, i)]) { first = i; break; } } startLevel(ci, first); } },
        h('span', { class: 'n', text: 'ГЛАВА ' + (ci + 1) }), h('h3', { text: c.title }), h('span', { class: 'sub', text: c.sub }), dots));
    });
    var text = h('div', null, h('h1', { text: 'Кукловод' }),
      h('p', null, 'Ты управляешь куклой-человечком. Каждая её часть — это числа, ', h('b', { text: 'такие же, как в блоках «Фильма»' }), '. Меняй числа, смотри, как двигается кукла, собери ей позу, а потом оживи.'));
    clear(app); app.appendChild(h('div', { class: 'home' }, h('div', { class: 'hero' }, heroArt(300), text), cards,
      h('p', { class: 'note', text: 'Игра рассчитана на урок. Главы лучше проходить по очереди. Прогресс хранится только пока открыта вкладка.' })));
    updateBar();
  }
  function showChapters() { showHome(); }

  /* ---------- запуск ---------- */
  document.getElementById('brand').addEventListener('click', showHome);
  document.getElementById('snd').addEventListener('click', function (e) {
    sound = !sound; e.currentTarget.setAttribute('aria-pressed', String(sound)); e.currentTarget.textContent = sound ? 'Звук включён' : 'Звук выключен'; if (sound) sfx.click();
  });
  updateBar();
  showHome();
  requestAnimationFrame(frame);
})();
