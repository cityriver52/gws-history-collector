function hcCollectMeet_() {
  const runStarted = new Date();
  const cursor = hcGetState_('hc_meet_cursor', hcDaysAgoIso_(HC_CONFIG.INITIAL_LOOKBACK_DAYS));
  const events = [];
  const recordsByName = {};

  hcListConferenceRecords_('start_time>="' + cursor + '"').forEach(function(record) {
    recordsByName[record.name] = record;
  });
  hcListConferenceRecords_('end_time>="' + cursor + '"').forEach(function(record) {
    recordsByName[record.name] = record;
  });

  const spaceCache = {};
  Object.keys(recordsByName).forEach(function(name) {
    const record = recordsByName[name];
    let space = {};
    if (record.space) {
      if (!Object.prototype.hasOwnProperty.call(spaceCache, record.space)) {
        try {
          spaceCache[record.space] = hcGetJson_('https://meet.googleapis.com/v2/' + record.space);
        } catch (error) {
          spaceCache[record.space] = {};
        }
      }
      space = spaceCache[record.space] || {};
    }

    events.push(hcMeetEvent_(record, space, 'conference_started', record.startTime));
    if (record.endTime) {
      events.push(hcMeetEvent_(record, space, 'conference_ended', record.endTime));
    }
  });

  const overlapMs = 2 * 60 * 1000;
  hcSetState_('hc_meet_cursor', new Date(runStarted.getTime() - overlapMs).toISOString());
  return events;
}

function hcListConferenceRecords_(filter) {
  const records = [];
  let pageToken = '';
  do {
    const response = hcGetJson_('https://meet.googleapis.com/v2/conferenceRecords', {
      pageSize: 100,
      pageToken: pageToken,
      filter: filter,
    });
    records.push.apply(records, response.conferenceRecords || []);
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return records;
}

function hcMeetEvent_(record, space, action, eventTime) {
  const meetingCode = space.meetingCode || '';
  return {
    event_time: eventTime || new Date().toISOString(),
    source: 'meet',
    action: action,
    actor: 'self/context',
    object_type: 'meet_conference',
    object_id: record.name || '',
    object_name: meetingCode || record.space || 'Google Meet',
    container_id: record.space || '',
    container_name: meetingCode || '',
    url: space.meetingUri || '',
    direction: '',
    details: {
      start_time: record.startTime || '',
      end_time: record.endTime || '',
      expire_time: record.expireTime || '',
      space: record.space || '',
      meeting_code: meetingCode,
    },
  };
}
