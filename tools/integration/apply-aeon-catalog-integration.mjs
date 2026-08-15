import fs from 'node:fs';
import path from 'node:path';
import { buildStaticCatalog } from '../aeon-catalog/build-static-catalog.mjs';

const root = process.cwd();
const inputDir = path.resolve(process.argv[2] || '.tmp/aeon');
const outputDir = path.join(root, 'catalog/aeon-ayagawa');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function write(file, content) {
  fs.writeFileSync(path.join(root, file), content, 'utf8');
}

function replaceOnce(content, before, after, label) {
  if (!content.includes(before)) throw new Error(`Patch target not found: ${label}`);
  return content.replace(before, after);
}

function insertBeforeOnce(content, marker, addition, label) {
  if (!content.includes(marker)) throw new Error(`Insert target not found: ${label}`);
  return content.replace(marker, `${addition}${marker}`);
}

const manifest = buildStaticCatalog(inputDir, outputDir);
if (manifest.count !== 37063) throw new Error(`Expected 37063 catalog items, got ${manifest.count}`);

let app = read('app.js');
app = replaceOnce(
  app,
  "import { buildSessionSnapshot, cloneValue, findResumeSession, groupRecognitions, recentRestorableSessions } from './session-history-core.js';",
  "import { buildSessionSnapshot, cloneValue, findResumeSession, groupRecognitions, recentRestorableSessions } from './session-history-core.js';\nimport { AeonCatalogDb } from './catalog-db.js';",
  'app catalog import'
);
app = replaceOnce(
  app,
  "const db = new OrderDb();\nconst $ = selector => document.querySelector(selector);",
  "const db = new OrderDb();\nconst catalogDb = new AeonCatalogDb();\nlet catalogInitPromise = null;\nconst $ = selector => document.querySelector(selector);",
  'app catalog instance'
);
app = replaceOnce(
  app,
  "  imageFlip180: false,\n  installPrompt: null\n};",
  "  imageFlip180: false,\n  installPrompt: null,\n  catalogReady: false,\n  catalogMeta: null\n};",
  'app state catalog fields'
);

const catalogFunctions = `\nfunction setCatalogStatus(message, stateName = '') {\n  const element = $('#catalogStatus');\n  if (!element) return;\n  element.textContent = message;\n  element.dataset.state = stateName;\n}\n\nasync function initCatalog({ force = false } = {}) {\n  if (force) catalogInitPromise = null;\n  if (catalogInitPromise) return catalogInitPromise;\n  catalogInitPromise = (async () => {\n    try {\n      setCatalogStatus('イオン綾川の商品カタログを準備しています…', 'loading');\n      const meta = await catalogDb.ensureReady({\n        force,\n        onProgress: ({ loaded, total, status }) => {\n          if (status === 'offline-ready') {\n            setCatalogStatus('保存済みカタログをオフラインで利用中', 'ready');\n            return;\n          }\n          if (!total || status === 'ready') return;\n          const percent = Math.min(100, Math.round((loaded / total) * 100));\n          setCatalogStatus(\`商品カタログを準備中… \${percent}%\`, 'loading');\n        }\n      });\n      state.catalogReady = true;\n      state.catalogMeta = meta;\n      const previous = db.data.catalogMeta || {};\n      if (previous.provider !== 'aeon-ayagawa' || Number(previous.itemCount) !== Number(meta.count) || previous.catalogVersion !== meta.catalogVersion) {\n        db.updateCatalogMeta({\n          provider: 'aeon-ayagawa',\n          itemCount: Number(meta.count || 0),\n          importedAt: meta.importedAt || null,\n          catalogVersion: meta.catalogVersion || '',\n          storeId: meta.storeId || '',\n          storage: 'separate-indexeddb'\n        });\n      }\n      setCatalogStatus(\`イオン綾川 \${Number(meta.count || 0).toLocaleString('ja-JP')}商品を利用できます\`, 'ready');\n      renderDataStats();\n      return meta;\n    } catch (error) {\n      state.catalogReady = false;\n      setCatalogStatus('商品カタログを準備できませんでした。通常の学習DBだけで利用できます。', 'error');\n      console.warn('AEON catalog init failed', error);\n      throw error;\n    }\n  })();\n  return catalogInitPromise;\n}\n\nfunction importCatalogProduct(candidate) {\n  if (!candidate?.jan || !candidate?.name) return null;\n  const product = db.addProduct(candidate.name, '', {\n    jan: candidate.jan,\n    source: 'aeon-ayagawa',\n    category: candidate.category || '',\n    catalogVersion: state.catalogMeta?.catalogVersion || ''\n  });\n  renderHeaderStats();\n  return product;\n}\n\nasync function refreshCatalogCandidates(item, { rerender = true } = {}) {\n  if (!item?.rawName?.trim()) {\n    if (item) item.catalogCandidates = [];\n    return [];\n  }\n  try {\n    await initCatalog();\n    const candidates = await catalogDb.search(item.rawName, 5);\n    if (!state.recognitions.some(recognition => recognition.id === item.id)) return candidates;\n    item.catalogCandidates = candidates;\n    if (rerender && state.expanded.has(item.id)) renderReview();\n    return candidates;\n  } catch {\n    item.catalogCandidates = [];\n    return [];\n  }\n}\n\nasync function hydratePendingCatalogCandidates() {\n  if (!state.recognitions.length) return;\n  try {\n    await initCatalog();\n  } catch {\n    return;\n  }\n  const targets = state.recognitions.filter(item => item.status !== 'confirmed' && Number(item.suggestedScore || 0) < 0.64 && item.rawName?.trim()).slice(0, 60);\n  for (const item of targets) await refreshCatalogCandidates(item, { rerender: false });\n  if (targets.length) renderReview();\n}\n\n`;
app = insertBeforeOnce(app, 'function setTab(name) {', catalogFunctions, 'catalog runtime functions');

app = replaceOnce(
  app,
  "  if (score >= 0.93) return '<span class=\"review-state matched\">既存商品とほぼ一致</span>';\n  if (score >= 0.64) return '<span class=\"review-state candidate\">似た商品候補あり</span>';\n  return '<span class=\"review-state new\">新商品候補</span>';",
  "  if (score >= 0.93) return '<span class=\"review-state matched\">既存商品とほぼ一致</span>';\n  if (score >= 0.64) return '<span class=\"review-state candidate\">似た商品候補あり</span>';\n  if (Number(item.catalogCandidates?.[0]?.score || 0) >= 0.72) return '<span class=\"review-state catalog\">イオン候補あり</span>';\n  return '<span class=\"review-state new\">新商品候補</span>';",
  'catalog candidate hint'
);

app = replaceOnce(
  app,
  "    : '<div class=\"candidate-empty\">近い登録商品はまだありません</div>';\n\n  return `<div class=\"review-editor\">",
  "    : '<div class=\"candidate-empty\">近い登録商品はまだありません</div>';\n  const catalogCandidates = (item.catalogCandidates || []).filter(candidate => candidate.score >= 0.55).slice(0, 4);\n  const catalogHtml = catalogCandidates.length\n    ? catalogCandidates.map((candidate, index) => `<button class=\"candidate-chip catalog-candidate-chip\" data-action=\"catalog-candidate\" data-id=\"${item.id}\" data-jan=\"${candidate.jan}\">\n        <span>イオン候補${index + 1}</span><strong>${escapeHtml(candidate.name)}</strong><small>${formatConfidence(candidate.score)}${candidate.category ? ` · ${escapeHtml(candidate.category)}` : ''}</small>\n      </button>`).join('')\n    : `<div class=\"candidate-empty\">${state.catalogReady ? 'イオン綾川カタログに近い候補はありません' : 'イオン綾川カタログを準備中です'}</div>`;\n\n  return `<div class=\"review-editor\">",
  'catalog edit candidate data'
);
app = replaceOnce(
  app,
  "    <div class=\"candidate-section\">\n      <div class=\"editor-label\">既存商品と統合する場合</div>\n      <div class=\"candidate-chips\">${candidateHtml}</div>\n    </div>\n    <div class=\"editor-tools\">",
  "    <div class=\"candidate-section\">\n      <div class=\"editor-label\">既存商品と統合する場合</div>\n      <div class=\"candidate-chips\">${candidateHtml}</div>\n    </div>\n    <div class=\"candidate-section catalog-candidate-section\">\n      <div class=\"editor-label\">イオン綾川の商品から探す</div>\n      <div class=\"candidate-chips\">${catalogHtml}</div>\n    </div>\n    <div class=\"editor-tools\">",
  'catalog edit candidate section'
);

app = replaceOnce(
  app,
  "  renderReview();\n  renderHeaderStats();\n  $('#resultArea').hidden = true;",
  "  renderReview();\n  void hydratePendingCatalogCandidates();\n  renderHeaderStats();\n  $('#resultArea').hidden = true;",
  'catalog hydrate after ingest'
);

const selectCatalogFunction = `\nfunction selectCatalogCandidate(item, jan) {\n  const candidate = (item?.catalogCandidates || []).find(entry => entry.jan === jan);\n  if (!item || !candidate) return;\n  const product = importCatalogProduct(candidate);\n  if (!product) return;\n  markDirty(item);\n  item.matchedProductId = product.id;\n  item.forceNew = false;\n  state.expanded.add(item.id);\n  renderReview();\n  toast(\`イオン綾川の「\${candidate.name}」を選びました\`);\n}\n\n`;
app = insertBeforeOnce(app, 'function setNewProduct(item) {', selectCatalogFunction, 'catalog select function');

app = replaceOnce(app, 'function confirmRecognition(item) {', 'async function confirmRecognition(item) {', 'async confirm recognition');
app = replaceOnce(
  app,
  "  if (!item.matchedProductId) {\n    refreshCandidates(item);\n    const best = item.candidates[0];\n    if (!item.forceNew && best?.score >= 0.93) {\n      item.matchedProductId = best.productId;\n    } else if (!item.forceNew && best?.score >= 0.64) {\n      state.expanded.add(item.id);\n      renderReview();\n      toast('似た商品があります。候補を選ぶか「新商品として扱う」を押してください', 'warn');\n      return;\n    } else {\n      item.forceNew = true;\n    }\n  }",
  "  if (!item.matchedProductId) {\n    refreshCandidates(item);\n    const best = item.candidates[0];\n    if (!item.forceNew && best?.score >= 0.93) {\n      item.matchedProductId = best.productId;\n    } else if (!item.forceNew && best?.score >= 0.64) {\n      state.expanded.add(item.id);\n      renderReview();\n      toast('学習済み商品に似た候補があります。候補を選んでください', 'warn');\n      return;\n    } else if (!item.forceNew) {\n      const catalogCandidates = await refreshCatalogCandidates(item, { rerender: false });\n      const catalogBest = catalogCandidates[0];\n      if (catalogBest?.exact) {\n        const catalogProduct = importCatalogProduct(catalogBest);\n        item.matchedProductId = catalogProduct?.id || null;\n      } else if (catalogBest?.score >= 0.72) {\n        state.expanded.add(item.id);\n        renderReview();\n        toast('イオン綾川カタログに似た商品があります。候補を確認してください', 'warn');\n        return;\n      } else {\n        item.forceNew = true;\n      }\n    }\n  }",
  'catalog confirm decision'
);

app = replaceOnce(
  app,
  "  if (action === 'toggle-edit') {\n    if (state.expanded.has(item.id)) state.expanded.delete(item.id);\n    else state.expanded.add(item.id);\n    renderReview();\n  } else if (action === 'edit-name') {\n    state.expanded.add(item.id);\n    renderReview();\n    focusRecognitionName(item.id);",
  "  if (action === 'toggle-edit') {\n    const opening = !state.expanded.has(item.id);\n    if (opening) state.expanded.add(item.id);\n    else state.expanded.delete(item.id);\n    renderReview();\n    if (opening) void refreshCatalogCandidates(item);\n  } else if (action === 'edit-name') {\n    state.expanded.add(item.id);\n    renderReview();\n    void refreshCatalogCandidates(item);\n    focusRecognitionName(item.id);",
  'catalog edit lookup'
);
app = replaceOnce(
  app,
  "  } else if (action === 'candidate') {\n    selectCandidate(item, button.dataset.product);\n  } else if (action === 'new-product') {",
  "  } else if (action === 'candidate') {\n    selectCandidate(item, button.dataset.product);\n  } else if (action === 'catalog-candidate') {\n    selectCatalogCandidate(item, button.dataset.jan);\n  } else if (action === 'new-product') {",
  'catalog candidate click'
);
app = replaceOnce(app, "  } else if (action === 'confirm') {\n    confirmRecognition(item);\n  }", "  } else if (action === 'confirm') {\n    void confirmRecognition(item);\n  }", 'async confirm click');
app = replaceOnce(
  app,
  "    refreshCandidates(item);\n    state.expanded.add(item.id);\n    renderReview();\n  }\n}",
  "    refreshCandidates(item);\n    state.expanded.add(item.id);\n    renderReview();\n    void refreshCatalogCandidates(item);\n  }\n}",
  'catalog lookup after name change'
);

app = replaceOnce(
  app,
  "  $('#reviewArea').hidden = false;\n  renderReview();\n  if (session.workflowStatus === 'complete') {",
  "  $('#reviewArea').hidden = false;\n  renderReview();\n  void hydratePendingCatalogCandidates();\n  if (session.workflowStatus === 'complete') {",
  'catalog hydrate restored session'
);

app = replaceOnce(
  app,
  "      <div class=\"product-meta\">表記 ${aliases.length}件 · 手動学習 ${humanLearned}件</div>",
  "      <div class=\"product-meta\">表記 ${aliases.length}件 · 手動学習 ${humanLearned}件${product.source === 'aeon-ayagawa' ? ` · <span class=\"catalog-source\">イオン綾川${product.jan ? ` JAN ${escapeHtml(product.jan)}` : ''}</span>` : ''}</div>",
  'catalog source in local product card'
);

const catalogSearchFunctions = `\nlet catalogSearchTimer = null;\nasync function renderCatalogSearch() {\n  const input = $('#catalogSearch');\n  const results = $('#catalogSearchResults');\n  if (!input || !results) return;\n  const query = input.value.trim();\n  if (query.length < 2) {\n    results.innerHTML = '<div class=\"empty-mini\">2文字以上入力すると37,063商品から検索します</div>';\n    return;\n  }\n  results.innerHTML = '<div class=\"empty-mini\">検索中…</div>';\n  try {\n    await initCatalog();\n    const candidates = await catalogDb.search(query, 20);\n    results.innerHTML = candidates.length ? candidates.map(candidate => `<button type=\"button\" class=\"catalog-result\" data-catalog-register=\"${candidate.jan}\">\n      <span><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(candidate.category || 'カテゴリ未設定')} · JAN ${escapeHtml(candidate.jan)}</small></span>\n      <b>登録</b>\n    </button>`).join('') : '<div class=\"empty-mini\">近い商品が見つかりませんでした</div>';\n  } catch {\n    results.innerHTML = '<div class=\"empty-mini\">カタログを検索できませんでした</div>';\n  }\n}\n\nasync function handleCatalogSearchClick(event) {\n  const button = event.target.closest('[data-catalog-register]');\n  if (!button) return;\n  try {\n    const record = await catalogDb.getByJan(button.dataset.catalogRegister);\n    if (!record) return toast('商品情報を読み込めませんでした', 'error');\n    const product = importCatalogProduct({ jan: record.jan, name: record.name, category: record.category });\n    renderProducts();\n    renderHeaderStats();\n    toast(\`「\${product.canonicalName}」を学習DBへ登録しました\`);\n  } catch (error) {\n    toast(error.message || '商品を登録できませんでした', 'error');\n  }\n}\n\nasync function refreshCatalogNow() {\n  const button = $('#refreshCatalogBtn');\n  if (button) {\n    button.disabled = true;\n    button.textContent = '更新中…';\n  }\n  try {\n    await initCatalog({ force: true });\n    await hydratePendingCatalogCandidates();\n    toast('商品カタログを最新版へ更新しました');\n  } catch (error) {\n    toast(error.message || '商品カタログを更新できませんでした', 'error');\n  } finally {\n    if (button) {\n      button.disabled = false;\n      button.textContent = '商品カタログを更新';\n    }\n  }\n}\n\n`;
app = insertBeforeOnce(app, 'function addProductManually() {', catalogSearchFunctions, 'catalog search functions');

app = replaceOnce(
  app,
  "  $('#productSearch').addEventListener('input', renderProducts);\n  $('#addProductBtn').addEventListener('click', addProductManually);",
  "  $('#productSearch').addEventListener('input', renderProducts);\n  $('#addProductBtn').addEventListener('click', addProductManually);\n  $('#catalogSearch')?.addEventListener('input', () => {\n    clearTimeout(catalogSearchTimer);\n    catalogSearchTimer = setTimeout(renderCatalogSearch, 180);\n  });\n  $('#catalogSearchResults')?.addEventListener('click', handleCatalogSearchClick);\n  $('#refreshCatalogBtn')?.addEventListener('click', refreshCatalogNow);",
  'catalog search events'
);
app = replaceOnce(
  app,
  "  setupInstall();\n  registerServiceWorker();\n}",
  "  setupInstall();\n  registerServiceWorker();\n  void initCatalog().then(() => hydratePendingCatalogCandidates()).catch(() => {});\n}",
  'catalog init startup'
);
write('app.js', app);

let db = read('db.js');
db = replaceOnce(
  db,
  "  addProduct(canonicalName, location = '') {\n    const clean = String(canonicalName || '').trim();\n    if (!clean) throw new Error('商品名が空です');\n    const same = this.data.products.find(p => normalizeText(p.canonicalName) === normalizeText(clean));\n    if (same) return same;\n    const product = {\n      id: uid('product'), canonicalName: clean, location: location || '', active: true,\n      createdAt: now(), updatedAt: now()\n    };\n    this.data.products.push(product);\n    this.addAlias(product.id, clean, { source: 'canonical', verified: true, persist: false });\n    this.save();\n    return product;\n  }",
  "  addProduct(canonicalName, location = '', options = {}) {\n    const clean = String(canonicalName || '').trim();\n    if (!clean) throw new Error('商品名が空です');\n    const jan = String(options.jan || '').trim();\n    let same = jan ? this.data.products.find(p => String(p.jan || '') === jan) : null;\n    if (!same && jan) same = this.data.products.find(p => !p.jan && normalizeText(p.canonicalName) === normalizeText(clean));\n    if (!same && !jan) same = this.data.products.find(p => normalizeText(p.canonicalName) === normalizeText(clean));\n    if (same) {\n      if (jan && !same.jan) same.jan = jan;\n      if (options.source && !same.source) same.source = options.source;\n      if (options.category && !same.category) same.category = options.category;\n      if (options.catalogVersion) same.catalogVersion = options.catalogVersion;\n      same.updatedAt = now();\n      this.save();\n      return same;\n    }\n    const product = {\n      id: uid('product'), canonicalName: clean, location: location || '', active: true,\n      jan: jan || '', source: options.source || 'manual', category: options.category || '',\n      catalogVersion: options.catalogVersion || '', createdAt: now(), updatedAt: now()\n    };\n    this.data.products.push(product);\n    this.addAlias(product.id, clean, { source: options.source === 'aeon-ayagawa' ? 'aeon-catalog' : 'canonical', verified: true, persist: false });\n    this.save();\n    return product;\n  }",
  'db add catalog product metadata'
);
write('db.js', db);

let index = read('index.html');
index = replaceOnce(index, '  <link rel="stylesheet" href="./review-v2.css">', '  <link rel="stylesheet" href="./review-v2.css">\n  <link rel="stylesheet" href="./catalog-v13.css">', 'catalog stylesheet');
index = replaceOnce(
  index,
  "      <div id=\"productList\"></div>\n    </section>\n\n    <section id=\"tab-data\" class=\"tab-panel\">",
  "      <div id=\"productList\"></div>\n      <section class=\"card catalog-search-card\">\n        <span class=\"eyebrow\">AEON AYAGAWA CATALOG</span>\n        <h2>イオン綾川の商品を検索</h2>\n        <p class=\"card-sub\">公開カタログ37,063商品から探せます。選んだ商品だけ学習DBへ登録するので、普段の動作を重くしません。</p>\n        <input id=\"catalogSearch\" type=\"search\" placeholder=\"例：ブルガリアヨーグルト、牛乳、食パン\">\n        <div id=\"catalogSearchResults\" class=\"catalog-search-results\"><div class=\"empty-mini\">2文字以上入力すると検索します</div></div>\n      </section>\n    </section>\n\n    <section id=\"tab-data\" class=\"tab-panel\">",
  'catalog search card'
);
index = replaceOnce(
  index,
  "      <section class=\"card catalog-ready-card\">\n        <h2>外部商品カタログ</h2>\n        <p class=\"card-sub\">AEON綾川の商品カタログは、学習DBとは分けて別領域へ保存する設計です。大量の商品を追加しても、日々の訂正履歴を膨らませません。</p>\n        <div class=\"catalog-count\"><strong id=\"catalogItemCount\">0</strong><span>カタログ商品（統合待ち）</span></div>\n      </section>",
  "      <section class=\"card catalog-ready-card\">\n        <h2>イオン綾川 商品カタログ</h2>\n        <p class=\"card-sub\">公開カタログは学習DBとは別の端末内領域に保存します。注文確認では学習済み商品を優先し、見つからない時だけイオンの商品候補を出します。</p>\n        <div class=\"catalog-count\"><strong id=\"catalogItemCount\">0</strong><span>カタログ商品</span></div>\n        <div id=\"catalogStatus\" class=\"catalog-status\" data-state=\"loading\">商品カタログを確認しています…</div>\n        <button id=\"refreshCatalogBtn\" class=\"secondary-btn catalog-refresh-btn\" type=\"button\">商品カタログを更新</button>\n      </section>",
  'catalog data card'
);
write('index.html', index);

let sw = read('sw.js');
sw = replaceOnce(sw, "const CACHE = 'order-sheet-pwa-v12';", "const CACHE = 'order-sheet-pwa-v13';", 'service worker cache version');
sw = replaceOnce(sw, "  './review-v2.css',\n  './app.js',", "  './review-v2.css',\n  './catalog-v13.css',\n  './app.js',\n  './catalog-core.js',\n  './catalog-db.js',\n  './catalog/aeon-ayagawa/manifest.json',", 'service worker catalog assets');
sw = replaceOnce(
  sw,
  "        if (sameOrigin && response.ok) {\n          const copy = response.clone();\n          caches.open(CACHE).then(cache => cache.put(event.request, copy));\n        }",
  "        const isCatalogShard = sameOrigin && requestUrl.pathname.includes('/catalog/aeon-ayagawa/part-');\n        if (sameOrigin && response.ok && !isCatalogShard) {\n          const copy = response.clone();\n          caches.open(CACHE).then(cache => cache.put(event.request, copy));\n        }",
  'service worker avoid duplicate shard cache'
);
write('sw.js', sw);

let flowCss = read('chatgpt-flow.css');
flowCss = replaceOnce(flowCss, "content:' · v0.1.12'", "content:' · v0.1.13'", 'visible app version');
write('chatgpt-flow.css', flowCss);

const packagePath = path.join(root, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.version = '0.1.13';
const existingTest = String(packageJson.scripts?.test || '');
if (!existingTest.includes('tests/catalog-core.test.mjs')) {
  packageJson.scripts.test = existingTest.replace('node --test ', 'node --test tests/catalog-core.test.mjs ')
    .replace('&& node --check app.js', '&& node --check catalog-core.js && node --check catalog-db.js && node --check tools/aeon-catalog/build-static-catalog.mjs && node --check app.js');
}
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

console.log(`Integrated AEON Ayagawa catalog: ${manifest.count} products / ${manifest.shards.length} shards`);
