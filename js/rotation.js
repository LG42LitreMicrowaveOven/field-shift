/* Rotation generation (Stage 3D): request building, validation, error mapping and result rendering.
   Pure functions plus one API call, so they can be tested outside the browser (see tests/rotation.test.js).
   Everything shown here comes from POST /api/rotations/generate; nothing in this file scores or ranks crops. */

const ROT_MAX_SLOTS = 6; // UI limit (the engine allows 12); keeps the form and the result cards readable
const ROT_MODES = {
  exploratory: 'Exploratory: show all sequences except forbidden ones',
  supported_only: 'Supported only: keep only transitions both crops list'
};
const ROT_DISCLAIMER = 'HarvestV generates exploratory crop-rotation sequences using the current crop catalog and its recorded transition relationships. Some catalog data is illustrative or incomplete. Results are not yet locally validated agronomic recommendations; check local agricultural guidance before making planting decisions.';

/* Plain-language meaning of each transition status (text + icon; never colour alone). */
const ROT_TRANSITIONS = {
  supported: { label: 'Supported', icon: '✓', legend: 'Both crops’ transition lists agree.' },
  one_sided: { label: 'One-sided', icon: '◐', legend: 'Only one crop’s list supports the transition.' },
  unknown: { label: 'Unknown', icon: '?', legend: 'Neither list establishes support or prohibition. Not verified, and not prohibited.' },
  forbidden: { label: 'Forbidden', icon: '⛔', legend: 'The catalog explicitly marks the transition as prohibited. Such sequences are never returned.' }
};
const ROT_TIERS = {
  all_supported: 'All transitions supported',
  no_transitions: 'No transitions to check',
  has_one_sided: 'Includes one-sided transitions',
  has_unknown: 'Includes unknown transitions'
};
const ROT_KIND_LABEL = { from_previous: 'Previous crop → first crop', within_plan: '', cyclic_closing: 'Last crop → first crop (cyclic)' };

const rotEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Explicit season labels the catalog uses ('All Seasons' is a wildcard on crops, never a slot value). */
function rotSeasonOptions(crops) {
  const out = [];
  (crops || []).forEach(c => { if (c.season && c.season !== 'All Seasons' && !out.includes(c.season)) out.push(c.season); });
  return out;
}

/* Turns the form state into the exact request body the API expects, or a list of readable problems.
   input: { slots: [season|''], previousId: id|'', mode, cyclic, preferredIds: [id], excludedIds: [id] } */
function buildRotationRequest(input, crops) {
  const errors = [], seasons = rotSeasonOptions(crops), ids = new Set((crops || []).map(c => c.id));
  const slots = Array.isArray(input.slots) ? input.slots : [];
  if (!slots.length || slots.length > ROT_MAX_SLOTS) errors.push(`Choose between 1 and ${ROT_MAX_SLOTS} seasons.`);
  slots.forEach((s, i) => {
    if (!s) errors.push(`Choose a season for slot ${i + 1}.`);
    else if (!seasons.includes(s)) errors.push(`“${s}” is not a season in the crop catalog (slot ${i + 1}).`);
  });
  const mode = input.mode || 'exploratory';
  if (!Object.prototype.hasOwnProperty.call(ROT_MODES, mode)) errors.push('Choose a valid transition mode.');
  const previous = input.previousId || null, pref = [...new Set(input.preferredIds || [])], excl = [...new Set(input.excludedIds || [])];
  if (previous && !ids.has(previous)) errors.push('The previous crop is not in the crop catalog.');
  if (pref.some(id => !ids.has(id)) || excl.some(id => !ids.has(id))) errors.push('A selected crop is not in the crop catalog.');
  if (input.cyclic && previous) errors.push('A previous crop cannot be combined with cyclic checking. Clear one of them.');
  const both = pref.filter(id => excl.includes(id));
  if (both.length) errors.push('A crop cannot be both preferred and left out: ' + both.map(id => ((crops || []).find(c => c.id === id) || { name: id }).name).join(', ') + '.');
  if (errors.length) return { errors, payload: null };
  return {
    errors: [],
    payload: { season_slots: slots.slice(), previous_crop_id: previous, excluded_crop_ids: excl, preferred_crop_ids: pref, mode, cyclic: !!input.cyclic }
  };
}

const requestRotations = payload => apiPost('/api/rotations/generate', payload);

/* Maps a failed request to { kind, message } for the UI. 4xx = the request (shown as-is); anything else = server/network. */
function rotationErrorMessage(err) {
  if (err && err.status >= 400 && err.status < 500) {
    return { kind: 'validation', message: err.detail || 'The server could not accept this request.' };
  }
  if (err && err.status) return { kind: 'server', message: 'The server could not generate rotations right now. Please try again in a moment.' };
  return { kind: 'network', message: 'We could not reach the HarvestV server. Check your connection and try again. (A sleeping server can take up to a minute to wake.)' };
}

/* ---------- Rendering ---------- */
const rotTransition = status => {
  const t = ROT_TRANSITIONS[status] || { label: status, icon: '?', legend: '' };
  return `<span class="tr tr-${rotEsc(status)}" title="${rotEsc(t.legend)}"><span aria-hidden="true">${t.icon}</span> ${rotEsc(t.label)}</span>`;
};

function rotLegendHtml() {
  return `<details class="legend"><summary>What do the transition labels mean?</summary><ul>${Object.keys(ROT_TRANSITIONS).map(k =>
    `<li>${rotTransition(k)} ${rotEsc(ROT_TRANSITIONS[k].legend)}</li>`).join('')}</ul>
    <p class="sub" style="margin:8px 0 0">“Supported” means the catalog lists the transition in both directions. It is not proof of an agronomic benefit, and “unknown” does not mean unsafe.</p></details>`;
}
const rotDisclaimerHtml = () => `<p class="disclaimer" role="note">${rotEsc(ROT_DISCLAIMER)}</p>`;

function rotRequestSummary(input, nameOf) {
  const parts = [`${input.length} season slot${input.length === 1 ? '' : 's'}: ${input.season_slots.map(rotEsc).join(' → ')}`,
    `mode: ${rotEsc(input.mode === 'supported_only' ? 'supported only' : 'exploratory')}`,
    `checking: ${input.cyclic ? 'cyclic (last → first also checked)' : 'linear'}`];
  parts.push(input.previous_crop_id ? `previous crop: ${rotEsc(nameOf(input.previous_crop_id))}` : 'previous crop: none');
  if ((input.preferred_crop_ids || []).length) parts.push(`preferred: ${input.preferred_crop_ids.map(id => rotEsc(nameOf(id))).join(', ')}`);
  if ((input.excluded_crop_ids || []).length) parts.push(`left out: ${input.excluded_crop_ids.map(id => rotEsc(nameOf(id))).join(', ')}`);
  return parts.join(' · ');
}

function rotResultCard(res, resp, nameOf, emojiOf) {
  const input = resp.input, trs = res.transitions || [];
  const prev = trs.find(t => t.kind === 'from_previous'), closing = trs.find(t => t.kind === 'cyclic_closing');
  const within = trs.filter(t => t.kind === 'within_plan');
  const steps = res.slots.map((s, i) => {
    const e = emojiOf(s.crop_id);
    const crop = `<li class="rslot"><span class="rs">Slot ${s.slot} · ${rotEsc(s.season)}</span><b>${e ? rotEsc(e) + ' ' : ''}${rotEsc(s.crop_name)}</b></li>`;
    return crop + (within[i] ? `<li class="rarrow" aria-label="Transition: ${rotEsc((ROT_TRANSITIONS[within[i].status] || {}).label || within[i].status)}">${rotTransition(within[i].status)}</li>` : '');
  }).join('');
  const c = res.ranking_criteria || {};
  const prefNote = (input.preferred_crop_ids || []).length ? ` · preferred crops included: ${c.preferred_matches}` : '';
  const total = resp.search.sequences_passing;
  const extra = [prev ? `<div class="rextra">${rotEsc(ROT_KIND_LABEL.from_previous)} (${rotEsc(nameOf(prev.from_crop_id))} → ${rotEsc(nameOf(prev.to_crop_id))}): ${rotTransition(prev.status)}</div>` : '',
    closing ? `<div class="rextra">${rotEsc(ROT_KIND_LABEL.cyclic_closing)} (${rotEsc(nameOf(closing.from_crop_id))} → ${rotEsc(nameOf(closing.to_crop_id))}): ${rotTransition(closing.status)}</div>` : ''].join('');
  return `<article class="card opt rot-result"><div class="num" title="Rank ${res.rank}">${res.rank}</div><div class="body">
    <div class="row space"><span class="tier tier-${rotEsc(res.evidence_tier)}">${rotEsc(ROT_TIERS[res.evidence_tier] || res.evidence_tier)}</span></div>
    <ol class="rseq" aria-label="Crop sequence">${steps}</ol>${extra}
    <p class="why"><b>Why this rank:</b> evidence tier ${c.tier} of 3 · unknown transitions: ${c.unknown_transitions} · one-sided transitions: ${c.one_sided_transitions}${prefNote}. Rank ${res.rank} of ${total} valid sequence${total === 1 ? '' : 's'} found${resp.search.truncated ? ' (search incomplete)' : ''}. This is an ordering by catalog evidence, not a suitability score.</p>
    ${(res.warnings || []).length ? `<ul class="warn">${res.warnings.map(w => `<li>${rotEsc(w)}</li>`).join('')}</ul>` : ''}
  </div></article>`;
}

/* The whole results page body. `crops` (the live catalog) is optional and only adds emoji. */
function renderRotationResults(resp, crops) {
  const byId = {}; (crops || []).forEach(c => { byId[c.id] = c; });
  const names = {}; (resp.results || []).forEach(r => r.slots.forEach(s => { names[s.crop_id] = s.crop_name; }));
  const nameOf = id => (byId[id] && byId[id].name) || names[id] || id, emojiOf = id => (byId[id] && byId[id].emoji) || '';
  const s = resp.search, input = resp.input;
  const truncated = s.truncated ? `<div class="alert warn" role="alert"><b>Search incomplete.</b> The search stopped after ${s.nodes_visited} steps (limit ${s.max_nodes}). The sequences below are the best of those found, not of every possible sequence.</div>` : '';
  const globals = (resp.warnings || []).filter(w => !(s.truncated && /NOT exhaustive/.test(w)));
  const warnBlock = globals.length ? `<div class="alert info" role="status"><ul>${globals.map(w => `<li>${rotEsc(w)}</li>`).join('')}</ul></div>` : '';
  const audit = `<details><summary>How were these found? (search details)</summary>
    <p>${rotRequestSummary(input, nameOf)}</p>
    <ul><li>Possible sequences after season and exclusion filtering: ${s.search_space_size}</li>
    <li>Valid sequences found: ${s.sequences_passing}${s.sequences_excluded_by_transition_rules == null ? '' : ` (removed by transition rules: ${s.sequences_excluded_by_transition_rules})`}</li>
    <li>Search steps used: ${s.nodes_visited} of ${s.max_nodes}${s.truncated ? ' (limit reached)' : ''}</li>
    <li>Steps cut by rules: ${Object.keys(s.pruned_extensions || {}).length ? Object.entries(s.pruned_extensions).map(([k, v]) => `${rotEsc(k.replace(/_/g, ' '))} ${v}`).join(', ') : 'none'}</li></ul>
    <p><b>Ranking order used:</b></p><ol>${(resp.ranking_policy || []).map(p => `<li>${rotEsc(p.replace(/^\d+\.\s*/, ''))}</li>`).join('')}</ol>
    <p class="sub" style="margin:0">Engine ${rotEsc(resp.engine_version)} · catalog: ${resp.catalog ? resp.catalog.crop_count + ' crops' : 'n/a'}. ${rotEsc(resp.disclaimer || '')}</p></details>`;
  const head = `<h1 class="title">Rotation Sequences</h1><p class="sub">${resp.returned ? `Showing ${resp.returned} of ${s.sequences_passing} valid sequence${s.sequences_passing === 1 ? '' : 's'} found, best catalog evidence first.` : 'No sequences to show.'}</p>${rotDisclaimerHtml()}`;
  const body = resp.returned
    ? rotLegendHtml() + truncated + warnBlock + resp.results.map(r => rotResultCard(r, resp, nameOf, emojiOf)).join('')
    : `<div class="card rot-empty"><h2 style="margin-top:0">No sequences match these settings</h2><p>Your request was valid, but no sequence satisfies every constraint.</p>${truncated}${warnBlock}<p>Try “Exploratory” mode, add a season option, remove a crop from “leave out”, or clear the previous crop.</p></div>`;
  return head + body + `<div class="card sky" style="margin-top:14px">${audit}</div>`;
}

