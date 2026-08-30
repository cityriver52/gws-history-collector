function hcProps_() {
  return PropertiesService.getScriptProperties();
}

function hcGetState_(key, fallback) {
  const value = hcProps_().getProperty(key);
  return value === null ? fallback : value;
}

function hcSetState_(key, value) {
  if (value === undefined || value === null || value === '') {
    hcProps_().deleteProperty(key);
  } else {
    hcProps_().setProperty(key, String(value));
  }
}

function hcEnsureStore_() {
  const props = hcProps_();
  let ss = null;
  const existingId = props.getProperty(HC_KEYS.SPREADSHEET_ID);
  if (existingId) {
    try {
      ss = SpreadsheetApp.openById(existingId);
    } catch (e) {
      props.deleteProperty(HC_KEYS.SPREADSHEET_ID);
    }
  }

  if (!ss) {
    ss = SpreadsheetApp.create(HC_CONFIG.SPREADSHEET_NAME);
    props.setProperty(HC_KEYS.SPREADSHEET_ID, ss.getId());
    const first = ss.getSheets()[0];
    first.setName('Events');
  }

  hcEnsureSheet_(ss, 'Events', HC_EVENT_HEADERS);
  hcEnsureSheet_(ss, 'Status', ['source', 'last_run', 'status', 'event_count', 'message']);
  hcEnsureSheet_(ss, 'Errors', ['time', 'source', 'message', 'http_code', 'details']);
  return ss;
}

function hcEnsureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

function hcAppendEvents_(events) {
  if (!events || !events.length) return 0;
  const ss = hcEnsureStore_();
  const sheet = ss.getSheetByName('Events');
  const lastRow = sheet.getLastRow();
  const seen = new Set();
  if (lastRow >= 2) {
    const count = Math.min(HC_CONFIG.DEDUPE_LOOKBACK_ROWS, lastRow - 1);
    const start = lastRow - count + 1;
    sheet.getRange(start, 1, count, 1).getValues().forEach(function(row) {
      if (row[0]) seen.add(String(row[0]));
    });
  }

  const now = new Date().toISOString();
  const rows = [];
  events
    .slice()
    .sort(function(a, b) { return new Date(a.event_time || 0) - new Date(b.event_time || 0); })
    .forEach(function(event) {
      const normalized = hcNormalizeEvent_(event, now);
      if (seen.has(normalized.event_id)) return;
      seen.add(normalized.event_id);
      rows.push(HC_EVENT_HEADERS.map(function(h) { return normalized[h] || ''; }));
    });

  if (!rows.length) return 0;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HC_EVENT_HEADERS.length).setValues(rows);
  return rows.length;
}

function hcNormalizeEvent_(event, collectedAt) {
  const base = {
    event_time: hcIso_(event.event_time || collectedAt),
    source: String(event.source || ''),
    action: String(event.action || ''),
    actor: String(event.actor || ''),
    object_type: String(event.object_type || ''),
    object_id: String(event.object_id || ''),
    object_name: String(event.object_name || ''),
    container_id: String(event.container_id || ''),
    container_name: String(event.container_name || ''),
    url: String(event.url || ''),
    direction: String(event.direction || ''),
    details_json: typeof event.details_json === 'string' ? event.details_json : hcSafeJson_(event.details || {}),
    collected_at: hcIso_(event.collected_at || collectedAt),
  };
  base.event_id = event.event_id || hcEventId_(base);
  return base;
}

function hcEventId_(event) {
  const stable = [
    event.source,
    event.action,
    event.event_time,
    event.actor,
    event.object_type,
    event.object_id,
    event.container_id,
    event.direction,
    event.details_json,
  ].join('|');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, stable, Utilities.Charset.UTF_8);
  return digest.map(function(b) {
    const n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
}

function hcWriteStatus_(source, status, count, message) {
  const ss = hcEnsureStore_();
  const sheet = ss.getSheetByName('Status');
  const values = sheet.getDataRange().getValues();
  let row = 0;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === source) {
      row = i + 1;
      break;
    }
  }
  const record = [[source, new Date().toISOString(), status, Number(count || 0), String(message || '')]];
  if (row) sheet.getRange(row, 1, 1, 5).setValues(record);
  else sheet.getRange(sheet.getLastRow() + 1, 1, 1, 5).setValues(record);
}

function hcLogError_(source, error) {
  const ss = hcEnsureStore_();
  const sheet = ss.getSheetByName('Errors');
  const message = error && error.message ? error.message : String(error);
  const httpCode = error && error.httpCode ? error.httpCode : '';
  const details = error && error.stack ? error.stack : (error && error.responseBody ? error.responseBody : '');
  sheet.appendRow([new Date().toISOString(), source, message, httpCode, String(details).substring(0, HC_CONFIG.MAX_DETAILS_CHARS)]);
}
