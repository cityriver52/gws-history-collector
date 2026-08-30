function hcCollectChat_() {
  const spaces = hcListChatSpaces_();
  if (!spaces.length) return [];

  let offset = Number(hcGetState_(HC_KEYS.CHAT_SPACE_OFFSET, '0')) || 0;
  if (offset >= spaces.length) offset = 0;
  const end = Math.min(offset + HC_CONFIG.CHAT_SPACES_PER_RUN, spaces.length);
  const selected = spaces.slice(offset, end);
  const events = [];
  const runStarted = new Date();

  selected.forEach(function(space) {
    try {
      events.push.apply(events, hcCollectChatSpace_(space, runStarted));
    } catch (error) {
      hcLogError_('chat-events:' + (space.name || 'unknown'), error);
    }

    try {
      const readEvent = hcCollectChatReadState_(space);
      if (readEvent) events.push(readEvent);
    } catch (error) {
      hcLogError_('chat-read-state:' + (space.name || 'unknown'), error);
    }
  });

  hcSetState_(HC_KEYS.CHAT_SPACE_OFFSET, end >= spaces.length ? '0' : String(end));
  return events;
}

function hcListChatSpaces_() {
  const spaces = [];
  let pageToken = '';
  do {
    const response = hcGetJson_('https://chat.googleapis.com/v1/spaces', {
      pageSize: 1000,
      pageToken: pageToken,
    });
    spaces.push.apply(spaces, response.spaces || []);
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return spaces;
}

function hcCollectChatSpace_(space, runStarted) {
  const events = [];
  const stateKey = 'hc_chat_cursor_' + hcChatStateSuffix_(space.name);
  const cursor = hcGetState_(stateKey, hcDaysAgoIso_(Math.min(HC_CONFIG.INITIAL_LOOKBACK_DAYS, 27)));
  let pageToken = '';
  let pages = 0;
  let completed = true;

  const eventTypes = [
    'google.workspace.chat.message.v1.created',
    'google.workspace.chat.message.v1.updated',
    'google.workspace.chat.message.v1.deleted',
    'google.workspace.chat.reaction.v1.created',
    'google.workspace.chat.reaction.v1.deleted',
    'google.workspace.chat.membership.v1.created',
    'google.workspace.chat.membership.v1.updated',
    'google.workspace.chat.membership.v1.deleted',
    'google.workspace.chat.space.v1.updated',
  ];
  const typeFilter = eventTypes.map(function(t) { return 'eventTypes:"' + t + '"'; }).join(' OR ');
  const filter = 'startTime="' + cursor + '" AND (' + typeFilter + ')';
  const base = 'https://chat.googleapis.com/v1/' + space.name + '/spaceEvents';

  do {
    const response = hcGetJson_(base, {
      pageSize: 100,
      pageToken: pageToken,
      filter: filter,
    });
    (response.spaceEvents || []).forEach(function(spaceEvent) {
      events.push(hcChatEvent_(space, spaceEvent));
    });
    pageToken = response.nextPageToken || '';
    pages++;
    if (pageToken && pages >= HC_CONFIG.CHAT_MAX_PAGES_PER_SPACE) {
      completed = false;
      break;
    }
  } while (pageToken);

  if (completed) {
    const overlapMs = 2 * 60 * 1000;
    hcSetState_(stateKey, new Date(runStarted.getTime() - overlapMs).toISOString());
  }
  return events;
}

function hcCollectChatReadState_(space) {
  if (!space || !space.name) return null;
  const spaceId = String(space.name).replace(/^spaces\//, '');
  if (!spaceId) return null;

  const state = hcGetJson_(
    'https://chat.googleapis.com/v1/users/me/spaces/' + encodeURIComponent(spaceId) + '/spaceReadState'
  );
  const lastReadTime = state.lastReadTime || '';
  if (!lastReadTime) return null;

  const stateKey = 'hc_chat_read_' + hcChatStateSuffix_(space.name);
  const previous = hcGetState_(stateKey, '');
  hcSetState_(stateKey, lastReadTime);
  if (previous === lastReadTime) return null;

  if (!previous) {
    const cutoff = Date.now() - HC_CONFIG.INITIAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    if (new Date(lastReadTime).getTime() < cutoff) return null;
  }

  return {
    event_time: lastReadTime,
    source: 'chat',
    action: 'space_read_state_updated',
    actor: 'self',
    object_type: 'chat_read_state',
    object_id: state.name || '',
    object_name: '',
    container_id: space.name || '',
    container_name: space.displayName || space.spaceType || '',
    url: space.spaceUri || '',
    direction: '',
    details: {
      last_read_time: lastReadTime,
      previous_last_read_time: previous,
    },
  };
}

function hcChatStateSuffix_(spaceName) {
  return String(spaceName || '').replace(/[^A-Za-z0-9_-]/g, '_');
}

function hcChatEvent_(space, spaceEvent) {
  const type = spaceEvent.eventType || 'google.workspace.chat.unknown.v1.event';
  const payload = hcChatPayload_(spaceEvent);
  const extracted = hcExtractChatObject_(payload, type);
  const details = {
    event_type: type,
    native_event_name: spaceEvent.name || '',
    payload: hcSanitizeChatPayload_(payload),
  };

  return {
    event_time: spaceEvent.eventTime || extracted.time || new Date().toISOString(),
    source: 'chat',
    action: hcChatActionName_(type),
    actor: extracted.actor,
    object_type: extracted.objectType,
    object_id: extracted.objectId,
    object_name: extracted.objectName,
    container_id: space.name || '',
    container_name: space.displayName || space.spaceType || '',
    url: space.spaceUri || '',
    direction: '',
    details: details,
  };
}

function hcChatPayload_(spaceEvent) {
  const keys = [
    'messageCreatedEventData', 'messageUpdatedEventData', 'messageDeletedEventData',
    'messageBatchCreatedEventData', 'messageBatchUpdatedEventData', 'messageBatchDeletedEventData',
    'reactionCreatedEventData', 'reactionDeletedEventData',
    'reactionBatchCreatedEventData', 'reactionBatchDeletedEventData',
    'membershipCreatedEventData', 'membershipUpdatedEventData', 'membershipDeletedEventData',
    'membershipBatchCreatedEventData', 'membershipBatchUpdatedEventData', 'membershipBatchDeletedEventData',
    'spaceUpdatedEventData', 'spaceBatchUpdatedEventData'
  ];
  for (let i = 0; i < keys.length; i++) {
    if (spaceEvent[keys[i]]) return spaceEvent[keys[i]];
  }
  return {};
}

function hcExtractChatObject_(payload, type) {
  let obj = null;
  let objectType = 'chat_event';
  if (payload.message) {
    obj = payload.message;
    objectType = 'chat_message';
  } else if (payload.reaction) {
    obj = payload.reaction;
    objectType = 'chat_reaction';
  } else if (payload.membership) {
    obj = payload.membership;
    objectType = 'chat_membership';
  } else if (payload.space) {
    obj = payload.space;
    objectType = 'chat_space';
  } else if (type.indexOf('message') >= 0 && type.indexOf('batch') >= 0) {
    objectType = 'chat_message_batch';
  } else if (type.indexOf('reaction') >= 0 && type.indexOf('batch') >= 0) {
    objectType = 'chat_reaction_batch';
  } else if (type.indexOf('membership') >= 0 && type.indexOf('batch') >= 0) {
    objectType = 'chat_membership_batch';
  }

  obj = obj || {};
  let actor = '';
  if (obj.sender && obj.sender.name) actor = obj.sender.name;
  else if (obj.user && obj.user.name) actor = obj.user.name;
  else if (obj.member && obj.member.name) actor = obj.member.name;

  let objectName = '';
  if (objectType === 'chat_message' && HC_CONFIG.STORE_CHAT_TEXT && obj.text) {
    objectName = String(obj.text).replace(/\s+/g, ' ').substring(0, 200);
  } else if (objectType === 'chat_space') {
    objectName = obj.displayName || '';
  }

  return {
    actor: actor || 'unknown',
    objectType: objectType,
    objectId: obj.name || '',
    objectName: objectName,
    time: obj.createTime || obj.lastUpdateTime || obj.deleteTime || '',
  };
}

function hcSanitizeChatPayload_(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(hcSanitizeChatPayload_);
  if (typeof value !== 'object') return value;

  const result = {};
  Object.keys(value).forEach(function(key) {
    if (key === 'cards' || key === 'cardsV2' || key === 'accessoryWidgets' || key === 'elements') return;
    if (!HC_CONFIG.STORE_CHAT_TEXT && (
      key === 'text' || key === 'formattedText' || key === 'argumentText' || key === 'fallbackText'
    )) return;
    result[key] = hcSanitizeChatPayload_(value[key]);
  });
  return result;
}

function hcChatActionName_(eventType) {
  const match = String(eventType).match(/chat\.([^.]+)\.v1\.([A-Za-z]+)$/);
  if (!match) return 'chat_event';
  return match[1] + '_' + hcCamelToSnake_(match[2]);
}

function hcCamelToSnake_(text) {
  return String(text || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}
