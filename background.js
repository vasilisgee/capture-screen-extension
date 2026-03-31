let pendingOutput = 'download';
let pendingWindowId = null;
let pendingFrame = { enabled: false };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'captureViewport') {
    chrome.tabs.update(msg.tabId, { active: true }, () => {
      chrome.windows.update(msg.windowId, { focused: true }, () => {
        setTimeout(() => {
          captureViewport(msg.tabId, msg.windowId, msg.output, msg.frame).catch(console.error);
        }, 200);
      });
    });
  } else if (msg.action === 'startRegion') {
    pendingOutput = msg.output;
    pendingWindowId = msg.windowId;
    pendingFrame = msg.frame || { enabled: false };
    startRegion(msg.tabId).catch(console.error);
  } else if (msg.action === 'regionSelected') {
    regionCapture(
      sender.tab.id,
      sender.tab.windowId || pendingWindowId,
      msg.rect,
      pendingOutput,
      pendingFrame
    ).catch(console.error);
  } else if (msg.action === 'captureFullPage') {
    captureFullPage(msg.tabId, msg.output, msg.frame).catch(console.error);
  }
  return true;
});

// --- Captures ---

async function captureViewport(tabId, windowId, output, frame) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const s = document.createElement('style');
      s.id = '__ss-noscroll';
      s.textContent = '::-webkit-scrollbar{display:none!important}html,body{scrollbar-width:none!important}';
      document.documentElement.appendChild(s);
    }
  });
  await new Promise(r => setTimeout(r, 60));
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.getElementById('__ss-noscroll')?.remove()
  });
  await processOutput(tabId, dataUrl, null, output, frame);
}

async function startRegion(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) {
    console.error('Injection failed:', e.message);
  }
}

async function regionCapture(tabId, windowId, rect, output, frame) {
  await new Promise(r => setTimeout(r, 150));
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  await processOutput(tabId, dataUrl, rect, output, frame);
}

async function captureFullPage(tabId, output, frame) {
  const debugTarget = { tabId };
  try {
    await chrome.debugger.attach(debugTarget, '1.3');

    const { result } = await chrome.debugger.sendCommand(debugTarget, 'Runtime.evaluate', {
      expression: `({
        width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        devicePixelRatio: window.devicePixelRatio || 1
      })`,
      returnByValue: true
    });

    const { width, height, devicePixelRatio } = result.value;

    await chrome.debugger.sendCommand(debugTarget, 'Runtime.evaluate', {
      expression: `(function(){const s=document.createElement('style');s.id='__ss-noscroll';s.textContent='::-webkit-scrollbar{display:none!important}html,body{scrollbar-width:none!important}';document.documentElement.appendChild(s);})()`
    });

    await chrome.debugger.sendCommand(debugTarget, 'Emulation.setDeviceMetricsOverride', {
      width: Math.ceil(width), height: Math.ceil(height),
      deviceScaleFactor: devicePixelRatio, mobile: false
    });

    await new Promise(r => setTimeout(r, 100));

    const { data } = await chrome.debugger.sendCommand(debugTarget, 'Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: devicePixelRatio }
    });

    await chrome.debugger.sendCommand(debugTarget, 'Emulation.clearDeviceMetricsOverride', {});
    await chrome.debugger.sendCommand(debugTarget, 'Runtime.evaluate', {
      expression: `document.getElementById('__ss-noscroll')?.remove()`
    });
    await chrome.debugger.detach(debugTarget);

    await processOutput(tabId, `data:image/png;base64,${data}`, null, output, frame);
  } catch (e) {
    console.error('Full page capture failed:', e.message);
    try { await chrome.debugger.detach(debugTarget); } catch {}
  }
}

// --- Output routing ---

async function processOutput(tabId, dataUrl, rect, output, frame) {
  if (output === 'download') {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: applyFrameAndDownload,
      args: [dataUrl, rect || null, `screenshot-${Date.now()}.png`, frame || { enabled: false }]
    });
    return;
  }

  if (output === 'copy') {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: rect ? cropAndCopy : copyFromDataUrl,
      args: rect ? [dataUrl, rect] : [dataUrl]
    });
  }
}

// --- Injected page functions ---

function applyFrameAndDownload(dataUrl, rect, filename, frame) {
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,     x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x,     y + h, x,     y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x,     y,     x + r, y,         r);
    ctx.closePath();
  }

  function showToast(type, message) {
    const id = '__ss-toast';
    if (document.getElementById(id)) return;
    const t = document.createElement('div');
    t.id = id;
    const isError = type === 'error';
    t.style.cssText = [
      'position:fixed','top:16px','right:16px',
      'transform:translateY(-8px)',
      'font-family:system-ui,sans-serif','font-size:13px',
      'padding:10px 12px','border-radius:8px',
      'z-index:2147483647','pointer-events:none',
      'display:flex','align-items:center','gap:9px',
      'opacity:0','transition:opacity 0.15s ease, transform 0.15s ease',
      isError
        ? 'background:#222224;color:#ffffff;border:1px solid rgba(242,139,130,0.3)'
        : 'background:#222224;color:#ffffff;border:1px solid rgba(5,138,87,0.35)'
    ].join(';');
    const icon = isError
      ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0"><circle cx="7" cy="7" r="6.5" stroke="#f28b82" stroke-width="1.2"/><path d="M7 4 L7 7.5" stroke="#f28b82" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="9.5" r="0.7" fill="#f28b82"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0"><circle cx="7" cy="7" r="6.5" stroke="#1D9E75" stroke-width="1.2"/><path d="M4 7 L6 9 L10 5" stroke="#1D9E75" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    t.innerHTML = '<div style="width:21px;height:21px;min-width:21px;border-radius:50%;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0">' + icon + '</div>' + message;
    document.documentElement.appendChild(t);
    requestAnimationFrame(() => {
      t.style.opacity = '1';
      t.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(-8px)';
      setTimeout(() => t.remove(), 200);
    }, 5000);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const dpr         = (rect && rect.dpr) || 1;
      const srcX        = rect ? Math.round(rect.x * dpr) : 0;
      const srcY        = rect ? Math.round(rect.y * dpr) : 0;
      const srcW        = rect ? Math.round(rect.w * dpr) : img.naturalWidth;
      const srcH        = rect ? Math.round(rect.h * dpr) : img.naturalHeight;

      const f           = frame && frame.enabled;
      const radius      = f ? (frame.radius      || 0)         : 0;
      const borderWidth = f ? (frame.borderWidth || 0)         : 0;
      const borderColor = f ? (frame.borderColor || '#ffffff') : '#ffffff';
      const shadowBlur  = f ? (frame.shadowBlur  || 0)         : 0;
      const shadowColor = f ? (frame.shadowColor || '#000000') : '#000000';

      // Expand canvas so shadow is never clipped
      // Extra bottom accounts for shadowOffsetY
      const shadowOffsetY = f && shadowBlur > 0 ? Math.round(shadowBlur * 0.4) : 0;
      const padBase = f ? Math.ceil(shadowBlur * 2) + borderWidth + 4 : 0;
      const padTop    = padBase;
      const padSide   = padBase;
      const padBottom = padBase + shadowOffsetY;

      const canvas = document.createElement('canvas');
      canvas.width  = srcW + padSide * 2;
      canvas.height = srcH + padTop + padBottom;
      const ctx = canvas.getContext('2d');

      // 1. Draw shadow as a filled shape BEFORE clipping (clip kills shadow otherwise)
      if (f && shadowBlur > 0) {
        ctx.save();
        ctx.shadowBlur    = shadowBlur * 2;
        ctx.shadowColor   = shadowColor;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = shadowOffsetY;
        ctx.fillStyle     = '#000'; // fill colour doesn't matter — will be covered by image
        rrect(ctx, padSide, padTop, srcW, srcH, radius);
        ctx.fill();
        ctx.restore();
      }

      // 2. Draw image with clip (no shadow here)
      ctx.save();
      if (radius > 0) {
        rrect(ctx, padSide, padTop, srcW, srcH, radius);
        ctx.clip();
      }
      ctx.drawImage(img, srcX, srcY, srcW, srcH, padSide, padTop, srcW, srcH);
      ctx.restore();

      // 3. Border
      if (f && borderWidth > 0) {
        ctx.save();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth   = borderWidth;
        const inset = borderWidth / 2;
        if (radius > 0) {
          rrect(ctx, padSide + inset, padTop + inset, srcW - borderWidth, srcH - borderWidth, Math.max(0, radius - inset));
        } else {
          ctx.beginPath();
          ctx.rect(padSide + inset, padTop + inset, srcW - borderWidth, srcH - borderWidth);
        }
        ctx.stroke();
        ctx.restore();
      }

      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = filename;
      document.documentElement.appendChild(a);
      a.click();
      a.remove();
      showToast('success', 'Screenshot downloaded');
      resolve();
    };
    img.src = dataUrl;
  });
}
function copyFromDataUrl(dataUrl) {
  function showToast(type, message) {
    const id = '__ss-toast';
    if (document.getElementById(id)) return;
    const t = document.createElement('div');
    t.id = id;
    const isError = type === 'error';
    t.style.cssText = [
      'position:fixed','top:16px','right:16px',
      'transform:translateY(-8px)',
      'font-family:system-ui,sans-serif','font-size:13px',
      'padding:10px 12px','border-radius:8px',
      'z-index:2147483647','pointer-events:none',
      'display:flex','align-items:center','gap:9px',
      'opacity:0','transition:opacity 0.15s ease, transform 0.15s ease',
      isError
        ? 'background:#222224;color:#ffffff;border:1px solid rgba(242,139,130,0.3)'
        : 'background:#222224;color:#ffffff;border:1px solid rgba(138,180,248,0.3)'
    ].join(';');
    const icon = isError
      ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0"><circle cx="7" cy="7" r="6.5" stroke="#f28b82" stroke-width="1.2"/><path d="M7 4 L7 7.5" stroke="#f28b82" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="9.5" r="0.7" fill="#f28b82"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0"><circle cx="7" cy="7" r="6.5" stroke="#8ab4f8" stroke-width="1.2"/><path d="M4 7 L6 9 L10 5" stroke="#8ab4f8" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    t.innerHTML = '<div style="width:21px;height:21px;min-width:21px;border-radius:50%;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0">' + icon + '</div>' + message;
    document.documentElement.appendChild(t);
    requestAnimationFrame(() => {
      t.style.opacity = '1';
      t.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(-8px)';
      setTimeout(() => t.remove(), 200);
    }, 5000);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob(blob => {
        navigator.clipboard
          .write([new ClipboardItem({ 'image/png': blob })])
          .then(() => { showToast('success', 'Copied to clipboard'); resolve(); })
          .catch(() => { showToast('error', 'Failed to copy'); reject(); });
      });
    };
    img.src = dataUrl;
  });
}

function cropAndCopy(dataUrl, rect) {
  function showToast(type, message) {
    const id = '__ss-toast';
    if (document.getElementById(id)) return;
    const t = document.createElement('div');
    t.id = id;
    const isError = type === 'error';
    t.style.cssText = [
      'position:fixed','top:16px','right:16px',
      'transform:translateY(-8px)',
      'font-family:system-ui,sans-serif','font-size:13px',
      'padding:10px 12px','border-radius:8px',
      'z-index:2147483647','pointer-events:none',
      'display:flex','align-items:center','gap:9px',
      'opacity:0','transition:opacity 0.15s ease, transform 0.15s ease',
      isError
        ? 'background:#222224;color:#ffffff;border:1px solid rgba(242,139,130,0.3)'
        : 'background:#222224;color:#ffffff;border:1px solid rgba(138,180,248,0.3)'
    ].join(';');
    const icon = isError
      ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0"><circle cx="7" cy="7" r="6.5" stroke="#f28b82" stroke-width="1.2"/><path d="M7 4 L7 7.5" stroke="#f28b82" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="9.5" r="0.7" fill="#f28b82"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0"><circle cx="7" cy="7" r="6.5" stroke="#8ab4f8" stroke-width="1.2"/><path d="M4 7 L6 9 L10 5" stroke="#8ab4f8" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    t.innerHTML = '<div style="width:21px;height:21px;min-width:21px;border-radius:50%;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0">' + icon + '</div>' + message;
    document.documentElement.appendChild(t);
    requestAnimationFrame(() => {
      t.style.opacity = '1';
      t.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(-8px)';
      setTimeout(() => t.remove(), 200);
    }, 5000);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const dpr = rect.dpr || 1;
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(rect.w * dpr);
      canvas.height = Math.round(rect.h * dpr);
      canvas.getContext('2d').drawImage(
        img,
        Math.round(rect.x * dpr), Math.round(rect.y * dpr),
        canvas.width, canvas.height,
        0, 0, canvas.width, canvas.height
      );
      canvas.toBlob(blob => {
        navigator.clipboard
          .write([new ClipboardItem({ 'image/png': blob })])
          .then(() => { showToast('success', 'Copied to clipboard'); resolve(); })
          .catch(() => { showToast('error', 'Failed to copy'); reject(); });
      });
    };
    img.src = dataUrl;
  });
}
