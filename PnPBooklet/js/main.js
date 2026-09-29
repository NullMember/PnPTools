// Bootstrap: wires up event listeners once all modules are loaded.

downloadBtn.addEventListener('click', () => downloadPDF());

// Attach listeners to all sidebar controls
document.querySelectorAll('.sidebar input, .sidebar select').forEach(el => {
  el.addEventListener('input', schedulePreview);
  el.addEventListener('change', schedulePreview);
});

// ---- Shared PnPTools wiring ----

PnP.bindPreset(document.getElementById('sheetPreset'), document.getElementById('sheetW'), document.getElementById('sheetH'), 'paper');
// Pages are paper sizes: cards belong in Layout.
const PAGE_SIZES = [
  { id: 'a4', label: 'A4', w: 210, h: 297 },
  { id: 'a5', label: 'A5', w: 148, h: 210 },
  { id: 'a6', label: 'A6', w: 105, h: 148 },
  { id: 'b5', label: 'B5', w: 176, h: 250 },
  { id: 'letter', label: 'US Letter', w: 215.9, h: 279.4 },
  { id: 'halfLetter', label: 'US Half Letter', w: 139.7, h: 215.9 },
];
PnP.bindPreset(document.getElementById('pagePreset'), document.getElementById('pageW'), document.getElementById('pageH'), PAGE_SIZES);

PnP.sendMenu(document.getElementById('sendSlot'), {
  from: 'Booklet',
  targets: ['PnPLayout'],
  getItems: () => state.sourceFiles.filter((f) => f.type.startsWith('image/')).map((f) => ({ name: f.name, blob: f })),
});


document.getElementById('fitGridBtn').addEventListener('click', () => {
  const { cols, rows } = maxGridThatFits(readConfig());
  document.getElementById('cols').value = cols;
  document.getElementById('rows').value = rows;
  document.getElementById('rows').dispatchEvent(new Event('change', { bubbles: true }));
  schedulePreview();
});

PnP.init({
  tool: 'PnPBooklet',
  offlineFiles: [pdfjsLib.GlobalWorkerOptions.workerSrc],
  project: {
    getFiles: () => state.sourceFiles.map((f) => ({ name: f.name, blob: f, role: f.pnpRole })),
    getState: () => ({ pages: state.pages.map((p) => ({ src: p.src, pageNo: p.pageNo, rotation: p.rotation || 0 })) }),
    setFiles: async (files) => {
      clearPages();
      await handleFiles(files, { sort: false });
    },
    // Restore the saved page order, removals and rotations.
    setState: (saved) => {
      if (!saved || !saved.pages) return;
      const byKey = new Map(state.pages.map((p) => [`${p.src}:${p.pageNo}`, p]));
      state.pages = saved.pages.map((s) => {
        const p = byKey.get(`${s.src}:${s.pageNo}`);
        if (p) p.rotation = s.rotation || 0;
        return p;
      }).filter(Boolean);
      pagesChanged();
    },
  },
  hasUnsavedWork: () => state.pages.length > 0,
});

PnP.handoff.receive((items) => handleFiles(PnP.itemsToFiles(items)));
