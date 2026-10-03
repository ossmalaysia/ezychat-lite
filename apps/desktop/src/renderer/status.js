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
    var transfer = s.transfer || {};
    var downloading = transfer.status === 'downloading';
    var ready = transfer.status === 'ready';
    var installing = transfer.status === 'installing';
    var managed = s.canInstall && !!updates.installUpdate;
    var verifiedMetadata = release && release.assetSha256 && release.assetSize;
    var percentage = transfer.totalBytes
      ? Math.min(
          100,
          Math.max(0, Math.round((100 * transfer.downloadedBytes) / transfer.totalBytes)),
        )
      : 0;
    var text = 'Installed: v' + s.currentVersion + '.';
    if (s.status === 'checking') text = 'Checking GitHub for updates…';
    else if (s.status === 'available' && release)
      text = 'v' + release.version + ' is available' + (release.prerelease ? ' (preview).' : '.');
    else if (s.status === 'current') text = 'You are up to date — v' + s.currentVersion + '.';
    else if (s.status === 'error')
      text = s.error || 'Could not check for updates. Try again later.';
    if (downloading) text = 'Downloading update… ' + percentage + '%. Your inbox keeps working.';
    else if (ready) text = 'v' + transfer.version + ' is downloaded and verified. Ready to update.';
    else if (installing)
      text = 'Preparing to restart and update… Approve the system prompt to continue.';
    else if (transfer.error) text = transfer.error;
    $('updates-state').textContent = text;
    $('updates-checked').textContent = s.checkedAt
      ? 'Last checked: ' + new Date(s.checkedAt).toLocaleString()
      : 'Checks GitHub automatically while this app is running.';
    $('updates-check').disabled = s.status === 'checking' || downloading || ready || installing;
    $('updates-check').textContent = s.status === 'checking' ? 'Checking…' : 'Check for updates';
    $('updates-download').hidden = !release || !release.downloadUrl || ready;
    $('updates-download').disabled = downloading || installing || (managed && !verifiedMetadata);
    $('updates-install').hidden = !ready || !managed;
    $('updates-cancel').hidden = !downloading;
    $('updates-progress').hidden = !downloading;
    $('updates-progress').value = percentage;
    $('updates-result').hidden = !s.lastInstall;
    $('updates-result').textContent = s.lastInstall ? s.lastInstall.message : '';
    $('updates-release').hidden = !release;
    $('updates-release').disabled = installing;
    $('updates-download').textContent = release
      ? 'Download v' + release.version
      : 'Download update';
    $('update-notes').hidden = !release || !release.notes;
    $('update-notes').textContent = release ? release.notes.slice(0, 16000) : '';
    $('updates-help').textContent =
      release && !release.downloadUrl
        ? 'This release has no installer for this computer. Open release details for available downloads.'
        : managed
          ? verifiedMetadata
            ? 'Download first, then choose Restart and update when your team can briefly pause work. The app and any installed service restart automatically. Your accounts, chats and settings are preserved.'
            : 'This release cannot be verified for installation here. Open release details for a manual installer.'
          : (s.installUnavailableReason || '') +
            ' Download the installer and quit this app before installing. Stop a Windows service before installing, then start it afterward. On Mac, remove the service before installing and enable it again afterward to refresh its protected app copy. Your accounts, chats and settings are preserved.';
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
  $('updates-install').addEventListener('click', updateAction(updates.installUpdate));
  $('updates-cancel').addEventListener('click', updateAction(updates.cancelDownload));
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
