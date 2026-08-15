# Custom GPT Action return path

The PWA already works with the existing clipboard fallback. This optional setup removes the normal copy/paste return step:

`PWA -> Custom GPT -> submitScanResult -> Cloudflare Worker/KV -> PWA`

## PWA side already implemented

- generates a UUID `scan_id` for each new capture/selection
- renders `scan_id` and Action instructions into the bundled share image
- remembers the active scan locally
- when the PWA returns to foreground, polls `GET /scan/{scan_id}` for a short period
- imports a completed payload into the existing paper-order review / candidate / correction-learning / product-ID aggregation flow
- keeps JSON-copy / clipboard import as a fallback

## Recommended backend: one-click Cloudflare Worker + KV

The isolated deployment template lives in `cloudflare-action-api/`.

[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/TAMAFIT/order-sheet-pwa/tree/main/cloudflare-action-api)

Cloudflare's deploy flow reads `wrangler.jsonc` and can provision the KV namespace automatically.

### One-time setup

1. Open the Deploy to Cloudflare link above.
2. Set `ACTION_API_KEY` to a long random secret. Never put that secret in Git, the PWA, Issue/PR text, logs, or normal ChatGPT conversation text.
3. Finish deployment and copy the Worker base URL, e.g. `https://order-sheet-action-api.xxxxx.workers.dev`.
4. Check `<WORKER_URL>/health` returns `ok: true`.
5. In the PWA open `データ・設定 -> Custom GPT Action返却`, paste only the Worker URL, save, and run `接続テスト`.
6. Open `<WORKER_URL>/openapi.json`. It contains the OpenAPI schema with the deployed Worker URL already filled in.
7. In the Custom GPT editor, add that Action schema and configure Bearer API-key authentication with the same `ACTION_API_KEY` directly in the GPT Action settings.
8. Add GPT instructions: read the `SCAN_ID` from the image header, preserve every row in paper order without aggregation, then call `submitScanResult` exactly once. If the Action fails or is denied, return the JSON so the clipboard fallback remains usable.
9. Test once on the target Android device before relying on the Action path.

## API contract

### Action write

`POST /scan-result`

```json
{
  "scan_id": "7f20e8a1-1234-4abc-8abc-123456789012",
  "status": "completed",
  "items": [
    {
      "order": 1,
      "place": "松ヶ崎",
      "time": "10:40〜11:05",
      "person": "泉近さん",
      "name": "ブルガリアヨーグルト",
      "quantity": 1,
      "confidence": 0.91,
      "cancelled": false,
      "note": ""
    }
  ]
}
```

The POST endpoint requires the server-side Bearer key. The Worker normalizes the payload and stores it in KV for 24 hours.

### PWA read

`GET /scan/{scan_id}`

- `200`: completed payload
- `404`: not ready / expired

The PWA does not receive the Action secret. The random UUID is used only as a short-lived lookup capability.

### Utility endpoints

- `GET /health`: PWA connection test
- `GET /openapi.json`: generated Action schema using the deployed origin

## Mobile limitation

Android/iOS ChatGPT does not provide a documented PWA share-intent route that always targets one specific Custom GPT. The Action route therefore only runs when the image reaches the Custom GPT that owns `submitScanResult`. Keep the clipboard fallback enabled.

## Existing D1 reference

`server/cloudflare-worker.js` + `server/schema.sql` remain as a D1 reference, but the KV template above is the recommended deployment for this one-user / low-volume app because it needs no database migration and scan results are intentionally transient.

## Future Actions

Keep these out until the product/alias database is intentionally moved or synchronized from device-local storage:

- `lookupProducts`
- `saveCorrection`

For the current single-device usage, product master, aliases and human corrections remain local to the PWA and do not depend on the backend.
