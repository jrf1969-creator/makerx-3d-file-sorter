const { app, BrowserWindow, session, ipcMain, shell, dialog } = require('electron');
const path     = require('path');
const nodePath = require('path');
const https    = require('https');
const fs       = require('fs').promises;

const VERSION_URL = 'https://makerxdesigns.com/makerx-view-sort-app/version.json';

ipcMain.handle('open-external', (event, url) => shell.openExternal(url));
ipcMain.handle('get-version',   ()            => app.getVersion());
ipcMain.handle('move-file',   async (e, src, dest) => { await fs.copyFile(src, dest); await fs.unlink(src); });
ipcMain.handle('rename-file', async (e, oldPath, newPath) => { await fs.rename(oldPath, newPath); });
ipcMain.handle('delete-file', async (e, filePath)         => { await fs.unlink(filePath); });
ipcMain.handle('create-dir',  async (e, dirPath)          => { await fs.mkdir(dirPath, { recursive: true }); });
ipcMain.handle('read-file',   async (e, filePath)         => { return await fs.readFile(filePath); });

const AdmZip = require('adm-zip');

// Returns the file list inside a ZIP — only metadata, no binary transfer
ipcMain.handle('peek-zip', (e, filePath) => {
  const zip        = new AdmZip(filePath);
  const MODEL_EXTS = new Set(['stl','3mf','obj','step','stp']);
  const entries    = zip.getEntries().filter(en => !en.isDirectory);
  const depths     = entries
    .filter(en => MODEL_EXTS.has(en.entryName.split('.').pop().toLowerCase()))
    .map(en    => (en.entryName.match(/\//g) || []).length);
  const minDepth = depths.length ? Math.min(...depths) : 0;
  const contents = [];
  for (const en of entries) {
    if ((en.entryName.match(/\//g) || []).length !== minDepth) continue;
    contents.push({ path: en.entryName,
                    ext:  en.entryName.split('.').pop().toLowerCase(),
                    size: en.header.size });
  }
  const stat = require('fs').statSync(filePath);
  return { size: stat.size, contents };
});

// Extracts a single ZIP entry and returns its bytes to the renderer
ipcMain.handle('extract-zip-entry', (e, zipFilePath, entryPath) => {
  const zip   = new AdmZip(zipFilePath);
  const entry = zip.getEntry(entryPath);
  if (!entry) throw new Error('Entry not found in ZIP: ' + entryPath);
  return entry.getData(); // Buffer
});

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return (result.canceled || !result.filePaths.length) ? null : result.filePaths[0];
});

ipcMain.handle('scan-folder', async (e, dirPath) => {
  const SUPPORTED = new Set(['stl', '3mf', 'zip']);
  const files = [], dirs = [];
  try {
    for (const entry of await fs.readdir(dirPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        dirs.push({ name: entry.name, path: nodePath.join(dirPath, entry.name) });
      } else if (entry.isFile()) {
        const ext = entry.name.split('.').pop().toLowerCase();
        if (SUPPORTED.has(ext)) {
          const p = nodePath.join(dirPath, entry.name);
          const stat = await fs.stat(p);
          files.push({ name: entry.name, ext, path: p, size: stat.size });
        }
      }
    }
  } catch {}
  return { files, dirs };
});
ipcMain.handle('check-version', () => new Promise((resolve, reject) => {
  https.get(VERSION_URL + '?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } }, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
  }).on('error', reject);
}));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'MakerX 3D Viewer',
    backgroundColor: '#0a2a0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  // Auto-grant File System Access API permissions (read + write for rename/move/delete)
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (['fileSystem', 'clipboard-sanitized-write', 'media'].includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  win.loadFile('index.html');
  win.setMenu(null);

  // Ctrl+Shift+I opens DevTools for debugging
  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key === 'I') win.webContents.openDevTools({ mode: 'detach' });
  });

  win.on('page-title-updated', e => e.preventDefault());
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());
