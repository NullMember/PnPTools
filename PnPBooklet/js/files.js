// State, DOM references, loading overlay helpers, and file loading (drag/drop,
// PDF extraction via pdf.js, image loading) for the Booklet Creator.

const MM_TO_PT = 72 / 25.4;
const MM_TO_PX = 96 / 25.4;
const THUMB_MAX_PX = 160; // longest side of a PDF page's stored thumbnail

// State
const state = {
  // { thumb, pdfPage?, canvas?, src, pageNo, rotation }: PDF pages keep only a
  // small thumbnail and are rendered when shown or exported (see pageSource);
  // image pages keep the full image as `canvas`.
  pages: [],
  pageImages: [],  // rendered canvases for each page
  outputCanvases: [],
  pdfBytes: null,
  sourceFiles: [], // the files the pages came from (page.src indexes this), for project saving
};

// DOM
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const pageThumbs = document.getElementById('pageThumbs');
const downloadBtn = document.getElementById('downloadBtn');
const previewArea = document.getElementById('previewArea');
const emptyState = document.getElementById('emptyState');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loadingText');

PnP.dropzone(dropZone, { input: fileInput, onFiles: (files) => handleFiles(files) });

// Add files (images and/or PDFs) after the pages already loaded. A dropped
// batch is sorted by name; project loading keeps the given order.
async function handleFiles(files, { sort = true } = {}) {
  const fileArr = Array.from(files).filter(f => f.type === 'application/pdf' || f.type.startsWith('image/'));
  if (!fileArr.length) return;
  if (sort) fileArr.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  showLoading('Loading files...');
  try {
    for (const file of fileArr) {
      const src = state.sourceFiles.length;
      state.sourceFiles.push(file);
      if (file.type === 'application/pdf') await loadPDF(file, src);
      else await loadImage(file, src);
    }
  } catch (err) {
    console.error(err);
    alert(`Could not load a file: ${err.message}`);
  } finally {
    hideLoading();
  }
  pagesChanged();
}

async function loadPDF(file, src) {
  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;

  for (let i = 1; i <= pdf.numPages; i++) {
    loadingText.textContent = `Reading ${file.name}: page ${i}/${pdf.numPages}...`;
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: THUMB_MAX_PX / Math.max(base.width, base.height) });
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(vp.width));
    thumb.height = Math.max(1, Math.round(vp.height));
    await page.render({ canvasContext: thumb.getContext('2d'), viewport: vp }).promise;
    // The pdf.js page is rendered again at the size the preview or export needs.
    state.pages.push({ thumb, pdfPage: page, src, pageNo: i, rotation: 0 });
  }
}

async function loadImage(file, src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      state.pages.push({ canvas, thumb: scaledCanvas(canvas, THUMB_MAX_PX), src, pageNo: 0, rotation: 0 });
      URL.revokeObjectURL(img.src);
      resolve();
    };
    img.onerror = () => reject(new Error(`${file.name} is not a readable image`));
    img.src = URL.createObjectURL(file);
  });
}

function scaledCanvas(src, maxPx) {
  const k = Math.min(1, maxPx / Math.max(src.width, src.height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(src.width * k));
  out.height = Math.max(1, Math.round(src.height * k));
  out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
  return out;
}

function updateFileInfo() {
  if (!state.pages.length) {
    fileList.innerHTML = '';
    return;
  }
  const files = new Set(state.pages.map(p => p.src)).size;
  fileList.innerHTML = `
    <div class="file-info">
      <span class="name">${files} file(s)</span>
      <span class="page-count-badge">${state.pages.length} page(s)</span>
      <button class="remove" onclick="clearPages()">✕ Clear</button>
    </div>`;
}

function clearPages() {
  state.pages = [];
  renderCache.clear();
  state.pageImages = [];
  state.outputCanvases = [];
  state.pdfBytes = null;
  state.sourceFiles = [];
  fileList.innerHTML = '';
  pageThumbs.innerHTML = '';
  pageThumbs.classList.remove('page-strip');
  downloadBtn.disabled = true;
  previewArea.innerHTML = '';
  previewArea.appendChild(emptyState);
  emptyState.style.display = '';
  fileInput.value = '';
  updatePreview();
}

function showLoading(text) {
  loadingText.textContent = text || 'Processing...';
  loading.classList.remove('hidden');
}

function hideLoading() {
  loading.classList.add('hidden');
}

// Set pdfjsLib worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
