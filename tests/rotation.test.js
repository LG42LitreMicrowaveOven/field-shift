/* Frontend tests for js/config.js + js/data.js + js/rotation.js (no browser needed).
   Run from field-shift/:   node --test tests/
   fetch is mocked. Fixtures in tests/fixtures/ are REAL engine output (generated from the seed catalog via
   services/rotation_service.py), so the renderer is tested against the true response shape.
   What this does NOT cover: js/app.js DOM wiring (form, routing), which needs a browser. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const fx = n => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n + '.json'), 'utf8'));

function load(fetchImpl) {
  const calls = [];
  const ctx = vm.createContext({
    fetch: async (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); },
    AbortController, setTimeout, clearTimeout, console, localStorage: { getItem: () => null, setItem() {} }
  });
  for (const f of ['config.js', 'data.js', 'rotation.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx, { filename: f });
  const api = vm.runInContext('({HARVESTV_CONFIG, apiPost, apiGet, describeApiDetail, toCropView, buildRotationRequest, requestRotations, rotationErrorMessage, renderRotationResults, rotSeasonOptions, ROT_DISCLAIMER, ROT_MAX_SLOTS})', ctx);
  return { api, calls };
}
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const crops = () => { const { api } = load(reply(200, {})); return fx('crops').crops.map(api.toCropView); };

test('season options come from the live catalog and exclude All Seasons', () => {
  const { api } = load(reply(200, {}));
  assert.deepEqual([...api.rotSeasonOptions(crops())], ['Summer', 'Winter']);
});

test('valid form state builds the exact request body', () => {
  const { api } = load(reply(200, {}));
  const r = api.buildRotationRequest({ slots: ['Summer', 'Winter'], previousId: 'rice', mode: 'supported_only', cyclic: false, preferredIds: ['mung'], excludedIds: ['potato'] }, crops());
  assert.equal(r.errors.length, 0); // (arrays from the vm sandbox are a different realm, so compare by length)
  assert.deepEqual(JSON.parse(JSON.stringify(r.payload)), {
    season_slots: ['Summer', 'Winter'], previous_crop_id: 'rice', excluded_crop_ids: ['potato'], preferred_crop_ids: ['mung'], mode: 'supported_only', cyclic: false });
});

test('empty previous crop is sent as null, never as an empty string', () => {
  const { api } = load(reply(200, {}));
  const r = api.buildRotationRequest({ slots: ['Winter'], previousId: '', mode: 'exploratory', cyclic: true, preferredIds: [], excludedIds: [] }, crops());
  assert.equal(r.payload.previous_crop_id, null);
  assert.equal(r.payload.cyclic, true);
});

test('client-side validation catches bad input before any request', () => {
  const { api } = load(reply(200, {}));
  const c = crops(), ok = { slots: ['Summer'], previousId: '', mode: 'exploratory', cyclic: false, preferredIds: [], excludedIds: [] };
  const errs = over => api.buildRotationRequest({ ...ok, ...over }, c).errors.join(' | ');
  assert.match(errs({ slots: ['Summer', ''] }), /Choose a season for slot 2/);
  assert.match(errs({ slots: [] }), /between 1 and 6/);
  assert.match(errs({ slots: Array(7).fill('Summer') }), /between 1 and 6/);
  assert.match(errs({ slots: ['Monsoon'] }), /not a season in the crop catalog/);
  assert.match(errs({ slots: ['All Seasons'] }), /not a season in the crop catalog/);
  assert.match(errs({ cyclic: true, previousId: 'rice' }), /cannot be combined/);
  assert.match(errs({ preferredIds: ['rice'], excludedIds: ['rice'] }), /both preferred and left out: Rice/);
  assert.match(errs({ previousId: 'nope' }), /previous crop is not in the crop catalog/);
  assert.match(errs({ preferredIds: ['nope'] }), /selected crop is not in the crop catalog/);
  assert.match(errs({ mode: 'fast' }), /valid transition mode/);
  assert.equal(api.buildRotationRequest(ok, c).payload.mode, 'exploratory');
});

test('requestRotations sends POST JSON to the configured backend', async () => {
  const body = fx('resp_normal');
  const { api, calls } = load(reply(200, body));
  const payload = { season_slots: ['Summer'], previous_crop_id: null, excluded_crop_ids: [], preferred_crop_ids: [], mode: 'exploratory', cyclic: false };
  const out = await api.requestRotations(payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, api.HARVESTV_CONFIG.apiBaseUrl + '/api/rotations/generate');
  assert.ok(!/localhost/.test(calls[0].url), 'production URL must not be localhost');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), payload);
  assert.equal(out.returned, body.returned);
});

test('GET helpers still send plain GETs without a body', async () => {
  const { api, calls } = load(reply(200, { ok: 1 }));
  await api.apiGet('/api/crops');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers, undefined);
});

test('error mapping: validation (string and list detail), server, network', async () => {
  let r = load(reply(422, { detail: "'previous_crop_id' is not a known crop id: 'x'" }));
  let err = await r.api.requestRotations({}).catch(e => e);
  assert.equal(err.status, 422);
  assert.deepEqual({ ...r.api.rotationErrorMessage(err) }, { kind: 'validation', message: "'previous_crop_id' is not a known crop id: 'x'" });

  r = load(reply(422, { detail: [{ loc: ['body', 'season_slots'], msg: 'List should have at least 1 item' }] }));
  err = await r.api.requestRotations({}).catch(e => e);
  assert.match(r.api.rotationErrorMessage(err).message, /season_slots: List should have at least 1 item/);

  r = load(reply(500, { detail: 'The crop catalog could not be prepared: x' }));
  err = await r.api.requestRotations({}).catch(e => e);
  assert.equal(r.api.rotationErrorMessage(err).kind, 'server');
  assert.doesNotMatch(r.api.rotationErrorMessage(err).message, /catalog could not be prepared: x/); // no internals leaked to users

  r = load(async () => { throw new TypeError('Failed to fetch'); });
  err = await r.api.requestRotations({}).catch(e => e);
  assert.equal(r.api.rotationErrorMessage(err).kind, 'network');
});

test('results page: sequence, slots, transition labels, ranking explanation, disclaimer, legend', () => {
  const { api } = load(reply(200, {}));
  const html = api.renderRotationResults(fx('resp_normal'), crops());
  assert.ok(html.includes(api.ROT_DISCLAIMER), 'disclaimer visible');
  assert.match(html, /Slot 1 · Summer/);
  assert.match(html, /Slot 2 · Winter/);
  assert.match(html, /Why this rank:/);
  assert.match(html, /evidence tier 1 of 3/);
  assert.match(html, /not a suitability score/);
  for (const label of ['Supported', 'One-sided', 'Unknown', 'Forbidden']) assert.ok(html.includes(label), label + ' in legend');
  assert.match(html, /Both crops’ transition lists agree/);
  assert.match(html, /class="tr tr-supported"/);
  assert.doesNotMatch(html, /Search incomplete/);
  const first = fx('resp_normal').results[0];
  assert.ok(html.includes(first.crop_names[0]));
  assert.equal((html.match(/class="card opt rot-result"/g) || []).length, 3);
  assert.doesNotMatch(html, /\d+(\.\d+)?\s?%|probability|yield|profit/i, 'no invented numbers');
});

test('one-sided and unknown transitions are labelled, not styled as errors', () => {
  const { api } = load(reply(200, {}));
  const html = api.renderRotationResults(fx('resp_one_sided'), crops());
  assert.match(html, /tr-one_sided/);
  assert.match(html, /tr-unknown/);
  assert.match(html, /Previous crop → first crop \(Wheat → Maize\)/);
  assert.match(html, /transition\(s\) are unknown: not verified by the catalog, and not prohibited/);
  assert.doesNotMatch(html, /badge bad|class="[^"]*\bbad\b/);
  const cards = html.slice(html.indexOf('rot-result'));
  assert.doesNotMatch(cards, /tr-forbidden/); // forbidden only ever appears in the legend, never on a result
});

test('empty result shows a clear empty state with engine warnings', () => {
  const { api } = load(reply(200, {}));
  const html = api.renderRotationResults(fx('resp_empty'), crops());
  assert.match(html, /No sequences match these settings/);
  assert.match(html, /No sequences satisfy the constraints/);
  assert.doesNotMatch(html, /rot-result/);
  assert.ok(html.includes(api.ROT_DISCLAIMER));
});

test('truncated search is flagged prominently', () => {
  const { api } = load(reply(200, {}));
  const html = api.renderRotationResults(fx('resp_truncated'), crops());
  assert.match(html, /role="alert"><b>Search incomplete\./);
  assert.match(html, /search incomplete\)/);
  assert.equal((html.match(/NOT exhaustive/g) || []).length, 0, 'engine warning is not duplicated next to the banner');
});

test('cyclic closing transition and preferred matches are shown', () => {
  const { api } = load(reply(200, {}));
  const html = api.renderRotationResults(fx('resp_cyclic'), crops());
  assert.match(html, /Last crop → first crop \(cyclic\)/);
  assert.match(html, /cyclic \(last → first also checked\)/);
  assert.match(html, /preferred crops included: \d/);
});

test('crop names from the response are HTML-escaped', () => {
  const { api } = load(reply(200, {}));
  const resp = fx('resp_normal');
  resp.results[0].slots[0].crop_name = '<img src=x onerror=alert(1)>';
  const html = api.renderRotationResults(resp, []);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
});

test('results render without the crop catalog loaded (falls back to names in the response)', () => {
  const { api } = load(reply(200, {}));
  assert.match(api.renderRotationResults(fx('resp_normal'), undefined), /Slot 1 · Summer/);
});
