import { portraitRotationFor, rotatedSize } from './image-orientation-core.js';
import { CAPTURE_MODE_SINGLE, CAPTURE_MODE_SPLIT, captureModeUi, normalizeCaptureMode } from './capture-multishot-core.js';

const sink = document.querySelector('#imageInput');
const legacyBox = sink?.closest('.upload-box');

if (sink && legacyBox) {
  legacyBox.classList.add('legacy-capture-hidden');
  const panel = document.createElement('section');
  panel.className = 'capture-source-panel';
  panel.innerHTML = `
    <div class="capture-mode-switch" role="group" aria-label="撮影方法">
      <button type="button" class="capture-mode-btn is-active" data-capture-mode="single">1枚で撮る</button>
      <button type="button" class="capture-mode-btn" data-capture-mode="split">上下2枚に分ける</button>
    </div>
    <p id="captureModeHelp" class="capture-mode-help">注文票全体を1枚で撮影します。</p>

    <div id="singleCaptureActions" class="capture-source-actions">
      <button type="button" id="singleCameraBtn" class="primary-btn capture-source-btn">カメラで撮る</button>
      <button type="button" id="singleGalleryBtn" class="secondary-btn capture-source-btn">写真から選ぶ</button>
    </div>

    <div id="splitCaptureGuide" class="split-capture-guide" hidden>
      <strong id="splitCaptureStatus">① 上半分を撮影してください</strong>
      <span>中央付近を少し重ねて、上→下の順に撮ると読み取りやすくなります。</span>
      <div class="split-capture-actions">
        <button type="button" id="splitTopCameraBtn" class="primary-btn capture-source-btn">① 上半分を撮る</button>
        <button type="button" id="splitBottomCameraBtn" class="primary-btn capture-source-btn" disabled>② 下半分を撮る</button>
        <button type="button" id="splitGalleryBtn" class="secondary-btn capture-source-btn">写真から2枚選ぶ</button>
      </div>
      <div id="splitPartPreviews" class="split-part-previews"></div>
      <button type="button" id="splitResetBtn" class="text-button">2枚撮影をやり直す</button>
    </div>

    <input id="singleCameraInput" data-capture-picker class="capture-hidden-input" type="file" accept="image/*" capture="environment">
    <input id="splitTopCameraInput" data-capture-picker class="capture-hidden-input" type="file" accept="image/*" capture="environment">
    <input id="splitBottomCameraInput" data-capture-picker class="capture-hidden-input" type="file" accept="image/*" capture="environment">
    <input id="captureGalleryInput" data-capture-picker class="capture-hidden-input" type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif">
  `;
  legacyBox.insertAdjacentElement('afterend', panel);

  const singleActions = panel.querySelector('#singleCaptureActions');
  const singleCameraBtn = panel.querySelector('#singleCameraBtn');
  const singleGalleryBtn = panel.querySelector('#singleGalleryBtn');
  const splitGuide = panel.querySelector('#splitCaptureGuide');
  const splitStatusEl = panel.querySelector('#splitCaptureStatus');
  const splitTopCameraBtn = panel.querySelector('#splitTopCameraBtn');
  const splitBottomCameraBtn = panel.querySelector('#splitBottomCameraBtn');
  const splitGalleryBtn = panel.querySelector('#splitGalleryBtn');
  const modeHelp = panel.querySelector('#captureModeHelp');
  const partPreviews = panel.querySelector('#splitPartPreviews');
  const resetBtn = panel.querySelector('#splitResetBtn');
  const singleCameraInput = panel.querySelector('#singleCameraInput');
  const splitTopCameraInput = panel.querySelector('#splitTopCameraInput');
  const splitBottomCameraInput = panel.querySelector('#splitBottomCameraInput');
  const galleryInput = panel.querySelector('#captureGalleryInput');

  let mode = CAPTURE_MODE_SINGLE;
  let splitParts = [];
  let partObjectUrls = [];
  let combineGeneration = 0;

  function revokePartUrls() {
    partObjectUrls.forEach(url => URL.revokeObjectURL(url));
    partObjectUrls = [];
  }

  function notifyPickerOpen() {
    globalThis.dispatchEvent(new CustomEvent('order-sheet-picker-open'));
  }

  function notifyPickerClose() {
    globalThis.dispatchEvent(new CustomEvent('order-sheet-picker-close'));
  }

  function assignToSink(files) {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    sink.files = transfer.files;
    sink.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clearSink({ notify = true } = {}) {
    combineGeneration += 1;
    try {
      const transfer = new DataTransfer();
      sink.files = transfer.files;
    } catch {
      sink.value = '';
    }
    if (notify) sink.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isImageFile(file) {
    if (!file) return false;
    if (String(file.type || '').startsWith('image/')) return true;
    return /\.(?:jpe?g|png|webp|heic|heif)$/i.test(String(file.name || ''));
  }

  function renderSplitParts() {
    const ui = captureModeUi(mode, splitParts.filter(Boolean).length);
    modeHelp.textContent = ui.help;
    singleActions.hidden = ui.split;
    splitGuide.hidden = !ui.split;

    if (!ui.split) {
      revokePartUrls();
      partPreviews.innerHTML = '';
      return;
    }

    splitStatusEl.textContent = ui.status;
    splitBottomCameraBtn.disabled = !splitParts[0];
    splitTopCameraBtn.textContent = splitParts[0] ? '① 上半分を撮り直す' : '① 上半分を撮る';
    splitBottomCameraBtn.textContent = splitParts[1] ? '② 下半分を撮り直す' : '② 下半分を撮る';
    splitGalleryBtn.textContent = splitParts[0] && splitParts[1] ? '写真2枚を選び直す' : '写真から2枚選ぶ';

    revokePartUrls();
    partPreviews.innerHTML = [0, 1].map(index => {
      const file = splitParts[index];
      const label = index === 0 ? '上半分' : '下半分';
      if (!file) return `<div class="split-empty-part"><span>${label}</span><small>未撮影</small></div>`;
      const url = URL.createObjectURL(file);
      partObjectUrls.push(url);
      return `<figure><img src="${url}" alt="${label}"><figcaption>${label}</figcaption></figure>`;
    }).join('');
  }

  function setMode(nextMode) {
    mode = normalizeCaptureMode(nextMode);
    splitParts = [];
    clearSink();
    panel.querySelectorAll('[data-capture-mode]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.captureMode === mode);
    });
    renderSplitParts();
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('画像を読み込めませんでした'));
      };
      image.src = url;
    });
  }

  function drawOriented(ctx, image, x, y, width, height, turns) {
    ctx.save();
    if (turns === 0) {
      ctx.drawImage(image, x, y, width, height);
    } else if (turns === 1) {
      ctx.translate(x + height, y);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(image, 0, 0, width, height);
    } else if (turns === 2) {
      ctx.translate(x + width, y + height);
      ctx.rotate(Math.PI);
      ctx.drawImage(image, 0, 0, width, height);
    } else {
      ctx.translate(x, y + width);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(image, 0, 0, width, height);
    }
    ctx.restore();
  }

  async function preparePart(file) {
    const image = await loadImage(file);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const turns = portraitRotationFor(sourceWidth, sourceHeight, 0);
    const oriented = rotatedSize(sourceWidth, sourceHeight, turns);
    const scale = Math.min(1, 2200 / Math.max(1, oriented.width));
    const baseWidth = Math.max(1, Math.round(sourceWidth * scale));
    const baseHeight = Math.max(1, Math.round(sourceHeight * scale));
    const output = rotatedSize(baseWidth, baseHeight, turns);
    return { image, turns, baseWidth, baseHeight, width: output.width, height: output.height };
  }

  async function combineSplitParts(parts) {
    const prepared = await Promise.all(parts.map(preparePart));
    const width = Math.max(...prepared.map(item => item.width));
    const topLabelHeight = 72;
    const separatorHeight = 112;
    const totalHeight = topLabelHeight + prepared[0].height + separatorHeight + prepared[1].height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2枚の画像を結合できませんでした');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2e6b45';
    ctx.font = '800 30px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('① 注文票 上半分', 28, topLabelHeight / 2);

    const firstX = Math.round((width - prepared[0].width) / 2);
    drawOriented(ctx, prepared[0].image, firstX, topLabelHeight, prepared[0].baseWidth, prepared[0].baseHeight, prepared[0].turns);

    const separatorY = topLabelHeight + prepared[0].height;
    ctx.fillStyle = '#f1f7f3';
    ctx.fillRect(0, separatorY, width, separatorHeight);
    ctx.fillStyle = '#2e6b45';
    ctx.font = '800 28px system-ui, -apple-system, sans-serif';
    ctx.fillText('② 注文票 下半分', 28, separatorY + 38);
    ctx.fillStyle = '#405247';
    ctx.font = '600 22px system-ui, -apple-system, sans-serif';
    ctx.fillText('同じ注文票です。重複して写った行は1回だけ読み取る。', 28, separatorY + 78);

    const secondY = separatorY + separatorHeight;
    const secondX = Math.round((width - prepared[1].width) / 2);
    drawOriented(ctx, prepared[1].image, secondX, secondY, prepared[1].baseWidth, prepared[1].baseHeight, prepared[1].turns);

    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('2枚の画像を結合できませんでした')),
      'image/jpeg',
      0.94
    ));
    return new File([blob], `order-sheet-split-${Date.now()}.jpg`, { type: 'image/jpeg' });
  }

  async function combineAndCommit() {
    if (!splitParts[0] || !splitParts[1]) return;
    const generation = ++combineGeneration;
    const snapshot = [splitParts[0], splitParts[1]];
    splitStatusEl.textContent = '上下2枚を結合しています…';
    try {
      const combined = await combineSplitParts(snapshot);
      if (generation !== combineGeneration || splitParts[0] !== snapshot[0] || splitParts[1] !== snapshot[1]) return;
      assignToSink([combined]);
      splitStatusEl.textContent = '上下2枚を1枚にまとめました';
    } catch (error) {
      if (generation !== combineGeneration) return;
      splitStatusEl.textContent = '画像をまとめられませんでした。撮り直してください。';
      console.warn(error);
    }
  }

  async function acceptSingleFile(file) {
    if (!isImageFile(file)) return;
    splitParts = [];
    assignToSink([file]);
  }

  async function acceptSplitPart(file, index) {
    if (!isImageFile(file)) return;
    if (index === 1 && !splitParts[0]) return;
    splitParts[index] = file;
    clearSink({ notify: false });
    renderSplitParts();
    if (splitParts[0] && splitParts[1]) await combineAndCommit();
  }

  async function acceptGalleryFiles(files) {
    const incoming = Array.from(files || []).filter(isImageFile);
    if (!incoming.length) return;
    if (mode === CAPTURE_MODE_SINGLE) {
      await acceptSingleFile(incoming[0]);
      return;
    }

    if (splitParts[0] && splitParts[1]) {
      splitParts = [];
      clearSink();
    }
    if (incoming.length >= 2) {
      splitParts = [incoming[0], incoming[1]];
    } else if (!splitParts[0]) {
      splitParts[0] = incoming[0];
    } else {
      splitParts[1] = incoming[0];
    }
    clearSink({ notify: false });
    renderSplitParts();
    if (splitParts[0] && splitParts[1]) await combineAndCommit();
  }

  function openCamera(input) {
    input.value = '';
    notifyPickerOpen();
    input.click();
  }

  async function openGallery({ multiple = false } = {}) {
    if (typeof globalThis.showOpenFilePicker === 'function') {
      try {
        notifyPickerOpen();
        const handles = await globalThis.showOpenFilePicker({
          multiple,
          types: [{
            description: '写真',
            accept: {
              'image/jpeg': ['.jpg', '.jpeg'],
              'image/png': ['.png'],
              'image/webp': ['.webp'],
              'image/heic': ['.heic'],
              'image/heif': ['.heif']
            }
          }]
        });
        notifyPickerClose();
        const files = await Promise.all(handles.map(handle => handle.getFile()));
        await acceptGalleryFiles(files);
        return;
      } catch (error) {
        notifyPickerClose();
        if (error?.name === 'AbortError') return;
        console.warn('Native photo picker fallback', error);
      }
    }

    galleryInput.value = '';
    galleryInput.multiple = multiple;
    galleryInput.removeAttribute('capture');
    notifyPickerOpen();
    galleryInput.click();
  }

  panel.querySelectorAll('[data-capture-mode]').forEach(button => {
    button.addEventListener('click', () => setMode(button.dataset.captureMode));
  });

  singleCameraBtn.addEventListener('click', () => {
    clearSink();
    openCamera(singleCameraInput);
  });
  singleGalleryBtn.addEventListener('click', () => {
    clearSink();
    void openGallery({ multiple: false });
  });

  splitTopCameraBtn.addEventListener('click', () => {
    if (splitParts[0] && splitParts[1]) clearSink();
    openCamera(splitTopCameraInput);
  });
  splitBottomCameraBtn.addEventListener('click', () => {
    if (!splitParts[0]) return;
    if (splitParts[1]) clearSink();
    openCamera(splitBottomCameraInput);
  });
  splitGalleryBtn.addEventListener('click', () => void openGallery({ multiple: true }));

  singleCameraInput.addEventListener('change', event => {
    notifyPickerClose();
    void acceptSingleFile(event.target.files?.[0]);
  });
  splitTopCameraInput.addEventListener('change', event => {
    notifyPickerClose();
    void acceptSplitPart(event.target.files?.[0], 0);
  });
  splitBottomCameraInput.addEventListener('change', event => {
    notifyPickerClose();
    void acceptSplitPart(event.target.files?.[0], 1);
  });
  galleryInput.addEventListener('change', event => {
    notifyPickerClose();
    void acceptGalleryFiles(event.target.files);
  });

  resetBtn.addEventListener('click', () => setMode(CAPTURE_MODE_SPLIT));
  globalThis.addEventListener('beforeunload', revokePartUrls);
  setMode(CAPTURE_MODE_SINGLE);
}
