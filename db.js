import { APP_SCHEMA_VERSION, normalizeText, uid } from './lib.js';

const STORAGE_KEY = 'order-sheet-pwa-db-v1';

const now = () => new Date().toISOString();

const seedProducts = [
  ['らくれん牛乳', 'B', ['らくれん', 'ラクレン牛乳']],
  ['おーいお茶 2L', 'A', ['おーいお茶2L', 'おーいお茶 2ℓ']],
  ['コロッケ2個入', 'C', ['コロッケ2コ入', 'コロッケ2ヶ入']],
  ['カロリーメイト アップル', 'B', ['カロリーメイトアップル']],
  ['ごまドレッシング', 'A', ['ごまドレ', 'ゴマドレ']],
  ['ヤクルト10本', 'D', ['ヤクルト10本入']]
];

function createEmptyDb() {
  return {
    schemaVersion: APP_SCHEMA_VERSION,
    createdAt: now(),
    updatedAt: now(),
    products: [],
    aliases: [],
    recognitionHistory: [],
    locationHistory: [],
    sessions: [],
    writers: [],
    settings: {
      analysisMode: 'chatgpt',
      backendEndpoint: '',
      providerLabel: 'OpenAI / Gemini compatible backend',
      autoAcceptThreshold: 0.93,
      reviewThreshold: 0.64
    }
  };
}

function seedDb() {
  const db = createEmptyDb();
  for (const [canonicalName, location, aliases] of seedProducts) {
    const product = {
      id: uid('product'),
      canonicalName,
      location,
      active: true,
      createdAt: now(),
      updatedAt: now()
    };
    db.products.push(product);
    for (const alias of [canonicalName, ...aliases]) {
      db.aliases.push({
        id: uid('alias'),
        productId: product.id,
        alias,
        normalized: normalizeText(alias),
        source: alias === canonicalName ? 'canonical' : 'seed',
        verified: true,
        writerTag: '',
        hitCount: 0,
        createdAt: now(),
        lastSeenAt: null
      });
    }
  }
  return db;
}

function sanitizeDb(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new Error('バックアップ形式が不正です');
  if (Number(candidate.schemaVersion) !== APP_SCHEMA_VERSION) throw new Error(`未対応のDBバージョンです: ${candidate.schemaVersion}`);
  const base = createEmptyDb();
  const db = {
    ...base,
    ...candidate,
    products: Array.isArray(candidate.products) ? candidate.products : [],
    aliases: Array.isArray(candidate.aliases) ? candidate.aliases : [],
    recognitionHistory: Array.isArray(candidate.recognitionHistory) ? candidate.recognitionHistory : [],
    locationHistory: Array.isArray(candidate.locationHistory) ? candidate.locationHistory : [],
    sessions: Array.isArray(candidate.sessions) ? candidate.sessions : [],
    writers: Array.isArray(candidate.writers) ? candidate.writers : [],
    settings: { ...base.settings, ...(candidate.settings || {}) }
  };
  return db;
}

export class OrderDb {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seedDb();
      return sanitizeDb(JSON.parse(raw));
    } catch (error) {
      console.warn('DB load failed; using seed DB', error);
      return seedDb();
    }
  }

  save() {
    this.data.updatedAt = now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    return this.data;
  }

  snapshot() {
    return structuredClone ? structuredClone(this.data) : JSON.parse(JSON.stringify(this.data));
  }

  exportJson() {
    return JSON.stringify(this.data, null, 2);
  }

  importJson(text) {
    this.data = sanitizeDb(JSON.parse(text));
    this.save();
    return this.data;
  }

  reset() {
    this.data = seedDb();
    this.save();
  }

  addWriter(tag) {
    const clean = String(tag || '').trim();
    if (!clean) return;
    const existing = this.data.writers.find(w => w.tag === clean);
    if (existing) existing.lastUsedAt = now();
    else this.data.writers.push({ id: uid('writer'), tag: clean, createdAt: now(), lastUsedAt: now() });
    this.save();
  }

  addProduct(canonicalName, location = '') {
    const clean = String(canonicalName || '').trim();
    if (!clean) throw new Error('商品名が空です');
    const same = this.data.products.find(p => normalizeText(p.canonicalName) === normalizeText(clean));
    if (same) return same;
    const product = {
      id: uid('product'), canonicalName: clean, location: location || '', active: true,
      createdAt: now(), updatedAt: now()
    };
    this.data.products.push(product);
    this.addAlias(product.id, clean, { source: 'canonical', verified: true, persist: false });
    this.save();
    return product;
  }

  addAlias(productId, alias, options = {}) {
    const clean = String(alias || '').trim();
    if (!clean) return null;
    const normalized = normalizeText(clean);
    let existing = this.data.aliases.find(a => a.productId === productId && a.normalized === normalized && (a.writerTag || '') === (options.writerTag || ''));
    if (existing) {
      existing.hitCount = Number(existing.hitCount || 0) + Number(options.incrementHit || 0);
      existing.lastSeenAt = options.touch === false ? existing.lastSeenAt : now();
      if (options.verified) existing.verified = true;
    } else {
      existing = {
        id: uid('alias'), productId, alias: clean, normalized,
        source: options.source || 'human', verified: options.verified !== false,
        writerTag: String(options.writerTag || '').trim(),
        hitCount: Number(options.incrementHit || 0), createdAt: now(), lastSeenAt: now()
      };
      this.data.aliases.push(existing);
    }
    if (options.persist !== false) this.save();
    return existing;
  }

  recordRecognition({ sessionId, rawName, quantity, confidence, chosenProductId, suggestedProductId, corrected, writerTag, status }) {
    this.data.recognitionHistory.push({
      id: uid('history'), sessionId, rawName, normalized: normalizeText(rawName), quantity,
      confidence, chosenProductId: chosenProductId || null, suggestedProductId: suggestedProductId || null,
      corrected: Boolean(corrected), writerTag: String(writerTag || '').trim(), status: status || '', createdAt: now()
    });
    if (this.data.recognitionHistory.length > 4000) this.data.recognitionHistory.splice(0, this.data.recognitionHistory.length - 4000);
    this.save();
  }

  mapRecognitionToProduct(recognition, productId, { writerTag = '', sessionId = '' } = {}) {
    const product = this.data.products.find(p => p.id === productId);
    if (!product) throw new Error('選択した商品が見つかりません');
    const wasDifferent = recognition.matchedProductId && recognition.matchedProductId !== productId;
    this.addAlias(productId, recognition.rawName, {
      source: 'human-correction', verified: true, writerTag, incrementHit: 1, persist: false
    });
    recognition.matchedProductId = productId;
    recognition.status = 'confirmed';
    this.data.recognitionHistory.push({
      id: uid('history'), sessionId, rawName: recognition.rawName, normalized: normalizeText(recognition.rawName),
      quantity: recognition.quantity, confidence: recognition.confidence,
      chosenProductId: productId, suggestedProductId: recognition.candidates?.[0]?.productId || null,
      corrected: Boolean(wasDifferent || recognition.status === 'unknown'), writerTag: String(writerTag || '').trim(),
      status: 'confirmed', createdAt: now()
    });
    this.save();
    return product;
  }

  setLocation(productId, location) {
    const product = this.data.products.find(p => p.id === productId);
    if (!product) throw new Error('商品が見つかりません');
    const next = String(location || '').trim().toUpperCase();
    const previous = product.location || '';
    if (previous === next) return product;
    product.location = next;
    product.updatedAt = now();
    this.data.locationHistory.push({
      id: uid('location'), productId, from: previous, to: next, changedAt: now()
    });
    this.save();
    return product;
  }

  saveSession(session) {
    const index = this.data.sessions.findIndex(s => s.id === session.id);
    if (index >= 0) this.data.sessions[index] = { ...this.data.sessions[index], ...session, updatedAt: now() };
    else this.data.sessions.unshift({ ...session, createdAt: now(), updatedAt: now() });
    if (this.data.sessions.length > 200) this.data.sessions.length = 200;
    this.save();
  }

  updateSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
  }
}
