const HC_CONFIG = Object.freeze({
  SPREADSHEET_NAME: 'GWS History Collector',
  INITIAL_LOOKBACK_DAYS: 7,
  CALENDAR_OCCURRENCE_LOOKBACK_DAYS: 30,
  TRIGGER_MINUTES: 10,

  ENABLED_SOURCES: ['drive', 'gmail', 'calendar', 'tasks', 'meet', 'chat'],

  DRIVE_INCLUDE_OTHER_ACTORS: false,
  STORE_GMAIL_COUNTERPARTIES: true,
  STORE_CALENDAR_ATTENDEES: false,
  STORE_CHAT_TEXT: false,

  DRIVE_MAX_PAGES_PER_RUN: 20,
  GMAIL_INITIAL_MAX_MESSAGES: 1000,
  CHAT_SPACES_PER_RUN: 25,
  CHAT_MAX_PAGES_PER_SPACE: 10,

  DEDUPE_LOOKBACK_ROWS: 5000,
  MAX_DETAILS_CHARS: 45000,
  HTTP_RETRIES: 2,
});

const HC_KEYS = Object.freeze({
  SPREADSHEET_ID: 'hc_spreadsheet_id',
  DRIVE_CURSOR: 'hc_drive_cursor',
  GMAIL_HISTORY_ID: 'hc_gmail_history_id',
  GMAIL_BOOTSTRAPPED: 'hc_gmail_bootstrapped',
  CALENDAR_OCCURRENCE_CURSOR: 'hc_calendar_occurrence_cursor',
  CALENDAR_UPDATED_CURSOR: 'hc_calendar_updated_cursor',
  CHAT_SPACE_OFFSET: 'hc_chat_space_offset',
});

const HC_EVENT_HEADERS = Object.freeze([
  'event_id',
  'event_time',
  'source',
  'action',
  'actor',
  'object_type',
  'object_id',
  'object_name',
  'container_id',
  'container_name',
  'url',
  'direction',
  'details_json',
  'collected_at',
]);
