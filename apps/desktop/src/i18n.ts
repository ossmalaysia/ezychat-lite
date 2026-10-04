// Desktop shell strings (tray, dialogs, message pages, status window). The desktop shell is per
// machine, so it follows the OS language rather than a web user's language setting. Log messages
// stay English.
//
// Only *types* come from @wa-team-inbox/shared: the main process is compiled by tsc and run by
// Electron as plain JS, and the shared package ships TypeScript source (plus zod), which cannot be
// loaded at runtime from dist/ or the packaged app. The tiny runtime pieces below mirror
// packages/shared/src/i18n; i18n.test.ts checks that they behave exactly like the shared ones.
// No electron import here, so the catalogs stay unit-testable.
import type { Catalog, CatalogKey, Locale, Translator } from '@wa-team-inbox/shared';

const en = {
  tray: {
    open: 'Open',
    status: 'Status & Service…',
    openCloudflare: 'Open admin → Cloudflare',
    resetAdmin: 'Reset admin password…',
    quit: 'Quit',
  },
  mode: {
    client: 'Background service — connected',
    standalone: 'Standalone — {{state}}',
    error: 'Server not running',
    starting: 'Starting…',
  },
  serverState: {
    starting: 'starting',
    running: 'running',
    crashed: 'crashed',
    stopped: 'stopped',
  },
  window: {
    statusTitle: '{{title}} — Status & Service',
  },
  page: {
    startingTitle: 'Starting EzyChat Lite…',
    startingBody: 'Starting the local server.',
    notStartedTitle: 'The server did not start',
    notStartedBody:
      'Port {{port}} may be in use by another program. Open "Status & Service…" from the tray for logs.',
    serviceNotAnsweringTitle: 'The background service is not answering',
    serviceNotRunningTitle: 'The background service is not running',
    serviceDownBody:
      'EzyChat Lite runs as a background service on this computer. Open "Status & Service…" from the tray to start it or to see its logs.',
    connectingTitle: 'Connecting to the background service…',
    connectingBody: 'Waiting for the EzyChat Lite service to start.',
    serviceStoppedTitle: 'Service stopped',
    serviceStoppedBody: 'Start the service again from "Status & Service…".',
  },
  updates: {
    trayRestart: 'Restart and update to v{{version}}…',
    trayDownloading: 'Downloading update…',
    trayAvailable: 'Update available: v{{version}}…',
    trayCheck: 'Check for updates…',
    installUnsupported: 'Automatic installation is available in installed Windows and Mac apps.',
    hostOnly: 'Only the hosting computer can install this update.',
    waitForOperation: 'Wait for the current app operation to finish before updating.',
    preparing: 'Preparing update…',
    installFailed: 'Could not install the update',
    hostGone: 'The hosting app is no longer available to update.',
    closedBeforeConfirm: 'The app closed before installation was confirmed.',
    approvePrompt: 'Preparing a safe update. Approve the operating system prompt to continue.',
    restarting: 'Restarting to install the update…',
  },
  check: {
    tooMuch: 'GitHub returned too much update information. Try again later.',
    noInfo: 'GitHub returned no update information.',
    invalid: 'GitHub returned invalid update information. Try again later.',
    invalidVersion: 'This build has an invalid version. Check the project releases.',
    timeout: 'The update check timed out. Please try again later.',
    rateLimited: 'GitHub is limiting update checks. Please try again later.',
    http: 'GitHub could not check for updates. Please try again later.',
    pagination:
      'The release history is too large to confirm the latest version. Check the project releases.',
    network: 'Could not reach GitHub. Check your internet connection and try again.',
  },
  reset: {
    busyConfirm: 'Confirming password reset…',
    busy: 'Resetting admin password…',
    failed: 'Could not reset the admin password',
    confirmTitle: 'Reset admin password',
    confirmMessage: 'Reset the first admin account password?',
    confirmDetail:
      'A new temporary password is generated and all of that admin’s sessions are signed out.',
    confirmButton: 'Reset password',
    notManaged: 'The running server is not managed by this app; reset it where it runs.',
    exitCode: 'Reset failed (exit code {{code}}).',
    doneTitle: 'Admin password reset',
    doneMessage: 'New password for {{user}}:',
    doneDetail: '{{password}}\n\nYou will be asked to change it after signing in.',
    copy: 'Copy password',
  },
  service: {
    enableBusyConfirm: 'Confirming service installation…',
    enableFailed: 'Could not enable the background service',
    enableTitle: 'Run as background service',
    enableMessage: 'Run EzyChat Lite as a background service?',
    enableDetail:
      'The server will start when this computer boots, even when nobody is signed in. Your data moves to a machine-wide folder:\n{{folder}}\n\nYou will be asked for administrator permission.',
    enableButton: 'Enable service',
    installing: 'Installing service…',
    waiting: 'Waiting for the service to start…',
    noAnswer: 'The service was installed but did not answer on port {{port}}.',
    disableBusyConfirm: 'Confirming service removal…',
    disableFailed: 'Could not remove the background service',
    disableTitle: 'Stop background service',
    disableMessage: 'Remove the background service and run inside this app again?',
    disableDetail:
      'Your data moves back to your user profile. You will be asked for administrator permission.',
    disableButton: 'Remove service',
    removing: 'Removing service…',
    startingLocal: 'Starting the local server…',
    starting: 'Starting service…',
    startFailed: 'Could not start the service',
    stopping: 'Stopping service…',
    stopFailed: 'Could not stop the service',
  },
  common: {
    cancel: 'Cancel',
    close: 'Close',
    trayPrefFailed: 'Could not save the tray preference.',
  },
  // Status & Service window (renderer/status.html + status.js), sent flattened in the status payload.
  status: {
    documentTitle: 'EzyChat Lite — Status & Service',
    updatesTitle: 'App updates',
    checkingInitial: 'Checking for updates…',
    downloadAria: 'Update download',
    checkButton: 'Check for updates',
    checkingButton: 'Checking…',
    downloadButton: 'Download update',
    downloadVersion: 'Download v{{version}}',
    installButton: 'Restart and update',
    cancelButton: 'Cancel download',
    releaseButton: 'Release details',
    updatesHelp:
      'Updates are managed on this hosting computer. Install the new release when your team can briefly pause work. Your accounts, chats and settings are preserved.',
    server: 'Server',
    mode: 'Mode',
    state: 'State',
    address: 'Address',
    dataFolder: 'Data folder',
    appVersion: 'App version',
    serverVersion: 'Server version',
    serverMode: 'Server mode',
    openInbox: 'Open inbox',
    openLogs: 'Open logs folder',
    resetAdmin: 'Reset admin password…',
    desktopApp: 'Desktop app',
    keepInTray: 'Keep EzyChat Lite in the system tray',
    backgroundService: 'Background service',
    serviceStatus: 'Status:',
    serviceNote:
      'As a service the server starts with the computer, even when nobody is signed in, and keeps the WhatsApp connection and tunnel running. Requires administrator permission.',
    enableService: 'Enable service',
    start: 'Start',
    stop: 'Stop',
    removeService: 'Remove service',
    recentLog: 'Recent log',
    notAnswering: 'not answering',
    modeLabel: {
      starting: 'Starting…',
      standalone: 'Standalone (inside this app)',
      client: 'Connected to background service',
      error: 'Not running',
    },
    serverModeLabel: {
      standalone: 'standalone',
      service: 'background service',
      dev: 'development',
    },
    serverState: {
      starting: 'starting',
      running: 'running',
      crashed: 'crashed',
      stopped: 'stopped',
      external: 'running (service)',
    },
    svcLabel: {
      notInstalled: 'Not installed',
      stopped: 'Stopped',
      running: 'Running',
    },
    trayNote: {
      keep: 'Closing the window keeps EzyChat Lite in the tray for quick access and desktop notifications. Quit from the tray menu.',
      quit: 'Closing the window quits the app. The background service keeps the inbox running.',
      host: 'This app is hosting the server, so it always stays in the tray while the inbox runs.',
    },
    updates: {
      installed: 'Installed: v{{version}}.',
      checking: 'Checking GitHub for updates…',
      available: 'v{{version}} is available.',
      availablePreview: 'v{{version}} is available (preview).',
      current: 'You are up to date — v{{version}}.',
      checkFailed: 'Could not check for updates. Try again later.',
      downloading: 'Downloading update… {{percent}}%. Your inbox keeps working.',
      ready: 'v{{version}} is downloaded and verified. Ready to update.',
      installing: 'Preparing to restart and update… Approve the system prompt to continue.',
      lastChecked: 'Last checked: {{time}}',
      autoCheck: 'Checks GitHub automatically while this app is running.',
      noInstaller:
        'This release has no installer for this computer. Open release details for available downloads.',
      managedHelp:
        'Download first, then choose Restart and update when your team can briefly pause work. The app and any installed service restart automatically. Your accounts, chats and settings are preserved.',
      unverifiable:
        'This release cannot be verified for installation here. Open release details for a manual installer.',
      manualHelp:
        'Download the installer and quit this app before installing. Stop a Windows service before installing, then start it afterward. On Mac, remove the service before installing and enable it again afterward to refresh its protected app copy. Your accounts, chats and settings are preserved.',
      openFailed: 'Could not open update.',
    },
  },
};

export type DesktopCatalog = typeof en;
export type DesktopKey = CatalogKey<DesktopCatalog>;

const ms: typeof en = {
  tray: {
    open: 'Buka',
    status: 'Status & Perkhidmatan…',
    openCloudflare: 'Buka admin → Cloudflare',
    resetAdmin: 'Set semula kata laluan pentadbir…',
    quit: 'Keluar',
  },
  mode: {
    client: 'Perkhidmatan latar belakang — bersambung',
    standalone: 'Kendiri — {{state}}',
    error: 'Pelayan tidak berjalan',
    starting: 'Memulakan…',
  },
  serverState: {
    starting: 'sedang dimulakan',
    running: 'berjalan',
    crashed: 'ranap',
    stopped: 'dihentikan',
  },
  window: {
    statusTitle: '{{title}} — Status & Perkhidmatan',
  },
  page: {
    startingTitle: 'Memulakan EzyChat Lite…',
    startingBody: 'Memulakan pelayan tempatan.',
    notStartedTitle: 'Pelayan tidak dapat dimulakan',
    notStartedBody:
      'Port {{port}} mungkin sedang digunakan oleh program lain. Buka "Status & Perkhidmatan…" dari dulang sistem untuk melihat log.',
    serviceNotAnsweringTitle: 'Perkhidmatan latar belakang tidak memberikan respons',
    serviceNotRunningTitle: 'Perkhidmatan latar belakang tidak berjalan',
    serviceDownBody:
      'EzyChat Lite berjalan sebagai perkhidmatan latar belakang pada komputer ini. Buka "Status & Perkhidmatan…" dari dulang sistem untuk memulakannya atau melihat lognya.',
    connectingTitle: 'Menyambung ke perkhidmatan latar belakang…',
    connectingBody: 'Menunggu perkhidmatan EzyChat Lite dimulakan.',
    serviceStoppedTitle: 'Perkhidmatan dihentikan',
    serviceStoppedBody: 'Mulakan semula perkhidmatan melalui "Status & Perkhidmatan…".',
  },
  updates: {
    trayRestart: 'Mulakan semula dan kemas kini ke v{{version}}…',
    trayDownloading: 'Memuat turun kemas kini…',
    trayAvailable: 'Kemas kini tersedia: v{{version}}…',
    trayCheck: 'Semak kemas kini…',
    installUnsupported:
      'Pemasangan automatik tersedia dalam aplikasi Windows dan Mac yang telah dipasang.',
    hostOnly: 'Hanya komputer hos boleh memasang kemas kini ini.',
    waitForOperation: 'Tunggu operasi aplikasi semasa selesai sebelum mengemas kini.',
    preparing: 'Menyediakan kemas kini…',
    installFailed: 'Kemas kini tidak dapat dipasang',
    hostGone: 'Aplikasi hos tidak lagi tersedia untuk dikemas kini.',
    closedBeforeConfirm: 'Aplikasi ditutup sebelum pemasangan disahkan.',
    approvePrompt:
      'Menyediakan kemas kini yang selamat. Luluskan gesaan sistem pengendalian untuk meneruskan.',
    restarting: 'Memulakan semula untuk memasang kemas kini…',
  },
  check: {
    tooMuch: 'GitHub memulangkan maklumat kemas kini yang terlalu banyak. Cuba lagi kemudian.',
    noInfo: 'GitHub tidak memulangkan maklumat kemas kini.',
    invalid: 'GitHub memulangkan maklumat kemas kini yang tidak sah. Cuba lagi kemudian.',
    invalidVersion: 'Binaan ini mempunyai versi yang tidak sah. Semak keluaran projek.',
    timeout: 'Semakan kemas kini tamat masa. Sila cuba lagi kemudian.',
    rateLimited: 'GitHub sedang mengehadkan semakan kemas kini. Sila cuba lagi kemudian.',
    http: 'GitHub tidak dapat menyemak kemas kini. Sila cuba lagi kemudian.',
    pagination:
      'Sejarah keluaran terlalu besar untuk mengesahkan versi terkini. Semak keluaran projek.',
    network: 'GitHub tidak dapat dihubungi. Semak sambungan internet anda dan cuba lagi.',
  },
  reset: {
    busyConfirm: 'Mengesahkan set semula kata laluan…',
    busy: 'Menetapkan semula kata laluan pentadbir…',
    failed: 'Kata laluan pentadbir tidak dapat ditetapkan semula',
    confirmTitle: 'Set semula kata laluan pentadbir',
    confirmMessage: 'Tetapkan semula kata laluan akaun pentadbir pertama?',
    confirmDetail:
      'Kata laluan sementara baharu akan dijana dan semua sesi pentadbir tersebut akan dilog keluar.',
    confirmButton: 'Set semula kata laluan',
    notManaged:
      'Pelayan yang sedang berjalan tidak diurus oleh aplikasi ini; tetapkan semula di tempat pelayan itu berjalan.',
    exitCode: 'Set semula gagal (kod keluar {{code}}).',
    doneTitle: 'Kata laluan pentadbir telah ditetapkan semula',
    doneMessage: 'Kata laluan baharu untuk {{user}}:',
    doneDetail: '{{password}}\n\nAnda akan diminta menukarnya selepas log masuk.',
    copy: 'Salin kata laluan',
  },
  service: {
    enableBusyConfirm: 'Mengesahkan pemasangan perkhidmatan…',
    enableFailed: 'Perkhidmatan latar belakang tidak dapat didayakan',
    enableTitle: 'Jalankan sebagai perkhidmatan latar belakang',
    enableMessage: 'Jalankan EzyChat Lite sebagai perkhidmatan latar belakang?',
    enableDetail:
      'Pelayan akan bermula apabila komputer ini dihidupkan, walaupun tiada sesiapa log masuk. Data anda akan dipindahkan ke folder seluruh mesin:\n{{folder}}\n\nAnda akan diminta kebenaran pentadbir.',
    enableButton: 'Dayakan perkhidmatan',
    installing: 'Memasang perkhidmatan…',
    waiting: 'Menunggu perkhidmatan dimulakan…',
    noAnswer: 'Perkhidmatan telah dipasang tetapi tidak memberikan respons pada port {{port}}.',
    disableBusyConfirm: 'Mengesahkan pembuangan perkhidmatan…',
    disableFailed: 'Perkhidmatan latar belakang tidak dapat dibuang',
    disableTitle: 'Hentikan perkhidmatan latar belakang',
    disableMessage: 'Buang perkhidmatan latar belakang dan jalankan semula dalam aplikasi ini?',
    disableDetail:
      'Data anda akan dipindahkan semula ke profil pengguna anda. Anda akan diminta kebenaran pentadbir.',
    disableButton: 'Buang perkhidmatan',
    removing: 'Membuang perkhidmatan…',
    startingLocal: 'Memulakan pelayan tempatan…',
    starting: 'Memulakan perkhidmatan…',
    startFailed: 'Perkhidmatan tidak dapat dimulakan',
    stopping: 'Menghentikan perkhidmatan…',
    stopFailed: 'Perkhidmatan tidak dapat dihentikan',
  },
  common: {
    cancel: 'Batal',
    close: 'Tutup',
    trayPrefFailed: 'Tetapan dulang sistem tidak dapat disimpan.',
  },
  status: {
    documentTitle: 'EzyChat Lite — Status & Perkhidmatan',
    updatesTitle: 'Kemas kini aplikasi',
    checkingInitial: 'Menyemak kemas kini…',
    downloadAria: 'Muat turun kemas kini',
    checkButton: 'Semak kemas kini',
    checkingButton: 'Menyemak…',
    downloadButton: 'Muat turun kemas kini',
    downloadVersion: 'Muat turun v{{version}}',
    installButton: 'Mulakan semula dan kemas kini',
    cancelButton: 'Batalkan muat turun',
    releaseButton: 'Butiran keluaran',
    updatesHelp:
      'Kemas kini diurus pada komputer hos ini. Pasang keluaran baharu apabila pasukan anda boleh berhenti seketika. Akaun, sembang dan tetapan anda dikekalkan.',
    server: 'Pelayan',
    mode: 'Mod',
    state: 'Keadaan',
    address: 'Alamat',
    dataFolder: 'Folder data',
    appVersion: 'Versi aplikasi',
    serverVersion: 'Versi pelayan',
    serverMode: 'Mod pelayan',
    openInbox: 'Buka peti masuk',
    openLogs: 'Buka folder log',
    resetAdmin: 'Set semula kata laluan pentadbir…',
    desktopApp: 'Aplikasi desktop',
    keepInTray: 'Kekalkan EzyChat Lite dalam dulang sistem',
    backgroundService: 'Perkhidmatan latar belakang',
    serviceStatus: 'Status:',
    serviceNote:
      'Sebagai perkhidmatan, pelayan bermula bersama komputer, walaupun tiada sesiapa log masuk, dan memastikan sambungan WhatsApp serta terowong terus berjalan. Memerlukan kebenaran pentadbir.',
    enableService: 'Dayakan perkhidmatan',
    start: 'Mula',
    stop: 'Henti',
    removeService: 'Buang perkhidmatan',
    recentLog: 'Log terkini',
    notAnswering: 'tidak memberikan respons',
    modeLabel: {
      starting: 'Memulakan…',
      standalone: 'Kendiri (dalam aplikasi ini)',
      client: 'Bersambung ke perkhidmatan latar belakang',
      error: 'Tidak berjalan',
    },
    serverModeLabel: {
      standalone: 'kendiri',
      service: 'perkhidmatan latar belakang',
      dev: 'pembangunan',
    },
    serverState: {
      starting: 'sedang dimulakan',
      running: 'berjalan',
      crashed: 'ranap',
      stopped: 'dihentikan',
      external: 'berjalan (perkhidmatan)',
    },
    svcLabel: {
      notInstalled: 'Belum dipasang',
      stopped: 'Dihentikan',
      running: 'Berjalan',
    },
    trayNote: {
      keep: 'Menutup tetingkap akan mengekalkan EzyChat Lite dalam dulang sistem untuk akses pantas dan pemberitahuan desktop. Keluar melalui menu dulang sistem.',
      quit: 'Menutup tetingkap akan menutup aplikasi. Perkhidmatan latar belakang memastikan peti masuk terus berjalan.',
      host: 'Aplikasi ini menjadi hos pelayan, jadi ia sentiasa kekal dalam dulang sistem semasa peti masuk berjalan.',
    },
    updates: {
      installed: 'Dipasang: v{{version}}.',
      checking: 'Menyemak kemas kini di GitHub…',
      available: 'v{{version}} kini tersedia.',
      availablePreview: 'v{{version}} kini tersedia (pratonton).',
      current: 'Aplikasi anda terkini — v{{version}}.',
      checkFailed: 'Kemas kini tidak dapat disemak. Cuba lagi kemudian.',
      downloading: 'Memuat turun kemas kini… {{percent}}%. Peti masuk anda terus berfungsi.',
      ready: 'v{{version}} telah dimuat turun dan disahkan. Sedia untuk dikemas kini.',
      installing:
        'Bersedia untuk dimulakan semula dan dikemas kini… Luluskan gesaan sistem untuk meneruskan.',
      lastChecked: 'Semakan terakhir: {{time}}',
      autoCheck: 'Menyemak GitHub secara automatik semasa aplikasi ini berjalan.',
      noInstaller:
        'Keluaran ini tiada pemasang untuk komputer ini. Buka butiran keluaran untuk muat turun yang tersedia.',
      managedHelp:
        'Muat turun dahulu, kemudian pilih Mulakan semula dan kemas kini apabila pasukan anda boleh berhenti seketika. Aplikasi dan sebarang perkhidmatan yang dipasang akan dimulakan semula secara automatik. Akaun, sembang dan tetapan anda dikekalkan.',
      unverifiable:
        'Keluaran ini tidak dapat disahkan untuk dipasang di sini. Buka butiran keluaran untuk pemasang manual.',
      manualHelp:
        'Muat turun pemasang dan tutup aplikasi ini sebelum memasang. Hentikan perkhidmatan Windows sebelum memasang, kemudian mulakannya semula. Pada Mac, buang perkhidmatan sebelum memasang dan dayakannya semula selepas itu untuk menyegarkan salinan aplikasi yang dilindungi. Akaun, sembang dan tetapan anda dikekalkan.',
      openFailed: 'Kemas kini tidak dapat dibuka.',
    },
  },
};

const zhCN: typeof en = {
  tray: {
    open: '打开',
    status: '状态与服务…',
    openCloudflare: '打开管理 → Cloudflare',
    resetAdmin: '重置管理员密码…',
    quit: '退出',
  },
  mode: {
    client: '后台服务 — 已连接',
    standalone: '独立运行 — {{state}}',
    error: '服务器未运行',
    starting: '正在启动…',
  },
  serverState: {
    starting: '正在启动',
    running: '运行中',
    crashed: '已崩溃',
    stopped: '已停止',
  },
  window: {
    statusTitle: '{{title}} — 状态与服务',
  },
  page: {
    startingTitle: '正在启动 EzyChat Lite…',
    startingBody: '正在启动本地服务器。',
    notStartedTitle: '服务器未能启动',
    notStartedBody: '端口 {{port}} 可能已被其他程序占用。请从系统托盘打开“状态与服务…”查看日志。',
    serviceNotAnsweringTitle: '后台服务没有响应',
    serviceNotRunningTitle: '后台服务未运行',
    serviceDownBody:
      'EzyChat Lite 以后台服务的方式在此电脑上运行。请从系统托盘打开“状态与服务…”来启动服务或查看日志。',
    connectingTitle: '正在连接后台服务…',
    connectingBody: '正在等待 EzyChat Lite 服务启动。',
    serviceStoppedTitle: '服务已停止',
    serviceStoppedBody: '请在“状态与服务…”中重新启动服务。',
  },
  updates: {
    trayRestart: '重启并更新到 v{{version}}…',
    trayDownloading: '正在下载更新…',
    trayAvailable: '有可用更新：v{{version}}…',
    trayCheck: '检查更新…',
    installUnsupported: '自动安装仅适用于已安装的 Windows 和 Mac 应用。',
    hostOnly: '只有主机电脑可以安装此更新。',
    waitForOperation: '请等待当前应用操作完成后再更新。',
    preparing: '正在准备更新…',
    installFailed: '无法安装更新',
    hostGone: '主机应用已不可用，无法更新。',
    closedBeforeConfirm: '应用在确认安装前已关闭。',
    approvePrompt: '正在准备安全更新。请批准操作系统提示以继续。',
    restarting: '正在重启以安装更新…',
  },
  check: {
    tooMuch: 'GitHub 返回的更新信息过多。请稍后再试。',
    noInfo: 'GitHub 没有返回更新信息。',
    invalid: 'GitHub 返回的更新信息无效。请稍后再试。',
    invalidVersion: '此版本的版本号无效。请查看项目的发布页面。',
    timeout: '检查更新超时。请稍后再试。',
    rateLimited: 'GitHub 正在限制更新检查。请稍后再试。',
    http: 'GitHub 无法检查更新。请稍后再试。',
    pagination: '发布历史过多，无法确认最新版本。请查看项目的发布页面。',
    network: '无法连接 GitHub。请检查网络连接后重试。',
  },
  reset: {
    busyConfirm: '正在确认重置密码…',
    busy: '正在重置管理员密码…',
    failed: '无法重置管理员密码',
    confirmTitle: '重置管理员密码',
    confirmMessage: '要重置第一个管理员账号的密码吗？',
    confirmDetail: '系统将生成新的临时密码，并注销该管理员的所有会话。',
    confirmButton: '重置密码',
    notManaged: '正在运行的服务器不由此应用管理；请在服务器运行的地方进行重置。',
    exitCode: '重置失败（退出代码 {{code}}）。',
    doneTitle: '管理员密码已重置',
    doneMessage: '{{user}} 的新密码：',
    doneDetail: '{{password}}\n\n登录后系统会要求你更改密码。',
    copy: '复制密码',
  },
  service: {
    enableBusyConfirm: '正在确认安装服务…',
    enableFailed: '无法启用后台服务',
    enableTitle: '作为后台服务运行',
    enableMessage: '要将 EzyChat Lite 作为后台服务运行吗？',
    enableDetail:
      '服务器将在电脑开机时启动，即使没有人登录。你的数据将移至全机共用的文件夹：\n{{folder}}\n\n系统会要求你提供管理员权限。',
    enableButton: '启用服务',
    installing: '正在安装服务…',
    waiting: '正在等待服务启动…',
    noAnswer: '服务已安装，但在端口 {{port}} 上没有响应。',
    disableBusyConfirm: '正在确认移除服务…',
    disableFailed: '无法移除后台服务',
    disableTitle: '停止后台服务',
    disableMessage: '要移除后台服务，改回在此应用内运行吗？',
    disableDetail: '你的数据将移回你的用户配置文件夹。系统会要求你提供管理员权限。',
    disableButton: '移除服务',
    removing: '正在移除服务…',
    startingLocal: '正在启动本地服务器…',
    starting: '正在启动服务…',
    startFailed: '无法启动服务',
    stopping: '正在停止服务…',
    stopFailed: '无法停止服务',
  },
  common: {
    cancel: '取消',
    close: '关闭',
    trayPrefFailed: '无法保存托盘设置。',
  },
  status: {
    documentTitle: 'EzyChat Lite — 状态与服务',
    updatesTitle: '应用更新',
    checkingInitial: '正在检查更新…',
    downloadAria: '更新下载',
    checkButton: '检查更新',
    checkingButton: '正在检查…',
    downloadButton: '下载更新',
    downloadVersion: '下载 v{{version}}',
    installButton: '重启并更新',
    cancelButton: '取消下载',
    releaseButton: '发布详情',
    updatesHelp:
      '更新由这台主机电脑管理。请在团队可以短暂暂停工作时安装新版本。你的账号、聊天和设置都会保留。',
    server: '服务器',
    mode: '模式',
    state: '状态',
    address: '地址',
    dataFolder: '数据文件夹',
    appVersion: '应用版本',
    serverVersion: '服务器版本',
    serverMode: '服务器模式',
    openInbox: '打开收件箱',
    openLogs: '打开日志文件夹',
    resetAdmin: '重置管理员密码…',
    desktopApp: '桌面应用',
    keepInTray: '将 EzyChat Lite 保留在系统托盘',
    backgroundService: '后台服务',
    serviceStatus: '状态：',
    serviceNote:
      '作为服务运行时，服务器会随电脑启动，即使没有人登录，也会保持 WhatsApp 连接和隧道运行。需要管理员权限。',
    enableService: '启用服务',
    start: '启动',
    stop: '停止',
    removeService: '移除服务',
    recentLog: '最近日志',
    notAnswering: '没有响应',
    modeLabel: {
      starting: '正在启动…',
      standalone: '独立运行（在此应用内）',
      client: '已连接到后台服务',
      error: '未运行',
    },
    serverModeLabel: {
      standalone: '独立运行',
      service: '后台服务',
      dev: '开发',
    },
    serverState: {
      starting: '正在启动',
      running: '运行中',
      crashed: '已崩溃',
      stopped: '已停止',
      external: '运行中（服务）',
    },
    svcLabel: {
      notInstalled: '未安装',
      stopped: '已停止',
      running: '运行中',
    },
    trayNote: {
      keep: '关闭窗口后，EzyChat Lite 会保留在系统托盘，方便快速访问和接收桌面通知。请从托盘菜单退出。',
      quit: '关闭窗口会退出应用。后台服务会继续运行收件箱。',
      host: '此应用正在运行服务器，因此在收件箱运行期间会一直保留在系统托盘。',
    },
    updates: {
      installed: '已安装：v{{version}}。',
      checking: '正在从 GitHub 检查更新…',
      available: 'v{{version}} 现已推出。',
      availablePreview: 'v{{version}} 现已推出（预览版）。',
      current: '已是最新版本 — v{{version}}。',
      checkFailed: '无法检查更新。请稍后再试。',
      downloading: '正在下载更新… {{percent}}%。收件箱可照常使用。',
      ready: 'v{{version}} 已下载并通过验证，可以更新。',
      installing: '正在准备重启并更新… 请批准系统提示以继续。',
      lastChecked: '上次检查：{{time}}',
      autoCheck: '此应用运行时会自动从 GitHub 检查更新。',
      noInstaller: '此版本没有适用于这台电脑的安装程序。请打开发布详情查看可用的下载。',
      managedHelp:
        '请先下载，然后在团队可以短暂暂停工作时选择“重启并更新”。应用及已安装的服务会自动重启。你的账号、聊天和设置都会保留。',
      unverifiable: '此版本无法在这里通过安装验证。请打开发布详情获取手动安装程序。',
      manualHelp:
        '请下载安装程序，并在安装前退出此应用。安装前先停止 Windows 服务，安装后再启动。在 Mac 上，请在安装前移除服务，安装后重新启用，以刷新受保护的应用副本。你的账号、聊天和设置都会保留。',
      openFailed: '无法打开更新。',
    },
  },
};

export const desktopCatalogs: Record<Locale, Catalog> = { en, ms, 'zh-CN': zhCN };

/** Mirrors SUPPORTED_LOCALES (code + Intl tag) from @wa-team-inbox/shared; checked by i18n.test.ts. */
export const DESKTOP_LOCALES = [
  { code: 'en', intlTag: 'en-GB' },
  { code: 'ms', intlTag: 'ms-MY' },
  { code: 'zh-CN', intlTag: 'zh-CN' },
] as const satisfies readonly { code: Locale; intlTag: string }[];

const DEFAULT_LOCALE: Locale = 'en';
const LANGUAGE_FALLBACK: Record<string, Locale> = { en: 'en', ms: 'ms', zh: 'zh-CN' };
const TRADITIONAL_CHINESE = /^zh-(hant|tw|hk|mo)\b/i;

/** Same rules as shared `resolveLocale`: first supported tag, language fallback, else English. */
export function resolveDesktopLocale(tags: readonly (string | null | undefined)[]): Locale {
  for (const raw of tags) {
    if (!raw) continue;
    const tag = raw.trim().replace(/_/g, '-');
    const exact = DESKTOP_LOCALES.find((l) => l.code.toLowerCase() === tag.toLowerCase());
    if (exact) return exact.code;
    if (TRADITIONAL_CHINESE.test(tag)) continue;
    const fallback = LANGUAGE_FALLBACK[tag.split('-')[0]!.toLowerCase()];
    if (fallback) return fallback;
  }
  return DEFAULT_LOCALE;
}

export function desktopIntlTag(locale: Locale): string {
  return DESKTOP_LOCALES.find((l) => l.code === locale)?.intlTag ?? 'en-GB';
}

/** The OS language of this machine (call after `app.whenReady()`). Pass Electron's `app`. */
export function desktopLocale(app: {
  getPreferredSystemLanguages(): string[];
  getLocale(): string;
}): Locale {
  let tags: string[] = [];
  try {
    tags = app.getPreferredSystemLanguages();
  } catch {
    // older platforms: fall back to the Chromium UI locale below
  }
  return resolveDesktopLocale([...tags, app.getLocale()]);
}

function lookup(catalog: Catalog | undefined, key: string): string | undefined {
  let node: string | Catalog | undefined = catalog;
  for (const part of key.split('.')) {
    if (node == null || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

/** Same behaviour as shared `createTranslator(en, desktopCatalogs)`: falls back to English, then the key. */
export const t: Translator<DesktopCatalog> = (locale, key, vars) =>
  interpolate(
    lookup(desktopCatalogs[locale ?? DEFAULT_LOCALE], key) ?? lookup(en, key) ?? key,
    vars,
  );

/** The status window's strings, flattened (`updates.installed` → text) for the status payload. */
export function statusStrings(locale: Locale): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: Catalog, prefix: string) => {
    for (const [k, v] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') out[path] = t(locale, `status.${path}` as DesktopKey);
      else walk(v, path);
    }
  };
  walk(en.status, '');
  return out;
}
