document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const stored = await chrome.storage.local.get([
    'outputMode', 'frameEnabled', 'frameRadius', 'frameBorderWidth',
    'frameBorderColor', 'frameShadowBlur', 'frameShadowColor'
  ]);

  const outputMode    = stored.outputMode       ?? 'download';
  const frameEnabled  = stored.frameEnabled     ?? false;
  const frameRadius   = stored.frameRadius      ?? 12;
  const borderWidth   = stored.frameBorderWidth ?? 1;
  const borderColor   = stored.frameBorderColor ?? '#ffffff';
  const shadowBlur    = stored.frameShadowBlur  ?? 24;
  const shadowColor   = stored.frameShadowColor ?? '#000000';

  // --- Output toggle ---
  setOutput(outputMode);
  document.getElementById('opt-download').addEventListener('click', () => setOutput('download'));
  document.getElementById('opt-copy').addEventListener('click', () => setOutput('copy'));

  function setOutput(val) {
    document.getElementById('opt-download').classList.toggle('active', val === 'download');
    document.getElementById('opt-copy').classList.toggle('active', val === 'copy');
    document.getElementById('frame-section').classList.toggle('visible', val === 'download');
    if (val === 'copy') {
      setFrameSwitch(false);
    }
    chrome.storage.local.set({ outputMode: val });
  }

  // --- Frame toggle ---
  setFrameSwitch(frameEnabled);
  document.getElementById('frame-switch').addEventListener('click', () => {
    const next = !document.getElementById('frame-switch').classList.contains('on');
    setFrameSwitch(next);
    chrome.storage.local.set({ frameEnabled: next });
  });

  function setFrameSwitch(on) {
    document.getElementById('frame-switch').classList.toggle('on', on);
    document.getElementById('frame-controls').classList.toggle('visible', on);
  }

  // --- Frame controls ---
  bindSlider('radius-slider', 'radius-val', frameRadius, 'frameRadius', 'px');
  bindSlider('border-width-slider', 'border-width-val', borderWidth, 'frameBorderWidth', 'px');
  bindSlider('shadow-blur-slider', 'shadow-blur-val', shadowBlur, 'frameShadowBlur', 'px');
  bindColor('border-color', 'border-color-btn', 'border-color-hex', borderColor, 'frameBorderColor');
  bindColor('shadow-color', 'shadow-color-btn', 'shadow-color-hex', shadowColor, 'frameShadowColor');

  function bindSlider(sliderId, valId, initial, storageKey, unit) {
    const slider = document.getElementById(sliderId);
    const label  = document.getElementById(valId);
    slider.value = initial;
    label.textContent = initial + unit;
    slider.addEventListener('input', () => {
      label.textContent = slider.value + unit;
      chrome.storage.local.set({ [storageKey]: Number(slider.value) });
    });
  }

  function bindColor(inputId, btnId, hexId, initial, storageKey) {
    const input = document.getElementById(inputId);
    const btn   = document.getElementById(btnId);
    const hex   = document.getElementById(hexId);
    input.value = initial;
    btn.style.background = initial;
    hex.textContent = initial;
    input.addEventListener('input', () => {
      btn.style.background = input.value;
      hex.textContent = input.value;
      chrome.storage.local.set({ [storageKey]: input.value });
    });
  }

  // --- Restricted page check ---
  const restricted = isRestricted(tab.url);
  if (restricted) {
    document.getElementById('restricted-notice').style.display = 'flex';
    ['btn-viewport', 'btn-region', 'btn-fullpage'].forEach(id => {
      const el = document.getElementById(id);
      el.style.opacity = '0.35';
      el.style.cursor = 'not-allowed';
      el.style.pointerEvents = 'none';
    });
  }

  function isRestricted(url = '') {
    return (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('https://chrome.google.com/webstore') ||
      url === '' || url === 'about:blank'
    );
  }

  // --- Capture buttons ---
  const getOutput = () =>
    document.getElementById('opt-copy').classList.contains('active') ? 'copy' : 'download';

  const getFrameOptions = async () => {
    const s = await chrome.storage.local.get([
      'frameEnabled', 'frameRadius', 'frameBorderWidth',
      'frameBorderColor', 'frameShadowBlur', 'frameShadowColor'
    ]);
    return {
      enabled:     s.frameEnabled     ?? false,
      radius:      s.frameRadius      ?? 12,
      borderWidth: s.frameBorderWidth ?? 1,
      borderColor: s.frameBorderColor ?? '#ffffff',
      shadowBlur:  s.frameShadowBlur  ?? 24,
      shadowColor: s.frameShadowColor ?? '#000000',
    };
  };

  document.getElementById('btn-viewport').addEventListener('click', async () => {
    if (restricted) return;
    const frame = getOutput() === 'download' ? await getFrameOptions() : { enabled: false };
    chrome.runtime.sendMessage({ action: 'captureViewport', output: getOutput(), tabId: tab.id, windowId: tab.windowId, frame });
    window.close();
  });

  document.getElementById('btn-region').addEventListener('click', async () => {
    if (restricted) return;
    const frame = getOutput() === 'download' ? await getFrameOptions() : { enabled: false };
    chrome.runtime.sendMessage({ action: 'startRegion', output: getOutput(), tabId: tab.id, windowId: tab.windowId, frame });
    window.close();
  });

  document.getElementById('btn-fullpage').addEventListener('click', async () => {
    if (restricted) return;
    const frame = getOutput() === 'download' ? await getFrameOptions() : { enabled: false };
    chrome.runtime.sendMessage({ action: 'captureFullPage', output: getOutput(), tabId: tab.id, windowId: tab.windowId, frame });
    window.close();
  });
});
