const CONFIG = window.NYC_CONFIG || {};
const state = {
  view: 'catalog',
  mode: 'preparation',
  catalog: [],
  interests: new Set(JSON.parse(localStorage.getItem('nyc-interests') || '[]')),
  plan: JSON.parse(localStorage.getItem('nyc-plan') || '[]'),
  deviceId: localStorage.getItem('nyc-device-id') || crypto.randomUUID(),
  filters: { search: '', type: '', borough: '', area: '', status: 'all' },
  decide: { near: false, borough: 'Manhattan', area: '', activity: 'cultura', time: 120, energy: 'bajo', setting: 'interior' },
  visible: 24,
  onlineData: false,
  message: null,
  detailId: null,
  remoteComments: []
};
localStorage.setItem('nyc-device-id', state.deviceId);

const app = document.querySelector('#app');
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const slug = value => normalize(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
const familyCount = itemId => state.remoteInterests?.filter(item => item.itemId === itemId && String(item.interested).toLowerCase() !== 'false').length || (state.interests.has(itemId) ? 1 : 0);
const decisionArea = item => item.simpleArea || item.macroArea || item.decisionArea || item.cluster || item.area || '';

function saveLocal() {
  localStorage.setItem('nyc-interests', JSON.stringify([...state.interests]));
  localStorage.setItem('nyc-plan', JSON.stringify(state.plan));
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
  const items = [...places, ...experiences, ...(payload.data.proposals || []).map(proposal => ({
    id: proposal.id, itemKind: 'place', name: proposal.name, mapsUrl: proposal.mapsUrl, notes: proposal.notes,
    type: 'Propuesto por la familia', category: 'Propuesta familiar', origin: 'family', published: true
  }))];
  if (items.length) state.catalog = items;
  state.remoteInterests = payload.data.interests || [];
  state.remoteComments = payload.data.comments || [];
  state.onlineData = true;
}

async function writeAction(action, payload) {
  if (!CONFIG.apiUrl) return { simulated: true };
  const body = new URLSearchParams({ action, key: CONFIG.familyKey || '', payload: JSON.stringify(payload) });
  await fetch(CONFIG.apiUrl, { method: 'POST', mode: 'no-cors', body });
  return { queued: true };
}

function appHeader() {
  return `<header class="masthead"><div class="brand"><div class="brand-mark">NY</div><div><p class="eyebrow">Guía familiar · 2026</p><h1>${state.view === 'detail' ? 'Ficha del lugar' : state.view === 'decide' ? '¿Qué hacemos ahora?' : state.view === 'catalog' ? 'Catálogo de Nueva York' : 'Nuestro itinerario'}</h1></div></div><button class="mode" data-action="toggle-mode">${state.mode === 'preparation' ? 'Modo preparación' : 'Modo viaje'}</button></header>
  <nav class="primary-nav" aria-label="Navegación principal">${[['decide','Decidir'],['catalog','Catálogo'],['plan','Itinerario']].map(([id,label]) => `<button class="nav-button ${state.view === id ? 'active' : ''}" data-view="${id}">${label}</button>`).join('')}</nav>`;
}

function notice() {
  if (!state.message) return '';
  return `<div class="notice ${state.message.type || ''}" role="status">${escapeHtml(state.message.text)}</div>`;
}

function selectOptions(values, selected, emptyLabel) {
  return `<option value="">${emptyLabel}</option>${values.map(value => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}`;
}

function activityFor(item) {
  const text = normalize(`${item.type} ${item.subtype} ${item.category}`);
  if (/gastronom|restaurante|pizza|comida|mercado|panader/.test(text)) return 'comida';
  if (/compra|tienda|outlet|shopping/.test(text)) return 'compras';
  if (/museo|cultura|mirador|iglesia|arte|historia|observatory/.test(text)) return 'cultura';
  return 'paseo';
}

function matchesSetting(item, wanted) {
  if (!wanted || wanted === 'cualquiera' || !item.setting) return true;
  return item.setting === wanted || item.setting === 'mixto';
}

function decideMatches() {
  const d = state.decide;
  return state.catalog.filter(item => {
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
    return { ...item, score: votes * 5 + priority * 2 + fit };
  }).sort((a, b) => b.score - a.score || (b.rating || 0) - (a.rating || 0));
}

function renderDecide() {
  const boroughs = unique(state.catalog.map(item => item.borough));
  const areas = unique(state.catalog.filter(item => !state.decide.borough || item.borough === state.decide.borough).map(decisionArea));
  const matches = decideMatches();
  return `<section class="view active"><div class="panel intro"><h2>Reducimos las opciones por vosotros</h2><p class="muted">Elige solo lo importante. Los intereses previos ayudan a ordenar los resultados.</p></div>
  <div class="step"><h3>1 · ¿Dónde queréis estar?</h3><div class="location-grid"><button class="button near ${state.decide.near ? 'active' : ''}" data-action="near">Cerca de mí</button><label>Borough<select data-decide="borough" ${state.decide.near ? 'disabled' : ''}>${selectOptions(boroughs,state.decide.borough,'Cualquier borough')}</select></label><label>Zona o barrio<select data-decide="area" ${state.decide.near ? 'disabled' : ''}>${selectOptions(areas,state.decide.area,'Cualquier zona')}</select></label></div></div>
  <div class="step"><h3>2 · ¿Qué os apetece?</h3><div class="choice-grid">${[['cultura','Cultura e iconos'],['paseo','Pasear y descubrir'],['comida','Comer algo'],['compras','Compras']].map(([id,label]) => `<button class="choice ${state.decide.activity === id ? 'active' : ''}" data-activity="${id}">${label}</button>`).join('')}</div></div>
  <div class="step"><h3>3 · Condiciones del momento</h3><div class="conditions"><label>Tiempo<select data-decide="time"><option value="60" ${state.decide.time===60?'selected':''}>Menos de 1 hora</option><option value="120" ${state.decide.time===120?'selected':''}>1–2 horas</option><option value="240" ${state.decide.time===240?'selected':''}>Media jornada</option><option value="999" ${state.decide.time===999?'selected':''}>Sin límite</option></select></label><label>Energía<select data-decide="energy"><option value="bajo" ${state.decide.energy==='bajo'?'selected':''}>Plan tranquilo</option><option value="medio" ${state.decide.energy==='medio'?'selected':''}>Podemos caminar</option><option value="cualquiera" ${state.decide.energy==='cualquiera'?'selected':''}>Nos da igual</option></select></label><label>Clima<select data-decide="setting"><option value="interior" ${state.decide.setting==='interior'?'selected':''}>Necesitamos interior</option><option value="exterior" ${state.decide.setting==='exterior'?'selected':''}>Preferimos exterior</option><option value="cualquiera" ${state.decide.setting==='cualquiera'?'selected':''}>Indiferente</option></select></label></div></div>
  <p class="match-count"><strong>${matches.length}</strong> lugares o experiencias encajan.</p><button class="button primary block" data-action="show-results">Ver las mejores opciones</button><div id="recommendations"></div></section>`;
}

function recommendationCards() {
  const matches = decideMatches().slice(0, 3);
  if (!matches.length) return `<div class="panel empty"><h3>No hay coincidencias exactas</h3><p class="muted">Amplía el tiempo o marca clima y energía como indiferentes.</p><button class="button" data-action="relax">Relajar condiciones</button></div>`;
  const labels = ['La que mejor encaja', 'Favorita familiar', 'Una alternativa'];
  return `<div class="results" style="margin-top:16px">${matches.map((item, index) => `<article class="card ${index === 0 ? 'recommended' : ''}"><span class="badge ${index===0?'accent':''}">${labels[index]}</span><h3>${escapeHtml(item.name)}</h3><p class="muted">${escapeHtml([item.area,item.type || item.subtype].filter(Boolean).join(' · '))}</p><p>${escapeHtml(item.shortDescription || item.whyItMatters || item.bestFor || 'Una opción que encaja con las condiciones seleccionadas.')}</p><div class="badge-row"><span class="badge">${escapeHtml(item.timeNeeded || `${item.idealMinutes || '?'} min`)}</span>${item.setting ? `<span class="badge">${escapeHtml(item.setting)}</span>` : ''}<span class="badge family">${familyCount(item.id)} de ${CONFIG.familySize || 4} interesados</span></div><div class="actions"><button class="button ${index===0?'primary':''}" data-add-plan="${escapeHtml(item.id)}">Añadir al plan</button><button class="button" data-detail="${escapeHtml(item.id)}">Ver ficha</button>${item.mapsUrl ? `<a class="button" href="${escapeHtml(item.mapsUrl)}" target="_blank" rel="noopener">Google Maps</a>` : ''}</div></article>`).join('')}</div>`;
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
  const types = unique(state.catalog.map(item => item.type));
  const boroughs = unique(state.catalog.map(item => item.borough));
  const areas = unique(state.catalog.filter(item => !state.filters.borough || item.borough === state.filters.borough).map(decisionArea));
  const filtered = catalogFiltered();
  const selected = state.interests.size;
  return `<section class="view active"><div class="section-head"><div><h2>Todo el catálogo</h2><p class="muted">${state.catalog.length} opciones · ${selected} seleccionadas en este dispositivo</p></div><div class="catalog-toolbar"><button class="button primary" data-action="proposal-form">+ Añadir lugar</button></div></div>
  ${state.mode === 'preparation' ? `<div class="panel intro"><h3>¿Qué te gustaría visitar?</h3><p class="muted">Marca tus intereses. Las coincidencias familiares influirán en las recomendaciones.</p><div class="progress"><span style="width:${Math.min(100, state.catalog.length ? selected/state.catalog.length*100 : 0)}%"></span></div></div>` : ''}
  <div id="proposal-slot"></div><div class="filters"><label>Buscar<input type="search" data-filter="search" value="${escapeHtml(state.filters.search)}" placeholder="Lugar, barrio o actividad"></label><label>Mostrar<select data-filter="status"><option value="all">Todos</option><option value="pending" ${state.filters.status==='pending'?'selected':''}>Pendientes</option><option value="selected" ${state.filters.status==='selected'?'selected':''}>Mis selecciones</option><option value="family" ${state.filters.status==='family'?'selected':''}>Coincidencias</option></select></label><label>Tipo<select data-filter="type">${selectOptions(types,state.filters.type,'Todos')}</select></label><label>Borough<select data-filter="borough">${selectOptions(boroughs,state.filters.borough,'Todos')}</select></label><label>Zona<select data-filter="area">${selectOptions(areas,state.filters.area,'Todas')}</select></label></div>
  <div class="catalog-meta"><strong>${filtered.length} resultados</strong><span class="sync-state">${state.onlineData ? 'Sincronizado con Google Sheets' : 'Datos locales'}</span></div>
  <div class="catalog-list">${filtered.slice(0,state.visible).map(item => `<article class="card catalog-item"><button class="catalog-copy" data-detail="${escapeHtml(item.id)}" aria-label="Ver ficha de ${escapeHtml(item.name)}"><div class="badge-row"><span class="badge">${escapeHtml(item.type || item.itemKind)}</span>${item.origin === 'family' ? '<span class="badge accent">Propuesto por la familia</span>' : ''}</div><h3>${escapeHtml(item.name)}</h3><p class="muted">${escapeHtml([item.area,item.borough,item.timeNeeded].filter(Boolean).join(' · '))}</p><p class="catalog-description">${escapeHtml(item.shortDescription || item.whyItMatters || '')}</p></button><button class="button interest-button ${state.interests.has(item.id)?'selected':''}" data-interest="${escapeHtml(item.id)}">${state.interests.has(item.id)?'Seleccionado':'Me gustaría ir'}</button></article>`).join('')}</div>${filtered.length > state.visible ? '<button class="button block" data-action="more">Mostrar más</button>' : ''}</section>`;
}

function itemComments(itemId) {
  return (state.remoteComments || []).filter(comment => comment.itemId === itemId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function renderDetail() {
  const item = state.catalog.find(entry => entry.id === state.detailId);
  if (!item) { state.view = 'catalog'; return renderCatalog(); }
  const comments = itemComments(item.id);
  const description = item.description || item.shortDescription || item.whyItMatters || item.bestFor || 'Todavía no hay una descripción editorial completa.';
  const context = item.storyAngle || item.bestFor || item.ifCondition || '';
  const externalRating = item.rating ? `<div class="rating-block"><strong>${escapeHtml(item.rating)}</strong><span>${escapeHtml(item.reviews ? `${Number(item.reviews).toLocaleString('es-ES')} opiniones` : 'Valoración externa')}</span></div>` : '';
  return `<section class="view active detail-view"><button class="back-link" data-action="back-detail">← Volver</button>
    <header class="detail-hero"><div><div class="badge-row"><span class="badge accent">${escapeHtml(item.type || item.itemKind)}</span>${item.origin === 'family' ? '<span class="badge">Propuesto por la familia</span>' : ''}</div><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml([item.area,item.borough].filter(Boolean).join(' · '))}</p></div><div class="detail-monogram" aria-hidden="true">${escapeHtml(item.name.slice(0,2).toUpperCase())}</div></header>
    <div class="detail-actions"><button class="button primary" data-add-plan="${escapeHtml(item.id)}">Añadir al itinerario</button><button class="button interest-button ${state.interests.has(item.id)?'selected':''}" data-interest="${escapeHtml(item.id)}">${state.interests.has(item.id)?'Me interesa':'Me gustaría ir'}</button>${item.mapsUrl ? `<a class="button" href="${escapeHtml(item.mapsUrl)}" target="_blank" rel="noopener">Abrir en Maps</a>` : ''}${item.officialUrl ? `<a class="button" href="${escapeHtml(item.officialUrl)}" target="_blank" rel="noopener">Web oficial</a>` : ''}</div>
    <div class="detail-layout"><div class="detail-main">
      <section class="detail-section"><p class="detail-lead">${escapeHtml(description)}</p>${context && context !== description ? `<p>${escapeHtml(context)}</p>` : ''}</section>
      <section class="detail-section"><h3>Información práctica</h3><dl class="facts-list">${detailFact('Duración',item.timeNeeded || (item.idealMinutes ? `${item.idealMinutes} min` : ''))}${detailFact('Precio',item.price || item.costLevel)}${detailFact('Mejor momento',item.bestMoment)}${detailFact('Entorno',item.setting || item.weatherFit)}${detailFact('Energía',item.energyLevel)}${detailFact('Reserva',item.reservationStatus)}${detailFact('Dirección',item.address)}${detailFact('Última comprobación',item.lastChecked)}</dl></section>
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
  return `<form class="panel form-panel" id="proposal-form"><h3>Añadir un lugar</h3><div class="form-grid"><label>Nombre<input name="name" required maxlength="160"></label><label>Enlace de Google Maps<input name="mapsUrl" type="url" required></label><label>Nota opcional<textarea name="notes" rows="3" maxlength="500"></textarea></label><div class="actions"><button class="button primary" type="submit">Añadir al catálogo</button><button class="button" type="button" data-action="close-proposal">Cancelar</button></div></div></form>`;
}

function renderPlan() {
  const items = state.plan.map(id => state.catalog.find(item => item.id === id)).filter(Boolean);
  return `<section class="view active"><div class="section-head"><div><h2>Plan familiar</h2><p class="muted">${items.length} ${items.length===1?'parada':'paradas'} · orden flexible</p></div></div>${items.length ? `<div class="plan-list">${items.map((item,index) => `<article class="card plan-item"><div class="plan-position">${index+1}</div><div><h3>${escapeHtml(item.name)}</h3><p class="muted">${escapeHtml([item.area,item.timeNeeded].filter(Boolean).join(' · '))}</p></div><button class="button small danger" data-remove-plan="${escapeHtml(item.id)}">Quitar</button></article>`).join('')}</div><button class="button primary block" style="margin-top:14px" data-action="maps-plan">Abrir recorrido en Google Maps</button>` : `<div class="panel empty"><h3>El itinerario está vacío</h3><p class="muted">Añade lugares desde Decidir o desde el catálogo.</p><button class="button primary" data-view="decide">Buscar un plan</button></div>`}</section>`;
}

function openMapsPlan() {
  const items = state.plan.map(id => state.catalog.find(item => item.id === id)).filter(item => item?.lat && item?.lng);
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
  app.innerHTML = `<main class="shell">${appHeader()}${notice()}${state.view === 'detail' ? renderDetail() : state.view === 'decide' ? renderDecide() : state.view === 'catalog' ? renderCatalog() : renderPlan()}</main>`;
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; state.message = null; render(); }));
  document.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', () => { state.detailId = button.dataset.detail; state.view = 'detail'; state.message = null; render(); window.scrollTo({top:0,behavior:'smooth'}); }));
  document.querySelector('[data-action="back-detail"]')?.addEventListener('click', () => { state.view = 'catalog'; render(); });
  document.querySelector('[data-action="toggle-mode"]')?.addEventListener('click', () => { state.mode = state.mode === 'preparation' ? 'trip' : 'preparation'; state.view = state.mode === 'preparation' ? 'catalog' : 'decide'; render(); });
  document.querySelector('[data-action="near"]')?.addEventListener('click', () => { state.decide.near = !state.decide.near; render(); });
  document.querySelectorAll('[data-decide]').forEach(control => control.addEventListener('change', () => { state.decide[control.dataset.decide] = control.dataset.decide === 'time' ? Number(control.value) : control.value; if (control.dataset.decide === 'borough') state.decide.area = ''; render(); }));
  document.querySelectorAll('[data-activity]').forEach(button => button.addEventListener('click', () => { state.decide.activity = button.dataset.activity; render(); }));
  document.querySelector('[data-action="show-results"]')?.addEventListener('click', () => { document.querySelector('#recommendations').innerHTML = recommendationCards(); bindResultEvents(); document.querySelector('#recommendations').scrollIntoView({behavior:'smooth',block:'start'}); });
  document.querySelector('[data-action="proposal-form"]')?.addEventListener('click', () => { document.querySelector('#proposal-slot').innerHTML = proposalForm(); bindProposal(); });
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
  document.querySelectorAll('[data-interest]').forEach(button => button.addEventListener('click', async () => { const id = button.dataset.interest; state.interests.has(id) ? state.interests.delete(id) : state.interests.add(id); saveLocal(); render(); try { await writeAction('interest', { deviceId: state.deviceId, itemId: id, itemKind: state.catalog.find(item => item.id===id)?.itemKind || 'place', interested: state.interests.has(id) }); } catch {} }));
  document.querySelectorAll('[data-remove-plan]').forEach(button => button.addEventListener('click', () => { state.plan = state.plan.filter(id => id !== button.dataset.removePlan); saveLocal(); render(); }));
  document.querySelectorAll('[data-add-plan]').forEach(button => button.addEventListener('click', async () => { if (!state.plan.includes(button.dataset.addPlan)) state.plan.push(button.dataset.addPlan); saveLocal(); button.textContent='Añadido'; try { await writeAction('planItem',{deviceId:state.deviceId,itemId:button.dataset.addPlan,position:state.plan.length}); } catch {} }));
  document.querySelector('[data-action="maps-plan"]')?.addEventListener('click', openMapsPlan);
  document.querySelector('#comment-form')?.addEventListener('submit', submitComment);
}

function bindResultEvents() {
  document.querySelector('[data-action="relax"]')?.addEventListener('click', () => { state.decide.time=999; state.decide.energy='cualquiera'; state.decide.setting='cualquiera'; render(); });
  document.querySelectorAll('[data-add-plan]').forEach(button => button.addEventListener('click', async () => { if (!state.plan.includes(button.dataset.addPlan)) state.plan.push(button.dataset.addPlan); saveLocal(); button.textContent='Añadido'; try { await writeAction('planItem',{deviceId:state.deviceId,itemId:button.dataset.addPlan,position:state.plan.length}); } catch {} }));
  document.querySelectorAll('#recommendations [data-detail]').forEach(button => button.addEventListener('click', () => { state.detailId = button.dataset.detail; state.view = 'detail'; state.message = null; render(); window.scrollTo({top:0,behavior:'smooth'}); }));
}

function bindProposal() {
  document.querySelector('[data-action="close-proposal"]')?.addEventListener('click', () => { document.querySelector('#proposal-slot').innerHTML=''; });
  document.querySelector('#proposal-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const proposal = { id:`FAM-${crypto.randomUUID()}`, name:data.get('name').trim(), mapsUrl:data.get('mapsUrl').trim(), notes:data.get('notes').trim(), origin:'family', status:'propuesto', published:true, proposedAt:new Date().toISOString(), deviceId:state.deviceId };
    state.catalog.unshift({ ...proposal, itemKind:'place', type:'Propuesto por la familia', category:'Propuesta familiar' });
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
    try { await loadRemote(); render(); } catch (error) { state.message = {type:'error',text:`Usando la copia local: ${error.message}`}; render(); }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
  } catch (error) {
    app.innerHTML = `<main class="shell"><div class="panel empty"><h1>No se pudo abrir la guía</h1><p>${escapeHtml(error.message)}</p></div></main>`;
  }
}

start();
