# IslePilot Skin Editor

The current editor is the original compiled SkinEditor component (module 2492) from the user's saved https://st25.islepilot.eu/skin page. Old SVG, illustration masks, generated models and old editor scripts have been removed.

## Files

- src/pages/skin.html: portal header/footer and editor iframe.
- src/pages/skin-editor.html: isolated imported client and original CSS.
- assets/vendor/islepilot-skin/client.js: original module factories; no Next hydration, analytics, extension scripts or saved player/session data.
- assets/vendor/islepilot-skin/provenance.json: source file hashes.
- assets/vendor/islepilot-skin/cdn/skinviewer/: 207 downloaded assets, including 22 GLB files and original texture masks.
- assets/js/islepilot-skin-runtime.js: module-format adapter; replaces Next router and preferences with host/local equivalents.
- src/features/islepilot-skin.js: original React editor, Vietnamese strings, Steam identity and portal API adapter.
- src/api/skin-payload.js: validates and preserves original linear color arrays before applying.

Preset storage is local to this browser using the original skyclaw-skin-presets key. IslePilot cloud draft storage and job-status endpoints are not available in the current portal backend. The host uses its existing authenticated /api/skin/apply endpoint and 10 Lua fee. A queued API response does not prove the command completed in game. No live apply was executed during testing.

## Verification

npm.cmd test
node tests/islepilot-skin-browser.cjs

The browser fixture blocks mutations and external IslePilot/Steam requests. It checks five widths (1440, 1024, 768, 390, 320), original color controls, linear JSON export, saving presets, Glitch layout, guest/session state and rendering without JavaScript errors. Results and screenshots are islepilot-skin-results.json and islepilot-skin-*.png.

The regression checks validate all asset sizes, GLB headers/buffer bounds, original export/import, invalid payload rejection and forwarding the exact payload through the real controller with a fake upstream.

## Import and deployment

The private original HTML and saved resources remain in reference/ (Git ignored). Re-import with node tools/import-islepilot-skin.cjs and fetch referenced public model/texture assets with node tools/download-islepilot-skin.cjs.

Node serves /cdn/skinviewer through Express. Vercel builds that directory as static files and excludes it from the Node function because the model/texture collection is about 253 MB. Deploy all imported files along with src/, assets/, server.js and vercel.json. Live production deployment has not been performed or verified.
