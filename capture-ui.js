import { portraitRotationFor, rotatedSize } from './image-orientation-core.js';
import { CAPTURE_MODE_SINGLE, CAPTURE_MODE_SPLIT, acceptedIncomingCount, normalizeCaptureMode, splitStatus } from './capture-multishot-core.js';

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
    <p id="captureModeHelp" class="capture-mode-help">通常はこちら。注文票全体を1枚で撮影します。</p>
    <div class="capture-source-actions">
      <button type="button" id="captureCameraBtn" class="primary-btn capture-source-btn">カメラで撮る</button>
      <button type="button" id="captureGalleryBtn" class="secondary-btn capture-source-btn">写真から選ぶ</button>
    </div>
    <div id="splitCaptureGuide" class="split-capture-guide" hidden>
      <strong id="splitCaptureStatus">① 上半分を撮影してください</strong>
      <span>中央付近を少し重ねて、上→下の順に撮ると読み取りやすくなります。</span>
      <div id="splitPartPreviews" class="split-part-previews"></div>
      <button type="button" id="splitResetBtn" class="text-button">2枚撮影をやり直す</button>
    </div>
    <input id="captureCameraInput" class="capture-hidden-input" type="file" accept="image/*" capture="environment">
    <input id="captureGalleryInput" class="capture-hidden-input" type="file" accept="image/*" multiple>
  `;
  legacyBox.insertAdjacentElement('afterend', panel);

  const cameraInput = panel.querySelector('#captureCameraInput');
  const galleryInput = panel.querySelector('#captureGalleryInput');
  const cameraBtn = panel.querySelector('#captureCameraBtn');
  const galleryBtn = panel.querySelector('#captureGalleryBtn');
  const modeHelp = panel.querySelector('#captureModeHelp');
  const splitGuide = panel.querySelector('#splitCaptureGuide');
  const splitStatusEl = panel.querySelector('#splitCaptureStatus');
  const partPreviews = panel.querySelector('#splitPartPreviews');
  const resetBtn = panel.querySelector('#splitResetBtn');

  let mode = CAPTURE_MODE_SINGLE;
  let splitParts = [];
  let partObjectUrls = [];

  function revokePartUrls() {
    partObjectUrls.forEach(url => URL.revokeObjectURL(url));
    partObjectUrls = [];
  }

  function assignToSink(files) {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    sink.files = transfer.files;
    sink.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clearSink() {
    try { assignToSink([]); } catch {
      sink.value = '';
      sink.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function markPickerOpen() {
    sink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function renderSplitParts() {
    revokePartUrls();
    partPreviews.innerHTML = splitParts.map((file, index) => {
      const url = URL.createObjectURL(file);
      partObjectUrls.push(url);
      return `<figure><img src="${url}" alt="${index === 0 ? '上半分' : '下半分'}"><figcaption>${index === 0 ? '上半分' : '下半分'}</figcaption></figure>`;
    }).join('');
    const status = splitStatus(splitParts.length);
    splitStatusEl.textContent = status.label;
    cameraBtn.textContent = splitParts.length === 0 ? '① 上半分を撮る' : splitParts.length === 1 ? '② 下半分を撮る' : '撮り直す';
    galleryBtn.textContent = splitParts.length < 2 ? '写真から選ぶ' : '写真を選び直す';
  }

  function setMode(nextMode) {
    mode = normalizeCaptureMode(nextMode);
    splitParts = [];
    clearSink();
    panel.querySelectorAll('[data-capture-mode]').forEach(button => button.classList.toggle('is-active', button.dataset.captureMode === mode));
    const split = mode === CAPTURE_MODE_SPLIT;
    splitGuide.hidden = !split;
    modeHelp.textContent = split
      ? '文字が小さい時におすすめ。上半分と下半分を別々に撮影し、自動で1枚にまとめます。'
      : '通常はこちら。注文票全体を1枚で撮影します。';
    cameraBtn.textContent = split ? '① 上半分を撮る' : 'カメラで撮る';
    galleryBtn.textContent = '写真から選ぶ';
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

  async function acceptFiles(fileList) {
    const incoming = Array.from(fileList || []).filter(file => file.type.startsWith('image/'));
    if (!incoming.length) return;
    if (mode === CAPTURE_MODE_SINGLE) {
      splitParts = [];
      assignToSink([incoming[0]]);
      return;
    }

    if (splitParts.length >= 2) splitParts = [];
    const count = acceptedIncomingCount(mode, splitParts.length, incoming.length);
    splitParts.push(...incoming.slice(0, count));
    renderSplitParts();
    clearSink();
    if (splitParts.length === 2) {
      try {
        splitStatusEl.textContent = '上下2枚を結合しています…';
        const combined = await combineSplitParts(splitParts);
        assignToSink([combined]);
        splitStatusEl.textContent = '上下2枚を1枚にまとめました';
      } catch (error) {
        splitStatusEl.textContent = '画像をまとめられませんでした。もう一度撮影してください。';
        console.warn(error);
      }
    }
  }

  panel.querySelectorAll('[data-capture-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.captureMode)));
  cameraBtn.addEventListener('click', () => {
    if (mode === CAPTURE_MODE_SPLIT && splitParts.length >= 2) setMode(CAPTURE_MODE_SPLIT);
    cameraInput.value = '';
    markPickerOpen();
    cameraInput.click();
  });
  galleryBtn.addEventListener('click', () => {
    if (mode === CAPTURE_MODE_SPLIT && splitParts.length >= 2) setMode(CAPTURE_MODE_SPLIT);
    galleryInput.value = '';
    galleryInput.multiple = mode === CAPTURE_MODE_SPLIT;
    markPickerOpen();
    galleryInput.click();
  });
  cameraInput.addEventListener('change', event => void acceptFiles(event.target.files));
  galleryInput.addEventListener('change', event => void acceptFiles(event.target.files));
  resetBtn.addEventListener('click', () => setMode(CAPTURE_MODE_SPLIT));
  globalThis.addEventListener('beforeunload', revokePartUrls);
  setMode(CAPTURE_MODE_SINGLE);
}
