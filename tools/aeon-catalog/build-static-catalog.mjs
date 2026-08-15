import fs from 'node:fs';
import path from 'node:path';

const SHARD_COUNT = 32;
const PROMOTIONAL_CATEGORIES = new Set([
  '【お得市】', '【飲料まとめ買いキャンペーン】', 'おすすめ・特集', '【おすすめレシピ】',
  'トップバリュ', '予約商品', 'イオンの防災 いざ活', 'お得なボーナスポイント・メーカーフェア',
  '【カフェランテ ～コーヒー豆と世界の食品～】', '時短＆簡便おかず'
]);
const CATEGORY_PRIORITY = [
  '野菜', 'くだもの', 'お魚', 'お肉', '卵・牛乳・乳製品', 'ヨーグルト・ドリンクヨーグルト',
  '豆腐・納豆・こんにゃく', 'パン・シリアル・ジャム', 'お米・おかゆ・パックごはん・お餅',
  '麺・カップ麺・パスタ', '調味料', 'カレー・スープ・鍋つゆ・みそ汁', 'レトルト・インスタント食品',
  '冷凍食品・アイス', '粉類・乾物・缶詰', 'お菓子・スイーツ・製菓用品', '水・飲料',
  'コーヒー・紅茶・お茶・ココア（粉・袋）', 'お弁当・寿司・お惣菜・サラダ', '漬物・練物・佃煮',
  'ハム・ソーセージ・肉加工品', '紙・生理用品・介護', '日用品・生活雑貨', 'キッチン用品'
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, pretty ? 2 : 0), 'utf8');
}

function pickCategory(categories = []) {
  const values = [...new Set((Array.isArray(categories) ? categories : []).map(value => String(value || '').trim()).filter(Boolean))];
  for (const preferred of CATEGORY_PRIORITY) if (values.includes(preferred)) return preferred;
  const nonPromo = values.find(value => !PROMOTIONAL_CATEGORIES.has(value));
  return nonPromo || values[0] || '';
}

function shardIndex(jan) {
  const tail = Number(String(jan || '').slice(-6));
  return Number.isFinite(tail) ? tail % SHARD_COUNT : 0;
}

export function buildStaticCatalog(inputDir, outputDir) {
  const root = readJson(path.join(inputDir, 'products.json'));
  const sourceMeta = root.meta || readJson(path.join(inputDir, 'meta.json'));
  const categories = readJson(path.join(inputDir, 'categories.json'));
  const products = Array.isArray(root.products) ? root.products : [];

  if (String(sourceMeta.storeId || '') !== '01050000070020') throw new Error(`Unexpected AEON store ID: ${sourceMeta.storeId}`);
  if (products.length < 30000) throw new Error(`Catalog is unexpectedly small: ${products.length}`);

  const uniqueJans = new Set();
  const uniqueNames = new Set();
  const shards = Array.from({ length: SHARD_COUNT }, () => []);
  for (const product of products) {
    const jan = String(product?.jan || '').trim();
    const name = String(product?.name || '').trim();
    if (!/^\d{13}$/.test(jan) || !name || uniqueJans.has(jan)) continue;
    uniqueJans.add(jan);
    uniqueNames.add(name);
    shards[shardIndex(jan)].push([jan, name, pickCategory(product.categories)]);
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const shardMeta = [];
  for (let index = 0; index < shards.length; index += 1) {
    const rows = shards[index].sort((a, b) => a[0].localeCompare(b[0]));
    const file = `part-${String(index).padStart(2, '0')}.json`;
    writeJson(path.join(outputDir, file), rows);
    shardMeta.push({ file, count: rows.length });
  }

  const manifest = {
    schemaVersion: 1,
    provider: 'aeon-ayagawa',
    storeId: String(sourceMeta.storeId),
    storeName: String(sourceMeta.storeName || 'イオン綾川店'),
    sourceRoot: String(sourceMeta.sourceRoot || ''),
    catalogVersion: String(sourceMeta.generatedAt || ''),
    count: uniqueJans.size,
    uniqueNames: uniqueNames.size,
    categoryCount: Array.isArray(categories) ? categories.length : 0,
    requestCount: Number(sourceMeta.requestCount || 0),
    note: 'Public AEON Net Super catalog reference. The app keeps this catalog separate from confirmed/learned products and copies only human-selected catalog products into the learning DB.',
    shards: shardMeta
  };
  writeJson(path.join(outputDir, 'manifest.json'), manifest, true);
  writeJson(path.join(outputDir, 'categories.json'), categories, true);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inputDir = path.resolve(process.argv[2] || 'data/aeon-ayagawa');
  const outputDir = path.resolve(process.argv[3] || 'catalog/aeon-ayagawa');
  const manifest = buildStaticCatalog(inputDir, outputDir);
  console.log(JSON.stringify(manifest, null, 2));
}
