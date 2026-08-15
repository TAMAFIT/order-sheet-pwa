// Cloudflare Worker + D1 reference backend for Custom GPT Actions.
// No secrets belong in this file. Configure ACTION_API_KEY and ALLOWED_ORIGIN as Worker secrets/vars.

function json(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      'cache-control': 'no-store'
    }
  });
}

function allowedOrigin(request, env) {
  const configured = String(env.ALLOWED_ORIGIN || '').trim();
  if (!configured) return '*';
  const requestOrigin = request.headers.get('origin') || '';
  return requestOrigin === configured ? configured : configured;
}

function bearerToken(request) {
  const value = request.headers.get('authorization') || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

function validScanId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function sanitizeItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 500) throw new Error('items must contain 1-500 rows');
  return items.map((item, index) => ({
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1,
    place: String(item.place || item.facility || '').slice(0, 160),
    time: String(item.time || '').slice(0, 80),
    person: String(item.person || item.customer || '').slice(0, 160),
    name: String(item.name || item.product || item.product_name || item.raw_text || '').slice(0, 300),
    quantity: Math.max(0, Number(item.quantity ?? item.qty ?? 1) || 0),
    confidence: item.confidence == null ? undefined : Math.max(0, Math.min(1, Number(item.confidence) || 0)),
    cancelled: Boolean(item.cancelled),
    note: String(item.note || '').slice(0, 300)
  })).filter(item => item.name);
}

async function submitScanResult(request, env) {
  if (!env.ACTION_API_KEY || bearerToken(request) !== env.ACTION_API_KEY) {
    return json({ ok: false, error: 'unauthorized' }, 401, allowedOrigin(request, env));
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400, allowedOrigin(request, env));
  }
  const scanId = String(body.scan_id || body.scanId || '').trim();
  if (!validScanId(scanId)) return json({ ok: false, error: 'invalid_scan_id' }, 400, allowedOrigin(request, env));

  let items;
  try {
    items = sanitizeItems(body.items);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400, allowedOrigin(request, env));
  }
  if (!items.length) return json({ ok: false, error: 'no_valid_items' }, 400, allowedOrigin(request, env));

  const now = new Date().toISOString();
  const payload = JSON.stringify({ scan_id: scanId, status: 'completed', items });
  if (payload.length > 900_000) return json({ ok: false, error: 'payload_too_large' }, 413, allowedOrigin(request, env));

  await env.DB.prepare(`
    INSERT INTO scan_results (scan_id, status, payload, created_at, updated_at)
    VALUES (?1, 'completed', ?2, ?3, ?3)
    ON CONFLICT(scan_id) DO UPDATE SET status='completed', payload=excluded.payload, updated_at=excluded.updated_at
  `).bind(scanId, payload, now).run();

  // Opportunistic retention cleanup; keeps transient OCR result data bounded without a cron.
  await env.DB.prepare("DELETE FROM scan_results WHERE updated_at < datetime('now', '-14 day')").run();

  return json({ ok: true, scan_id: scanId, status: 'completed', saved_items: items.length }, 200, allowedOrigin(request, env));
}

async function getScanResult(request, env, scanId) {
  if (!validScanId(scanId)) return json({ status: 'not_found' }, 404, allowedOrigin(request, env));
  const row = await env.DB.prepare('SELECT payload FROM scan_results WHERE scan_id = ?1 LIMIT 1').bind(scanId).first();
  if (!row?.payload) return json({ scan_id: scanId, status: 'pending' }, 404, allowedOrigin(request, env));
  try {
    return json(JSON.parse(row.payload), 200, allowedOrigin(request, env));
  } catch {
    return json({ scan_id: scanId, status: 'error' }, 500, allowedOrigin(request, env));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-max-age': '86400'
    }});

    if (request.method === 'POST' && url.pathname === '/scan-result') return submitScanResult(request, env);
    const match = url.pathname.match(/^\/scan\/([^/]+)$/);
    if (request.method === 'GET' && match) return getScanResult(request, env, decodeURIComponent(match[1]));
    return json({ ok: false, error: 'not_found' }, 404, origin);
  }
};
