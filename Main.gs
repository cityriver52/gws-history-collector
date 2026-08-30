function setup() {
  const ss = hcEnsureStore_();
  removeTriggers();
  ScriptApp.newTrigger('collectAll')
    .timeBased()
    .everyMinutes(HC_CONFIG.TRIGGER_MINUTES)
    .create();

  hcAllCollectors_().forEach(function(entry) {
    const source = entry[0];
    const enabled = hcIsSourceEnabled_(source);
    hcWriteStatus_(
      source,
      enabled ? 'ready' : 'disabled',
      0,
      enabled ? 'setup complete' : 'disabled in HC_CONFIG.ENABLED_SOURCES'
    );
  });

  Logger.log('History spreadsheet: ' + ss.getUrl());
  return ss.getUrl();
}

function collectAll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  try {
    hcAllCollectors_().forEach(function(entry) {
      const source = entry[0];
      const fn = entry[1];
      if (!hcIsSourceEnabled_(source)) return;
      hcRunCollector_(source, fn);
    });
  } finally {
    lock.releaseLock();
  }
}

function collectDrive() {
  return hcRunSingleWithLock_('drive', hcCollectDrive_);
}

function collectGmail() {
  return hcRunSingleWithLock_('gmail', hcCollectGmail_);
}

function collectCalendar() {
  return hcRunSingleWithLock_('calendar', hcCollectCalendar_);
}

function collectTasks() {
  return hcRunSingleWithLock_('tasks', hcCollectTasks_);
}

function collectMeet() {
  return hcRunSingleWithLock_('meet', hcCollectMeet_);
}

function collectChat() {
  return hcRunSingleWithLock_('chat', hcCollectChat_);
}

function hcAllCollectors_() {
  return [
    ['drive', hcCollectDrive_],
    ['gmail', hcCollectGmail_],
    ['calendar', hcCollectCalendar_],
    ['tasks', hcCollectTasks_],
    ['meet', hcCollectMeet_],
    ['chat', hcCollectChat_],
  ];
}

function hcIsSourceEnabled_(source) {
  return HC_CONFIG.ENABLED_SOURCES.indexOf(source) >= 0;
}

function hcRunSingleWithLock_(source, fn) {
  if (!hcIsSourceEnabled_(source)) {
    hcWriteStatus_(source, 'disabled', 0, 'disabled in HC_CONFIG.ENABLED_SOURCES');
    return 0;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return 0;
  try {
    return hcRunCollector_(source, fn);
  } finally {
    lock.releaseLock();
  }
}

function hcRunCollector_(source, fn) {
  try {
    const events = fn() || [];
    const count = hcAppendEvents_(events);
    hcWriteStatus_(source, 'ok', count, '');
    return count;
  } catch (error) {
    hcLogError_(source, error);
    hcWriteStatus_(source, 'error', 0, error && error.message ? error.message : String(error));
    return 0;
  }
}

function resetState() {
  const props = hcProps_();
  const all = props.getProperties();
  Object.keys(all).forEach(function(key) {
    if (key.indexOf('hc_') === 0 && key !== HC_KEYS.SPREADSHEET_ID) {
      props.deleteProperty(key);
    }
  });
  return 'state reset';
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'collectAll') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function getHistorySpreadsheetUrl() {
  return hcEnsureStore_().getUrl();
}
