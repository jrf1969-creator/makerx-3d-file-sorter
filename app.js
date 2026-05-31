// ── UPDATE CHECK ──────────────────────────────────────────────────────────────
const DOWNLOAD_PAGE = 'https://makerxdesigns.com/utilities/3d-file-sorter.html';

function semverNewer(remote, local) {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

async function checkForUpdates() {
  if (!window.electronAPI) return;
  const btn   = document.getElementById('updateBtn');
  const label = document.getElementById('updateBtnLabel');
  btn.disabled = true;
  label.textContent = 'Checking…';

  try {
    const [remote, local] = await Promise.all([
      window.electronAPI.checkVersion(),
      window.electronAPI.getVersion(),
    ]);

    if (semverNewer(remote.version, local)) {
      label.textContent = '↓ Update Available';
      btn.classList.add('active');
      btn.disabled = false;
      btn.onclick = () => window.electronAPI.openExternal(remote.downloadUrl || DOWNLOAD_PAGE);
    } else {
      label.textContent = '✓ Up to Date';
      btn.classList.add('active');
      setTimeout(() => {
        label.textContent = 'Check for Updates';
        btn.classList.remove('active');
        btn.disabled = false;
        btn.onclick = checkForUpdates;
      }, 3000);
    }
  } catch {
    label.textContent = 'Check Failed';
    setTimeout(() => {
      label.textContent = 'Check for Updates';
      btn.disabled = false;
    }, 3000);
  }
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let allFiles = [];        // {name, ext, size, file, zipParent?, zipName?}
let currentFolderName = '';
let scene, camera, renderer;
let mouse = { down: false, x: 0, y: 0, button: 0 };
let camTheta = 0.6, camPhi = 1.1, camRadius = 3;
let camTarget = new THREE.Vector3(0, 0, 0);
let wireframe = false;
let currentMesh = null;

// ── AUTO-ROTATE STATE ──────────────────────────────────────────────────────────
let autoRotate       = true;   // on by default
let autoRotateTimer  = null;   // setTimeout handle for view dwell
let autoRotateTween  = null;   // rAF handle for smooth transition
const AUTO_DWELL_MS  = 1500;   // pause per face (ms)
const AUTO_TWEEN_MS  = 800;    // transition duration (ms)

// Named views: [theta, phi]  (spherical coords, phi from top)
const AUTO_VIEWS = [
  { name: 'Front',      theta: 0,               phi: Math.PI / 2 },
  { name: 'Right',      theta: Math.PI / 2,     phi: Math.PI / 2 },
  { name: 'Top',        theta: 0,               phi: 0.05        },
  { name: 'Isometric',  theta: Math.PI / 4,     phi: Math.PI / 4 },
];
let autoViewIndex = 0;

const COLORS = [
  { hex: '#3ec63e', label: 'MakerX Green' },
  { hex: '#56ff56', label: 'Neon' },
  { hex: '#e8f0e8', label: 'White' },
  { hex: '#8aaa8a', label: 'Grey' },
  { hex: '#4f9eff', label: 'Blue' },
  { hex: '#f59e0b', label: 'Amber' },
  { hex: '#f87171', label: 'Red' },
];
let currentColor = COLORS[0].hex;
let rootDirHandle   = null;   // FSA root directory handle
let rootDirPath     = null;   // actual file system path (Electron only)
let knownSubfolders = [];     // [{ name, handle }] direct subfolders of root
const selectedFiles = new Set();


// ── THREE.JS INIT ──────────────────────────────────────────────────────────────
function initThree() {
  const wrap = document.getElementById('viewerWrap');
  const canvas = document.getElementById('canvas3d');
  const W = wrap.clientWidth, H = wrap.clientHeight;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 1000);
  updateCameraPos();

  // Lights
  const amb = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(amb);
  const dir1 = new THREE.DirectionalLight(0xffffff, 0.9);
  dir1.position.set(5, 10, 7);
  dir1.castShadow = true;
  scene.add(dir1);
  const dir2 = new THREE.DirectionalLight(0x8899ff, 0.3);
  dir2.position.set(-5, -3, -5);
  scene.add(dir2);
  const hemi = new THREE.HemisphereLight(0x334466, 0x221122, 0.4);
  scene.add(hemi);

  // Grid
  const grid = new THREE.GridHelper(20, 40, 0x333333, 0x222222);
  grid.position.y = -0.01;
  scene.add(grid);

  window.addEventListener('resize', onResize);
  setupMouse();
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

function onResize() {
  const wrap = document.getElementById('viewerWrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return;
  renderer.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}

function updateCameraPos() {
  const x = camRadius * Math.sin(camPhi) * Math.sin(camTheta);
  const y = camRadius * Math.cos(camPhi);
  const z = camRadius * Math.sin(camPhi) * Math.cos(camTheta);
  camera.position.set(
    camTarget.x + x,
    camTarget.y + y,
    camTarget.z + z
  );
  camera.lookAt(camTarget);
}

function setupMouse() {
  const canvas = document.getElementById('canvas3d');
  canvas.addEventListener('mousedown', e => {
    mouse.down = true;
    mouse.x = e.clientX; mouse.y = e.clientY;
    mouse.button = e.button;
    // Cancel auto-rotate the moment the user grabs the model
    if (autoRotate) stopAutoRotate();
  });
  window.addEventListener('mouseup', () => mouse.down = false);
  window.addEventListener('mousemove', e => {
    if (!mouse.down) return;
    const dx = e.clientX - mouse.x;
    const dy = e.clientY - mouse.y;
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (mouse.button === 2 || e.shiftKey) {
      // Pan
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      right.crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up).normalize();
      up.copy(camera.up).normalize();
      const panSpeed = camRadius * 0.001;
      camTarget.addScaledVector(right, -dx * panSpeed);
      camTarget.addScaledVector(up, dy * panSpeed);
    } else {
      camTheta -= dx * 0.008;
      camPhi = Math.max(0.05, Math.min(Math.PI - 0.05, camPhi + dy * 0.008));
    }
    updateCameraPos();
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    camRadius = Math.max(0.2, camRadius * (1 + e.deltaY * 0.001));
    updateCameraPos();
  }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

function resetCamera() {
  camTheta = 0.6; camPhi = 1.1; camRadius = 3;
  camTarget.set(0, 0, 0);
  updateCameraPos();
}

// ── AUTO-ROTATE ────────────────────────────────────────────────────────────────
function toggleAutoRotate() {
  if (autoRotate) stopAutoRotate();
  else            startAutoRotate();
}

function startAutoRotate() {
  autoRotate = true;
  document.getElementById('btnAutoRotate').classList.add('active');
  scheduleNextView();
}

function stopAutoRotate() {
  autoRotate = false;
  document.getElementById('btnAutoRotate').classList.remove('active');
  if (autoRotateTimer)  { clearTimeout(autoRotateTimer);      autoRotateTimer = null; }
  if (autoRotateTween)  { cancelAnimationFrame(autoRotateTween); autoRotateTween = null; }
}

function scheduleNextView() {
  if (!autoRotate) return;
  autoRotateTimer = setTimeout(() => {
    autoViewIndex = (autoViewIndex + 1) % AUTO_VIEWS.length;
    tweenToView(AUTO_VIEWS[autoViewIndex], AUTO_TWEEN_MS, () => scheduleNextView());
  }, AUTO_DWELL_MS);
}

// Smooth spherical tween to a target view, then call onDone
function tweenToView(view, duration, onDone) {
  if (!autoRotate) return;
  const startTheta  = camTheta;
  const startPhi    = camPhi;
  // Always take the shortest angular path for theta
  let dTheta = view.theta - startTheta;
  while (dTheta >  Math.PI) dTheta -= 2 * Math.PI;
  while (dTheta < -Math.PI) dTheta += 2 * Math.PI;
  const endTheta = startTheta + dTheta;
  const endPhi   = view.phi;
  const t0 = performance.now();

  function step(now) {
    if (!autoRotate) return;
    const raw = Math.min((now - t0) / duration, 1);
    // Ease in-out cubic
    const t = raw < 0.5 ? 4*raw*raw*raw : 1 - Math.pow(-2*raw+2,3)/2;
    camTheta = startTheta + (endTheta - startTheta) * t;
    camPhi   = startPhi   + (endPhi   - startPhi)   * t;
    updateCameraPos();
    if (raw < 1) {
      autoRotateTween = requestAnimationFrame(step);
    } else {
      autoRotateTween = null;
      if (onDone) onDone();
    }
  }
  autoRotateTween = requestAnimationFrame(step);
}

// ── FOLDER OPEN ────────────────────────────────────────────────────────────────
const SUPPORTED = ['stl','3mf','zip'];

async function openFolder() {
  // Electron: use native dialog — gives real file system path directly
  if (window.electronAPI?.openFolderDialog) {
    const dirPath = await window.electronAPI.openFolderDialog();
    if (dirPath) await loadFromDirectoryPath(dirPath);
    return;
  }
  // Browser: File System Access API
  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await loadFromDirectoryHandle(dirHandle);
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  document.getElementById('folderInput').click();
}

// ── ELECTRON FOLDER PATH ────────────────────────────────────────────────────
async function loadFromDirectoryPath(dirPath) {
  allFiles = [];
  rootDirPath     = dirPath;
  rootDirHandle   = null;
  knownSubfolders = [];
  currentFolderName = dirPath.split(/[/\\]/).pop();

  const list = document.getElementById('fileList');
  list.innerHTML = '';
  list.dataset.rendered = '0';
  document.getElementById('searchWrap').style.display = 'none';
  showScanBar('Scanning…');

  const { files, dirs } = await window.electronAPI.scanFolder(dirPath);

  knownSubfolders = dirs.map(d => ({ name: d.name, handle: null }));

  for (const f of files) {
    allFiles.push({ name: f.name, ext: f.ext, size: f.size,
                    path: f.name, electronPath: f.path,
                    fsHandle: null, parentHandle: null, file: null });
  }

  hideScanBar();

  // Use buildFileRow so context menu + drag listeners are attached
  list.innerHTML = '';
  if (!allFiles.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📁</div><p>No supported files found.</p></div>';
  } else {
    for (const item of allFiles) list.appendChild(buildFileRow(item));
    document.getElementById('fileCount').textContent = allFiles.length + ' files';
    document.getElementById('searchWrap').style.display = '';
  }

  updateStats();
  idbPut('lastFolderPath', dirPath);
  document.getElementById('trashZone').style.display = 'flex';

  // Peek ZIPs sequentially to avoid IPC memory pressure with 30+ files
  (async () => {
    for (const item of allFiles.filter(f => f.ext === 'zip')) {
      await peekZipElectron(item);
    }
  })();
}

// ── Inject (or replace) the zip-children block for an already-rendered row ──
function injectZipChildren(item) {
  const rowId = 'row_' + CSS.escape(item.path || item.name);
  const existingRow = document.getElementById(rowId);
  if (!existingRow) return;

  const meta = existingRow.querySelector('.file-meta');
  if (meta) meta.textContent = formatSize(item.size);

  const oldBlock = document.getElementById('zip_' + item.name);
  if (oldBlock) oldBlock.remove();

  if (!item.zipContents?.length) return;

  const children = document.createElement('div');
  children.className = 'zip-children';
  children.id = 'zip_' + item.name;

  for (const child of item.zipContents) {
    const isPreviewable = ['stl','3mf'].includes(child.ext);
    const cRow = document.createElement('div');
    cRow.className = 'zip-child';
    const cIconClass = child.ext === 'stl' ? 'icon-stl' : child.ext === '3mf' ? 'icon-3mf' : 'icon-other';
    cRow.innerHTML = `
      <div class="icon ${cIconClass}" style="width:22px;height:22px;font-size:9px;border-radius:3px">${child.ext.toUpperCase()}</div>
      <div class="file-info">
        <div class="file-name" title="${child.path}">${child.path.split('/').pop()}</div>
        <div class="file-meta">${child.path.includes('/') ? child.path.split('/').slice(0,-1).join('/') + ' · ' : ''}${formatSize(child.size)}</div>
      </div>
    `;
    if (isPreviewable) {
      cRow.style.cursor = 'pointer';
      cRow.addEventListener('click', () => loadZipChild(child, item));
    } else {
      cRow.style.cursor = 'default';
      cRow.style.opacity = '0.5';
    }
    children.appendChild(cRow);
  }
  existingRow.insertAdjacentElement('afterend', children);
}

const _zipPeekInProgress = new Set();

async function peekZipElectron(item) {
  if (_zipPeekInProgress.has(item.name)) return;
  _zipPeekInProgress.add(item.name);
  try {
    // All ZIP parsing happens in the main process — only metadata is returned
    const result = await window.electronAPI.peekZip(item.electronPath);
    if (!result) return;
    item.size = result.size;
    item.zipContents = result.contents.map(c => ({
      path: c.path,
      ext:  c.ext,
      size: c.size,
      zipEntry: null,            // no JSZip entry — we'll extract via IPC on demand
      electronZipPath: item.electronPath
    }));
    injectZipChildren(item);
  } catch (err) {
    console.error('ZIP peek failed for', item.name, err);
  } finally {
    _zipPeekInProgress.delete(item.name);
  }
}

// ── File System Access API path ─────────────────────────────────────────────
async function loadFromDirectoryHandle(dirHandle) {
  allFiles = [];
  rootDirHandle   = dirHandle;
  rootDirPath     = null;
  knownSubfolders = [];
  currentFolderName = dirHandle.name || '';
  idbPut('lastFolder', dirHandle);
  document.getElementById('fileList').innerHTML = '';
  document.getElementById('searchWrap').style.display = 'none';
  showScanBar('Scanning…');

  let scanned     = 0;
  let found       = 0;
  let renderPending = false;

  // ── Sidebar row builder (shared by flush and zip-peek update) ────────────────
  function buildRow(item) { return buildFileRow(item); }

  // ── Append only newly-discovered items to the sidebar ────────────────────────
  function flushNewItems() {
    renderPending = false;
    const list = document.getElementById('fileList');
    const placeholder = list.querySelector('.empty-state');
    if (placeholder) placeholder.remove();

    const alreadyRendered = parseInt(list.dataset.rendered || '0', 10);
    for (const item of allFiles.slice(alreadyRendered)) {
      list.appendChild(buildRow(item));
    }
    list.dataset.rendered = allFiles.length;
    document.getElementById('fileCount').textContent = allFiles.length + ' files';
    document.getElementById('searchWrap').style.display = allFiles.length ? '' : 'none';
  }

  function scheduleFlush() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(flushNewItems);
  }

  // ── ZIP peek: read one zip, attach children, update its sidebar row ──────────
  async function peekZip(item) {
    try {
      const file = await item.fsHandle.getFile();
      item.size = file.size;
      item.file = file;
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);

      // Collect all non-dir entries
      const allEntries = Object.entries(zip.files).filter(([, e]) => !e.dir);

      // Find the minimum folder depth among 3D files so we handle zips that
      // wrap everything in a single top-level folder (e.g. ModelName/file.stl)
      const MODEL_EXTS = new Set(['stl','3mf','obj','step','stp']);
      const depths = allEntries
        .filter(([p]) => MODEL_EXTS.has(p.split('.').pop().toLowerCase()))
        .map(([p]) => (p.match(/\//g) || []).length);
      const minDepth = depths.length ? Math.min(...depths) : 0;

      // Accept files that are AT minDepth (i.e. not nested deeper than the shallowest model)
      item.zipContents = [];
      for (const [path, entry] of allEntries) {
        const depth = (path.match(/\//g) || []).length;
        if (depth !== minDepth) continue;
        const childExt = path.split('.').pop().toLowerCase();
        item.zipContents.push({ path, ext: childExt, size: entry._data?.uncompressedSize || 0, zipEntry: entry });
      }
      // Inject children into the DOM next to the existing row
      injectZipChildren(item);
    } catch {}
  }

  // ── ZIP peek queue: drains concurrently (up to 3 at a time) without blocking scan ──
  const zipQueue = [];
  let zipWorkersActive = 0;
  const ZIP_CONCURRENCY = 3;

  async function zipWorker() {
    zipWorkersActive++;
    while (zipQueue.length > 0) {
      const item = zipQueue.shift();
      await peekZip(item);
      // Small yield between zips so scan/render can interleave
      await new Promise(r => setTimeout(r, 0));
    }
    zipWorkersActive--;
  }

  function enqueueZip(item) {
    zipQueue.push(item);
    if (zipWorkersActive < ZIP_CONCURRENCY) zipWorker();
  }

  // ── Directory walk ────────────────────────────────────────────────────────────
  async function walkDir(handle, pathPrefix, depth) {
    for await (const [name, entry] of handle.entries()) {
      scanned++;
      if (entry.kind === 'directory') {
        if (depth === 0 && !knownSubfolders.find(f => f.name === name))
          knownSubfolders.push({ name, handle: entry });
        if (scanned % 200 === 0) {
          showScanBar(`Scanning… ${found} files found (${scanned} entries)`);
          await new Promise(r => setTimeout(r, 0));
        }
        // Recurse only to collect subfolder names for the move menu — don't add their files to the list
        if (depth === 0) await walkDir(entry, pathPrefix + name + '/', depth + 1);
      } else {
        // Only show files sitting directly in the root folder (not in subfolders)
        if (depth > 0) continue;
        const ext = name.split('.').pop().toLowerCase();
        if (SUPPORTED.includes(ext)) {
          const item = { name, ext, size: 0, fsHandle: entry, path: pathPrefix + name, parentHandle: handle };
          allFiles.push(item);
          found++;
          if (found % 50 === 0) scheduleFlush();
          if (ext === 'zip') enqueueZip(item);
        }
      }
    }
  }

  await walkDir(dirHandle, '', 0);

  // Final flush for any tail items
  flushNewItems();
  hideScanBar();
  updateStats();

  // Drain any remaining zip peeks that haven't finished yet
  // (they run concurrently so most will already be done)
  while (zipQueue.length > 0 || zipWorkersActive > 0) {
    await new Promise(r => setTimeout(r, 50));
  }
}

// Get a File object from an fsHandle item on demand
async function getFileForItem(item) {
  if (item.file) return item.file;
  if (item.electronPath && window.electronAPI?.readFile) {
    const bytes = await window.electronAPI.readFile(item.electronPath);
    const blob  = new Blob([bytes]);
    item.file   = new File([blob], item.name);
    item.size   = bytes.byteLength;
    return item.file;
  }
  if (item.fsHandle) {
    item.file = await item.fsHandle.getFile();
    item.size = item.file.size;
    return item.file;
  }
  return null;
}

// ── Legacy <input> fallback ──────────────────────────────────────────────────
document.getElementById('folderInput').addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  allFiles = [];
  showScanBar('Reading file list…');
  for (const f of files) {
    const name = f.name;
    const ext = name.split('.').pop().toLowerCase();
    if (SUPPORTED.includes(ext)) allFiles.push({ name, ext, size: f.size, file: f });
  }
  hideScanBar();
  for (const item of [...allFiles]) {
    if (item.ext === 'zip') {
      try {
        const buf = await item.file.arrayBuffer();
        const zip = await JSZip.loadAsync(buf);
        const allEntries = Object.entries(zip.files).filter(([, e]) => !e.dir);
        const MODEL_EXTS = new Set(['stl','3mf','obj','step','stp']);
        const depths = allEntries
          .filter(([p]) => MODEL_EXTS.has(p.split('.').pop().toLowerCase()))
          .map(([p]) => (p.match(/\//g) || []).length);
        const minDepth = depths.length ? Math.min(...depths) : 0;
        item.zipContents = [];
        for (const [path, entry] of allEntries) {
          const depth = (path.match(/\//g) || []).length;
          if (depth !== minDepth) continue;
          const childExt = path.split('.').pop().toLowerCase();
          item.zipContents.push({ path, ext: childExt, size: entry._data?.uncompressedSize || 0, zipEntry: entry });
        }
      } catch {}
    }
  }
  renderFileList();
  updateStats();
  e.target.value = '';
});

// ── Drag-and-drop a folder onto sidebar ─────────────────────────────────────
(function setupDrop() {
  const sidebar = document.getElementById('sidebarEl');
  sidebar.addEventListener('dragover', e => { e.preventDefault(); sidebar.classList.add('drag-over'); });
  sidebar.addEventListener('dragleave', e => { if (!sidebar.contains(e.relatedTarget)) sidebar.classList.remove('drag-over'); });
  sidebar.addEventListener('drop', async e => {
    e.preventDefault();
    sidebar.classList.remove('drag-over');
    const items = Array.from(e.dataTransfer.items);
    for (const item of items) {
      if (item.kind === 'file' && item.getAsFileSystemHandle) {
        const handle = await item.getAsFileSystemHandle();
        if (handle.kind === 'directory') { await loadFromDirectoryHandle(handle); return; }
      }
    }
    // Fallback: dropped individual files
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      allFiles = files
        .filter(f => SUPPORTED.includes(f.name.split('.').pop().toLowerCase()))
        .map(f => ({ name: f.name, ext: f.name.split('.').pop().toLowerCase(), size: f.size, file: f }));
      renderFileList(); updateStats();
    }
  });
})();

// ── Scan bar helpers ─────────────────────────────────────────────────────────
function showScanBar(msg) {
  let bar = document.getElementById('scanBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'scanBar';
    bar.className = 'scan-bar';
    const sidebar = document.getElementById('sidebarEl');
    sidebar.insertBefore(bar, document.getElementById('fileList'));
  }
  bar.innerHTML = `<div class="scan-dot"></div><span>${msg}</span>`;
  bar.style.display = 'flex';
}
function hideScanBar() {
  const bar = document.getElementById('scanBar');
  if (bar) bar.style.display = 'none';
}

// ── FILE LIST RENDER ───────────────────────────────────────────────────────────
function renderFileList() {
  const list      = document.getElementById('fileList');
  const supported = allFiles.filter(f => ['stl','3mf','zip'].includes(f.ext));
  list.innerHTML  = '';
  if (!supported.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><p>No supported files found.</p></div>';
    return;
  }
  document.getElementById('fileCount').textContent = supported.length + ' files';
  for (const item of supported) {
    list.appendChild(buildFileRow(item));
    if (item.ext === 'zip' && item.zipContents?.length) injectZipChildren(item);
  }
}

function toggleZip(e, name) {
  e && e.stopPropagation();
  let container = document.getElementById('zip_' + name);

  // If peek hasn't completed yet, trigger it on-demand then expand
  if (!container) {
    const fileItem = allFiles.find(f => f.name === name && f.ext === 'zip');
    if (fileItem && fileItem.electronPath) {
      peekZipElectron(fileItem).then(() => {
        const c = document.getElementById('zip_' + name);
        if (c) { c.classList.add('open'); _syncExpandBtn(name, true); }
      });
    }
    return;
  }

  container.classList.toggle('open');
  _syncExpandBtn(name, container.classList.contains('open'));
}

function _syncExpandBtn(name, open) {
  document.querySelectorAll('.file-item').forEach(el => {
    if (el.dataset.name === name) {
      const btn = el.querySelector('.expand-btn');
      if (btn) btn.classList.toggle('open', open);
    }
  });
}

function setActive(nameOrPath) {
  document.querySelectorAll('.file-item, .zip-child').forEach(el => el.classList.remove('active'));
  // Find by title
  document.querySelectorAll('[title]').forEach(el => {
    if (el.title === nameOrPath) {
      el.closest('.file-item, .zip-child')?.classList.add('active');
    }
  });
}

// ── UNSUPPORTED FILE HANDLER ──────────────────────────────────────────────────
function showUnsupported(item) {
  setActive(item.name);
  document.getElementById('noFile').style.display = 'none';
  document.getElementById('unsupportedPanel').classList.add('hidden');
  document.getElementById('infoPanel').classList.add('hidden');
  document.getElementById('controlsHint').style.display = 'none';
  document.getElementById('loadingOverlay').classList.add('hidden');
  const panel = document.getElementById('unsupportedPanel');
  panel.classList.remove('hidden');
  document.getElementById('unsupportedIconLabel').textContent = item.ext.toUpperCase();
  document.getElementById('viewerTitle').innerHTML =
    `${item.name} <span style="color:var(--text3);font-size:11px;margin-left:6px">· Not supported</span>`;
}

// ── LOAD FILES ─────────────────────────────────────────────────────────────────
async function loadFile(item) {
  setActive(item.name);
  showLoading('Loading ' + item.name + '...');
  try {
    const f = await getFileForItem(item);
    if (!f) throw new Error('Could not read file.');
    item.file = f;
    const buf = await f.arrayBuffer();
    if (item.ext === 'stl') {
      const geo = parseSTL(buf);
      displayGeometry(geo, item.name);
    } else if (item.ext === '3mf') {
      await parse3MF(buf, item.name);
    }
  } catch (err) {
    hideLoading();
    alert('Error loading file: ' + err.message);
  }
}

async function loadZipChild(child, zipItem) {
  const displayName = child.path.split('/').pop();
  setActive(child.path.split('/').pop());
  showLoading('Extracting ' + displayName + '...');
  try {
    let buf;
    if (child.zipEntry) {
      buf = await child.zipEntry.async('arraybuffer');
    } else if (child.electronZipPath && window.electronAPI?.extractZipEntry) {
      const bytes = await window.electronAPI.extractZipEntry(child.electronZipPath, child.path);
      buf = new Uint8Array(bytes).buffer;
    } else {
      throw new Error('No extraction method available for this file.');
    }
    if (child.ext === 'stl') {
      const geo = parseSTL(buf);
      displayGeometry(geo, displayName + ' (from ' + zipItem.name + ')');
    } else if (child.ext === '3mf') {
      await parse3MFBuffer(buf, displayName + ' (from ' + zipItem.name + ')');
    }
  } catch (err) {
    hideLoading();
    alert('Error: ' + err.message);
  }
}

// ── STL PARSER ─────────────────────────────────────────────────────────────────
function parseSTL(buffer) {
  const geo = new THREE.BufferGeometry();
  const view = new DataView(buffer);
  // Detect binary vs ASCII
  const isBinary = (() => {
    if (buffer.byteLength < 84) return false;
    const triCount = view.getUint32(80, true);
    const expectedSize = 84 + triCount * 50;
    if (expectedSize === buffer.byteLength) return true;
    const text = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(256, buffer.byteLength)));
    return !text.trimStart().startsWith('solid');
  })();

  let positions = [], normals = [];
  if (isBinary) {
    const triCount = view.getUint32(80, true);
    for (let i = 0; i < triCount; i++) {
      const off = 84 + i * 50;
      const nx = view.getFloat32(off, true);
      const ny = view.getFloat32(off+4, true);
      const nz = view.getFloat32(off+8, true);
      for (let v = 0; v < 3; v++) {
        const vOff = off + 12 + v * 12;
        positions.push(view.getFloat32(vOff, true), view.getFloat32(vOff+4, true), view.getFloat32(vOff+8, true));
        normals.push(nx, ny, nz);
      }
    }
  } else {
    const text = new TextDecoder().decode(buffer);
    const vertRe = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g;
    const normRe = /normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g;
    let vm, nm;
    const verts = [], norms = [];
    while ((vm = vertRe.exec(text))) verts.push([+vm[1], +vm[2], +vm[3]]);
    while ((nm = normRe.exec(text))) norms.push([+nm[1], +nm[2], +nm[3]]);
    for (let i = 0; i < verts.length; i++) {
      positions.push(...verts[i]);
      const ni = Math.floor(i / 3);
      normals.push(...(norms[ni] || [0, 0, 1]));
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.computeBoundingBox();
  return geo;
}

// ── 3MF PARSER ─────────────────────────────────────────────────────────────────
async function parse3MF(buffer, name) {
  await parse3MFBuffer(buffer, name);
}

async function parse3MFBuffer(buffer, name) {
  const zip = await JSZip.loadAsync(buffer);

  // Helper: normalize a path like "/3D/Objects/foo.model" → "3D/Objects/foo.model"
  function normPath(p) { return p ? p.replace(/^\/+/, '') : p; }

  // Helper: read XML from zip (returns document or null)
  async function readXml(path) {
    const entry = zip.files[normPath(path)];
    if (!entry) return null;
    const text = await entry.async('text');
    return new DOMParser().parseFromString(text, 'text/xml');
  }

  // Helper: extract all meshes from a parsed <model> document into a flat map {id → {verts, idxs}}
  function extractObjects(doc) {
    const map = {};
    for (const obj of doc.querySelectorAll('object')) {
      const id = obj.getAttribute('id');
      const meshEl = obj.querySelector('mesh');
      if (!meshEl) continue;
      const verts = [];
      for (const v of meshEl.querySelectorAll('vertices vertex')) {
        verts.push(+v.getAttribute('x'), +v.getAttribute('y'), +v.getAttribute('z'));
      }
      const idxs = [];
      for (const t of meshEl.querySelectorAll('triangles triangle')) {
        idxs.push(+t.getAttribute('v1'), +t.getAttribute('v2'), +t.getAttribute('v3'));
      }
      if (verts.length && idxs.length) map[id] = { verts, idxs };
    }
    return map;
  }

  // Step 1: find root model path via _rels/.rels
  let rootModelPath = '3D/3dmodel.model'; // sensible default
  const rootRels = await readXml('_rels/.rels');
  if (rootRels) {
    for (const rel of rootRels.querySelectorAll('Relationship')) {
      const type = rel.getAttribute('Type') || '';
      if (type.includes('3dmodel')) {
        rootModelPath = normPath(rel.getAttribute('Target'));
        break;
      }
    }
  }

  const rootDoc = await readXml(rootModelPath);
  if (!rootDoc) throw new Error('Could not read root model file.');

  // Step 2: find companion .rels for the root model (e.g. 3D/_rels/3dmodel.model.rels)
  // This tells us which external .model files exist
  const rootDir  = rootModelPath.includes('/') ? rootModelPath.split('/').slice(0,-1).join('/') : '';
  const rootFile = rootModelPath.split('/').pop();
  const companionRelsPath = (rootDir ? rootDir + '/' : '') + '_rels/' + rootFile + '.rels';
  const companionRels = await readXml(companionRelsPath);

  // Step 3: load all external object files referenced in companion rels
  // objectStores: path → {id → {verts,idxs}}
  const externalObjects = {}; // "3D/Objects/foo.model" → objectMap
  if (companionRels) {
    for (const rel of companionRels.querySelectorAll('Relationship')) {
      const extPath = normPath(rel.getAttribute('Target'));
      if (!extPath.endsWith('.model')) continue;
      const extDoc = await readXml(extPath);
      if (extDoc) externalObjects[extPath] = extractObjects(extDoc);
    }
  }

  // Also load any .model files referenced directly via p:path on <component> elements
  for (const comp of rootDoc.querySelectorAll('component')) {
    const ppath = normPath(comp.getAttribute('p:path') || comp.getAttributeNS('http://schemas.microsoft.com/3dmanufacturing/production/2015/06', 'path'));
    if (ppath && ppath.endsWith('.model') && !externalObjects[ppath]) {
      const extDoc = await readXml(ppath);
      if (extDoc) externalObjects[ppath] = extractObjects(extDoc);
    }
  }

  // Objects defined inline in the root model itself
  const inlineObjects = extractObjects(rootDoc);

  // Step 4: resolve object by (optional path, id)
  function resolveObject(ppath, id) {
    if (ppath) {
      const store = externalObjects[normPath(ppath)];
      return store ? store[id] : null;
    }
    return inlineObjects[id] || null;
  }

  // Step 5: recursively expand an object (may have <components> instead of / in addition to <mesh>)
  // Returns array of {verts, idxs, transform}
  function expandObject(objEl, docObjects, transform) {
    // If this object has a direct mesh — use it
    const meshEl = objEl.querySelector('mesh');
    if (meshEl) {
      const verts = [];
      for (const v of meshEl.querySelectorAll('vertices vertex'))
        verts.push(+v.getAttribute('x'), +v.getAttribute('y'), +v.getAttribute('z'));
      const idxs = [];
      for (const t of meshEl.querySelectorAll('triangles triangle'))
        idxs.push(+t.getAttribute('v1'), +t.getAttribute('v2'), +t.getAttribute('v3'));
      if (verts.length && idxs.length) return [{ verts, idxs, transform }];
    }
    return [];
  }

  // Step 6: walk <build> items
  const allPositions = [];
  const allIndices   = [];
  let vertOffset = 0;
  let objectCount = 0;

  function addMesh(verts, idxs, mat) {
    for (let i = 0; i < verts.length; i += 3) {
      let x = verts[i], y = verts[i+1], z = verts[i+2];
      if (mat) { const t = applyTMF(mat, x, y, z); x=t[0]; y=t[1]; z=t[2]; }
      allPositions.push(x, y, z);
    }
    for (const idx of idxs) allIndices.push(idx + vertOffset);
    vertOffset += verts.length / 3;
    objectCount++;
  }

  // Resolve a build item: objectid in root doc → find its components → resolve meshes
  function processBuildItem(objectid, buildTransform) {
    // Find the object element in root doc by id
    let objEl = null;
    for (const o of rootDoc.querySelectorAll('object')) {
      if (o.getAttribute('id') === objectid) { objEl = o; break; }
    }
    if (!objEl) return;

    // Does it have inline mesh?
    const meshEl = objEl.querySelector(':scope > mesh');
    if (meshEl) {
      const verts = [], idxs = [];
      for (const v of meshEl.querySelectorAll('vertices vertex'))
        verts.push(+v.getAttribute('x'), +v.getAttribute('y'), +v.getAttribute('z'));
      for (const t of meshEl.querySelectorAll('triangles triangle'))
        idxs.push(+t.getAttribute('v1'), +t.getAttribute('v2'), +t.getAttribute('v3'));
      if (verts.length && idxs.length) addMesh(verts, idxs, parseTMF(buildTransform));
      return;
    }

    // Has components → resolve each
    for (const comp of objEl.querySelectorAll(':scope > components > component')) {
      const compId   = comp.getAttribute('objectid');
      const ppath    = normPath(comp.getAttribute('p:path') ||
        comp.getAttributeNS('http://schemas.microsoft.com/3dmanufacturing/production/2015/06', 'path'));
      const compTxStr = comp.getAttribute('transform');
      const compTx   = parseTMF(compTxStr);
      const buildTx  = parseTMF(buildTransform);
      // Combined transform: buildTx * compTx
      const combinedTx = combineTMF(buildTx, compTx);

      const obj = resolveObject(ppath, compId);
      if (obj) addMesh(obj.verts, obj.idxs, combinedTx);
    }
  }

  const buildItems = rootDoc.querySelectorAll('build item');
  if (buildItems.length) {
    for (const item of buildItems) {
      const objectid = item.getAttribute('objectid');
      const tx = item.getAttribute('transform');
      processBuildItem(objectid, tx);
    }
  } else {
    // No build section — dump everything
    for (const [path, store] of Object.entries(externalObjects)) {
      for (const [id, obj] of Object.entries(store)) addMesh(obj.verts, obj.idxs, null);
    }
    for (const [id, obj] of Object.entries(inlineObjects)) addMesh(obj.verts, obj.idxs, null);
  }

  if (!allPositions.length) {
    const hasGcode = Object.keys(zip.files).some(f => f.toLowerCase().endsWith('.gcode'));
    const emptyBuild = rootDoc.querySelectorAll('build item').length === 0 &&
                       Object.keys(inlineObjects).length === 0 &&
                       Object.keys(externalObjects).length === 0;
    if (hasGcode && emptyBuild) {
      throw new Error(
        'This is a Bambu Studio sliced plate file.\n\n' +
        'It contains GCode and print settings but no 3D geometry — ' +
        'the source model was not embedded when it was saved.\n\n' +
        'Open the original STL or 3MF design file instead.'
      );
    }
    throw new Error('3MF contained no renderable geometry.');
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allPositions), 3));
  geo.setIndex(allIndices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  displayGeometry(geo, name, { objectCount });
}

// Parse a 3MF "a b c d e f g h i j k l" column-major 3×4 transform string
function parseTMF(s) {
  if (!s) return null;
  const n = s.trim().split(/\s+/).map(Number);
  return n.length >= 12 ? n : null;
}

// Apply column-major 3×4 transform [m0..m11] to point
function applyTMF(m, x, y, z) {
  return [
    m[0]*x + m[3]*y + m[6]*z + m[9],
    m[1]*x + m[4]*y + m[7]*z + m[10],
    m[2]*x + m[5]*y + m[8]*z + m[11]
  ];
}

// Combine two 3×4 column-major transforms: outer(inner(p))
// If either is null, return the other
function combineTMF(outer, inner) {
  if (!outer && !inner) return null;
  if (!outer) return inner;
  if (!inner) return outer;
  // Both are 12-element arrays [m0..m11] = 3 columns × 4 rows (but actually col-major 3x4)
  // Treat as 4x4 with last row [0,0,0,1]
  function m(a, r, c) {
    // a is stored col-major: a[col*3 + row] but the 3MF spec is row-major!
    // Actually 3MF transform is row-major: a b c / d e f / g h i / j k l
    // So a[0..2]=row0, a[3..5]=row1, a[6..8]=row2, a[9..11]=translation
    // For multiplication treat as 4x4
    if (r < 3 && c < 3) return a[r*3 + c];      // rotation part
    if (r < 3 && c === 3) return a[9 + r];       // translation
    return (r === c) ? 1 : 0;                    // last row [0,0,0,1]
  }
  const res = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += m(outer,r,k) * m(inner,k,c);
      res[r*3 + c] = sum;
    }
    let t = 0;
    for (let k = 0; k < 4; k++) t += m(outer,r,k) * m(inner,k,3);
    res[9 + r] = t;
  }
  return res;
}

// ── DISPLAY ────────────────────────────────────────────────────────────────────
function displayGeometry(geo, name, extra) {
  // Remove old model
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh.geometry.dispose();
    currentMesh.material.dispose();
    currentMesh = null;
  }

  // Center and scale
  const bb = geo.boundingBox;
  const center = new THREE.Vector3();
  bb.getCenter(center);
  const size = new THREE.Vector3();
  bb.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 2.0 / maxDim;

  geo.translate(-center.x, -center.y, -center.z);

  const mat = new THREE.MeshPhongMaterial({
    color: new THREE.Color(currentColor),
    specular: new THREE.Color(0x333333),
    shininess: 60,
    side: THREE.DoubleSide,
    wireframe: wireframe
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(scale, scale, scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  currentMesh = mesh;

  // Position grid under model
  const scaledSizeY = size.y * scale;
  scene.children.filter(c => c instanceof THREE.GridHelper).forEach(g => {
    g.position.y = -scaledSizeY / 2 - 0.05;
  });

  camRadius = 3; camTheta = 0.6; camPhi = 1.1;
  camTarget.set(0, 0, 0);
  updateCameraPos();
  // Always start auto-rotate from front view on each new model
  autoViewIndex = 0;
  stopAutoRotate();
  autoRotate = true;
  startAutoRotate();

  // Update UI
  document.getElementById('noFile').style.display = 'none';
  document.getElementById('unsupportedPanel').classList.add('hidden');
  document.getElementById('infoPanel').classList.remove('hidden');
  document.getElementById('controlsHint').style.display = 'block';
  document.getElementById('btnRotate')?.classList.add('active');
  document.getElementById('viewerTitle').innerHTML = `${name} <span>${formatSize(null, geo)}</span>`;
  document.getElementById('infoTris').textContent = (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3).toLocaleString();
  const objRow = document.getElementById('infoObjectsRow');
  if (extra?.objectCount > 1) {
    objRow.style.display = '';
    document.getElementById('infoObjects').textContent = extra.objectCount;
  } else {
    objRow.style.display = 'none';
  }
  document.getElementById('infoX').textContent = size.x.toFixed(1) + ' mm';
  document.getElementById('infoY').textContent = size.y.toFixed(1) + ' mm';
  document.getElementById('infoZ').textContent = size.z.toFixed(1) + ' mm';

  // Compute volume & surface area for estimates
  lastGeoVolumeMM3   = computeMeshVolumeMM3(geo);
  lastSurfaceAreaMM2 = computeSurfaceAreaMM2(geo);
  lastSize           = { x: size.x, y: size.y, z: size.z };

  const volCM3 = lastGeoVolumeMM3 / 1000;
  document.getElementById('infoVol').textContent =
    volCM3 < 1 ? lastGeoVolumeMM3.toFixed(0) + ' mm³'
               : volCM3.toFixed(2) + ' cm³';

  recalcEstimate();

  hideLoading();
  buildColorPicker();
}

// ── ESTIMATE PANEL ────────────────────────────────────────────────────────────
const MATERIALS = {
  pla:   { density: 1.24, name: 'PLA',   speedMult: 1.0  },
  petg:  { density: 1.27, name: 'PETG',  speedMult: 0.85 },
  abs:   { density: 1.04, name: 'ABS',   speedMult: 0.90 },
  asa:   { density: 1.07, name: 'ASA',   speedMult: 0.88 },
  tpu:   { density: 1.21, name: 'TPU',   speedMult: 0.45 },
  nylon: { density: 1.13, name: 'Nylon', speedMult: 0.80 },
};

let lastGeoVolumeMM3 = 0;  // raw solid volume in mm³ from mesh
let lastSize = { x: 0, y: 0, z: 0 };
let lastSurfaceAreaMM2 = 0;

// Signed-volume divergence theorem — accurate for watertight meshes
function computeMeshVolumeMM3(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  let vol = 0;
  const ax = new THREE.Vector3(), bx = new THREE.Vector3(), cx = new THREE.Vector3();
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let i = 0; i < triCount; i++) {
    const ia = idx ? idx.getX(i*3)   : i*3;
    const ib = idx ? idx.getX(i*3+1) : i*3+1;
    const ic = idx ? idx.getX(i*3+2) : i*3+2;
    ax.fromBufferAttribute(pos, ia);
    bx.fromBufferAttribute(pos, ib);
    cx.fromBufferAttribute(pos, ic);
    vol += ax.dot(bx.cross(cx)) / 6;
  }
  return Math.abs(vol);
}

// Surface area of all triangles in mm²
function computeSurfaceAreaMM2(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  let area = 0;
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();
  const ax = new THREE.Vector3(), bx = new THREE.Vector3(), cx = new THREE.Vector3();
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let i = 0; i < triCount; i++) {
    const ia = idx ? idx.getX(i*3)   : i*3;
    const ib = idx ? idx.getX(i*3+1) : i*3+1;
    const ic = idx ? idx.getX(i*3+2) : i*3+2;
    ax.fromBufferAttribute(pos, ia);
    bx.fromBufferAttribute(pos, ib);
    cx.fromBufferAttribute(pos, ic);
    ab.subVectors(bx, ax);
    ac.subVectors(cx, ax);
    cross.crossVectors(ab, ac);
    area += cross.length() / 2;
  }
  return area;
}

// ── COST TIERS ──────────────────────────────────────────────────────────────
// Per-material prices ($/kg): [budget, typical, premium]
const COST_TIERS = {
  pla:   { budget: 14, typical: 23, premium: 42 },
  petg:  { budget: 16, typical: 26, premium: 48 },
  abs:   { budget: 15, typical: 24, premium: 44 },
  asa:   { budget: 18, typical: 28, premium: 50 },
  tpu:   { budget: 22, typical: 35, premium: 65 },
  nylon: { budget: 25, typical: 40, premium: 75 },
};
let activeCostTier = 'typical';  // budget | typical | premium | custom

function setCostTier(tier) {
  activeCostTier = tier;
  // Highlight the right button
  ['budget','typical','premium'].forEach(t => {
    const btn = document.getElementById('tier' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.classList.toggle('active', t === tier);
  });
  // If a named tier was clicked, update the custom input to match
  if (tier !== 'custom') {
    const mat = document.getElementById('estMaterial').value;
    const price = COST_TIERS[mat]?.[tier] ?? 25;
    document.getElementById('costPerKg').value = price.toFixed(2);
  } else {
    // Custom typed — deactivate all tier buttons
    ['budget','typical','premium'].forEach(t => {
      const btn = document.getElementById('tier' + t.charAt(0).toUpperCase() + t.slice(1));
      if (btn) btn.classList.remove('active');
    });
  }
  recalcEstimate();
}

// When material changes, update the price field to match active tier
function syncCostToMaterial() {
  if (activeCostTier === 'custom') return;
  const mat   = document.getElementById('estMaterial').value;
  const price = COST_TIERS[mat]?.[activeCostTier] ?? 25;
  document.getElementById('costPerKg').value = price.toFixed(2);
}

function recalcEstimate() {
  if (!lastGeoVolumeMM3) return;

  const mat      = MATERIALS[document.getElementById('estMaterial').value];
  const infill   = parseInt(document.getElementById('estInfill').value) / 100;
  const layerH   = parseFloat(document.getElementById('estLayer').value);
  const walls    = parseInt(document.getElementById('estWalls').value);
  const speedMms = parseInt(document.getElementById('estSpeed').value);

  // Update range labels
  document.getElementById('estInfillVal').textContent = Math.round(infill * 100) + '%';
  document.getElementById('estWallsVal').textContent  = walls;
  document.getElementById('estSpeedVal').textContent  = speedMms + 'mm/s';

  // ── Volume model ──────────────────────────────────────────────────────────
  const nozzleD   = 0.4;
  const lineW     = nozzleD * 1.125;
  const shellThk  = walls * lineW;
  const wallVolMM3   = lastSurfaceAreaMM2 * shellThk * 0.5;
  const interiorVol  = Math.max(0, lastGeoVolumeMM3 - wallVolMM3);
  const infillVolMM3 = interiorVol * infill;
  const skinLayers   = 3;
  const bboxArea     = lastSize.x * lastSize.y;
  const skinVolMM3   = bboxArea * skinLayers * layerH * 2;
  const totalVolMM3  = wallVolMM3 + infillVolMM3 + skinVolMM3;

  // ── Filament length (1.75mm dia) ─────────────────────────────────────────
  const filamentR       = 0.875;
  const filamentAreaMM2 = Math.PI * filamentR * filamentR;
  const lengthMM  = totalVolMM3 / filamentAreaMM2;
  const lengthM   = lengthMM / 1000;

  // ── Weight ────────────────────────────────────────────────────────────────
  const weightG = (totalVolMM3 / 1000) * mat.density;

  // ── Print time ────────────────────────────────────────────────────────────
  const effectiveSpeedMms = speedMms * mat.speedMult * 0.65;
  const layers        = Math.ceil(lastSize.z / layerH);
  const layerOverheadS = layers * 1.5;
  const printTimeS    = (lengthMM / effectiveSpeedMms) + layerOverheadS;

  // ── Cost ──────────────────────────────────────────────────────────────────
  const pricePerKg = parseFloat(document.getElementById('costPerKg').value) || 25;
  const costUSD    = (weightG / 1000) * pricePerKg;

  // ── Display ───────────────────────────────────────────────────────────────
  // hero cards
  document.getElementById('estWeight').textContent      = weightG.toFixed(1) + ' g';
  document.getElementById('estFilamentSub').textContent = lengthM.toFixed(1) + ' m filament';
  document.getElementById('estTime').textContent        = formatPrintTime(printTimeS);
  document.getElementById('estLayerSub').textContent    = layers.toLocaleString() + ' layers';
  document.getElementById('estCost').textContent        = '$' + costUSD.toFixed(2);
  document.getElementById('estCostSub').textContent     = '$' + pricePerKg.toFixed(2) + ' / kg';
  // detail rows
  document.getElementById('estFilament').textContent =
    lengthM.toFixed(1) + ' m (' + (lengthMM / 25.4).toFixed(1) + ' in)';
}

function formatPrintTime(seconds) {
  if (seconds < 60) return Math.round(seconds) + 's';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return m + 'm';
  return h + 'h ' + m + 'm';
}

function toggleEstPanel() {
  document.getElementById('infoPanel').classList.toggle('collapsed');
}

function toggleSection(id) {
  document.getElementById(id).classList.toggle('closed');
}

function buildColorPicker() {
  const row = document.getElementById('colorRow');
  row.innerHTML = '<span style="font-size:11px;color:var(--text3);margin-right:3px">Color:</span>';
  for (const c of COLORS) {
    const dot = document.createElement('div');
    dot.className = 'color-dot' + (c.hex === currentColor ? ' active' : '');
    dot.style.background = c.hex;
    dot.title = c.label;
    dot.onclick = () => setModelColor(c.hex);
    row.appendChild(dot);
  }
}

function setModelColor(hex) {
  currentColor = hex;
  if (currentMesh) currentMesh.material.color.set(hex);
  document.querySelectorAll('.color-dot').forEach(d => {
    d.classList.toggle('active', d.style.background === hex || rgbToHex(d.style.background) === hex);
  });
}

function rgbToHex(rgb) {
  const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return rgb;
  return '#' + [m[1],m[2],m[3]].map(n => (+n).toString(16).padStart(2,'0')).join('');
}

function toggleWireframe() {
  wireframe = !wireframe;
  if (currentMesh) currentMesh.material.wireframe = wireframe;
  document.getElementById('btnWire').classList.toggle('active', wireframe);
}

function showLoading(msg) {
  document.getElementById('loadingMsg').textContent = msg || 'Loading...';
  document.getElementById('loadingOverlay').classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

function formatSize(bytes, geo) {
  if (geo) {
    const tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    return Math.round(tris).toLocaleString() + ' triangles';
  }
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function updateStats() {
  const stls = allFiles.filter(f => f.ext === 'stl').length;
  const tmfs = allFiles.filter(f => f.ext === '3mf').length;
  const zips = allFiles.filter(f => f.ext === 'zip').length;
  const bar = document.getElementById('statsBar');
  const folderPart = currentFolderName
    ? `<span style="color:var(--accent);margin-right:10px;font-family:'Rajdhani',sans-serif;font-weight:700;letter-spacing:0.08em">📁 ${currentFolderName}</span>`
    : '';
  bar.innerHTML = folderPart + `<b>${stls}</b> STL &nbsp; <b>${tmfs}</b> 3MF &nbsp; <b>${zips}</b> ZIP`;
  // Update sidebar heading too
  const sideHead = document.querySelector('.sidebar-head span:first-child');
  if (sideHead) sideHead.textContent = currentFolderName || 'Files';
  // Show search box and trash zone once files are loaded
  document.getElementById('searchWrap').style.display = allFiles.length ? '' : 'none';
  const tz = document.getElementById('trashZone');
  if (tz) tz.style.display = rootDirHandle ? 'flex' : 'none';
}

let filterTimer = null;
function filterFiles() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    document.querySelectorAll('.file-item').forEach(el => {
      const nm = (el.dataset.name || '').toLowerCase();
      el.style.display = (!q || nm.includes(q)) ? '' : 'none';
      // Also hide its zip children when parent is hidden
      const childEl = document.getElementById('zip_' + el.dataset.name);
      if (childEl && el.style.display === 'none') childEl.style.display = 'none';
    });
  }, 120);
}

// ── GLOBAL ROW BUILDER ────────────────────────────────────────────────────────
function buildFileRow(item) {
  const row = document.createElement('div');
  row.className = 'file-item';
  row.dataset.name = item.name;
  row.id = 'row_' + CSS.escape(item.path || item.name);
  const iconClass = item.ext === 'stl'  ? 'icon-stl'
                  : item.ext === '3mf'  ? 'icon-3mf'
                  : ['stp','step'].includes(item.ext) ? 'icon-step'
                  : 'icon-zip';
  row.innerHTML = `
    <input type="checkbox" class="file-item-check" title="Select">
    <div class="icon ${iconClass}">${item.ext.toUpperCase()}</div>
    <div class="file-info">
      <div class="file-name" title="${item.name}">${item.name}</div>
      <div class="file-meta">${item.path || ''}</div>
    </div>
    ${item.ext === 'zip' ? `<button class="expand-btn" onclick="toggleZip(event,'${item.name}')">▶</button>` : ''}
  `;
  const cb = row.querySelector('.file-item-check');
  cb.addEventListener('click', e => { e.stopPropagation(); toggleSelect(item, row, cb); });

  if (['stp','step'].includes(item.ext)) {
    row.addEventListener('click', () => showUnsupported(item));
  } else if (item.ext !== 'zip') {
    row.addEventListener('click', () => loadFile(item));
  } else {
    row.addEventListener('click', e => {
      if (!e.target.classList.contains('expand-btn')) toggleZip(e, item.name);
    });
  }
  row.addEventListener('contextmenu', e => showCtxMenu(e, item));

  // Drag-to-folder / drag-to-trash support
  if (item.fsHandle || item.electronPath) {
    row.draggable = true;
    row.addEventListener('dragstart', () => {
      draggingItem = item;
      showDragOverlay();
    });
    row.addEventListener('dragend', () => {
      draggingItem = null;
      hideDragOverlay();
    });
  }

  return row;
}

// ── CONTEXT MENU ──────────────────────────────────────────────────────────────
const SVG_RENAME    = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const SVG_FOLDER    = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>`;
const SVG_NEWFOLDER = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/><path d="M12 11v6M9 14h6"/></svg>`;
const SVG_TRASH     = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>`;

// ── Dragging item tracker ─────────────────────────────────────────────────────
let draggingItem = null;

function showDragOverlay() {
  const overlay = document.getElementById('folderDropOverlay');
  if (!overlay) return;
  overlay.innerHTML = '';

  // Measure footer + trash so overlay stops above them
  const foot  = document.querySelector('.mx-sidebar-foot');
  const trash = document.getElementById('trashZone');
  const reservedBottom = (foot?.offsetHeight || 0) + (trash?.offsetHeight || 0);
  overlay.style.bottom = reservedBottom + 'px';

  const label = document.createElement('div');
  label.className = 'folder-drop-label';
  label.textContent = 'Move to folder…';
  overlay.appendChild(label);

  // Sort folders alphabetically
  const sorted = [...knownSubfolders].sort((a, b) => a.name.localeCompare(b.name));
  for (const folder of sorted) {
    const target = document.createElement('div');
    target.className = 'folder-drop-target';
    target.innerHTML = `${SVG_FOLDER} ${folder.name}`;
    target.addEventListener('dragover',  e => { e.preventDefault(); target.classList.add('drag-over'); });
    target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
    target.addEventListener('drop', async e => {
      e.preventDefault();
      target.classList.remove('drag-over');
      const item = draggingItem;
      draggingItem = null;
      hideDragOverlay();
      if (item) await execMoveFile(item, folder.handle, folder.name);
    });
    overlay.appendChild(target);
  }

  overlay.classList.add('active');
  document.getElementById('trashZone').style.display = 'none'; // trash hidden while overlay is up
}

function hideDragOverlay() {
  const overlay = document.getElementById('folderDropOverlay');
  if (overlay) overlay.classList.remove('active');
  // Restore trash zone if a folder is loaded
  const tz = document.getElementById('trashZone');
  if (tz) tz.style.display = rootDirHandle ? 'flex' : 'none';
}

async function execDeleteFile(item) {
  try {
    if (item.electronPath) {
      await window.electronAPI.deleteFile(item.electronPath);
    } else {
      await item.parentHandle.removeEntry(item.name);
    }
    refreshFileRow(item, item.path);
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

// ── Wire up trash zone ────────────────────────────────────────────────────────
(function setupTrash() {
  const zone = document.getElementById('trashZone');

  // Click: if a file row is selected/active, delete it; otherwise no-op
  zone.addEventListener('click', () => {
    if (!draggingItem) return;
    const item = draggingItem;
    draggingItem = null;
    execDeleteFile(item);
  });

  // Drag-over from file rows
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (draggingItem) {
      const item = draggingItem;
      draggingItem = null;
      hideDragOverlay();
      execDeleteFile(item);
    }
  });
})();

function removeCtxMenu() {
  const m = document.getElementById('ctxMenu');
  if (m) m.remove();
}

function showCtxMenu(e, item) {
  e.preventDefault();
  e.stopPropagation();
  if (!rootDirHandle && !rootDirPath) return;
  removeCtxMenu();

  const menu = document.createElement('div');
  menu.id = 'ctxMenu';
  menu.className = 'ctx-menu';
  document.body.appendChild(menu);
  renderMainCtxMenu(menu, item);

  // Position (keep on screen)
  const W = window.innerWidth, H = window.innerHeight;
  let x = e.clientX, y = e.clientY;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  if (x + mw > W - 6) x = W - mw - 6;
  if (y + mh > H - 6) y = H - mh - 6;
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  setTimeout(() => {
    document.addEventListener('click',       removeCtxMenu, { once: true });
    document.addEventListener('contextmenu', removeCtxMenu, { once: true });
    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') { removeCtxMenu(); document.removeEventListener('keydown', esc); }
    });
  }, 0);
}

function renderMainCtxMenu(menu, item) {
  const itemFolder = item.path.includes('/') ? item.path.split('/')[0] : null;
  const moveable   = knownSubfolders.filter(f => f.name !== itemFolder);

  // Sort alphabetically
  const sorted = [...moveable].sort((a, b) => a.name.localeCompare(b.name));
  if (itemFolder) sorted.push({ name: '', _root: true }); // root goes at the end

  const totalFolders = sorted.length;

  // Max rows per column — drives how many columns we need
  const MAX_ROWS = 10;
  const rows = Math.min(totalFolders, MAX_ROWS);
  const cols = Math.ceil(totalFolders / rows);

  // ~160px per column
  menu.style.minWidth = Math.max(196, cols * 160) + 'px';

  // Re-order entries into row-major emission order so CSS grid (row-major)
  // renders them alphabetically top-to-bottom within each column.
  const ordered = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = c * rows + r;
      if (idx < totalFolders) ordered.push(sorted[idx]);
      else ordered.push(null); // empty cell to keep grid aligned
    }
  }

  let folderGridHtml = '';
  if (totalFolders > 0) {
    const itemsHtml = ordered.map(f => {
      if (!f) return `<div class="ctx-item" style="visibility:hidden;pointer-events:none"></div>`;
      if (f._root) return `<div class="ctx-item ctx-fld" data-folder="">${SVG_FOLDER} (root folder)</div>`;
      return `<div class="ctx-item ctx-fld" data-folder="${f.name}">${SVG_FOLDER} ${f.name}</div>`;
    }).join('');
    const moveLabel = selectedFiles.size > 1 && selectedFiles.has(item)
      ? `Move ${selectedFiles.size} files to folder`
      : 'Move to folder';
    folderGridHtml = `
      <div class="ctx-label" style="padding-top:7px">${moveLabel}</div>
      <div class="ctx-folder-grid cols-${cols}" style="--ctx-cols:${cols}">
        ${itemsHtml}
      </div>`;
  }

  const isBulk = selectedFiles.size > 1 && selectedFiles.has(item);
  const deleteLabel = isBulk ? `Delete ${selectedFiles.size} files` : 'Delete file';
  const html = `
    ${isBulk ? '' : `<div class="ctx-item" id="ctxRenameBtn">${SVG_RENAME} Rename</div>`}
    ${folderGridHtml}
    <div class="ctx-item" id="ctxNewFolderBtn">${SVG_NEWFOLDER} New folder…</div>
    <div class="ctx-divider"></div>
    <div class="ctx-item ctx-delete" id="ctxDeleteBtn" style="color:#c05050">${SVG_TRASH} ${deleteLabel}</div>`;
  menu.innerHTML = html;

  const renameBtn = document.getElementById('ctxRenameBtn');
  if (renameBtn) renameBtn.onclick = e => {
    e.stopPropagation();
    renderRenameCtxMenu(menu, item);
  };

  // If the right-clicked file is part of a multi-selection, bulk operations apply
  const bulkItems = selectedFiles.size > 1 && selectedFiles.has(item) ? [...selectedFiles] : null;

  menu.querySelectorAll('.ctx-fld').forEach(el => {
    el.onclick = async e => {
      e.stopPropagation();
      removeCtxMenu();
      const folderName   = el.dataset.folder;
      const targetHandle = folderName
        ? knownSubfolders.find(f => f.name === folderName)?.handle
        : rootDirHandle;
      if (bulkItems) {
        clearSelection();
        for (const f of bulkItems) await execMoveFile(f, targetHandle, folderName);
      } else {
        if (targetHandle || item.electronPath) await execMoveFile(item, targetHandle, folderName);
      }
    };
  });

  document.getElementById('ctxNewFolderBtn').onclick = e => {
    e.stopPropagation();
    renderNewFolderCtxMenu(menu, item);
  };

  document.getElementById('ctxDeleteBtn').onclick = async e => {
    e.stopPropagation();
    removeCtxMenu();
    if (bulkItems) {
      const n = bulkItems.length;
      if (!confirm(`Delete ${n} file${n > 1 ? 's' : ''}? This cannot be undone.`)) return;
      clearSelection();
      for (const f of bulkItems) await execDeleteFile(f);
    } else {
      execDeleteFile(item);
    }
  };
}

function renderRenameCtxMenu(menu, item) {
  const dotIdx  = item.name.lastIndexOf('.');
  const selEnd  = dotIdx > 0 ? dotIdx : item.name.length;
  menu.innerHTML = `
    <div class="ctx-label">Rename</div>
    <div class="ctx-input-wrap">
      <input class="ctx-input" id="ctxNameInput" value="${item.name}" spellcheck="false">
      <button class="ctx-ok"     id="ctxNameOk"     title="Confirm">✓</button>
      <button class="ctx-cancel" id="ctxNameCancel" title="Cancel">✕</button>
    </div>`;
  const inp = document.getElementById('ctxNameInput');
  inp.focus();
  inp.setSelectionRange(0, selEnd);

  const confirm = () => {
    const newName = inp.value.trim();
    if (newName && newName !== item.name) {
      removeCtxMenu();
      execRenameFile(item, newName);
    } else {
      removeCtxMenu();
    }
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.stopPropagation(); confirm(); }
    if (e.key === 'Escape') { e.stopPropagation(); removeCtxMenu(); }
  });
  inp.addEventListener('click', e => e.stopPropagation());
  document.getElementById('ctxNameOk').onclick     = e => { e.stopPropagation(); confirm(); };
  document.getElementById('ctxNameCancel').onclick = e => { e.stopPropagation(); removeCtxMenu(); };
}

function renderNewFolderCtxMenu(menu, item) {
  menu.innerHTML = `
    <div class="ctx-label">New folder name</div>
    <div class="ctx-input-wrap">
      <input class="ctx-input" id="ctxFolderInput" placeholder="folder-name" spellcheck="false">
      <button class="ctx-ok"     id="ctxFolderOk"     title="Create & move">✓</button>
      <button class="ctx-cancel" id="ctxFolderCancel" title="Cancel">✕</button>
    </div>`;
  const inp = document.getElementById('ctxFolderInput');
  inp.focus();

  const confirm = async () => {
    const folderName = inp.value.trim();
    if (!folderName) { removeCtxMenu(); return; }
    removeCtxMenu();
    try {
      let newHandle;
      if (rootDirPath && window.electronAPI?.createDir) {
        await window.electronAPI.createDir(rootDirPath + '\\' + folderName);
        newHandle = { name: folderName }; // placeholder — Electron uses paths, not handles
      } else {
        newHandle = await rootDirHandle.getDirectoryHandle(folderName, { create: true });
      }
      if (!knownSubfolders.find(f => f.name === folderName)) {
        knownSubfolders.push({ name: folderName, handle: newHandle });
        knownSubfolders.sort((a, b) => a.name.localeCompare(b.name));
      }
      await execMoveFile(item, newHandle, folderName);
    } catch (err) {
      alert('Could not create folder: ' + err.message);
    }
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.stopPropagation(); confirm(); }
    if (e.key === 'Escape') { e.stopPropagation(); removeCtxMenu(); }
  });
  inp.addEventListener('click', e => e.stopPropagation());
  document.getElementById('ctxFolderOk').onclick     = e => { e.stopPropagation(); confirm(); };
  document.getElementById('ctxFolderCancel').onclick = e => { e.stopPropagation(); removeCtxMenu(); };
}

// ── FILE OPERATIONS ───────────────────────────────────────────────────────────
async function execRenameFile(item, newName) {
  try {
    if (item.electronPath) {
      const newPath = item.electronPath.replace(/[^/\\]+$/, '') + newName;
      await window.electronAPI.renameFile(item.electronPath, newPath);
      item.electronPath = newPath;
      item.file = null;
    } else {
      const file      = await getFileForItem(item);
      const buffer    = await file.arrayBuffer();
      const newHandle = await item.parentHandle.getFileHandle(newName, { create: true });
      const writable  = await newHandle.createWritable();
      await writable.write(buffer);
      await writable.close();
      await item.parentHandle.removeEntry(item.name);
      item.fsHandle = newHandle;
    }
    const oldPath = item.path;
    item.name = newName;
    item.ext  = newName.split('.').pop().toLowerCase();
    item.path = item.path.replace(/[^/]+$/, newName);
    refreshFileRow(item, oldPath);
  } catch (err) {
    alert('Rename failed: ' + err.message);
  }
}

async function execMoveFile(item, targetHandle, targetFolderName) {
  try {
    if (item.electronPath) {
      const destDir  = targetFolderName ? rootDirPath + '\\' + targetFolderName : rootDirPath;
      const destPath = destDir + '\\' + item.name;
      await window.electronAPI.moveFile(item.electronPath, destPath);
      item.electronPath = destPath;
      item.file = null;
    } else {
      const file      = await getFileForItem(item);
      const buffer    = await file.arrayBuffer();
      const newHandle = await targetHandle.getFileHandle(item.name, { create: true });
      const writable  = await newHandle.createWritable();
      await writable.write(buffer);
      await writable.close();
      await item.parentHandle.removeEntry(item.name);
      item.fsHandle     = newHandle;
      item.parentHandle = targetHandle;
    }
    const oldPath = item.path;
    item.path = targetFolderName ? targetFolderName + '/' + item.name : item.name;
    refreshFileRow(item, oldPath);
  } catch (err) {
    alert('Move failed: ' + err.message);
  }
}

function refreshFileRow(item, oldPath) {
  // Remove the moved file from the sidebar — it's no longer an unsorted root file
  const oldId  = 'row_' + CSS.escape(oldPath || item.name);
  const oldRow = document.getElementById(oldId);
  if (oldRow) {
    // Also remove any open zip-children block
    const zipBlock = document.getElementById('zip_' + item.name);
    if (zipBlock) zipBlock.remove();
    oldRow.remove();
  }
  // Drop it from allFiles and selectedFiles so counts stay accurate
  const idx = allFiles.indexOf(item);
  if (idx !== -1) allFiles.splice(idx, 1);
  selectedFiles.delete(item);
  document.getElementById('fileCount').textContent = allFiles.length + ' files';
  updateStats();
  updateMultiBar();
}

// ── PERSIST LAST FOLDER (IndexedDB) ──────────────────────────────────────────
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('makerx-3dviewer', 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}
async function idbPut(key, val) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = res; tx.onerror = rej;
    });
    db.close();
  } catch {}
}
async function idbGet(key) {
  try {
    const db = await idbOpen();
    const val = await new Promise((res, rej) => {
      const r = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
    db.close();
    return val ?? null;
  } catch { return null; }
}

async function checkLastFolder() {
  const dropZone = document.getElementById('dropZone');
  if (!dropZone) return;

  // Electron: restore from saved path
  if (window.electronAPI?.openFolderDialog) {
    const dirPath = await idbGet('lastFolderPath');
    if (!dirPath) return;
    const folderName = dirPath.split(/[/\\]/).pop();
    addReopenButton(dropZone, folderName, () => loadFromDirectoryPath(dirPath));
    return;
  }

  // Browser: restore from FSA handle
  if (!window.showDirectoryPicker) return;
  const handle = await idbGet('lastFolder');
  if (!handle) return;
  addReopenButton(dropZone, handle.name, async () => {
    try {
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') await loadFromDirectoryHandle(handle);
    } catch {}
  });
}

function addReopenButton(dropZone, folderName, onClick) {
  const wrap = document.createElement('div');
  wrap.id = 'reopenWrap';
  wrap.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--line);width:100%;text-align:center';
  wrap.innerHTML = `
    <p style="font-size:10px;color:var(--text3);margin-bottom:7px;letter-spacing:0.08em;text-transform:uppercase;font-family:'Rajdhani',sans-serif;font-weight:600">Last folder</p>
    <button id="reopenBtn" style="display:inline-flex;align-items:center;gap:6px;padding:6px 16px;background:var(--accent-dim);border:1px solid var(--border2);color:var(--accent);font-family:'Rajdhani',sans-serif;font-weight:700;font-size:0.8rem;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;clip-path:polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%);transition:background 0.15s,border-color 0.15s,box-shadow 0.15s">
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
      ${folderName}
    </button>`;
  dropZone.appendChild(wrap);
  const btn = document.getElementById('reopenBtn');
  btn.onmouseover = () => { btn.style.background = 'var(--bg3)'; btn.style.borderColor = 'var(--accent)'; btn.style.boxShadow = '0 0 10px var(--neon-glow)'; };
  btn.onmouseout  = () => { btn.style.background = 'var(--accent-dim)'; btn.style.borderColor = 'var(--border2)'; btn.style.boxShadow = 'none'; };
  btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
}

// ── MULTI-SELECT ──────────────────────────────────────────────────────────────
function toggleSelect(item, row, cb) {
  if (selectedFiles.has(item)) {
    selectedFiles.delete(item);
    row.classList.remove('selected');
    cb.checked = false;
  } else {
    selectedFiles.add(item);
    row.classList.add('selected');
    cb.checked = true;
  }
  updateMultiBar();
}

function updateMultiBar() {
  const bar   = document.getElementById('multiBar');
  const label = document.getElementById('multiBarLabel');
  const n = selectedFiles.size;
  if (n > 0) {
    bar.classList.add('active');
    label.textContent = n + ' selected';
  } else {
    bar.classList.remove('active');
  }
}

function clearSelection() {
  selectedFiles.clear();
  document.querySelectorAll('.file-item.selected').forEach(row => {
    row.classList.remove('selected');
    const cb = row.querySelector('.file-item-check');
    if (cb) cb.checked = false;
  });
  updateMultiBar();
}

async function bulkDelete() {
  const count = selectedFiles.size;
  if (!count) return;
  if (!confirm(`Delete ${count} file${count > 1 ? 's' : ''}? This cannot be undone.`)) return;
  const items = [...selectedFiles];
  clearSelection();
  for (const item of items) {
    await execDeleteFile(item);
  }
}

async function bulkMovePrompt() {
  if (!selectedFiles.size) return;
  if (!knownSubfolders.length) {
    alert('No subfolders found. Right-click a file → New folder… to create one first.');
    return;
  }
  removeCtxMenu();
  const btn  = document.querySelector('.multi-btn-move');
  const rect = btn ? btn.getBoundingClientRect() : { left: 100, top: 0, bottom: 100 };

  const menu = document.createElement('div');
  menu.id = 'ctxMenu';
  menu.className = 'ctx-menu';
  document.body.appendChild(menu);

  const sorted = [...knownSubfolders].sort((a, b) => a.name.localeCompare(b.name));
  menu.innerHTML =
    `<div class="ctx-label">Move ${selectedFiles.size} file${selectedFiles.size > 1 ? 's' : ''} to folder</div>` +
    sorted.map(f => `<div class="ctx-item ctx-fld" data-folder="${f.name}">${SVG_FOLDER} ${f.name}</div>`).join('');

  menu.querySelectorAll('.ctx-fld').forEach(el => {
    el.onclick = async e => {
      e.stopPropagation();
      removeCtxMenu();
      const folderName   = el.dataset.folder;
      const targetHandle = knownSubfolders.find(f => f.name === folderName)?.handle;
      const items = [...selectedFiles];
      clearSelection();
      for (const item of items) {
        await execMoveFile(item, targetHandle, folderName);
      }
    };
  });

  // Position above the Move button (the multi-bar is at the bottom)
  const W  = window.innerWidth;
  const mw = menu.offsetWidth || 200;
  const mh = menu.offsetHeight || 120;
  let x = rect.left;
  let y = rect.top - mh - 4;
  if (x + mw > W - 6) x = W - mw - 6;
  if (y < 6) y = rect.bottom + 4;
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  setTimeout(() => {
    document.addEventListener('click',       removeCtxMenu, { once: true });
    document.addEventListener('contextmenu', removeCtxMenu, { once: true });
  }, 0);
}

// ── INIT ───────────────────────────────────────────────────────────────────────
initThree();
buildColorPicker();
checkLastFolder();
