/* Мир историй для детских игр K1: герои, места, время суток, погода и рисование сцены.
   Копия лежит в каждой игре, правьте здесь. Подписи короткие: дети почти не читают. */
(function(){
"use strict";
const W = window.K1W = {};

W.CATS = [
  { id: "hero",    title: "Кто?",   pic: "🐾" },
  { id: "place",   title: "Где?",   pic: "📍" },
  { id: "time",    title: "Когда?", pic: "🕑" },
  { id: "weather", title: "Погода", pic: "☁️" },
];

W.hero = [
  { id: "cat",     e: "🐱", t: "Кот",       voice: { pitch: 520, speed: 1.3, wave: "triangle" } },
  { id: "dog",     e: "🐶", t: "Пёс",       voice: { pitch: 300, speed: 1.1, wave: "square", bright: 1200 } },
  { id: "dragon",  e: "🐉", t: "Дракон",    voice: { pitch: 110, speed: .7, wave: "sawtooth", bright: 700 } },
  { id: "car",     e: "🚙", t: "Машинка",   voice: { pitch: 380, speed: 1.6, wave: "square", bright: 2200 } },
  { id: "unicorn", e: "🦄", t: "Единорог",  voice: { pitch: 700, speed: 1, wave: "sine" } },
  { id: "dino",    e: "🦖", t: "Динозавр",  voice: { pitch: 150, speed: .9, wave: "sawtooth", bright: 900 } },
];
W.place = [
  { id: "forest", e: "🌲", t: "Лес",    sky: "#9ED8FF", ground: "#6DBB5E", decor: ["🌲", "🌳", "🍄", "🌲"] },
  { id: "city",   e: "🏙️", t: "Город",  sky: "#B9DDF5", ground: "#9AA3AD", decor: ["🏢", "🏠", "🚦", "🏬"] },
  { id: "sea",    e: "🌊", t: "Море",   sky: "#A6E3FF", ground: "#2F8FD8", decor: ["🐚", "⛵", "🐟", "🌴"] },
  { id: "space",  e: "🪐", t: "Космос", sky: "#141B3A", ground: "#5A5F73", decor: ["🪐", "🛸", "☄️", "🌍"], dark: true },
  { id: "castle", e: "🏰", t: "Замок",  sky: "#C9C2FF", ground: "#8BC77A", decor: ["🏰", "🚩", "👑", "🌹"] },
  { id: "desert", e: "🌵", t: "Пустыня",sky: "#FFE3A3", ground: "#E8C072", decor: ["🌵", "🐫", "🪨", "🌵"] },
];
W.time = [
  { id: "day",   e: "☀️", t: "День" },
  { id: "night", e: "🌙", t: "Ночь" },
];
W.weather = [
  { id: "clear",   e: "✨", t: "Ясно" },
  { id: "rain",    e: "🌧️", t: "Дождь" },
  { id: "snow",    e: "❄️", t: "Снег" },
  { id: "rainbow", e: "🌈", t: "Радуга" },
];
W.get = (cat, id) => W[cat].find(x => x.id === id);
W.random = (cats = ["hero", "place", "time", "weather"]) => {
  const r = { hero: "cat", place: "forest", time: "day", weather: "clear" };
  cats.forEach(c => { const a = W[c]; r[c] = a[Math.random() * a.length | 0].id; });
  return r;
};
W.same = (a, b, cats) => cats.every(c => a[c] === b[c]);

function shade(hex, k){
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = n >> 8 & 255, b = n & 255;
  r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k);
  return "#" + ((1 << 24) + (Math.min(255, r) << 16) + (Math.min(255, g) << 8) + Math.min(255, b)).toString(16).slice(1);
}

/* Нарисовать сцену. req = {hero, place, time, weather}; w — ширина в px. Возвращает элемент. */
W.scene = (req, w = 520, opts = {}) => {
  const h = Math.round(w * .62), u = w / 100;
  const P = W.get("place", req.place) || W.place[0];
  const night = req.time === "night" || P.dark;
  const sky = P.dark ? P.sky : night ? shade(P.sky, .32) : P.sky;
  const ground = night && !P.dark ? shade(P.ground, .55) : P.ground;
  const d = document.createElement("div");
  d.className = "k1w-scene";
  d.style.cssText = `position:relative;width:${w}px;height:${h}px;overflow:hidden;background:${sky};border:3px solid #111;flex:none`;
  let html = `<div style="position:absolute;left:0;right:0;bottom:0;height:34%;background:${ground};border-top:3px solid #111"></div>`;
  if (night) for (let i = 0; i < 14; i++) html += `<div style="position:absolute;left:${(i * 37 % 97)}%;top:${(i * 23 % 50)}%;width:${u * .7}px;height:${u * .7}px;background:#FFF6C8"></div>`;
  html += `<div style="position:absolute;right:${6 * u}px;top:${4 * u}px;font-size:${13 * u}px;line-height:1">${night ? "🌙" : "☀️"}</div>`;
  P.decor.forEach((e, i) => {
    const x = [4, 22, 70, 86][i], y = [44, 50, 47, 42][i];
    html += `<div style="position:absolute;left:${x}%;top:${y}%;font-size:${(i % 2 ? 11 : 14) * u}px;line-height:1">${e}</div>`;
  });
  if (req.weather === "rainbow") { const R = 30 * u, cx = 42 * u, cy = h * .62; html += `<svg style="position:absolute;left:0;top:0" width="${w}" height="${h}">` + ["#E53935","#FB8C00","#FDD835","#43A047","#1E88E5","#8E24AA"].map((c, i) => `<path d="M${cx - R + i * 2.2 * u} ${cy} A${R - i * 2.2 * u} ${R - i * 2.2 * u} 0 0 1 ${cx + R - i * 2.2 * u} ${cy}" fill="none" stroke="${c}" stroke-width="${2.3 * u}"/>`).join("") + `</svg>`; }
  const H = W.get("hero", req.hero);
  if (H) html += `<div class="${opts.still ? "" : "anim-float"}" style="position:absolute;left:50%;top:38%;margin-left:${-12 * u}px;font-size:${24 * u}px;line-height:1">${H.e}</div>`;
  if (req.weather === "rain") for (let i = 0; i < 26; i++)
    html += `<div style="position:absolute;left:${(i * 41 % 100)}%;top:${-20 - (i * 13 % 60)}%;width:${u * .5}px;height:${u * 4}px;background:#3C7BD9;animation:rain ${.9 + (i % 5) * .15}s linear ${-(i % 7) * .2}s infinite"></div>`;
  if (req.weather === "snow") for (let i = 0; i < 22; i++)
    html += `<div style="position:absolute;left:${(i * 43 % 100)}%;top:${-15 - (i * 11 % 50)}%;font-size:${u * 4}px;color:#fff;text-shadow:0 0 2px #456;animation:snow ${3 + (i % 4) * .6}s linear ${-(i % 6) * .7}s infinite">❄</div>`;
  d.innerHTML = html;
  return d;
};

/* Шум, из которого «нейросеть» проявляет картинку */
W.noise = (w = 520) => {
  const h = Math.round(w * .62), c = document.createElement("canvas");
  c.width = 100; c.height = 62; c.style.cssText = `width:${w}px;height:${h}px;image-rendering:pixelated;border:3px solid #111;display:block`;
  c.redraw = () => {
    const x = c.getContext("2d"), img = x.createImageData(100, 62);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = v; img.data[i + 1] = Math.random() * 255; img.data[i + 2] = v; img.data[i + 3] = 255; }
    x.putImageData(img, 0, 0);
  };
  c.redraw();
  return c;
};

/* Анимация генерации в контейнере box: шум → размытая картинка → чёткая. */
W.generate = async (box, req, w = 520) => {
  box.innerHTML = "";
  const holder = document.createElement("div");
  holder.style.cssText = `position:relative;width:${w + 6}px;height:${Math.round(w * .62) + 6}px`;
  box.append(holder);
  const n = W.noise(w); holder.append(n);
  window.K1 && K1.sfx("think");
  for (let i = 0; i < 5; i++) { await K1.sleep(150); n.redraw(); }
  const s = W.scene(req, w);
  s.style.position = "absolute"; s.style.inset = "0"; s.style.animation = "noise-out 1.4s ease-out both";
  holder.innerHTML = ""; holder.append(s);
  window.K1 && K1.sfx("magic");
  await K1.sleep(1400);
  return s;
};

/* Строка запроса из значков: [🐱][🌲][🌙][🌧️] */
W.chips = (req, cats, size = 46) => cats.map(c => {
  const x = W.get(c, req[c]);
  return `<span style="display:inline-grid;place-items:center;width:${size + 14}px;height:${size + 14}px;border:2px solid #111;background:#fff;font-size:${size}px;line-height:1">${x ? x.e : "?"}</span>`;
}).join("");
})();
