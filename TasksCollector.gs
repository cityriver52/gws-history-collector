function hcCollectTasks_() {
  const runStarted = new Date();
  const cursor = hcGetState_('hc_tasks_cursor', hcDaysAgoIso_(HC_CONFIG.INITIAL_LOOKBACK_DAYS));
  const taskLists = hcListTaskLists_();
  const events = [];

  taskLists.forEach(function(taskList) {
    let pageToken = '';
    const base = 'https://tasks.googleapis.com/tasks/v1/lists/' + encodeURIComponent(taskList.id) + '/tasks';
    do {
      const response = hcGetJson_(base, {
        updatedMin: cursor,
        showCompleted: true,
        showDeleted: true,
        showHidden: true,
        showAssigned: true,
        maxResults: 100,
        pageToken: pageToken,
      });

      (response.items || []).forEach(function(task) {
        events.push(hcTaskEvent_(taskList, task, task.deleted ? 'task_deleted' : 'task_changed', task.updated));
        if (task.completed) {
          events.push(hcTaskEvent_(taskList, task, 'task_completed', task.completed));
        }
      });
      pageToken = response.nextPageToken || '';
    } while (pageToken);
  });

  const overlapMs = 2 * 60 * 1000;
  hcSetState_('hc_tasks_cursor', new Date(runStarted.getTime() - overlapMs).toISOString());
  return events;
}

function hcListTaskLists_() {
  const lists = [];
  let pageToken = '';
  do {
    const response = hcGetJson_('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
      maxResults: 1000,
      pageToken: pageToken,
    });
    lists.push.apply(lists, response.items || []);
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return lists;
}

function hcTaskEvent_(taskList, task, action, eventTime) {
  const assignment = task.assignmentInfo || {};
  return {
    event_time: eventTime || task.updated || new Date().toISOString(),
    source: 'tasks',
    action: action,
    actor: 'self',
    object_type: 'task',
    object_id: task.id || '',
    object_name: task.title || '(no title)',
    container_id: taskList.id || '',
    container_name: taskList.title || '',
    url: task.webViewLink || '',
    direction: '',
    details: {
      status: task.status || '',
      due: task.due || '',
      completed: task.completed || '',
      deleted: Boolean(task.deleted),
      hidden: Boolean(task.hidden),
      parent: task.parent || '',
      links: task.links || [],
      assignment_surface: assignment.surfaceType || '',
      assignment_link: assignment.linkToTask || '',
      assignment_drive_file_id: assignment.driveResourceInfo ? assignment.driveResourceInfo.driveFileId || '' : '',
      assignment_space: assignment.spaceInfo ? assignment.spaceInfo.space || '' : '',
    },
  };
}
