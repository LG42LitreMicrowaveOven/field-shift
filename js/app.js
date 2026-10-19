/* HarvestV frontend prototype: hash-routed single page app, plain JS. */
const app = document.getElementById('app');
const state = { profile: null, rotation: null, rotForm: null, report: null, coords: null, env: { data: null, fetchedAt: null, key: null } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const findCrop = n => cropData.find(c => c.name === n);
const tone = (label, goodHigh = true) => {
  const hi = /^High$/.test(label), lo = /^(Low|Lower)$/.test(label);
  return (hi ? goodHigh : lo && !goodHigh) ? 'good' : (lo ? (goodHigh ? 'bad' : 'good') : (hi ? 'bad' : 'mid'));
};
const badge = (t, goodHigh = true) => `<span class="badge ${tone(t, goodHigh)}">${esc(t)}</span>`;
const seqHtml = seq => `<span class="seq">${seq.map(esc).join('<i> → </i>')}</span>`;
const cropOptions = (sel) => cropData.map(c => `<option ${c.name === sel ? 'selected' : ''}>${c.name}</option>`).join('');

/* ---------- DEMO scoring, used ONLY by "Analyze My Rotation" and its report (not produced by the rotation engine) ----------
   Generated sequences come from POST /api/rotations/generate (see js/rotation.js). */
function evaluateRotation(seq, p) {
  const crops = seq.map(findCrop), avgWater = crops.reduce((s, c) => s + c.water, 0) / crops.length;
  const legume = crops.some(c => c.legume), unique = new Set(seq).size;
  const repeats = seq.some((c, i) => c === seq[(i + 1) % seq.length]);
  const irr = p.irrigation || 'Limited', weakIrr = irr === 'Limited' || irr === 'None';
  let risk = 0.4;
  if (avgWater >= 2.3 && weakIrr) risk += 1; else if (avgWater >= 2 && weakIrr) risk += .5;
  if (repeats) risk += 1; if (!legume) risk += .5;
  if (weakIrr && crops.some(c => c.drought === 'Low')) risk += .4;
  const riskLabel = risk < .8 ? 'Low' : risk < 1.5 ? 'Low–Moderate' : risk < 2.2 ? 'Moderate' : 'High';
  const pri = p.priorities || [];
  let score = 3 - risk * .6 + (legume ? .5 : 0) + (unique > 1 ? .3 : 0);
  const has = k => pri.includes(k), fit = [];
  if (has('Water efficiency') && avgWater < 2.2) { score += .5; fit.push('Lower overall water demand'); }
  if (has('Soil health') && legume) { score += .5; fit.push('Includes a nitrogen-fixing legume'); }
  if (has('Profitability') && seq.some(c => ['Potato', 'Maize', 'Mustard', 'Tomato'].includes(c))) { score += .4; fit.push('Includes higher-value crops'); }
  if (has('Lower risk') && risk < 1.5) { score += .4; fit.push('Lower-risk profile'); }
  if (has('Crop diversification') && unique >= 3) { score += .4; fit.push('Three different crops'); }
  if (has('Lower fertilizer requirement') && legume) { score += .4; fit.push('Legume may reduce nitrogen needs'); }
  const preferred = (p.crops || []).filter(c => seq.includes(c)).length; score += preferred * .15;
  const L = n => n >= 2.5 ? 'High' : n >= 1.8 ? 'Moderate' : 'Lower';
  const waterLabel = avgWater < 1.8 ? 'Low–Moderate' : avgWater < 2.4 ? 'Moderate' : 'Moderate–High';
  const seasonOk = seq.every((c, i) => i === 0 || findCrop(seq[i - 1]).after.includes(c) || c === 'Rice');
  const ratings = {
    'Environmental compatibility': weakIrr && avgWater > 2.3 ? 2 : 3,
    'Water compatibility': avgWater < 1.8 ? 3 : avgWater < 2.4 ? 2 : (weakIrr ? 1.2 : 2),
    'Seasonal compatibility': seasonOk ? 3 : 2,
    'Rotation compatibility': repeats ? 1.5 : (legume ? 3 : 2.3),
  };
  const strengths = [], risks = [], reasons = [], concerns = [];
  if (seasonOk) { strengths.push('Good seasonal compatibility'); reasons.push('Fits the selected growing seasons'); } else concerns.push('Check that planting windows line up');
  if (unique >= 3) strengths.push('Diversified crop sequence');
  if (legume) { strengths.push('Legume may support soil nitrogen'); reasons.push('Includes crops with different resource requirements'); }
  if (!weakIrr || avgWater < 2.3) { strengths.push('Compatible with selected water conditions'); reasons.push('Compatible with the selected irrigation level'); }
  fit.forEach(f => reasons.push(f));
  if (pri.length) reasons.push('Matches your selected priorities');
  if (weakIrr && avgWater >= 2) { risks.push('Possible water stress'); concerns.push('Possible late-season water stress'); }
  if (repeats) { risks.push('Same crop repeated back-to-back'); concerns.push('Repeated crops can build up pests and disease'); }
  if (!legume) risks.push('No legume to rebuild soil nitrogen');
  risks.push('Planting-window sensitivity'); concerns.push('Requires appropriate planting window');
  return { seq, score, suitability: score >= 3.4 ? 'High' : score >= 2.6 ? 'Moderate' : 'Lower', water: waterLabel, risk: riskLabel, risk_pts: risk,
    ratings: Object.fromEntries(Object.entries(ratings).map(([k, v]) => [k, v])), ratingLabel: L, strengths, risks, reasons, concerns };
}
async function analyzeRotation(seq, profile) { return evaluateRotation(seq, profile); } // API: POST /api/rotations/analyze

/* ---------- Shared UI pieces ---------- */
/* `e` comes from toEnvironmentView() in data.js; null means the data is unavailable. */
function displayEnvironmentalConditions(e) {
  if (!e) return `<div class="card sky">Environmental data is currently unavailable.</div>`;
  const has = v => v !== null && v !== undefined, na = 'Not available yet';
  const s = (i, k, v, pct) => `<div class="card stat env"><div class="i">${i}</div><div class="k">${k}</div><div class="v"${v === na ? ' style="font-size:1rem"' : ''}>${v}</div>${pct != null ? `<div class="bar sky"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>` : ''}</div>`;
  const solarMax = /kWh/i.test(e.solarUnits) ? 8 : 30;
  return `<div class="grid">
    ${s('🌡', 'Temperature (daily average)', e.temperature + '°C', e.temperature / 45 * 100)}
    ${s('🌧', `Rainfall (last ${e.rainfallDays} days)`, e.rainfall + ' mm', e.rainfall * 1.5)}
    ${s('☀', 'Solar radiation', `${e.solar} ${esc(e.solarUnits)}`, e.solar / solarMax * 100)}
    ${s('💧', 'Soil moisture', has(e.soilMoisture) ? e.soilMoisture : na)}
    ${s('🌱', 'Vegetation condition', has(e.ndvi) ? e.ndvi : na)}</div>
  <details><summary>Details</summary><p>Source: ${esc(e.source)}. Latest available daily data: ${esc(e.dataDate)} (NASA POWER daily data arrives with a short delay, so this is recent rather than live). Temperature is the average air temperature at 2 m. Rainfall is corrected precipitation summed over the days shown. Solar radiation is the sunlight reaching the ground on a typical sky. Soil moisture (NASA SMAP) and vegetation condition (NASA MODIS) will be added later.</p></details>`;
}
const fieldSel = (id, label, opts, val) => `<div><label for="${id}">${label}</label><select id="${id}" name="${id}">${opts.map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
function farmFormFields(f, { skipPrevious = false } = {}) {
  return `<div class="form">
    <div><label for="location">Location</label><select id="location" name="location">${Object.keys(locations).map(l => `<option ${f.location.startsWith(l) ? 'selected' : ''}>${l}, Bangladesh</option>`).join('')}</select></div>
    <div><label for="size">Cultivation land size (hectares)</label><input type="number" id="size" name="size" min="0.1" step="0.1" value="${f.size}"></div>
    ${fieldSel('soil', 'Soil type', ['Clay loam', 'Loam', 'Sandy loam', 'Alluvial', 'Clay'], f.soil)}
    ${skipPrevious ? '' : fieldSel('previous', 'Current / previous crop', cropData.map(c => c.name), f.previous)}
    ${fieldSel('irrigation', 'Irrigation capability', ['None', 'Limited', 'Moderate', 'Reliable'], f.irrigation)}
    ${fieldSel('labour', 'Labour availability', ['Family only', 'Limited hired labour', 'Good availability'], 'Family only')}
  </div>
  <h2>What matters most to you?</h2>
  <div class="chips">${['Water efficiency', 'Soil health', 'Profitability', 'Lower risk', 'Crop diversification', 'Lower fertilizer requirement'].map(p => `<label class="chip"><input type="checkbox" name="priorities" value="${p}" ${p === f.priority ? 'checked' : ''}><span>${p}</span></label>`).join('')}</div>`;
}
function readProfile(form) {
  const d = new FormData(form);
  return { location: d.get('location'), size: d.get('size'), soil: d.get('soil'), previous: d.get('previous'), irrigation: d.get('irrigation'), labour: d.get('labour'), priorities: d.getAll('priorities'), crops: d.getAll('crops') };
}
function runProcessing(title, steps, done) {
  app.innerHTML = `<div class="proc"><div class="spin"></div><h1 class="title">${title}</h1><ul class="steps">${steps.map(s => `<li>${s}</li>`).join('')}</ul><p class="sub">Preparing results…</p></div>`;
  const lis = [...app.querySelectorAll('li')];
  lis.forEach((li, i) => setTimeout(() => li.classList.add('done'), 250 + i * 300));
  setTimeout(done, 250 + lis.length * 300 + 200);
}

/* ---------- Environmental data loading (Stage 1) ---------- */
let envRequestId = 0; // lets us ignore stale responses if the location changes mid-request
const envKey = c => c.latitude.toFixed(2) + ',' + c.longitude.toFixed(2);
/* Coordinates priority: browser GPS this session > saved farm coordinates > demo city coordinates. */
function resolveCoords(farm) {
  if (state.coords) return state.coords;
  if (farm.latitude != null && farm.longitude != null) return { latitude: farm.latitude, longitude: farm.longitude };
  const c = locations[(farm.location || '').replace('Near ', '').split(',')[0]];
  return c ? { latitude: c[0], longitude: c[1] } : null;
}
/* Uses GPS silently only if the user already granted permission (no surprise prompt). */
async function tryBrowserLocation() {
  if (!navigator.geolocation || !navigator.permissions) return null;
  try { if ((await navigator.permissions.query({ name: 'geolocation' })).state !== 'granted') return null; } catch (e) { return null; }
  return new Promise(res => navigator.geolocation.getCurrentPosition(
    pos => res({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }), () => res(null), { timeout: 8000 }));
}
function renderEnvBox({ loading = false, error = null, onRetry = null } = {}) {
  const box = document.getElementById('envBox'); if (!box) return; // user already navigated away
  const { data, fetchedAt } = state.env;
  let html = loading ? '<div class="note">Fetching the latest NASA environmental data…</div>' : '';
  if (error) html += `<div class="note">${esc(error)}${data ? ' Showing the last data we received.' : ''}</div>`;
  html += displayEnvironmentalConditions(data);
  if (data) {
    const t = fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    html += `<p class="sub" style="margin:12px 0 0">Last updated: ${t} · ${data.isMock ? 'Demo data, not from NASA' : 'NASA POWER daily data through ' + esc(data.dataDate)}</p>`;
  }
  if (onRetry) html += '<p><button class="btn ghost" id="retryEnv">Try again</button></p>';
  box.innerHTML = html;
  if (onRetry) document.getElementById('retryEnv').onclick = onRetry;
}
/* Called once per visit to My Farm (and when the location changes), never on a timer. */
async function loadEnvironment(farm) {
  const coords = resolveCoords(farm), id = ++envRequestId;
  if (!coords) return renderEnvBox({ error: 'Choose a location to see environmental data.' });
  const key = envKey(coords);
  if (state.env.key !== key) state.env = { data: null, fetchedAt: null, key }; // never show another place's data
  renderEnvBox({ loading: true });
  try {
    const data = toEnvironmentView(await getEnvironmentalData(coords.latitude, coords.longitude));
    if (id !== envRequestId) return;
    state.env = { data, fetchedAt: new Date(), key };
    renderEnvBox();
  } catch (err) {
    console.warn('Environmental data request failed:', err);
    if (id === envRequestId) renderEnvBox({ error: 'Environmental data is currently unavailable.', onRetry: () => loadEnvironment(farm) });
  }
}
/* For the report page: reuse what My Farm already loaded; fetch once only if nothing is cached. */
async function ensureEnvironment() {
  if (state.env.data) return state.env.data;
  try {
    const c = resolveCoords(await getFarmData()); if (!c) return null;
    const data = toEnvironmentView(await getEnvironmentalData(c.latitude, c.longitude));
    state.env = { data, fetchedAt: new Date(), key: envKey(c) };
    return data;
  } catch (err) { console.warn('Environmental data request failed:', err); return null; }
}

/* Rotation pages and farm forms read the crop catalog synchronously, so make sure it is loaded first. */
async function ensureCropCatalog() {
  const stamp = location.hash;
  try { await getCropData(); return location.hash === stamp; }
  catch (err) {
    console.warn('Crop catalog request failed:', err);
    if (location.hash !== stamp) return false;
    app.innerHTML = `<h1 class="title">Crop information is currently unavailable</h1><p class="sub">We couldn't load the crop database. Please try again in a moment.</p><p><button class="btn" id="retryCrops">Try again</button></p>`;
    document.getElementById('retryCrops').onclick = route;
    return false;
  }
}

/* ---------- Views ---------- */
const views = {
  home() {
    app.className = 'wide fade';
    app.innerHTML = `<section class="hero"><h1>Harvest<span>V</span></h1>
      <p>Understand your field. Explore your options. Prepare for what's next.</p>
      <div class="bigcards"><a class="bigcard accent" href="#/crops"><div class="ic">🌾</div><h3>Crop Database</h3><small>Browse crops grown near you</small></a>
      <button class="bigcard" id="rotCard"><div class="ic">🔄</div><h3>Rotation Strategy</h3><small>Generate or analyze a rotation</small></button></div>
      <div class="flow"><b>Scattered information</b>→<b>Integrated knowledge</b>→<b>Understandable decision support</b></div></section>`;
    document.getElementById('rotCard').onclick = () => document.getElementById('rotMenu').classList.toggle('open');
  },
  async farm() {
    const f = await getFarmData();
    app.innerHTML = `<h1 class="title">My Farm</h1><p class="sub">Your field at a glance.</p>
      <div class="card sky row space"><div><h3>📍 Location</h3><div id="locText" style="font-size:1.3rem;font-weight:600">${esc(f.location)}</div><small id="coords"></small></div>
      <div class="row"><button class="btn" id="geo">Use my location</button><button class="btn ghost" id="chg">Change location</button></div></div>
      <div id="manual" style="display:none;margin-top:12px" class="card"><label for="manLoc">Select your location</label><select id="manLoc">${Object.keys(locations).map(l => `<option>${l}, Bangladesh</option>`).join('')}</select><p><button class="btn" id="manSave">Save location</button></p></div>
      <h2>Current Conditions</h2><div id="envBox"></div>
      <h2>Farm Profile</h2><div id="profile"></div>`;
    const manual = document.getElementById('manual'), coordsEl = document.getElementById('coords');
    const renderProfile = f => {
      const it = (k, v) => `<div class="card stat"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`;
      document.getElementById('profile').innerHTML = `<div class="grid">${it('Field size', f.size + ' hectare')}${it('Current crop', f.crop)}${it('Previous crop', f.previous)}${it('Irrigation', f.irrigation)}${it('Main priority', f.priority)}${it('Soil', f.soil)}</div><p><button class="btn yellow" id="edit">Edit Farm Information</button></p>`;
      document.getElementById('edit').onclick = async () => {
        try { await getCropData(); editFarm(f); }
        catch (err) { document.getElementById('edit').insertAdjacentHTML('afterend', ' <span class="note">Crop list is currently unavailable.</span>'); }
      };
    };
    /* Saves the new location and fetches environmental data for it (one request per change). */
    const setLoc = async (label, text, coords) => {
      f.location = label;
      if (coords) { f.latitude = coords.latitude; f.longitude = coords.longitude; state.coords = coords; }
      await saveFarmData(f);
      document.getElementById('locText').textContent = label; coordsEl.textContent = text || ''; manual.style.display = 'none';
      loadEnvironment(f);
    };
    function editFarm(f) {
      document.getElementById('profile').innerHTML = `<form class="card" id="ef"><div class="form">
        <div><label>Field size (ha)</label><input type="number" name="size" step="0.1" value="${f.size}"></div>
        ${fieldSel('crop', 'Current crop', cropData.map(c => c.name), f.crop)}${fieldSel('previous', 'Previous crop', cropData.map(c => c.name), f.previous)}
        ${fieldSel('irrigation', 'Irrigation', ['None', 'Limited', 'Moderate', 'Reliable'], f.irrigation)}
        ${fieldSel('priority', 'Main priority', ['Water efficiency', 'Soil health', 'Profitability', 'Lower risk', 'Crop diversification'], f.priority)}</div>
        <p class="row"><button class="btn">Save</button><button type="button" class="btn ghost" id="cancel">Cancel</button></p></form>`;
      document.getElementById('cancel').onclick = () => renderProfile(f);
      document.getElementById('ef').onsubmit = async e => { e.preventDefault(); Object.assign(f, Object.fromEntries(new FormData(e.target))); await saveFarmData(f); renderProfile(f); };
    }
    renderProfile(f);
    document.getElementById('chg').onclick = () => manual.style.display = 'block';
    document.getElementById('manSave').onclick = () => {
      const label = document.getElementById('manLoc').value, c = locations[label.split(',')[0]];
      setLoc(label, '', { latitude: c[0], longitude: c[1] });
    };
    document.getElementById('geo').onclick = () => {
      if (!navigator.geolocation) { coordsEl.textContent = 'This browser does not support location. Please choose a location.'; manual.style.display = 'block'; return; }
      navigator.geolocation.getCurrentPosition(pos => {
        const { latitude: la, longitude: lo } = pos.coords; // Mock reverse geocoding: nearest demo city (label only)
        const near = Object.entries(locations).sort((a, b) => Math.hypot(a[1][0] - la, a[1][1] - lo) - Math.hypot(b[1][0] - la, b[1][1] - lo))[0][0];
        setLoc(`Near ${near}, Bangladesh`, `Lat ${la.toFixed(3)}, Lon ${lo.toFixed(3)}`, { latitude: la, longitude: lo });
      }, () => { coordsEl.textContent = 'Location permission was not granted. Please choose a location.'; manual.style.display = 'block'; }, { timeout: 10000 });
    };
    // One environmental request per visit: use GPS if already permitted, otherwise the saved/chosen location.
    if (!state.coords) { const c = await tryBrowserLocation(); if (c) state.coords = c; }
    loadEnvironment(f);
  },
  async crops() {
    const stamp = location.hash;
    app.innerHTML = `<h1 class="title">Crop Database</h1><p class="sub">Crops commonly grown in your area.</p><input type="search" id="q" placeholder="Search crops..." aria-label="Search crops" style="margin-bottom:16px" disabled><div class="list" id="cl"><p style="padding:20px">Loading crops…</p></div>`;
    const search = document.getElementById('q'), list = document.getElementById('cl');
    let data;
    try { data = await getCropData(); }
    catch (err) {
      console.warn('Crop list request failed:', err);
      if (location.hash !== stamp) return;
      list.innerHTML = `<div style="padding:20px"><p>The crop database is currently unavailable.</p><button class="btn" id="retryCrops">Try again</button></div>`;
      document.getElementById('retryCrops').onclick = () => views.crops();
      return;
    }
    if (location.hash !== stamp) return; // user already navigated elsewhere
    search.disabled = false;
    const draw = q => { const r = data.filter(c => (c.name + c.season).toLowerCase().includes(q.toLowerCase()));
      list.innerHTML = r.map(c => `<button class="item" data-id="${c.id}"><span class="n">${c.emoji}&nbsp; ${c.name}</span><span class="tag ${c.season}">${c.season}</span></button>`).join('') || '<p style="padding:20px">No crops match your search.</p>'; };
    draw(''); search.oninput = e => draw(e.target.value);
    list.onclick = e => { const b = e.target.closest('.item'); if (b) location.hash = '#/crop/' + b.dataset.id; };
  },
  async crop(id) {
    const stamp = location.hash, back = `<button class="back" onclick="location.hash='#/crops'">← Crop Database</button>`;
    app.innerHTML = `${back}<p class="sub" style="margin-top:20px">Loading crop details…</p>`;
    let c;
    try { c = await getCropById(id); } // GET /api/crops/{id}
    catch (err) {
      console.warn('Crop detail request failed:', err);
      if (location.hash !== stamp) return;
      app.innerHTML = err.status === 404
        ? `${back}<h1 class="title" style="margin-top:14px">Crop not found</h1><p class="sub">We couldn't find that crop. The link may be wrong or the crop may have been removed.</p>`
        : `${back}<h1 class="title" style="margin-top:14px">Crop details are currently unavailable</h1><p class="sub">Please try again in a moment.</p><p><button class="btn" id="retryCrop">Try again</button></p>`;
      const retry = document.getElementById('retryCrop'); if (retry) retry.onclick = () => views.crop(id);
      return;
    }
    if (location.hash !== stamp) return;
    const it = (k, v) => `<div class="card stat"><div class="k">${k}</div><div class="v" style="font-size:1.1rem">${esc(v)}</div></div>`;
    app.innerHTML = `${back}
      <div class="crophead"><div class="cropimg">${c.emoji}</div><div><h1 class="title" style="color:#fff">${c.name}</h1><p style="margin:0;color:var(--lav)">${c.desc}</p></div></div>
      <div class="grid">${it('Preferred season', c.season)}${it('Growing duration', c.duration)}${it('Temperature', c.temp)}${it('Soil moisture', c.moisture)}${it('Water requirement', c.waterLabel)}${it('Nitrogen requirement', c.nitrogen)}${it('Drought tolerance', c.drought)}${it('Soil requirements', c.soil)}</div>
      <h2>Fertilizer and pests</h2><div class="grid">${it('Fertilizer considerations', c.fertilizer)}${it('Pest and disease considerations', c.pests)}</div>
      <h2>Rotation Considerations</h2><div class="card sky"><p>${c.name} can be placed after ${c.before.slice(0, 2).join(' or ')} in suitable growing windows. Including it may add crop diversification and a different nutrient and water profile from the previous crop.${c.legume ? ' As a legume, it may add nitrogen to the soil.' : ''}</p>
      <p><b>Common preceding crops:</b> ${c.before.join(', ')}<br><b>Compatible following crops:</b> ${c.after.join(', ')}</p>
      <details><summary>Why?</summary><p>Mock demonstration content, not scientifically validated.</p></details></div>`;
  },
  async generate() {
    if (!(await ensureCropCatalog())) return;
    const stamp = location.hash, f = await getFarmData();
    if (location.hash !== stamp) return;
    const seasons = rotSeasonOptions(cropData), byName = n => (cropData.find(c => c.name === n) || {}).id || '';
    // Form state survives a round trip to the results page. Slots start empty on purpose: seasons are never assumed.
    const st = state.rotForm || { slots: ['', '', ''], previousId: byName(f.previous), mode: 'exploratory', cyclic: false, preferredIds: [], excludedIds: [] };
    const slotSelects = slots => slots.map((v, i) => `<div><label for="slot${i}">Slot ${i + 1} season</label><select id="slot${i}" name="slot"><option value="">Choose a season…</option>${seasons.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>`).join('');
    const crops = (name, ids) => cropData.map(c => `<label class="chip"><input type="checkbox" name="${name}" value="${esc(c.id)}" ${ids.includes(c.id) ? 'checked' : ''}><span>${c.emoji ? esc(c.emoji) + ' ' : ''}${esc(c.name)}</span></label>`).join('');
    app.innerHTML = `<h1 class="title">Generate Rotation Strategy</h1><p class="sub">Build exploratory crop sequences from the crop catalog, one season slot at a time.</p>${rotDisclaimerHtml()}
      <div id="rotMsg" aria-live="polite"></div>
      <form id="gf" class="card" novalidate>
        <h2 style="margin-top:0">Rotation plan <span class="used">Used to generate sequences</span></h2>
        <div class="form">
          <div><label for="rotLen">Number of seasons</label><select id="rotLen">${Array.from({ length: ROT_MAX_SLOTS }, (_, i) => `<option ${i + 1 === st.slots.length ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>
          <div><label for="prevCrop">Previous crop</label><select id="prevCrop"><option value="">None / not specified</option>${cropData.map(c => `<option value="${esc(c.id)}" ${c.id === st.previousId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div><label for="rotMode">Transition mode</label><select id="rotMode">${Object.entries(ROT_MODES).map(([k, v]) => `<option value="${k}" ${k === st.mode ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        </div>
        <h3 style="margin-top:18px">Season for each slot</h3>
        <div class="form" id="slotBox">${slotSelects(st.slots)}</div>
        <p class="hint">Season labels come from the crop catalog. They are coarse labels, not a local planting calendar. Crops labelled “All Seasons” can fit any slot.</p>
        <label class="chip" style="margin-top:6px"><input type="checkbox" id="rotCyclic" ${st.cyclic ? 'checked' : ''}><span>Cyclic: also check that the last crop can lead back to the first</span></label>
        <h3 style="margin-top:18px">Preferred crops <span class="used">Ranking only</span></h3>
        <div class="chips">${crops('pref', st.preferredIds)}</div>
        <h3 style="margin-top:18px">Crops to leave out</h3>
        <div class="chips">${crops('excl', st.excludedIds)}</div>
        <div class="unused"><h2 style="margin-top:0">About your farm <span class="used off">Not used to rank rotations yet</span></h2>
          <p class="hint">These details are collected for future features. They do not change the sequences generated today.</p>${farmFormFields(f, { skipPrevious: true })}</div>
        <p><button class="btn yellow" id="gBtn">Generate Strategies</button></p></form>`;
    const form = document.getElementById('gf'), msg = document.getElementById('rotMsg'), btn = document.getElementById('gBtn');
    const read = () => ({
      slots: [...form.querySelectorAll('select[name=slot]')].map(x => x.value), previousId: form.prevCrop.value, mode: form.rotMode.value,
      cyclic: form.rotCyclic.checked, preferredIds: [...form.querySelectorAll('input[name=pref]:checked')].map(x => x.value),
      excludedIds: [...form.querySelectorAll('input[name=excl]:checked')].map(x => x.value) });
    const show = (kind, html) => { msg.innerHTML = html ? `<div class="alert ${kind}" role="${kind === 'info' ? 'status' : 'alert'}">${html}</div>` : ''; };
    document.getElementById('rotLen').onchange = e => { // resize the slot list, keeping what was already chosen
      const n = +e.target.value, cur = read().slots;
      document.getElementById('slotBox').innerHTML = slotSelects(Array.from({ length: n }, (_, i) => cur[i] || ''));
    };
    let pending = false;
    form.onsubmit = async e => {
      e.preventDefault();
      if (pending) return; // no duplicate submissions
      const input = read(); state.rotForm = input; state.rotation = null; // an old result must never look like this request's
      const { errors, payload } = buildRotationRequest(input, cropData);
      if (errors.length) return show('err', `<b>Please fix:</b><ul>${errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`);
      pending = true; btn.disabled = true; btn.textContent = 'Generating…';
      show('info', 'Generating sequences… If the server has been idle this can take up to a minute.');
      try {
        const response = await requestRotations(payload);
        if (!response || !Array.isArray(response.results) || !response.search || !response.input) throw new Error('Unexpected rotation data format.');
        state.rotation = { request: payload, response };
        if (location.hash === stamp) location.hash = '#/results';
      } catch (err) {
        console.warn('Rotation request failed:', err);
        const m = rotationErrorMessage(err);
        if (document.body.contains(form)) show('err', `<b>${m.kind === 'validation' ? 'This request could not be used' : 'Something went wrong'}.</b> ${esc(m.message)}`);
      } finally {
        pending = false;
        if (document.body.contains(form)) { btn.disabled = false; btn.textContent = 'Generate Strategies'; }
      }
    };
  },
  results() {
    const r = state.rotation;
    if (!r) return location.hash = '#/generate';
    app.className = 'fade';
    app.innerHTML = `<button class="back" onclick="location.hash='#/generate'">← Change settings</button><div style="margin-top:14px">${renderRotationResults(r.response, cropData)}</div>`;
  },
  async report() {
    if (!state.report) return location.hash = '#/home';
    const { result: r, profile: p } = state.report, env = await ensureEnvironment();
    const pri = (p.priorities || []).join(', ') || 'None selected';
    const crops = r.seq.filter((c, i) => r.seq.indexOf(c) === i).map(findCrop);
    const sc = whatIfScenarios.map(s => { const pts = r.risk_pts + s.water * (r.water === 'Low–Moderate' ? .4 : 1);
      const l = pts < .8 ? 'Low' : pts < 1.5 ? 'Low–Moderate' : pts < 2.2 ? 'Moderate' : 'High'; return `<tr><td>${s.name}</td><td>${badge(l, false)}</td><td>${s.note}</td></tr>`; }).join('');
    const kv = (k, v) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`;
    app.innerHTML = `<div class="row space"><button class="back" onclick="history.back()">← Back</button><button class="btn yellow" id="dl">Download Detailed Report</button></div>
      <div id="reportBody" class="report"><h1 class="title">Rotation Analysis Report</h1><p>${seqHtml(r.seq)}</p><p>Overall: ${badge(r.suitability)} suitability · Risk ${badge(r.risk, false)}</p>
      <h2>1. Farm Profile</h2><div class="card"><table>${kv('Location', p.location || 'Rangpur, Bangladesh')}${kv('Field size', (p.size || '1.0') + ' hectare')}${kv('Soil', p.soil || '-')}${kv('Irrigation', p.irrigation || '-')}${kv('Previous crop', p.previous || '-')}${kv('Priorities', pri)}</table></div>
      <h2>2. Current Environmental Conditions</h2>${displayEnvironmentalConditions(env)}
      <h2>3. Crop Information</h2><div class="grid">${crops.map(c => `<div class="card"><h3>${c.emoji} ${c.name}</h3><small>${c.season} · ${c.duration}<br>Water: ${c.waterLabel}<br>Nitrogen: ${c.nitrogen}<br>Pests: ${c.pests}</small></div>`).join('')}</div>
      <h2>4. Rotation Reasoning</h2><div class="card"><ul class="ok">${r.reasons.map(x => `<li>${x}</li>`).join('')}</ul></div>
      <h2>5. Benefits</h2><div class="card"><ul class="ok">${r.strengths.map(x => `<li>${x}</li>`).join('')}</ul></div>
      <h2>6. Risks and Limitations</h2><div class="card"><ul class="warn">${r.risks.map(x => `<li>${x}</li>`).join('')}<li>Mock scoring only; not validated against field trials</li></ul></div>
      <h2>7. Environmental Considerations</h2><div class="card sky"><p>Rainfall, temperature and soil moisture shape planting windows and irrigation needs. ${env ? `Recent NASA environmental data shows ${env.rainfall} mm of rain over ${env.rainfallDays} days and a daily average of ${env.temperature}°C, which is worth keeping in mind for water planning.` : 'Environmental data was not available when this report was prepared.'}</p></div>
      <h2>8. Research / Evidence</h2><div class="demo"><b>Demo data: backend research database not connected.</b><ul>${demoReferences.map(x => `<li>${x}</li>`).join('')}</ul></div>
      <h2>9. What-if / Future Conditions</h2><div class="card"><table><tr><th>Scenario</th><th>Risk level</th><th>Note</th></tr>${sc}</table></div></div>`;
    document.getElementById('dl').onclick = () => {
      const html = `<!DOCTYPE html><meta charset="utf-8"><title>HarvestV Report</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:30px auto;color:#1c2a12}.card,.stat{border:1px solid #ccd;padding:12px;margin:8px 0;border-radius:8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}.bar,details,.back{display:none}</style>${document.getElementById('reportBody').innerHTML}<p><i>HarvestV prototype. Demonstration data only.</i></p>`;
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([html], { type: 'text/html' })), download: 'field-shift-report.html' }); a.click();
    };
  },
  async analyze() {
    if (!(await ensureCropCatalog())) return;
    getFarmData().then(f => {
      app.innerHTML = `<h1 class="title">Analyze My Rotation</h1><p class="sub">Enter the rotation you are considering.</p><p class="disclaimer" role="note">Demo scoring: this page uses illustrative placeholder logic, not the rotation engine behind “Generate Rotation Strategy”. Do not treat its ratings as agronomic advice.</p>
        <form id="af" class="card"><div class="form">${[['Crop 1', 'Rice'], ['Crop 2', 'Mung Bean'], ['Crop 3', 'Rice']].map(([l, v], i) => `<div><label for="c${i}">${l}</label><select id="c${i}" name="seq">${cropOptions(v)}</select></div>`).join('')}</div>
        <h2>Your farm</h2>${farmFormFields(f)}<p><button class="btn yellow">Analyze Rotation</button></p></form>`;
      document.getElementById('af').onsubmit = e => { e.preventDefault(); const p = readProfile(e.target), seq = new FormData(e.target).getAll('seq'); state.profile = p;
        runProcessing('Analyzing your rotation...', ['Checking crop compatibility', 'Checking environmental conditions', 'Checking farm constraints', 'Evaluating potential risks', 'Preparing analysis'],
          async () => { state.analysis = await analyzeRotation(seq, p); views.analysis(); history.replaceState(null, '', '#/analysis'); }); };
    });
  },
  analysis() {
    const r = state.analysis; if (!r) return location.hash = '#/analyze';
    const n = v => v >= 2.5 ? 'High' : v >= 1.8 ? 'Moderate' : 'Lower';
    state.report = { result: r, profile: state.profile };
    app.innerHTML = `<h1 class="title">Rotation Analysis</h1><p>${seqHtml(r.seq)}</p><div class="card sky">Overall assessment: <b>${r.suitability === 'High' ? 'Potentially suitable' : r.suitability === 'Moderate' ? 'Suitable with care' : 'Lower suitability'}</b></div>
      <h2>How it looks</h2><div class="card">${Object.entries(r.ratings).map(([k, v]) => `<div class="rate"><span>${k}</span><div class="bar"><i style="width:${v / 3 * 100}%"></i></div>${badge(n(v))}</div>`).join('')}
      <div class="rate"><span>Risk level</span><div class="bar"><i style="width:${Math.min(100, r.risk_pts / 3 * 100)}%;background:var(--sky)"></i></div>${badge(r.risk, false)}</div></div>
      <div class="grid"><div><h2>Strengths</h2><ul class="ok">${r.strengths.map(x => `<li>${x}</li>`).join('')}</ul></div><div><h2>Potential Risks</h2><ul class="warn">${r.risks.map(x => `<li>${x}</li>`).join('')}</ul></div></div>
      <details><summary>Why this assessment?</summary><p>${r.reasons.join('. ') || 'Based on crop water needs, legume contribution and rotation order.'}. Demo scoring; not a prediction.</p></details>
      <p><button class="btn" id="vr">View Detailed Report</button></p>`;
    document.getElementById('vr').onclick = () => location.hash = '#/report';
  },
  options() {
    app.innerHTML = `<h1 class="title">Options</h1><p class="sub">Settings for your HarvestV experience.</p>
      <div class="card"><label for="lang">Language</label><select id="lang"><option>English</option><option>বাংলা (coming soon)</option></select><small>Language switching is a placeholder for a future version.</small></div>
      <div class="grid" style="margin-top:14px">${['Notifications', 'Units', 'Data preferences'].map(x => `<div class="card off"><h3>${x}</h3><small>Coming soon</small></div>`).join('')}</div>`;
  }
};

/* ---------- Router ---------- */
document.addEventListener('click', e => {
  if (e.target.closest('#rotBtn')) document.getElementById('rotMenu').classList.toggle('open');
  else if (!e.target.closest('#rotCard')) document.getElementById('rotMenu').classList.remove('open');
});
async function route() {
  const [, name = 'home', arg] = location.hash.slice(1).split('/');
  const view = views[name] || views.home;
  app.className = name === 'home' ? 'wide fade' : 'fade';
  document.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('on', a.dataset.route === name || (name === 'crop' && a.dataset.route === 'crops')));
  document.getElementById('nav').style.background = name === 'home' ? 'transparent' : '';
  window.scrollTo(0, 0);
  await view(arg);
}
window.addEventListener('hashchange', route);
route();
