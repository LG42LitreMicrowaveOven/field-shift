/* Field Shift frontend prototype: hash-routed single page app, plain JS. */
const app = document.getElementById('app');
const state = { profile: null, results: [], report: null, env: null };
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const findCrop = n => cropData.find(c => c.name === n);
const tone = (label, goodHigh = true) => {
  const hi = /^High$/.test(label), lo = /^(Low|Lower)$/.test(label);
  return (hi ? goodHigh : lo && !goodHigh) ? 'good' : (lo ? (goodHigh ? 'bad' : 'good') : (hi ? 'bad' : 'mid'));
};
const badge = (t, goodHigh = true) => `<span class="badge ${tone(t, goodHigh)}">${esc(t)}</span>`;
const seqHtml = seq => `<span class="seq">${seq.map(esc).join('<i> → </i>')}</span>`;
const cropOptions = (sel) => cropData.map(c => `<option ${c.name === sel ? 'selected' : ''}>${c.name}</option>`).join('');

/* ---------- Mock rotation engine (replace with POST /api/rotations/analyze) ---------- */
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
async function generateRotationStrategies(profile) {
  const templates = await getRotationCandidates(); // API: POST /api/rotations/generate
  return templates.map(t => evaluateRotation(t, profile)).sort((a, b) => b.score - a.score).slice(0, 4);
}
async function analyzeRotation(seq, profile) { return evaluateRotation(seq, profile); } // API: POST /api/rotations/analyze

/* ---------- Shared UI pieces ---------- */
function displayEnvironmentalConditions(e) {
  const s = (i, k, v, pct) => `<div class="card stat env"><div class="i">${i}</div><div class="k">${k}</div><div class="v">${v}</div>${pct ? `<div class="bar sky"><i style="width:${pct}%"></i></div>` : ''}</div>`;
  return `<div class="grid">${s('🌧', 'Recent rainfall', e.rainfall + ' mm', Math.min(100, e.rainfall * 1.5))}${s('☀', 'Sunlight', e.sunlight + ' hrs/day', e.sunlight / 12 * 100)}${s('💧', 'Soil moisture', e.soilMoisture, e.soilMoisturePct)}${s('🌡', 'Temperature', e.temperature + '°C', e.temperature / 45 * 100)}${s('🌱', 'Vegetation condition', e.vegetation, e.vegetationPct)}</div>
  <details><summary>Details</summary><p>Moisture index 0.37, vegetation index 0.62, 30-day rainfall total. Shown in plain words above. Demo values; a future version would draw on NASA Earth-observation and weather data.</p></details>`;
}
const fieldSel = (id, label, opts, val) => `<div><label for="${id}">${label}</label><select id="${id}" name="${id}">${opts.map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
function farmFormFields(f) {
  return `<div class="form">
    <div><label for="location">Location</label><select id="location" name="location">${Object.keys(locations).map(l => `<option ${f.location.startsWith(l) ? 'selected' : ''}>${l}, Bangladesh</option>`).join('')}</select></div>
    <div><label for="size">Cultivation land size (hectares)</label><input type="number" id="size" name="size" min="0.1" step="0.1" value="${f.size}"></div>
    ${fieldSel('soil', 'Soil type', ['Clay loam', 'Loam', 'Sandy loam', 'Alluvial', 'Clay'], f.soil)}
    ${fieldSel('previous', 'Current / previous crop', cropData.map(c => c.name), f.previous)}
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

/* ---------- Views ---------- */
const views = {
  home() {
    app.className = 'wide fade';
    app.innerHTML = `<section class="hero"><h1>Field <span>Shift</span></h1>
      <p>Understand your field. Explore your options. Prepare for what's next.</p>
      <div class="bigcards"><a class="bigcard accent" href="#/crops"><div class="ic">🌾</div><h3>Crop Database</h3><small>Browse crops grown near you</small></a>
      <button class="bigcard" id="rotCard"><div class="ic">🔄</div><h3>Rotation Strategy</h3><small>Generate or analyze a rotation</small></button></div>
      <div class="flow"><b>Scattered information</b>→<b>Integrated knowledge</b>→<b>Understandable decision support</b></div></section>`;
    document.getElementById('rotCard').onclick = () => document.getElementById('rotMenu').classList.toggle('open');
  },
  async farm() {
    const [f, env] = await Promise.all([getFarmData(), getEnvironmentalData()]);
    app.innerHTML = `<h1 class="title">My Farm</h1><p class="sub">Your field at a glance.</p>
      <div class="card sky row space"><div><h3>📍 Location</h3><div id="locText" style="font-size:1.3rem;font-weight:600">${esc(f.location)}</div><small id="coords"></small></div>
      <div class="row"><button class="btn" id="geo">Use my location</button><button class="btn ghost" id="chg">Change location</button></div></div>
      <div id="manual" style="display:none;margin-top:12px" class="card"><label for="manLoc">Select your location</label><select id="manLoc">${Object.keys(locations).map(l => `<option>${l}, Bangladesh</option>`).join('')}</select><p><button class="btn" id="manSave">Save location</button></p></div>
      <h2>Current Conditions</h2><span class="note">Demo data: standing in for NASA Earth-observation and weather information.</span>${displayEnvironmentalConditions(env)}
      <h2>Farm Profile</h2><div id="profile"></div>`;
    const renderProfile = f => {
      const it = (k, v) => `<div class="card stat"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`;
      document.getElementById('profile').innerHTML = `<div class="grid">${it('Field size', f.size + ' hectare')}${it('Current crop', f.crop)}${it('Previous crop', f.previous)}${it('Irrigation', f.irrigation)}${it('Main priority', f.priority)}${it('Soil', f.soil)}</div><p><button class="btn yellow" id="edit">Edit Farm Information</button></p>`;
      document.getElementById('edit').onclick = () => editFarm(f);
    };
    const setLoc = async (label, coords) => { f.location = label; await saveFarmData(f); document.getElementById('locText').textContent = label; document.getElementById('coords').textContent = coords || ''; document.getElementById('manual').style.display = 'none'; };
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
    document.getElementById('chg').onclick = () => document.getElementById('manual').style.display = 'block';
    document.getElementById('manSave').onclick = () => setLoc(document.getElementById('manLoc').value);
    document.getElementById('geo').onclick = () => {
      if (!navigator.geolocation) return document.getElementById('manual').style.display = 'block';
      navigator.geolocation.getCurrentPosition(pos => {
        const { latitude: la, longitude: lo } = pos.coords; // Mock reverse geocoding: nearest demo city
        const near = Object.entries(locations).sort((a, b) => Math.hypot(a[1][0] - la, a[1][1] - lo) - Math.hypot(b[1][0] - la, b[1][1] - lo))[0][0];
        setLoc(`Near ${near}, Bangladesh`, `Lat ${la.toFixed(3)}, Lon ${lo.toFixed(3)}`);
      }, () => document.getElementById('manual').style.display = 'block');
    };
  },
  async crops() {
    const data = await getCropData();
    app.innerHTML = `<h1 class="title">Crop Database</h1><p class="sub">Crops commonly grown in your area.</p><input type="search" id="q" placeholder="Search crops..." aria-label="Search crops" style="margin-bottom:16px"><div class="list" id="cl"></div>`;
    const draw = q => { const r = data.filter(c => (c.name + c.season).toLowerCase().includes(q.toLowerCase()));
      document.getElementById('cl').innerHTML = r.map(c => `<button class="item" data-id="${c.id}"><span class="n">${c.emoji}&nbsp; ${c.name}</span><span class="tag ${c.season}">${c.season}</span></button>`).join('') || '<p style="padding:20px">No crops match your search.</p>'; };
    draw(''); document.getElementById('q').oninput = e => draw(e.target.value);
    document.getElementById('cl').onclick = e => { const b = e.target.closest('.item'); if (b) location.hash = '#/crop/' + b.dataset.id; };
  },
  async crop(id) {
    const c = (await getCropData()).find(x => x.id === id); if (!c) return location.hash = '#/crops';
    const it = (k, v) => `<div class="card stat"><div class="k">${k}</div><div class="v" style="font-size:1.1rem">${esc(v)}</div></div>`;
    app.innerHTML = `<button class="back" onclick="location.hash='#/crops'">← Crop Database</button>
      <div class="crophead"><div class="cropimg">${c.emoji}</div><div><h1 class="title" style="color:#fff">${c.name}</h1><p style="margin:0;color:var(--lav)">${c.desc}</p></div></div>
      <div class="grid">${it('Preferred season', c.season)}${it('Growing duration', c.duration)}${it('Temperature', c.temp)}${it('Soil moisture', c.moisture)}${it('Water requirement', c.waterLabel)}${it('Nitrogen requirement', c.nitrogen)}${it('Drought tolerance', c.drought)}${it('Soil requirements', c.soil)}</div>
      <h2>Fertilizer and pests</h2><div class="grid">${it('Fertilizer considerations', c.fertilizer)}${it('Pest and disease considerations', c.pests)}</div>
      <h2>Rotation Considerations</h2><div class="card sky"><p>${c.name} can be placed after ${c.before.slice(0, 2).join(' or ')} in suitable growing windows. Including it may add crop diversification and a different nutrient and water profile from the previous crop.${c.legume ? ' As a legume, it may add nitrogen to the soil.' : ''}</p>
      <p><b>Common preceding crops:</b> ${c.before.join(', ')}<br><b>Compatible following crops:</b> ${c.after.join(', ')}</p>
      <details><summary>Why?</summary><p>Mock demonstration content, not scientifically validated.</p></details></div>`;
  },
  generate() {
    getFarmData().then(f => {
      app.innerHTML = `<h1 class="title">Generate Rotation Strategy</h1><p class="sub">Tell us about your farm and what matters most to you.</p>
        <form id="gf" class="card">${farmFormFields(f)}<h2>Preferred crops</h2><div class="chips">${['Rice', 'Mung Bean', 'Wheat', 'Maize', 'Lentil', 'Mustard'].map(c => `<label class="chip"><input type="checkbox" name="crops" value="${c}"><span>${c}</span></label>`).join('')}</div>
        <p><button class="btn yellow">Generate Strategies</button></p></form>`;
      document.getElementById('gf').onsubmit = e => { e.preventDefault(); const p = readProfile(e.target); state.profile = p;
        runProcessing('Analyzing your farm...', ['Reading farm conditions', 'Checking suitable crops', 'Comparing rotation compatibility', 'Evaluating environmental conditions', 'Considering your priorities'],
          async () => { state.results = await generateRotationStrategies(p); location.hash = '#/results'; }); };
    });
  },
  results() {
    if (!state.results.length) return location.hash = '#/generate';
    app.className = 'fade';
    app.innerHTML = `<h1 class="title">Recommended Rotation Options</h1><p class="sub">Ranked by suitability for your farm and priorities. Demo data.</p>` + state.results.map((r, i) => `
      <div class="card opt"><div class="num">${i + 1}</div><div class="body">${seqHtml(r.seq)}
      <div class="metrics"><span>Suitability<b>${badge(r.suitability)}</b></span><span>Water requirement<b>${esc(r.water)}</b></span><span>Risk<b>${badge(r.risk, false)}</b></span></div>
      <button class="btn ghost" data-toggle="${i}">View Analysis</button>
      <div class="more" id="more${i}"><h3>Why this option?</h3><ul class="ok">${r.reasons.map(x => `<li>${x}</li>`).join('')}</ul>
      <h3>Potential concerns</h3><ul class="warn">${r.concerns.map(x => `<li>${x}</li>`).join('')}</ul>
      <details><summary>Evidence</summary><p>Based on crop water needs, legume contribution, repeat-crop risk and your selected priorities. Demo data; backend research database not connected.</p></details>
      <p><button class="btn" data-report="${i}">View Detailed Report</button></p></div></div></div>`).join('');
  },
  async report() {
    if (!state.report) return location.hash = '#/home';
    const { result: r, profile: p } = state.report, env = await getEnvironmentalData();
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
      <h2>7. Environmental Considerations</h2><div class="card sky"><p>Rainfall, temperature and soil moisture shape planting windows and irrigation needs. Recent rainfall of ${env.rainfall} mm and ${env.soilMoisture.toLowerCase()} soil moisture suggest watching water supply in later stages.</p></div>
      <h2>8. Research / Evidence</h2><div class="demo"><b>Demo data: backend research database not connected.</b><ul>${demoReferences.map(x => `<li>${x}</li>`).join('')}</ul></div>
      <h2>9. What-if / Future Conditions</h2><div class="card"><table><tr><th>Scenario</th><th>Risk level</th><th>Note</th></tr>${sc}</table></div></div>`;
    document.getElementById('dl').onclick = () => {
      const html = `<!DOCTYPE html><meta charset="utf-8"><title>Field Shift Report</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:30px auto;color:#1c2a12}.card,.stat{border:1px solid #ccd;padding:12px;margin:8px 0;border-radius:8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}.bar,details,.back{display:none}</style>${document.getElementById('reportBody').innerHTML}<p><i>Field Shift prototype. Demonstration data only.</i></p>`;
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([html], { type: 'text/html' })), download: 'field-shift-report.html' }); a.click();
    };
  },
  analyze() {
    getFarmData().then(f => {
      app.innerHTML = `<h1 class="title">Analyze My Rotation</h1><p class="sub">Enter the rotation you are considering.</p>
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
    app.innerHTML = `<h1 class="title">Options</h1><p class="sub">Settings for your Field Shift experience.</p>
      <div class="card"><label for="lang">Language</label><select id="lang"><option>English</option><option>বাংলা (coming soon)</option></select><small>Language switching is a placeholder for a future version.</small></div>
      <div class="grid" style="margin-top:14px">${['Notifications', 'Units', 'Data preferences'].map(x => `<div class="card off"><h3>${x}</h3><small>Coming soon</small></div>`).join('')}</div>`;
  }
};

/* ---------- Router ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-toggle]'), r = e.target.closest('[data-report]');
  if (t) document.getElementById('more' + t.dataset.toggle).classList.toggle('open');
  if (r) { state.report = { result: state.results[r.dataset.report], profile: state.profile }; location.hash = '#/report'; }
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
