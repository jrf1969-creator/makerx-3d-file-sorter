const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal:     (url)                    => ipcRenderer.invoke('open-external', url),
  checkVersion:     ()                       => ipcRenderer.invoke('check-version'),
  getVersion:       ()                       => ipcRenderer.invoke('get-version'),
  openFolderDialog: ()                       => ipcRenderer.invoke('open-folder-dialog'),
  scanFolder:       (dirPath)               => ipcRenderer.invoke('scan-folder', dirPath),
  readFile:         (filePath)              => ipcRenderer.invoke('read-file', filePath),
  readOcctWasm:     ()                       => ipcRenderer.invoke('read-occt-wasm'),
  peekZip:          (filePath)              => ipcRenderer.invoke('peek-zip', filePath),
  extractZipEntry:  (zipPath, entryPath)    => ipcRenderer.invoke('extract-zip-entry', zipPath, entryPath),
  moveFile:         (src, dest, onConflict) => ipcRenderer.invoke('move-file', src, dest, onConflict),
  renameFile:       (old, nw)               => ipcRenderer.invoke('rename-file', old, nw),
  deleteFile:       (filePath)              => ipcRenderer.invoke('delete-file', filePath),
  createDir:        (dirPath)               => ipcRenderer.invoke('create-dir', dirPath),
});
