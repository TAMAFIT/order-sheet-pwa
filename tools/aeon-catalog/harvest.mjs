import fs from 'node:fs/promises';
import path from 'node:path';

const STORE_ID = '01050000070020';
const STORE_NAME = 'イオン綾川店';
const ROOT = `https://shop.aeon.com/netsuper/${STORE_ID}/`;
const OUT_DIR = path.resolve('data/aeon-ayagawa');
const REQUEST_DELAY_MS = Number(process.env.AEON_REQUEST_DELAY_MS || 850);
const MAX_REQUESTS = Number(process.env.AEON_MAX_REQUESTS || 650);
const USER_AGENT = 'TAMAFIT-OrderSheetCatalogBuilder/1.0 (+public catalog dictionary; low-rate crawl)';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function decodeEntities(text = '') {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
  };
  return String(text)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (all, name) => named[name.toLowerCase()] ?? all);
}

function stripTags(html = '') {
  return decodeEntities(String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function extractLinks(html, base) {
  const out = new Set();
  for (const match of String(html).matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(decodeEntities(match[1]), base);
      if (url.protocol === 'https:' && url.hostname === 'shop.aeon.com') out.add(url.href);
    } catch {}
  }
  return [...out];
}

function extractHeading(html) {
  const candidates = [];
  for (const tag of ['h1', 'h2']) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    for (const m of String(html).matchAll(re)) {
      const text = stripTags(m[1]);
      if (text && !/イオンネットスーパー|ご注文の商品|店舗情報/.test(text)) candidates.push(text);
    }
  }
  return candidates[0] || '';
}

function extractTotalCount(html) {
  const text = stripTags(html);
  const m = text.match(/全\s*([\d,]+)\s*件/);
  return m ? Number(m[1].replaceAll(',', '')) : 0;
}

function productFromAnchor(anchorHtml, href, pageHtml, anchorEndIndex, categoryName, listUrl) {
  let url;
  try { url = new URL(href, listUrl); } catch { return null; }
  const escapedStore = STORE_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const productPath = new RegExp(`/netsuper/${escapedStore}/${escapedStore}(\\d{13})\\.html$`, 'i');
  const m = url.pathname.match(productPath);
  if (!m) return null;

  let name = stripTags(anchorHtml);
  if (!name) return null;
  name = name.replace(/^\d+\.\s*/, '').trim();
  if (!name || /Image:|まとめて買う|カゴ追加/.test(name)) return null;

  const nearby = pageHtml.slice(anchorEndIndex, anchorEndIndex + 1800);
  const priceMatch = stripTags(nearby).match(/([\d,]+(?:\.\d+)?)円/);
  const priceYen = priceMatch ? Number(priceMatch[1].replaceAll(',', '')) : null;

  return {
    jan: m[1],
    name,
    category: categoryName || '',
    priceYen,
    productUrl: url.href,
    listUrl,
    storeId: STORE_ID,
    storeName: STORE_NAME,
  };
}

function extractProducts(html, listUrl) {
  const categoryName = extractHeading(html);
  const results = [];
  const anchorRe = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const m of String(html).matchAll(anchorRe)) {
    const item = productFromAnchor(m[4], decodeEntities(m[2]), html, m.index + m[0].length, categoryName, listUrl);
    if (item) results.push(item);
  }
  return results;
}

function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      current = { agents: [value.toLowerCase()], disallow: [], allow: [] };
      groups.push(current);
    } else if (current && key === 'disallow') current.disallow.push(value);
    else if (current && key === 'allow') current.allow.push(value);
  }
  return groups;
}

function robotsAllows(groups, pathname) {
  const applicable = groups.filter(g => g.agents.includes('*') || g.agents.some(a => USER_AGENT.toLowerCase().includes(a)));
  if (!applicable.length) return true;
  const rules = [];
  for (const g of applicable) {
    for (const p of g.disallow) if (p) rules.push({ kind: 'disallow', path: p });
    for (const p of g.allow) if (p) rules.push({ kind: 'allow', path: p });
  }
  const matched = rules
    .filter(r => pathname.startsWith(r.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return !matched || matched.kind === 'allow';
}

let requestCount = 0;
async function fetchText(url, { tolerate404 = false } = {}) {
  if (requestCount >= MAX_REQUESTS) throw new Error(`Request safety cap reached (${MAX_REQUESTS})`);
  if (requestCount > 0) await sleep(REQUEST_DELAY_MS);
  requestCount += 1;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ja,en;q=0.7',
      },
      redirect: 'follow',
    });
    if (tolerate404 && res.status === 404) return null;
    if (res.status === 429 || res.status === 503) {
      await sleep((attempt + 1) * 4000);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
    return await res.text();
  }
  throw new Error(`Repeated throttling: ${url}`);
}

function normalizeCategoryUrl(raw) {
  let url;
  try { url = new URL(raw, ROOT); } catch { return null; }
  if (url.hostname !== 'shop.aeon.com') return null;
  if (!url.pathname.startsWith(`/netsuper/${STORE_ID}/`)) return null;
  const leaf = url.pathname.split('/').filter(Boolean).at(-1) || '';
  if (!/^[0-9A-Za-z]{1,4}\.html$/i.test(leaf)) return null;
  if (leaf.startsWith(STORE_ID)) return null;
  url.search = '';
  url.hash = '';
  return url.href;
}

function discoverCategoryUrls(html, base) {
  const set = new Set();
  for (const href of extractLinks(html, base)) {
    const normalized = normalizeCategoryUrl(href);
    if (normalized) set.add(normalized);
  }
  return [...set];
}

async function discoverCategories(robotsGroups) {
  const discovered = new Set();
  const seeds = [ROOT, `${ROOT}aeoncatalog/category/genrelist/`];
  for (const seed of seeds) {
    const u = new URL(seed);
    if (!robotsAllows(robotsGroups, u.pathname)) continue;
    try {
      const html = await fetchText(seed, { tolerate404: true });
      if (!html) continue;
      discoverCategoryUrls(html, seed).forEach(x => discovered.add(x));
    } catch (error) {
      console.warn(`Category seed failed: ${seed}: ${error.message}`);
    }
  }

  if (discovered.size < 5) {
    const fallbackCodes = [
      '23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','50','60','1A','1R'
    ];
    for (const code of fallbackCodes) discovered.add(`${ROOT}${code}.html`);
  }
  return [...discovered];
}

async function crawlCategory(categoryUrl, robotsGroups, products, categoryStats) {
  const url = new URL(categoryUrl);
  if (!robotsAllows(robotsGroups, url.pathname)) {
    categoryStats.push({ categoryUrl, skipped: 'robots.txt' });
    return;
  }

  let firstHtml;
  try {
    firstHtml = await fetchText(categoryUrl, { tolerate404: true });
  } catch (error) {
    categoryStats.push({ categoryUrl, error: error.message });
    return;
  }
  if (!firstHtml) {
    categoryStats.push({ categoryUrl, skipped: '404' });
    return;
  }

  const title = extractHeading(firstHtml);
  const total = extractTotalCount(firstHtml);
  const pages = Math.max(1, total ? Math.ceil(total / 100) : 1);
  let pageProducts = extractProducts(firstHtml, categoryUrl);
  mergeProducts(products, pageProducts);

  for (let p = 2; p <= pages; p += 1) {
    const pageUrl = new URL(categoryUrl);
    pageUrl.searchParams.set('p', String(p));
    pageUrl.searchParams.set('sort', 'recommend');
    try {
      const html = await fetchText(pageUrl.href, { tolerate404: true });
      if (!html) break;
      pageProducts = extractProducts(html, pageUrl.href);
      mergeProducts(products, pageProducts);
      if (!pageProducts.length && p > 2) break;
    } catch (error) {
      categoryStats.push({ categoryUrl, title, total, pages, page: p, error: error.message });
      break;
    }
  }

  categoryStats.push({ categoryUrl, title, total, pages });
  console.log(`${title || categoryUrl}: listed=${total || '?'} pages=${pages} uniqueProducts=${products.size}`);
}

function mergeProducts(products, incoming) {
  for (const item of incoming) {
    const existing = products.get(item.jan);
    if (!existing) {
      products.set(item.jan, { ...item, categories: item.category ? [item.category] : [] });
      continue;
    }
    if (!existing.name && item.name) existing.name = item.name;
    if (existing.priceYen == null && item.priceYen != null) existing.priceYen = item.priceYen;
    if (item.category && !existing.categories.includes(item.category)) existing.categories.push(item.category);
    if (!existing.listUrl && item.listUrl) existing.listUrl = item.listUrl;
  }
}

async function writeOutputs(products, categoryStats, robotsInfo) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const rows = [...products.values()]
    .map(item => ({
      jan: item.jan,
      name: item.name,
      categories: [...new Set(item.categories || [])].sort(),
      priceYen: item.priceYen,
      productUrl: item.productUrl,
      listUrl: item.listUrl,
      storeId: STORE_ID,
      storeName: STORE_NAME,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const meta = {
    generatedAt: new Date().toISOString(),
    storeId: STORE_ID,
    storeName: STORE_NAME,
    sourceRoot: ROOT,
    productCount: rows.length,
    requestCount,
    requestDelayMs: REQUEST_DELAY_MS,
    robots: robotsInfo,
    note: 'Public AEON Net Super pages only. Catalog availability may differ from mobile-sales inventory and changes over time.',
  };

  await fs.writeFile(path.join(OUT_DIR, 'products.json'), JSON.stringify({ meta, products: rows }, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'categories.json'), JSON.stringify(categoryStats, null, 2));

  const header = ['jan','name','categories','priceYen','productUrl','listUrl','storeId','storeName'];
  const csv = [header.join(',')]
    .concat(rows.map(r => [
      r.jan,
      r.name,
      r.categories.join(' / '),
      r.priceYen ?? '',
      r.productUrl,
      r.listUrl,
      r.storeId,
      r.storeName,
    ].map(csvEscape).join(',')))
    .join('\n');
  await fs.writeFile(path.join(OUT_DIR, 'products.csv'), csv);
  await fs.writeFile(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log(JSON.stringify(meta, null, 2));
  if (rows.length < 50) throw new Error(`Harvest produced only ${rows.length} products; inspect categories.json before trusting output.`);
}

async function main() {
  let robotsText = '';
  let robotsInfo = { fetched: false, allowed: true };
  try {
    const res = await fetch('https://shop.aeon.com/robots.txt', { headers: { 'user-agent': USER_AGENT } });
    if (res.ok) {
      robotsText = await res.text();
      robotsInfo = { fetched: true, status: res.status, allowed: true };
    } else {
      robotsInfo = { fetched: true, status: res.status, allowed: true, note: 'robots.txt not returned with 2xx; crawl remains low-rate and public-only' };
    }
  } catch (error) {
    robotsInfo = { fetched: false, allowed: true, note: error.message };
  }
  const robotsGroups = parseRobots(robotsText);
  if (!robotsAllows(robotsGroups, `/netsuper/${STORE_ID}/`)) {
    robotsInfo.allowed = false;
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(path.join(OUT_DIR, 'meta.json'), JSON.stringify({ ...robotsInfo, generatedAt: new Date().toISOString() }, null, 2));
    throw new Error('robots.txt disallows this store path; stopping without crawling.');
  }

  const categories = await discoverCategories(robotsGroups);
  console.log(`Discovered/seeded ${categories.length} category URLs`);

  const products = new Map();
  const categoryStats = [];
  for (const categoryUrl of categories) {
    if (requestCount >= MAX_REQUESTS) break;
    await crawlCategory(categoryUrl, robotsGroups, products, categoryStats);
  }
  await writeOutputs(products, categoryStats, robotsInfo);
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
