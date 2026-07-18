const CONFIG = window.NYC_CONFIG || {};
const state = {
  view: 'catalog',
  mode: 'preparation',
  catalog: [],
  activities: [],
  interests: new Set(JSON.parse(localStorage.getItem('nyc-interests') || '[]')),
  plan: JSON.parse(localStorage.getItem('nyc-plan') || '[]'),
  pendingPlanRemovals: new Set(JSON.parse(localStorage.getItem('nyc-pending-plan-removals') || '[]')),
  deviceId: localStorage.getItem('nyc-device-id') || crypto.randomUUID(),
  filters: { search: '', type: '', borough: '', area: '', status: 'all' },
  todayMode: 'all',
  filtersOpen: false,
  decide: { near: false, borough: 'Manhattan', area: '', activity: 'cultura', time: 999, energy: 'cualquiera', setting: 'cualquiera' },
  visible: 24,
  loadingCatalog: true,
  onlineData: false,
  activitiesSynced: false,
  message: null,
  detailId: null,
  remoteComments: [],
  userLocation: null,
  locating: false,
  locationError: ''
};
localStorage.setItem('nyc-device-id', state.deviceId);

const app = document.querySelector('#app');
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const slug = value => normalize(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const itemKey = value => String(value ?? '').trim();
const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
const familyCount = itemId => state.remoteInterests?.filter(item => item.itemId === itemId && String(item.interested).toLowerCase() !== 'false').length || (state.interests.has(itemId) ? 1 : 0);
const decisionArea = item => item.simpleArea || item.macroArea || item.decisionArea || item.cluster || item.area || '';
const hasCoords = item => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng));
const allItems = () => [...state.catalog, ...state.activities];

function saveLocal() {
  state.plan = [...new Set(state.plan.map(itemKey).filter(Boolean))];
  localStorage.setItem('nyc-interests', JSON.stringify([...state.interests]));
  localStorage.setItem('nyc-plan', JSON.stringify(state.plan));
  localStorage.setItem('nyc-pending-plan-removals', JSON.stringify([...state.pendingPlanRemovals]));
}

async function loadSeed() {
  const response = await fetch('./data/catalog.json');
  if (!response.ok) throw new Error('No se pudo cargar el catálogo local.');
  const data = await response.json();
  return [...data.places, ...data.experiences].filter(item => item.published !== false);
}

function loadJsonp(url, params = {}) {
  return new Promise((resolve, reject) => {
    const callback = `nycCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => cleanup(new Error('La sincronización ha tardado demasiado.')), 12000);
    function cleanup(error, value) {
      clearTimeout(timer);
      script.remove();
      delete window[callback];
      error ? reject(error) : resolve(value);
    }
    window[callback] = data => cleanup(null, data);
    const query = new URLSearchParams({ ...params, callback, key: CONFIG.familyKey || '' });
    script.onerror = () => cleanup(new Error('No se pudo contactar con Google Sheets.'));
    script.src = `${url}?${query}`;
    document.head.appendChild(script);
  });
}

async function loadRemote() {
  if (!CONFIG.apiUrl) return;
  const payload = await loadJsonp(CONFIG.apiUrl, { action: 'snapshot' });
  if (!payload?.ok) throw new Error(payload?.error || 'Respuesta inválida.');
  const places = (payload.data.places || []).map(item => ({ ...item, id: item.id, itemKind: item.itemKind || 'place' }));
  const experiences = (payload.data.experiences || []).map(item => ({ ...item, id: item.id || item.experienceId, itemKind: item.itemKind || 'experience', type: item.type || 'Experiencia' }));
  const activities = (payload.data.activities || []).map(item => ({ ...item, id: item.id, itemKind: 'activity', type: item.type || 'Actividad' }));
  const items = [...places, ...experiences, ...(payload.data.proposals || []).map(proposal => ({
    ...proposal,
    id: proposal.id,
    itemKind: 'place',
    name: proposal.name,
    mapsUrl: proposal.mapsUrl,
    type: proposal.type || 'Propuesto por la familia',
    category: proposal.category || 'Propuesta familiar',
    area: proposal.area || '',
    borough: proposal.borough || '',
    shortDescription: proposal.shortDescription || proposal.whyItMatters || proposal.reason || '',
    whyItMatters: proposal.whyItMatters || proposal.reason || '',
    notes: proposal.notes || '',
    origin: 'family',
    published: true
  }))];
  if (items.length) state.catalog = items;
  state.activities = activities.filter(item => item.id && item.name);
  state.activitiesSynced = Object.prototype.hasOwnProperty.call(payload.data || {}, 'activities');
  state.remoteInterests = payload.data.interests || [];
  state.remoteComments = payload.data.comments || [];
  const remotePlanIds = (payload.data.itineraryItems || [])
    .filter(item => !item.itineraryId || item.itineraryId === 'PLAN-FAMILIAR')
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
    .map(item => itemKey(item.itemId))
    .filter(Boolean);
  state.pendingPlanRemovals.forEach(itemId => { if (!remotePlanIds.includes(itemId)) state.pendingPlanRemovals.delete(itemId); });
  const remotePlan = remotePlanIds.filter(itemId => !state.pendingPlanRemovals.has(itemId));
  state.plan = [...new Set(remotePlan)];
  saveLocal();
  state.onlineData = true;
}

async function writeAction(action, payload) {
  if (!CONFIG.apiUrl) return { simulated: true };
  const body = new URLSearchParams({ action, key: CONFIG.familyKey || '', payload: JSON.stringify(payload) });
  await fetch(CONFIG.apiUrl, { method: 'POST', mode: 'no-cors', body });
  return { queued: true };
}

function appHeader() {
  const title = state.view === 'detail' ? 'Ficha completa' : state.view === 'decide' ? '¿Qué hacemos ahora?' : state.view === 'catalog' ? 'Catálogo de Nueva York' : state.view === 'today' ? 'Qué hacer hoy' : 'Plan familiar';
  return `<header class="masthead"><div class="brand"><div class="brand-mark"><span>NY</span><i></i></div><div><p class="eyebrow">Guía familiar · 2026</p><h1>${title}</h1></div></div><button class="mode" data-action="toggle-mode">${state.mode === 'preparation' ? 'Modo preparación' : 'Modo viaje'}</button></header>
  <nav class="primary-nav" aria-label="Navegación principal">${[['decide','D','Decidir'],['catalog','C','Catálogo'],['today','H','Hoy'],['plan','P','Plan']].map(([id,line,label]) => `<button class="nav-button ${state.view === id ? 'active' : ''}" data-view="${id}"><span class="nav-line">${line}</span>${label}</button>`).join('')}</nav>`;
}

function notice() {
  if (!state.message) return '';
  return `<div class="notice ${state.message.type || ''}" role="status">${escapeHtml(state.message.text)}</div>`;
}

function selectOptions(values, selected, emptyLabel) {
  return `<option value="">${emptyLabel}</option>${values.map(value => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}`;
}

function activityFor(item) {
  if (item.itemKind === 'activity') {
    const text = normalize(`${item.category} ${item.type}`);
    if (/mercado|food|comida|gastronom/.test(text)) return 'comida';
    if (/deporte|calle|publico|paseo/.test(text)) return 'paseo';
    if (/shopping|compras/.test(text)) return 'compras';
    return 'cultura';
  }
  const text = normalize(`${item.type} ${item.subtype} ${item.category}`);
  if (/gastronom|restaurante|pizza|comida|mercado|panader/.test(text)) return 'comida';
  if (/compra|tienda|outlet|shopping/.test(text)) return 'compras';
  if (/museo|cultura|mirador|iglesia|arte|historia|observatory/.test(text)) return 'cultura';
  return 'paseo';
}

function activityIcon(activity) {
  return { cultura: '🏛️', paseo: '🚶', comida: '🍔', compras: '🛍️' }[activity] || '📍';
}

function routeBadge(activity) {
  return { cultura: 'A', paseo: '7', comida: 'F', compras: 'N' }[activity] || 'M';
}

function visualCardHead(item) {
  const activity = activityFor(item);
  return `<div class="visual-head" aria-hidden="true"><span class="subway-bullet">${routeBadge(activity)}</span><span class="type-icon">${activityIcon(activity)}</span><span class="route-line"></span></div>`;
}

function cardDescription(item) {
  return item.shortDescription || item.whyItMatters || item.bestFor || '';
}

function cardKnow(item) {
  return item.notes || '';
}

function knowNote(item) {
  return cardKnow(item) ? `<p class="know-note"><strong>Conviene saber</strong><span>${escapeHtml(cardKnow(item))}</span></p>` : '';
}

function matchesSetting(item, wanted) {
  if (!wanted || wanted === 'cualquiera' || !item.setting) return true;
  return item.setting === wanted || item.setting === 'mixto';
}

function distanceKm(item) {
  if (!state.userLocation || !hasCoords(item)) return null;
  const toRad = degrees => degrees * Math.PI / 180;
  const lat1 = Number(state.userLocation.lat);
  const lon1 = Number(state.userLocation.lng);
  const lat2 = Number(item.lat);
  const lon2 = Number(item.lng);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km) {
  if (km == null) return '';
  return km < 1 ? `a ${Math.round(km * 1000)} m` : `a ${km.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`;
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error('Este navegador no permite usar ubicación.'));
    else navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 });
  });
}

async function toggleNearMe() {
  if (state.decide.near) {
    state.decide.near = false;
    state.locationError = '';
    render();
    return;
  }
  state.locating = true;
  state.locationError = '';
  render();
  try {
    const position = await getCurrentPosition();
    state.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
    state.decide.near = true;
    state.message = { type: 'success', text: 'Ubicación activada. Las opciones cercanas aparecerán primero.' };
  } catch (error) {
    state.decide.near = false;
    state.locationError = error.code === 1 ? 'Permiso de ubicación denegado.' : (error.message || 'No se pudo obtener tu ubicación.');
    state.message = { type: 'error', text: state.locationError };
  } finally {
    state.locating = false;
    render();
  }
}

async function activateLocationForToday() {
  if (state.todayMode === 'near') {
    state.todayMode = 'all';
    render();
    return;
  }
  state.locating = true;
  state.message = null;
  render();
  try {
    const position = await getCurrentPosition();
    state.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
    state.todayMode = 'near';
    state.message = { type: 'success', text: 'Ubicación activada. Actividades cercanas primero.' };
  } catch (error) {
    state.message = { type: 'error', text: error.code === 1 ? 'Permiso de ubicación denegado.' : (error.message || 'No se pudo obtener tu ubicación.') };
  } finally {
    state.locating = false;
    render();
  }
}

function parseDateOnly(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dateKey(date) {
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
}

function isActivityToday(item, today = new Date()) {
  const start = parseDateOnly(item.startDate);
  const end = parseDateOnly(item.endDate || item.startDate);
  if (!start) return false;
  const current = parseDateOnly(dateKey(today));
  return start <= current && (!end || end >= current);
}

function isUpcomingActivity(item, today = new Date()) {
  const end = parseDateOnly(item.endDate || item.startDate);
  return end && end >= parseDateOnly(dateKey(today));
}

function formatActivityDate(item) {
  const start = parseDateOnly(item.startDate);
  const end = parseDateOnly(item.endDate || item.startDate);
  if (!start) return 'Fecha por confirmar';
  const formatter = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  if (end && dateKey(end) !== dateKey(start)) return `${formatter.format(start)} – ${formatter.format(end)}`;
  return formatter.format(start);
}

function activityTime(item) {
  return [item.startTime, item.endTime].filter(Boolean).join('–') || item.bestMoment || '';
}

function activitySortValue(item) {
  return `${item.startDate || '9999-99-99'} ${item.startTime || '99:99'}`;
}

function activityScore(item) {
  const priority = { alta: 3, media: 2, baja: 1 }[normalize(item.priority)] || 1;
  const fit = { 'muy alta': 4, alta: 3, media: 2, baja: 1 }[normalize(item.familyFit)] || 1;
  const teen = { 'muy alta': 4, alta: 3, media: 2, baja: 1 }[normalize(item.teenFit)] || 1;
  const reservationBoost = normalize(item.reservationRequired) === 'si' || normalize(item.reservationRequired) === 'sí' ? 1 : 0;
  return familyCount(item.id) * 8 + priority * 3 + fit + teen + reservationBoost;
}

function eachActivityDate(item) {
  const start = parseDateOnly(item.startDate);
  const end = parseDateOnly(item.endDate || item.startDate);
  if (!start) return ['sin-fecha'];
  const dates = [];
  const cursor = new Date(start);
  const last = end && end >= start ? end : start;
  while (cursor <= last && dates.length < 31) {
    dates.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function activityDateHeading(key) {
  if (key === 'sin-fecha') return 'Fecha por confirmar';
  const date = parseDateOnly(key);
  const today = parseDateOnly(dateKey(new Date()));
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const formatted = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  if (dateKey(date) === dateKey(today)) return `Hoy · ${formatted}`;
  if (dateKey(date) === dateKey(tomorrow)) return `Mañana · ${formatted}`;
  return formatted;
}

function groupedActivities(items) {
  if (state.todayMode === 'near') return [{ key: 'near', label: 'Más cerca de vuestra ubicación', items }];
  const todayKey = dateKey(new Date());
  const groups = new Map();
  items.forEach(item => {
    eachActivityDate(item).forEach(key => {
      if (state.todayMode === 'today' && key !== todayKey) return;
      if (state.todayMode === 'upcoming' && key !== 'sin-fecha' && key < todayKey) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
  });
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, groupItems]) => ({
      key,
      label: activityDateHeading(key),
      items: groupItems.sort((a, b) => activityScore(b) - activityScore(a) || activitySortValue(a).localeCompare(activitySortValue(b)))
    }));
}

function visibleActivities() {
  let items = state.activities.filter(item => item.status !== 'descartado');
  if (state.todayMode === 'all') {
    return items.sort((a, b) => activitySortValue(a).localeCompare(activitySortValue(b)) || activityScore(b) - activityScore(a));
  }
  if (state.todayMode === 'today') items = items.filter(isActivityToday);
  if (state.todayMode === 'upcoming') items = items.filter(isUpcomingActivity);
  if (state.todayMode === 'near') {
    items = items.filter(hasCoords).map(item => ({ ...item, distanceKm: distanceKm(item) })).sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999) || activitySortValue(a).localeCompare(activitySortValue(b)));
    return items;
  }
  return items.sort((a, b) => activitySortValue(a).localeCompare(activitySortValue(b)));
}

function decideMatches() {
  const d = state.decide;
  return state.catalog.filter(item => {
    if (d.near && state.userLocation && !hasCoords(item)) return false;
    if (!d.near && d.borough && item.borough && item.borough !== d.borough) return false;
    if (!d.near && d.area && decisionArea(item) !== d.area) return false;
    if (activityFor(item) !== d.activity) return false;
    if (d.time < 999 && item.maxMinutes && Number(item.maxMinutes) > d.time) return false;
    if (d.energy === 'bajo' && normalize(item.energyLevel) && normalize(item.energyLevel) !== 'bajo') return false;
    if (!matchesSetting(item, d.setting)) return false;
    return true;
  }).map(item => {
    const priority = { alta: 3, media: 2, baja: 1 }[normalize(item.priority)] || 1;
    const fit = { alta: 3, media: 2, baja: 1 }[normalize(item.familyFit)] || 1;
    const votes = familyCount(item.id);
    const km = distanceKm(item);
    const proximity = km == null ? 0 : Math.max(0, 12 - km);
    return { ...item, distanceKm: km, score: votes * 5 + priority * 2 + fit + (d.near ? proximity * 3 : 0) };
  }).sort((a, b) => d.near && state.userLocation ? (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999) || b.score - a.score : b.score - a.score || (b.rating || 0) - (a.rating || 0));
}

function renderDecide() {
  const boroughs = unique(state.catalog.map(item => item.borough));
  const areas = unique(state.catalog.filter(item => !state.decide.borough || item.borough === state.decide.borough).map(decisionArea));
  const matches = decideMatches();
  const locationHint = state.decide.near && state.userLocation ? `Ubicación activa · precisión aprox. ${Math.round(state.userLocation.accuracy || 0)} m` : state.locating ? 'Solicitando ubicación…' : state.locationError || 'Usa tu ubicación para ordenar por distancia.';
  return `<section class="view active"><div class="panel intro station-sign"><span class="station-kicker">Línea familiar</span><h2>Reducimos las opciones por vosotros</h2><p class="muted">Elige solo lo importante. Los intereses previos ayudan a ordenar los resultados.</p></div>
  <div class="step"><h3>1 · ¿Dónde queréis estar?</h3><div class="location-grid"><div><button class="button near ${state.decide.near ? 'active' : ''}" data-action="near" ${state.locating ? 'disabled' : ''}>${state.locating ? 'Buscando…' : state.decide.near ? 'Cerca de mí activo' : 'Cerca de mí'}</button><p class="location-hint">${escapeHtml(locationHint)}</p></div><label>Borough<select data-decide="borough" ${state.decide.near ? 'disabled' : ''}>${selectOptions(boroughs,state.decide.borough,'Cualquier borough')}</select></label><label>Zona o barrio<select data-decide="area" ${state.decide.near ? 'disabled' : ''}>${selectOptions(areas,state.decide.area,'Cualquier zona')}</select></label></div></div>
  <div class="step"><h3>2 · ¿Qué os apetece?</h3><div class="choice-grid">${[['cultura','Cultura e iconos'],['paseo','Pasear y descubrir'],['comida','Comer algo'],['compras','Compras']].map(([id,label]) => `<button class="choice type-${id} ${state.decide.activity === id ? 'active' : ''}" data-activity="${id}"><span class="choice-icon">${activityIcon(id)}</span>${label}</button>`).join('')}</div></div>
  <div class="step"><h3>3 · Condiciones del momento</h3><div class="conditions"><label>Tiempo<select data-decide="time"><option value="60" ${state.decide.time===60?'selected':''}>Menos de 1 hora</option><option value="120" ${state.decide.time===120?'selected':''}>1–2 horas</option><option value="240" ${state.decide.time===240?'selected':''}>Media jornada</option><option value="999" ${state.decide.time===999?'selected':''}>Sin límite</option></select></label><label>Energía<select data-decide="energy"><option value="bajo" ${state.decide.energy==='bajo'?'selected':''}>Plan tranquilo</option><option value="medio" ${state.decide.energy==='medio'?'selected':''}>Podemos caminar</option><option value="cualquiera" ${state.decide.energy==='cualquiera'?'selected':''}>Nos da igual</option></select></label><label>Clima<select data-decide="setting"><option value="interior" ${state.decide.setting==='interior'?'selected':''}>Necesitamos interior</option><option value="exterior" ${state.decide.setting==='exterior'?'selected':''}>Preferimos exterior</option><option value="cualquiera" ${state.decide.setting==='cualquiera'?'selected':''}>Indiferente</option></select></label></div></div>
  <p class="match-count"><strong>${matches.length}</strong> lugares o experiencias encajan.</p><button class="button primary block" data-action="show-results">Ver las mejores opciones</button><div id="recommendations"></div></section>`;
}

function recommendationCards() {
  const matches = decideMatches().slice(0, 3);
  if (!matches.length) return `<div class="panel empty"><h3>No hay coincidencias exactas</h3><p class="muted">Amplía el tiempo o marca clima y energía como indiferentes.</p><button class="button" data-action="relax">Relajar condiciones</button></div>`;
  const labels = ['La que mejor encaja', 'Favorita familiar', 'Una alternativa'];
  return `<div class="results" style="margin-top:16px">${matches.map((item, index) => `<article class="card type-${activityFor(item)} ${index === 0 ? 'recommended' : ''}">${visualCardHead(item)}<span class="badge ${index===0?'accent':''}">${labels[index]}</span><h3>${escapeHtml(item.name)}</h3><p class="muted">${escapeHtml([item.area,item.type || item.subtype].filter(Boolean).join(' · '))}</p><p>${escapeHtml(cardDescription(item) || 'Una opción que encaja con las condiciones seleccionadas.')}</p>${knowNote(item)}<div class="badge-row">${item.distanceKm != null ? `<span class="badge distance">${escapeHtml(formatDistance(item.distanceKm))}</span>` : ''}<span class="badge">${escapeHtml(item.timeNeeded || `${item.idealMinutes || '?'} min`)}</span>${item.setting ? `<span class="badge">${escapeHtml(item.setting)}</span>` : ''}<span class="badge family">${familyCount(item.id)} de ${CONFIG.familySize || 4} interesados</span></div><div class="actions"><button class="button ${index===0?'primary':''}" data-add-plan="${escapeHtml(item.id)}">Añadir al plan</button><button class="button" data-detail="${escapeHtml(item.id)}">Ver ficha</button>${item.mapsUrl ? `<a class="button" href="${escapeHtml(item.mapsUrl)}" target="_blank" rel="noopener">Google Maps</a>` : ''}</div></article>`).join('')}</div>`;
}

function activityCard(item) {
  const ticketUrl = item.ticketUrl || '';
  const infoUrl = ticketUrl || item.officialUrl || '';
  const reservation = item.reservationRequired ? String(item.reservationRequired) : '';
  return `<article class="card activity-card type-${activityFor(item)}">${visualCardHead(item)}<div class="activity-main"><div class="badge-row"><span class="badge accent">${escapeHtml(formatActivityDate(item))}</span>${activityTime(item) ? `<span class="badge time-badge">${escapeHtml(activityTime(item))}</span>` : ''}${item.price ? `<span class="badge price-badge">${escapeHtml(item.price)}</span>` : ''}${reservation ? `<span class="badge reserve-badge">${escapeHtml(reservation === 'Sí' ? 'Reserva necesaria' : reservation === 'Opcional' ? 'Reserva opcional' : 'Sin reserva')}</span>` : ''}<span class="badge family">${familyCount(item.id)} de ${CONFIG.familySize || 4} interesados</span>${item.distanceKm != null ? `<span class="badge distance">${escapeHtml(formatDistance(item.distanceKm))}</span>` : ''}</div><h3>${escapeHtml(item.name)}</h3><p class="muted">${escapeHtml([item.category, item.area, item.borough].filter(Boolean).join(' · '))}</p>${item.notes ? `<p class="activity-note">${escapeHtml(item.notes)}</p>` : ''}<div class="actions"><button class="button interest-button ${state.interests.has(item.id)?'selected':''}" data-interest="${escapeHtml(item.id)}">${state.interests.has(item.id)?'Interesado':'Me interesa'}</button><button class="button primary" data-add-plan="${escapeHtml(item.id)}">Añadir al plan</button><button class="button" data-detail="${escapeHtml(item.id)}">Ver ficha</button>${infoUrl ? `<a class="button" href="${escapeHtml(infoUrl)}" target="_blank" rel="noopener">${ticketUrl ? 'Entradas / RSVP' : 'Web oficial'}</a>` : ''}${item.mapsUrl ? `<a class="button" href="${escapeHtml(item.mapsUrl)}" target="_blank" rel="noopener">Maps</a>` : ''}</div></div></article>`;
}

function renderToday() {
  if (state.loadingCatalog) {
    return `<section class="view active"><div class="section-head"><div><h2>Hoy en Nueva York</h2><p class="muted">Cargando calendario de actividades…</p></div></div><div class="panel empty loading-panel"><h3>Sincronizando con Google Sheets</h3><p class="muted">La agenda aparecerá aquí en cuanto llegue el snapshot.</p></div></section>`;
  }
  const items = visibleActivities();
  const groups = groupedActivities(items);
  const modeLabel = state.todayMode === 'all' ? 'actividades disponibles' : state.todayMode === 'today' ? 'actividades para hoy' : state.todayMode === 'upcoming' ? 'próximas actividades' : 'actividades cercanas';
  const syncWarning = state.onlineData && !state.activitiesSynced ? `<div class="notice error"><strong>Calendario no sincronizado.</strong> La app está conectada a Google Sheets, pero el Apps Script publicado todavía no devuelve <code>activities</code>. Actualiza y redespliega el script para ver la pestaña CalendarioActividades.</div>` : '';
  return `<section class="view active"><div class="section-head"><div><h2>Hoy en Nueva York</h2><p class="muted">${state.activities.length} actividades en calendario · ${items.length} ${modeLabel}</p></div></div>
    <div class="panel intro station-sign"><span class="station-kicker">Agenda viva</span><h3>Planes con hora, fecha o reserva</h3><p class="muted">Aquí separaremos eventos, mercados, conciertos, cine al aire libre y actividades que no son simplemente “lugares”.</p></div>
    ${syncWarning}
    <div class="today-tabs" role="group" aria-label="Filtro de agenda">
      <button class="today-chip ${state.todayMode === 'all' ? 'active' : ''}" data-today-mode="all">Todo</button>
      <button class="today-chip ${state.todayMode === 'today' ? 'active' : ''}" data-today-mode="today">Hoy</button>
      <button class="today-chip ${state.todayMode === 'upcoming' ? 'active' : ''}" data-today-mode="upcoming">Próximos</button>
      <button class="today-chip ${state.todayMode === 'near' ? 'active' : ''}" data-action="today-near" ${state.locating ? 'disabled' : ''}>${state.locating ? 'Buscando…' : 'Cerca de mí'}</button>
    </div>
    ${items.length ? `<div class="activity-calendar">${groups.map(group => `<section class="activity-day"><div class="activity-day-head"><h3>${escapeHtml(group.label)}</h3><span class="badge">${group.items.length}</span></div><div class="activity-list">${group.items.map(activityCard).join('')}</div></section>`).join('')}</div>` : `<div class="panel empty"><h3>${state.activitiesSynced ? 'No hay nada para este filtro' : 'Falta sincronizar el calendario'}</h3><p class="muted">${!state.activitiesSynced ? 'La pestaña existe y tiene datos, pero la versión publicada del Apps Script aún no los está enviando a la web.' : state.todayMode === 'today' ? 'Durante el viaje esta vista enseñará sólo lo que encaje con la fecha del día. Puedes mirar “Todo” para ver el calendario completo y votar con antelación.' : 'Prueba con otro filtro o revisa que las actividades tengan fecha y coordenadas.'}</p><button class="button primary" data-today-mode="all">Ver todo</button></div>`}
  </section>`;
}

function catalogFiltered() {
  const f = state.filters;
  return state.catalog.filter(item => {
    const haystack = normalize(`${item.name} ${item.type} ${item.subtype} ${item.area} ${decisionArea(item)} ${item.borough} ${item.category}`);
    if (f.search && !haystack.includes(normalize(f.search))) return false;
    if (f.type && item.type !== f.type) return false;
    if (f.borough && item.borough !== f.borough) return false;
    if (f.area && decisionArea(item) !== f.area) return false;
    if (f.status === 'selected' && !state.interests.has(item.id)) return false;
    if (f.status === 'family' && familyCount(item.id) < 2) return false;
    if (f.status === 'pending' && state.interests.has(item.id)) return false;
    return true;
  });
}

function renderCatalog() {
  if (state.loadingCatalog) {
    return `<section class="view active"><div class="section-head"><div><h2>Todo el catálogo</h2><p class="muted">Cargando catálogo familiar…</p></div><div class="catalog-toolbar"><button class="button primary" disabled>+ Añadir lugar</button></div></div><div class="panel empty loading-panel"><h3>Sincronizando con Google Sheets</h3><p class="muted">Estamos preparando la lista completa para que no veas cifras provisionales.</p></div></section>`;
  }
  const types = unique(state.catalog.map(item => item.type));
  const boroughs = unique(state.catalog.map(item => item.borough));
  const areas = unique(state.catalog.filter(item => !state.filters.borough || item.borough === state.filters.borough).map(decisionArea));
  const filtered = catalogFiltered();
  const selected = state.interests.size;
  return `<section class="view active"><div class="section-head"><div><h2>Todo el catálogo</h2><p class="muted">${state.catalog.length} opciones · ${selected} seleccionadas en este dispositivo</p></div><div class="catalog-toolbar"><button class="button primary" data-action="proposal-form">+ Añadir lugar</button></div></div>
  ${state.mode === 'preparation' ? `<div class="panel intro station-sign"><span class="station-kicker">Línea de votos</span><h3>¿Qué te gustaría visitar?</h3><p class="muted">Marca tus intereses. Las coincidencias familiares influirán en las recomendaciones.</p><div class="progress"><span style="width:${Math.min(100, state.catalog.length ? selected/state.catalog.length*100 : 0)}%"></span></div></div>` : ''}
  <div id="proposal-slot"></div><div class="filters compact"><label>Buscar<input type="search" data-filter="search" value="${escapeHtml(state.filters.search)}" placeholder="Lugar, barrio o actividad"></label><label>Mostrar<select data-filter="status"><option value="all">Todos</option><option value="pending" ${state.filters.status==='pending'?'selected':''}>Pendientes</option><option value="selected" ${state.filters.status==='selected'?'selected':''}>Mis selecciones</option><option value="family" ${state.filters.status==='family'?'selected':''}>Coincidencias</option></select></label><button class="button filter-toggle" type="button" data-action="toggle-filters">${state.filtersOpen ? 'Ocultar filtros' : 'Más filtros'}</button></div>${state.filtersOpen ? `<div class="filters advanced"><label>Tipo<select data-filter="type">${selectOptions(types,state.filters.type,'Todos')}</select></label><label>Borough<select data-filter="borough">${selectOptions(boroughs,state.filters.borough,'Todos')}</select></label><label>Zona<select data-filter="area">${selectOptions(areas,state.filters.area,'Todas')}</select></label></div>` : ''}
  <div class="catalog-meta"><strong>${filtered.length} resultados</strong><span class="sync-state">${state.onlineData ? 'Sincronizado con Google Sheets' : 'Datos locales'}</span></div>
  <div class="catalog-list">${filtered.slice(0,state.visible).map(item => `<article class="card catalog-item type-${activityFor(item)}">${visualCardHead(item)}<button class="catalog-copy" data-detail="${escapeHtml(item.id)}" aria-label="Ver ficha de ${escapeHtml(item.name)}"><div class="badge-row"><span class="badge">${escapeHtml(item.type || item.itemKind)}</span>${item.origin === 'family' ? '<span class="badge accent">Propuesto por la familia</span>' : ''}</div><h3>${escapeHtml(item.name)}</h3><p class="muted">${escapeHtml([item.area,item.borough,item.timeNeeded].filter(Boolean).join(' · '))}</p>${knowNote(item)}</button><button class="button interest-button ${state.interests.has(item.id)?'selected':''}" data-interest="${escapeHtml(item.id)}">${state.interests.has(item.id)?'Seleccionado':'Me gustaría ir'}</button></article>`).join('')}</div>${filtered.length > state.visible ? '<button class="button block" data-action="more">Mostrar más</button>' : ''}</section>`;
}

function itemComments(itemId) {
  return (state.remoteComments || []).filter(comment => comment.itemId === itemId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function renderDetail() {
  const item = allItems().find(entry => entry.id === state.detailId);
  if (!item) { state.view = 'catalog'; return renderCatalog(); }
  const comments = itemComments(item.id);
  const description = item.description || item.shortDescription || item.whyItMatters || item.bestFor || 'Todavía no hay una descripción editorial completa.';
  const context = item.storyAngle || item.bestFor || item.ifCondition || '';
  const externalRating = item.rating ? `<div class="rating-block"><strong>${escapeHtml(item.rating)}</strong><span>${escapeHtml(item.reviews ? `${Number(item.reviews).toLocaleString('es-ES')} opiniones` : 'Valoración externa')}</span></div>` : '';
  const km = distanceKm(item);
  return `<section class="view active detail-view"><button class="back-link" data-action="back-detail">← Volver</button>
    <header class="detail-hero type-${activityFor(item)}"><div><div class="badge-row"><span class="subway-bullet">${routeBadge(activityFor(item))}</span><span class="badge accent">${escapeHtml(item.type || item.itemKind)}</span>${item.origin === 'family' ? '<span class="badge">Propuesto por la familia</span>' : ''}</div><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml([item.area,item.borough].filter(Boolean).join(' · '))}</p></div><div class="detail-monogram" aria-hidden="true"><span>${activityIcon(activityFor(item))}</span><small>${escapeHtml(item.name.slice(0,2).toUpperCase())}</small></div></header>
    <div class="detail-actions"><button class="button primary" data-add-plan="${escapeHtml(item.id)}">Añadir al itinerario</button><button class="button interest-button ${state.interests.has(item.id)?'selected':''}" data-interest="${escapeHtml(item.id)}">${state.interests.has(item.id)?'Me interesa':'Me gustaría ir'}</button>${item.mapsUrl ? `<a class="button" href="${escapeHtml(item.mapsUrl)}" target="_blank" rel="noopener">Abrir en Maps</a>` : ''}${item.ticketUrl ? `<a class="button" href="${escapeHtml(item.ticketUrl)}" target="_blank" rel="noopener">Entradas / RSVP</a>` : ''}${item.officialUrl ? `<a class="button" href="${escapeHtml(item.officialUrl)}" target="_blank" rel="noopener">Web oficial</a>` : ''}</div>
    <div class="detail-layout"><div class="detail-main">
      <section class="detail-section"><p class="detail-lead">${escapeHtml(description)}</p>${context && context !== description ? `<p>${escapeHtml(context)}</p>` : ''}</section>
      <section class="detail-section"><h3>Información práctica</h3><dl class="facts-list">${detailFact('Fecha', item.itemKind === 'activity' ? formatActivityDate(item) : '')}${detailFact('Hora', activityTime(item))}${detailFact('Distancia',formatDistance(km))}${detailFact('Duración',item.timeNeeded || (item.idealMinutes ? `${item.idealMinutes} min` : ''))}${detailFact('Precio',item.price || item.costLevel)}${detailFact('Mejor momento',item.bestMoment)}${detailFact('Entorno',item.setting || item.weatherFit)}${detailFact('Energía',item.energyLevel)}${detailFact('Reserva',item.reservationRequired || item.reservationStatus)}${detailFact('Dirección',item.address)}${detailFact('Última comprobación',item.lastChecked)}</dl></section>
      ${item.notes ? `<section class="detail-section"><h3>Conviene saber</h3><p>${escapeHtml(item.notes)}</p></section>` : ''}
      <section class="detail-section"><div class="comments-head"><div><h3>Comentarios familiares</h3><p class="muted">Consejos y opiniones compartidos durante la preparación y el viaje.</p></div><span class="badge family">${comments.length}</span></div>${comments.length ? `<div class="comments-list">${comments.map(comment => `<article class="family-comment"><span class="comment-type">${escapeHtml(comment.commentType || 'comentario')}</span><p>${escapeHtml(comment.text)}</p><time>${escapeHtml(formatDate(comment.createdAt))}</time></article>`).join('')}</div>` : '<p class="muted">Todavía no hay comentarios.</p>'}
      <form id="comment-form" class="comment-form"><label>Tipo<select name="commentType"><option value="consejo">Consejo</option><option value="opinión">Opinión</option><option value="aviso">Aviso</option></select></label><label>Comentario<textarea name="text" required maxlength="600" rows="3" placeholder="Añade algo útil para la familia"></textarea></label><button class="button primary" type="submit">Publicar comentario</button></form></section>
    </div><aside class="detail-aside"><div class="panel"><p class="eyebrow">Interés familiar</p><strong class="big-number">${familyCount(item.id)}/${CONFIG.familySize || 4}</strong><p class="muted">personas interesadas</p></div>${externalRating ? `<div class="panel"><p class="eyebrow">Opiniones externas</p>${externalRating}${item.mapsUrl ? `<a href="${escapeHtml(item.mapsUrl)}" target="_blank" rel="noopener">Leer en Google Maps →</a>` : ''}</div>` : ''}</aside></div>
  </section>`;
}

function detailFact(label, value) {
  return value ? `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>` : '';
}

function formatDate(value) {
  if (!value) return 'Ahora';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',year:'numeric'}).format(date);
}

function proposalForm() {
  return `<form class="panel form-panel" id="proposal-form"><h3>Añadir un lugar</h3><p class="muted">Con tres datos ya queda útil para votar y decidir. Si falta algo, luego lo completamos en la ficha.</p><div class="form-grid"><label>Nombre<input name="name" required maxlength="160" placeholder="Ej. Levain Bakery"></label><label>Enlace de Google Maps<input name="mapsUrl" type="url" required placeholder="https://www.google.com/maps/..."></label><label>Tipo<select name="type"><option value="Gastronomía">Gastronomía</option><option value="Compras">Compras</option><option value="Cultura / ocio">Cultura / ocio</option><option value="Paseo / zona">Paseo / zona</option><option value="Mirador / icono">Mirador / icono</option></select></label><label>Zona o barrio<input name="area" maxlength="120" placeholder="SoHo, Midtown, Williamsburg..."></label><label>Por qué lo propones<textarea name="whyItMatters" rows="3" maxlength="500" placeholder="Qué pinta tiene, para quién encaja o cuándo lo haríais"></textarea></label><label>Nota práctica opcional<textarea name="notes" rows="2" maxlength="500" placeholder="Colas, reserva, algo que conviene saber..."></textarea></label><div class="actions"><button class="button primary" type="submit">Añadir al catálogo</button><button class="button" type="button" data-action="close-proposal">Cancelar</button></div></div></form>`;
}

function renderPlan() {
  const items = state.plan.map(id => allItems().find(item => itemKey(item.id) === itemKey(id))).filter(Boolean);
  const pendingText = state.pendingPlanRemovals.size ? ` · ${state.pendingPlanRemovals.size} borrado${state.pendingPlanRemovals.size === 1 ? '' : 's'} pendiente${state.pendingPlanRemovals.size === 1 ? '' : 's'} de sincronizar` : '';
  return `<section class="view active"><div class="section-head"><div><h2>Plan familiar</h2><p class="muted">${items.length} ${items.length===1?'parada':'paradas'} · ${state.onlineData ? 'sincronizado con Google Sheets' : 'guardado en este dispositivo hasta sincronizar'}${pendingText}</p></div></div>${items.length ? `<div class="panel intro station-sign"><span class="station-kicker">Plan compartido</span><h3>Itinerario familiar</h3><p class="muted">Las paradas añadidas o quitadas se guardan en el plan común cuando la sincronización está disponible.</p></div><div class="plan-list">${items.map((item,index) => `<article class="card plan-item type-${activityFor(item)}"><div class="plan-position">${index+1}</div><div><div class="badge-row"><span class="badge">${item.itemKind === 'activity' ? 'Actividad' : 'Lugar'}</span>${item.itemKind === 'activity' && activityTime(item) ? `<span class="badge time-badge">${escapeHtml(activityTime(item))}</span>` : ''}</div><h3>${escapeHtml(item.name)}</h3><p class="muted">${escapeHtml([item.itemKind === 'activity' ? formatActivityDate(item) : '', item.area, item.timeNeeded].filter(Boolean).join(' · '))}</p></div><button class="button small danger" data-remove-plan="${escapeHtml(item.id)}">Quitar</button></article>`).join('')}</div><button class="button primary block" style="margin-top:14px" data-action="maps-plan">Abrir recorrido en Google Maps</button>` : `<div class="panel empty"><h3>El plan familiar está vacío</h3><p class="muted">Añade lugares desde Decidir o Catálogo, o actividades desde Hoy. Si hay conexión, se guardarán en el plan común.</p><button class="button primary" data-view="today">Ver actividades</button></div>`}</section>`;
}

async function addToPlan(itemId, button) {
  const id = itemKey(itemId);
  const item = allItems().find(entry => itemKey(entry.id) === id);
  state.pendingPlanRemovals.delete(id);
  if (!state.plan.some(planId => itemKey(planId) === id)) state.plan.push(id);
  saveLocal();
  if (button) button.textContent = 'Añadido';
  try {
    await writeAction('planItem', { deviceId: state.deviceId, itemId: id, itemKind: item?.itemKind || 'place', position: state.plan.length });
  } catch {}
}

async function removeFromPlan(itemId) {
  const id = itemKey(itemId);
  state.plan = state.plan.filter(planId => itemKey(planId) !== id);
  state.pendingPlanRemovals.add(id);
  state.message = { type: 'success', text: 'Parada quitada del itinerario. Se sincronizará con el plan familiar.' };
  saveLocal();
  render();
  try {
    await writeAction('removePlanItem', { deviceId: state.deviceId, itemId: id });
  } catch {}
}

function openMapsPlan() {
  const items = state.plan.map(id => allItems().find(item => itemKey(item.id) === itemKey(id))).filter(item => item?.lat && item?.lng);
  if (!items.length) {
    state.message = { type: 'error', text: 'No hay lugares con coordenadas en el itinerario.' };
    render();
    return;
  }
  const points = items.map(item => `${item.lat},${item.lng}`);
  const url = items.length === 1 ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(points[0])}` : `https://www.google.com/maps/dir/${points.map(encodeURIComponent).join('/')}`;
  window.open(url, '_blank', 'noopener');
}

function render() {
  app.innerHTML = `<main class="shell">${appHeader()}${notice()}${state.view === 'detail' ? renderDetail() : state.view === 'decide' ? renderDecide() : state.view === 'catalog' ? renderCatalog() : state.view === 'today' ? renderToday() : renderPlan()}</main>`;
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; state.message = null; render(); }));
  document.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', () => { state.detailId = button.dataset.detail; state.view = 'detail'; state.message = null; render(); window.scrollTo({top:0,behavior:'smooth'}); }));
  document.querySelector('[data-action="back-detail"]')?.addEventListener('click', () => { state.view = 'catalog'; render(); });
  document.querySelector('[data-action="toggle-mode"]')?.addEventListener('click', () => { state.mode = state.mode === 'preparation' ? 'trip' : 'preparation'; state.view = state.mode === 'preparation' ? 'catalog' : 'decide'; render(); });
  document.querySelector('[data-action="near"]')?.addEventListener('click', toggleNearMe);
  document.querySelector('[data-action="today-near"]')?.addEventListener('click', activateLocationForToday);
  document.querySelectorAll('[data-today-mode]').forEach(button => button.addEventListener('click', () => { state.todayMode = button.dataset.todayMode; state.message = null; render(); }));
  document.querySelectorAll('[data-decide]').forEach(control => control.addEventListener('change', () => { state.decide[control.dataset.decide] = control.dataset.decide === 'time' ? Number(control.value) : control.value; if (control.dataset.decide === 'borough') state.decide.area = ''; render(); }));
  document.querySelectorAll('[data-activity]').forEach(button => button.addEventListener('click', () => { state.decide.activity = button.dataset.activity; render(); }));
  document.querySelector('[data-action="show-results"]')?.addEventListener('click', () => { document.querySelector('#recommendations').innerHTML = recommendationCards(); bindResultEvents(); document.querySelector('#recommendations').scrollIntoView({behavior:'smooth',block:'start'}); });
  document.querySelector('[data-action="proposal-form"]')?.addEventListener('click', () => { document.querySelector('#proposal-slot').innerHTML = proposalForm(); bindProposal(); });
  document.querySelector('[data-action="toggle-filters"]')?.addEventListener('click', () => { state.filtersOpen = !state.filtersOpen; render(); });
  document.querySelector('[data-action="more"]')?.addEventListener('click', () => { state.visible += 24; render(); });
  document.querySelectorAll('[data-filter]').forEach(control => control.addEventListener(control.type === 'search' ? 'input' : 'change', () => {
    const filterName = control.dataset.filter;
    const cursor = control.selectionStart;
    state.filters[filterName] = control.value;
    if (filterName === 'borough') state.filters.area = '';
    state.visible = 24;
    render();
    if (filterName === 'search') {
      const nextSearch = document.querySelector('[data-filter="search"]');
      nextSearch?.focus();
      nextSearch?.setSelectionRange(cursor, cursor);
    }
  }));
  document.querySelectorAll('[data-interest]').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.interest;
    const item = allItems().find(entry => entry.id === id);
    state.interests.has(id) ? state.interests.delete(id) : state.interests.add(id);
    saveLocal();
    render();
    try {
      await writeAction('interest', {
        deviceId: state.deviceId,
        itemId: id,
        itemKind: item?.itemKind || 'place',
        interested: state.interests.has(id),
        itemDate: item?.itemKind === 'activity' && item.startDate && (!item.endDate || item.endDate === item.startDate) ? item.startDate : '',
        startDate: item?.itemKind === 'activity' ? item.startDate || '' : '',
        endDate: item?.itemKind === 'activity' ? item.endDate || item.startDate || '' : ''
      });
    } catch {}
  }));
  document.querySelectorAll('[data-remove-plan]').forEach(button => button.addEventListener('click', () => removeFromPlan(button.dataset.removePlan)));
  document.querySelectorAll('[data-add-plan]').forEach(button => button.addEventListener('click', () => addToPlan(button.dataset.addPlan, button)));
  document.querySelector('[data-action="maps-plan"]')?.addEventListener('click', openMapsPlan);
  document.querySelector('#comment-form')?.addEventListener('submit', submitComment);
}

function bindResultEvents() {
  document.querySelector('[data-action="relax"]')?.addEventListener('click', () => { state.decide.time=999; state.decide.energy='cualquiera'; state.decide.setting='cualquiera'; render(); });
  document.querySelectorAll('[data-add-plan]').forEach(button => button.addEventListener('click', () => addToPlan(button.dataset.addPlan, button)));
  document.querySelectorAll('#recommendations [data-detail]').forEach(button => button.addEventListener('click', () => { state.detailId = button.dataset.detail; state.view = 'detail'; state.message = null; render(); window.scrollTo({top:0,behavior:'smooth'}); }));
}

function bindProposal() {
  document.querySelector('[data-action="close-proposal"]')?.addEventListener('click', () => { document.querySelector('#proposal-slot').innerHTML=''; });
  document.querySelector('#proposal-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const proposal = {
      id:`FAM-${crypto.randomUUID()}`,
      name:data.get('name').trim(),
      mapsUrl:data.get('mapsUrl').trim(),
      type:data.get('type') || 'Propuesto por la familia',
      category:'Propuesta familiar',
      area:data.get('area').trim(),
      shortDescription:data.get('whyItMatters').trim(),
      whyItMatters:data.get('whyItMatters').trim(),
      notes:data.get('notes').trim(),
      origin:'family',
      status:'propuesto',
      published:true,
      proposedAt:new Date().toISOString(),
      deviceId:state.deviceId
    };
    state.catalog.unshift({ ...proposal, itemKind:'place' });
    state.interests.add(proposal.id); saveLocal();
    state.message = {type:'success',text:CONFIG.apiUrl?'Lugar enviado a Google Sheets.':'Lugar guardado localmente. Añade la URL de Apps Script en config.js para sincronizarlo.'};
    render();
    try { await writeAction('proposal',proposal); } catch (error) { state.message={type:'error',text:`El lugar está guardado localmente, pero no se pudo sincronizar: ${error.message}`}; render(); }
  });
}

async function submitComment(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const comment = { commentId:`COM-${crypto.randomUUID()}`, itemId:state.detailId, deviceId:state.deviceId, commentType:data.get('commentType'), text:data.get('text').trim(), createdAt:new Date().toISOString() };
  state.remoteComments.unshift(comment);
  state.message = {type:'success',text:'Comentario añadido.'};
  render();
  try { await writeAction('comment',comment); } catch (error) { state.message={type:'error',text:`El comentario se conserva en pantalla, pero no pudo sincronizarse: ${error.message}`}; render(); }
}

async function start() {
  try {
    state.catalog = await loadSeed();
    render();
    try {
      await loadRemote();
      state.loadingCatalog = false;
      render();
    } catch (error) {
      state.loadingCatalog = false;
      state.message = {type:'error',text:`Usando la copia local: ${error.message}`};
      render();
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
  } catch (error) {
    app.innerHTML = `<main class="shell"><div class="panel empty"><h1>No se pudo abrir la guía</h1><p>${escapeHtml(error.message)}</p></div></main>`;
  }
}

start();
