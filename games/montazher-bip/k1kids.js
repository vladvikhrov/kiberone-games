/* Общее ядро детских игр K1 (6–8 лет). Копия лежит в каждой игре, правьте здесь
   и копируйте: см. docs/tasks/igry-mladshie-ii.md, раздел 8.

   Что даёт:
   - верхняя полоса со знаком K1 (5 кликов = режим тьютора), звёздами и кнопками «Меню» и «Звук»;
   - теория, которую нельзя пропустить: кадр идёт dur мс, только потом кнопка «Дальше»;
   - меню режимов, звёзды в sessionStorage, окно итога уровня и режима;
   - звук без файлов: эффекты, «голоса» героев (бормотание слогами), музыка по настроению;
   - K1.say (голос системы) есть, но в играх не вызывается: синтезатор читает плохо;
   - робот Бип (SVG). */
(function(){
"use strict";
const K1 = window.K1 = {};
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
K1.el = el; K1.$ = $;
K1.shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
K1.sleep = ms => new Promise(r => setTimeout(r, ms));
/* Отложенное действие внутри кадра: не сработает, если кадр уже сменился. */
K1.later = (box, ms, fn) => setTimeout(() => { if (box.isConnected) fn(); }, ms);
K1.esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- Хранилище ---------- */
let GAME = null;
const KEY = () => "k1kids:" + GAME.id;
function load(){ try { return JSON.parse(sessionStorage.getItem(KEY())) || {}; } catch (e) { return {}; } }
function save(s){ try { sessionStorage.setItem(KEY(), JSON.stringify(s)); } catch (e) {} }
K1.state = () => load();
K1.setStars = (mode, level, stars) => {
  const s = load(); s.stars = s.stars || {}; s.stars[mode] = s.stars[mode] || {};
  s.stars[mode][level] = Math.max(stars, s.stars[mode][level] || 0); save(s); updTotal();
};
K1.modeStars = mode => { const m = (load().stars || {})[mode] || {}; return Object.values(m).reduce((a, b) => a + b, 0); };
function totalStars(){ const st = load().stars || {}; let t = 0; for (const m in st) for (const l in st[m]) t += st[m][l]; return t; }

/* ---------- Иконки ---------- */
const ICON = {
  star: f => `<svg viewBox="0 0 24 24"><path d="M12 1.8l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.6l-6.3 3.6 1.5-7.1L1.8 9.2 9 8.4z" fill="${f ? "#F2B705" : "#fff"}" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.4"><path d="M3 11l9-8 9 8"/><path d="M5 10v11h14V10"/></svg>`,
  sound: `<svg viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.4"><path d="M3 9h4l5-4v14l-5-4H3z" fill="#111"/><path class="wave" d="M16 8c2 2 2 6 0 8M19 5c4 4 4 10 0 14"/></svg>`,
  next: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12h13M12 5l7 7-7 7"/></svg>`,
  again: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 3v5h5"/></svg>`,
  play: `<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z" fill="currentColor"/></svg>`,
  replay: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z" fill="currentColor"/></svg>`,
  ok: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4"><path d="M4 13l5 5L20 6"/></svg>`,
  skip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M4 5l8 7-8 7zM13 5l8 7-8 7z"/></svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H3zM21 5h-7a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h7z"/></svg>`,
};
K1.ICON = ICON;
K1.starsHTML = (n, max = 3, big) => `<span class="k1-stars${big ? " big" : ""}">${Array.from({ length: max }, (_, i) => ICON.star(i < n)).join("")}</span>`;

/* ---------- Робот Бип ---------- */
K1.bip = (size = 180, cls = "bounce", color = "#4FA3FF") =>
`<svg class="bip ${cls}" width="${size}" height="${size * 1.15}" viewBox="0 0 100 115">
  <line x1="50" y1="4" x2="50" y2="18" stroke="#111" stroke-width="3"/>
  <circle class="bulb" cx="50" cy="6" r="6" fill="#FFE27A" stroke="#111" stroke-width="2.5"/>
  <rect x="14" y="18" width="72" height="56" fill="${color}" stroke="#111" stroke-width="3"/>
  <rect x="24" y="28" width="52" height="36" fill="#173049" stroke="#111" stroke-width="2"/>
  <rect class="eye" x="33" y="35" width="10" height="12" fill="#7CF0FF"/>
  <rect class="eye" x="57" y="35" width="10" height="12" fill="#7CF0FF"/>
  <rect class="mouth" x="40" y="53" width="20" height="5" fill="#7CF0FF"/>
  <rect x="6" y="36" width="8" height="18" fill="${color}" stroke="#111" stroke-width="2.5"/>
  <rect x="86" y="36" width="8" height="18" fill="${color}" stroke="#111" stroke-width="2.5"/>
  <rect x="26" y="76" width="48" height="28" fill="${color}" stroke="#111" stroke-width="3"/>
  <rect x="40" y="84" width="20" height="10" fill="#FFE27A" stroke="#111" stroke-width="2"/>
  <rect x="28" y="104" width="14" height="9" fill="#111"/><rect x="58" y="104" width="14" height="9" fill="#111"/>
</svg>`;
K1.bipMood = (root, mood) => { const b = (root || document).querySelector(".bip"); if (!b) return; b.classList.remove("bounce", "talk", "think", "happy", "sad"); void b.offsetWidth; if (mood) mood.split(" ").forEach(m => b.classList.add(m)); };

/* ---------- Звук ---------- */
let AC = null, soundOn = true;
try { soundOn = sessionStorage.getItem("k1kids:sound") !== "0"; } catch (e) {}
function ac(){ if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } } if (AC.state === "suspended") AC.resume(); return AC; }
function tone(freq, t0, dur, type = "triangle", vol = .12, dest){
  const c = ac(); if (!c || !soundOn) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + .015);
  g.gain.exponentialRampToValueAtTime(.0005, t0 + dur);
  o.connect(g).connect(dest || c.destination); o.start(t0); o.stop(t0 + dur + .02);
  return o;
}
K1.tone = tone;
K1.sfx = name => {
  const c = ac(); if (!c || !soundOn) return; const t = c.currentTime;
  const S = {
    click: () => tone(660, t, .06, "square", .05),
    pop:   () => { tone(520, t, .08, "sine", .14); tone(880, t + .05, .1, "sine", .1); },
    ok:    () => { tone(660, t, .12); tone(880, t + .1, .12); tone(1320, t + .2, .25); },
    bad:   () => { tone(300, t, .18, "sawtooth", .07); tone(220, t + .15, .3, "sawtooth", .07); },
    win:   () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, t + i * .11, .25, "triangle", .12)),
    whoosh:() => { const o = tone(200, t, .35, "sine", .08); if (o) o.frequency.exponentialRampToValueAtTime(1400, t + .3); },
    magic: () => [880, 1175, 1568, 1760, 2349].forEach((f, i) => tone(f, t + i * .07, .3, "sine", .06)),
    think: () => [440, 494, 440, 523].forEach((f, i) => tone(f, t + i * .12, .1, "square", .04)),
  };
  (S[name] || S.click)();
};

/* «Голос» героя: бормотание по слогам. voice = {pitch: Гц, speed: 0.5–2, wave, wobble} */
K1.babble = (text, voice = {}) => {
  const c = ac(); if (!c || !soundOn) return Promise.resolve();
  const syl = (String(text).toLowerCase().match(/[^аеёиоуыэюяaeiou]*[аеёиоуыэюяaeiou]/g) || ["а"]).slice(0, 24);
  const base = voice.pitch || 220, sp = voice.speed || 1, wave = voice.wave || "triangle", wob = voice.wobble ?? .12;
  const step = .16 / sp; let t = c.currentTime + .05;
  const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = voice.bright || 1800; f.connect(c.destination);
  syl.forEach((s, i) => {
    const p = base * (1 + (Math.sin(i * 1.7) * wob)) * (/[ияюеё]/.test(s) ? 1.15 : /[уыо]/.test(s) ? .9 : 1);
    tone(p, t, step * .9, wave, .16, f);
    t += step * (s.length > 3 ? 1.25 : 1);
  });
  return K1.sleep((t - c.currentTime) * 1000);
};

/* Музыка по настроению, возвращает функцию «стоп». */
const MOODS = {
  happy:  { bpm: 150, wave: "triangle", notes: [60, 64, 67, 72, 67, 64, 65, 69, 72, 69, 67, 64], bass: [48, 48, 53, 53, 55, 55, 48, 48] },
  sad:    { bpm: 70,  wave: "sine",     notes: [69, 72, 76, 74, 72, 71, 69, 64], bass: [45, 45, 41, 41, 43, 43, 40, 40] },
  scary:  { bpm: 90,  wave: "sawtooth", notes: [45, 46, 45, 46, 45, 51, 50, 49], bass: [33, 33, 34, 34], vol: .05 },
  hero:   { bpm: 130, wave: "square",   notes: [62, 62, 69, 69, 71, 69, 66, 74], bass: [50, 50, 57, 57], vol: .05 },
  sleepy: { bpm: 60,  wave: "sine",     notes: [72, 69, 67, 64, 67, 69, 64, 62], bass: [48, 45, 41, 43] },
  space:  { bpm: 100, wave: "sine",     notes: [72, 79, 84, 79, 76, 83, 88, 83], bass: [36, 43, 40, 47] },
};
K1.MOODS = Object.keys(MOODS);
const midi = n => 440 * Math.pow(2, (n - 69) / 12);
K1.music = (mood, loops = 99) => {
  const m = MOODS[mood] || MOODS.happy; const c = ac(); let stop = false, timer = 0;
  if (!c) return () => {};
  const beat = 60 / m.bpm; let i = 0, t = c.currentTime + .05, n = 0;
  const vol = m.vol || .1;
  function sched(){
    if (stop) return;
    while (t < c.currentTime + .3) {
      tone(midi(m.notes[i % m.notes.length]), t, beat * .95, m.wave, vol);
      if (i % 2 === 0) tone(midi(m.bass[(i / 2 | 0) % m.bass.length]), t, beat * 1.9, "triangle", vol * .9);
      t += beat; i++; if (i % m.notes.length === 0 && ++n >= loops) { stop = true; break; }
    }
    timer = setTimeout(sched, 80);
  }
  sched();
  return () => { stop = true; clearTimeout(timer); };
};

/* Озвучка голосом Windows: только если найден русский голос. */
let ruVoice = null;
function findVoice(){ try { ruVoice = speechSynthesis.getVoices().find(v => /^ru/i.test(v.lang)) || null; } catch (e) {} }
try { findVoice(); speechSynthesis.onvoiceschanged = findVoice; } catch (e) {}
K1.say = text => new Promise(res => {
  if (!soundOn || !ruVoice || !text) return res();
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.voice = ruVoice; u.lang = ruVoice.lang; u.rate = .95; u.pitch = 1.1;
    u.onend = u.onerror = () => res(); speechSynthesis.speak(u);
    setTimeout(res, 15000);
  } catch (e) { res(); }
});
K1.hush = () => { try { speechSynthesis.cancel(); } catch (e) {} };

/* ---------- Каркас ---------- */
let stage, musicStop = null;
K1.tutor = false;
K1.k = 1;
K1.stage = () => stage;
K1.clear = () => { K1.hush(); if (musicStop) { musicStop(); musicStop = null; } stage.innerHTML = ""; return stage; };
let musicGen = 0;
K1.bgMusic = mood => { musicGen++; if (musicStop) musicStop(); musicStop = mood ? K1.music(mood) : null; };

/* Прослушивание с задержкой. Пока звук играет и ещё K1.COOL мс после, новые нажатия
   «Слушать» не срабатывают: дети спамили кнопкой и мешали себе и соседям.
   Кнопки с классом k1-listen на это время бледнеют. */
K1.COOL = 1500;
let listenBusy = false;
K1.listen = async fn => {
  if (listenBusy) { document.querySelectorAll(".k1-listen").forEach(b => { b.classList.remove("k1-nope"); void b.offsetWidth; b.classList.add("k1-nope"); }); return false; }
  listenBusy = true; document.body.classList.add("k1-listening");
  try { await fn(); } catch (e) { console.error(e); }
  setTimeout(() => { listenBusy = false; document.body.classList.remove("k1-listening"); }, K1.COOL);
  return true;
};
/* Кусочек музыки на ms мс. Не глушит музыку, если её уже сменили. */
K1.preview = async (mood, ms = 3500) => {
  K1.bgMusic(mood); const my = musicGen;
  await K1.sleep(ms);
  if (my === musicGen) K1.bgMusic(null);
};
function updTotal(){ const t = $(".k1-total span"); if (t) t.textContent = totalStars(); }

K1.init = game => {
  GAME = game;
  document.title = game.title;
  const top = el("div", "k1-top",
    `<button class="k1-logo" title="K1">K1</button><div class="k1-title">${K1.esc(game.title)}</div>
     <div class="k1-tutor">ТЬЮТОР</div>
     <div class="k1-total">${ICON.star(1).replace("<svg", '<svg width="34" height="34"')}<span>0</span></div>
     <button class="k1-icon" data-a="sound" title="Звук">${ICON.sound}</button>
     <button class="k1-icon" data-a="home" title="Меню">${ICON.home}</button>`);
  document.body.append(top);
  /* Сцена свёрстана под 1366×704 и растягивается под экран (1920×1080 в классе). */
  const fit = () => { K1.k = Math.max(.6, Math.min(innerWidth / 1366, (innerHeight - 64) / 704)); document.documentElement.style.setProperty("--k", K1.k.toFixed(3)); };
  fit(); addEventListener("resize", fit);
  stage = el("div", "k1-stage"); document.body.append(stage);
  updTotal();
  const snd = $('[data-a="sound"]'); snd.classList.toggle("off", !soundOn);
  snd.onclick = () => { soundOn = !soundOn; snd.classList.toggle("off", !soundOn); try { sessionStorage.setItem("k1kids:sound", soundOn ? "1" : "0"); } catch (e) {} if (!soundOn) { K1.hush(); K1.bgMusic(null); } };
  $('[data-a="home"]').onclick = () => { K1.sfx("click"); K1.menu(); };
  let clicks = 0, ct = 0;
  $(".k1-logo").onclick = () => { clicks++; clearTimeout(ct); ct = setTimeout(() => clicks = 0, 1500);
    if (clicks >= 5) { clicks = 0; K1.tutor = !K1.tutor; document.body.classList.toggle("tutor", K1.tutor); K1.sfx(K1.tutor ? "magic" : "click");
      document.querySelectorAll(".k1-wait").forEach(b => { if (K1.tutor) b.disabled = false; }); } };
  document.addEventListener("pointerdown", () => ac(), { once: true });

  const s = load();
  const wanted = new URLSearchParams(location.search).get("mode");
  K1.startMode = game.modes.find(m => m.id === wanted) || null;
  if (s.theoryDone) K1.startMode ? K1.runMode(K1.startMode) : K1.menu();
  else K1.welcome();
};

/* Первый экран: нужен клик, чтобы браузер разрешил звук. */
K1.welcome = () => {
  const st = K1.clear();
  st.append(el("div", "k1-row anim-fade", `${K1.bip(220)}<div class="k1-plate" style="padding:26px 34px;max-width:620px">
    <div style="font:800 46px/1.1 Bahnschrift,'Segoe UI',sans-serif">${K1.esc(GAME.title)}</div>
    <div style="margin-top:10px;font-size:26px;color:var(--muted)">${K1.esc(GAME.hello || "")}</div></div>`));
  const b = el("button", "k1-btn main anim-pulse", `${ICON.play} Начать`);
  b.onclick = () => { ac(); K1.sfx("pop"); K1.theory(GAME.theory, () => { const s = load(); s.theoryDone = 1; save(s); K1.startMode ? K1.runMode(K1.startMode) : K1.menu(); }); };
  st.append(b);
};

/* Теория. frames: [{caption, say, dur, scene(box)}]. Кнопка «Дальше» ждёт dur мс и конца озвучки. */
K1.theory = (frames, done, opts = {}) => {
  let i = 0;
  const st = K1.clear();
  let box = el("div", "k1-theory k1-plate");
  const cap = el("div", "k1-caption");
  const dots = el("div", "k1-dots", frames.map(() => "<i></i>").join(""));
  const again = el("button", "k1-btn", `${ICON.replay}`); again.title = "Ещё раз";
  const next = el("button", "k1-btn main k1-wait", `Дальше ${ICON.next}<span class="fill"></span>`);
  const row = el("div", "k1-row"); row.append(dots, again, next);
  st.append(box, cap, row);
  let token = 0;
  async function show(){
    const f = frames[i], my = ++token;
    [...dots.children].forEach((d, k) => d.className = k < i ? "done" : k === i ? "on" : "");
    K1.bgMusic(null); K1.hush();
    const nb = box.cloneNode(false); box.replaceWith(nb); box = nb; // свежая коробка: таймеры прошлого кадра её не найдут
    cap.textContent = f.caption || ""; cap.classList.remove("anim-fade"); void cap.offsetWidth; cap.classList.add("anim-fade");
    next.disabled = !K1.tutor;
    const dur = f.dur || 6000;
    const fill = next.querySelector(".fill");
    fill.style.transition = "none"; fill.style.transform = "scaleX(0)"; void fill.offsetWidth;
    fill.style.transition = `transform ${dur}ms linear`; fill.style.transform = "scaleX(1)";
    try { f.scene && f.scene(box); } catch (e) { console.error(e); }
    await K1.sleep(dur); // голос Windows/Linux читает плохо и не попадает в кадр: подписи читает тьютор
    if (my !== token) return;
    next.disabled = false; K1.sfx("pop");
  }
  again.onclick = () => { K1.sfx("click"); show(); };
  next.onclick = () => { if (next.disabled) return; K1.sfx("click"); K1.hush(); if (++i < frames.length) show(); else done(); };
  show();
};

/* Меню режимов */
K1.menu = () => {
  const st = K1.clear();
  const wrap = el("div", "k1-modes");
  GAME.modes.forEach(m => {
    const b = el("button", "k1-mode anim-fly",
      `<div class="pic anim-float">${m.pic}</div><div class="name">${K1.esc(m.title)}</div>
       <div class="about">${K1.esc(m.about || "")}</div>${K1.starsHTML(Math.round(K1.modeStars(m.id) / Math.max(1, m.levels) ), 3)}`);
    b.style.animationDelay = GAME.modes.indexOf(m) * .1 + "s";
    b.onclick = () => { K1.sfx("pop"); K1.runMode(m); };
    wrap.append(b);
  });
  const th = el("button", "k1-btn", `${ICON.book} Теория`);
  th.onclick = () => K1.theory(GAME.theory, K1.menu);
  st.append(wrap, th);
};

K1.runMode = m => {
  const go = () => { K1.clear(); m.run(K1.stage()); };
  const s = load(); s.seen = s.seen || {};
  if (m.intro && !s.seen[m.id]) K1.theory(m.intro, () => { const s2 = load(); s2.seen = s2.seen || {}; s2.seen[m.id] = 1; save(s2); go(); });
  else go();
};

/* Полоска уровней сверху сцены */
K1.levelBar = (n, i) => el("div", "k1-dots", Array.from({ length: n }, (_, k) => `<i class="${k < i ? "done" : k === i ? "on" : ""}"></i>`).join(""));

/* Окно итога уровня. Возвращает промис с действием: "next" | "again". */
K1.result = ({ stars = 3, title, sub, again = true, nextText = "Дальше" }) => new Promise(res => {
  if (stars > 0) K1.sfx("win"); else K1.sfx("bad");
  const v = el("div", "k1-veil anim-fade");
  const c = el("div", "k1-card k1-plate anim-pop",
    `${K1.bip(120, stars > 0 ? "happy" : "sad")}<h2>${K1.esc(title || (stars > 0 ? "Получилось!" : "Почти!"))}</h2>
     ${sub ? `<div style="font-size:24px;text-align:center;max-width:620px">${sub}</div>` : ""}
     ${stars > 0 ? K1.starsHTML(stars, 3, true) : ""}`);
  const r = el("div", "k1-row");
  if (again) { const a = el("button", "k1-btn", `${ICON.again} Ещё раз`); a.onclick = () => { v.remove(); res("again"); }; r.append(a); }
  if (stars > 0 || K1.tutor) { const n = el("button", "k1-btn main", `${K1.esc(nextText)} ${ICON.next}`); n.onclick = () => { v.remove(); res("next"); }; r.append(n); }
  c.append(r); const sc = el("div", "k1-scale"); sc.append(c); v.append(sc); document.body.append(v);
});

/* Итог режима */
K1.modeDone = (m, got, max) => {
  const st = K1.clear();
  K1.sfx("win");
  const stars = got >= max * .85 ? 3 : got >= max * .5 ? 2 : 1;
  st.append(el("div", "k1-card k1-plate anim-pop",
    `${K1.bip(150, "happy")}<h2>${K1.esc(m.title)}: пройдено!</h2>${K1.starsHTML(stars, 3, true)}
     <div style="font-size:26px">Звёзд за режим: <b>${got}</b> из ${max}</div>
     <div style="font-size:20px;color:var(--muted)">Покажи экран тьютору</div>`));
  const b = el("button", "k1-btn main", `${ICON.home} В меню`); b.onclick = K1.menu; st.append(b);
};

/* Кнопка тьютора «Пропустить» (видна только в режиме тьютора) */
K1.skipBtn = fn => { const b = el("button", "k1-btn", `${ICON.skip}`); b.title = "Пропустить"; b.style.display = K1.tutor ? "" : "none"; b.onclick = fn; return b; };
})();
