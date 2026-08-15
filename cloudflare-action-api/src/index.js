const DEFAULT_ORIGIN = 'https://tamafit.github.io';
const RESULT_TTL_SECONDS = 60 * 60 * 24;

function corsOrigin(request, env) {
  const configured = String(env.ALLOWED_ORIGIN || DEFAULT_ORIGIN).trim();
  const origin = request.headers.get('origin') || '';
  if (!origin) return configured;
  return origin === configured ? configured : configured;
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': corsOrigin(request, env),
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization'
    }
  });
}

function bearer(request) {
  const value = request.headers.get('authorization') || '';
  return /^Bearer\s+/i.test(value) ? value.replace(/^Bearer\s+/i, '').trim() : '';
}

function validScanId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function sanitizeItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 500) {
    throw new Error('items must contain 1-500 rows');
  }
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

function openApiDocument(origin) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Order Sheet Scan Result API',
      version: '1.0.0',
      description: 'Receives one completed handwritten-order scan from the Custom GPT.'
    },
    servers: [{ url: origin }],
    paths: {
      '/scan-result': {
        post: {
          operationId: 'submitScanResult',
          summary: 'Save the completed scan result',
          description: 'Call exactly once after reading the whole order sheet. Preserve paper order and do not aggregate products.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['scan_id', 'status', 'items'],
                  properties: {
                    scan_id: { type: 'string', format: 'uuid' },
                    status: { type: 'string', enum: ['completed'] },
                    items: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 500,
                      items: {
                        type: 'object',
                        required: ['order', 'name', 'quantity'],
                        properties: {
                          order: { type: 'integer' },
                          place: { type: 'string' },
                          time: { type: 'string' },
                          person: { type: 'string' },
                          name: { type: 'string' },
                          quantity: { type: 'number', minimum: 0 },
                          confidence: { type: 'number', minimum: 0, maximum: 1 },
                          cancelled: { type: 'boolean' },
                          note: { type: 'string' }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Saved' },
            '400': { description: 'Invalid payload' },
            '401': { description: 'Unauthorized' }
          }
        }
      }
    }
  };
}

async function submit(request, env) {
  if (!env.ACTION_API_KEY || bearer(request) !== env.ACTION_API_KEY) {
    return json(request, env, { ok: false, error: 'unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(request, env, { ok: false, error: 'invalid_json' }, 400);
  }

  const scanId = String(body.scan_id || body.scanId || '').trim();
  if (!validScanId(scanId)) return json(request, env, { ok: false, error: 'invalid_scan_id' }, 400);

  let items;
  try {
    items = sanitizeItems(body.items);
  } catch (error) {
    return json(request, env, { ok: false, error: error.message }, 400);
  }
  if (!items.length) return json(request, env, { ok: false, error: 'no_valid_items' }, 400);

  const payload = JSON.stringify({
    scan_id: scanId,
    status: 'completed',
    items,
    completed_at: new Date().toISOString()
  });
  if (payload.length > 900_000) return json(request, env, { ok: false, error: 'payload_too_large' }, 413);

  await env.RESULTS.put(`scan:${scanId}`, payload, { expirationTtl: RESULT_TTL_SECONDS });
  return json(request, env, { ok: true, scan_id: scanId, status: 'completed', saved_items: items.length });
}

async function getResult(request, env, scanId) {
  if (!validScanId(scanId)) return json(request, env, { status: 'not_found' }, 404);
  const payload = await env.RESULTS.get(`scan:${scanId}`);
  if (!payload) return json(request, env, { scan_id: scanId, status: 'pending' }, 404);
  try {
    return json(request, env, JSON.parse(payload));
  } catch {
    return json(request, env, { scan_id: scanId, status: 'error' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': corsOrigin(request, env),
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type,authorization',
          'access-control-max-age': '86400'
        }
      });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(request, env, { ok: true, service: 'order-sheet-action-api' });
    }

    if (request.method === 'GET' && url.pathname === '/openapi.json') {
      return json(request, env, openApiDocument(url.origin));
    }

    if (request.method === 'POST' && url.pathname === '/scan-result') return submit(request, env);

    const match = url.pathname.match(/^\/scan\/([^/]+)$/);
    if (request.method === 'GET' && match) return getResult(request, env, decodeURIComponent(match[1]));

    return json(request, env, { ok: false, error: 'not_found' }, 404);
  }
};
