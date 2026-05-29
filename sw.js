/* ════════════════════════════════════════════════════════════════
   출결관리 시스템 Service Worker — 2차 로드 속도 개선

   목표: 콜드 4895ms → 2차 ~1500ms (Ctrl+R / 일반 navigation)

   캐시 전략:
     1. Precache: 페이지 진입에 필요한 최소 자산 (index.html)
     2. Runtime cache:
        - 정적 자산 (HTML/CSS/Fonts): stale-while-revalidate
        - 외부 CDN (Chart.js / XLSX / Firebase SDK): cache-first (1주일)
     3. Firebase Realtime DB (firebaseio.com): cache 안 함 (fresh)

   버전 관리:
     CACHE_VERSION 변경 시 이전 캐시 자동 삭제
     index.html 변경 시 SW 가 stale-while-revalidate 로 백그라운드 갱신
     → 한 번 reload 후 새 버전 적용

   디버그 (index.html 에서):
     window.__unregisterSW()  — SW 등록 해제
     window.__clearSWCache()  — 모든 캐시 삭제
   ════════════════════════════════════════════════════════════════ */

'use strict';

/* Stage 1 robust banner-fire verify (2026-05-29): 'kmjj-v3-banner-verify' → 'kmjj-v4-banner-verify-fire'
   사용자 Step A 통과 — robust 코드 (731ef5d) 가 페이지에서 실제 실행 중.
   이 commit 으로 sw.js bytes 변경 → 다음 F5 시 새 SW install 트리거 + robust 코드 가 잡음 → 배너 fire.
   Stage 2 에서 commit hash 자동 주입 정착 예정. */
const CACHE_VERSION = 'kmjj-v4-banner-verify-fire';
const STATIC_CACHE = CACHE_VERSION + '-static';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

/* SW 자기 위치 기준 — github.io/youth-attendance-data/sw.js 면 scope = /youth-attendance-data/ */
const SCOPE = self.registration ? self.registration.scope : self.location.origin + '/';
const BASE = new URL(SCOPE).pathname; /* '/youth-attendance-data/' */

/* 페이지 진입에 꼭 필요한 minimum precache */
const PRECACHE_URLS = [
  BASE,
  BASE + 'index.html'
];

/* Firebase Realtime DB — 절대 cache 안 함 (항상 fresh) */
const NEVER_CACHE_HOSTS = [
  'firebaseio.com',
  '.firebase.com'
];

/* 외부 CDN 정적 자원 — cache-first (1주일) */
const CACHE_FIRST_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.gstatic.com',         /* firebase SDK */
  'cdn.jsdelivr.net',         /* chart.js */
  'cdnjs.cloudflare.com'      /* xlsx */
];

const CDN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; /* 7 days */

/* ── Install: precache 핵심 자산 ──────────────────────────────────── */
self.addEventListener('install', (event) => {
  console.log('[SW] install ' + CACHE_VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] precache failed (계속 진행):', err);
      }))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: 이전 버전 캐시 삭제 ──────────────────────────────────── */
self.addEventListener('activate', (event) => {
  console.log('[SW] activate ' + CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((n) => n.startsWith('kmjj-') && n !== STATIC_CACHE && n !== RUNTIME_CACHE)
          .map((n) => {
            console.log('[SW] delete old cache: ' + n);
            return caches.delete(n);
          })
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: 라우팅 ──────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; /* POST / PUT 등은 SW 우회 */
  const url = new URL(req.url);

  /* (1) Firebase Realtime DB — 절대 cache, fresh 응답 */
  if (NEVER_CACHE_HOSTS.some(h => url.hostname.endsWith(h))) {
    return; /* SW 우회 — 브라우저가 직접 네트워크 처리 */
  }

  /* (2) 외부 CDN — cache-first with stale revalidation */
  if (CACHE_FIRST_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
    event.respondWith(cacheFirstWithRefresh(req, RUNTIME_CACHE, CDN_MAX_AGE_MS));
    return;
  }

  /* (3) 같은 origin 의 정적 자원 (HTML/CSS/JS/이미지) — stale-while-revalidate */
  if (url.origin === self.location.origin) {
    /* HTML navigation 요청 — stale-while-revalidate, 빠른 응답 우선 */
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  /* 그 외 (다른 origin) — 네트워크 그대로 */
});

/* ── Strategy: cache-first with background refresh ──────────────── */
function cacheFirstWithRefresh(req, cacheName, maxAge) {
  return caches.open(cacheName).then((cache) => {
    return cache.match(req).then((cached) => {
      /* 캐시 적중 & 신선도 OK → 즉시 반환 */
      if (cached) {
        const dateHeader = cached.headers.get('date');
        const age = dateHeader ? (Date.now() - new Date(dateHeader).getTime()) : Infinity;
        if (age < maxAge) {
          /* fresh: 캐시만 반환 */
          return cached;
        }
        /* stale: 캐시 반환 + 백그라운드 갱신 */
        fetch(req).then((res) => {
          if (res && res.status === 200) cache.put(req, res);
        }).catch(() => {});
        return cached;
      }
      /* 캐시 miss → 네트워크 + 캐시 저장 */
      return fetch(req).then((res) => {
        if (res && res.status === 200) {
          cache.put(req, res.clone());
        }
        return res;
      });
    });
  });
}

/* ── Strategy: stale-while-revalidate ───────────────────────────── */
function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then((cache) => {
    return cache.match(req).then((cached) => {
      const networkPromise = fetch(req).then((res) => {
        if (res && res.status === 200) {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      }).catch((err) => {
        /* 네트워크 실패: 캐시가 있으면 캐시 사용, 없으면 throw */
        if (cached) return cached;
        throw err;
      });
      /* 캐시 있으면 즉시 반환 + 백그라운드 갱신 */
      return cached || networkPromise;
    });
  });
}

/* ── Message: client 에서 명시적 cache clear 요청 ─────────────────── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((names) => {
      return Promise.all(names.filter((n) => n.startsWith('kmjj-')).map((n) => caches.delete(n)));
    }).then(() => {
      console.log('[SW] caches cleared');
      if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: true });
    });
  } else if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
