if (window.__screenshotOverlayActive) {
} else {
  window.__screenshotOverlayActive = true;

  let startX = 0, startY = 0, isSelecting = false;

  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483646',
    'cursor:crosshair', 'background:rgba(0,0,0,0.45)'
  ].join(';');

  const selectionEl = document.createElement('div');
  selectionEl.style.cssText = [
    'position:fixed', 'display:none',
    'border:2px dashed #058a57',
    'box-shadow:0 0 0 9999px rgba(0,0,0,0)',
    'outline:1px solid rgba(0,0,0,0.4)',
    'z-index:2147483647', 'pointer-events:none'
  ].join(';');

  const hint = document.createElement('div');
  hint.style.cssText = [
    'position:fixed', 'top:50%', 'left:50%',
    'transform:translate(-50%,-50%)',
    'background:rgb(34,34,36)', 'color:#e8eaed',
    'font-family:system-ui,sans-serif', 'font-size:13px',
    'padding:12px 17px', 'border-radius:10px',
    'pointer-events:none', 'z-index:2147483647',
    'letter-spacing:0.01em', 'white-space:nowrap',
    'border:1px solid rgba(255,255,255,0.2)'
  ].join(';');
  hint.textContent = 'Drag to select  ·  Esc to cancel';

  const sizeLabel = document.createElement('div');
  sizeLabel.style.cssText = [
    'position:fixed', 'display:none',
    'background:rgb(34,34,36)', 'color:#e8eaed',
    'font-family:system-ui,sans-serif', 'font-size:11px',
    'padding:3px 8px', 'border-radius:4px',
    'pointer-events:none', 'z-index:2147483647',
    'border:1px solid rgba(255,255,255,0.2)'
  ].join(';');

  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(selectionEl);
  document.documentElement.appendChild(hint);
  document.documentElement.appendChild(sizeLabel);

  function cleanup() {
    overlay.remove();
    selectionEl.remove();
    hint.remove();
    sizeLabel.remove();
    document.removeEventListener('keydown', onKeydown, { capture: true });
    window.__screenshotOverlayActive = false;
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      cleanup();
    }
  }

  document.addEventListener('keydown', onKeydown, { capture: true });

  // Stop propagation on the overlay itself so bubbling click-outside handlers
  // on document never see these events. Capture-phase handlers on the page
  // will still fire but there's no reliable way to block those without
  // also killing our own overlay handlers.
  ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup'].forEach(type => {
    overlay.addEventListener(type, e => {
      e.stopPropagation();
    });
  });

  overlay.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    isSelecting = true;

    hint.style.display = 'none';
    overlay.style.background = 'transparent';
    selectionEl.style.display = 'block';
    sizeLabel.style.display = 'block';

    updateSelection(startX, startY);
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;
    updateSelection(e.clientX, e.clientY);
  });

  overlay.addEventListener('mouseup', (e) => {
    if (!isSelecting) return;
    isSelecting = false;

    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    if (w < 5 || h < 5) {
      cleanup();
      return;
    }

    cleanup();

    chrome.runtime.sendMessage({
      action: 'regionSelected',
      rect: { x, y, w, h, dpr: window.devicePixelRatio || 1 }
    });
  });

  function updateSelection(cx, cy) {
    const x = Math.min(startX, cx);
    const y = Math.min(startY, cy);
    const w = Math.abs(cx - startX);
    const h = Math.abs(cy - startY);

    selectionEl.style.left = x + 'px';
    selectionEl.style.top = y + 'px';
    selectionEl.style.width = w + 'px';
    selectionEl.style.height = h + 'px';
    selectionEl.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.15)';

    const labelX = x;
    const labelY = y + h + 6;
    const labelFlip = labelY + 24 > window.innerHeight;
    sizeLabel.style.left = labelX + 'px';
    sizeLabel.style.top = (labelFlip ? y - 24 : labelY) + 'px';
    sizeLabel.textContent = `${Math.round(w)} × ${Math.round(h)}`;
  }
}
