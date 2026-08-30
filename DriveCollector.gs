function hcCollectDrive_() {
  const runStarted = new Date();
  const cursor = hcGetState_(HC_KEYS.DRIVE_CURSOR, hcDaysAgoIso_(HC_CONFIG.INITIAL_LOOKBACK_DAYS));
  let pageToken = hcGetState_('hc_drive_page_token', '');
  let pages = 0;
  let completed = true;
  const events = [];

  do {
    const body = {
      pageSize: 100,
      filter: 'time > "' + cursor + '"',
      consolidationStrategy: { none: {} },
    };
    if (pageToken) body.pageToken = pageToken;

    const response = hcPostJson_('https://driveactivity.googleapis.com/v2/activity:query', body);
    (response.activities || []).forEach(function(activity) {
      if (!hcShouldKeepDriveActivity_(activity)) return;
      const actors = hcDriveActors_(activity.actors || []);
      const targets = (activity.targets && activity.targets.length) ? activity.targets : [{}];
      const actions = (activity.actions && activity.actions.length) ? activity.actions : [{}];

      actions.forEach(function(action) {
        const actionName = hcFirstKey_(action.detail || {}) || 'activity';
        const when = action.timestamp ||
          (action.timeRange && (action.timeRange.endTime || action.timeRange.startTime)) ||
          activity.timestamp ||
          (activity.timeRange && (activity.timeRange.endTime || activity.timeRange.startTime)) ||
          runStarted.toISOString();

        targets.forEach(function(target) {
          const t = hcDriveTarget_(target);
          events.push({
            event_time: when,
            source: 'drive',
            action: actionName,
            actor: actors.join(', '),
            object_type: t.type,
            object_id: t.id,
            object_name: t.name,
            container_id: t.parentId,
            container_name: '',
            url: t.url,
            direction: '',
            details: {
              action_detail: action.detail || {},
              target_meta: t.meta,
            },
          });
        });
      });
    });

    pageToken = response.nextPageToken || '';
    pages++;
    if (pageToken && pages >= HC_CONFIG.DRIVE_MAX_PAGES_PER_RUN) {
      completed = false;
      hcSetState_('hc_drive_page_token', pageToken);
      break;
    }
  } while (pageToken);

  if (completed) {
    hcSetState_('hc_drive_page_token', '');
    const overlapMs = 2 * 60 * 1000;
    hcSetState_(HC_KEYS.DRIVE_CURSOR, new Date(runStarted.getTime() - overlapMs).toISOString());
  }

  return events;
}

function hcShouldKeepDriveActivity_(activity) {
  if (HC_CONFIG.DRIVE_INCLUDE_OTHER_ACTORS) return true;
  const actors = activity.actors || [];
  if (!actors.length) return true;
  let hasCurrentUser = false;
  let hasOnlySystem = true;
  actors.forEach(function(actor) {
    if (actor.user && actor.user.knownUser && actor.user.knownUser.isCurrentUser) {
      hasCurrentUser = true;
    }
    if (!actor.system && !actor.administrator) {
      hasOnlySystem = false;
    }
  });
  return hasCurrentUser || hasOnlySystem;
}

function hcDriveActors_(actors) {
  if (!actors || !actors.length) return ['unknown'];
  return actors.map(function(actor) {
    if (actor.user) {
      if (actor.user.knownUser) {
        if (actor.user.knownUser.isCurrentUser) return 'self';
        return actor.user.knownUser.personName || 'known_user';
      }
      if (actor.user.deletedUser) return 'deleted_user';
      return 'user';
    }
    if (actor.system) return 'system:' + (actor.system.type || 'event');
    if (actor.administrator) return 'administrator';
    if (actor.anonymous) return 'anonymous';
    if (actor.impersonation) return 'impersonation';
    return hcFirstKey_(actor) || 'unknown';
  });
}

function hcDriveTarget_(target) {
  if (target.driveItem) {
    const item = target.driveItem;
    const resourceName = item.name || '';
    const id = resourceName.indexOf('items/') === 0 ? resourceName.substring(6) : resourceName;
    let type = 'drive_item';
    if (item.driveFile || item.file) type = 'file';
    if (item.driveFolder || item.folder) type = 'folder';
    return {
      type: type,
      id: id,
      name: item.title || '',
      parentId: '',
      url: id ? 'https://drive.google.com/open?id=' + encodeURIComponent(id) : '',
      meta: {
        mime_type: item.mimeType || (item.driveFile && item.driveFile.mimeType) || '',
        owner: item.owner || null,
        drive: item.drive || null,
      },
    };
  }

  if (target.fileComment) {
    const comment = target.fileComment;
    return {
      type: 'file_comment',
      id: comment.legacyCommentId || comment.legacyDiscussionId || '',
      name: '',
      parentId: comment.parent && comment.parent.name ? comment.parent.name : '',
      url: '',
      meta: { parent: comment.parent || null },
    };
  }

  if (target.teamDrive) {
    return {
      type: 'shared_drive',
      id: target.teamDrive.name || '',
      name: target.teamDrive.title || '',
      parentId: '',
      url: '',
      meta: {},
    };
  }

  return {
    type: hcFirstKey_(target) || 'unknown',
    id: '',
    name: '',
    parentId: '',
    url: '',
    meta: target || {},
  };
}
