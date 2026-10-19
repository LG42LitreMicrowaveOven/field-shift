# HarvestV (frontend)
Plain HTML/CSS/JS, hash-routed single page app. No build step.
Run: `python3 -m http.server 5500` in this folder and open http://localhost:5500 (port 5500 or 8080 so the backend's default CORS allows it).
Deploy: push this folder to a GitHub repo, then Settings > Pages > deploy from branch (root). Hash routing works on Pages.

## What is live and what is demo
* **Live from the API:** crop list and crop details (`GET /api/crops`), NASA POWER conditions on My Farm (`GET /api/environment`), and **Generate Rotation Strategy** (`POST /api/rotations/generate`, see `js/rotation.js`).
* **Demo only:** "Analyze My Rotation" and its report use illustrative placeholder scoring (clearly labelled on the page), and the report's what-if table and references are placeholders. They are not produced by the rotation engine.
* **Generate form:** the rotation plan fields (number of seasons, a season for each slot, previous crop, transition mode, cyclic check, preferred crops, crops to leave out) are sent to the engine. The "About your farm" fields (location, size, soil, irrigation, labour, priorities) are collected for future features and do **not** affect results; the page says so.
* Seasons are never assumed: each slot starts unselected and the choices come from the catalog's own season labels.

## Backend connection
The URL lives only in `js/config.js` (`apiBaseUrl`, currently the Render service). For local development change it to `http://localhost:8000`. `useMockEnvironment` must stay `false` in production. The first request to a sleeping Render instance can take up to a minute.

## Tests
`node --test tests/rotation.test.js` (Node 18+). Tests request construction, validation, error mapping and result rendering with a mocked `fetch` and fixtures of real engine output. DOM wiring in `js/app.js` is checked by hand in a browser.
