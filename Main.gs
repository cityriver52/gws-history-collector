function setup() {
  const ss = hcEnsureStore_();
  removeTriggers();
  ScriptApp.newTrigger('collectAll')
    .timeBased()
    .everyMinutes(HC_CONFIG.TRIGGER_MINUTES)
    .create();

  ['drive', 'gmail', 'calendar', 'chat', 'tasks', 'meet'].forEach(function(source) {
    hcWriteStatus_(source, 'ready', 0, 'setup complete');
  });

  Logger.log('History spreadsheet: ' + ss.getUrl());
  return ss.getUrl();
}

function collectAll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  try {
    hcRunCollector_('drive', hcCollectDrive_);
    hcRunCollector_('gmail', hcCollectGmail_);
    hcRunCollector_('calendar', hcCollectCalendar_);
    hcRunCollector_('tasks', hcCollectTasks_);
    hcRunCollector_('meet', hcCollectMeet_);
    hcRunCollector_('chat', hcCollectChat_);
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

function hcRunSingleWithLock_(source, fn) {
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
