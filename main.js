import { app, BrowserWindow, session, ipcMain, Menu, MenuItem, clipboard, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import fetch from 'cross-fetch';

// SET IDENTITY AS EARLY AS POSSIBLE (Critical for Windows Taskbar)
app.name = 'Leef Browser';
if (process.platform === 'win32') {
  app.setAppUserModelId('com.quinn.leefbrowser');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fix "grayness" / color-shift on Windows — caused by GPU overlay planes
// using a different color pipeline than the rest of the compositor.
app.commandLine.appendSwitch('force-color-profile', 'srgb');
// Switch from D3D11 to OpenGL via ANGLE — fixes the color path mismatch
app.commandLine.appendSwitch('use-angle', 'gl');
// Disable overlay planes entirely so video goes through the same path as everything else
app.commandLine.appendSwitch('disable-features', 'DirectComposition,VideoToolboxVideoDecoder,UseSkiaRenderer');
app.commandLine.appendSwitch('disable-direct-composition');
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');

let mainWindow;
let blocker;

async function initAdBlocker(enabled = false) {
  if (!enabled) {
    if (blocker) blocker.disableBlockingInSession(session.fromPartition('persist:leef-session'));
    return;
  }

  const sess = session.fromPartition('persist:leef-session');
  const cachePath = path.join(app.getPath('userData'), 'adblock-engine.bin');

  try {
    // Attempt to load from local cache first (0 external calls)
    if (fs.existsSync(cachePath)) {
      blocker = await ElectronBlocker.deserialize(fs.readFileSync(cachePath));
      console.log('AdBlocker loaded from cache.');
    } else {
      // First run: Download and compile (Explicit external call)
      console.log('AdBlocker: Compiling engine (First run)...');
      if (mainWindow) mainWindow.webContents.send('adblock-status', 'syncing');
      blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
      fs.writeFileSync(cachePath, blocker.serialize());
      if (mainWindow) mainWindow.webContents.send('adblock-status', 'updated');
    }
    blocker.enableBlockingInSession(sess);
  } catch (err) {
    console.error('AdBlocker error:', err);
    if (mainWindow) mainWindow.webContents.send('adblock-status', 'error');
  }
}

async function checkForUpdates(manual = false) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const currentVersion = pkg.version;
    
    const response = await fetch('https://api.github.com/repos/git-QTech/leef/releases/latest', {
      headers: { 'User-Agent': 'Leef-Browser-Update-Checker' }
    });
    
    if (!response.ok) throw new Error('GitHub API reached limit or failed');
    
    const data = await response.json();
    const latestTag = data.tag_name; // e.g., "v0.1.6" or "Alpha"
    const latestVersion = latestTag.replace('v', ''); // for semver-ish comparison

    if (latestVersion !== currentVersion) {
      if (mainWindow) mainWindow.webContents.send('update-available', { 
        version: latestVersion, 
        tag: latestTag 
      });
    } else if (manual) {
      if (mainWindow) mainWindow.webContents.send('update-available', 'none');
    }
  } catch (err) {
    console.error('Update check failed:', err);
    if (manual && mainWindow) mainWindow.webContents.send('update-available', 'error');
  }
}

function createWindow() {
  // Use pure in-memory partition for privacy
  const sess = session.fromPartition('persist:leef-session');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      webSecurity: true,
      session: sess
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#5aef7e', // matches --topbar-bg in style.css exactly
      symbolColor: '#000000'
    },
    icon: nativeImage.createFromPath(path.join(__dirname, 'images/icon.png'))
  });

  // Decide if we are in dev or prod
  // For simplicity, we just load Vite's default dev server if running "npm run dev"
  // but if we are just running electron . we should load index.html
  mainWindow.loadFile('index.html');

  // Handle fullscreen requests from webviews (e.g. YouTube fullscreen button)
  // Using webContents events directly is the most reliable approach
  mainWindow.webContents.on('enter-html-full-screen', () => {
    mainWindow.setFullScreen(true);
  });
  mainWindow.webContents.on('leave-html-full-screen', () => {
    mainWindow.setFullScreen(false);
  });

  // mainWindow.webContents.openDevTools();
}

// Tracking domain lists
const AD_DOMAINS_STANDARD = [
  'doubleclick.net', 'google-analytics.com', 'googlesyndication.com',
  'facebook.net', 'analytics.twitter.com'
];
const AD_DOMAINS_STRICT = [
  ...AD_DOMAINS_STANDARD,
  'scorecardresearch.com', 'quantserve.com', 'taboola.com', 'outbrain.com',
  'adnxs.com', 'rubiconproject.com', 'openx.net', 'pubmatic.com',
  'criteo.com', 'amazon-adsystem.com', 'media.net', 'smartadserver.com',
  'hotjar.com', 'mouseflow.com', 'fullstory.com', 'mixpanel.com',
  'segment.com', 'heap.io', 'amplitude.com', 'intercom.io',
  'moatads.com', 'adsafeprotected.com', 'lijit.com', 'sovrn.com'
];

ipcMain.on('apply-settings', (event, settings) => {
  const sess = session.fromPartition('persist:leef-session');
  
  let acceptLang = 'en-US,en';
  if (settings.language === 'fr') acceptLang = 'fr-FR,fr,en;q=0.9';
  if (settings.language === 'es') acceptLang = 'es-ES,es,en;q=0.9';
  if (settings.language === 'it') acceptLang = 'it-IT,it,en;q=0.9';

  // Custom User Agent & Language
  const ua = settings.customUa || sess.getUserAgent().replace(/Electron\/[0-9.]+\s/g, '');
  sess.setUserAgent(ua, acceptLang);

  // Header Sanitization & Language — remove old handler first to prevent stacking
  sess.webRequest.onBeforeSendHeaders(null);
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Accept-Language'] = acceptLang;

    // Explicitly strip SafeSearch enforcement headers that can be injected by proxies/blockers
    delete details.requestHeaders['X-SafeSearch-Enforced'];
    delete details.requestHeaders['X-Google-SafeSearch'];
    delete details.requestHeaders['X-Youtube-Edu-Filter'];
    delete details.requestHeaders['YouTube-Restrict'];
    delete details.requestHeaders['Prefer-Safe-Smart-Search'];
    delete details.requestHeaders['Google-Safe-Search'];

    callback({ requestHeaders: details.requestHeaders });
  });

  // Ad & Tracker Blocking + HTTPS-Only upgrade — remove old handler first to prevent stacking
  const blockList = settings.tracking === 'strict' ? AD_DOMAINS_STRICT : AD_DOMAINS_STANDARD;
  sess.webRequest.onBeforeRequest(null);
  sess.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;

    // HTTPS-Only: upgrade http:// to https:// for main frame navigations
    if (settings.httpsOnly && url.startsWith('http://') && !url.startsWith('http://localhost')) {
      return callback({ redirectURL: url.replace(/^http:\/\//, 'https://') });
    }

    // Basic Ad / tracker blocking (Standard Tier)
    if (settings.adBlockerMode === 'basic' || settings.tracking === 'strict') {
      try {
        const host = new URL(url).hostname;
        if (blockList.some(domain => host.includes(domain))) {
          return callback({ cancel: true });
        }
      } catch (e) {}
    }

    // AI Overview Blocking & Region Independence (v0.1.5)
    try {
      const parsedUrl = new URL(url);
      const isSafeProtocol = parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
      
      if (isSafeProtocol && parsedUrl.hostname.includes('google.com') && parsedUrl.pathname.startsWith('/search')) {
        let changed = false;

        // 1. Force SafeSearch Off (Leef Labs: Region Independence)
        if (settings.labs?.force_safe_off) {
          if (parsedUrl.searchParams.get('safe') !== 'off') {
            parsedUrl.searchParams.set('safe', 'off');
            changed = true;
          }
        } else {
          // Standard: Strip active/strict if they were forced
          const safeVal = parsedUrl.searchParams.get('safe');
          if (safeVal === 'active' || safeVal === 'strict') {
            parsedUrl.searchParams.delete('safe');
            changed = true;
          }
        }

        // 2. AI Overview Blocking
        if (settings.blockAIOverview) {
          let query = parsedUrl.searchParams.get('q');
          if (query && !query.toLowerCase().includes('-noai')) {
            parsedUrl.searchParams.set('q', query + ' -noai');
            changed = true;
          }
        }

        if (changed) {
          return callback({ redirectURL: parsedUrl.toString() });
        }
      }
    } catch (e) {}

    callback({ cancel: false });
  });

  // Notification Permissions
  sess.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'notifications') {
      callback(settings.allowNotifications === true);
    } else {
      callback(true); // allow other permissions
    }
  });

  // Unified Download Manager (v0.1.5)
  sess.on('will-download', (event, item) => {
    const filename = item.getFilename();
    const totalBytes = item.getTotalBytes();
    
    if (settings.askDownload) {
      item.setSaveDialogOptions({
        title: 'Save File',
        defaultPath: filename,
        buttonLabel: 'Save'
      });
    }

    // Send initial "started" event
    if (mainWindow) {
      mainWindow.webContents.send('download-status', {
        id: item.getStartTime(),
        name: filename,
        status: 'started',
        total: totalBytes
      });
    }

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        if (mainWindow) mainWindow.webContents.send('download-status', { id: item.getStartTime(), status: 'interrupted' });
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          if (mainWindow) mainWindow.webContents.send('download-status', { id: item.getStartTime(), status: 'paused' });
        } else {
          if (mainWindow) {
            mainWindow.webContents.send('download-status', {
              id: item.getStartTime(),
              received: item.getReceivedBytes(),
              status: 'progressing'
            });
          }
        }
      }
    });

    item.once('done', (event, state) => {
      if (state === 'completed') {
        if (mainWindow) {
          mainWindow.webContents.send('download-status', {
            id: item.getStartTime(),
            status: 'completed',
            path: item.getSavePath()
          });
        }
      } else {
        if (mainWindow) mainWindow.webContents.send('download-status', { id: item.getStartTime(), status: 'failed' });
      }
    });
  });

  // Pro AdBlocker Toggle (Comprehensive Tier)
  initAdBlocker(settings.adBlockerMode === 'comprehensive');

  // Proxy Settings
  if (settings.proxyUrl) {
    sess.setProxy({ proxyRules: settings.proxyUrl });
  } else {
    sess.setProxy({ proxyRules: 'direct://' });
  }
});

ipcMain.on('manual-update-check', () => {
  checkForUpdates(true);
});

ipcMain.on('refresh-adblock', () => {
  const cachePath = path.join(app.getPath('userData'), 'adblock-engine.bin');
  if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  initAdBlocker(true);
});

ipcMain.on('show-context-menu', (event, params) => {
  const menu = new Menu();

  // Navigation Group
  menu.append(new MenuItem({
    label: 'Back',
    enabled: params.editFlags.canGoBack || params.canGoBack,
    click: () => event.sender.send('context-menu-command', { command: 'go-back' })
  }));
  menu.append(new MenuItem({
    label: 'Forward',
    enabled: params.editFlags.canGoForward || params.canGoForward,
    click: () => event.sender.send('context-menu-command', { command: 'go-forward' })
  }));
  menu.append(new MenuItem({
    label: 'Reload',
    click: () => event.sender.send('context-menu-command', { command: 'reload' })
  }));
  menu.append(new MenuItem({ type: 'separator' }));

  // Link actions
  if (params.linkURL) {
    menu.append(new MenuItem({
      label: 'Open Link in New Tab',
      click: () => event.sender.send('context-menu-command', { command: 'create-tab', url: params.linkURL })
    }));
    menu.append(new MenuItem({
      label: 'Copy Link Address',
      click: () => clipboard.writeText(params.linkURL)
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // Image actions
  if (params.hasImageContents || params.mediaType === 'image') {
    menu.append(new MenuItem({
      label: 'Open Image in New Tab',
      click: () => event.sender.send('context-menu-command', { command: 'create-tab', url: params.srcURL })
    }));
    menu.append(new MenuItem({
      label: 'Copy Image',
      click: () => event.sender.send('context-menu-command', { command: 'copy-image', x: params.x, y: params.y })
    }));
    menu.append(new MenuItem({
      label: 'Copy Image Address',
      click: () => clipboard.writeText(params.srcURL)
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // Text selection actions
  if (params.selectionText) {
    const cleanText = params.selectionText.trim();
    const displaySelection = cleanText.length > 15 ? cleanText.substring(0, 15) + '...' : cleanText;
    
    menu.append(new MenuItem({
      label: `Search Google for "${displaySelection}"`,
      click: () => event.sender.send('context-menu-command', { command: 'search-google', text: cleanText })
    }));
    menu.append(new MenuItem({ type: 'separator' }));
    
    menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
    menu.append(new MenuItem({
      label: 'Raw Copy (No formatting)',
      click: () => clipboard.writeText(cleanText)
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // Input actions (if editable)
  if (params.isEditable) {
    menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
    menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
    menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // Page Global Actions
  if (!params.selectionText && !params.linkURL && !params.mediaType) {
    menu.append(new MenuItem({
      label: 'Save Page As...',
      click: () => event.sender.send('context-menu-command', { command: 'save-page' })
    }));
    menu.append(new MenuItem({
      label: 'Print...',
      click: () => event.sender.send('context-menu-command', { command: 'print' })
    }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({
      label: 'View Page Source',
      click: () => event.sender.send('context-menu-command', { command: 'view-source' })
    }));
  }

  menu.append(new MenuItem({
    label: 'Inspect Element',
    click: () => {
      event.sender.inspectElement(params.x, params.y);
      if (event.sender.isDevToolsOpened()) {
        event.sender.devToolsWebContents.focus();
      }
    }
  }));

  const win = BrowserWindow.fromWebContents(event.sender);
  menu.popup({ window: win });
});

ipcMain.on('show-item-in-folder', (event, path) => {
  if (path) require('electron').shell.showItemInFolder(path);
});

ipcMain.on('manual-update-check', () => {
  checkForUpdates(true);
});

ipcMain.on('clear-data', async () => {
  const sess = session.fromPartition('persist:leef-session');
  await sess.clearStorageData();
  await sess.clearCache();
});

ipcMain.on('set-default-browser', () => {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
});

app.on('web-contents-created', (event, contents) => {
  const handleWindowOpen = ({ url, features, disposition }) => {
    // 1. Detect if this is a legitimate popup (typical for Login/OAuth)
    // - Features present (width/height defined by site)
    // - Specific identity provider domains
    const isPopup = (features && features.length > 0);
    const isAuth = url.includes('accounts.google.com') || 
                   url.includes('facebook.com/dialog/oauth') || 
                   url.includes('github.com/login/oauth') ||
                   url.includes('auth.services.adobe.com');

    if (isPopup || isAuth) {
      console.log('Allowing themed popup for:', url);
      return { 
        action: 'allow',
        overrideBrowserWindowOptions: {
          backgroundColor: '#1c1c1c',
          icon: path.join(__dirname, 'images/icon.png')
          // Note: titleBarOverlay doesn't apply to native popups easily, 
          // but we can set the background to match.
        }
      };
    }

    // 2. Default: Treat as a standard link and open in a Leef Tab
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('open-new-tab', url);
    }
    return { action: 'deny' };
  };

  contents.setWindowOpenHandler(handleWindowOpen);

  // Explicitly enforce tab redirection on Webviews (Electron 30+ strict requirement)
  contents.on('did-attach-webview', (e, webContents) => {
    webContents.setWindowOpenHandler(handleWindowOpen);
  });
});

app.whenReady().then(async () => {
  createWindow();

  // Load initial adblocker if enabled in local storage (simplified for main process)
  // We'll wait for the renderer to apply-settings on boot, but we can check for updates
  setTimeout(() => {
    // Short delay to ensure mainWindow exists
    checkForUpdates(); // Auto-check on startup (defualt behavior)
  }, 3000);

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
