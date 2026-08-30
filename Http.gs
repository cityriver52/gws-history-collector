function hcBuildUrl_(base, params) {
  const parts = [];
  Object.keys(params || {}).forEach(function(key) {
    const value = params[key];
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach(function(v) {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
      });
    } else {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    }
  });
  return parts.length ? base + (base.indexOf('?') >= 0 ? '&' : '?') + parts.join('&') : base;
}

function hcApiJson_(method, url, body) {
  const token = ScriptApp.getOAuthToken();
  const options = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
    },
  };
  if (body !== undefined && body !== null) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }

  let lastResponse = null;
  for (let attempt = 0; attempt <= HC_CONFIG.HTTP_RETRIES; attempt++) {
    const response = UrlFetchApp.fetch(url, options);
    lastResponse = response;
    const code = response.getResponseCode();
    const text = response.getContentText() || '';
    if (code >= 200 && code < 300) {
      return text ? JSON.parse(text) : {};
    }
    if ((code === 429 || code >= 500) && attempt < HC_CONFIG.HTTP_RETRIES) {
      Utilities.sleep(Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 500));
      continue;
    }
    const err = new Error('Google API request failed (' + code + '): ' + text.substring(0, 1500));
    err.httpCode = code;
    err.responseBody = text;
    err.requestUrl = url;
    throw err;
  }

  throw new Error('Google API request failed: ' + (lastResponse ? lastResponse.getResponseCode() : 'unknown'));
}

function hcGetJson_(url, params) {
  return hcApiJson_('get', hcBuildUrl_(url, params || {}));
}

function hcPostJson_(url, body) {
  return hcApiJson_('post', url, body || {});
}

function hcIso_(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toISOString();
}

function hcDaysAgoIso_(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function hcSafeJson_(value) {
  try {
    const text = JSON.stringify(value === undefined ? null : value);
    return text.length > HC_CONFIG.MAX_DETAILS_CHARS
      ? text.substring(0, HC_CONFIG.MAX_DETAILS_CHARS) + '…'
      : text;
  } catch (e) {
    return JSON.stringify({ serialization_error: String(e) });
  }
}

function hcFirstKey_(obj) {
  const keys = Object.keys(obj || {});
  return keys.length ? keys[0] : '';
}
