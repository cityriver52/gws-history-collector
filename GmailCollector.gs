function hcCollectGmail_() {
  const profile = hcGetJson_('https://gmail.googleapis.com/gmail/v1/users/me/profile');
  const bootstrapped = hcGetState_(HC_KEYS.GMAIL_BOOTSTRAPPED, '') === 'true';
  if (!bootstrapped) {
    return hcBootstrapGmail_(profile);
  }

  const startHistoryId = hcGetState_(HC_KEYS.GMAIL_HISTORY_ID, profile.historyId || '');
  if (!startHistoryId) return hcBootstrapGmail_(profile);

  const events = [];
  const metaCache = {};
  let pageToken = '';
  let latestHistoryId = startHistoryId;
  const collectedAt = new Date().toISOString();

  try {
    do {
      const response = hcGetJson_('https://gmail.googleapis.com/gmail/v1/users/me/history', {
        startHistoryId: startHistoryId,
        maxResults: 500,
        pageToken: pageToken,
      });
      latestHistoryId = response.historyId || latestHistoryId;

      (response.history || []).forEach(function(history) {
        (history.messagesAdded || []).forEach(function(entry) {
          const meta = hcGmailMetaCached_(entry.message && entry.message.id, metaCache);
          if (meta) events.push(hcGmailMessageEvent_(meta, 'message_added', collectedAt));
        });

        (history.messagesDeleted || []).forEach(function(entry) {
          const message = entry.message || {};
          events.push({
            event_time: collectedAt,
            source: 'gmail',
            action: 'message_deleted',
            actor: profile.emailAddress || 'self',
            object_type: 'email',
            object_id: message.id || '',
            object_name: '',
            container_id: message.threadId || '',
            container_name: '',
            url: '',
            direction: '',
            details: { history_id: history.id || '' },
          });
        });

        (history.labelsAdded || []).forEach(function(entry) {
          const message = entry.message || {};
          const meta = hcGmailMetaCached_(message.id, metaCache);
          events.push(hcGmailLabelEvent_(meta || message, 'label_added', entry.labelIds || [], history.id, collectedAt));
        });

        (history.labelsRemoved || []).forEach(function(entry) {
          const message = entry.message || {};
          const meta = hcGmailMetaCached_(message.id, metaCache);
          events.push(hcGmailLabelEvent_(meta || message, 'label_removed', entry.labelIds || [], history.id, collectedAt));
        });
      });

      pageToken = response.nextPageToken || '';
    } while (pageToken);
  } catch (error) {
    if (error.httpCode === 404) {
      hcSetState_(HC_KEYS.GMAIL_BOOTSTRAPPED, '');
      hcSetState_(HC_KEYS.GMAIL_HISTORY_ID, '');
      return hcBootstrapGmail_(profile);
    }
    throw error;
  }

  hcSetState_(HC_KEYS.GMAIL_HISTORY_ID, latestHistoryId);
  return events;
}

function hcBootstrapGmail_(profile) {
  const events = [];
  const cutoffMs = Date.now() - HC_CONFIG.INITIAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  let pageToken = '';
  let scanned = 0;
  let reachedCutoff = false;

  do {
    const remaining = Math.max(0, HC_CONFIG.GMAIL_INITIAL_MAX_MESSAGES - scanned);
    if (!remaining) break;

    const response = hcGetJson_('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
      maxResults: Math.min(500, remaining),
      pageToken: pageToken,
      includeSpamTrash: true,
    });

    const messages = response.messages || [];
    const metas = hcGetGmailMessagesMetaBatch_(messages.map(function(message) { return message.id; }));
    for (let i = 0; i < metas.length; i++) {
      scanned++;
      const meta = metas[i];
      if (!meta) continue;
      const internalMs = Number(meta.internalDate || 0);
      if (internalMs && internalMs < cutoffMs) {
        reachedCutoff = true;
        break;
      }
      events.push(hcGmailMessageEvent_(meta, 'message_added', new Date().toISOString()));
    }

    if (reachedCutoff || scanned >= HC_CONFIG.GMAIL_INITIAL_MAX_MESSAGES) break;
    pageToken = response.nextPageToken || '';
  } while (pageToken);

  if (!reachedCutoff && scanned >= HC_CONFIG.GMAIL_INITIAL_MAX_MESSAGES) {
    hcSetState_('hc_gmail_bootstrap_truncated', 'true');
  } else {
    hcSetState_('hc_gmail_bootstrap_truncated', '');
  }

  hcSetState_(HC_KEYS.GMAIL_HISTORY_ID, profile.historyId || '');
  hcSetState_(HC_KEYS.GMAIL_BOOTSTRAPPED, 'true');
  return events;
}

function hcGmailMetaCached_(messageId, cache) {
  if (!messageId) return null;
  if (!Object.prototype.hasOwnProperty.call(cache, messageId)) {
    try {
      cache[messageId] = hcGetGmailMessageMeta_(messageId);
    } catch (error) {
      if (error.httpCode === 404) cache[messageId] = null;
      else throw error;
    }
  }
  return cache[messageId];
}

function hcGetGmailMessageMeta_(messageId) {
  if (!messageId) return null;
  return hcGetJson_('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(messageId), {
    format: 'metadata',
    metadataHeaders: ['Subject', 'From', 'To', 'Cc', 'Date'],
  });
}

function hcGetGmailMessagesMetaBatch_(messageIds) {
  const urls = (messageIds || []).filter(Boolean).map(function(messageId) {
    return hcBuildUrl_('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(messageId), {
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'To', 'Cc', 'Date'],
    });
  });
  return hcGetManyJson_(urls);
}

function hcGmailMessageEvent_(message, action, collectedAt) {
  const headers = hcGmailHeaders_(message);
  const labels = message.labelIds || [];
  const direction = labels.indexOf('SENT') >= 0
    ? 'outbound'
    : (labels.indexOf('INBOX') >= 0 ? 'inbound' : (labels.indexOf('DRAFT') >= 0 ? 'draft' : 'other'));
  const actor = direction === 'outbound' || direction === 'draft' ? 'self' : (headers.from || 'external');
  const details = {
    labels: labels,
    size_estimate: message.sizeEstimate || 0,
    header_date: headers.date || '',
  };
  if (HC_CONFIG.STORE_GMAIL_COUNTERPARTIES) {
    details.from = headers.from || '';
    details.to = headers.to || '';
    details.cc = headers.cc || '';
  }

  return {
    event_time: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : collectedAt,
    source: 'gmail',
    action: action,
    actor: actor,
    object_type: 'email',
    object_id: message.id || '',
    object_name: headers.subject || '(no subject)',
    container_id: message.threadId || '',
    container_name: '',
    url: message.threadId ? 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(message.threadId) : '',
    direction: direction,
    details: details,
  };
}

function hcGmailLabelEvent_(message, action, labelIds, historyId, collectedAt) {
  const headers = hcGmailHeaders_(message || {});
  const labels = (message && message.labelIds) || [];
  const direction = labels.indexOf('SENT') >= 0 ? 'outbound' : (labels.indexOf('INBOX') >= 0 ? 'inbound' : 'other');
  return {
    event_time: collectedAt,
    source: 'gmail',
    action: action,
    actor: 'self',
    object_type: 'email',
    object_id: (message && message.id) || '',
    object_name: headers.subject || '',
    container_id: (message && message.threadId) || '',
    container_name: '',
    url: message && message.threadId ? 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(message.threadId) : '',
    direction: direction,
    details: {
      label_ids: labelIds,
      history_id: historyId || '',
    },
  };
}

function hcGmailHeaders_(message) {
  const result = {};
  const headers = message && message.payload && message.payload.headers ? message.payload.headers : [];
  headers.forEach(function(header) {
    const name = String(header.name || '').toLowerCase();
    if (name === 'subject' || name === 'from' || name === 'to' || name === 'cc' || name === 'date') {
      result[name] = header.value || '';
    }
  });
  return result;
}
