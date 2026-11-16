/* Художник Бип: логика. Тексты и уровни в data.js. */
(function(){
"use strict";
const { el } = K1, W = K1W, D = window.BH;
const ALL = ["hero", "place", "time", "weather"];

/* ---------- Теория: сцены ---------- */
const SCENES = [
  box => { // 1. Знакомство
    box.append(el("div", "k1-row anim-pop", K1.bip(260, "bounce talk")));
    K1.later(box, 2500, () => K1.bipMood(box, "bounce"));
  },
  box => { // 2. Миллионы картинок
    const c = el("div", "", K1.bip(200, "think")); c.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2";
    const cnt = el("div", "", "0"); cnt.style.cssText = "position:absolute;right:24px;bottom:16px;font:800 44px Bahnschrift,'Segoe UI',sans-serif;z-index:3";
    box.append(c, cnt);
    const pics = ["🐱","🌲","🚀","🏰","🐶","🌊","🦄","🌙","🍎","🚙","🐉","🌈","🏙️","🦖","⛵","🌵","🐟","☀️","🎈","🐻","🌻","🚂","🐸","❄️"];
    pics.forEach((p, i) => {
      const a = (i / pics.length) * Math.PI * 2, R = 470;
      const x = Math.cos(a) * R, y = Math.sin(a) * R * .5;
      const f = el("div", "", p);
      f.style.cssText = `position:absolute;left:50%;top:50%;width:84px;height:84px;margin:-42px;display:grid;place-items:center;font-size:52px;background:#fff;border:3px solid #111;box-shadow:4px 4px 0 #111;
        transform:translate(${x}px,${y}px)`;
      f.animate([{ transform: `translate(${x}px,${y}px) scale(1)`, opacity: 1 }, { transform: "translate(0,0) scale(.2)", opacity: 0 }],
        { duration: 900, delay: 250 + i * 220, easing: "ease-in", fill: "forwards" });
      box.append(f);
    });
    let n = 0; const t = setInterval(() => { n += 41667; cnt.textContent = Math.min(n, 1000000).toLocaleString("ru-RU"); if (n >= 1000000 || !cnt.isConnected) clearInterval(t); }, 230);
    K1.later(box, 5600, () => K1.sfx("magic"));
  },
  box => { // 3. Запрос
    const row = el("div", "k1-row");
    const b = el("div", "", K1.bip(150, "bounce"));
    const bubble = el("div", "k1-plate", ""); bubble.style.cssText += ";padding:16px;display:flex;gap:10px;min-width:330px;min-height:110px;align-items:center";
    const arrow = el("div", "", `<svg width="80" height="40" viewBox="0 0 80 40"><path d="M4 20h64M52 6l16 14-16 14" stroke="#111" stroke-width="6" fill="none"/></svg>`); arrow.style.opacity = 0;
    const out = el("div", ""); out.style.cssText = "width:366px;height:233px";
    row.append(b, bubble, arrow, out); box.append(row);
    const req = { hero: "cat", place: "forest", time: "night", weather: "clear" };
    ["hero", "place", "time"].forEach((c, i) => K1.later(box, 600 + i * 1000, () => {
      const x = W.get(c, req[c]); const ch = el("div", "k1-choice anim-pop", `<span class="e">${x.e}</span><span class="t">${x.t}</span>`);
      bubble.append(ch); K1.sfx("pop");
    }));
    K1.later(box, 3700, () => { arrow.style.transition = "opacity .4s"; arrow.style.opacity = 1; K1.bipMood(box, "think"); });
    K1.later(box, 4200, () => W.generate(out, req, 360));
  },
  box => { // 4. Из шума
    const row = el("div", "k1-row"); const out = el("div", ""); row.append(el("div", "", K1.bip(160, "think")), out); box.append(row);
    const req = { hero: "dragon", place: "castle", time: "day", weather: "rainbow" };
    out.append(W.noise(560));
    K1.later(box, 700, async () => {
      const n = out.firstChild; for (let i = 0; i < 10 && n.isConnected; i++) { await K1.sleep(160); n.redraw(); }
      if (!out.isConnected) return;
      const s = W.scene(req, 560); s.style.animation = "noise-out 3s ease-out both"; out.innerHTML = ""; out.append(s); K1.sfx("magic");
    });
  },
  box => { // 5. Точный запрос
    const g = el("div", "k1-row"); g.style.gap = "60px";
    const col = (req, cats, delay) => {
      const c = el("div", ""); c.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:14px";
      const chips = el("div", "anim-fly", W.chips(req, cats, 40)); chips.style.animationDelay = delay + "s";
      const out = el("div", ""); out.style.cssText = "width:426px;height:270px";
      c.append(chips, out); K1.later(box, delay * 1000 + 900, () => W.generate(out, req, 420));
      return c;
    };
    g.append(col({ hero: "cat", place: "desert", time: "night", weather: "rain" }, ["hero"], .3),
             col({ hero: "cat", place: "forest", time: "day", weather: "rainbow" }, ALL, 3.6));
    box.append(g);
  },
];
const theory = D.theory.map((f, i) => ({ ...f, scene: SCENES[i] }));
const introScene = mode => box => {
  const row = el("div", "k1-row");
  row.append(el("div", "", K1.bip(200, "bounce talk")));
  const pic = el("div", "anim-pop");
  if (mode === "who") pic.append(W.scene({ hero: "unicorn", place: "space", time: "night", weather: "clear" }, 420));
  else if (mode === "comic") { pic.style.cssText = "display:flex;gap:12px"; [["cat","forest"],["cat","castle"],["cat","sea"]].forEach(([h, p], i) => { const s = W.scene({ hero: h, place: p, time: "day", weather: i === 2 ? "rainbow" : "clear" }, 230); s.style.animation = `pop .5s ${i * .6}s both`; pic.append(s); }); }
  else pic.append(W.scene({ hero: "dog", place: "sea", time: "day", weather: "clear" }, 420));
  row.append(pic); box.append(row);
};

/* ---------- Ряды карточек ---------- */
function rows(cats, sel, onPick, size = 92){
  const wrap = el("div", ""); wrap.style.cssText = "display:flex;flex-direction:column;gap:10px";
  cats.forEach(c => {
    const meta = W.CATS.find(x => x.id === c);
    const r = el("div", ""); r.style.cssText = "display:flex;gap:10px;align-items:center";
    const lab = el("div", "k1-plate", `<div style="font-size:${size * .4}px;line-height:1">${meta.pic}</div><div style="font-size:16px">${meta.title}</div>`);
    lab.style.cssText += `;width:${size + 10}px;height:${size}px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:4px 4px 0 #111;background:#F4F4F4`;
    r.append(lab);
    W[c].forEach(x => {
      const b = el("button", "k1-choice", `<span class="e" style="font-size:${size * .55}px">${x.e}</span><span class="t">${x.t}</span>`);
      b.style.minWidth = b.style.minHeight = size + "px"; b.dataset.cat = c; b.dataset.id = x.id;
      if (sel[c] === x.id) b.classList.add("on");
      b.onclick = () => {
        K1.sfx("click"); sel[c] = x.id;
        r.querySelectorAll(".k1-choice").forEach(y => y.classList.toggle("on", y === b));
        wrap.querySelectorAll(".k1-choice").forEach(y => y.classList.remove("right", "wrong"));
        onPick && onPick();
      };
      r.append(b);
    });
    wrap.append(r);
  });
  return wrap;
}
const ready = (sel, cats) => cats.every(c => sel[c]);
const fill = (sel) => ({ hero: sel.hero || "cat", place: sel.place || "forest", time: sel.time || "day", weather: sel.weather || "clear" });

/* ---------- Режим «Как на картинке» ---------- */
function runMatch(st, m){
  let lv = 0, got = 0;
  function level(){
    const cats = D.match[lv];
    const target = fill(W.random(cats));
    const sel = {}; let tries = 0, busy = false;
    K1.clear();
    const bar = el("div", "k1-row"); bar.append(K1.levelBar(D.match.length, lv), K1.skipBtn(() => { lv++; next(); }));
    const main = el("div", ""); main.style.cssText = "display:flex;gap:28px;align-items:flex-start";
    const left = el("div", ""); left.style.cssText = "display:flex;flex-direction:column;gap:10px";
    const tLab = el("div", "", `<b style="font-size:22px">Нужно:</b>`);
    const tgt = W.scene(target, 400);
    const rLab = el("div", "", `<b style="font-size:22px">Бип нарисовал:</b>`);
    const res = el("div", "", ""); res.style.cssText = "width:406px;height:254px;border:3px dashed #111;display:grid;place-items:center";
    res.innerHTML = K1.bip(110, "bounce");
    left.append(tLab, tgt, rLab, res);
    const right = el("div", ""); right.style.cssText = "display:flex;flex-direction:column;gap:18px;align-items:flex-start";
    const go = el("button", "k1-btn main", `${K1.ICON.play} Нарисуй!`); go.disabled = true;
    const r = rows(cats, sel, () => { go.disabled = busy || !ready(sel, cats); });
    right.append(r, go);
    main.append(left, right);
    st.append(bar, main);
    go.onclick = async () => {
      if (busy) return; busy = true; go.disabled = true; tries++;
      const req = fill(sel);
      await W.generate(res, req, 400);
      const ok = W.same(req, target, cats);
      cats.forEach(c => { const b = r.querySelector(`.k1-choice.on[data-cat="${c}"]`); if (b) b.classList.add(req[c] === target[c] ? "right" : "wrong"); });
      busy = false;
      if (ok) {
        const stars = tries === 1 ? 3 : tries === 2 ? 2 : 1;
        K1.setStars(m.id, lv, stars); got += stars;
        await K1.sleep(500);
        const a = await K1.result({ stars, sub: W.chips(req, cats, 40) });
        if (a === "next") { lv++; next(); } else { got -= stars; level(); }
      } else {
        K1.sfx("bad");
        go.disabled = false;
      }
    };
  }
  function next(){ lv < D.match.length ? level() : K1.modeDone(m, got, D.match.length * 3); }
  level();
}

/* ---------- Режим «Чей запрос?» ---------- */
function runWho(st, m){
  let lv = 0, got = 0;
  function mutate(req, cats, diff){
    const r = { ...req };
    K1.shuffle(cats).slice(0, diff).forEach(c => { const others = W[c].filter(x => x.id !== req[c]); r[c] = others[Math.random() * others.length | 0].id; });
    return r;
  }
  function level(){
    const L = D.who[lv], cats = L.cats;
    const target = fill(W.random(cats));
    const key = r => cats.map(c => r[c]).join("|");
    const opts = [target]; let guard = 0;
    while (opts.length < 3 && guard++ < 100) { const o = mutate(target, cats, L.diff); if (!opts.some(x => key(x) === key(o))) opts.push(o); }
    let tries = 0, done = false;
    K1.clear();
    const bar = el("div", "k1-row"); bar.append(K1.levelBar(D.who.length, lv), K1.skipBtn(() => { lv++; next(); }));
    const main = el("div", ""); main.style.cssText = "display:flex;gap:36px;align-items:center";
    const pic = el("div", ""); pic.style.cssText = "width:566px;height:357px";
    const list = el("div", ""); list.style.cssText = "display:flex;flex-direction:column;gap:22px";
    main.append(pic, list); st.append(bar, main);
    W.generate(pic, target, 560);
    K1.shuffle(opts).forEach(o => {
      const b = el("button", "k1-btn", W.chips(o, cats, 48)); b.style.cssText += ";padding:12px 18px;gap:8px";
      b.onclick = async () => {
        if (done) return;
        tries++;
        if (key(o) === key(target)) {
          done = true; b.style.background = "var(--ok)";
          const stars = tries === 1 ? 3 : tries === 2 ? 2 : 1; K1.setStars(m.id, lv, stars); got += stars;
          await K1.sleep(400);
          const a = await K1.result({ stars, again: false });
          lv++; next();
        } else { K1.sfx("bad"); b.style.background = "var(--bad)"; b.disabled = true; b.style.opacity = .5; }
      };
      list.append(b);
    });
  }
  function next(){ lv < D.who.length ? level() : K1.modeDone(m, got, D.who.length * 3); }
  level();
}

/* ---------- Режим «Мой комикс» ---------- */
function runComic(st, m){
  const frames = [null, null, null]; let cur = 0;
  const sels = [{}, {}, {}];
  function draw(){
    K1.clear();
    const slots = el("div", "k1-row"); slots.style.gap = "16px";
    frames.forEach((f, i) => {
      const s = el("button", "", ""); s.style.cssText = `width:306px;height:196px;padding:0;border:${i === cur ? "5px solid var(--acc)" : "3px solid #111"};background:#fff;display:grid;place-items:center;font:800 70px Bahnschrift,'Segoe UI',sans-serif;box-shadow:6px 6px 0 #111`;
      if (f) { s.innerHTML = ""; const sc = W.scene(f, 294); sc.style.border = "0"; s.append(sc); } else s.textContent = i + 1;
      s.onclick = () => { K1.sfx("click"); cur = i; draw(); };
      slots.append(s);
    });
    const sel = sels[cur];
    const go = el("button", "k1-btn main", `${K1.ICON.play} Нарисуй кадр ${cur + 1}`); go.disabled = !ready(sel, ALL);
    const r = rows(ALL, sel, () => { go.disabled = !ready(sel, ALL); }, 76);
    const btns = el("div", "k1-row"); btns.append(go);
    if (frames.every(Boolean)) { const w = el("button", "k1-btn main anim-pulse", `${K1.ICON.replay} Смотреть комикс`); w.style.background = "var(--ok)"; w.onclick = watch; btns.append(w); }
    st.append(slots, r, btns);
    go.onclick = async () => {
      go.disabled = true;
      const slot = slots.children[cur]; slot.innerHTML = "";
      const req = fill(sel);
      await W.generate(slot, req, 290);
      frames[cur] = req;
      if (cur < 2 && !frames[cur + 1]) cur++;
      else { const empty = frames.findIndex(f => !f); if (empty >= 0) cur = empty; }
      draw();
    };
  }
  async function watch(){
    K1.clear();
    K1.bgMusic("happy");
    const box = el("div", "k1-row"); box.style.gap = "30px";
    const bip = el("div", "", K1.bip(170, "talk"));
    const pic = el("div", ""); box.append(bip, pic); st.append(box);
    const cap = el("div", "k1-caption"); st.append(cap);
    for (let i = 0; i < 3; i++) {
      pic.innerHTML = ""; const s = W.scene(frames[i], 720); s.style.animation = "pop .6s both"; pic.append(s);
      cap.textContent = D.comicLines[i];
      K1.bipMood(bip, "talk");
      await K1.babble(D.comicLines[i], W.get("hero", frames[i].hero).voice);
      await K1.sleep(1800);
    }
    K1.bgMusic(null);
    K1.setStars(m.id, 0, 3);
    K1.modeDone(m, 3, 3);
  }
  draw();
}

const intro = id => [{ ...D.intro[id], scene: introScene(id) }];
K1.init({
  id: "bip-hudozhnik",
  title: D.title, hello: D.hello, theory,
  modes: [
    { id: "match", title: "Как на картинке", pic: "🖼️", about: "Собери такой же запрос", levels: D.match.length, intro: intro("match"), run(st){ runMatch(st, this); } },
    { id: "who",   title: "Чей запрос?",     pic: "🔍", about: "Какой запрос нарисовал?", levels: D.who.length, intro: intro("who"), run(st){ runWho(st, this); } },
    { id: "comic", title: "Мой комикс",      pic: "📖", about: "Три картинки — история", levels: 1, intro: intro("comic"), run(st){ runComic(st, this); } },
  ],
});
})();
