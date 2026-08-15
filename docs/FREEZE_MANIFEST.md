# Freeze Manifest

Project: `TAMAFIT/order-sheet-pwa`

Freeze date: `2026-08-15`

## Canonical snapshots

- Final experimental app version: `0.1.19`
- Final experimental main commit before archive documentation: `1e885884187bfee4a0dfb8dd45b23c1381729840`
- Immutable-reference branch created from that state: `archive/final-v0.1.19-2026-08-15`
- Previous review-first UI branch: `backup/v0.1.18-review-first`

## Public references

- PWA: `https://tamafit.github.io/order-sheet-pwa/`
- Repository: `https://github.com/TAMAFIT/order-sheet-pwa`
- VoiceDev work log: `TAMAFIT/TAMAFIT-voicedev-master#196`
- Action API used by the experiment: `https://order-sheet-action-api.tamafit-takamatsu.workers.dev`

## Freeze policy

- `archive/final-v0.1.19-2026-08-15` is the reference for the exact final experimental application before archive notices were added.
- `main` contains the archived/public reference version and closeout documentation.
- Do not add new product features to this project unless active development is intentionally resumed.
- New document-processing products should preferably start in a new repository and copy reusable modules from this project.
- Do not commit secrets.

## Reason for freeze

Handwritten Japanese Vision/OCR accuracy was not sufficiently stable for practical order-sheet automation under the tested conditions. The surrounding document-ingestion architecture remains a reusable asset.

## Reuse target noted at freeze time

Potential future system: batch ingestion and aggregation of printed tax/accounting documents such as Amazon receipts, invoices, PDFs, JPEG/PNG receipts and screenshots, with automatic extraction, duplicate detection, exception-only review, correction and export.
