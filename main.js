import { app, BrowserWindow, session, ipcMain, BrowserView } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

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
      session: sess
    },
    titleBarStyle: 'hidden', // to create custom title bar
    titleBarOverlay: {
      color: '#4ade80', // light green to match design
      symbolColor: '#000000'
    }
  });

  // Decide if we are in dev or prod
  // For simplicity, we just load Vite's default dev server if running "npm run dev"
  // but if we are just running electron . we should load index.html
  mainWindow.loadFile('index.html');

  // mainWindow.webContents.openDevTools();
}

ipcMain.on('apply-settings', (event, settings) => {
  const sess = session.fromPartition('persist:leef-session');
  
  let acceptLang = 'en-US,en';
  if (settings.language === 'fr') acceptLang = 'fr-FR,fr,en;q=0.9';
  if (settings.language === 'es') acceptLang = 'es-ES,es,en;q=0.9';
  if (settings.language === 'it') acceptLang = 'it-IT,it,en;q=0.9';

  // Custom User Agent & Language
  const ua = settings.customUa || sess.getUserAgent().replace(/Electron\/[0-9.]+\s/g, '');
  sess.setUserAgent(ua, acceptLang);

  // Forcefully overwrite HTTP headers to guarantee language changes apply immediately to all web traffic
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Accept-Language'] = acceptLang;
    callback({ requestHeaders: details.requestHeaders });
  });

  // Proxy Settings
  if (settings.proxyUrl) {
    sess.setProxy({ proxyRules: settings.proxyUrl });
  } else {
    sess.setProxy({ proxyRules: 'direct://' });
  }
});

ipcMain.on('clear-data', async () => {
  const sess = session.fromPartition('persist:leef-session');
  await sess.clearStorageData();
  console.log('Session storage completely cleared.');
});

ipcMain.on('set-default-browser', () => {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
