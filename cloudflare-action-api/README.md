# Order Sheet Action API

Small Cloudflare Worker used only to return Custom GPT scan results to the PWA.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/TAMAFIT/order-sheet-pwa/tree/main/cloudflare-action-api)

## What deployment creates

- one Worker
- one KV namespace bound as `RESULTS`
- one secret named `ACTION_API_KEY`
- public HTTPS endpoints for health, Action POST and PWA polling

Cloudflare's deploy flow can provision the KV resource from `wrangler.jsonc` automatically.

## One-time setup

1. Press **Deploy to Cloudflare** above.
2. When asked for `ACTION_API_KEY`, enter a long random secret. Do not commit or paste that secret into ChatGPT conversations.
3. Finish deployment and copy the Worker base URL, for example `https://order-sheet-action-api.<subdomain>.workers.dev`.
4. Open `<WORKER_URL>/health`; it should return `{"ok":true,...}`.
5. In the PWA, open `データ・設定 -> Custom GPT Action返却`, paste only the Worker base URL and run the connection test.
6. Open `<WORKER_URL>/openapi.json` and use that schema for the Custom GPT Action.
7. In the Custom GPT Action authentication settings, choose API key / Bearer and enter the same `ACTION_API_KEY` directly there.

The PWA never receives the Action secret.

## Runtime

`POST /scan-result`
- called by the Custom GPT Action
- requires `Authorization: Bearer <ACTION_API_KEY>`
- stores one normalized JSON result for 24 hours

`GET /scan/{scan_id}`
- called by the PWA when it returns to foreground
- no API key is exposed to the PWA
- the UUID acts as a short-lived lookup capability

`GET /health`
- connection check

`GET /openapi.json`
- dynamic OpenAPI document with the deployed Worker URL already filled in

## Fallback

If the Worker, Action, or ChatGPT Action approval fails, the existing JSON-copy / clipboard import path in the PWA remains available.
