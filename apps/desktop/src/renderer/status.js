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
    if (sectionViews.length) renderSections(sectionViews);
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
    $('updates-release').hidden = !release || !release.releaseUrl;
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

  // Edition sections (status-sections.ts): declarative models from the main process, rendered with
  // the card styles above. Text is only ever set with textContent; buttons send ids and the values
  // of the section's own fields. Link/mail buttons are opened by the main process from its model.
  var sectionViews = [];
  var drafts = {}; // 'section:field' -> text the user typed, kept across re-renders
  var sectionBusy = {}; // section id -> true while one of its actions runs
  var sectionResult = {}; // section id -> { ok, message } of its last action
  var openDetails = {}; // section id -> details expanded
  var BADGE_TONE = { neutral: '', success: 'ok', warning: 'warn', danger: 'bad' };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function pairList(items, className) {
    var dl = el('dl', className);
    items.forEach(function (item) {
      dl.appendChild(el('dt', '', item.label));
      dl.appendChild(el('dd', '', item.value));
    });
    return dl;
  }

  function draftOr(key, fallback) {
    return Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : fallback || '';
  }

  function sectionValues(model) {
    var values = {};
    (model.fields || []).forEach(function (field) {
      values[field.id] = draftOr(model.id + ':' + field.id, field.value);
    });
    return values;
  }

  function runSection(model, button) {
    if (!api.sectionAction || sectionBusy[model.id]) return;
    sectionBusy[model.id] = true;
    delete sectionResult[model.id];
    renderSections(sectionViews);
    Promise.resolve()
      .then(function () {
        return api.sectionAction({
          sectionId: model.id,
          buttonId: button.id,
          values: sectionValues(model),
        });
      })
      .then(
        function (result) {
          var ok = !!(result && result.ok);
          if (ok && (button.kind || 'action') === 'action') {
            Object.keys(drafts).forEach(function (key) {
              if (key.indexOf(model.id + ':') === 0) delete drafts[key];
            });
          }
          if (result && result.message)
            sectionResult[model.id] = { ok: ok, message: result.message };
          else if (!ok)
            sectionResult[model.id] = { ok: false, message: tr('section.actionFailed') };
        },
        function () {
          sectionResult[model.id] = { ok: false, message: tr('section.actionFailed') };
        },
      )
      .then(function () {
        sectionBusy[model.id] = false;
        renderSections(sectionViews);
      });
  }

  function sectionField(model, field, busy) {
    var key = model.id + ':' + field.id;
    var wrap = el('label', 'field');
    wrap.appendChild(el('span', '', field.label));
    var input = el('input', field.type === 'code' ? 'code' : '');
    input.type = field.type === 'email' ? 'email' : 'text';
    input.setAttribute('data-key', key);
    if (field.type === 'code') {
      input.setAttribute('inputmode', 'numeric');
      input.setAttribute('autocomplete', 'one-time-code');
    } else if (field.type === 'email') {
      input.setAttribute('autocomplete', 'email');
    }
    if (field.placeholder) input.placeholder = field.placeholder;
    input.value = draftOr(key, field.value);
    input.maxLength = 500;
    input.disabled = busy;
    input.addEventListener('input', function () {
      drafts[key] = input.value;
    });
    wrap.appendChild(input);
    if (field.hint) wrap.appendChild(el('span', 'note', field.hint));
    return wrap;
  }

  function sectionCard(model) {
    var busy = !!sectionBusy[model.id];
    var card = el('section', 'card');
    card.setAttribute('data-section', model.id);
    var titleId = 'section-' + model.id + '-title';
    card.setAttribute('aria-labelledby', titleId);
    var head = el('div', 'section-head');
    var h2 = el('h2', '', model.title);
    h2.id = titleId;
    head.appendChild(h2);
    if (model.badge) {
      var tone = BADGE_TONE[model.badge.tone] || '';
      head.appendChild(el('span', tone ? 'badge ' + tone : 'badge', model.badge.text));
    }
    card.appendChild(head);
    if (model.headline) card.appendChild(el('p', 'headline', model.headline));
    if (model.message) card.appendChild(el('p', '', model.message));
    if (model.notice) {
      var notice = el('p', 'notice ' + model.notice.tone, model.notice.text);
      notice.setAttribute('role', model.notice.tone === 'danger' ? 'alert' : 'status');
      card.appendChild(notice);
    }
    if (model.steps && model.steps.length) {
      var ol = el('ol', 'steps');
      model.steps.forEach(function (step) {
        ol.appendChild(el('li', '', step));
      });
      card.appendChild(ol);
    }
    if (model.rows && model.rows.length) card.appendChild(pairList(model.rows, 'rows'));
    (model.fields || []).forEach(function (field) {
      card.appendChild(sectionField(model, field, busy));
    });
    if (model.buttons && model.buttons.length) {
      var row = el('div', 'row');
      model.buttons.forEach(function (button) {
        var b = el(
          'button',
          button.primary ? 'primary' : button.danger ? 'danger' : '',
          button.label,
        );
        b.type = 'button';
        b.setAttribute('data-button', button.id);
        b.disabled = busy;
        b.addEventListener('click', function () {
          runSection(model, button);
        });
        row.appendChild(b);
      });
      card.appendChild(row);
    }
    var status = el('p', 'note');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('data-result', '');
    var result = sectionResult[model.id];
    if (busy) status.textContent = tr('section.working');
    else if (result) status.textContent = result.message;
    status.hidden = !busy && !result;
    card.appendChild(status);
    if (model.details && model.details.length) {
      var details = el('details', 'section-details');
      details.appendChild(el('summary', '', tr('section.details')));
      details.appendChild(pairList(model.details, 'rows'));
      details.open = !!openDetails[model.id];
      details.addEventListener('toggle', function () {
        openDetails[model.id] = details.open;
      });
      card.appendChild(details);
    }
    return card;
  }

  function renderSections(views) {
    sectionViews = Array.isArray(views) ? views : [];
    var host = $('edition-sections');
    if (!host) return;
    // Keep keyboard focus (and the caret) on the same field across a re-render.
    var active = document.activeElement;
    var focusKey = active && host.contains(active) ? active.getAttribute('data-key') : null;
    var caret = focusKey ? [active.selectionStart, active.selectionEnd] : null;
    while (host.firstChild) host.removeChild(host.firstChild);
    sectionViews.forEach(function (view) {
      if (view && view.model) host.appendChild(sectionCard(view.model));
    });
    host.hidden = !host.firstChild;
    if (!focusKey) return;
    var inputs = host.querySelectorAll('input[data-key]');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].getAttribute('data-key') !== focusKey) continue;
      inputs[i].focus();
      try {
        inputs[i].setSelectionRange(caret[0], caret[1]);
      } catch (_e) {
        /* not every input type keeps a caret */
      }
    }
  }

  if (api.getSections) {
    Promise.resolve()
      .then(function () {
        return api.getSections();
      })
      .then(renderSections, function () {
        /* no sections: keep the page as it is */
      });
  }
  if (api.onSectionsChanged) api.onSectionsChanged(renderSections);

  function render(s) {
    applyStrings(s);
    $('mode').textContent = has('modeLabel.' + s.mode) ? tr('modeLabel.' + s.mode) : s.mode;
    $('state').textContent = has('serverState.' + s.serverState)
      ? tr('serverState.' + s.serverState)
      : s.serverState;
    $('url').textContent = s.url;
    $('data').textContent = s.dataDir;
    var name = s.productName || 'EzyChat Lite';
    $('title').textContent = s.version ? name + ' v' + s.version : name;
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
