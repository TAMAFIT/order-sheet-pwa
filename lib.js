export const APP_SCHEMA_VERSION = 1;

export function katakanaToHiragana(value = '') {
  return String(value).replace(/[ァ-ヶ]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

export function normalizeText(value = '') {
  return katakanaToHiragana(String(value).normalize('NFKC'))
    .toLowerCase()
    .replace(/[\s　・･,，.。/／\\()（）\[\]【】「」『』:：;；\-ー_]+/g, '')
    .replace(/[①❶]/g, '1')
    .replace(/[②❷]/g, '2')
    .replace(/[③❸]/g, '3')
    .replace(/[④❹]/g, '4')
    .replace(/[⑤❺]/g, '5')
    .replace(/[⑥❻]/g, '6')
    .replace(/[⑦❼]/g, '7')
    .replace(/[⑧❽]/g, '8')
    .replace(/[⑨❾]/g, '9')
    .replace(/[⑩❿]/g, '10')
    .trim();
}

export function levenshtein(a = '', b = '') {
  const s = normalizeText(a);
  const t = normalizeText(b);
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  const curr = new Array(t.length + 1);
  for (let i = 1; i <= s.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= t.length; j += 1) prev[j] = curr[j];
  }
  return prev[t.length];
}

export function similarity(a = '', b = '') {
  const s = normalizeText(a);
  const t = normalizeText(b);
  const max = Math.max(s.length, t.length);
  if (!max) return 1;
  return Math.max(0, 1 - levenshtein(s, t) / max);
}

export function uid(prefix = 'id') {
  const rand = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${rand}`;
}

export function scoreCandidate(rawName, product, aliases = [], writerTag = '') {
  const raw = normalizeText(rawName);
  if (!raw) return 0;
  const productNames = [product.canonicalName, ...aliases.map(a => a.alias)].filter(Boolean);
  let score = 0;
  for (const name of productNames) {
    const candidate = normalizeText(name);
    if (!candidate) continue;
    if (raw === candidate) score = Math.max(score, 1);
    else {
      const sim = similarity(raw, candidate);
      const contains = raw.includes(candidate) || candidate.includes(raw);
      score = Math.max(score, sim + (contains ? 0.08 : 0));
    }
  }
  const writerAliases = aliases.filter(a => writerTag && a.writerTag === writerTag);
  if (writerAliases.some(a => normalizeText(a.alias) === raw)) score += 0.06;
  return Math.min(1, score);
}

export function rankCandidates(rawName, products, aliases, writerTag = '', limit = 5) {
  return products
    .filter(p => p.active !== false)
    .map(product => ({
      product,
      score: scoreCandidate(
        rawName,
        product,
        aliases.filter(alias => alias.productId === product.id),
        writerTag
      )
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function resolveRecognitionItem(item, db, writerTag = '') {
  const rawName = String(item.name || item.product || '').trim();
  const quantity = Math.max(0, Number(item.quantity ?? item.qty ?? 1) || 0);
  const candidates = rankCandidates(rawName, db.products, db.aliases, writerTag, 5);
  const best = candidates[0];
  const aiConfidence = Number(item.confidence);
  const confidence = Number.isFinite(aiConfidence)
    ? Math.max(0, Math.min(1, Math.max(best?.score || 0, aiConfidence * 0.85)))
    : (best?.score || 0);
  return {
    id: uid('recognition'),
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : 0,
    place: String(item.place || item.facility || '').trim(),
    time: String(item.time || '').trim(),
    person: String(item.person || item.customer || item.nameOfPerson || '').trim(),
    rawName,
    quantity,
    confidence,
    matchedProductId: best?.score >= 0.93 ? best.product.id : null,
    suggestedProductId: best?.product.id || null,
    suggestedScore: best?.score || 0,
    status: 'pending',
    forceNew: false,
    candidates: candidates.map(({ product, score }) => ({
      productId: product.id,
      canonicalName: product.canonicalName,
      location: product.location || '',
      score
    })),
    note: String(item.note || ''),
    cancelled: Boolean(item.cancelled)
  };
}

export function aggregateRecognitions(recognitions, products) {
  const productMap = new Map(products.map(p => [p.id, p]));
  const totals = new Map();
  for (const item of recognitions) {
    if (item.status !== 'confirmed' || item.cancelled || !item.matchedProductId || item.quantity <= 0) continue;
    const product = productMap.get(item.matchedProductId);
    if (!product) continue;
    const current = totals.get(product.id) || {
      productId: product.id,
      canonicalName: product.canonicalName,
      location: product.location || '',
      quantity: 0
    };
    current.quantity += item.quantity;
    current.location = product.location || '';
    totals.set(product.id, current);
  }
  return [...totals.values()].sort((a, b) => {
    const la = a.location || 'Z';
    const lb = b.location || 'Z';
    return la.localeCompare(lb, 'ja') || a.canonicalName.localeCompare(b.canonicalName, 'ja');
  });
}

export function parseAnalysisPayload(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  const items = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(items)) throw new Error('JSONに items 配列がありません');
  return items
    .filter(item => item && typeof item === 'object')
    .map((item, index) => ({
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1,
      place: String(item.place || item.facility || '').trim(),
      time: String(item.time || '').trim(),
      person: String(item.person || item.customer || item.nameOfPerson || '').trim(),
      name: String(item.name || item.product || '').trim(),
      quantity: Number(item.quantity ?? item.qty ?? 1),
      confidence: item.confidence == null ? undefined : Number(item.confidence),
      cancelled: Boolean(item.cancelled),
      note: String(item.note || '')
    }))
    .filter(item => item.name && Number.isFinite(item.quantity))
    .sort((a, b) => a.order - b.order);
}

export function makeAnalysisPrompt(productContext = [], returnUrl = '') {
  const context = productContext.slice(0, 300).map(p => ({
    id: p.id,
    name: p.canonicalName,
    aliases: p.aliases || []
  }));
  const returnInstruction = returnUrl
    ? `\n解析後、JSONコードブロックの直後にこのリンクをそのまま1行だけ付けてください。\n[集計アプリに戻る](${returnUrl})`
    : '';
  return `この画像は個人別の手書き注文票です。紙に書かれている順番を崩さず、各注文明細を1件ずつJSONで返してください。まだ同じ商品を統合・合算しないでください。\n\n重要ルール:\n- 紙の上から下、同じ行では左から右の順番を保ち order を1,2,3...で付ける。\n- 施設名・売り場名など見出しが読める場合は place に入れる。\n- 時間が読める場合は time に入れる。\n- 各個人名は person に入れる。読めなければ空文字でよい。\n- 商品名は name、注文数量は quantity。\n- 取消線で消された商品は cancelled=true。\n- 商品名中の数字（例: 2個入、2L）と注文数量を混同しない。\n- 丸で囲まれた数字は注文数量として扱う。\n- 読めない場合は勝手に断定せず confidence を下げる。\n- 同じ商品に見えてもこの段階では統合しない。\n- 出力の最初は必ずJSONコードブロック1つ。余計な説明は不要。\n\n形式:\n\`\`\`json\n{\n  "items": [\n    {"order":1,"place":"施設名","time":"10:40〜11:05","person":"個人名","name":"商品名","quantity":2,"confidence":0.92,"cancelled":false,"note":""}\n  ]\n}\n\`\`\`${returnInstruction}\n\n既知の商品辞書（参考。無理に合わせない）:\n${JSON.stringify(context, null, 2)}`;
}
