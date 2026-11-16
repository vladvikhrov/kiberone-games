/* Оживи картинку: логика. Тексты и уровни в data.js. */
(function(){
"use strict";
const { el } = K1, W = K1W, V = K1V, D = window.OK;

const stars = tries => tries <= 1 ? 3 : tries === 2 ? 2 : 1;
const center = (node, css) => { node.style.cssText += ";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)" + (css ? ";" + css : ""); return node; };
const label = (html) => el("div", "v-lab", html);

/* ---------- Теория ---------- */
const SCENES = [
  box => { // 1. Бип и картинка
    const row = el("div", "k1-row"); row.style.gap = "40px";
    row.append(el("div", "anim-pop", K1.bip(240, "bounce talk")));
    const pic = V.clip({ hero: "cat", place: "forest", move: "jump" }, 460, { paused: true });
    pic.classList.add("anim-pop"); pic.style.animationDelay = ".6s";
    row.append(pic); box.append(row);
    K1.later(box, 3200, () => { pic.classList.remove("v-paused"); K1.sfx("magic"); K1.bipMood(box, "happy"); });
  },
  box => { // 2. Картинка стоит, видео двигается
    const row = el("div", "k1-row"); row.style.gap = "60px";
    const col = (node, mark, delay) => {
      const c = el("div", "anim-fly"); c.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:14px;animation-delay:${delay}s`;
      c.append(node, el("div", "", `<span style="font:800 64px Bahnschrift,'Segoe UI',sans-serif">${mark}</span>`)); return c;
    };
    const req = { hero: "dog", place: "sea", move: "run", fx: "birds" };
    row.append(col(V.clip(req, 440, { paused: true }), "⏸", .2), col(V.clip(req, 440), "▶", 1.8));
    box.append(row);
    K1.later(box, 1900, () => K1.sfx("whoosh"));
  },
  box => { // 3. Много картинок подряд
    const L = D.frames[0];
    const row = el("div", "k1-row"); row.style.gap = "20px";
    const cards = L.frames.map((f, i) => {
      const c = V.clip({ place: L.place, items: f.items }, 250, { paused: true });
      c.classList.add("anim-pop"); c.style.animationDelay = (.3 + i * .7) + "s";
      row.append(c); return c;
    });
    box.append(row);
    L.frames.forEach((f, i) => K1.later(box, 300 + i * 700, () => K1.sfx("pop")));
    K1.later(box, 3400, async () => {
      cards.forEach((c, i) => c.animate([{ transform: "none" }, { transform: `translateX(${(1 - i) * 270}px) scale(1.5)` }], { duration: 600, fill: "forwards", easing: "ease-in" }));
      await K1.sleep(650); if (!box.isConnected) return;
      row.remove();
      const scr = V.screen(470); center(scr); box.append(scr);
      const order = [0, 1, 2, 1];
      for (let k = 0; k < 18 && box.isConnected; k++) {
        const f = L.frames[order[k % 4]];
        scr.innerHTML = ""; const c = V.clip({ place: L.place, items: f.items }, 470, { paused: true }); c.style.border = "0"; scr.append(c);
        if (k % 4 === 0) K1.sfx("click");
        await K1.sleep(220);
      }
    });
  },
  box => { // 4. Бип рисует новые кадры
    const row = el("div", "k1-row"); row.style.gap = "40px";
    const out = el("div", ""); row.append(el("div", "", K1.bip(170, "think")), out); box.append(row);
    const req = { hero: "unicorn", place: "castle", weather: "rainbow", move: "jump", fx: "spark" };
    out.append(V.clip(req, 600, { paused: true }));
    K1.later(box, 1300, async () => { await V.animate(out, req, 600); K1.bipMood(box, "happy"); });
  },
  box => { // 5. Запрос на движение
    const row = el("div", "k1-row"); row.style.gap = "30px";
    const chips = el("div", ""); chips.style.cssText = "display:flex;flex-direction:column;gap:12px;min-width:150px";
    const out = el("div", ""); out.style.cssText = "width:566px;height:357px";
    row.append(chips, out); box.append(row);
    const base = { hero: "dino", place: "desert" };
    out.append(V.clip(base, 560, { paused: true }));
    ["jump", "run", "spin"].forEach((m, i) => K1.later(box, 600 + i * 2500, () => {
      const x = V.get("move", m);
      chips.querySelectorAll(".k1-choice").forEach(c => c.classList.remove("on"));
      const ch = el("div", "k1-choice on anim-pop", `<span class="e">${x.e}</span><span class="t">${x.t}</span>`); chips.append(ch);
      K1.sfx("pop");
      out.innerHTML = ""; out.append(V.clip({ ...base, move: m }, 560));
    }));
  },
  box => { // 6. Ошибка в видео
    const row = el("div", "k1-row"); row.style.gap = "30px";
    const clip = V.clip({ hero: "cat", place: "forest", move: "jump" }, 620);
    row.append(el("div", "", K1.bip(150, "bounce")), clip); box.append(row);
    K1.later(box, 2200, () => {
      const s = clip.querySelector(".k1w-scene"), hero = s.querySelector('[data-role="hero"]');
      const twin = hero.cloneNode(true); twin.style.left = "16%"; twin.style.marginLeft = "0"; s.append(twin);
      twin.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500 }); K1.sfx("bad"); K1.bipMood(box, "sad");
      K1.later(box, 1600, () => { twin.classList.add("v-found"); K1.sfx("ok"); K1.bipMood(box, "happy"); });
    });
  },
];
const theory = D.theory.map((f, i) => ({ ...f, scene: SCENES[i] }));
const introScene = mode => box => {
  const row = el("div", "k1-row"); row.style.gap = "40px";
  row.append(el("div", "", K1.bip(190, "bounce talk")));
  if (mode === "frames") {
    const L = D.frames[2], strip = el("div", "k1-row"); strip.style.gap = "10px";
    L.frames.forEach((f, i) => { const c = V.clip({ place: L.place, items: f.items }, 170, { paused: true }); c.classList.add("anim-pop"); c.style.animationDelay = i * .5 + "s"; strip.append(c); });
    row.append(strip);
  } else if (mode === "glitch") {
    row.append(V.clip({ hero: "dog", place: "city", move: "run" }, 480));
  } else {
    const col = el("div", ""); col.style.cssText = "display:flex;gap:16px;align-items:center";
    col.append(V.clip({ hero: "car", place: "city", move: "jump", cam: "zoom" }, 460),
      el("div", "anim-fly", `<div style="display:flex;flex-direction:column;gap:10px">${["⬆️", "🔍"].map(e => `<span style="display:inline-grid;place-items:center;width:84px;height:84px;border:3px solid #111;background:#fff;font-size:54px">${e}</span>`).join("")}</div>`));
    row.append(col);
  }
  box.append(row);
};

/* ---------- Режим «Как в мультике» ---------- */
function runMatch(st, m){
  let lv = 0, got = 0;
  function level(){
    const cats = D.match[lv];
    const base = { hero: W.hero[Math.random() * W.hero.length | 0].id, place: W.place[Math.random() * W.place.length | 0].id, time: Math.random() < .25 ? "night" : "day", weather: "clear" };
    const target = { cam: "still", ...V.random(cats) };
    const sel = {}; let tries = 0, busy = false;
    K1.clear();
    const bar = el("div", "k1-row"); bar.append(K1.levelBar(D.match.length, lv), K1.skipBtn(() => { lv++; next(); }));
    const main = el("div", ""); main.style.cssText = "display:flex;gap:30px;align-items:flex-start";
    const left = el("div", ""); left.style.cssText = "display:flex;flex-direction:column;gap:8px";
    const res = el("div", ""); res.style.cssText = "width:406px;height:254px;border:3px dashed #111;display:grid;place-items:center;background:rgba(255,255,255,.5)";
    res.append(V.clip(base, 394, { paused: true }));
    left.append(label("🎯 Нужно:"), V.clip({ ...base, ...target }, 400), label(`${K1.ICON.play.replace("<svg", '<svg width="22" height="22"')} Бип оживил:`), res);
    const right = el("div", ""); right.style.cssText = "display:flex;flex-direction:column;gap:20px;align-items:flex-start;padding-top:30px";
    const go = el("button", "k1-btn main", `${K1.ICON.play} Оживи!`); go.disabled = true;
    const r = V.rows(cats, sel, () => { go.disabled = busy || !cats.every(c => sel[c]); });
    right.append(r, go);
    main.append(left, right);
    st.append(bar, main);
    go.onclick = async () => {
      if (busy) return; busy = true; go.disabled = true; tries++;
      const req = { ...base, cam: "still", ...sel };
      await V.animate(res, req, 400);
      if (!res.isConnected) return;
      const ok = V.same(req, { cam: "still", ...target }, cats);
      cats.forEach(c => { const b = r.querySelector(`.k1-choice.on[data-cat="${c}"]`); if (b) b.classList.add(req[c] === target[c] ? "right" : "wrong"); });
      busy = false;
      if (ok) {
        const s = stars(tries); K1.setStars(m.id, lv, s); got += s;
        await K1.sleep(900);
        const chips = cats.map(c => { const x = V.get(c, req[c]); return `<span style="display:inline-grid;place-items:center;width:64px;height:64px;border:2px solid #111;background:#fff;font-size:44px;margin:0 4px">${x.e}</span>`; }).join("");
        const a = await K1.result({ stars: s, sub: chips });
        if (a === "next") { lv++; next(); } else { got -= s; level(); }
      } else {
        K1.sfx("bad");
        go.disabled = false;
      }
    };
  }
  function next(){ lv < D.match.length ? level() : K1.modeDone(m, got, D.match.length * 3); }
  level();
}

/* ---------- Режим «Кадры» ---------- */
function runFrames(st, m){
  let lv = 0, got = 0;
  function level(){
    const L = D.frames[lv], n = L.frames.length;
    const fw = n > 4 ? 180 : 190;
    const frameReq = i => ({ place: L.place, weather: L.weather, noSun: L.noSun, sky: L.frames[i].sky, items: L.frames[i].items });
    const order = Array(n).fill(null); order[0] = 0;
    let pool = K1.shuffle([...Array(n).keys()].slice(1));
    if (pool.length > 1 && pool.every((x, i) => x === i + 1)) pool.reverse();
    let tries = 0, busy = false;
    K1.clear();
    const bar = el("div", "k1-row"); bar.append(K1.levelBar(D.frames.length, lv), K1.skipBtn(() => { lv++; next(); }));
    const top = el("div", "k1-row"); top.style.gap = "30px";
    const scr = V.screen(340);
    const go = el("button", "k1-btn main", `${K1.ICON.play} Смотреть`);
    top.append(el("div", "", K1.bip(130, "bounce")), scr, go);
    const strip = el("div", "k1-row"); strip.style.gap = "16px";
    const poolBox = el("div", "k1-row"); poolBox.style.cssText += ";gap:22px;min-height:" + (Math.round(fw * .62) + 12) + "px";
    st.append(bar, top, label("🎞️ Плёнка:"), strip, label("👆 Картинки:"), poolBox);
    scr.innerHTML = ""; const first = V.clip(frameReq(0), 340, { paused: true }); first.style.border = "0"; scr.append(first);

    function draw(){
      strip.innerHTML = "";
      order.forEach((fi, k) => {
        const slot = el("button", "v-slot" + (fi != null ? " full" : "") + (k === 0 ? " fixed" : ""));
        slot.style.width = fw + 12 + "px"; slot.style.height = Math.round(fw * .62) + 12 + "px";
        slot.append(el("span", "n", k + 1));
        if (fi != null) slot.append(V.clip(frameReq(fi), fw, { paused: true }));
        slot.onclick = () => { if (busy || k === 0 || fi == null) return; K1.sfx("click"); order[k] = null; pool.push(fi); draw(); };
        strip.append(slot);
      });
      poolBox.innerHTML = "";
      pool.forEach(fi => {
        const b = el("button", "v-pick anim-pop"); b.append(V.clip(frameReq(fi), fw, { paused: true }));
        b.onclick = () => {
          if (busy) return; const k = order.indexOf(null); if (k < 0) return;
          K1.sfx("pop"); order[k] = fi; pool = pool.filter(x => x !== fi); draw();
        };
        poolBox.append(b);
      });
      go.disabled = busy || order.includes(null);
      go.classList.toggle("anim-pulse", !go.disabled);
    }
    go.onclick = async () => {
      if (busy || order.includes(null)) return;
      busy = true; tries++; draw();
      for (let loop = 0; loop < 3; loop++) for (const fi of order) {
        if (!scr.isConnected) return;
        scr.innerHTML = ""; const c = V.clip(frameReq(fi), 340, { paused: true }); c.style.border = "0"; scr.append(c);
        K1.sfx("click"); await K1.sleep(380);
      }
      const ok = order.every((fi, k) => fi === k);
      [...strip.children].forEach((s, k) => s.classList.add(order[k] === k ? "right" : "wrong"));
      if (ok) {
        const s = stars(tries); K1.setStars(m.id, lv, s); got += s;
        await K1.sleep(700);
        const a = await K1.result({ stars: s, sub: "Мультик готов!" });
        if (a === "next") { lv++; next(); } else { got -= s; level(); }
      } else {
        K1.sfx("bad");
        await K1.sleep(1300);
        order.forEach((fi, k) => { if (fi !== k) { order[k] = null; pool.push(fi); } });
        busy = false; draw();
      }
    };
    draw();
  }
  function next(){ lv < D.frames.length ? level() : K1.modeDone(m, got, D.frames.length * 3); }
  level();
}

/* ---------- Режим «Найди ошибку» ---------- */
function runGlitch(st, m){
  let lv = 0, got = 0;
  function level(){
    const L = D.glitch[lv];
    let miss = 0, done = false, target = null;
    K1.clear();
    const bar = el("div", "k1-row"); bar.append(K1.levelBar(D.glitch.length, lv), K1.skipBtn(() => { lv++; next(); }));
    const row = el("div", "k1-row"); row.style.gap = "26px";
    const clip = V.clip({ cam: "still", ...L.req }, 820);
    clip.style.cursor = "pointer";
    const bip = el("div", "", K1.bip(140, "bounce"));
    row.append(bip, clip);
    const hint = el("div", "k1-caption", "👀"); hint.style.minHeight = "60px";
    st.append(bar, row, hint);
    const s = clip.querySelector(".k1w-scene"), hero = s.querySelector('[data-role="hero"]');
    const u = 8.2;
    K1.later(clip, 1800, () => {
      if (L.kind === "twin") { target = hero.cloneNode(true); target.style.left = "14%"; target.style.marginLeft = "0"; s.append(target); }
      else if (L.kind === "moon") { target = el("div", "", "🌙"); target.style.cssText = `position:absolute;left:58%;top:5%;font-size:${12 * u}px;line-height:1`; s.append(target); }
      else if (L.kind === "odd") { target = el("div", "v-m-fly", L.e); target.style.cssText = `position:absolute;left:16%;top:6%;font-size:${15 * u}px;line-height:1`; s.append(target); }
      else if (L.kind === "morph") { target = hero; hero.textContent = L.to; }
      else if (L.kind === "walk") {
        const P = W.get("place", L.req.place);
        target = [...s.children].find(c => c.textContent === P.decor[0]) || hero;
        target.classList.add("v-m-walk");
      }
      target.style.zIndex = 5;
      if (target !== hero || L.kind === "morph") target.animate([{ opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "none" }], { duration: 700 });
      K1.sfx("think");
    });
    clip.onclick = async e => {
      if (done || !target) return;
      if (target.contains(e.target)) {
        done = true; target.classList.remove("v-hint"); target.classList.add("v-found"); K1.sfx("ok"); K1.bipMood(bip, "happy");
        hint.textContent = "Нашёл! 👍";
        const s2 = miss === 0 ? 3 : miss === 1 ? 2 : 1; K1.setStars(m.id, lv, s2); got += s2;
        await K1.sleep(1300);
        const a = await K1.result({ stars: s2, sub: "Бип ошибся, а ты заметил!" });
        if (a === "next") { lv++; next(); } else { got -= s2; level(); }
      } else {
        miss++; K1.sfx("bad"); K1.bipMood(bip, "sad");
        if (miss >= 2) { target.classList.add("v-hint"); hint.textContent = "Подсказка: красная рамка"; }
      }
    };
  }
  function next(){ lv < D.glitch.length ? level() : K1.modeDone(m, got, D.glitch.length * 3); }
  level();
}

const intro = id => [{ ...D.intro[id], scene: introScene(id) }];
K1.init({
  id: "ozhivi-kartinku",
  title: D.title, hello: D.hello, theory,
  modes: [
    { id: "match",  title: "Как в мультике", pic: "🎬", about: "Собери такой же запрос", levels: D.match.length, intro: intro("match"), run(st){ runMatch(st, this); } },
    { id: "frames", title: "Кадры",          pic: "🎞️", about: "Картинки по порядку", levels: D.frames.length, intro: intro("frames"), run(st){ runFrames(st, this); } },
    { id: "glitch", title: "Найди ошибку",   pic: "🔍", about: "Где Бип ошибся?", levels: D.glitch.length, intro: intro("glitch"), run(st){ runGlitch(st, this); } },
  ],
});
})();
