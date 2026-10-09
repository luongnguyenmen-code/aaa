# Frontend regression checks

Run with Node.js:

```sh
node tests/frontend-regression.cjs
node tests/home-player-regression.cjs
```

These tests use a fake clock, fake fetch responses and minimal DOM fixtures. They never contact IslePilot or execute live transactions. They cover stuck/overlapping reads, startup ordering, listener accumulation, hidden-page polling, blocked storage, map updates, garage card preservation, concurrent/cancelled garage actions, delayed countdown ticks, repeated trade expiry and double-click crate purchases.

The homepage checks verify shared account subscriptions, retained card nodes during stat/species updates, zero values, accessible progress values, temporary connection failures, logout transitions and the backend percentage helper without starting the server.

`frontend-audit-results.json` records the local audit. Chrome headless tested all 16 ST25 pages at desktop width, plus the homepage, garage, map and trade pages at 375 and 820 pixels. Checks include runtime errors, broken images, horizontal overflow, stable HUD nodes/geometry, retained popovers, mobile navigation, zero balances/health, zero-coordinate markers, 144 clean grid labels and matching garage/restore borders.

Root causes addressed:

- HUD HTML and document listeners were recreated every refresh.
- Startup awaited three network requests before constructing navigation.
- Polling could overlap; expired trades could trigger a request every second.
- Full-page transition snapshots ran alongside content entrance animations.
- Mobile navigation and desktop hiding used inconsistent breakpoints.
- Map height assumed a fixed header, and a teleport callback called an undefined method.
- Garage data was rendered twice; active-data changes unnecessarily replaced storage cards.
- Garage countdowns counted timer ticks, and concurrent prepare/actions were not guarded.
- Blank avatar URLs and a full map image used as favicon added unnecessary loads.

The browser audit uses mock API data. It does not establish frame rate on a user's GPU/phone, hosting latency, or live IslePilot transaction success. The four IslePilot export snapshots receive static validation rather than live browser testing.
