// =====================================================================
// app.js  -  Frontend logic untuk PDF Tag Search (dengan PDF viewer)
// =====================================================================

// Backend base URL: use localhost:3000 for local dev, otherwise default to current origin.
// If you host the Express backend on a separate server, set `API_BASE_OVERRIDE` below
// or replace this with the production backend URL.
const API_BASE_OVERRIDE = null; // e.g. "https://api.mydomain.com" — set to non-null to force
const API_BASE = API_BASE_OVERRIDE
  || (location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : `${location.protocol}//${location.hostname}${location.port ? ":" + location.port : ""}`);

// Detect whether we are likely running with a reachable backend on same origin/dev
const isOnlineHost = API_BASE && (API_BASE.includes("localhost") || API_BASE.indexOf(location.hostname) !== -1);

// pdfjsLib dimuat dari server lokal (node_modules/pdfjs-dist/build/)
// sehingga viewer tidak bergantung pada CDN dan lebih andal.
let pdfjsLib = null;
async function ensurePdfjs() {
  if (pdfjsLib) return pdfjsLib;
  // Coba load dari /pdfjs/ (public folder, Vercel-compatible)
  // Jika gagal, fallback ke API_BASE (Express)
  try {
    // Prefer loading from same origin (should work on Vercel if pdfjs files are in public)
    pdfjsLib = await import(`/pdfjs/pdf.min.mjs`);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `/pdfjs/pdf.worker.min.mjs`;
  } catch {
    // Fallback to API_BASE (useful for dev when pdfjs served by Express)
    pdfjsLib = await import(`${API_BASE}/pdfjs/pdf.min.mjs`);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${API_BASE}/pdfjs/pdf.worker.min.mjs`;
  }
  return pdfjsLib;
}

// Helper fetch dengan base URL absolut + pesan error yang jelas
async function apiFetch(path, options) {
  let res;
  try {
    // If API_BASE points to same origin, fetch relative path to avoid CORS issues.
    const url = API_BASE && API_BASE.indexOf(location.hostname) !== -1 ? path : `${API_BASE}${path}`;
    res = await fetch(url, options);
  } catch (err) {
    throw new Error(
      `Tidak dapat terhubung ke backend (${API_BASE}). ` +
      `Pastikan server Express berjalan: jalankan "node server.js".`
    );
  }
  return res;
}

const API = {
  files: () => apiFetch("/files").then((r) => r.json()),
  tags: (id) => apiFetch(`/files/${id}/tags`).then((r) => r.json()),
  search: (kw) => apiFetch(`/search?keyword=${encodeURIComponent(kw)}`).then((r) => r.json()),
  rescan: (reExtract = true) =>
    apiFetch(`/scan?reExtract=${reExtract}`, { method: "POST" }).then((r) => r.json()),
  upload: (formData) =>
    apiFetch("/upload", { method: "POST", body: formData }).then((r) => r.json()),
  getSettings: () => apiFetch("/settings").then((r) => r.json()),
  setSettings: (active_folder) =>
    apiFetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active_folder }),
    }).then((r) => r.json()),
};

// ===== State =====
let allFiles = [];
let activeFileId = null;
let currentKeyword = "";
let searchDebounce = null;
let activeFolder = null;

// ===== PDF Viewer state =====
let pdfDoc = null;
let pdfCurrentPage = 1;
let pdfScale = 1.0;
let pdfRenderTask = null;
let pdfTagsForView = [];
let pdfActiveAnnotId = null;

// ===== DOM helpers =====
const $ = (id) => document.getElementById(id);

function escapeHTML(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function highlight(text, keyword) {
  const safe = escapeHTML(text);
  if (!keyword) return safe;
  const safeKw = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(safeKw, "gi"), (m) => `<mark>${m}</mark>`);
}

function showToast(msg, type = "info", ms = 3000) {
  const el = $("toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add("hidden"), ms);
}

// ===== Folder aktif =====
async function loadSettings() {
  try {
    const data = await API.getSettings();
    setActiveFolderUI(data.active_folder);
    if (data.active_folder) {
      await loadFiles();
    }
  } catch (err) {
    showToast("Gagal memuat settings: " + err.message, "error");
  }
}

function setActiveFolderUI(folder) {
  activeFolder = folder;
  const info = $("folderInfo");
  const btnRescan = $("btnRescan");
  const btnUpload = $("btnUpload");
  const searchInput = $("searchInput");

  if (folder) {
    info.textContent = `📁 ${folder}`;
    info.title = folder;
    btnRescan.disabled = false;
    btnUpload.disabled = false;
    searchInput.disabled = false;
  } else {
    info.textContent = "Belum ada folder";
    btnRescan.disabled = true;
    btnUpload.disabled = true;
    searchInput.disabled = true;
    if (allFiles.length === 0) {
      $("fileList").innerHTML = `<div class="empty">Pilih folder PDF dulu untuk memulai.</div>`;
    }
  }
}

function openFolderModal() {
  $("folderModal").classList.remove("hidden");
  $("folderInput").value = activeFolder || "";
  $("folderStatus").textContent = "";
  $("folderStatus").className = "folder-status";
  $("folderPreview").innerHTML = "";
  setTimeout(() => $("folderInput").focus(), 100);
}
function closeFolderModal() {
  $("folderModal").classList.add("hidden");
}

async function doSetFolder() {
  const folder = $("folderInput").value.trim();
  const status = $("folderStatus");
  const btn = $("btnSetFolder");

  if (!folder) {
    status.textContent = "⚠️ Path folder tidak boleh kosong";
    status.className = "folder-status error";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Menyimpan...";
  status.textContent = "Memvalidasi folder...";
  status.className = "folder-status";

  try {
    const r = await API.setSettings(folder);
    if (r.error) {
      status.textContent = "❌ " + r.error;
      status.className = "folder-status error";
      return;
    }
    setActiveFolderUI(r.active_folder);
    status.textContent = "✓ Folder disimpan. Memulai scan...";
    status.className = "folder-status success";
    showToast(`Folder aktif: ${r.active_folder}`, "success");
    closeFolderModal();
    await doRescan(true);
  } catch (err) {
    status.textContent = "❌ " + err.message;
    status.className = "folder-status error";
  } finally {
    btn.disabled = false;
    btn.textContent = "Set Folder & Scan";
  }
}

// ===== Sidebar: daftar file =====
async function loadFiles() {
  const list = $("fileList");
  if (!activeFolder) {
    list.innerHTML = `<div class="empty">Pilih folder PDF dulu untuk memulai.</div>`;
    return;
  }
  list.innerHTML = `<div class="empty">Memuat...</div>`;
  try {
    const data = await API.files();
    allFiles = data.files || [];
    renderFileList();
  } catch (err) {
    list.innerHTML = `<div class="empty">⚠️ Gagal memuat: ${escapeHTML(err.message)}</div>`;
  }
}

function renderFileList() {
  $("fileCount").textContent = allFiles.length;
  const list = $("fileList");
  if (allFiles.length === 0) {
    list.innerHTML = `<div class="empty">Folder aktif tidak punya file PDF, atau belum di-scan. Klik "Scan Ulang".</div>`;
    return;
  }
  list.innerHTML = allFiles
    .map((f) => {
      const isActive = f.id === activeFileId;
      const tagCount = f.tag_count || 0;
      const tagClass = tagCount === 0 ? "tag-count zero" : "tag-count";
      return `
        <div class="file-item ${isActive ? "active" : ""}" data-id="${f.id}">
          <div class="file-item-name" title="${escapeHTML(f.original_name)}">
            📄 ${escapeHTML(f.original_name)}
          </div>
          <div class="file-item-meta">
            <span class="${tagClass}">🏷 ${tagCount} tag</span>
            ${f.total_pages ? `<span>📃 ${f.total_pages} hal</span>` : ""}
          </div>
        </div>`;
    })
    .join("");

  list.querySelectorAll(".file-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = Number(el.dataset.id);
      openFileDetail(id);
    });
  });
}

// ===== Klik file di sidebar: buka PDF viewer =====
async function openFileDetail(id) {
  activeFileId = id;
  currentKeyword = "";
  $("searchInput").value = "";
  renderFileList();

  const file = allFiles.find((f) => f.id === id);
  if (!file) return;

  // Buka PDF viewer modal
  await openPdfViewer(file);
}

async function openFileDetailInline(id) {
  // Tampilkan detail anotasi di panel utama (untuk hasil search)
  const results = $("results");
  results.innerHTML = `<div class="empty">Memuat anotasi...</div>`;
  try {
    const data = await API.tags(id);
    const file = allFiles.find((f) => f.id === id);
    if (!data.tags || data.tags.length === 0) {
      results.innerHTML = `
        <div class="file-card">
          <div class="file-card-header">
            <div class="file-card-title" onclick="window.openPdfViewerById(${id})">
              <span class="file-icon">📄</span>
              ${escapeHTML(file?.original_name || `File #${id}`)}
            </div>
            <div class="file-card-actions">
              <span class="tag-count-badge">0 tag</span>
              <button class="btn btn-primary" onclick="window.openPdfViewerById(${id})">📖 Buka PDF</button>
            </div>
          </div>
          <div class="empty">File ini belum punya anotasi/komentar.</div>
        </div>`;
      return;
    }
    const tagHTML = data.tags
      .map(
        (t) => `
        <div class="tag-item type-${escapeHTML(t.type)}" data-tag-id="${t.id}">
          <div class="tag-meta">
            <span class="page">Halaman ${t.page}</span>
            <span class="type">${escapeHTML(t.type)}</span>
            ${t.author ? `<span class="author">oleh ${escapeHTML(t.author)}</span>` : ""}
          </div>
          <div class="tag-content">${escapeHTML(t.content)}</div>
        </div>`
      )
      .join("");
    results.innerHTML = `
      <div class="file-card">
        <div class="file-card-header">
          <div class="file-card-title" onclick="window.openPdfViewerById(${id})">
            <span class="file-icon">📄</span>
            ${escapeHTML(file?.original_name || `File #${id}`)}
          </div>
          <div class="file-card-actions">
            <span class="tag-count-badge">${data.tags.length} tag</span>
            <button class="btn btn-primary" onclick="window.openPdfViewerById(${id})">📖 Buka PDF</button>
          </div>
        </div>
        <div class="tag-list">${tagHTML}</div>
      </div>`;
  } catch (err) {
    results.innerHTML = `<div class="empty">⚠️ Gagal: ${escapeHTML(err.message)}</div>`;
  }
}

window.openPdfViewerById = async (id) => {
  const file = allFiles.find((f) => f.id === id);
  if (file) await openPdfViewer(file);
};

// ===== PDF Viewer =====
async function openPdfViewer(file) {
  $("pdfModalTitle").textContent = file.original_name;
  $("pdfModal").classList.remove("hidden");
  $("pdfLoading").classList.remove("hidden");
  $("pdfLoading").textContent = "Memuat PDF...";
  pdfCurrentPage = 1;
  pdfScale = 1.0;
  pdfActiveAnnotId = null;

  try {
    const pdfjs = await ensurePdfjs();
    const loadingTask = pdfjs.getDocument(`${API_BASE}/files/${file.id}/pdf`);
    pdfDoc = await loadingTask.promise;

    // Load tags
    const tagData = await API.tags(file.id);
    pdfTagsForView = tagData.tags || [];

    $("pdfLoading").classList.add("hidden");
    updatePdfPageInfo();
    await renderPdfPage();
    renderPdfTagsPanel();
  } catch (err) {
    console.error("PDF load error:", err);
    $("pdfLoading").textContent = "⚠️ Gagal memuat PDF: " + err.message;
  }
}

function closePdfViewer() {
  $("pdfModal").classList.add("hidden");
  if (pdfRenderTask) {
    try { pdfRenderTask.cancel(); } catch {}
  }
  pdfDoc = null;
  pdfTagsForView = [];
  pdfActiveAnnotId = null;
}

function updatePdfPageInfo() {
  if (!pdfDoc) return;
  $("pdfPageInfo").textContent = `${pdfCurrentPage} / ${pdfDoc.numPages}`;
  $("pdfZoomLevel").textContent = `${Math.round(pdfScale * 100)}%`;
  $("pdfPrevPage").disabled = pdfCurrentPage <= 1;
  $("pdfNextPage").disabled = pdfCurrentPage >= pdfDoc.numPages;
}

async function renderPdfPage() {
  if (!pdfDoc) return;
  if (pdfRenderTask) {
    try { pdfRenderTask.cancel(); } catch {}
  }
  const page = await pdfDoc.getPage(pdfCurrentPage);
  const viewport = page.getViewport({ scale: pdfScale });
  const canvas = $("pdfCanvas");
  const ctx = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const wrap = $("pdfCanvasWrap");
  wrap.style.width = viewport.width + "px";
  wrap.style.height = viewport.height + "px";

  pdfRenderTask = page.render({ canvasContext: ctx, viewport });
  await pdfRenderTask.promise;

  // Ambil annotations untuk overlay
  const annotList = await page.getAnnotations();
  renderAnnotOverlay(annotList, viewport);
  updatePdfPageInfo();
}

function renderAnnotOverlay(annotList, viewport) {
  const layer = $("pdfAnnotLayer");
  layer.innerHTML = "";
  const skip = new Set(["Link", "Popup"]);
  for (const a of annotList) {
    if (skip.has(a.subtype)) continue;
    const rect = a.rect; // [x1,y1,x2,y2] in PDF coords
    if (!rect || rect.length !== 4) continue;
    const [x1, y1, x2, y2] = rect;
    const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1);
    const [vx2, vy2] = viewport.convertToViewportPoint(x2, y2);
    const left = Math.min(vx1, vx2);
    const top = Math.min(vy1, vy2);
    const width = Math.abs(vx2 - vx1);
    const height = Math.abs(vy2 - vy1);

    let el;
    if (a.subtype === "Text" || a.subtype === "FreeText") {
      el = document.createElement("div");
      el.className = "pdf-annot-sticky";
      el.style.left = left + "px";
      el.style.top = top + "px";
      el.title = a.contents || "Sticky note";
      el.textContent = "📝";
    } else {
      el = document.createElement("div");
      el.className = "pdf-annot-rect";
      el.style.left = left + "px";
      el.style.top = top + "px";
      el.style.width = width + "px";
      el.style.height = height + "px";
      el.title = (a.contents || a.subtype) + (a.author ? ` (oleh ${a.author})` : "");
    }

    // Cari tag di DB yang cocok dengan annotation ini (berdasarkan page + content)
    const matchingTag = pdfTagsForView.find(
      (t) => t.page === pdfCurrentPage && t.content === (a.contents || "").trim()
    );
    if (matchingTag) {
      el.dataset.tagId = matchingTag.id;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        focusPdfTag(matchingTag.id);
      });
    }
    layer.appendChild(el);
  }
}

function renderPdfTagsPanel() {
  const list = $("pdfTagsList");
  $("pdfTagCount").textContent = pdfTagsForView.length;
  if (pdfTagsForView.length === 0) {
    list.innerHTML = `<div class="empty">Tidak ada anotasi di file ini.</div>`;
    return;
  }
  // Group by page
  const byPage = new Map();
  for (const t of pdfTagsForView) {
    if (!byPage.has(t.page)) byPage.set(t.page, []);
    byPage.get(t.page).push(t);
  }
  const sortedPages = Array.from(byPage.keys()).sort((a, b) => a - b);
  list.innerHTML = sortedPages
    .map((page) => {
      const tags = byPage.get(page);
      const items = tags
        .map(
          (t) => `
        <div class="pdf-tag-item type-${escapeHTML(t.type)}" data-tag-id="${t.id}" data-page="${t.page}">
          <div class="pdf-tag-item-meta">
            <span class="pdf-tag-item-page">Hal ${t.page}</span>
            <span class="pdf-tag-item-type">${escapeHTML(t.type)}</span>
          </div>
          <div class="pdf-tag-item-content">${escapeHTML(t.content)}</div>
        </div>`
        )
        .join("");
      return `<div class="empty" style="padding:8px 4px 4px;font-weight:600;color:#374151;">Halaman ${page}</div>${items}`;
    })
    .join("");

  list.querySelectorAll(".pdf-tag-item").forEach((el) => {
    el.addEventListener("click", () => {
      const tagId = Number(el.dataset.tagId);
      const page = Number(el.dataset.page);
      focusPdfTag(tagId, page);
    });
  });
}

async function focusPdfTag(tagId, pageOverride) {
  pdfActiveAnnotId = tagId;
  // Update active state di list
  document.querySelectorAll(".pdf-tag-item").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.tagId) === tagId);
  });
  // Update active state di canvas overlay
  document.querySelectorAll(".pdf-annot-rect, .pdf-annot-sticky").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.tagId) === tagId);
  });
  // Pindah halaman kalau perlu
  if (pageOverride && pageOverride !== pdfCurrentPage) {
    pdfCurrentPage = pageOverride;
    await renderPdfPage();
  }
}

// ===== Search =====
function onSearchInput() {
  const kw = $("searchInput").value;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => doSearch(kw), 300);
}

async function doSearch(keyword) {
  currentKeyword = keyword.trim();
  const results = $("results");
  const status = $("searchStatus");
  activeFileId = null;
  renderFileList();

  if (!currentKeyword) {
    results.innerHTML = `
      <div class="welcome">
        <h2>👋 Selamat datang</h2>
        <p>Ketik di kotak pencarian untuk mencari komentar/anotasi di semua file PDF.</p>
        <p>Atau klik salah satu file di panel kiri untuk membuka PDF viewer.</p>
      </div>`;
    status.textContent = "";
    return;
  }

  status.textContent = "Mencari...";
  try {
    const data = await API.search(currentKeyword);
    status.textContent = `${data.count} file cocok untuk "${currentKeyword}"`;
    if (!data.results || data.results.length === 0) {
      results.innerHTML = `
        <div class="welcome">
          <h2>🔍 Tidak ada hasil</h2>
          <p>Tidak ada file yang punya anotasi mengandung "<b>${escapeHTML(currentKeyword)}</b>".</p>
        </div>`;
      return;
    }
    const cards = data.results
      .map((f) => {
        const tagsHTML = f.tags
          .map(
            (t) => `
            <div class="tag-item type-${escapeHTML(t.type)}" data-tag-id="${t.id}" data-page="${t.page}" data-file-id="${f.file_id}">
              <div class="tag-meta">
                <span class="page">Halaman ${t.page}</span>
                <span class="type">${escapeHTML(t.type)}</span>
                ${t.author ? `<span class="author">oleh ${escapeHTML(t.author)}</span>` : ""}
              </div>
              <div class="tag-content">${highlight(t.content, currentKeyword)}</div>
            </div>`
          )
          .join("");
        return `
        <div class="file-card">
          <div class="file-card-header">
            <div class="file-card-title" onclick="window.openPdfViewerById(${f.file_id})">
              <span class="file-icon">📄</span>
              ${escapeHTML(f.original_name)}
            </div>
            <div class="file-card-actions">
              <span class="tag-count-badge">${f.tags.length} cocok</span>
              <button class="btn btn-primary" onclick="window.openPdfViewerById(${f.file_id})">📖 Buka PDF</button>
            </div>
          </div>
          <div class="tag-list">${tagsHTML}</div>
        </div>`;
      })
      .join("");
    results.innerHTML = cards;
  } catch (err) {
    status.textContent = "";
    results.innerHTML = `<div class="empty">⚠️ Gagal: ${escapeHTML(err.message)}</div>`;
  }
}

// ===== Scan Ulang =====
async function doRescan(reExtract = true) {
  if (!activeFolder) {
    showToast("Pilih folder dulu", "error");
    return;
  }
  const btn = $("btnRescan");
  btn.disabled = true;
  btn.innerHTML = `<span class="icon">⏳</span> Scanning...`;
  try {
    const r = await API.rescan(reExtract);
    if (r.error) {
      showToast(r.error, "error");
      return;
    }
    showToast(
      `Scan selesai: ${r.added} baru, ${r.reExtracted} re-extract, ${r.skipped} dilewati`,
      "success"
    );
    await loadFiles();
  } catch (err) {
    showToast(`Gagal scan: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span class="icon">🔄</span> Scan Ulang`;
  }
}

// ===== Upload Modal =====
function openUploadModal() {
  $("uploadModal").classList.remove("hidden");
  $("fileName").textContent = "Belum ada file dipilih";
  $("uploadStatus").textContent = "";
  $("uploadStatus").className = "upload-status";
  $("fileInput").value = "";
  $("uploadProgress").classList.add("hidden");
}
function closeUploadModal() {
  $("uploadModal").classList.add("hidden");
}

$("btnUpload").addEventListener("click", openUploadModal);
$("btnCloseModal").addEventListener("click", closeUploadModal);
$("btnCancelUpload").addEventListener("click", closeUploadModal);
$("uploadModal").addEventListener("click", (e) => {
  if (e.target.id === "uploadModal") closeUploadModal();
});

$("fileInput").addEventListener("change", (e) => {
  const f = e.target.files[0];
  $("fileName").textContent = f ? `${f.name} (${(f.size / 1024).toFixed(1)} KB)` : "Belum ada file dipilih";
});

$("uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("fileInput").files[0];
  if (!file) {
    $("uploadStatus").textContent = "Pilih file dulu";
    $("uploadStatus").className = "upload-status error";
    return;
  }
  const fd = new FormData();
  fd.append("pdf", file);
  const btn = $("btnSubmitUpload");
  const progress = $("uploadProgress");
  const bar = $("uploadProgressBar");
  const status = $("uploadStatus");

  btn.disabled = true;
  btn.textContent = "Mengupload...";
  progress.classList.remove("hidden");
  bar.style.width = "0%";
  status.textContent = "";
  status.className = "upload-status";

  const xhr = new XMLHttpRequest();
  xhr.upload.addEventListener("progress", (ev) => {
    if (ev.lengthComputable) {
      const pct = Math.round((ev.loaded / ev.total) * 100);
      bar.style.width = pct + "%";
    }
  });
  xhr.addEventListener("load", async () => {
    btn.disabled = false;
    btn.textContent = "Upload";
    progress.classList.add("hidden");
    try {
      const data = JSON.parse(xhr.responseText);
      if (data.success) {
        status.textContent = `✓ Berhasil upload: ${data.filename}`;
        status.className = "upload-status success";
        showToast(`Berhasil upload ${data.filename}`, "success");
        await loadFiles();
        setTimeout(closeUploadModal, 1200);
      } else {
        status.textContent = `✗ ${data.error || "Gagal upload"}`;
        status.className = "upload-status error";
      }
    } catch (err) {
      status.textContent = `✗ Respon tidak valid`;
      status.className = "upload-status error";
    }
  });
  xhr.addEventListener("error", () => {
    btn.disabled = false;
    btn.textContent = "Upload";
    progress.classList.add("hidden");
    status.textContent = "✗ Gagal koneksi ke server";
    status.className = "upload-status error";
  });
  xhr.open("POST", `${API_BASE}/upload`);
  xhr.send(fd);
});

// ===== Folder modal events =====
$("btnPickFolder").addEventListener("click", openFolderModal);
$("btnCloseFolderModal").addEventListener("click", closeFolderModal);
$("btnCancelFolder").addEventListener("click", closeFolderModal);
$("btnSetFolder").addEventListener("click", doSetFolder);
$("folderModal").addEventListener("click", (e) => {
  if (e.target.id === "folderModal") closeFolderModal();
});

$("folderInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSetFolder();
});

$("btnBrowseFolder").addEventListener("click", () => $("folderBrowser").click());
$("folderBrowser").addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;
  const first = files[0];
  const rel = first.webkitRelativePath || first.name;
  const folderName = rel.split("/")[0];
  const preview = $("folderPreview");
  preview.innerHTML = `
    <div class="folder-preview-info">
      📂 Folder terdeteksi: <b>${escapeHTML(folderName)}</b> (${files.length} file)
      <div class="folder-preview-warn">
        ⚠️ Browser tidak memberikan path absolut asli. Silakan ketik path lengkap di atas,
        atau copy path dari File Explorer: <code>${escapeHTML(folderName)}</code>
      </div>
    </div>`;
  if (!$("folderInput").value) {
    $("folderInput").value = folderName;
  }
});

// ===== PDF Viewer events =====
$("pdfClose").addEventListener("click", closePdfViewer);
$("pdfPrevPage").addEventListener("click", async () => {
  if (pdfCurrentPage > 1) {
    pdfCurrentPage--;
    await renderPdfPage();
  }
});
$("pdfNextPage").addEventListener("click", async () => {
  if (pdfDoc && pdfCurrentPage < pdfDoc.numPages) {
    pdfCurrentPage++;
    await renderPdfPage();
  }
});
$("pdfZoomIn").addEventListener("click", async () => {
  pdfScale = Math.min(pdfScale + 0.2, 3.0);
  await renderPdfPage();
});
$("pdfZoomOut").addEventListener("click", async () => {
  pdfScale = Math.max(pdfScale - 0.2, 0.4);
  await renderPdfPage();
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$("pdfModal").classList.contains("hidden")) closePdfViewer();
    if (!$("folderModal").classList.contains("hidden")) closeFolderModal();
    if (!$("uploadModal").classList.contains("hidden")) closeUploadModal();
  }
  // PDF viewer navigation
  if (!$("pdfModal").classList.contains("hidden")) {
    if (e.key === "ArrowLeft" && pdfCurrentPage > 1) {
      pdfCurrentPage--;
      renderPdfPage();
    } else if (e.key === "ArrowRight" && pdfDoc && pdfCurrentPage < pdfDoc.numPages) {
      pdfCurrentPage++;
      renderPdfPage();
    } else if (e.key === "+" || e.key === "=") {
      pdfScale = Math.min(pdfScale + 0.2, 3.0);
      renderPdfPage();
    } else if (e.key === "-") {
      pdfScale = Math.max(pdfScale - 0.2, 0.4);
      renderPdfPage();
    }
  }
  if (e.key === "/" && document.activeElement !== $("searchInput") &&
      !$("pdfModal").classList.contains("hidden") === false &&
      !$("folderModal").classList.contains("hidden") === false &&
      !$("uploadModal").classList.contains("hidden") === false) {
    e.preventDefault();
    $("searchInput").focus();
  }
});

// ===== Event bindings =====
$("searchInput").addEventListener("input", onSearchInput);
$("btnClear").addEventListener("click", () => {
  $("searchInput").value = "";
  onSearchInput();
});
$("btnRescan").addEventListener("click", () => doRescan(true));

// ===== Mode detection =====
// "online"  -> backend Express reachable, full fitur (scan/search/upload)
// "offline" -> dibuka lewat file:// atau backend tidak jalan, hanya viewer PDF
let APP_MODE = "online";

async function detectAppMode() {
  // Kalau dibuka lewat protokol file://, jelas tidak bisa pakai backend
  if (location.protocol === "file:") return "offline";
  // Coba ping backend. Kalau gagal, anggap offline.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${API_BASE}/settings`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return "offline";
    return "online";
  } catch (err) {
    console.warn("detectAppMode: backend ping failed", err && err.message);
    return "offline";
  }
}

function enterOfflineMode() {
  APP_MODE = "offline";
  document.body.classList.add("mode-offline");
  $("offlineBanner").classList.remove("hidden");
  // Disable kontrol yang butuh backend
  $("btnPickFolder").disabled = true;
  $("btnRescan").disabled = true;
  $("btnUpload").disabled = true;
  $("searchInput").disabled = true;
  // Ubah welcome screen
  $("results").innerHTML = `
    <div class="welcome">
      <h2>👋 Mode Offline</h2>
      <p>Aplikasi berjalan tanpa server. Klik tombol <b>📂 Buka PDF</b> di bawah
         untuk membuka file PDF langsung dari komputermu.</p>
      <button id="btnOpenOfflineViewer" class="btn btn-primary" style="margin-top:16px;font-size:16px;padding:12px 24px;">
        📂 Buka PDF
      </button>
      <p style="margin-top:24px;font-size:12px;opacity:0.7;">
        Untuk fitur lengkap (scan folder, cari anotasi, upload),
        jalankan <code>node server.js</code> lalu buka
        <a href="${API_BASE}">${API_BASE}</a>.
      </p>
    </div>`;
  $("btnOpenOfflineViewer").addEventListener("click", openOfflineViewer);
  // Setup offline viewer events
  setupOfflineViewer();
}

// ===== Offline PDF Viewer =====
let offlineFiles = [];      // {name, url, blobUrl}
let offlineActiveIndex = -1;

function setupOfflineViewer() {
  // Banner close
  const bc = $("offlineBannerClose");
  if (bc) bc.addEventListener("click", () => $("offlineBanner").classList.add("hidden"));

  // Modal close
  $("offlinePdfClose").addEventListener("click", closeOfflineViewer);
  $("offlinePdfModal").addEventListener("click", (e) => {
    if (e.target.id === "offlinePdfModal") closeOfflineViewer();
  });

  // File picker
  $("offlinePdfPick").addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(addOfflineFile);
    renderOfflineFileList();
    if (offlineActiveIndex === -1 && offlineFiles.length > 0) {
      setOfflineActive(0);
    }
    e.target.value = "";
  });

  // Prev / next
  $("offlinePdfPrev").addEventListener("click", () => {
    if (offlineActiveIndex > 0) setOfflineActive(offlineActiveIndex - 1);
  });
  $("offlinePdfNext").addEventListener("click", () => {
    if (offlineActiveIndex < offlineFiles.length - 1) setOfflineActive(offlineActiveIndex + 1);
  });

  // Drag-drop
  const dropZone = $("offlinePdfDropZone");
  ["dragenter", "dragover"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
    });
  });
  dropZone.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) {
      showToast("Hanya file PDF yang didukung", "error");
      return;
    }
    pdfs.forEach(addOfflineFile);
    renderOfflineFileList();
    if (offlineActiveIndex === -1) setOfflineActive(0);
    else renderOfflineViewer();
  });

  // Keyboard
  document.addEventListener("keydown", (e) => {
    if (APP_MODE !== "offline") return;
    if (!$("offlinePdfModal").classList.contains("hidden")) {
      if (e.key === "Escape") closeOfflineViewer();
      else if (e.key === "ArrowLeft" && offlineActiveIndex > 0) setOfflineActive(offlineActiveIndex - 1);
      else if (e.key === "ArrowRight" && offlineActiveIndex < offlineFiles.length - 1) setOfflineActive(offlineActiveIndex + 1);
    }
  });
}

function addOfflineFile(file) {
  // Replace kalau nama sama
  const existing = offlineFiles.findIndex((f) => f.name === file.name);
  const url = URL.createObjectURL(file);
  const entry = { name: file.name, url, size: file.size };
  if (existing !== -1) {
    try { URL.revokeObjectURL(offlineFiles[existing].url); } catch {}
    offlineFiles[existing] = entry;
  } else {
    offlineFiles.push(entry);
  }
}

function setOfflineActive(index) {
  offlineActiveIndex = index;
  renderOfflineViewer();
  renderOfflineFileList();
}

function renderOfflineViewer() {
  if (offlineActiveIndex < 0 || offlineActiveIndex >= offlineFiles.length) {
    $("offlinePdfEmbed").src = "";
    $("offlinePdfEmbed").style.display = "none";
    $("offlinePdfEmpty").classList.remove("hidden");
    $("offlinePdfInfo").textContent = "- / -";
    $("offlinePdfTitle").textContent = "File";
    $("offlinePdfPrev").disabled = true;
    $("offlinePdfNext").disabled = true;
    return;
  }
  const f = offlineFiles[offlineActiveIndex];
  $("offlinePdfTitle").textContent = f.name;
  const embed = $("offlinePdfEmbed");
  embed.src = f.url + "#toolbar=1&navpanes=1&scrollbar=1";
  embed.style.display = "block";
  $("offlinePdfEmpty").classList.add("hidden");
  $("offlinePdfInfo").textContent = `${offlineActiveIndex + 1} / ${offlineFiles.length}`;
  $("offlinePdfPrev").disabled = offlineActiveIndex <= 0;
  $("offlinePdfNext").disabled = offlineActiveIndex >= offlineFiles.length - 1;
}

function renderOfflineFileList() {
  const list = $("offlineFileList");
  $("offlinePdfCount").textContent = offlineFiles.length;
  if (offlineFiles.length === 0) {
    list.innerHTML = `<div class="empty">Belum ada file. Drop PDF di area viewer.</div>`;
    return;
  }
  list.innerHTML = offlineFiles.map((f, i) => `
    <div class="offline-file-item ${i === offlineActiveIndex ? 'active' : ''}" data-index="${i}">
      <span>📄</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(f.name)}</span>
      <span class="remove" data-remove="${i}" title="Hapus">✕</span>
    </div>
  `).join("");
  list.querySelectorAll(".offline-file-item").forEach((el) => {
    const i = Number(el.dataset.index);
    el.addEventListener("click", (ev) => {
      if (ev.target.classList.contains("remove")) {
        const idx = Number(ev.target.dataset.remove);
        try { URL.revokeObjectURL(offlineFiles[idx].url); } catch {}
        offlineFiles.splice(idx, 1);
        if (offlineActiveIndex >= offlineFiles.length) offlineActiveIndex = offlineFiles.length - 1;
        renderOfflineViewer();
        renderOfflineFileList();
        return;
      }
      setOfflineActive(i);
    });
  });
}

function openOfflineViewer() {
  $("offlinePdfModal").classList.remove("hidden");
  renderOfflineViewer();
  renderOfflineFileList();
}

function closeOfflineViewer() {
  $("offlinePdfModal").classList.add("hidden");
}

// ===== Init =====
(async function init() {
  // Vercel / domain lain → offline mode (hanya viewer PDF)
  // localhost / 127.0.0.1 → coba online mode, fallback ke offline jika backend mati
  if (!isOnlineHost) {
    enterOfflineMode();
    return;
  }
  if (location.protocol === "file:") {
    enterOfflineMode();
    return;
  }
  const mode = await detectAppMode();
  if (mode === "offline") {
    enterOfflineMode();
  } else {
    loadSettings();
  }
})();
