// Flip Crest の Web 版のサービスワーカー（docs/specs/web.md「ホーム画面と読み込みの速さ」#99）。
// 範囲は play/。ページ（index.html）と読み込み役（Build/*.loader.js）だけを持ち、電波が無くても開けるようにする。
// - ページはネットが先。つながらない時だけ取っておいた物を出す。取れたら、そのページが使う読み込み役のほかは消す。
// - 読み込み役は名前がハッシュなので、持っていればそれを出す。
// - data・framework・wasm は Unity のキャッシュ（index.html の cacheControl = immutable）に任せ、ここでは持たない。
// - ほかのサイト（サーバー・R2・Google）と google-callback.html、GET 以外には手を出さない。
"use strict";

var CACHE = "fc-play-1";
var SCOPE = self.registration.scope;   // 例: https://flip-crest.com/play/

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf("fc-play-") === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isPage(url) {
  return url === SCOPE || url === SCOPE + "index.html";
}

function isLoader(url) {
  return url.indexOf(SCOPE + "Build/") === 0 && /\.loader\.js$/.test(url);
}

// 新しいページが使う読み込み役のほかを消す（古い版の物を残さない）
function prune(cache, html) {
  var keep = {};
  var re = /Build\/[^"'\s]+\.loader\.js/g;
  var m;
  while ((m = re.exec(html)) !== null) keep[SCOPE + m[0]] = true;
  return cache.keys().then(function (reqs) {
    return Promise.all(reqs.filter(function (r) {
      return isLoader(r.url) && !keep[r.url];
    }).map(function (r) { return cache.delete(r); }));
  });
}

function pageFirstNetwork(request) {
  return fetch(request).then(function (res) {
    if (res && res.ok && res.type === "basic") {
      var copy = res.clone();
      caches.open(CACHE).then(function (cache) {
        return copy.text().then(function (html) {
          var stored = new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
          return cache.put(SCOPE, stored).then(function () { return prune(cache, html); });
        });
      }).catch(function () {});
    }
    return res;
  }).catch(function () {
    return caches.open(CACHE).then(function (cache) { return cache.match(SCOPE); }).then(function (hit) {
      return hit || Response.error();
    });
  });
}

function loaderFromCache(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request.url).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        if (res && res.ok && res.type === "basic") cache.put(request.url, res.clone()).catch(function () {});
        return res;
      });
    });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = request.url.split("#")[0].split("?")[0];
  if (url.indexOf(SCOPE) !== 0) return;
  if (request.mode === "navigate" && isPage(url)) {
    event.respondWith(pageFirstNetwork(request));
  } else if (isLoader(url)) {
    event.respondWith(loaderFromCache(request));
  }
});
