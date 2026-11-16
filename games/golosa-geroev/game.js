/* Голоса героев: логика. Тексты, голоса и уровни в data.js. */
(function(){
"use strict";
const { el } = K1, W = K1W, D = window.GG;

/* Рисунок волны голоса: по нему видно, тонкий голос или низкий */
function waveSVG(kind, w = 200, h = 60){
  let d = "M0 " + h / 2;
  for (let x = 0; x <= w; x += 2) {
    let y;
    if (kind === "high") y = Math.sin(x / 3) * h * .18;
    else if (kind === "low") y = Math.sin(x / 22) * h * .42;
    else if (kind === "robot") y = (Math.sin(x / 10) > 0 ? 1 : -1) * h * .3;
    else if (kind === "ghost") y = Math.sin(x / 9) * h * .4 * Math.sin(x / 60);
    else y = Math.sin(x / 9) * h * .3;
    d += ` L${x} ${(h / 2 + y).toFixed(1)}`;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="#111" stroke-width="4" stroke-linejoin="round"/></svg>`;
}
const EQ = `<div class="eq"><i></i><i></i><i></i><i></i></div>`;

/* ---------- Теория ---------- */
const SCENES = [
  box => {
    const row = el("div", "k1-row anim-pop"); row.style.gap = "40px";
    const card = el("div", "vcard playing", `${EQ}${waveSVG("robot", 200, 60)}`); card.style.boxShadow = "none";
    row.append(el("div", "", K1.bip(240, "bounce")), card); box.append(row);
    K1.later(box, 800, async () => { K1.bipMood(box, "talk"); await K1.babble("Привет! Я Бип! Я умею говорить!", D.voices.robot); if (box.isConnected) K1.bipMood(box, "bounce"); });
  },
  box => {
    const c = el("div", "", K1.bip(190, "think")); c.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2";
    const cnt = el("div", "", "0"); cnt.style.cssText = "position:absolute;right:24px;bottom:16px;font:800 44px Bahnschrift,'Segoe UI',sans-serif;z-index:3";
    box.append(c, cnt);
    const pics = ["🗣️","🐭","💬","🐻","🎤","👧","🤖","👴","💬","🐶","🎙️","👩","🐱","🗣️","👦","🐸","💬","👵","🎤","🦜"];
    pics.forEach((p, i) => {
      const a = (i / pics.length) * Math.PI * 2, x = Math.cos(a) * 470, y = Math.sin(a) * 235;
      const f = el("div", "", p);
      f.style.cssText = `position:absolute;left:50%;top:50%;width:84px;height:84px;margin:-42px;display:grid;place-items:center;font-size:50px;background:#fff;border:3px solid #111;box-shadow:4px 4px 0 #111;transform:translate(${x}px,${y}px)`;
      f.animate([{ transform: `translate(${x}px,${y}px) scale(1)`, opacity: 1 }, { transform: "translate(0,0) scale(.2)", opacity: 0 }], { duration: 900, delay: 250 + i * 250, easing: "ease-in", fill: "forwards" });
      box.append(f);
      K1.later(box, 250 + i * 250, () => K1.babble("а", { pitch: 200 + (i * 97 % 600), speed: 2, wave: "triangle" }));
    });
    let n = 0; const t = setInterval(() => { n += 500; cnt.textContent = Math.min(n, 10000).toLocaleString("ru-RU") + " голосов"; if (n >= 10000 || !cnt.isConnected) clearInterval(t); }, 260);
  },
  box => {
    const row = el("div", "k1-row"); row.style.gap = "40px";
    const heroes = [["🐭", "high", "Я мышка!"], ["🐻", "low", "Я медведь!"], ["🤖", "robot", "Я робот!"]];
    const cards = heroes.map(([e, v]) => { const c = el("div", "vcard", `<div style="font-size:110px;line-height:1">${e}</div>${waveSVG(D.voices[v].draw, 200, 60)}`); row.append(c); return c; });
    box.append(row);
    heroes.forEach(([e, v, line], i) => K1.later(box, 700 + i * 2700, async () => {
      cards.forEach(c => c.classList.remove("playing")); cards[i].classList.add("playing");
      await K1.babble(line, D.voices[v]);
    }));
  },
  box => {
    const row = el("div", "k1-row"); row.style.gap = "50px";
    const face = el("div", "anim-pop", "😄"); face.style.cssText = "font-size:200px;line-height:1";
    const notes = el("div", "", ""); notes.style.cssText = "position:relative;width:420px;height:300px";
    for (let i = 0; i < 9; i++) { const n = el("div", "anim-float", i % 2 ? "🎵" : "🎶"); n.style.cssText = `position:absolute;left:${(i * 47) % 380}px;top:${(i * 71) % 250}px;font-size:60px;animation-delay:${-i * .3}s`; notes.append(n); }
    row.append(el("div", "", K1.bip(180, "bounce")), notes, face); box.append(row);
    K1.later(box, 400, () => K1.bgMusic("happy"));
    K1.later(box, 4600, () => { face.textContent = "😱"; face.classList.remove("anim-pop"); void face.offsetWidth; face.classList.add("anim-pop"); notes.style.filter = "grayscale(1)"; K1.bgMusic("scary"); });
  },
  box => {
    const row = el("div", "k1-row"); row.style.gap = "30px";
    const s = W.scene({ hero: "cat", place: "forest", time: "day", weather: "rainbow" }, 620);
    const bub = el("div", "k1-plate anim-pop", "Ура! Я ожил!"); bub.style.cssText += ";padding:14px 20px;font-size:30px;position:absolute;left:330px;top:30px;box-shadow:4px 4px 0 #111";
    s.append(bub); row.append(s); box.append(row);
    K1.later(box, 300, () => K1.bgMusic("happy"));
    K1.later(box, 900, () => K1.babble("Ура! Я ожил!", W.get("hero", "cat").voice));
  },
];
const theory = D.theory.map((f, i) => ({ ...f, scene: SCENES[i] }));
const introScene = id => box => {
  const row = el("div", "k1-row"); row.style.gap = "40px";
  row.append(el("div", "", K1.bip(200, "bounce talk")));
  if (id === "voice") row.append(el("div", "anim-pop", `<div style="font-size:150px">🐭</div>`), el("div", "vcard anim-pop", `${waveSVG("high")}${waveSVG("low")}`));
  else if (id === "music") { const s = W.scene(D.musicLevels[0].scene, 420); s.classList.add("anim-pop"); row.append(s, el("div", "vcard playing anim-pop", `${EQ}<div style="font-size:60px">🎵</div>`)); }
  else row.append(el("div", "anim-pop", `<div style="font-size:120px">🎬</div>`));
  box.append(row);
};

/* Карточка голоса или музыки: «Слушать» и «Выбрать» */
function card(top, onListen, onPick, pickText = "Этот!"){
  const c = el("div", "vcard", top);
  const l = el("button", "k1-btn k1-listen", `${K1.ICON.play} Слушать`); l.style.fontSize = "22px";
  const p = el("button", "k1-btn main", `${K1.ICON.ok} ${pickText}`); p.style.fontSize = "22px";
  l.onclick = () => K1.listen(async () => { document.querySelectorAll(".vcard.playing").forEach(x => x.classList.remove("playing")); c.classList.add("playing"); await onListen(); });
  p.onclick = () => onPick(c);
  c.append(l, p);
  return c;
}

/* ---------- «Подбери голос» ---------- */
function runVoice(st, m){
  let lv = 0, got = 0;
  function level(){
    const L = D.voiceLevels[lv];
    const others = K1.shuffle(Object.keys(D.voices).filter(v => v !== L.voice && D.voices[v].draw !== D.voices[L.voice].draw)).slice(0, 2);
    const opts = K1.shuffle([L.voice, ...others]);
    let tries = 0, done = false;
    K1.clear();
    const bar = el("div", "k1-row"); bar.append(K1.levelBar(D.voiceLevels.length, lv), K1.skipBtn(() => { lv++; next(); }));
    const hero = el("div", "k1-row");
    const big = el("div", "anim-pop", `<div style="font-size:150px;line-height:1">${L.e}</div>`);
    const bub = el("div", "k1-plate", "…"); bub.style.cssText += ";padding:14px 22px;font-size:30px;min-width:380px;box-shadow:4px 4px 0 #111";
    hero.append(big, bub);
    const row = el("div", "k1-row"); row.style.gap = "26px";
    opts.forEach(v => row.append(card(waveSVG(D.voices[v].draw), () => K1.babble(L.line, D.voices[v]), async c => {
      if (done) return; tries++;
      if (v === L.voice) {
        done = true; c.classList.add("right"); bub.textContent = L.line;
        big.classList.add("anim-wiggle");
        await K1.babble(L.line, D.voices[v]);
        const stars = tries === 1 ? 3 : tries === 2 ? 2 : 1; K1.setStars(m.id, lv, stars); got += stars;
        await K1.result({ stars, again: false }); lv++; next();
      } else { K1.sfx("bad"); c.classList.add("wrong"); }
    })));
    st.append(bar, hero, row);
  }
  function next(){ lv < D.voiceLevels.length ? level() : K1.modeDone(m, got, D.voiceLevels.length * 3); }
  level();
}

/* ---------- «Музыка для сцены» ---------- */
function runMusic(st, m){
  let lv = 0, got = 0;
  function level(){
    const L = D.musicLevels[lv];
    const opts = K1.shuffle([L.mood, ...L.wrong]);
    let tries = 0, done = false;
    K1.clear();
    const bar = el("div", "k1-row"); bar.append(K1.levelBar(D.musicLevels.length, lv), K1.skipBtn(() => { K1.bgMusic(null); lv++; next(); }));
    const sc = W.scene(L.scene, 520); sc.classList.add("anim-pop");
    const row = el("div", "k1-row"); row.style.gap = "26px";
    opts.forEach((mood, i) => row.append(card(`${EQ}<div style="font:800 34px Bahnschrift,'Segoe UI',sans-serif">Музыка ${i + 1}</div>`,
      () => K1.preview(mood), async c => {
        if (done) return; tries++;
        if (mood === L.mood) {
          done = true; c.classList.add("right"); K1.bgMusic(mood);
          const stars = tries === 1 ? 3 : tries === 2 ? 2 : 1; K1.setStars(m.id, lv, stars); got += stars;
          await K1.sleep(1500); K1.bgMusic(null);
          await K1.result({ stars, again: false, sub: `<span style="font-size:70px">${D.moodPic[mood]}</span>` }); lv++; next();
        } else { K1.bgMusic(null); K1.sfx("bad"); c.classList.add("wrong"); c.querySelector("div:last-of-type").insertAdjacentHTML("beforeend", ` ${D.moodPic[mood]}`); }
      }, "Эта!")));
    st.append(bar, sc, row);
  }
  function next(){ lv < D.musicLevels.length ? level() : K1.modeDone(m, got, D.musicLevels.length * 3); }
  level();
}

/* ---------- «Озвучь комикс» ---------- */
function runDub(st, m){
  let hero = null, voice = null; const moods = [null, null, null];
  function pickHero(){
    K1.clear();
    st.append(el("div", "k1-caption", "Кто герой мультика?"));
    const row = el("div", "k1-row"); row.style.flexWrap = "wrap"; row.style.maxWidth = "1100px";
    W.hero.forEach(h => { const b = el("button", "k1-choice anim-pop", `<span class="e" style="font-size:90px">${h.e}</span><span class="t">${h.t}</span>`); b.style.cssText += ";width:160px;height:160px";
      b.onclick = () => { K1.sfx("pop"); hero = h.id; editor(); }; row.append(b); });
    st.append(row);
  }
  function editor(){
    K1.clear();
    const frames = el("div", "k1-row"); frames.style.gap = "18px";
    D.dub.forEach((f, i) => {
      const s = W.scene({ hero, ...f }, 300, { still: true });
      const wrap = el("div", ""); wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:6px";
      wrap.append(s, el("div", "", moods[i] ? `<span style="font-size:40px">🎵${D.moodPic[moods[i]]}</span>` : `<span style="font-size:40px;opacity:.3">🎵?</span>`));
      frames.append(wrap);
    });
    const vrow = el("div", "k1-row"); vrow.style.gap = "10px";
    vrow.append(el("div", "", `<b style="font-size:24px">Голос:</b>`));
    D.dubVoices.forEach(v => { const b = el("button", "k1-choice", waveSVG(D.voices[v].draw, 120, 44)); b.style.cssText += ";min-width:140px;min-height:70px" + (voice === v ? ";background:#FFD2BD;outline:4px solid var(--acc);transform:translate(3px,3px);box-shadow:2px 2px 0 #111" : "");
      b.classList.add("k1-listen"); b.onclick = async () => { voice = v; editor(); K1.listen(() => K1.babble(D.dub[0].line, D.voices[v])); }; vrow.append(b); });
    st.append(frames, vrow);
    const mrows = el("div", ""); mrows.style.cssText = "display:flex;gap:28px";
    D.dub.forEach((f, i) => {
      const col = el("div", ""); col.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;width:300px;justify-content:center";
      D.dubMoods.forEach(md => { const b = el("button", "k1-choice" + (moods[i] === md ? " on" : ""), `<span class="e" style="font-size:34px">${D.moodPic[md]}</span>`); b.style.cssText += ";min-width:54px;min-height:54px;padding:2px";
        b.classList.add("k1-listen"); b.onclick = () => { moods[i] = md; editor(); K1.listen(() => K1.preview(md, 3000)); }; col.append(b); });
      mrows.append(col);
    });
    st.append(mrows);
    const ready = voice && moods.every(Boolean);
    const w = el("button", "k1-btn main" + (ready ? " anim-pulse" : ""), `${K1.ICON.replay} Смотреть мультик`); w.disabled = !ready; w.onclick = watch;
    st.append(w);
  }
  async function watch(){
    K1.clear();
    const row = el("div", "k1-row"); st.append(row);
    for (let i = 0; i < 3; i++) {
      row.innerHTML = "";
      const f = D.dub[i];
      const s = W.scene({ hero, ...f }, 760); s.style.animation = "pop .6s both";
      const bub = el("div", "k1-plate anim-pop", f.line); bub.style.cssText += ";padding:12px 20px;font-size:30px;position:absolute;left:400px;top:24px;max-width:340px;box-shadow:4px 4px 0 #111;animation-delay:.6s";
      s.append(bub); row.append(s);
      K1.bgMusic(moods[i]);
      await K1.sleep(900);
      await K1.babble(f.line, D.voices[voice]);
      await K1.sleep(2200);
    }
    K1.bgMusic(null);
    K1.setStars(m.id, 0, 3);
    K1.modeDone(m, 3, 3);
  }
  pickHero();
}

const intro = id => [{ ...D.intro[id], scene: introScene(id) }];
K1.init({
  id: "golosa-geroev",
  title: D.title, hello: D.hello, theory,
  modes: [
    { id: "voice", title: "Подбери голос",   pic: "🗣️", about: "Какой голос у героя?", levels: D.voiceLevels.length, intro: intro("voice"), run(st){ runVoice(st, this); } },
    { id: "music", title: "Музыка для сцены", pic: "🎵", about: "Весело или страшно?", levels: D.musicLevels.length, intro: intro("music"), run(st){ runMusic(st, this); } },
    { id: "dub",   title: "Озвучь комикс",    pic: "🎬", about: "Свой мультик", levels: 1, intro: intro("dub"), run(st){ runDub(st, this); } },
  ],
});
})();
