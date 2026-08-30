function hcCollectCalendar_() {
  const runStarted = new Date();
  const calendars = hcListCalendars_();
  const events = [];

  const occurrenceCursor = hcGetState_(
    HC_KEYS.CALENDAR_OCCURRENCE_CURSOR,
    hcDaysAgoIso_(HC_CONFIG.CALENDAR_OCCURRENCE_LOOKBACK_DAYS)
  );
  const updatedCursor = hcGetState_(
    HC_KEYS.CALENDAR_UPDATED_CURSOR,
    hcDaysAgoIso_(HC_CONFIG.INITIAL_LOOKBACK_DAYS)
  );

  calendars.forEach(function(calendar) {
    const calendarId = calendar.id;
    if (!calendarId) return;
    events.push.apply(events, hcCollectCalendarOccurrences_(calendar, occurrenceCursor, runStarted.toISOString()));
    events.push.apply(events, hcCollectCalendarUpdates_(calendar, updatedCursor));
  });

  const overlapMs = 2 * 60 * 1000;
  const nextCursor = new Date(runStarted.getTime() - overlapMs).toISOString();
  hcSetState_(HC_KEYS.CALENDAR_OCCURRENCE_CURSOR, nextCursor);
  hcSetState_(HC_KEYS.CALENDAR_UPDATED_CURSOR, nextCursor);
  return events;
}

function hcListCalendars_() {
  const result = [];
  let pageToken = '';
  do {
    const response = hcGetJson_('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      maxResults: 250,
      pageToken: pageToken,
      showHidden: true,
    });
    result.push.apply(result, response.items || []);
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return result;
}

function hcCollectCalendarOccurrences_(calendar, timeMin, timeMax) {
  const events = [];
  let pageToken = '';
  const base = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendar.id) + '/events';
  do {
    const response = hcGetJson_(base, {
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      showDeleted: false,
      orderBy: 'startTime',
      maxResults: 2500,
      pageToken: pageToken,
    });
    (response.items || []).forEach(function(item) {
      if (item.status === 'cancelled') return;
      events.push(hcCalendarEvent_(calendar, item, 'event_started', hcCalendarStartIso_(item)));
    });
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return events;
}

function hcCollectCalendarUpdates_(calendar, updatedMin) {
  const events = [];
  let pageToken = '';
  const base = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendar.id) + '/events';
  do {
    const response = hcGetJson_(base, {
      updatedMin: updatedMin,
      showDeleted: true,
      maxResults: 2500,
      pageToken: pageToken,
    });
    (response.items || []).forEach(function(item) {
      let action = 'event_updated';
      if (item.status === 'cancelled') {
        action = 'event_cancelled';
      } else if (item.created && item.updated && Math.abs(new Date(item.updated) - new Date(item.created)) < 2000) {
        action = 'event_created';
      }
      events.push(hcCalendarEvent_(calendar, item, action, item.updated || item.created || new Date().toISOString()));
    });
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return events;
}

function hcCalendarEvent_(calendar, item, action, eventTime) {
  const organizer = item.organizer || {};
  const creator = item.creator || {};
  const attendees = item.attendees || [];
  const details = {
    start: item.start || null,
    end: item.end || null,
    location: item.location || '',
    status: item.status || '',
    event_type: item.eventType || 'default',
    recurring_event_id: item.recurringEventId || '',
    organizer: organizer.email || organizer.displayName || '',
    creator: creator.email || creator.displayName || '',
    attendee_count: attendees.length,
    has_meet: Boolean(item.hangoutLink || item.conferenceData),
    transparency: item.transparency || '',
    visibility: item.visibility || '',
  };
  if (HC_CONFIG.STORE_CALENDAR_ATTENDEES) {
    details.attendees = attendees.map(function(a) {
      return {
        email: a.email || '',
        response_status: a.responseStatus || '',
        self: Boolean(a.self),
      };
    });
  }

  return {
    event_time: eventTime || new Date().toISOString(),
    source: 'calendar',
    action: action,
    actor: organizer.self ? 'self' : (organizer.email || creator.email || 'unknown'),
    object_type: 'calendar_event',
    object_id: item.id || '',
    object_name: item.summary || '(no title)',
    container_id: calendar.id || '',
    container_name: calendar.summaryOverride || calendar.summary || '',
    url: item.htmlLink || '',
    direction: '',
    details: details,
  };
}

function hcCalendarStartIso_(item) {
  if (!item || !item.start) return new Date().toISOString();
  if (item.start.dateTime) return hcIso_(item.start.dateTime);
  if (item.start.date) return new Date(item.start.date + 'T00:00:00+09:00').toISOString();
  return new Date().toISOString();
}
