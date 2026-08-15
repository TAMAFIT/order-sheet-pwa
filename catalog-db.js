import { catalogGrams, catalogNormalize, chooseLookupGrams, rankCatalogCandidates } from './catalog-core.js';

const DB_NAME = 'order-sheet-aeon-catalog-v1';
const DB_VERSION = 1;
const PRODUCT_STORE = 'products';
const META_STORE = 'meta';
const MANIFEST_URL = './catalog/aeon-ayagawa/manifest.json';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

function openDatabase() {
  if (!globalThis.indexedDB) throw new Error('この端末では商品カタログ保存を利用できません');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PRODUCT_STORE)) {
        const products = database.createObjectStore(PRODUCT_STORE, { keyPath: 'jan' });
        products.createIndex('grams', 'grams', { multiEntry: true });
        products.createIndex('normalized', 'normalized', { unique: false });
        products.createIndex('category', 'category', { unique: false });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('商品カタログDBを開けませんでした'));
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`商品カタログを取得できませんでした (${response.status})`);
  return response.json();
}

function rowToRecord(row) {
  const [jan, name, category = ''] = Array.isArray(row) ? row : [];
  const cleanJan = String(jan || '').trim();
  const cleanName = String(name || '').trim();
  if (!/^\d{13}$/.test(cleanJan) || !cleanName) return null;
  return {
    jan: cleanJan,
    name: cleanName,
    category: String(category || '').trim(),
    normalized: catalogNormalize(cleanName),
    grams: catalogGrams(cleanName)
  };
}

export class AeonCatalogDb {
  constructor() {
    this.databasePromise = null;
    this.readyMeta = null;
  }

  database() {
    if (!this.databasePromise) this.databasePromise = openDatabase();
    return this.databasePromise;
  }

  async storedMeta() {
    const database = await this.database();
    const transaction = database.transaction(META_STORE, 'readonly');
    const result = await requestResult(transaction.objectStore(META_STORE).get('catalog'));
    return result || null;
  }

  async clearCatalog() {
    const database = await this.database();
    const transaction = database.transaction([PRODUCT_STORE, META_STORE], 'readwrite');
    transaction.objectStore(PRODUCT_STORE).clear();
    transaction.objectStore(META_STORE).delete('catalog');
    await transactionDone(transaction);
    this.readyMeta = null;
  }

  async importShard(rows = []) {
    const database = await this.database();
    const transaction = database.transaction(PRODUCT_STORE, 'readwrite');
    const store = transaction.objectStore(PRODUCT_STORE);
    for (const row of rows) {
      const record = rowToRecord(row);
      if (record) store.put(record);
    }
    await transactionDone(transaction);
  }

  async ensureReady({ force = false, onProgress = null } = {}) {
    const current = await this.storedMeta();
    let manifest;
    try {
      manifest = await fetchJson(MANIFEST_URL);
    } catch (error) {
      if (!force && current?.count) {
        this.readyMeta = current;
        onProgress?.({ loaded: Number(current.count || 0), total: Number(current.count || 0), status: 'offline-ready' });
        return current;
      }
      throw error;
    }
    if (!manifest?.catalogVersion || !Array.isArray(manifest.shards)) throw new Error('商品カタログの管理情報が不正です');
    if (!force && current?.catalogVersion === manifest.catalogVersion && Number(current?.count) === Number(manifest.count)) {
      this.readyMeta = current;
      onProgress?.({ loaded: Number(current.count || 0), total: Number(current.count || 0), status: 'ready' });
      return current;
    }

    await this.clearCatalog();
    let loaded = 0;
    const total = Number(manifest.count || 0);
    onProgress?.({ loaded, total, status: 'starting' });

    const shards = manifest.shards.slice();
    const batchSize = 4;
    for (let index = 0; index < shards.length; index += batchSize) {
      const batch = shards.slice(index, index + batchSize);
      const payloads = await Promise.all(batch.map(shard => fetchJson(`./catalog/aeon-ayagawa/${shard.file}`)));
      for (let offset = 0; offset < batch.length; offset += 1) {
        const rows = Array.isArray(payloads[offset]) ? payloads[offset] : [];
        await this.importShard(rows);
        loaded += rows.length;
        onProgress?.({ loaded: Math.min(loaded, total), total, status: 'importing' });
      }
    }

    const database = await this.database();
    const transaction = database.transaction(META_STORE, 'readwrite');
    const meta = {
      key: 'catalog',
      provider: 'aeon-ayagawa',
      storeId: String(manifest.storeId || ''),
      storeName: String(manifest.storeName || 'イオン綾川店'),
      catalogVersion: String(manifest.catalogVersion),
      count: total,
      uniqueNames: Number(manifest.uniqueNames || 0),
      categoryCount: Number(manifest.categoryCount || 0),
      importedAt: new Date().toISOString()
    };
    transaction.objectStore(META_STORE).put(meta);
    await transactionDone(transaction);
    this.readyMeta = meta;
    onProgress?.({ loaded: total, total, status: 'ready' });
    return meta;
  }

  async getByJan(jan) {
    const database = await this.database();
    const transaction = database.transaction(PRODUCT_STORE, 'readonly');
    return requestResult(transaction.objectStore(PRODUCT_STORE).get(String(jan || '')));
  }

  async search(query, limit = 8) {
    const normalized = catalogNormalize(query);
    if (normalized.length < 2) return [];
    const database = await this.database();
    const transaction = database.transaction(PRODUCT_STORE, 'readonly');
    const store = transaction.objectStore(PRODUCT_STORE);
    const exactMatches = await requestResult(store.index('normalized').getAll(normalized, 20));

    const candidates = new Map();
    for (const record of exactMatches || []) {
      candidates.set(record.jan, { record, matchedGramCount: 99 });
    }

    const grams = chooseLookupGrams(normalized, 5);
    for (const gram of grams) {
      const rows = await requestResult(store.index('grams').getAll(gram, 420));
      for (const record of rows || []) {
        const entry = candidates.get(record.jan) || { record, matchedGramCount: 0 };
        entry.matchedGramCount += 1;
        candidates.set(record.jan, entry);
      }
    }

    return rankCatalogCandidates(query, [...candidates.values()], limit);
  }
}
