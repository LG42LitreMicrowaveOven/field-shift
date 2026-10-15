/* Mock data for HarvestV. Every get*() function returns a Promise so it can later be swapped for
   fetch("/api/...") with no change in app.js. All values are DEMONSTRATION data. */
/* Crop catalog cache. Filled from GET /api/crops by getCropData(). There is no local copy of the catalog:
   the SQLite database behind the API is the only source of crop data. */
let cropData = [];
const locations = {Rangpur:[25.75,89.25],Rajshahi:[24.37,88.6],Mymensingh:[24.75,90.4],Dhaka:[23.81,90.41],Khulna:[22.82,89.55]};
const defaultFarm = {location:'Rangpur, Bangladesh',size:'1.0',crop:'Rice',previous:'Rice',irrigation:'Limited',priority:'Water efficiency',soil:'Clay loam'};
/* DEV ONLY: demo environmental data in the same shape as the API response. Used only when
   HARVESTV_CONFIG.useMockEnvironment is true and always labelled as demo data, never as NASA. */
const mockEnvironmentalApiResponse = {location:{latitude:25.75,longitude:89.25},weather:{temperature:29,rainfall:42,rainfall_days:7,solar_radiation:18.2,solar_radiation_units:'MJ/m²/day',data_date:'demo'},soil:{moisture:null},vegetation:{ndvi:null},sources:{weather:'Demo data (not NASA)',soil:null,vegetation:null}};
/* Candidate sequences the mock "engine" scores. A real backend would produce these. */
const rotationTemplates = [['Rice','Mung Bean','Rice'],['Rice','Wheat','Rice'],['Rice','Mustard','Rice'],['Rice','Lentil','Jute'],['Maize','Mung Bean','Wheat'],['Potato','Rice','Mustard']];
const whatIfScenarios = [{name:'Normal rainfall',water:0,note:'Baseline conditions.'},{name:'Lower rainfall',water:1,note:'Water-hungry crops face more stress.'},{name:'Higher temperature',water:0.5,note:'Heat can shorten planting windows for cool-season crops.'},{name:'Limited irrigation',water:1,note:'Needs reliable irrigation for later stages.'}];
const demoReferences = ['Placeholder: regional crop-rotation study A (fictional)','Placeholder: pulse nitrogen contribution review (fictional)','Placeholder: cereal water-use comparison (fictional)'];
/* Swap each body for fetch('/api/...').then(r=>r.json()) when the Python API exists. */
const delay=(v,ms=120)=>new Promise(r=>setTimeout(()=>r(v),ms));
const getFarmData=()=>delay(JSON.parse(localStorage.getItem('fsFarm')||'null')||defaultFarm);
const saveFarmData=f=>{localStorage.setItem('fsFarm',JSON.stringify(f));return delay(f,0)};
/* Shared GET helper for every HarvestV API call. Throws an Error (with .status for HTTP errors). */
async function apiGet(path, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs); // NASA / a sleeping Render server can be slow
  try {
    const res = await fetch(`${HARVESTV_CONFIG.apiBaseUrl}${path}`, { signal: controller.signal });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).detail; } catch (e) { /* non-JSON error body */ }
      const err = new Error(`Backend returned ${res.status}${detail ? ': ' + (typeof detail === 'string' ? detail : 'invalid request') : ''}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The request timed out.');
    throw err;
  } finally { clearTimeout(timer); }
}
/* Stage 1: environmental data from our FastAPI backend (which calls NASA POWER). */
async function getEnvironmentalData(latitude, longitude) {
  if (HARVESTV_CONFIG.useMockEnvironment) return delay(mockEnvironmentalApiResponse);
  return apiGet(`/api/environment?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`);
}
/* Turns the API response into the small object the UI uses. Throws if the response is malformed. */
function toEnvironmentView(api) {
  const w = api && api.weather;
  if (!w || typeof w.temperature !== 'number') throw new Error('Unexpected environmental data format.');
  return { temperature: w.temperature, rainfall: w.rainfall, rainfallDays: w.rainfall_days, solar: w.solar_radiation,
    solarUnits: w.solar_radiation_units || '', dataDate: w.data_date, source: (api.sources && api.sources.weather) || 'NASA POWER',
    isMock: !!(api.sources && /demo/i.test(api.sources.weather || '')),
    soilMoisture: api.soil ? api.soil.moisture : null, ndvi: api.vegetation ? api.vegetation.ndvi : null };
}
/* Stage 2: crops come from the SQLite-backed API. toCropView() maps API field names to the names the
   rest of app.js already uses, so the Crop pages and the mock rotation logic did not need to change. */
function toCropView(api) {
  if (!api || !api.id || !api.name) throw new Error('Unexpected crop data format.');
  return { id: api.id, name: api.name, emoji: api.emoji || '', season: api.season, desc: api.description,
    duration: api.growing_duration, temp: api.temperature_range, moisture: api.soil_moisture, soil: api.soil_requirements,
    nitrogen: api.nitrogen_requirement, fertilizer: api.fertilizer_notes, water: api.water_demand_score,
    waterLabel: api.water_requirement, pests: api.pest_disease_notes, drought: api.drought_tolerance,
    legume: !!api.is_legume, before: api.preceding_crops || [], after: api.following_crops || [] };
}
let cropCatalogRequest = null; // shares one request if several pages ask at once
function getCropData(force = false) {
  if (cropData.length && !force) return Promise.resolve(cropData);
  if (!cropCatalogRequest) {
    cropCatalogRequest = apiGet('/api/crops').then(res => {
      if (!res || !Array.isArray(res.crops) || !res.crops.length) throw new Error('Unexpected crop list format.');
      cropData = res.crops.map(toCropView);
      return cropData;
    }).finally(() => { cropCatalogRequest = null; });
  }
  return cropCatalogRequest;
}
async function getCropById(id) { return toCropView(await apiGet(`/api/crops/${encodeURIComponent(id)}`)); }
const getRotationCandidates=()=>delay(rotationTemplates);
