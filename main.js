const { app, BrowserWindow, session, ipcMain, shell, dialog } = require('electron');
const path   = require('path');
const https  = require('https');
const fs     = require('fs').promises;
const AdmZip = require('adm-zip');

const VERSION_URL = 'https://makerxdesigns.com/makerx-view-sort-app/version.json';

ipcMain.handle('open-external', (event, url) => {
  // Only follow web links — never hand shell.openExternal an arbitrary protocol
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url);
});
ipcMain.handle('get-version',   ()            => app.getVersion());

// True when `dest` is an existing file *other than* `src`. Lets a Windows
// case-only rename through (same underlying file) while blocking a real overwrite.
async function wouldOverwrite(src, dest) {
  try { await fs.access(dest); } catch { return false; }   // destination is free
  try {
    const rs = path.resolve(await fs.realpath(src));
    const rd = path.resolve(await fs.realpath(dest));
    return rs !== rd;
  } catch { return true; }
}

ipcMain.handle('move-file', async (e, src, dest) => {
  if (await wouldOverwrite(src, dest)) {
    throw new Error('A file named "' + path.basename(dest) + '" already exists in the destination folder.');
  }
  try {
    await fs.rename(src, dest);             // fast + atomic on the same volume
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;    // cross-device move — copy then delete
    await fs.copyFile(src, dest);
    await fs.unlink(src);
  }
});
ipcMain.handle('rename-file', async (e, oldPath, newPath) => {
  if (await wouldOverwrite(oldPath, newPath)) {
    throw new Error('A file named "' + path.basename(newPath) + '" already exists here.');
  }
  await fs.rename(oldPath, newPath);
});
ipcMain.handle('delete-file', async (e, filePath)         => { await fs.unlink(filePath); });
ipcMain.handle('create-dir',  async (e, dirPath)          => { await fs.mkdir(dirPath, { recursive: true }); });
ipcMain.handle('read-file',   async (e, filePath)         => { return await fs.readFile(filePath); });

// Returns the bundled OpenCASCADE WASM binary so the renderer can init the
// STEP/STP engine. Read via Node fs because Chromium blocks fetch() of file://.
ipcMain.handle('read-occt-wasm', async () => {
  return await fs.readFile(path.join(__dirname, 'libs', 'occt-import-js.wasm'));
});

// Returns the file list inside a ZIP — only metadata, no binary transfer
ipcMain.handle('peek-zip', async (e, filePath) => {
  const zip        = new AdmZip(filePath);
  const MODEL_EXTS = new Set(['stl','3mf','obj','step','stp','gcode']);
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
  const stat = await fs.stat(filePath);
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
  const SUPPORTED = new Set(['stl', '3mf', 'zip', 'gcode', 'step', 'stp']);
  const files = [], dirs = [];
  try {
    for (const entry of await fs.readdir(dirPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        dirs.push({ name: entry.name, path: path.join(dirPath, entry.name) });
      } else if (entry.isFile()) {
        const ext = entry.name.split('.').pop().toLowerCase();
        if (SUPPORTED.has(ext)) {
          const p = path.join(dirPath, entry.name);
          const stat = await fs.stat(p);
          files.push({ name: entry.name, ext, path: p, size: stat.size });
        }
      }
    }
  } catch {}
  return { files, dirs };
});
ipcMain.handle('check-version', () => new Promise((resolve, reject) => {
  const req = https.get(VERSION_URL + '?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } }, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
  });
  req.on('error', reject);
  req.setTimeout(8000, () => req.destroy(new Error('Update check timed out.')));
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
