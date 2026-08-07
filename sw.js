// CACHE_NAME을 배포할 때마다 바꿔주면(v1→v2→...) 예전 캐시가 자동 폐기되고
// 브라우저가 새 index.html을 다시 받아옵니다. 코드 수정 후에도 화면이 안
// 바뀌어 보이면 이 버전을 한 칸 올려서 다시 배포하세요.
const CACHE_NAME = 'kukeo-wang-v3';
const URLS_TO_CACHE = [
  '/lecture/index.html',
  '/lecture/manifest.json'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) {
        return k !== CACHE_NAME;
      }).map(function(k) {
        return caches.delete(k);
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  // Supabase API 요청은 캐시 안 함
  if(e.request.url.includes('supabase.co') ||
     e.request.url.includes('anthropic.com') ||
     e.request.url.includes('api.')) {
    return;
  }
  // 문서(HTML) 요청은 브라우저 자체 HTTP 캐시까지 건너뛰고 항상 새로
  // 받아온다 — 그래야 코드를 고쳐 배포한 즉시 반영된다. 오프라인일 때만
  // 서비스워커 캐시로 대체.
  var isDocument = e.request.mode === 'navigate' || e.request.destination === 'document';
  e.respondWith(
    fetch(e.request, isDocument ? {cache:'reload'} : {}).catch(function() {
      return caches.match(e.request);
    })
  );
});
