// Status & Service page logic. Talks to the main process only through window.wati (preload).
/* global window, document */
(function () {
  'use strict';
  var api = window.wati;
  var $ = function (id) {
    return document.getElementById(id);
  };
  var SVC_KEY = { 'not-installed': 'notInstalled', stopped: 'stopped', running: 'running' };
  var working = false;
  var trayBusy = false;
  var updates = window.watiUpdates;
  // Translated strings + locale arrive with the status payload (no extra IPC). Until then the
  // static English text from status.html stays and update rendering waits for the strings.
  var strings = null;
  var intlTag = 'en-GB';
  var lastUpdateState = null;
  var appliedLocale = null;

  function tr(key, vars) {
    var text = (strings && strings[key]) || key;
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, name) {
      return vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
    });
  }

  /** Has a translation for `key`, so unknown enum values can fall back to the raw value. */
  function has(key) {
    return !!(strings && Object.prototype.hasOwnProperty.call(strings, key));
  }

  // Static text is written once per language: the status poll calls this every few seconds, and
  // rewriting [data-i18n] elements would clobber text that renderUpdates() fills in at runtime.
  function applyStrings(s) {
    var locale = s.locale || 'en';
    if (strings && appliedLocale === locale) return;
    appliedLocale = locale;
    strings = s.strings || {};
    intlTag = s.intlTag || 'en-GB';
    document.documentElement.lang = locale;
    if (strings.documentTitle) document.title = strings.documentTitle;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (has(key)) el.textContent = strings[key];
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria-label');
      if (has(key)) el.setAttribute('aria-label', strings[key]);
    });
    if (lastUpdateState) renderUpdates(lastUpdateState);
  }

  function renderUpdates(s) {
    lastUpdateState = s;
    if (!strings) return;
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
    var text = tr('updates.installed', { version: s.currentVersion });
    if (s.status === 'checking') text = tr('updates.checking');
    else if (s.status === 'available' && release)
      text = tr(release.prerelease ? 'updates.availablePreview' : 'updates.available', {
        version: release.version,
      });
    else if (s.status === 'current') text = tr('updates.current', { version: s.currentVersion });
    else if (s.status === 'error') text = s.error || tr('updates.checkFailed');
    if (downloading) text = tr('updates.downloading', { percent: percentage });
    else if (ready) text = tr('updates.ready', { version: transfer.version });
    else if (installing) text = tr('updates.installing');
    else if (transfer.error) text = transfer.error;
    $('updates-state').textContent = text;
    $('updates-checked').textContent = s.checkedAt
      ? tr('updates.lastChecked', { time: new Date(s.checkedAt).toLocaleString(intlTag) })
      : tr('updates.autoCheck');
    $('updates-check').disabled = s.status === 'checking' || downloading || ready || installing;
    $('updates-check').textContent = tr(s.status === 'checking' ? 'checkingButton' : 'checkButton');
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
      ? tr('downloadVersion', { version: release.version })
      : tr('downloadButton');
    $('update-notes').hidden = !release || !release.notes;
    $('update-notes').textContent = release ? release.notes.slice(0, 16000) : '';
    // The unavailable reason is its own sentence from the main process (already translated there).
    $('updates-help').textContent =
      release && !release.downloadUrl
        ? tr('updates.noInstaller')
        : managed
          ? verifiedMetadata
            ? tr('updates.managedHelp')
            : tr('updates.unverifiable')
          : [s.installUnavailableReason, tr('updates.manualHelp')].filter(Boolean).join(' ');
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
          error && error.message ? error.message : tr('updates.openFailed');
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
    applyStrings(s);
    $('mode').textContent = has('modeLabel.' + s.mode) ? tr('modeLabel.' + s.mode) : s.mode;
    $('state').textContent = has('serverState.' + s.serverState)
      ? tr('serverState.' + s.serverState)
      : s.serverState;
    $('url').textContent = s.url;
    $('data').textContent = s.dataDir;
    $('title').textContent = s.version ? 'EzyChat Lite v' + s.version : 'EzyChat Lite';
    $('version').textContent = s.version;
    $('server-version').textContent = s.serverVersion || tr('notAnswering');
    $('server-mode').textContent = s.serverMode
      ? has('serverModeLabel.' + s.serverMode)
        ? tr('serverModeLabel.' + s.serverMode)
        : s.serverMode
      : '—';
    $('log').textContent = (s.logs || []).join('\n');
    // Only a service client can quit on close; a hosting app always stays in the tray.
    var tray = $('keep-in-tray');
    var trayChoice = s.mode === 'client';
    if (!trayBusy) tray.checked = trayChoice ? s.keepInTray : true;
    tray.disabled = !trayChoice || trayBusy;
    $('tray-note').textContent = tr(
      trayChoice ? (s.keepInTray ? 'trayNote.keep' : 'trayNote.quit') : 'trayNote.host',
    );
    var busy = $('busy');
    busy.hidden = !s.busy;
    busy.textContent = s.busy || '';

    var card = $('svc-card');
    card.hidden = !s.serviceSupported;
    var st = $('svc-state');
    var svcKey = 'svcLabel.' + SVC_KEY[s.serviceState];
    st.textContent = has(svcKey) ? tr(svcKey) : s.serviceState;
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

  $('keep-in-tray').addEventListener('change', function (e) {
    trayBusy = true;
    Promise.resolve(api.setKeepInTray(e.target.checked))
      .catch(function () {
        /* refresh restores the saved value */
      })
      .then(function () {
        trayBusy = false;
        refresh();
      });
  });

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
