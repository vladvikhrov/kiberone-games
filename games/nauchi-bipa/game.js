/* Научи Бипа: логика. Наборы картинок и тексты в data.js.
   «Нейросеть» здесь игрушечная: картинка-проверка идёт туда, куда ребёнок положил похожий пример. */
(function(){
"use strict";
const { el } = K1, D = window.NB;

/* ---------- Данные набора ---------- */
function makeSet(si){
  const S = D.sets[si];
  const ex = [], tests = [];
  ["a", "b"].forEach(side => S[side + "_pairs"].forEach(([e, t], k) => {
    ex.push({ e, kind: side + k, truth: side, label: null });
    tests.push({ e: t, kind: side + k, truth: side });
  }));
  return { S, ex, tests };
}
function predict(test, examples){
  const m = examples.filter(x => x.label && x.kind === test.kind);
  if (!m.length) return { label: Math.random() < .5 ? "a" : "b", unsure: true };
  const a = m.filter(x => x.label === "a").length;
  return { label: a * 2 >= m.length ? "a" : "b", unsure: false };
}

/* ---------- Поле: две коробки и середина ---------- */
function board(S){
  const wrap = el("div", "nb-wrap");
  const box = side => {
    const b = el("div", "nb-box", `<div class="head"><span class="i">${S[side].i}</span>${S[side].t}</div><div class="items"></div>`);
    b.dataset.side = side; return b;
  };
  const A = box("a"), B = box("b"), mid = el("div", "nb-mid");
  wrap.append(A, mid, B);
  return { wrap, A, B, mid, box: side => side === "a" ? A : B };
}
/* Перелёт картинки из from (элемент) в коробку; возвращает элемент в коробке */
async function fly(from, toBox, e, cls = ""){
  const items = toBox.querySelector(".items");
  const it = el("div", "nb-item " + cls, e); it.style.visibility = "hidden"; items.append(it);
  const r1 = from.getBoundingClientRect(), r2 = it.getBoundingClientRect(), k = K1.k || 1;
  const x1 = r1.left + r1.width / 2, y1 = r1.top + r1.height / 2, x2 = r2.left + r2.width / 2, y2 = r2.top + r2.height / 2;
  const g = el("div", "nb-item", e);
  g.style.cssText = `position:fixed;left:${x1 - 36}px;top:${y1 - 36}px;z-index:40;margin:0`;
  document.body.append(g); K1.sfx("whoosh");
  await g.animate([{ transform: `translate(0,0) scale(${1.4 * k})` }, { transform: `translate(${x2 - x1}px,${y2 - y1}px) scale(${k})` }],
    { duration: 550, easing: "cubic-bezier(.3,.7,.4,1)" }).finished.catch(() => {});
  g.remove(); it.style.visibility = ""; K1.sfx("pop");
  return it;
}
const mark = (it, ok, unsure) => { it.classList.add(ok ? "good" : "bad"); it.insertAdjacentHTML("beforeend", `<span class="mark">${unsure ? "🤔" : ok ? "✅" : "❌"}</span>`); };
const brain = () => el("div", "nb-brain", "<i></i>");

/* Бип учится: полоска заполняется */
async function learn(mid){
  mid.innerHTML = ""; const b = brain();
  mid.append(el("div", "", K1.bip(150, "think")), el("div", "nb-score", "Бип учится…"), b);
  K1.sfx("think"); await K1.sleep(50); b.firstChild.style.width = "100%"; await K1.sleep(2100); K1.sfx("magic");
}
/* Проверка: Бип раскладывает новые картинки. Возвращает число верных. */
async function test(bd, tests, examples, speed = 1){
  bd.wrap.querySelectorAll(".nb-item.test").forEach(x => x.remove());
  let ok = 0;
  for (const t of K1.shuffle(tests)) {
    if (!bd.wrap.isConnected) return ok;
    bd.mid.innerHTML = "";
    const card = el("div", "nb-card anim-pop", t.e);
    bd.mid.append(el("div", "", K1.bip(110, "think")), card);
    await K1.sleep(700 / speed);
    const p = predict(t, examples);
    const it = await fly(card, bd.box(p.label), t.e, "test");
    card.style.visibility = "hidden";
    const right = p.label === t.truth; if (right) ok++;
    mark(it, right, p.unsure); K1.sfx(right ? "ok" : "bad");
    await K1.sleep(450 / speed);
  }
  return ok;
}
/* Ребёнок раскладывает примеры по одному */
function teachOne(bd, list, onDone){
  let i = 0;
  const A = bd.A, B = bd.B;
  function show(){
    bd.mid.innerHTML = "";
    if (i >= list.length) { A.classList.remove("target"); B.classList.remove("target"); return onDone(); }
    A.classList.add("target"); B.classList.add("target");
    const card = el("div", "nb-card anim-pop", list[i].e);
    const arrows = el("div", "k1-row", `<span style="font-size:60px" class="anim-wiggle">👈</span><span style="font-size:60px" class="anim-wiggle">👉</span>`); arrows.style.gap = "120px";
    bd.mid.append(el("div", "", K1.bip(100, "bounce")), card, arrows);
    bd.mid.dataset.busy = "";
  }
  [A, B].forEach(b => b.onclick = async () => {
    if (i >= list.length || bd.mid.dataset.busy) return;
    bd.mid.dataset.busy = "1";
    const card = bd.mid.querySelector(".nb-card");
    list[i].label = b.dataset.side;
    const it = await fly(card, b, list[i].e); list[i].el = it;
    i++; show();
  });
  show();
}
const starsFor = ok => ok >= 6 ? 3 : ok >= 4 ? 2 : 1;

/* ---------- Теория ---------- */
const S0 = D.sets[0];
const SCENES = [
  box => { const bd = board(S0); bd.mid.append(el("div", "anim-pop", K1.bip(220, "bounce talk"))); box.append(bd.wrap); },
  box => {
    const bd = board(S0); box.append(bd.wrap);
    const seq = [["🐱", "a"], ["🚗", "b"], ["🐶", "a"], ["🚌", "b"]];
    seq.forEach(([e, s], i) => K1.later(box, 300 + i * 1500, async () => {
      bd.mid.innerHTML = ""; const c = el("div", "nb-card anim-pop", e); bd.mid.append(c);
      await K1.sleep(600); if (!box.isConnected) return; await fly(c, bd.box(s), e); c.style.visibility = "hidden";
    }));
    K1.later(box, 6400, () => learn(bd.mid));
  },
  box => {
    const bd = board(S0); box.append(bd.wrap);
    ["🐱", "🐶"].forEach(e => bd.A.querySelector(".items").append(el("div", "nb-item", e)));
    ["🚗", "🚌"].forEach(e => bd.B.querySelector(".items").append(el("div", "nb-item", e)));
    const c = el("div", "nb-card anim-pop", "🐈"); bd.mid.append(el("div", "", K1.bip(120, "think")), c, el("div", "nb-score", "Куда?"));
    K1.later(box, 2600, async () => { const it = await fly(c, bd.A, "🐈"); c.style.visibility = "hidden"; mark(it, true); K1.sfx("ok"); K1.bipMood(box, "happy"); });
  },
  box => {
    const bd = board(S0); box.append(bd.wrap);
    ["🐱", "🐶"].forEach(e => bd.A.querySelector(".items").append(el("div", "nb-item", e)));
    bd.B.querySelector(".items").append(el("div", "nb-item", "🚌"));
    const c1 = el("div", "nb-card anim-pop", "🚗"); bd.mid.append(c1);
    K1.later(box, 900, async () => { const it = await fly(c1, bd.A, "🚗"); c1.style.visibility = "hidden"; it.classList.add("bad"); K1.sfx("bad"); });
    K1.later(box, 2800, async () => {
      bd.mid.innerHTML = ""; const c = el("div", "nb-card anim-pop", "🚙"); bd.mid.append(el("div", "", K1.bip(120, "think")), c);
      await K1.sleep(1500); if (!box.isConnected) return;
      const it = await fly(c, bd.A, "🚙"); c.style.visibility = "hidden"; mark(it, false); K1.sfx("bad"); K1.bipMood(box, "sad");
    });
  },
  box => {
    const row = el("div", "k1-row"); row.style.gap = "40px";
    const col = el("div", ""); col.style.cssText = "display:flex;flex-direction:column;gap:18px;align-items:center";
    const cnt = el("div", "nb-score", "Примеров: 1"); const b = brain(); b.style.width = "420px"; b.firstChild.style.transition = "width .5s";
    const pile = el("div", "nb-tray"); pile.style.maxWidth = "560px";
    col.append(cnt, b, pile); row.append(el("div", "", K1.bip(200, "bounce")), col); box.append(row);
    const pics = ["🐱", "🐶", "🐰", "🐻", "🐼", "🦊", "🐯", "🐮", "🐷", "🐸"];
    pics.forEach((p, i) => K1.later(box, 300 + i * 450, () => {
      pile.append(el("div", "nb-item anim-pop", p)); cnt.textContent = "Примеров: " + (i + 1); b.firstChild.style.width = (i + 1) * 10 + "%"; K1.sfx("pop");
      if (i === pics.length - 1) { K1.bipMood(box, "happy"); K1.sfx("win"); }
    }));
  },
];
const theory = D.theory.map((f, i) => ({ ...f, scene: SCENES[i] }));
const introScene = id => box => {
  const row = el("div", "k1-row"); row.style.gap = "40px";
  row.append(el("div", "", K1.bip(200, "bounce talk")), el("div", "anim-pop", `<div style="font-size:150px">${id === "teach" ? "👩‍🏫" : id === "fix" ? "🔍" : "➕"}</div>`));
  box.append(row);
};

/* ---------- «Учитель» ---------- */
function runTeach(st, m){
  let lv = 0, got = 0;
  function level(){
    const { S, ex, tests } = makeSet(D.teach[lv]);
    K1.clear();
    const bar = el("div", "k1-row"); bar.append(K1.levelBar(D.teach.length, lv), K1.skipBtn(() => { lv++; next(); }));
    const bd = board(S); st.append(bar, bd.wrap);
    teachOne(bd, K1.shuffle(ex), () => {
      const go = el("button", "k1-btn main anim-pulse", `${K1.ICON.play} Учиться!`);
      bd.mid.append(el("div", "", K1.bip(150, "bounce")), go);
      go.onclick = async () => {
        await learn(bd.mid);
        const ok = await test(bd, tests, ex);
        ex.forEach(x => { if (x.label !== x.truth && x.el) x.el.classList.add("bad"); });
        const stars = starsFor(ok); K1.setStars(m.id, lv, stars); got += stars;
        await K1.sleep(700);
        const badEx = ex.some(x => x.label !== x.truth);
        const a = await K1.result({ stars, title: `Бип угадал ${ok} из 6`, sub: badEx ? "Красный пример лежит не там. Бип учился на ошибке!" : "" });
        if (a === "next") { lv++; next(); } else { got -= stars; level(); }
      };
    });
  }
  function next(){ lv < D.teach.length ? level() : K1.modeDone(m, got, D.teach.length * 3); }
  level();
}

/* ---------- «Поймай ошибку» ---------- */
function runFix(st, m){
  let lv = 0, got = 0;
  function level(){
    const L = D.fix[lv]; const { S, ex, tests } = makeSet(L.set);
    ex.forEach(x => x.label = x.truth);
    K1.shuffle(ex).slice(0, L.bad).forEach(x => x.label = x.truth === "a" ? "b" : "a");
    let left = L.bad, misses = 0, phase = "wait";
    K1.clear();
    const bar = el("div", "k1-row"); bar.append(K1.levelBar(D.fix.length, lv), K1.skipBtn(() => { lv++; next(); }));
    const bd = board(S); st.append(bar, bd.wrap);
    function place(x){
      const b = el("button", "nb-item", x.e); x.el = b;
      bd.box(x.label).querySelector(".items").append(b);
      b.onclick = async () => {
        if (phase !== "find" || x.label === x.truth) {
          if (phase === "find") { misses++; K1.sfx("bad"); b.classList.add("anim-wiggle"); setTimeout(() => b.classList.remove("anim-wiggle"), 700); }
          return;
        }
        x.label = x.truth; b.remove();
        const it = await fly(bd.mid, bd.box(x.label), x.e); it.classList.add("good");
        if (--left === 0) retrain();
      };
    }
    K1.shuffle(ex).forEach(place);
    (async () => {
      await learn(bd.mid);
      await test(bd, tests, ex, 1.6);
      phase = "find";
      bd.mid.innerHTML = "";
      bd.mid.append(el("div", "", K1.bip(140, "sad")), el("div", "nb-score anim-pulse", "Найди плохой пример!"), el("div", "", `<span style="font-size:70px">🔍</span>`));
      bd.wrap.querySelectorAll(".nb-item.test").forEach(x => x.style.opacity = .35);
    })();
    async function retrain(){
      phase = "done";
      bd.mid.innerHTML = ""; const go = el("button", "k1-btn main anim-pulse", `${K1.ICON.play} Учиться снова`);
      bd.mid.append(el("div", "", K1.bip(140, "bounce")), go);
      go.onclick = async () => {
        await learn(bd.mid);
        const ok = await test(bd, tests, ex);
        const stars = misses === 0 ? 3 : misses <= 2 ? 2 : 1; K1.setStars(m.id, lv, stars); got += stars;
        await K1.sleep(600);
        await K1.result({ stars, title: `Бип угадал ${ok} из 6`, again: false });
        lv++; next();
      };
    }
  }
  function next(){ lv < D.fix.length ? level() : K1.modeDone(m, got, D.fix.length * 3); }
  level();
}

/* ---------- «Мало примеров» ---------- */
function runMore(st, m){
  let lv = 0, got = 0;
  function level(){
    const { S, ex, tests } = makeSet(D.more[lv]);
    const known = [ex[0], ex[3]]; known.forEach(x => x.label = x.truth);
    const rest = ex.filter(x => !known.includes(x));
    K1.clear();
    const bar = el("div", "k1-row"); bar.append(K1.levelBar(D.more.length, lv), K1.skipBtn(() => { lv++; next(); }));
    const bd = board(S); st.append(bar, bd.wrap);
    known.forEach(x => bd.box(x.label).querySelector(".items").append(el("div", "nb-item", x.e)));
    (async () => {
      await learn(bd.mid);
      const ok1 = await test(bd, tests, ex, 1.3);
      bd.mid.innerHTML = "";
      const go = el("button", "k1-btn main anim-pulse", `➕ Научить ещё`);
      bd.mid.append(el("div", "", K1.bip(130, "sad")), el("div", "nb-score", `Угадал ${ok1} из 6`), go);
      go.onclick = () => {
        bd.wrap.querySelectorAll(".nb-item.test").forEach(x => x.remove());
        teachOne(bd, K1.shuffle(rest), () => {
          const g2 = el("button", "k1-btn main anim-pulse", `${K1.ICON.play} Учиться!`);
          bd.mid.append(el("div", "", K1.bip(130, "bounce")), g2);
          g2.onclick = async () => {
            await learn(bd.mid);
            const ok2 = await test(bd, tests, ex);
            ex.forEach(x => { if (x.label !== x.truth && x.el) x.el.classList.add("bad"); });
            const stars = starsFor(ok2); K1.setStars(m.id, lv, stars); got += stars;
            await K1.sleep(600);
            const a = await K1.result({ stars, title: `Было ${ok1}, стало ${ok2} из 6!` });
            if (a === "next") { lv++; next(); } else { got -= stars; level(); }
          };
        });
      };
    })();
  }
  function next(){ lv < D.more.length ? level() : K1.modeDone(m, got, D.more.length * 3); }
  level();
}

const intro = id => [{ ...D.intro[id], scene: introScene(id) }];
K1.init({
  id: "nauchi-bipa",
  title: D.title, hello: D.hello, theory,
  modes: [
    { id: "teach", title: "Учитель",       pic: "👩‍🏫", about: "Разложи примеры", levels: D.teach.length, intro: intro("teach"), run(st){ runTeach(st, this); } },
    { id: "fix",   title: "Поймай ошибку", pic: "🔍", about: "Найди плохой пример", levels: D.fix.length, intro: intro("fix"), run(st){ runFix(st, this); } },
    { id: "more",  title: "Мало примеров", pic: "➕", about: "Добавь примеров", levels: D.more.length, intro: intro("more"), run(st){ runMore(st, this); } },
  ],
});
})();
