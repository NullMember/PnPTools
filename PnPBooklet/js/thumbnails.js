// Page strip in the sidebar: drag to reorder, rotate or remove pages.

let dragIndex = null;

function renderThumbs() {
  pageThumbs.innerHTML = '';
  pageThumbs.classList.toggle('page-strip', state.pages.length > 0);
  state.pages.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'page-thumb';
    item.draggable = true;
    item.title = `Page ${i + 1} — drag to reorder`;

    const src = thumbSource(p);
    const thumb = document.createElement('canvas');
    thumb.width = 48;
    thumb.height = 64;
    const ctx = thumb.getContext('2d');
    const scale = Math.min(48 / src.width, 64 / src.height);
    const w = src.width * scale, h = src.height * scale;
    ctx.drawImage(src.canvas, (48 - w) / 2, (64 - h) / 2, w, h);

    const num = document.createElement('span');
    num.className = 'page-thumb-num';
    num.textContent = i + 1;

    const actions = document.createElement('div');
    actions.className = 'page-thumb-actions';
    actions.append(
      thumbButton('⟳', `Rotate page ${i + 1}`, () => {
        p.rotation = ((p.rotation || 0) + 90) % 360;
        pagesChanged();
      }),
      thumbButton('✕', `Remove page ${i + 1}`, () => {
        state.pages.splice(i, 1);
        pagesChanged();
      }),
    );

    item.append(thumb, num, actions);
    item.addEventListener('dragstart', (e) => {
      dragIndex = i;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', (e) => {
      if (dragIndex === null) return;
      e.preventDefault();
      item.classList.add('drop-target');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('drop-target');
      if (dragIndex === null || dragIndex === i) return;
      const [moved] = state.pages.splice(dragIndex, 1);
      state.pages.splice(i, 0, moved);
      dragIndex = null;
      pagesChanged();
    });
    pageThumbs.appendChild(item);
  });
}

function thumbButton(text, label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function pagesChanged() {
  renderThumbs();
  updateFileInfo();
  downloadBtn.disabled = state.pages.length === 0;
  if (state.pages.length === 0) {
    clearPages();
    return;
  }
  schedulePreview();
}
