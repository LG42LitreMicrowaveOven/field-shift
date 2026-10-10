# HarvestV (frontend prototype)
Plain HTML/CSS/JS. All data is demonstration data (js/data.js).
Run: open index.html, or `python3 -m http.server` and visit http://localhost:8000
Deploy: push this folder to a GitHub repo, then Settings > Pages > deploy from branch (root). Hash routing works on Pages.
Backend swap: replace the get*() functions in js/data.js (and evaluateRotation in js/app.js) with fetch("/api/...") calls.

## Backend connection (Stage 1)
My Farm loads environmental data from the HarvestV API. The URL lives only in `js/config.js` (`apiBaseUrl`, default `http://localhost:8000`); change it to your Render URL for production. Serve the frontend on port 5500 or 8080 locally (e.g. `python3 -m http.server 5500`) so CORS allows it. Set `useMockEnvironment: true` for offline demo data, which is always labelled as demo, never NASA.
