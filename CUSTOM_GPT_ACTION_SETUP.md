# Custom GPT Action return path

This project keeps the existing ChatGPT clipboard flow as a fallback and adds an optional result-return path:

`PWA -> ChatGPT/Custom GPT -> submitScanResult Action -> Result API/DB -> PWA`

## What is already implemented in the PWA

- A new UUID `scan_id` is issued when a new image selection/capture is made.
- The `scan_id` and Action instructions are rendered into the top of the bundled share image.
- The PWA stores the active scan locally and, when it returns to the foreground, polls `GET /scan/{scan_id}` for a short period.
- A completed payload is written into the existing JSON import path, so the current paper-order review, product candidate, correction learning and final product-ID aggregation code is reused unchanged.
- If the Action/API path is unavailable, the existing ChatGPT JSON-copy/clipboard import remains usable.

## Important mobile limitation

ChatGPT mobile supports using Custom GPTs, but the PWA/Android share intent does not have a documented way to target a specific Custom GPT directly. The web-only `@` mention flow is not available in iOS/Android ChatGPT.

Therefore the Action return path only runs when the shared image actually reaches the Custom GPT that has `submitScanResult` configured. Do not remove the clipboard fallback until this is proven on the target Android device.

## Custom GPT setup

1. Deploy a result API. `server/cloudflare-worker.js` + D1 is the reference implementation.
2. Create a strong random Action API key and store it only as a server secret and in the Custom GPT Action authentication settings. Do not put it in this repo or PWA.
3. Replace `https://YOUR-WORKER.workers.dev` in `server/gpt-action-openapi.yaml` with the deployed API origin.
4. In the GPT editor, add an Action using that OpenAPI schema and configure Bearer API-key authentication.
5. Add instructions equivalent to:

   - Read the `SCAN_ID` printed in the instruction header of the image.
   - Extract every line item in paper order; do not aggregate yet.
   - After analysis, call `submitScanResult` exactly once using that `SCAN_ID` and `status=completed`.
   - If the Action is unavailable, denied or fails, return the JSON payload so the user can use the clipboard fallback.

6. Test in GPT Preview before mobile testing. Action execution can still require user approval in ChatGPT.
7. In the PWA, open `データ・設定 -> Custom GPT Action返却` and enter only the API base URL. No secret is entered in the PWA.

## Result API contract

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

The POST endpoint is authenticated with a server-side Bearer key.

### PWA read

`GET /scan/{scan_id}`

- `200`: completed payload
- `404`, `202` or `204`: result not ready yet

The reference implementation treats the UUID as a read capability and does not expose an API key to the browser. Keep results transient and rate-limit the deployed endpoint as appropriate.

## Why Cloudflare Worker + D1 is the first recommendation

For this workload the backend only stores small JSON results and serves short polling reads. It does not perform AI inference. This keeps the AI image analysis inside ChatGPT and makes the return channel provider-agnostic. A later `PWA -> OpenAI/Gemini API` ingress can post the same result schema without changing the review/aggregation UI.

## Future Actions

Do not add these until the product/alias data is moved or synchronized from device-local storage to the server:

- `lookupProducts`: server-side product master + alias lookup
- `saveCorrection`: persist human corrections to a shared learning DB

The current product master and correction history remain device-local, so implementing those Actions now would create two inconsistent sources of truth.
