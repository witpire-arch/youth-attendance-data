/* ════════════════════════════════════════════════════════════════
   Service Worker — KILL-SWITCH (cycle 7, 2026-06-01)

   결정: 오프라인/캐시 불필요 확정 → Service Worker 를 완전히 제거한다.
   이 파일은 더 이상 어떤 자원도 캐시하지 않으며, 기존 사용자에게 남아있는
   SW 와 Cache Storage 를 '자기 자신 포함' 깨끗이 제거(self-destruct)한다.
   → CACHE_VERSION 수동 bump 영구 종료. 코드 변경은 일반 새로고침으로 즉시 반영.

   동작:
     install  : skipWaiting() — 대기 없이 즉시 활성화
     activate : (1) 모든 Cache Storage 삭제 (이전 kmjj-v* static/runtime 포함)
                (2) clients.claim() — 열린 탭 제어권 확보
                (3) registration.unregister() — 자기 등록 해제
                (4) 열린 탭 navigate(reload) 1회 — SW/캐시 떨어진 fresh 상태로 재진입
     fetch    : 핸들러 없음 → 모든 요청 네트워크 직행 (캐시 개입 0)

   배포 메커니즘:
     - 신규 방문자: index.html 에 등록 코드가 없으므로 SW 가 아예 생성되지 않음.
     - 기존 사용자: 브라우저의 자동 sw.js 갱신 검사가 이 파일을 받아 위 activate 를
       실행 → SW/캐시 자가 해제 + 탭 1회 reload. 이후로는 SW 없는 순수 네트워크 동작.
   ════════════════════════════════════════════════════════════════ */

'use strict';

self.addEventListener('install', function () {
  /* 대기열 건너뛰고 즉시 activate 로 진입 */
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    /* (1) 모든 캐시 삭제 */
    try {
      var keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    } catch (e) { /* noop */ }

    /* (2) 열린 탭 제어권 확보 (navigate 가능하게) */
    try { await self.clients.claim(); } catch (e) { /* noop */ }

    /* (3) 자기 등록 해제 — 이후 네비게이션은 SW 없이 동작 */
    try { await self.registration.unregister(); } catch (e) { /* noop */ }

    /* (4) 열린 탭을 1회 reload → 캐시/SW 떨어진 fresh 상태로 재진입 */
    try {
      var clientList = await self.clients.matchAll({ type: 'window' });
      clientList.forEach(function (client) {
        try { client.navigate(client.url); } catch (e) { /* noop */ }
      });
    } catch (e) { /* noop */ }
  })());
});

/* fetch 핸들러 의도적으로 없음 — 모든 요청은 브라우저가 네트워크로 직접 처리. */
