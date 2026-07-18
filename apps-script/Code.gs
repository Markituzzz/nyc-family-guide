const SPREADSHEET_ID = '1WaotDKkqltUQlrPKYuo7ZupEIKUF27tuklrGcSe4brM';
const APP_SCRIPT_VERSION = '20260718-activities-v2';
const SHEETS = {
  places: 'Lugares', experiences: 'Experiencias', interests: 'Intereses', proposals: 'PropuestasFamilia',
  comments: 'Comentarios', itineraries: 'Itinerarios', itineraryItems: 'ItinerarioItems',
  planChanges: 'ItinerarioCambios', activities: 'CalendarioActividades'
};

function doGet(e) {
  const params = (e && e.parameter) || {};
  try {
    assertFamilyKey_(params.key);
    const action = params.action || 'health';
    const data = action === 'snapshot' ? getSnapshot_() : action === 'diagnostics' ? getDiagnostics_() : action === 'health' ? { status: 'ok', version: APP_SCRIPT_VERSION, timestamp: new Date().toISOString() } : null;
    if (!data) throw new Error('Accion no disponible.');
    return output_(params, { ok: true, data: data });
  } catch (error) { return output_(params, { ok: false, error: error.message }); }
}

function doPost(e) {
  const params = (e && e.parameter) || {};
  try {
    assertFamilyKey_(params.key);
    const action = params.action;
    const payload = JSON.parse(params.payload || '{}');
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (action === 'proposal') addProposal_(payload);
      else if (action === 'interest') upsertInterest_(payload);
      else if (action === 'planItem') { logPlanChange_(payload, 'add'); upsertPlanItem_(payload); }
      else if (action === 'removePlanItem') { logPlanChange_(payload, 'remove'); removePlanItem_(payload); }
      else if (action === 'comment') addComment_(payload);
      else throw new Error('Accion de escritura no disponible.');
    } finally { lock.releaseLock(); }
    return json_({ ok: true });
  } catch (error) { return json_({ ok: false, error: error.message }); }
}

function getSnapshot_() {
  return {
    places: readPublished_(SHEETS.places), experiences: readPublished_(SHEETS.experiences),
    activities: readPublished_(SHEETS.activities),
    interests: readObjects_(SHEETS.interests), proposals: readPublished_(SHEETS.proposals),
    comments: readObjects_(SHEETS.comments), itineraries: readObjects_(SHEETS.itineraries),
    itineraryItems: readObjects_(SHEETS.itineraryItems), version: APP_SCRIPT_VERSION, generatedAt: new Date().toISOString()
  };
}

function getDiagnostics_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetNames = spreadsheet.getSheets().map(function(sheet) { return sheet.getName(); });
  const activitiesSheet = spreadsheet.getSheetByName(SHEETS.activities);
  return {
    status: 'ok',
    version: APP_SCRIPT_VERSION,
    spreadsheetId: SPREADSHEET_ID,
    configuredActivitiesSheet: SHEETS.activities,
    hasActivitiesSheet: Boolean(activitiesSheet),
    activitiesRows: activitiesSheet ? Math.max(0, activitiesSheet.getLastRow() - 1) : 0,
    activitiesColumns: activitiesSheet ? activitiesSheet.getLastColumn() : 0,
    sheetNames: sheetNames,
    timestamp: new Date().toISOString()
  };
}

function readPublished_(sheetName) {
  return readObjects_(sheetName).filter(function(row) {
    return !Object.prototype.hasOwnProperty.call(row, 'published') || String(row.published).toLowerCase() !== 'false';
  });
}

function readObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(function(row) { return row.some(String); }).map(function(row) {
    return headers.reduce(function(object, header, index) {
      if (header) object[header] = typedValue_(row[index]);
      return object;
    }, {});
  });
}

function addProposal_(payload) {
  requireFields_(payload, ['id', 'name', 'mapsUrl', 'deviceId']);
  const sheet = getSheet_(SHEETS.proposals);
  const headers = ensureHeaders_(sheet, [
    'id', 'name', 'mapsUrl', 'type', 'category', 'area', 'borough', 'shortDescription', 'whyItMatters',
    'notes', 'origin', 'status', 'published', 'proposedAt', 'deviceId'
  ]);
  const existing = sheet.getDataRange().getDisplayValues();
  const idIndex = headers.indexOf('id');
  const mapsIndex = headers.indexOf('mapsUrl');
  const duplicate = existing.slice(1).some(function(row) {
    return row[idIndex] === payload.id || normalizeUrl_(row[mapsIndex]) === normalizeUrl_(payload.mapsUrl);
  });
  if (duplicate) throw new Error('Ese lugar ya esta propuesto.');
  appendObject_(sheet, headers, {
    id: safeText_(payload.id, 100), name: safeText_(payload.name, 160), mapsUrl: safeUrl_(payload.mapsUrl),
    type: safeText_(payload.type || 'Propuesto por la familia', 80),
    category: safeText_(payload.category || 'Propuesta familiar', 100),
    area: safeText_(payload.area, 120),
    borough: safeText_(payload.borough, 80),
    shortDescription: safeText_(payload.shortDescription || payload.whyItMatters || payload.reason, 500),
    whyItMatters: safeText_(payload.whyItMatters || payload.reason, 500),
    notes: safeText_(payload.notes, 500), origin: 'family', status: 'propuesto', published: true,
    proposedAt: new Date(), deviceId: safeText_(payload.deviceId, 100)
  });
}

function upsertInterest_(payload) {
  requireFields_(payload, ['deviceId', 'itemId', 'itemKind']);
  const sheet = getSheet_(SHEETS.interests);
  const headers = ensureHeaders_(sheet, ['deviceId', 'itemId', 'itemKind', 'interested', 'itemDate', 'startDate', 'endDate', 'updatedAt']);
  const rows = sheet.getDataRange().getDisplayValues();
  const deviceIndex = headers.indexOf('deviceId');
  const itemIndex = headers.indexOf('itemId');
  const rowIndex = rows.slice(1).findIndex(function(row) { return row[deviceIndex] === payload.deviceId && row[itemIndex] === payload.itemId; });
  const object = {
    deviceId: safeText_(payload.deviceId, 100), itemId: safeText_(payload.itemId, 100),
    itemKind: safeText_(payload.itemKind, 30), interested: Boolean(payload.interested),
    itemDate: safeText_(payload.itemDate, 30), startDate: safeText_(payload.startDate, 30),
    endDate: safeText_(payload.endDate, 30), updatedAt: new Date()
  };
  if (rowIndex >= 0) writeObjectRow_(sheet, headers, rowIndex + 2, object); else appendObject_(sheet, headers, object);
}

function upsertPlanItem_(payload) {
  requireFields_(payload, ['deviceId', 'itemId']);
  const itineraryId = 'PLAN-FAMILIAR';
  const itineraries = getSheet_(SHEETS.itineraries);
  const itineraryHeaders = headers_(itineraries);
  const existingPlan = itineraries.getDataRange().getDisplayValues().slice(1).some(function(row) { return row[itineraryHeaders.indexOf('itineraryId')] === itineraryId; });
  if (!existingPlan) appendObject_(itineraries, itineraryHeaders, { itineraryId: itineraryId, name: 'Plan familiar', active: true, createdAt: new Date(), updatedAt: new Date() });
  const items = getSheet_(SHEETS.itineraryItems);
  const headers = headers_(items);
  const rows = items.getDataRange().getDisplayValues();
  const duplicate = rows.slice(1).some(function(row) { return row[headers.indexOf('itineraryId')] === itineraryId && row[headers.indexOf('itemId')] === payload.itemId; });
  if (!duplicate) appendObject_(items, headers, {
    itineraryItemId: Utilities.getUuid(), itineraryId: itineraryId, itemId: safeText_(payload.itemId, 100),
    itemKind: safeText_(payload.itemKind || 'place', 30), position: Number(payload.position) || rows.length, notes: '', addedAt: new Date()
  });
}

function logPlanChange_(payload, changeType) {
  requireFields_(payload, ['deviceId', 'itemId']);
  const sheet = getSheet_(SHEETS.planChanges);
  const headers = ensureHeaders_(sheet, ['changeId', 'itineraryId', 'itemId', 'changeType', 'position', 'deviceId', 'createdAt', 'processedAt']);
  appendObject_(sheet, headers, {
    changeId: Utilities.getUuid(), itineraryId: 'PLAN-FAMILIAR', itemId: safeText_(payload.itemId, 100),
    changeType: changeType, position: Number(payload.position) || '', deviceId: safeText_(payload.deviceId, 100),
    createdAt: new Date(), processedAt: ''
  });
}

function removePlanItem_(payload) {
  requireFields_(payload, ['itemId']);
  const itineraryId = 'PLAN-FAMILIAR';
  const items = getSheet_(SHEETS.itineraryItems);
  const headers = headers_(items);
  const rows = items.getDataRange().getDisplayValues();
  const itineraryIndex = headers.indexOf('itineraryId');
  const itemIndex = headers.indexOf('itemId');
  for (let index = rows.length - 1; index >= 1; index--) {
    if (rows[index][itineraryIndex] === itineraryId && rows[index][itemIndex] === payload.itemId) items.deleteRow(index + 1);
  }
}

function syncPlanChanges_() {
  const changes = getSheet_(SHEETS.planChanges);
  const changeHeaders = headers_(changes);
  const rows = changes.getDataRange().getDisplayValues();
  const itineraryId = 'PLAN-FAMILIAR';
  rows.slice(1).forEach(function(row, offset) {
    const processedAt = row[changeHeaders.indexOf('processedAt')];
    if (processedAt) return;
    const payload = {
      itemId: row[changeHeaders.indexOf('itemId')],
      position: row[changeHeaders.indexOf('position')]
    };
    const type = row[changeHeaders.indexOf('changeType')];
    if (row[changeHeaders.indexOf('itineraryId')] === itineraryId && type === 'add') upsertPlanItem_({ deviceId: 'sync', itemId: payload.itemId, position: payload.position });
    if (row[changeHeaders.indexOf('itineraryId')] === itineraryId && type === 'remove') removePlanItem_({ itemId: payload.itemId });
    changes.getRange(offset + 2, changeHeaders.indexOf('processedAt') + 1).setValue(new Date());
  });
}

function addComment_(payload) {
  requireFields_(payload, ['commentId', 'itemId', 'deviceId', 'text']);
  const sheet = getSheet_(SHEETS.comments);
  const headers = headers_(sheet);
  const rows = sheet.getDataRange().getDisplayValues();
  const idIndex = headers.indexOf('commentId');
  if (rows.slice(1).some(function(row) { return row[idIndex] === payload.commentId; })) return;
  appendObject_(sheet, headers, {
    commentId: safeText_(payload.commentId, 100), itemId: safeText_(payload.itemId, 100),
    deviceId: safeText_(payload.deviceId, 100), commentType: safeText_(payload.commentType || 'comentario', 40),
    text: safeText_(payload.text, 600), createdAt: new Date()
  });
}

function output_(params, payload) {
  params = params || {};
  const callback = String(params.callback || '');
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(payload) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(payload);
}

function json_(payload) { return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON); }

function assertFamilyKey_(provided) {
  const required = PropertiesService.getScriptProperties().getProperty('FAMILY_KEY');
  if (required && String(provided || '') !== required) throw new Error('Acceso no autorizado.');
}

function getSheet_(name) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet && name === SHEETS.comments) {
    sheet = spreadsheet.insertSheet(name);
    sheet.appendRow(['commentId', 'itemId', 'deviceId', 'commentType', 'text', 'createdAt']);
    sheet.setFrozenRows(1);
  }
  if (!sheet && name === SHEETS.planChanges) {
    sheet = spreadsheet.insertSheet(name);
    sheet.appendRow(['changeId', 'itineraryId', 'itemId', 'changeType', 'position', 'deviceId', 'createdAt', 'processedAt']);
    sheet.setFrozenRows(1);
  }
  if (!sheet) throw new Error('No existe la hoja ' + name + '.');
  return sheet;
}

function headers_(sheet) {
  const width = sheet.getLastColumn();
  if (!width) throw new Error('La hoja ' + sheet.getName() + ' no tiene cabeceras.');
  return sheet.getRange(1, 1, 1, width).getDisplayValues()[0].map(String);
}

function ensureHeaders_(sheet, requiredHeaders) {
  const headers = headers_(sheet);
  requiredHeaders.forEach(function(header) {
    if (headers.indexOf(header) === -1) {
      sheet.getRange(1, headers.length + 1).setValue(header);
      headers.push(header);
    }
  });
  return headers;
}

function appendObject_(sheet, headers, object) {
  sheet.appendRow(headers.map(function(header) { return Object.prototype.hasOwnProperty.call(object, header) ? object[header] : ''; }));
}

function writeObjectRow_(sheet, headers, rowNumber, object) {
  const current = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([headers.map(function(header, index) {
    return Object.prototype.hasOwnProperty.call(object, header) ? object[header] : current[index];
  })]);
}

function typedValue_(value) {
  if (value === 'TRUE' || value === 'true') return true;
  if (value === 'FALSE' || value === 'false') return false;
  if (/^-?\d+(?:[.,]\d+)?$/.test(value)) return Number(value.replace(',', '.'));
  return value;
}

function requireFields_(object, fields) { fields.forEach(function(field) { if (!object[field]) throw new Error('Falta el campo ' + field + '.'); }); }
function safeText_(value, length) { return String(value || '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, length); }
function safeUrl_(value) {
  const url = String(value || '').trim();
  if (!/^https:\/\/(www\.)?(google\.[^/]+\/maps|maps\.app\.goo\.gl)\//i.test(url)) throw new Error('Introduce un enlace valido de Google Maps.');
  return url.slice(0, 1000);
}
function normalizeUrl_(value) { return String(value || '').trim().replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase(); }
