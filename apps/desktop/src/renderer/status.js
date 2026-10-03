// Status & Service page logic. Talks to the main process only through window.wati (preload).
/* global window, document */
(function () {
  'use strict';
  var api = window.wati;
  var $ = function (id) {
    return document.getElementById(id);
  };
  var MODE_LABEL = {
    starting: 'Starting…',
    standalone: 'Standalone (inside this app)',
    client: 'Connected to background service',
    error: 'Not running',
  };
  var SERVER_MODE_LABEL = {
    standalone: 'standalone',
    service: 'background service',
    dev: 'development',
  };
  var SVC_LABEL = { 'not-installed': 'Not installed', stopped: 'Stopped', running: 'Running' };
  var working = false;
  var updates = window.watiUpdates;

  function renderUpdates(s) {
    $('updates-card').hidden = !s.isHost;
    if (!s.isHost) return;
    var release = s.release;
    var text = 'Installed: v' + s.currentVersion + '.';
    if (s.status === 'checking') text = 'Checking GitHub for updates…';
    else if (s.status === 'available' && release)
      text = 'v' + release.version + ' is available' + (release.prerelease ? ' (preview).' : '.');
    else if (s.status === 'current') text = 'You are up to date — v' + s.currentVersion + '.';
    else if (s.status === 'error')
      text = s.error || 'Could not check for updates. Try again later.';
    $('updates-state').textContent = text;
    $('updates-checked').textContent = s.checkedAt
      ? 'Last checked: ' + new Date(s.checkedAt).toLocaleString()
      : 'Checks GitHub automatically while this app is running.';
    $('updates-check').disabled = s.status === 'checking';
    $('updates-check').textContent = s.status === 'checking' ? 'Checking…' : 'Check for updates';
    $('updates-download').hidden = !release || !release.downloadUrl;
    $('updates-release').hidden = !release;
    $('updates-download').textContent = release
      ? 'Download v' + release.version
      : 'Download update';
    $('update-notes').hidden = !release || !release.notes;
    $('update-notes').textContent = release ? release.notes.slice(0, 16000) : '';
    $('updates-help').textContent =
      release && !release.downloadUrl
        ? 'This release has no installer for this computer. Open release details for available downloads.'
        : 'Install the new release when your team can briefly pause work. Your accounts, chats and settings are preserved. If you use the background service, stop it here before installing and start it again afterward.';
  }

  function refreshUpdates() {
    return updates
      .getState()
      .then(renderUpdates)
      .catch(function () {
        /* Status pages can briefly race shutdown; keep the last useful state. */
      });
  }

  function updateAction(action) {
    return function () {
      Promise.resolve(action()).catch(function (error) {
        $('updates-state').textContent =
          error && error.message ? error.message : 'Could not open update.';
      });
    };
  }

  $('updates-check').addEventListener(
    'click',
    updateAction(function () {
      return updates.check().then(renderUpdates);
    }),
  );
  $('updates-download').addEventListener('click', updateAction(updates.openDownload));
  $('updates-release').addEventListener('click', updateAction(updates.openRelease));
  updates.onChanged(renderUpdates);
  refreshUpdates();

  function render(s) {
    $('mode').textContent = MODE_LABEL[s.mode] || s.mode;
    $('state').textContent = s.serverState === 'external' ? 'running (service)' : s.serverState;
    $('url').textContent = s.url;
    $('data').textContent = s.dataDir;
    $('title').textContent = s.version ? 'EzyChat Lite v' + s.version : 'EzyChat Lite';
    $('version').textContent = s.version;
    $('server-version').textContent = s.serverVersion || 'not answering';
    $('server-mode').textContent = s.serverMode
      ? SERVER_MODE_LABEL[s.serverMode] || s.serverMode
      : '—';
    $('log').textContent = (s.logs || []).join('\n');
    var busy = $('busy');
    busy.hidden = !s.busy;
    busy.textContent = s.busy || '';

    var card = $('svc-card');
    card.hidden = !s.serviceSupported;
    var st = $('svc-state');
    st.textContent = SVC_LABEL[s.serviceState] || s.serviceState;
    st.className =
      'badge ' + (s.serviceState === 'running' ? 'ok' : s.serviceState === 'stopped' ? 'bad' : '');
    var disabled = working || !!s.busy;
    var installed = s.serviceState !== 'not-installed';
    $('svc-enable').hidden = installed;
    $('svc-disable').hidden = !installed;
    $('svc-start').hidden = !installed || s.serviceState === 'running';
    $('svc-stop').hidden = !installed || s.serviceState !== 'running';
    ['svc-enable', 'svc-disable', 'svc-start', 'svc-stop', 'reset'].forEach(function (id) {
      $(id).disabled = disabled;
    });
  }

  function refresh() {
    return api.getStatus().then(render, function (err) {
      $('log').textContent = String(err && err.message ? err.message : err);
    });
  }

  function action(fn) {
    return function () {
      working = true;
      refresh();
      Promise.resolve(fn())
        .catch(function () {
          /* main process shows dialogs */
        })
        .then(function () {
          working = false;
          refresh();
        });
    };
  }

  $('open').addEventListener('click', function () {
    api.openMain();
  });
  $('logs').addEventListener('click', function () {
    api.openLogs();
  });
  $('reset').addEventListener('click', action(api.resetAdmin));
  $('svc-enable').addEventListener('click', action(api.enableService));
  $('svc-disable').addEventListener('click', action(api.disableService));
  $('svc-start').addEventListener('click', action(api.startService));
  $('svc-stop').addEventListener('click', action(api.stopService));

  api.onStatusChanged(function () {
    refresh();
    refreshUpdates();
  });
  refresh();
  setInterval(refresh, 5000);
})();
