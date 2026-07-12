const SPREADSHEET_ID = '1WaotDKkqltUQlrPKYuo7ZupEIKUF27tuklrGcSe4brM';
const SHEETS = {
  places: 'Lugares', experiences: 'Experiencias', interests: 'Intereses', proposals: 'PropuestasFamilia',
  comments: 'Comentarios', itineraries: 'Itinerarios', itineraryItems: 'ItinerarioItems'
};

function doGet(e) {
  try {
    assertFamilyKey_(e.parameter.key);
    const action = e.parameter.action || 'snapshot';
    const data = action === 'snapshot' ? getSnapshot_() : action === 'health' ? { status: 'ok', timestamp: new Date().toISOString() } : null;
    if (!data) throw new Error('Acción no disponible.');
    return output_(e, { ok: true, data: data });
  } catch (error) { return output_(e, { ok: false, error: error.message }); }
}

function doPost(e) {
  try {
    assertFamilyKey_(e.parameter.key);
    const action = e.parameter.action;
    const payload = JSON.parse(e.parameter.payload || '{}');
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (action === 'proposal') addProposal_(payload);
      else if (action === 'interest') upsertInterest_(payload);
      else if (action === 'planItem') upsertPlanItem_(payload);
      else if (action === 'comment') addComment_(payload);
      else throw new Error('Acción de escritura no disponible.');
    } finally { lock.releaseLock(); }
    return json_({ ok: true });
  } catch (error) { return json_({ ok: false, error: error.message }); }
}

function getSnapshot_() {
  return {
    places: readPublished_(SHEETS.places), experiences: readPublished_(SHEETS.experiences),
    interests: readObjects_(SHEETS.interests), proposals: readPublished_(SHEETS.proposals),
    comments: readObjects_(SHEETS.comments), itineraries: readObjects_(SHEETS.itineraries),
    itineraryItems: readObjects_(SHEETS.itineraryItems), generatedAt: new Date().toISOString()
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
  const headers = headers_(sheet);
  const existing = sheet.getDataRange().getDisplayValues();
  const idIndex = headers.indexOf('id');
  const mapsIndex = headers.indexOf('mapsUrl');
  const duplicate = existing.slice(1).some(function(row) {
    return row[idIndex] === payload.id || normalizeUrl_(row[mapsIndex]) === normalizeUrl_(payload.mapsUrl);
  });
  if (duplicate) throw new Error('Ese lugar ya está propuesto.');
  appendObject_(sheet, headers, {
    id: safeText_(payload.id, 100), name: safeText_(payload.name, 160), mapsUrl: safeUrl_(payload.mapsUrl),
    notes: safeText_(payload.notes, 500), origin: 'family', status: 'propuesto', published: true,
    proposedAt: new Date(), deviceId: safeText_(payload.deviceId, 100)
  });
}

function upsertInterest_(payload) {
  requireFields_(payload, ['deviceId', 'itemId', 'itemKind']);
  const sheet = getSheet_(SHEETS.interests);
  const headers = headers_(sheet);
  const rows = sheet.getDataRange().getDisplayValues();
  const deviceIndex = headers.indexOf('deviceId');
  const itemIndex = headers.indexOf('itemId');
  const rowIndex = rows.slice(1).findIndex(function(row) { return row[deviceIndex] === payload.deviceId && row[itemIndex] === payload.itemId; });
  const object = {
    deviceId: safeText_(payload.deviceId, 100), itemId: safeText_(payload.itemId, 100),
    itemKind: safeText_(payload.itemKind, 30), interested: Boolean(payload.interested), updatedAt: new Date()
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
    itemKind: 'place', position: Number(payload.position) || rows.length, notes: '', addedAt: new Date()
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

function output_(e, payload) {
  const callback = String(e.parameter.callback || '');
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
  if (!sheet) throw new Error('No existe la hoja ' + name + '.');
  return sheet;
}

function headers_(sheet) {
  const width = sheet.getLastColumn();
  if (!width) throw new Error('La hoja ' + sheet.getName() + ' no tiene cabeceras.');
  return sheet.getRange(1, 1, 1, width).getDisplayValues()[0].map(String);
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
  if (!/^https:\/\/(www\.)?(google\.[^/]+\/maps|maps\.app\.goo\.gl)\//i.test(url)) throw new Error('Introduce un enlace válido de Google Maps.');
  return url.slice(0, 1000);
}
function normalizeUrl_(value) { return String(value || '').trim().replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase(); }
