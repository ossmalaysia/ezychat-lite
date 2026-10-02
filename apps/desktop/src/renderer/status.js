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
  var SVC_LABEL = { 'not-installed': 'Not installed', stopped: 'Stopped', running: 'Running' };
  var working = false;

  function render(s) {
    $('mode').textContent = MODE_LABEL[s.mode] || s.mode;
    $('state').textContent = s.serverState === 'external' ? 'running (service)' : s.serverState;
    $('url').textContent = s.url;
    $('data').textContent = s.dataDir;
    $('version').textContent = s.version;
    $('log').textContent = (s.logs || []).join('\n');
    var busy = $('busy');
    busy.hidden = !s.busy;
    busy.textContent = s.busy || '';

    var card = $('svc-card');
    card.hidden = !s.serviceSupported;
    var st = $('svc-state');
    st.textContent = SVC_LABEL[s.serviceState] || s.serviceState;
    st.className = 'badge ' + (s.serviceState === 'running' ? 'ok' : s.serviceState === 'stopped' ? 'bad' : '');
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

  api.onStatusChanged(refresh);
  refresh();
  setInterval(refresh, 5000);
})();
