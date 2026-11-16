/* Бип-монтажёр: логика. Тексты и уровни в data.js. */
(function(){
"use strict";
const { el } = K1, V = K1V, D = window.MB;

const stars = tries => tries <= 1 ? 3 : tries === 2 ? 2 : 1;
const label = html => el("div", "v-lab", html);
const S = id => D.stories[id];
const RATIO = {
  wide:   `<svg width="64" height="40" viewBox="0 0 64 40"><rect x="3" y="3" width="58" height="34" fill="#fff" stroke="currentColor" stroke-width="5"/></svg>`,
  square: `<svg width="44" height="44" viewBox="0 0 44 44"><rect x="3" y="3" width="38" height="38" fill="#fff" stroke="currentColor" stroke-width="5"/></svg>`,
};

/* ---------- Теория ---------- */
const SCENES = [
  box => { // 1. Короткие видео
    const row = el("div", "k1-row"); row.style.gap = "26px";
    row.append(el("div", "anim-pop", K1.bip(190, "bounce talk")));
    const grid = el("div", ""); grid.style.cssText = "display:grid;grid-template-columns:repeat(3,auto);gap:16px";
    D.pool.slice(0, 6).forEach((c, i) => { const v = V.clip(c, 230); v.classList.add("anim-pop"); v.style.animationDelay = (.4 + i * .5) + "s"; grid.append(v); K1.later(box, 400 + i * 500, () => K1.sfx("pop")); });
    row.append(grid); box.append(row);
  },
  box => { // 2. Трейлер из лучших кусочков
    const col = el("div", ""); col.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:22px";
    const scr = V.screen(470); col.append(scr);
    const strip = el("div", "k1-row"); strip.style.gap = "10px";
    const picks = [D.pool[0], D.pool[2], D.pool[4]];
    picks.forEach((c, i) => { const v = V.clip(c, 170); v.classList.add("anim-fly"); v.style.animationDelay = i * .4 + "s"; strip.append(v); });
    col.append(strip); box.append(col);
    K1.later(box, 1600, () => V.play(scr, picks, { title: "🎬", each: 1500, mood: "hero" }));
  },
  box => { // 3. По порядку
    const L = S("flower").clips, wrap = el("div", ""); wrap.style.cssText = "position:relative;width:900px;height:220px";
    const pos = [2, 0, 1];
    const cards = L.map((c, i) => { const v = V.clip(c, 260); v.style.cssText += `;position:absolute;top:10px;left:${pos[i] * 300}px;transition:left 1s ease-in-out`; wrap.append(v); return v; });
    const nums = el("div", "k1-row"); nums.style.cssText = "gap:0;width:900px;justify-content:space-around;font:800 54px Bahnschrift,'Segoe UI',sans-serif";
    nums.innerHTML = "<span>1</span><span>2</span><span>3</span>";
    const col = el("div", ""); col.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:10px"; col.append(wrap, nums); box.append(col);
    K1.later(box, 2200, () => { K1.sfx("bad"); cards.forEach(c => c.animate([{ transform: "rotate(-3deg)" }, { transform: "rotate(3deg)" }], { duration: 200, iterations: 4, direction: "alternate" })); });
    K1.later(box, 3600, () => { cards.forEach((c, i) => c.style.left = i * 300 + "px"); K1.sfx("whoosh"); });
    K1.later(box, 4800, () => { cards.forEach(c => c.classList.add("v-found")); K1.sfx("ok"); });
  },
  box => { // 4. Лишнее убираем
    const row = el("div", "k1-row"); row.style.gap = "16px";
    const L = S("cat").clips, odd = S("rocket").clips[0];
    const list = [L[0], L[1], odd, L[2]];
    const cards = list.map(c => { const v = V.clip(c, 250); row.append(v); return v; });
    box.append(row);
    const bad = cards[2];
    K1.later(box, 1500, () => { bad.classList.add("v-hint"); K1.sfx("think"); });
    K1.later(box, 3000, () => {
      K1.sfx("whoosh");
      bad.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(-260px) rotate(25deg) scale(.4)", opacity: 0 }], { duration: 700, fill: "forwards", easing: "ease-in" });
      K1.later(box, 750, () => { bad.style.display = "none"; cards.forEach(c => c !== bad && c.classList.add("v-found")); K1.sfx("ok"); });
    });
  },
  box => { // 5. Музыка — трейлер готов
    const row = el("div", "k1-row"); row.style.gap = "40px";
    const notes = el("div", ""); notes.style.cssText = "position:relative;width:180px;height:300px";
    ["🎵", "🎶", "🎵", "🎶"].forEach((n, i) => { const d = el("div", "anim-float", n); d.style.cssText = `position:absolute;left:${i % 2 * 80}px;top:${i * 70}px;font-size:70px;animation-delay:${i * .3}s`; notes.append(d); });
    const scr = V.screen(560);
    row.append(notes, scr, el("div", "", K1.bip(150, "bounce"))); box.append(row);
    K1.later(box, 800, () => V.play(scr, S("dragon").clips.slice(1), { title: "🐉", each: 1700, end: "СКОРО!", mood: "hero" }));
  },
];
const theory = D.theory.map((f, i) => ({ ...f, scene: SCENES[i] }));
const introScene = mode => box => {
  const row = el("div", "k1-row"); row.style.gap = "40px";
  row.append(el("div", "", K1.bip(190, "bounce talk")));
  const strip = el("div", "k1-row"); strip.style.gap = "12px";
  const list = mode === "cut" ? [S("snowman").clips[0], S("dragon").clips[2], S("snowman").clips[2]]
    : mode === "mine" ? [D.pool[1], D.pool[3], D.pool[6]] : S("chick").clips;
  list.forEach((c, i) => { const v = V.clip(c, 230); v.classList.add("anim-pop"); v.style.animationDelay = i * .5 + "s"; if (mode === "cut" && i === 1) K1.later(box, 2200, () => v.classList.add("v-hint")); strip.append(v); });
  row.append(strip); box.append(row);
};

/* ---------- Монтажный стол: плёнка + кусочки ---------- */
function table({ clips, slots, fixed = [], preset = null, cw = 200, onChange }){
  const order = preset ? preset.slice() : Array(slots).fill(null); fixed.forEach(i => order[i] = i);
  let pool = clips.map((_, i) => i).filter(i => !order.includes(i));
  pool = K1.shuffle(pool);
  if (pool.length > 1 && pool.every((x, i) => i === 0 || x > pool[i - 1])) pool.reverse();
  const strip = el("div", "k1-row"); strip.style.gap = "14px";
  const poolBox = el("div", ""); poolBox.style.cssText = "display:flex;flex-wrap:wrap;gap:18px;justify-content:center;min-height:" + (Math.round(cw * .62) + 12) + "px";
  const t = { order, strip, poolBox, locked: false };
  t.draw = () => {
    strip.innerHTML = "";
    order.forEach((ci, k) => {
      const slot = el("button", "v-slot" + (ci != null ? " full" : "") + (fixed.includes(k) ? " fixed" : ""));
      slot.style.width = cw + 12 + "px"; slot.style.height = Math.round(cw * .62) + 12 + "px";
      slot.append(el("span", "n", k + 1));
      if (ci != null) slot.append(V.clip(clips[ci], cw));
      slot.onclick = () => { if (t.locked || fixed.includes(k) || ci == null) return; K1.sfx("click"); order[k] = null; pool.push(ci); t.draw(); };
      strip.append(slot);
    });
    poolBox.innerHTML = "";
    pool.forEach(ci => {
      const b = el("button", "v-pick anim-pop"); b.append(V.clip(clips[ci], cw));
      if (order.includes(null)) b.onclick = () => {
        if (t.locked) return; const k = order.indexOf(null); if (k < 0) return;
        K1.sfx("pop"); order[k] = ci; pool = pool.filter(x => x !== ci); t.draw();
      };
      else b.style.opacity = .55;
      poolBox.append(b);
    });
    onChange && onChange(t);
  };
  t.back = ks => { ks.forEach(k => { if (order[k] != null) { pool.push(order[k]); order[k] = null; } }); t.draw(); };
  return t;
}

/* ---------- Режим «По порядку» ---------- */
function runOrder(st, m){
  let lv = 0, got = 0;
  function level(){
    const L = D.order[lv], story = S(L.story), n = story.clips.length;
    let tries = 0;
    K1.clear();
    const bar = el("div", "k1-row"); bar.append(K1.levelBar(D.order.length, lv), K1.skipBtn(() => { lv++; next(); }));
    const top = el("div", "k1-row"); top.style.gap = "30px";
    const scr = V.screen(360);
    const go = el("button", "k1-btn main", `${K1.ICON.play} Смотреть`);
    top.append(el("div", "", K1.bip(130, "bounce")), scr, go);
    const t = table({ clips: story.clips, slots: n, fixed: L.fixFirst ? [0] : [], cw: 200,
      onChange: t => { go.disabled = t.locked || t.order.includes(null); go.classList.toggle("anim-pulse", !go.disabled); } });
    st.append(bar, top, label("🎞️ Трейлер:"), t.strip, label("👆 Кусочки:"), t.poolBox);
    go.onclick = async () => {
      if (t.locked || t.order.includes(null)) return;
      t.locked = true; tries++; t.draw();
      await V.play(scr, t.order.map(i => story.clips[i]), { each: 1500, mood: story.mood });
      if (!scr.isConnected) return;
      const ok = t.order.every((ci, k) => ci === k);
      [...t.strip.children].forEach((s, k) => s.classList.add(t.order[k] === k ? "right" : "wrong"));
      if (ok) {
        const s = stars(tries); K1.setStars(m.id, lv, s); got += s;
        await K1.sleep(600);
        const a = await K1.result({ stars: s, sub: "Трейлер по порядку!" });
        if (a === "next") { lv++; next(); } else { got -= s; level(); }
      } else {
        K1.sfx("bad");
        await K1.sleep(1300);
        t.locked = false;
        t.back(t.order.map((ci, k) => ci === k ? -1 : k).filter(k => k >= 0));
      }
    };
    t.draw();
  }
  function next(){ lv < D.order.length ? level() : K1.modeDone(m, got, D.order.length * 3); }
  level();
}

/* ---------- Режим «Лишний кусочек» ---------- */
function runCut(st, m){
  let lv = 0, got = 0;
  function level(){
    const L = D.cut[lv], story = S(L.story);
    const odd = S(L.odd[0]).clips[L.odd[1]];
    const at = 1 + (Math.random() * story.clips.length | 0);
    const list = story.clips.slice(); list.splice(Math.min(at, list.length), 0, odd);
    const oddIdx = list.indexOf(odd);
    let miss = 0, done = false;
    K1.clear();
    const bar = el("div", "k1-row"); bar.append(K1.levelBar(D.cut.length, lv), K1.skipBtn(() => { lv++; next(); }));
    const top = el("div", "k1-row"); top.style.gap = "30px";
    const scr = V.screen(380);
    top.append(el("div", "", K1.bip(130, "bounce")), scr);
    const cw = list.length > 4 ? 220 : 250;
    const row = el("div", "k1-row"); row.style.cssText += ";gap:18px;align-items:flex-start";
    const cards = list.map((c, i) => {
      const col = el("div", ""); col.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:12px";
      const v = V.clip(c, cw);
      const x = el("button", "k1-btn", "✂️"); x.style.cssText += ";font-size:36px;min-height:60px;padding:4px 22px";
      x.onclick = async () => {
        if (done) return;
        if (i === oddIdx) {
          done = true; K1.sfx("whoosh");
          col.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(-240px) rotate(20deg) scale(.4)", opacity: 0 }], { duration: 650, fill: "forwards", easing: "ease-in" });
          await K1.sleep(700); col.style.display = "none";
          cards.forEach((cc, k) => k !== oddIdx && cc.v.classList.add("v-found"));
          const s = miss === 0 ? 3 : miss === 1 ? 2 : 1; K1.setStars(m.id, lv, s); got += s;
          await V.play(scr, story.clips, { each: 1400, mood: story.mood });
          if (!scr.isConnected) return;
          const a = await K1.result({ stars: s, sub: "Лишнего нет!" });
          if (a === "next") { lv++; next(); } else { got -= s; level(); }
        } else {
          miss++; K1.sfx("bad"); v.style.outline = "6px solid var(--bad)"; v.animate([{ transform: "translateX(-8px)" }, { transform: "translateX(8px)" }], { duration: 120, iterations: 4, direction: "alternate" });
          if (miss >= 2) cards[oddIdx].v.classList.add("v-hint");
        }
      };
      col.append(v, x); row.append(col);
      return { col, v };
    });
    st.append(bar, top, label("✂️ Убери лишний кусочек:"), row);
    V.play(scr, list, { each: 1200 });
  }
  function next(){ lv < D.cut.length ? level() : K1.modeDone(m, got, D.cut.length * 3); }
  level();
}

/* ---------- Режим «Мой трейлер» ---------- */
function runMine(st, m){
  const keep = { mood: null, ratio: "wide", order: null };
  function editor(){
    K1.clear();
    const main = el("div", ""); main.style.cssText = "display:flex;gap:34px;align-items:flex-start";
    const left = el("div", ""); left.style.cssText = "display:flex;flex-direction:column;gap:12px;align-items:center";
    const right = el("div", ""); right.style.cssText = "display:flex;flex-direction:column;gap:14px;align-items:flex-start";
    const go = el("button", "k1-btn main", `🎬 Собрать`);
    const t = table({ clips: D.pool, slots: 3, preset: keep.order, cw: 170, onChange: upd });
    left.append(label("🎞️ Трейлер:"), t.strip, label("👆 Кусочки:"), t.poolBox);
    t.poolBox.style.width = "780px";
    const moods = el("div", ""); moods.style.cssText = "display:grid;grid-template-columns:repeat(2,96px);gap:12px";
    D.moods.forEach(md => {
      const b = el("button", "k1-choice k1-listen" + (keep.mood === md.id ? " on" : ""), `<span class="e">${md.e}</span><span class="t">🎵</span>`);
      b.onclick = () => {
        keep.mood = md.id; K1.sfx("click");
        moods.querySelectorAll(".k1-choice").forEach(x => x.classList.toggle("on", x === b));
        K1.listen(() => K1.preview(md.id));
        upd(t);
      };
      moods.append(b);
    });
    const ratios = el("div", "k1-row"); ratios.style.gap = "12px";
    ["wide", "square"].forEach(r => {
      const b = el("button", "k1-choice" + (keep.ratio === r ? " on" : ""), RATIO[r]);
      b.onclick = () => { keep.ratio = r; K1.sfx("click"); ratios.querySelectorAll(".k1-choice").forEach(x => x.classList.toggle("on", x === b)); };
      ratios.append(b);
    });
    right.append(label("🎵 Музыка:"), moods, label("🖥️ Экран:"), ratios, go);
    main.append(left, right); st.append(main);
    function upd(tt){ go.disabled = tt.order.includes(null) || !keep.mood; go.classList.toggle("anim-pulse", !go.disabled); }
    go.onclick = () => { if (go.disabled) return; keep.order = t.order.slice(); exportIt(); };
    t.draw();
  }
  async function exportIt(){
    K1.clear();
    const box = el("div", "k1-plate"); box.style.cssText += ";padding:30px 40px;display:flex;flex-direction:column;align-items:center;gap:20px;width:700px";
    const barOut = el("div", ""); barOut.style.cssText = "width:600px;height:44px;border:3px solid #111;background:#fff;position:relative";
    const fill = el("div", ""); fill.style.cssText = "position:absolute;inset:0;width:0;background:var(--acc)";
    const pct = el("div", "", "0%"); pct.style.cssText = "font:800 40px Bahnschrift,'Segoe UI',sans-serif";
    barOut.append(fill);
    box.append(el("div", "", K1.bip(130, "think")), barOut, pct);
    K1.stage().append(box);
    K1.sfx("think");
    for (let p = 0; p <= 100; p += 4) { if (!box.isConnected) return; fill.style.width = p + "%"; pct.textContent = p + "%"; await K1.sleep(70); }
    K1.sfx("magic");
    watch();
  }
  async function watch(){
    K1.clear();
    const scr = keep.ratio === "square" ? V.screen(560, "square") : V.screen(900);
    K1.stage().append(scr);
    const heroes = keep.order.map(i => { const c = D.pool[i]; return c.hero ? K1W.get("hero", c.hero).e : c.items[0].e; }).join(" ");
    await V.play(scr, keep.order.map(i => D.pool[i]), { title: heroes, each: 2600, end: "СКОРО!", mood: keep.mood });
    if (!scr.isConnected) return;
    K1.setStars(m.id, 0, 3);
    const a = await K1.result({ stars: 3, title: "Трейлер готов!", sub: "Покажи тьютору!", nextText: "Готово" });
    if (a === "next") K1.modeDone(m, 3, 3); else editor();
  }
  editor();
}

const intro = id => [{ ...D.intro[id], scene: introScene(id) }];
K1.init({
  id: "montazher-bip",
  title: D.title, hello: D.hello, theory,
  modes: [
    { id: "order", title: "По порядку",      pic: "🎞️", about: "Склей кусочки по порядку", levels: D.order.length, intro: intro("order"), run(st){ runOrder(st, this); } },
    { id: "cut",   title: "Лишний кусочек",  pic: "✂️", about: "Убери чужой кусочек", levels: D.cut.length, intro: intro("cut"), run(st){ runCut(st, this); } },
    { id: "mine",  title: "Мой трейлер",     pic: "🎬", about: "Кусочки, музыка, экран", levels: 1, intro: intro("mine"), run(st){ runMine(st, this); } },
  ],
});
})();
