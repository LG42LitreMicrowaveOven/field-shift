# HarvestV (frontend prototype)
Plain HTML/CSS/JS. All data is demonstration data (js/data.js).
Run: open index.html, or `python3 -m http.server` and visit http://localhost:8000
Deploy: push this folder to a GitHub repo, then Settings > Pages > deploy from branch (root). Hash routing works on Pages.
Backend swap: replace the get*() functions in js/data.js (and evaluateRotation in js/app.js) with fetch("/api/...") calls.
