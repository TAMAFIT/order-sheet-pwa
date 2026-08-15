# v0.1.12 update reliability

This release adds an in-app 「最新版を読み込む」 control for installed-PWA mixed-cache cases.

The control only clears Cache Storage entries whose names start with `order-sheet-pwa-` and replaces this app's service-worker registration. It does not clear `localStorage`, so learned products, aliases, review history, and settings are preserved.

The service worker now uses `cache: no-store` for same-origin network requests before refreshing its offline cache, reducing mixed-version JS/CSS/module loads after deployments.
