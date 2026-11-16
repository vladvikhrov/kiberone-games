/* Видео для детских игр K1 (AI Storytelling, урок 3): оживлённые сцены, кадры, плеер трейлера.
   Подключать после k1kids.js и k1world.js. Копия лежит в каждой игре, правьте здесь
   и копируйте (docs/tasks/igry-mladshie-ii.md, раздел 8). */
(function(){
"use strict";
const V = window.K1V = {};
const { el } = K1, W = K1W;

/* Карточки запроса «как оживить» */
V.CATS = [
  { id: "move", title: "Герой",  pic: "🏃" },
  { id: "cam",  title: "Камера", pic: "🎥" },
  { id: "fx",   title: "Вокруг", pic: "🍃" },
];
V.move = [
  { id: "jump",  e: "⬆️", t: "Прыгает" },
  { id: "run",   e: "↔️", t: "Бегает" },
  { id: "spin",  e: "🔄", t: "Крутится" },
  { id: "sleep", e: "💤", t: "Спит" },
];
V.cam = [
  { id: "still", e: "📷", t: "Стоит" },
  { id: "zoom",  e: "🔍", t: "Ближе" },
  { id: "pan",   e: "🎥", t: "Плывёт" },
];
V.fx = [
  { id: "leaves", e: "🍃", t: "Ветер" },
  { id: "birds",  e: "🐦", t: "Птицы" },
  { id: "balls",  e: "🎈", t: "Шарики" },
  { id: "spark",  e: "✨", t: "Искры" },
];
V.get = (cat, id) => (V[cat] || W[cat] || []).find(x => x.id === id);
V.random = cats => { const r = {}; cats.forEach(c => { const a = V[c]; r[c] = a[Math.random() * a.length | 0].id; }); return r; };
V.same = (a, b, cats) => cats.every(c => (a[c] || "") === (b[c] || ""));

const css = `
.v-clip{position:relative;overflow:hidden;border:3px solid #111;flex:none;background:#111}
.v-cam{position:absolute;inset:0}
.v-cam.zoom{animation:v-zoom 3.2s ease-in-out infinite alternate}
.v-cam.pan{animation:v-pan 3.6s ease-in-out infinite alternate}
@keyframes v-zoom{from{transform:scale(1)}to{transform:scale(1.45)}}
@keyframes v-pan{from{transform:scale(1.22) translateX(-8%)}to{transform:scale(1.22) translateX(8%)}}
.v-m-jump{animation:v-jump .9s ease-in-out infinite}
@keyframes v-jump{0%,100%{transform:translateY(0) scaleY(.88)}12%{transform:translateY(0) scaleY(1.05)}50%{transform:translateY(-.85em)}}
.v-m-run{animation:v-run 1.8s ease-in-out infinite alternate}
@keyframes v-run{from{transform:translateX(-1.6em)}to{transform:translateX(1.6em)}}
.v-m-spin{animation:v-spin 1.3s linear infinite}
@keyframes v-spin{to{transform:rotate(360deg)}}
.v-m-sleep{animation:v-sleep 2.4s ease-in-out infinite}
@keyframes v-sleep{50%{transform:scale(1.08,.93)}}
.v-m-sway{animation:v-sway 1.3s ease-in-out infinite alternate;transform-origin:50% 100%}
@keyframes v-sway{from{transform:rotate(-12deg)}to{transform:rotate(12deg)}}
.v-m-walk{animation:v-walk 1.6s ease-in-out infinite alternate}
@keyframes v-walk{from{transform:translateX(0) rotate(-7deg)}to{transform:translateX(1.3em) rotate(7deg)}}
.v-m-float{animation:float 2s ease-in-out infinite}
.v-m-fly{animation:v-fly 1.6s ease-in-out infinite alternate}
@keyframes v-fly{from{transform:translate(-.5em,.2em)}to{transform:translate(.5em,-.4em)}}
.v-zz{position:absolute;line-height:1;animation:v-zz 2.4s linear infinite}
@keyframes v-zz{0%{transform:translate(0,0) scale(.5);opacity:0}25%{opacity:1}100%{transform:translate(.9em,-1.8em) scale(1.2);opacity:0}}
.v-fx{position:absolute;line-height:1;pointer-events:none}
.v-across{animation:v-across var(--d) linear var(--del) infinite}
@keyframes v-across{from{transform:translateX(0) rotate(0)}to{transform:translateX(var(--dx)) rotate(var(--rot,0deg))}}
.v-up{animation:v-up var(--d) linear var(--del) infinite}
@keyframes v-up{from{transform:translateY(0)}to{transform:translateY(var(--dy))}}
.v-blink{animation:v-blink 1.4s ease-in-out var(--del) infinite}
@keyframes v-blink{0%,100%{transform:scale(.2);opacity:0}50%{transform:scale(1.2);opacity:1}}
.v-paused,.v-paused *{animation-play-state:paused!important}
.v-off *{animation-delay:var(--off)!important}
.v-tag{position:absolute;right:10px;top:10px;background:#111;color:#fff;font:800 24px Bahnschrift,'Segoe UI',sans-serif;padding:4px 12px;z-index:3}
.v-strip{position:absolute;left:8px;bottom:8px;display:flex;gap:6px;z-index:3}
.v-strip .v-clip{border-width:2px;animation:pop .3s both}
.v-screen{position:relative;overflow:hidden;background:#111;border:3px solid #111;box-shadow:8px 8px 0 #111;display:grid;place-items:center;flex:none}
.v-screen .v-title{color:#fff;text-align:center;font:800 64px/1.1 Bahnschrift,'Segoe UI',sans-serif;letter-spacing:.06em}
.v-screen .v-title small{display:block;font-size:56px;letter-spacing:0;margin-top:12px}
.v-slot{position:relative;border:3px dashed #111;background:rgba(255,255,255,.55);display:grid;place-items:center;padding:0;flex:none;
  font:800 44px Bahnschrift,'Segoe UI',sans-serif;color:#8A9096}
.v-slot.full{border-style:solid;background:#fff}
.v-slot.fixed{border-color:#2E9E44}
.v-slot.right{outline:6px solid #2E9E44;outline-offset:2px}
.v-slot.wrong{outline:6px solid #E53935;outline-offset:2px;animation:wiggle .3s 2}
.v-slot .n{position:absolute;left:-3px;top:-3px;background:#111;color:#fff;font-size:20px;line-height:1;padding:4px 8px;z-index:2}
.v-pick{padding:0;border:0;background:none;box-shadow:6px 6px 0 #111;flex:none}
.v-pick:hover{transform:translate(-2px,-2px);box-shadow:8px 8px 0 #111}
.v-pick:active{transform:translate(3px,3px);box-shadow:2px 2px 0 #111}
.v-hint{outline:5px dashed #E53935;outline-offset:4px}
.v-found{outline:6px solid #2E9E44;outline-offset:4px}
.v-lab{font:800 22px Bahnschrift,'Segoe UI',sans-serif;display:flex;align-items:center;gap:8px}
`;
const st = document.createElement("style"); st.textContent = css; document.head.append(st);

function fx(kind, w, h, u){
  const out = [];
  const add = (e, cls, style, vars) => {
    const d = el("div", "v-fx " + cls, e); d.style.cssText = style;
    for (const k in vars) d.style.setProperty(k, vars[k]); out.push(d);
  };
  if (kind === "leaves") for (let i = 0; i < 7; i++)
    add("🍃", "v-across", `left:-10%;top:${8 + (i * 37 % 70)}%;font-size:${6 * u}px`, { "--d": 3.4 + (i % 3) * .6 + "s", "--del": -(i * .55) + "s", "--dx": w * 1.25 + "px", "--rot": "720deg" });
  if (kind === "birds") for (let i = 0; i < 4; i++)
    add("🐦", "v-across", `left:102%;top:${6 + (i * 17 % 34)}%;font-size:${7 * u}px`, { "--d": 4.5 + (i % 2) + "s", "--del": -(i * 1.2) + "s", "--dx": -w * 1.25 + "px" });
  if (kind === "balls") for (let i = 0; i < 6; i++)
    add("🎈", "v-up", `left:${4 + (i * 31 % 90)}%;top:102%;font-size:${8 * u}px`, { "--d": 4 + (i % 3) * .7 + "s", "--del": -(i * .8) + "s", "--dy": -h * 1.3 + "px" });
  if (kind === "spark") for (let i = 0; i < 12; i++)
    add("✨", "v-blink", `left:${(i * 29 % 92) + 2}%;top:${(i * 41 % 80) + 4}%;font-size:${(5 + i % 3 * 2) * u}px`, { "--del": -(i * .27) + "s" });
  return out;
}

/* Оживлённая сцена.
   req: {hero, place, time, weather, move, cam, fx, items:[{e,x,y,s,m}], noSun, sky}
   x, y — центр предмета в % сцены, s — размер в сотых ширины, m — движение (jump, run, spin, sleep, sway, float, fly).
   opts.paused — картинка стоит (все анимации на паузе); opts.at — секунда, на которой стоит кадр. */
V.clip = (req, w = 400, opts = {}) => {
  const h = Math.round(w * .62), u = w / 100;
  const box = el("div", "v-clip");
  box.style.width = w + 6 + "px"; box.style.height = h + 6 + "px";
  if (opts.paused) box.classList.add("v-paused");
  if (opts.at != null) { box.classList.add("v-off"); box.style.setProperty("--off", -opts.at + "s"); }
  const cam = el("div", "v-cam " + (req.cam || "still"));
  const s = W.scene({ hero: req.hero || "none", place: req.place || "forest", time: req.time || "day", weather: req.weather || "clear" }, w);
  s.style.border = "0";
  if (req.sky) s.style.background = req.sky;
  if (req.noSun) [...s.children].forEach(c => { if (c.textContent === "☀️" || c.textContent === "🌙") c.remove(); });
  const hero = s.querySelector(".anim-float");
  if (hero) {
    hero.dataset.role = "hero";
    if (req.move) { hero.classList.replace("anim-float", "v-m-" + req.move); }
    if (req.move === "sleep") { const z = el("div", "v-zz", "💤"); z.style.cssText += `;left:60%;top:28%;font-size:${8 * u}px`; s.append(z); }
  }
  (req.items || []).forEach(it => {
    const holder = el("div", ""); holder.style.cssText = `position:absolute;left:${it.x}%;top:${it.y}%;width:0;height:0`;
    const inner = el("div", it.m ? "v-m-" + it.m : "", it.e);
    inner.style.cssText = `position:absolute;left:0;top:0;font-size:${(it.s || 14) * 1.4 * u}px;line-height:1;margin:-.5em 0 0 -.5em;width:1em;text-align:center`;
    if (it.r) inner.style.rotate = it.r + "deg";
    holder.append(inner); s.append(holder);
  });
  cam.append(s);
  if (req.fx) fx(req.fx, w, h, u).forEach(f => cam.append(f));
  box.append(cam);
  return box;
};

/* «Нейросеть оживляет картинку»: картинка стоит → Бип рисует кадры → видео двигается. */
V.animate = async (box, req, w = 400) => {
  box.innerHTML = "";
  const h = Math.round(w * .62);
  const holder = el("div", ""); holder.style.cssText = `position:relative;width:${w + 6}px;height:${h + 6}px`;
  box.append(holder);
  const pic = V.clip(req, w, { paused: true }); holder.append(pic);
  const tag = el("div", "v-tag", "🎞️ 0"); holder.append(tag);
  const strip = el("div", "v-strip"); holder.append(strip);
  K1.sfx("think");
  for (let i = 1; i <= 24; i++) {
    await K1.sleep(50);
    if (!box.isConnected) return pic;
    tag.textContent = "🎞️ " + i;
    if (i % 6 === 0) { strip.append(V.clip(req, Math.round(w / 5.6), { paused: true, at: i * .07 })); K1.sfx("click"); }
  }
  await K1.sleep(250);
  strip.remove(); tag.remove();
  pic.classList.remove("v-paused");
  K1.sfx("magic");
  await K1.sleep(700);
  return pic;
};

/* Ряды карточек выбора: cats из V.CATS, sel — объект выбора. */
V.rows = (cats, sel, onPick, size = 92) => {
  const wrap = el("div", ""); wrap.style.cssText = "display:flex;flex-direction:column;gap:12px";
  cats.forEach(c => {
    const meta = V.CATS.find(x => x.id === c);
    const r = el("div", ""); r.style.cssText = "display:flex;gap:10px;align-items:center";
    const lab = el("div", "k1-plate", `<div style="font-size:${size * .4}px;line-height:1">${meta.pic}</div><div style="font-size:16px">${meta.title}</div>`);
    lab.style.cssText += `;width:${size + 10}px;height:${size}px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:4px 4px 0 #111;background:#F4F4F4`;
    r.append(lab);
    V[c].forEach(x => {
      const b = el("button", "k1-choice", `<span class="e" style="font-size:${size * .5}px">${x.e}</span><span class="t">${x.t}</span>`);
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
};

/* Экран-плеер. Возвращает элемент; play(clips, opts) показывает клипы по очереди.
   opts: {mood, ratio: "wide"|"square", title, end, each} */
V.screen = (w = 460, ratio = "wide") => {
  const h = ratio === "square" ? w : Math.round(w * .62);
  const scr = el("div", "v-screen"); scr.style.width = w + 6 + "px"; scr.style.height = h + 6 + "px";
  scr.dataset.w = w; scr.dataset.h = h;
  scr.innerHTML = `<div class="v-title" style="font-size:${w / 9}px">▶</div>`;
  return scr;
};
V.play = async (scr, clips, o = {}) => {
  const w = +scr.dataset.w, h = +scr.dataset.h;
  const tok = scr._tok = (scr._tok || 0) + 1; // новый показ на этом экране отменяет старый
  const alive = () => scr.isConnected && scr._tok === tok;
  const card = html => { scr.innerHTML = ""; scr.append(el("div", "v-title anim-pop", html)); };
  if (o.mood) K1.bgMusic(o.mood);
  if (o.title) { card(`ТРЕЙЛЕР<small>${o.title}</small>`); scr.querySelector(".v-title").style.fontSize = w / 8 + "px"; K1.sfx("whoosh"); await K1.sleep(1700); if (!alive()) return; }
  for (const c of clips) {
    if (!alive()) return;
    scr.innerHTML = "";
    const cw = Math.max(w, Math.ceil(h / .62));
    const v = V.clip(c, cw);
    v.style.cssText += `;position:absolute;left:${(w - cw) / 2 - 3}px;top:${(h - Math.round(cw * .62)) / 2 - 3}px;border:0;animation:fade .35s both`;
    scr.append(v);
    await K1.sleep(o.each || 2200);
  }
  if (!alive()) return;
  if (o.end) { card(o.end); scr.querySelector(".v-title").style.fontSize = w / 7 + "px"; K1.sfx("win"); await K1.sleep(1600); if (!alive()) return; }
  if (o.mood) K1.bgMusic(null);
  return true;
};
})();
