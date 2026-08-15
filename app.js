import { OrderDb } from './db.js';
import { aggregateRecognitions, parseAnalysisPayload, rankCandidates, resolveRecognitionItem, uid } from './lib.js';
import { analyzeWithBackend, buildPrompt, SAMPLE_ANALYSIS, shareToChatGPT } from './ai.js';

const db = new OrderDb();
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const state = {
  files: [],
  recognitions: [],
  expanded: new Set(),
  sessionId: uid('session'),
  writerTag: '',
  installPrompt: null
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
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function formatConfidence(value = 0) {
  return `${Math.round(Number(value || 0) * 100)}%`;
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
  const confirmed = db.data.recognitionHistory.filter(h => h.status === 'confirmed').length;
  $('#learnedCount').textContent = confirmed;
}

function renderFiles() {
  const container = $('#filePreviews');
  if (!state.files.length) {
    container.innerHTML = '<div class="empty-mini">注文票を撮影または選択してください</div>';
    return;
  }
  container.innerHTML = state.files.map((file, index) => {
    const url = URL.createObjectURL(file);
    return `<figure class="preview-card">
      <img src="${url}" alt="注文票 ${index + 1}">
      <figcaption>${escapeHtml(file.name || `画像 ${index + 1}`)}</figcaption>
    </figure>`;
  }).join('');
}

function setFiles(fileList) {
  state.files = Array.from(fileList || []).filter(file => file.type.startsWith('image/'));
  renderFiles();
  $('#selectedCount').textContent = `${state.files.length}枚`;
}

function currentWriterTag() {
  const tag = $('#writerTag').value.trim();
  state.writerTag = tag;
  if (tag) db.addWriter(tag);
  return tag;
}

function enrichPromptText() {
  const prompt = buildPrompt(db.data);
  $('#promptPreview').value = prompt;
  return prompt;
}

async function copyPrompt() {
  const prompt = enrichPromptText();
  await navigator.clipboard.writeText(prompt);
  toast('解析プロンプトをコピーしました');
}

async function sendToChatGPT() {
  if (!state.files.length) {
    toast('先に注文票の画像を選んでください', 'warn');
    return;
  }
  const prompt = enrichPromptText();
  try {
    const result = await shareToChatGPT(state.files, prompt);
    toast(result.method === 'share'
      ? 'ChatGPTで送信 → 回答をコピー → 「集計アプリに戻る」をタップしてください'
      : 'プロンプトをコピーしてChatGPTを開きました。画像も添付してください');
  } catch (error) {
    if (error?.name !== 'AbortError') toast(error.message || '共有に失敗しました', 'error');
  }
}

function ingestItems(items, source = 'manual') {
  const writerTag = currentWriterTag();
  state.expanded.clear();
  state.recognitions = items
    .map(item => resolveRecognitionItem(item, db.data, writerTag))
    .sort((a, b) => a.order - b.order);
  db.saveSession({
    id: state.sessionId,
    writerTag,
    source,
    imageCount: state.files.length,
    recognitionCount: state.recognitions.length,
    resolvedCount: 0
  });
  renderReview();
  renderHeaderStats();
  $('#resultArea').hidden = true;
  $('#reviewArea').hidden = false;
  $('#reviewArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function parsePastedResult() {
  try {
    const items = parseAnalysisPayload($('#analysisJson').value);
    ingestItems(items, 'chatgpt-paste');
    toast(`${items.length}件を紙の順に読み込みました`);
  } catch (error) {
    toast(error.message || 'JSONを読み込めませんでした', 'error');
  }
}

function useSample() {
  $('#analysisJson').value = JSON.stringify(SAMPLE_ANALYSIS, null, 2);
  ingestItems(parseAnalysisPayload(SAMPLE_ANALYSIS), 'sample');
  toast('サンプルデータで全件確認モードを試せます');
}

async function analyzeBackend() {
  if (!state.files.length) {
    toast('先に注文票の画像を選んでください', 'warn');
    return;
  }
  const endpoint = db.data.settings.backendEndpoint;
  if (!endpoint) {
    toast('「データ・設定」で安全なAIバックエンドURLを設定してください', 'warn');
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
    toast('AI解析が完了しました。上から順に確認してください');
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
  const score = Number(item.candidates?.[0]?.score || 0);
  if (score >= 0.93) return '<span class="review-state matched">既存商品とほぼ一致</span>';
  if (score >= 0.64) return '<span class="review-state candidate">似た商品候補あり</span>';
  return '<span class="review-state new">新商品候補</span>';
}

function linkedProductLabel(item) {
  if (item.forceNew) return '新商品として登録予定';
  const product = productById(item.matchedProductId);
  return product ? `統合先：${escapeHtml(product.canonicalName)}` : '';
}

function reviewGroupKey(item) {
  return [item.place || '', item.time || '', item.person || ''].join('|');
}

function reviewGroupTitle(item) {
  const headline = [item.place, item.time].filter(Boolean).join('　');
  const person = item.person || '個人名未読取';
  return `<div class="paper-group-head">
    ${headline ? `<div class="paper-group-meta">${escapeHtml(headline)}</div>` : ''}
    <h3>${escapeHtml(person)}</h3>
  </div>`;
}

function renderEditPanel(item) {
  const candidates = (item.candidates || []).filter(candidate => candidate.score >= 0.4).slice(0, 3);
  const candidateHtml = candidates.length
    ? candidates.map((candidate, index) => `<button class="candidate-chip ${item.matchedProductId === candidate.productId ? 'selected' : ''}" data-action="candidate" data-id="${item.id}" data-product="${candidate.productId}">
        <span>候補${index + 1}</span>
        <strong>${escapeHtml(candidate.canonicalName)}</strong>
        <small>${formatConfidence(candidate.score)}${candidate.location ? ` · ${escapeHtml(candidate.location)}` : ''}</small>
      </button>`).join('')
    : '<div class="candidate-empty">近い登録商品はまだありません</div>';

  return `<div class="review-editor">
    <label class="editor-field">
      <span>商品名</span>
      <input class="edit-name" data-id="${item.id}" value="${escapeHtml(item.rawName)}" autocomplete="off">
    </label>
    <div class="editor-field">
      <span>数量</span>
      <div class="qty-editor">
        <button type="button" data-action="qty-minus" data-id="${item.id}" aria-label="1減らす">−</button>
        <input class="edit-qty" data-id="${item.id}" type="number" min="0" step="1" value="${item.quantity}">
        <button type="button" data-action="qty-plus" data-id="${item.id}" aria-label="1増やす">＋</button>
      </div>
    </div>
    <div class="candidate-section">
      <div class="editor-label">既存商品と統合する場合</div>
      <div class="candidate-chips">${candidateHtml}</div>
    </div>
    <div class="editor-tools">
      <button type="button" class="secondary-btn compact-btn ${item.forceNew ? 'active-choice' : ''}" data-action="new-product" data-id="${item.id}">新商品として扱う</button>
      <button type="button" class="secondary-btn compact-btn ${item.cancelled ? 'danger-choice' : ''}" data-action="toggle-cancel" data-id="${item.id}">${item.cancelled ? '取消を解除' : 'この明細を取消'}</button>
      <button type="button" class="text-button" data-action="close-edit" data-id="${item.id}">閉じる</button>
    </div>
  </div>`;
}

function renderReview() {
  const total = state.recognitions.length;
  const confirmed = state.recognitions.filter(item => item.status === 'confirmed').length;
  const cancelled = state.recognitions.filter(item => item.status === 'confirmed' && item.cancelled).length;
  $('#reviewBadge').textContent = `${confirmed}/${total}`;
  $('#reviewSummary').textContent = total
    ? `紙の上から順に全${total}件を確認します。確定 ${confirmed}/${total}${cancelled ? `（取消 ${cancelled}件）` : ''}`
    : '解析結果がありません';
  const progress = total ? Math.round((confirmed / total) * 100) : 0;
  const progressBar = $('#reviewProgressBar');
  if (progressBar) progressBar.style.width = `${progress}%`;
  const progressText = $('#reviewProgressText');
  if (progressText) progressText.textContent = `${progress}%`;

  const list = $('#reviewList');
  if (!total) {
    list.innerHTML = '<div class="empty-state">注文票の解析結果を読み込むと、ここに紙の順で表示されます。</div>';
    $('#finishReviewBtn').disabled = true;
    return;
  }

  let previousGroup = null;
  list.innerHTML = state.recognitions.map(item => {
    const groupKey = reviewGroupKey(item);
    const groupHeader = groupKey !== previousGroup ? reviewGroupTitle(item) : '';
    previousGroup = groupKey;
    const expanded = state.expanded.has(item.id);
    const product = productById(item.matchedProductId);
    const displayName = product && item.status === 'confirmed' ? product.canonicalName : item.rawName;
    const subLabel = linkedProductLabel(item);
    return `${groupHeader}<article class="review-line ${item.status === 'confirmed' ? 'is-confirmed' : ''} ${item.cancelled ? 'is-cancelled' : ''}" data-id="${item.id}">
      <div class="review-line-main">
        <span class="paper-order">${item.order || ''}</span>
        <div class="review-line-text">
          <strong>${escapeHtml(displayName)}</strong>
          <div class="review-line-sub">${subLabel || `AI ${formatConfidence(item.confidence)}`}</div>
        </div>
        <div class="review-line-qty">×${item.quantity}</div>
      </div>
      <div class="review-line-actions">
        ${candidateHint(item)}
        <button type="button" class="edit-toggle" data-action="toggle-edit" data-id="${item.id}">${expanded ? '閉じる' : '編集'}</button>
        ${item.status === 'confirmed'
          ? '<span class="confirmed-mark" aria-label="確定済み">✓</span>'
          : `<button type="button" class="confirm-line-btn" data-action="confirm" data-id="${item.id}">確定</button>`}
      </div>
      ${expanded ? renderEditPanel(item) : ''}
    </article>`;
  }).join('');

  const finishButton = $('#finishReviewBtn');
  finishButton.disabled = confirmed !== total;
  finishButton.textContent = confirmed === total ? '確認完了・商品別集計を見る' : `あと${total - confirmed}件確認`;

  if (confirmed === total) {
    renderTotals();
    $('#resultArea').hidden = false;
  } else {
    $('#resultArea').hidden = true;
  }
}

function selectCandidate(item, productId) {
  const product = productById(productId);
  if (!item || !product) return;
  markDirty(item);
  item.matchedProductId = productId;
  item.forceNew = false;
  renderReview();
  state.expanded.add(item.id);
  renderReview();
  toast(`「${product.canonicalName}」へ統合する設定にしました`);
}

function setNewProduct(item) {
  if (!item) return;
  markDirty(item);
  item.matchedProductId = null;
  item.forceNew = true;
  renderReview();
  state.expanded.add(item.id);
  renderReview();
  toast('この表記を新商品として登録する設定にしました');
}

function confirmRecognition(item) {
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
      toast('似た商品があります。候補を選ぶか「新商品として扱う」を押してください', 'warn');
      return;
    } else {
      item.forceNew = true;
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
  db.saveSession({
    id: state.sessionId,
    resolvedCount: state.recognitions.filter(item => !item.cancelled).length,
    confirmedCount: state.recognitions.length,
    writerTag: currentWriterTag(),
    imageCount: state.files.length
  });
  toast('全件確認完了。同じ商品を自動統合して集計しました');
}

function handleReviewClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const item = recognitionById(button.dataset.id);
  const action = button.dataset.action;
  if (!item) return;

  if (action === 'toggle-edit') {
    if (state.expanded.has(item.id)) state.expanded.delete(item.id);
    else state.expanded.add(item.id);
    renderReview();
  } else if (action === 'close-edit') {
    state.expanded.delete(item.id);
    renderReview();
  } else if (action === 'candidate') {
    selectCandidate(item, button.dataset.product);
  } else if (action === 'new-product') {
    setNewProduct(item);
  } else if (action === 'toggle-cancel') {
    markDirty(item);
    item.cancelled = !item.cancelled;
    renderReview();
    state.expanded.add(item.id);
    renderReview();
  } else if (action === 'qty-minus' || action === 'qty-plus') {
    markDirty(item);
    const delta = action === 'qty-plus' ? 1 : -1;
    item.quantity = Math.max(0, Number(item.quantity || 0) + delta);
    renderReview();
    state.expanded.add(item.id);
    renderReview();
  } else if (action === 'confirm') {
    confirmRecognition(item);
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
  }
  if (event.target.classList.contains('edit-qty')) {
    markDirty(item);
    item.quantity = Math.max(0, Number(event.target.value || 0));
    state.expanded.add(item.id);
    renderReview();
  }
}

function finishReview() {
  if (!state.recognitions.length) return;
  if (!state.recognitions.every(item => item.status === 'confirmed')) {
    toast('まだ未確認の明細があります', 'warn');
    return;
  }
  renderTotals();
  $('#resultArea').hidden = false;
  $('#resultArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function locationOptions(current = '') {
  return ['', 'A', 'B', 'C', 'D', 'E'].map(loc =>
    `<option value="${loc}" ${loc === current ? 'selected' : ''}>${loc || '未設定'}</option>`
  ).join('');
}

function summaryText(totals) {
  const groups = new Map();
  for (const item of totals) {
    const location = item.location || '未設定';
    if (!groups.has(location)) groups.set(location, []);
    groups.get(location).push(item);
  }
  return [...groups.entries()].map(([location, items]) =>
    `【${location}】\n${items.map(item => `${item.canonicalName} × ${item.quantity}`).join('\n')}`
  ).join('\n\n');
}

function renderTotals() {
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

  db.saveSession({
    id: state.sessionId,
    totals,
    resolvedCount: totals.length,
    writerTag: currentWriterTag(),
    imageCount: state.files.length
  });
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

function renderProducts() {
  const query = ($('#productSearch')?.value || '').trim().toLowerCase();
  const products = db.data.products
    .filter(product => !query || product.canonicalName.toLowerCase().includes(query) || db.data.aliases.some(a => a.productId === product.id && a.alias.toLowerCase().includes(query)))
    .sort((a, b) => (a.location || 'Z').localeCompare(b.location || 'Z', 'ja') || a.canonicalName.localeCompare(b.canonicalName, 'ja'));

  $('#productList').innerHTML = products.map(product => {
    const aliases = db.data.aliases.filter(a => a.productId === product.id);
    const humanLearned = aliases.filter(a => a.source === 'human-correction').length;
    return `<article class="product-card">
      <div class="product-main">
        <div>
          <h3>${escapeHtml(product.canonicalName)}</h3>
          <div class="alias-line">${aliases.slice(0, 5).map(a => `<span>${escapeHtml(a.alias)}</span>`).join('')}${aliases.length > 5 ? `<span>+${aliases.length - 5}</span>` : ''}</div>
        </div>
        <select class="db-location-select" data-product="${product.id}">${locationOptions(product.location)}</select>
      </div>
      <div class="product-meta">表記 ${aliases.length}件 · 手動学習 ${humanLearned}件</div>
      <button class="text-button add-alias-btn" data-product="${product.id}">＋ 別の書き方を登録</button>
    </article>`;
  }).join('') || '<div class="empty-state">該当する商品がありません</div>';

  $$('.db-location-select').forEach(select => select.addEventListener('change', () => {
    db.setLocation(select.dataset.product, select.value);
    renderProducts();
    renderTotals();
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
}

function saveSettings() {
  const endpoint = $('#backendEndpoint').value.trim();
  if (endpoint && !/^https:\/\//i.test(endpoint)) {
    toast('バックエンドURLは https:// から始めてください', 'error');
    return;
  }
  db.updateSettings({
    backendEndpoint: endpoint,
    providerLabel: $('#providerLabel').value.trim() || 'AI backend'
  });
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
  $('#writerTag').addEventListener('change', currentWriterTag);
  $('#copyPromptBtn').addEventListener('click', copyPrompt);
  $('#chatgptShareBtn').addEventListener('click', sendToChatGPT);
  $('#parseResultBtn').addEventListener('click', parsePastedResult);
  $('#sampleBtn').addEventListener('click', useSample);
  $('#backendAnalyzeBtn').addEventListener('click', analyzeBackend);
  $('#reviewList').addEventListener('click', handleReviewClick);
  $('#reviewList').addEventListener('change', handleReviewChange);
  $('#finishReviewBtn').addEventListener('click', finishReview);
  $('#shareSummaryBtn').addEventListener('click', shareSummary);
  $('#printBtn').addEventListener('click', () => window.print());
  $('#productSearch').addEventListener('input', renderProducts);
  $('#addProductBtn').addEventListener('click', addProductManually);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#exportBtn').addEventListener('click', downloadBackup);
  $('#importInput').addEventListener('change', event => importBackup(event.target.files?.[0]));
  $('#resetBtn').addEventListener('click', resetDb);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
  }
}

function init() {
  renderHeaderStats();
  renderFiles();
  renderProducts();
  renderDataStats();
  enrichPromptText();
  setupEvents();
  setupInstall();
  registerServiceWorker();
}

init();