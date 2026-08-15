import { OrderDb } from './db.js';
import { aggregateRecognitions, parseAnalysisPayload, rankCandidates, resolveRecognitionItem, uid } from './lib.js';
import { analyzeWithBackend, buildPrompt, SAMPLE_ANALYSIS, setShareImageRotation, shareToChatGPT } from './ai.js';
import { restoreActionScan } from './action-return.js';
import { getActiveScanId } from './scan-session.js';
import { insertRecognitionAfter, removeRecognition, restoreRecognition } from './review-edit-core.js';
import { buildSessionSnapshot, cloneValue, findResumeSession, groupRecognitions, recentRestorableSessions } from './session-history-core.js';
import { AeonCatalogDb } from './catalog-db.js';
import { setupReviewReorder } from './review-reorder-v18.js';

const db = new OrderDb();
const catalogDb = new AeonCatalogDb();
let catalogInitPromise = null;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const state = {
  files: [],
  recognitions: [],
  expanded: new Set(),
  sessionId: uid('session'),
  scanId: '',
  source: '',
  rawPayload: '',
  writerTag: '',
  imageFlip180: false,
  installPrompt: null,
  catalogReady: false,
  catalogMeta: null
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toast(message, type = 'info') {
  const el = $('#toast');
  el.classList.remove('has-action');
  el.replaceChildren(document.createTextNode(message));
  el.dataset.type = type;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function toastWithUndo(message, onUndo) {
  const el = $('#toast');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toast-undo';
  button.textContent = '元に戻す';
  el.replaceChildren(document.createTextNode(message), button);
  el.dataset.type = 'info';
  el.classList.add('show', 'has-action');
  clearTimeout(toast.timer);
  const dismiss = () => el.classList.remove('show', 'has-action');
  button.addEventListener('click', () => {
    clearTimeout(toast.timer);
    dismiss();
    onUndo?.();
  }, { once: true });
  toast.timer = setTimeout(dismiss, 5200);
}

function formatConfidence(value = 0) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatSessionDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}


function setCatalogStatus(message, stateName = '') {
  const element = $('#catalogStatus');
  if (!element) return;
  element.textContent = message;
  element.dataset.state = stateName;
}

async function initCatalog({ force = false } = {}) {
  if (force) catalogInitPromise = null;
  if (catalogInitPromise) return catalogInitPromise;
  catalogInitPromise = (async () => {
    try {
      setCatalogStatus('イオン綾川の商品カタログを準備しています…', 'loading');
      const meta = await catalogDb.ensureReady({
        force,
        onProgress: ({ loaded, total, status }) => {
          if (status === 'offline-ready') {
            setCatalogStatus('保存済みカタログをオフラインで利用中', 'ready');
            return;
          }
          if (!total || status === 'ready') return;
          const percent = Math.min(100, Math.round((loaded / total) * 100));
          setCatalogStatus(`商品カタログを準備中… ${percent}%`, 'loading');
        }
      });
      state.catalogReady = true;
      state.catalogMeta = meta;
      const previous = db.data.catalogMeta || {};
      if (previous.provider !== 'aeon-ayagawa' || Number(previous.itemCount) !== Number(meta.count) || previous.catalogVersion !== meta.catalogVersion) {
        db.updateCatalogMeta({
          provider: 'aeon-ayagawa',
          itemCount: Number(meta.count || 0),
          importedAt: meta.importedAt || null,
          catalogVersion: meta.catalogVersion || '',
          storeId: meta.storeId || '',
          storage: 'separate-indexeddb'
        });
      }
      setCatalogStatus(`イオン綾川 ${Number(meta.count || 0).toLocaleString('ja-JP')}商品を利用できます`, 'ready');
      renderDataStats();
      return meta;
    } catch (error) {
      state.catalogReady = false;
      setCatalogStatus('商品カタログを準備できませんでした。通常の学習DBだけで利用できます。', 'error');
      console.warn('AEON catalog init failed', error);
      throw error;
    }
  })();
  return catalogInitPromise;
}

function importCatalogProduct(candidate) {
  if (!candidate?.jan || !candidate?.name) return null;
  const product = db.addProduct(candidate.name, '', {
    jan: candidate.jan,
    source: 'aeon-ayagawa',
    category: candidate.category || '',
    catalogVersion: state.catalogMeta?.catalogVersion || ''
  });
  renderHeaderStats();
  return product;
}

async function refreshCatalogCandidates(item, { rerender = true } = {}) {
  if (!item?.rawName?.trim()) {
    if (item) item.catalogCandidates = [];
    return [];
  }
  try {
    await initCatalog();
    const candidates = await catalogDb.search(item.rawName, 5);
    if (!state.recognitions.some(recognition => recognition.id === item.id)) return candidates;
    item.catalogCandidates = candidates;
    if (rerender && state.expanded.has(item.id)) renderReview();
    return candidates;
  } catch {
    item.catalogCandidates = [];
    return [];
  }
}

async function hydratePendingCatalogCandidates() {
  if (!state.recognitions.length) return;
  try {
    await initCatalog();
  } catch {
    return;
  }
  const targets = state.recognitions.filter(item => item.status !== 'confirmed' && Number(item.suggestedScore || 0) < 0.64 && item.rawName?.trim()).slice(0, 60);
  for (const item of targets) await refreshCatalogCandidates(item, { rerender: false });
  if (targets.length) renderReview();
}

function setTab(name) {
  $$('.tab-button').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
  $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
  if (name === 'products') renderProducts();
  if (name === 'data') renderDataStats();
}

function renderHeaderStats() {
  $('#productCount').textContent = db.data.products.length;
  $('#aliasCount').textContent = db.data.aliases.length;
  $('#learnedCount').textContent = db.data.recognitionHistory.filter(h => h.status === 'confirmed').length;
}

function renderFiles() {
  const container = $('#filePreviews');
  if (!state.files.length) {
    container.innerHTML = '<div class="empty-mini">注文票を撮影してください</div>';
    $('#rotateImageBtn')?.setAttribute('hidden', '');
    return;
  }
  container.innerHTML = state.files.map((file, index) => {
    const url = URL.createObjectURL(file);
    const transform = state.imageFlip180 ? ' style="transform:rotate(180deg)"' : '';
    return `<figure class="preview-card compact-preview">
      <img src="${url}" alt="注文票 ${index + 1}"${transform}>
      <figcaption>${escapeHtml(file.name || `画像 ${index + 1}`)}</figcaption>
    </figure>`;
  }).join('');
  if (state.files.length === 1) $('#rotateImageBtn')?.removeAttribute('hidden');
}

function setFiles(fileList) {
  state.files = Array.from(fileList || []).filter(file => file.type.startsWith('image/'));
  state.imageFlip180 = false;
  setShareImageRotation(0);
  renderFiles();
  $('#selectedCount').textContent = `${state.files.length}枚`;
  if (state.files.length) {
    $('#captureCard')?.classList.add('is-complete');
    setTimeout(() => $('#step2Card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 180);
  }
}

function toggleImageFlip() {
  if (!state.files.length) return;
  state.imageFlip180 = !state.imageFlip180;
  setShareImageRotation(state.imageFlip180 ? 2 : 0);
  renderFiles();
  toast(state.imageFlip180 ? '送信画像を180°回転します' : '画像の回転を元に戻しました');
}

function currentWriterTag() {
  const tag = ($('#writerTag')?.value || '').trim();
  state.writerTag = tag;
  if (tag) db.addWriter(tag);
  return tag;
}

function enrichPromptText() {
  const prompt = buildPrompt();
  if ($('#promptPreview')) $('#promptPreview').value = prompt;
  return prompt;
}

async function copyPrompt() {
  await navigator.clipboard.writeText(enrichPromptText());
  toast('復旧用の解析指示をコピーしました');
}

async function sendToChatGPT() {
  if (!state.files.length) {
    toast('先に注文票を撮影してください', 'warn');
    return;
  }
  try {
    const result = await shareToChatGPT(state.files, enrichPromptText());
    state.scanId = result.scanId || getActiveScanId();
    toast(result.imageCopied
      ? 'ChatGPTが開いたら貼り付け → 送信 → 最後に「許可」を押してください'
      : '保存された画像をChatGPTへ添付 → 送信 → 最後に「許可」を押してください');
  } catch (error) {
    if (error?.name !== 'AbortError') toast(error.message || 'ChatGPTを開けませんでした', 'error');
  }
}

function persistCurrentSession(forceStatus = '') {
  if (!state.recognitions.length) return;
  const allConfirmed = state.recognitions.every(item => item.status === 'confirmed');
  const workflowStatus = forceStatus || (allConfirmed ? 'complete' : 'review');
  const totals = allConfirmed ? aggregateRecognitions(state.recognitions, db.data.products) : [];
  db.saveSession(buildSessionSnapshot({
    id: state.sessionId,
    scanId: state.scanId || getActiveScanId(),
    writerTag: state.writerTag,
    source: state.source || 'manual',
    rawPayload: state.rawPayload,
    recognitions: state.recognitions,
    imageCount: state.files.length,
    workflowStatus,
    totals
  }));
  renderHistory();
}

function ingestItems(items, source = 'manual') {
  const writerTag = currentWriterTag();
  state.sessionId = uid('session');
  state.scanId = getActiveScanId() || state.scanId;
  state.source = source;
  state.rawPayload = $('#analysisJson')?.value || '';
  state.expanded.clear();
  state.recognitions = items
    .map(item => resolveRecognitionItem(item, db.data, writerTag))
    .sort((a, b) => a.order - b.order);
  renderReview();
  void hydratePendingCatalogCandidates();
  renderHeaderStats();
  $('#resultArea').hidden = true;
  $('#reviewArea').hidden = false;
  $('#reviewArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function parsePastedResult() {
  try {
    const items = parseAnalysisPayload($('#analysisJson').value);
    ingestItems(items, 'chatgpt-result');
    toast(`${items.length}件を読み込みました`);
  } catch (error) {
    toast(error.message || '解析結果を読み込めませんでした', 'error');
  }
}

function useSample() {
  $('#analysisJson').value = JSON.stringify(SAMPLE_ANALYSIS, null, 2);
  ingestItems(parseAnalysisPayload(SAMPLE_ANALYSIS), 'sample');
  toast('サンプルデータを読み込みました');
}

async function analyzeBackend() {
  if (!state.files.length) return toast('先に注文票を撮影してください', 'warn');
  const endpoint = db.data.settings.backendEndpoint;
  if (!endpoint) {
    toast('データ・設定でAIバックエンドURLを設定してください', 'warn');
    setTab('data');
    return;
  }
  const button = $('#backendAnalyzeBtn');
  button.disabled = true;
  button.textContent = '解析中…';
  try {
    const items = await analyzeWithBackend({
      endpoint,
      files: state.files,
      prompt: enrichPromptText(),
      writerTag: currentWriterTag()
    });
    $('#analysisJson').value = JSON.stringify({ items }, null, 2);
    ingestItems(items, 'backend');
  } catch (error) {
    toast(error.message || 'AI解析に失敗しました', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'バックエンドで自動解析';
  }
}

function productById(id) {
  return db.data.products.find(p => p.id === id);
}

function recognitionById(id) {
  return state.recognitions.find(r => r.id === id);
}

function refreshCandidates(item) {
  item.candidates = rankCandidates(item.rawName, db.data.products, db.data.aliases, currentWriterTag(), 5)
    .map(({ product, score }) => ({
      productId: product.id,
      canonicalName: product.canonicalName,
      location: product.location || '',
      score
    }));
  const best = item.candidates[0];
  item.suggestedProductId = best?.productId || null;
  item.suggestedScore = best?.score || 0;
}

function markDirty(item) {
  if (!item) return;
  if (item.status === 'confirmed') item.status = 'pending';
  $('#resultArea').hidden = true;
}

function candidateHint(item) {
  if (item.status === 'confirmed') return '<span class="review-state confirmed">確定済み</span>';
  if (item.cancelled) return '<span class="review-state cancelled">取消予定</span>';
  if (item.manual && !item.rawName.trim()) return '<span class="review-state new">商品名を入力</span>';
  const score = Number(item.candidates?.[0]?.score || 0);
  if (score >= 0.93) return '<span class="review-state matched">既存商品とほぼ一致</span>';
  if (score >= 0.64) return '<span class="review-state candidate">似た商品候補あり</span>';
  if (Number(item.catalogCandidates?.[0]?.score || 0) >= 0.72) return '<span class="review-state catalog">イオン候補あり</span>';
  return '<span class="review-state new">新商品候補</span>';
}

function linkedProductLabel(item) {
  if (item.forceNew) return '新商品として登録予定';
  const product = productById(item.matchedProductId);
  return product ? `統合先：${escapeHtml(product.canonicalName)}` : '';
}

function reviewGroupTitle(item) {
  const headline = [item.place, item.time].filter(Boolean).join('　');
  const person = item.person || '注文者';
  return `<div class="paper-group-head">
    ${headline ? `<div class="paper-group-meta">${escapeHtml(headline)}</div>` : ''}
    <h3>${escapeHtml(person)}</h3>
  </div>`;
}

function renderEditPanel(item) {
  const candidates = (item.candidates || []).filter(candidate => candidate.score >= 0.4).slice(0, 3);
  const candidateHtml = candidates.length
    ? candidates.map((candidate, index) => `<button class="candidate-chip ${item.matchedProductId === candidate.productId ? 'selected' : ''}" data-action="candidate" data-id="${item.id}" data-product="${candidate.productId}">
        <span>候補${index + 1}</span><strong>${escapeHtml(candidate.canonicalName)}</strong><small>${formatConfidence(candidate.score)}${candidate.location ? ` · ${escapeHtml(candidate.location)}` : ''}</small>
      </button>`).join('')
    : '<div class="candidate-empty">近い登録商品はまだありません</div>';
  const catalogCandidates = (item.catalogCandidates || []).filter(candidate => candidate.score >= 0.55).slice(0, 4);
  const catalogHtml = catalogCandidates.length
    ? catalogCandidates.map((candidate, index) => `<button class="candidate-chip catalog-candidate-chip" data-action="catalog-candidate" data-id="${item.id}" data-jan="${candidate.jan}">
        <span>イオン候補${index + 1}</span><strong>${escapeHtml(candidate.name)}</strong><small>${formatConfidence(candidate.score)}${candidate.category ? ` · ${escapeHtml(candidate.category)}` : ''}</small>
      </button>`).join('')
    : `<div class="candidate-empty">${state.catalogReady ? 'イオン綾川カタログに近い候補はありません' : 'イオン綾川カタログを準備中です'}</div>`;

  return `<div class="review-editor">
    <label class="editor-field">
      <span>商品名</span>
      <input class="edit-name" data-id="${item.id}" value="${escapeHtml(item.rawName)}" autocomplete="off" placeholder="商品名を入力">
    </label>
    <div class="candidate-section">
      <div class="editor-label">既存商品と統合する場合</div>
      <div class="candidate-chips">${candidateHtml}</div>
    </div>
    <div class="candidate-section catalog-candidate-section">
      <div class="editor-label">イオン綾川の商品から探す</div>
      <div class="candidate-chips">${catalogHtml}</div>
    </div>
    <div class="editor-tools">
      <button type="button" class="secondary-btn compact-btn ${item.forceNew ? 'active-choice' : ''}" data-action="new-product" data-id="${item.id}">新商品として扱う</button>
      <button type="button" class="secondary-btn compact-btn ${item.cancelled ? 'danger-choice' : ''}" data-action="toggle-cancel" data-id="${item.id}">${item.cancelled ? '取消を解除' : 'この明細を取消'}</button>
      <button type="button" class="text-button" data-action="close-edit" data-id="${item.id}">閉じる</button>
    </div>
  </div>`;
}

function renderReviewLine(item) {
  const expanded = state.expanded.has(item.id);
  const product = productById(item.matchedProductId);
  const displayName = (product && item.status === 'confirmed' ? product.canonicalName : item.rawName) || '商品名を入力';
  const subLabel = linkedProductLabel(item);
  const secondary = subLabel || (item.manual ? '手動追加' : `AI ${formatConfidence(item.confidence)}`);
  const nameBlock = item.manual && !item.rawName
    ? `<button type="button" class="review-line-text name-touch" data-action="edit-name" data-id="${item.id}"><strong class="placeholder-name">商品名を入力</strong><div class="review-line-sub">タップして入力</div></button>`
    : `<div class="review-line-text"><strong>${escapeHtml(displayName)}</strong><div class="review-line-sub">${secondary}</div></div>`;

  return `<article class="review-line ${item.status === 'confirmed' ? 'is-confirmed' : ''} ${item.cancelled ? 'is-cancelled' : ''} ${item.manual ? 'is-manual' : ''}" data-id="${item.id}">
    <div class="review-line-main">
      <span class="paper-order">${item.order || ''}</span>
      ${nameBlock}
      <div class="quick-qty" aria-label="数量 ${item.quantity}">
        <button type="button" data-action="qty-minus" data-id="${item.id}" aria-label="数量を1減らす" ${Number(item.quantity) <= 0 ? 'disabled' : ''}>−</button>
        <strong>${item.quantity}</strong>
        <button type="button" data-action="qty-plus" data-id="${item.id}" aria-label="数量を1増やす">＋</button>
      </div>
    </div>
    <div class="review-line-actions">
      ${candidateHint(item)}
      <button type="button" class="edit-toggle" data-action="toggle-edit" data-id="${item.id}">${expanded ? '閉じる' : '編集'}</button>
      <button type="button" class="line-tool-btn delete-line-btn" data-action="delete" data-id="${item.id}">削除</button>
      ${item.status === 'confirmed'
        ? '<span class="confirmed-mark" aria-label="確定済み">✓</span>'
        : `<button type="button" class="confirm-line-btn" data-action="confirm" data-id="${item.id}">確定</button>`}
    </div>
    ${expanded ? renderEditPanel(item) : ''}
  </article>`;
}

function renderReview() {
  const total = state.recognitions.length;
  const confirmed = state.recognitions.filter(item => item.status === 'confirmed').length;
  const cancelled = state.recognitions.filter(item => item.status === 'confirmed' && item.cancelled).length;
  $('#reviewBadge').textContent = `${confirmed}/${total}`;
  $('#reviewSummary').textContent = total
    ? `全${total}件　確定 ${confirmed}/${total}${cancelled ? `　取消 ${cancelled}件` : ''}`
    : '解析結果がありません';
  const progress = total ? Math.round((confirmed / total) * 100) : 0;
  $('#reviewProgressBar').style.width = `${progress}%`;
  $('#reviewProgressText').textContent = `${progress}%`;

  const list = $('#reviewList');
  if (!total) {
    list.innerHTML = '<div class="empty-state">解析結果を受け取ると、ここに表示されます。</div>';
    $('#finishReviewBtn').disabled = true;
    return;
  }

  list.innerHTML = groupRecognitions(state.recognitions).map(group => {
    const first = group.items[0];
    const last = group.items.at(-1);
    return `<section class="review-person-group">
      ${reviewGroupTitle(first)}
      ${group.items.map(renderReviewLine).join('')}
      <button type="button" class="group-add-item" data-action="insert-after" data-id="${last.id}">＋ 商品を追加</button>
    </section>`;
  }).join('');

  const finishButton = $('#finishReviewBtn');
  finishButton.disabled = confirmed !== total;
  finishButton.textContent = confirmed === total ? '確認完了・商品別集計を見る' : `あと${total - confirmed}件確認`;

  if (confirmed === total) {
    renderTotals(false);
    $('#resultArea').hidden = false;
  } else {
    $('#resultArea').hidden = true;
  }
  persistCurrentSession();
}

function selectCandidate(item, productId) {
  const product = productById(productId);
  if (!item || !product) return;
  markDirty(item);
  item.matchedProductId = productId;
  item.forceNew = false;
  state.expanded.add(item.id);
  renderReview();
  toast(`「${product.canonicalName}」へ統合する設定にしました`);
}


function selectCatalogCandidate(item, jan) {
  const candidate = (item?.catalogCandidates || []).find(entry => entry.jan === jan);
  if (!item || !candidate) return;
  const product = importCatalogProduct(candidate);
  if (!product) return;
  markDirty(item);
  item.matchedProductId = product.id;
  item.forceNew = false;
  state.expanded.add(item.id);
  renderReview();
  toast(`イオン綾川の「${candidate.name}」を選びました`);
}

function setNewProduct(item) {
  if (!item) return;
  markDirty(item);
  item.matchedProductId = null;
  item.forceNew = true;
  state.expanded.add(item.id);
  renderReview();
}

function focusRecognitionName(id) {
  requestAnimationFrame(() => document.querySelector(`.edit-name[data-id="${id}"]`)?.focus());
}

function addRecognitionAfter(item) {
  if (!item) return;
  const newItem = resolveRecognitionItem({
    order: Number(item.order || 0) + 0.5,
    place: item.place,
    time: item.time,
    person: item.person,
    name: '',
    quantity: 1,
    confidence: 0,
    cancelled: false,
    note: ''
  }, db.data, currentWriterTag());
  Object.assign(newItem, {
    manual: true,
    confidence: 0,
    matchedProductId: null,
    suggestedProductId: null,
    suggestedScore: 0,
    forceNew: false,
    candidates: []
  });
  insertRecognitionAfter(state.recognitions, item.id, newItem);
  $('#resultArea').hidden = true;
  renderReview();
  toast('空の商品カードを追加しました。商品名をタップして入力してください');
}

function deleteRecognition(item) {
  if (!item) return;
  const snapshot = removeRecognition(state.recognitions, item.id);
  if (!snapshot) return;
  state.expanded.delete(item.id);
  $('#resultArea').hidden = true;
  renderReview();
  const label = item.rawName || '追加中の商品';
  toastWithUndo(`「${label}」を削除しました`, () => {
    restoreRecognition(state.recognitions, snapshot);
    renderReview();
    toast('削除を元に戻しました');
  });
}

async function confirmRecognition(item) {
  if (!item) return;
  if (!item.rawName.trim()) return toast('商品名を入力してください', 'warn');
  if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 0) return toast('数量を確認してください', 'warn');

  if (item.cancelled) {
    item.status = 'confirmed';
    db.recordRecognition({
      sessionId: state.sessionId,
      rawName: item.rawName,
      quantity: item.quantity,
      confidence: item.confidence,
      chosenProductId: null,
      suggestedProductId: item.suggestedProductId,
      corrected: true,
      writerTag: currentWriterTag(),
      status: 'cancelled'
    });
    state.expanded.delete(item.id);
    renderReview();
    maybeAutoFinish();
    return;
  }

  if (!item.matchedProductId) {
    refreshCandidates(item);
    const best = item.candidates[0];
    if (!item.forceNew && best?.score >= 0.93) {
      item.matchedProductId = best.productId;
    } else if (!item.forceNew && best?.score >= 0.64) {
      state.expanded.add(item.id);
      renderReview();
      toast('学習済み商品に似た候補があります。候補を選んでください', 'warn');
      return;
    } else if (!item.forceNew) {
      const catalogCandidates = await refreshCatalogCandidates(item, { rerender: false });
      const catalogBest = catalogCandidates[0];
      if (catalogBest?.exact) {
        const catalogProduct = importCatalogProduct(catalogBest);
        item.matchedProductId = catalogProduct?.id || null;
      } else if (catalogBest?.score >= 0.72) {
        state.expanded.add(item.id);
        renderReview();
        toast('イオン綾川カタログに似た商品があります。候補を確認してください', 'warn');
        return;
      } else {
        item.forceNew = true;
      }
    }
  }

  if (item.forceNew) {
    const product = db.addProduct(item.rawName.trim(), '');
    item.matchedProductId = product.id;
  }

  db.mapRecognitionToProduct(item, item.matchedProductId, {
    writerTag: currentWriterTag(),
    sessionId: state.sessionId
  });
  item.forceNew = false;
  state.expanded.delete(item.id);
  renderHeaderStats();
  renderReview();
  maybeAutoFinish();
}

function maybeAutoFinish() {
  if (!state.recognitions.length || !state.recognitions.every(item => item.status === 'confirmed')) return;
  renderTotals();
  $('#resultArea').hidden = false;
  persistCurrentSession('complete');
  toast('全件確認完了。商品別に集計しました');
}

function handleReviewClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const item = recognitionById(button.dataset.id);
  const action = button.dataset.action;
  if (!item) return;

  if (action === 'toggle-edit') {
    const opening = !state.expanded.has(item.id);
    if (opening) state.expanded.add(item.id);
    else state.expanded.delete(item.id);
    renderReview();
    if (opening) void refreshCatalogCandidates(item);
  } else if (action === 'edit-name') {
    state.expanded.add(item.id);
    renderReview();
    void refreshCatalogCandidates(item);
    focusRecognitionName(item.id);
  } else if (action === 'close-edit') {
    state.expanded.delete(item.id);
    renderReview();
  } else if (action === 'candidate') {
    selectCandidate(item, button.dataset.product);
  } else if (action === 'catalog-candidate') {
    selectCatalogCandidate(item, button.dataset.jan);
  } else if (action === 'new-product') {
    setNewProduct(item);
  } else if (action === 'toggle-cancel') {
    markDirty(item);
    item.cancelled = !item.cancelled;
    state.expanded.add(item.id);
    renderReview();
  } else if (action === 'qty-minus' || action === 'qty-plus') {
    markDirty(item);
    item.quantity = Math.max(0, Number(item.quantity || 0) + (action === 'qty-plus' ? 1 : -1));
    renderReview();
  } else if (action === 'insert-after') {
    addRecognitionAfter(item);
  } else if (action === 'delete') {
    deleteRecognition(item);
  } else if (action === 'confirm') {
    void confirmRecognition(item);
  }
}

function handleReviewChange(event) {
  const id = event.target.dataset.id;
  if (!id) return;
  const item = recognitionById(id);
  if (!item) return;
  if (event.target.classList.contains('edit-name')) {
    const value = event.target.value.trim();
    if (!value) return;
    markDirty(item);
    item.rawName = value;
    item.matchedProductId = null;
    item.forceNew = false;
    refreshCandidates(item);
    state.expanded.add(item.id);
    renderReview();
    void refreshCatalogCandidates(item);
  }
}

function finishReview() {
  if (!state.recognitions.length) return;
  if (!state.recognitions.every(item => item.status === 'confirmed')) return toast('まだ未確認の明細があります', 'warn');
  renderTotals();
  $('#resultArea').hidden = false;
  $('#resultArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function locationOptions(current = '') {
  return ['', 'A', 'B', 'C', 'D', 'E'].map(loc => `<option value="${loc}" ${loc === current ? 'selected' : ''}>${loc || '未設定'}</option>`).join('');
}

function summaryText(totals) {
  const groups = new Map();
  for (const item of totals) {
    const location = item.location || '未設定';
    if (!groups.has(location)) groups.set(location, []);
    groups.get(location).push(item);
  }
  return [...groups.entries()].map(([location, items]) => `【${location}】\n${items.map(item => `${item.canonicalName} × ${item.quantity}`).join('\n')}`).join('\n\n');
}

function renderTotals(save = true) {
  const totals = aggregateRecognitions(state.recognitions, db.data.products);
  $('#totalProductCount').textContent = totals.length;
  $('#totalQuantity').textContent = totals.reduce((sum, item) => sum + item.quantity, 0);

  const grouped = new Map();
  for (const item of totals) {
    const key = item.location || '未設定';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  const order = ['A', 'B', 'C', 'D', 'E', '未設定'];
  $('#totalsList').innerHTML = order
    .filter(location => grouped.has(location))
    .map(location => `<section class="location-group">
      <div class="location-title"><span>${location}</span><small>${grouped.get(location).length}商品</small></div>
      ${grouped.get(location).map(item => `<div class="total-row">
        <div class="total-name">${escapeHtml(item.canonicalName)}</div>
        <div class="total-qty">${item.quantity}</div>
        <select class="location-select" data-product="${item.productId}" aria-label="売り場">${locationOptions(item.location)}</select>
      </div>`).join('')}
    </section>`).join('') || '<div class="empty-state">確定した商品がまだありません</div>';

  $$('.location-select').forEach(select => select.addEventListener('change', () => {
    db.setLocation(select.dataset.product, select.value);
    renderTotals();
    renderProducts();
    toast('売り場を更新しました');
  }));
  if (save && state.recognitions.length) persistCurrentSession('complete');
}

async function shareSummary() {
  const totals = aggregateRecognitions(state.recognitions, db.data.products);
  if (!totals.length) return toast('共有できる集計結果がありません', 'warn');
  const text = summaryText(totals);
  try {
    if (navigator.share) await navigator.share({ title: '商品別 集計結果', text });
    else {
      await navigator.clipboard.writeText(text);
      toast('集計結果をコピーしました');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') toast('共有に失敗しました', 'error');
  }
}

function renderHistory() {
  const resume = findResumeSession(db.data.sessions);
  const resumeCard = $('#resumeCard');
  if (resumeCard) {
    resumeCard.hidden = !resume;
    if (resume) {
      const confirmed = Number(resume.confirmedCount || 0);
      const total = Number(resume.recognitionCount || resume.recognitions?.length || 0);
      resumeCard.innerHTML = `<div><strong>前回の作業が途中です</strong><span>${formatSessionDate(resume.updatedAt)}　${confirmed}/${total}件確認済み</span></div><button type="button" class="primary-btn" data-resume-session="${resume.id}">続きから再開</button>`;
    }
  }

  const list = $('#recentSessions');
  if (!list) return;
  const sessions = recentRestorableSessions(db.data.sessions, 10);
  list.innerHTML = sessions.length ? sessions.map(session => {
    const total = Number(session.recognitionCount || session.recognitions?.length || 0);
    const confirmed = Number(session.confirmedCount || 0);
    const status = session.workflowStatus === 'complete' ? '完了' : `確認途中 ${confirmed}/${total}`;
    return `<button type="button" class="history-row" data-session-id="${session.id}">
      <span><strong>${formatSessionDate(session.updatedAt)}</strong><small>${total}件</small></span>
      <span class="history-status ${session.workflowStatus === 'complete' ? 'complete' : ''}">${status}</span>
      <b>開く</b>
    </button>`;
  }).join('') : '<div class="empty-mini">まだ保存された読み取りはありません</div>';
}

function restoreSessionById(id) {
  const session = db.getSession(id);
  if (!session?.recognitions?.length) return toast('復元できる履歴がありません', 'warn');
  state.sessionId = session.id;
  state.scanId = session.scanId || '';
  state.source = session.source || 'history';
  state.rawPayload = session.rawPayload || '';
  state.writerTag = session.writerTag || '';
  state.recognitions = cloneValue(session.recognitions);
  state.expanded.clear();
  if ($('#writerTag')) $('#writerTag').value = state.writerTag;
  if ($('#analysisJson')) $('#analysisJson').value = state.rawPayload;
  $('#reviewArea').hidden = false;
  renderReview();
  void hydratePendingCatalogCandidates();
  if (session.workflowStatus === 'complete') {
    renderTotals(false);
    $('#resultArea').hidden = false;
  }
  $('#reviewArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('保存した作業を復元しました');
}

async function restoreLastActionResult() {
  const latest = recentRestorableSessions(db.data.sessions, 1)[0];
  const scanId = latest?.scanId || getActiveScanId();
  if (!scanId) return toast('復元できるIDがありません', 'warn');
  try {
    const restored = await restoreActionScan(scanId);
    if (!restored) toast('保存された解析結果が見つかりません', 'warn');
  } catch (error) {
    toast(error.message || '解析結果を復元できませんでした', 'error');
  }
}

async function restoreByEnteredScanId() {
  const scanId = ($('#restoreScanIdInput')?.value || '').trim();
  if (!scanId) return toast('復元IDを入力してください', 'warn');
  try {
    const restored = await restoreActionScan(scanId);
    if (!restored) toast('保存された解析結果が見つかりません', 'warn');
  } catch (error) {
    toast(error.message || '解析結果を復元できませんでした', 'error');
  }
}

function renderProducts() {
  const query = ($('#productSearch')?.value || '').trim().toLowerCase();
  const products = db.data.products
    .filter(product => !query || product.canonicalName.toLowerCase().includes(query) || db.data.aliases.some(a => a.productId === product.id && a.alias.toLowerCase().includes(query)))
    .sort((a, b) => (a.location || 'Z').localeCompare(b.location || 'Z', 'ja') || a.canonicalName.localeCompare(b.canonicalName, 'ja'));

  $('#productList').innerHTML = products.map(product => {
    const aliases = db.data.aliases.filter(a => a.productId === product.id);
    const humanLearned = aliases.filter(a => a.source === 'human-correction').length;
    return `<article class="product-card">
      <div class="product-main"><div><h3>${escapeHtml(product.canonicalName)}</h3><div class="alias-line">${aliases.slice(0, 5).map(a => `<span>${escapeHtml(a.alias)}</span>`).join('')}${aliases.length > 5 ? `<span>+${aliases.length - 5}</span>` : ''}</div></div><select class="db-location-select" data-product="${product.id}">${locationOptions(product.location)}</select></div>
      <div class="product-meta">表記 ${aliases.length}件 · 手動学習 ${humanLearned}件${product.source === 'aeon-ayagawa' ? ` · <span class="catalog-source">イオン綾川${product.jan ? ` JAN ${escapeHtml(product.jan)}` : ''}</span>` : ''}</div>
      <button class="text-button add-alias-btn" data-product="${product.id}">＋ 別の書き方を登録</button>
    </article>`;
  }).join('') || '<div class="empty-state">該当する商品がありません</div>';

  $$('.db-location-select').forEach(select => select.addEventListener('change', () => {
    db.setLocation(select.dataset.product, select.value);
    renderProducts();
    if (state.recognitions.length) renderTotals(false);
  }));
  $$('.add-alias-btn').forEach(button => button.addEventListener('click', () => {
    const product = productById(button.dataset.product);
    const alias = window.prompt(`「${product.canonicalName}」の別表記を入力`, '');
    if (!alias?.trim()) return;
    db.addAlias(product.id, alias.trim(), { source: 'human-manual', verified: true, writerTag: currentWriterTag() });
    renderProducts();
    renderHeaderStats();
    toast('別表記を登録しました');
  }));
}


let catalogSearchTimer = null;
async function renderCatalogSearch() {
  const input = $('#catalogSearch');
  const results = $('#catalogSearchResults');
  if (!input || !results) return;
  const query = input.value.trim();
  if (query.length < 2) {
    results.innerHTML = '<div class="empty-mini">2文字以上入力すると37,063商品から検索します</div>';
    return;
  }
  results.innerHTML = '<div class="empty-mini">検索中…</div>';
  try {
    await initCatalog();
    const candidates = await catalogDb.search(query, 20);
    results.innerHTML = candidates.length ? candidates.map(candidate => `<button type="button" class="catalog-result" data-catalog-register="${candidate.jan}">
      <span><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(candidate.category || 'カテゴリ未設定')} · JAN ${escapeHtml(candidate.jan)}</small></span>
      <b>登録</b>
    </button>`).join('') : '<div class="empty-mini">近い商品が見つかりませんでした</div>';
  } catch {
    results.innerHTML = '<div class="empty-mini">カタログを検索できませんでした</div>';
  }
}

async function handleCatalogSearchClick(event) {
  const button = event.target.closest('[data-catalog-register]');
  if (!button) return;
  try {
    const record = await catalogDb.getByJan(button.dataset.catalogRegister);
    if (!record) return toast('商品情報を読み込めませんでした', 'error');
    const product = importCatalogProduct({ jan: record.jan, name: record.name, category: record.category });
    renderProducts();
    renderHeaderStats();
    toast(`「${product.canonicalName}」を学習DBへ登録しました`);
  } catch (error) {
    toast(error.message || '商品を登録できませんでした', 'error');
  }
}

async function refreshCatalogNow() {
  const button = $('#refreshCatalogBtn');
  if (button) {
    button.disabled = true;
    button.textContent = '更新中…';
  }
  try {
    await initCatalog({ force: true });
    await hydratePendingCatalogCandidates();
    toast('商品カタログを最新版へ更新しました');
  } catch (error) {
    toast(error.message || '商品カタログを更新できませんでした', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '商品カタログを更新';
    }
  }
}

function addProductManually() {
  const name = window.prompt('正式な商品名を入力してください', '');
  if (!name?.trim()) return;
  db.addProduct(name.trim(), '');
  renderProducts();
  renderHeaderStats();
  toast('商品を追加しました');
}

function renderDataStats() {
  $('#dataProductCount').textContent = db.data.products.length;
  $('#dataAliasCount').textContent = db.data.aliases.length;
  $('#dataHistoryCount').textContent = db.data.recognitionHistory.length;
  $('#dataSessionCount').textContent = db.data.sessions.length;
  $('#backendEndpoint').value = db.data.settings.backendEndpoint || '';
  $('#providerLabel').value = db.data.settings.providerLabel || '';
  if ($('#catalogItemCount')) $('#catalogItemCount').textContent = Number(db.data.catalogMeta?.itemCount || 0).toLocaleString('ja-JP');
}

function saveSettings() {
  const endpoint = $('#backendEndpoint').value.trim();
  if (endpoint && !/^https:\/\//i.test(endpoint)) return toast('バックエンドURLは https:// から始めてください', 'error');
  db.updateSettings({ backendEndpoint: endpoint, providerLabel: $('#providerLabel').value.trim() || 'AI backend' });
  toast('設定を保存しました');
}

function downloadBackup() {
  const blob = new Blob([db.exportJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `order-sheet-db-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('学習DBを書き出しました');
}

async function importBackup(file) {
  if (!file) return;
  try {
    db.importJson(await file.text());
    renderHeaderStats();
    renderProducts();
    renderDataStats();
    renderHistory();
    toast('学習DBを復元しました');
  } catch (error) {
    toast(error.message || 'バックアップを読み込めませんでした', 'error');
  }
}

function resetDb() {
  if (!window.confirm('学習した商品・表記・履歴を初期化します。先にバックアップを推奨します。続けますか？')) return;
  db.reset();
  state.recognitions = [];
  state.expanded.clear();
  renderHeaderStats();
  renderProducts();
  renderDataStats();
  renderHistory();
  $('#reviewArea').hidden = true;
  $('#resultArea').hidden = true;
  toast('データベースを初期化しました');
}

function setupInstall() {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.installPrompt = event;
    $('#installBtn').hidden = false;
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    $('#installBtn').hidden = true;
  });
}

function setupEvents() {
  $$('.tab-button').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
  $('#imageInput').addEventListener('change', event => setFiles(event.target.files));
  $('#rotateImageBtn')?.addEventListener('click', toggleImageFlip);
  $('#writerTag')?.addEventListener('change', currentWriterTag);
  $('#copyPromptBtn')?.addEventListener('click', copyPrompt);
  $('#chatgptShareBtn').addEventListener('click', sendToChatGPT);
  $('#parseResultBtn').addEventListener('click', parsePastedResult);
  $('#sampleBtn')?.addEventListener('click', useSample);
  $('#backendAnalyzeBtn')?.addEventListener('click', analyzeBackend);
  $('#reviewList').addEventListener('click', handleReviewClick);
  $('#reviewList').addEventListener('change', handleReviewChange);
  $('#finishReviewBtn').addEventListener('click', finishReview);
  $('#shareSummaryBtn').addEventListener('click', shareSummary);
  $('#printBtn').addEventListener('click', () => window.print());
  $('#productSearch').addEventListener('input', renderProducts);
  $('#addProductBtn').addEventListener('click', addProductManually);
  $('#catalogSearch')?.addEventListener('input', () => {
    clearTimeout(catalogSearchTimer);
    catalogSearchTimer = setTimeout(renderCatalogSearch, 180);
  });
  $('#catalogSearchResults')?.addEventListener('click', handleCatalogSearchClick);
  $('#refreshCatalogBtn')?.addEventListener('click', refreshCatalogNow);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#exportBtn').addEventListener('click', downloadBackup);
  $('#importInput').addEventListener('change', event => importBackup(event.target.files?.[0]));
  $('#resetBtn').addEventListener('click', resetDb);
  $('#resumeCard')?.addEventListener('click', event => {
    const button = event.target.closest('[data-resume-session]');
    if (button) restoreSessionById(button.dataset.resumeSession);
  });
  $('#recentSessions')?.addEventListener('click', event => {
    const button = event.target.closest('[data-session-id]');
    if (button) restoreSessionById(button.dataset.sessionId);
  });
  $('#restoreLastCloudBtn')?.addEventListener('click', restoreLastActionResult);
  $('#restoreScanIdBtn')?.addEventListener('click', restoreByEnteredScanId);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
}

function init() {
  renderHeaderStats();
  renderFiles();
  renderProducts();
  renderDataStats();
  renderHistory();
  enrichPromptText();
  setupEvents();
  setupReviewReorder(() => state.recognitions);
  setupInstall();
  registerServiceWorker();
  void initCatalog().then(() => hydratePendingCatalogCandidates()).catch(() => {});
}

init();
