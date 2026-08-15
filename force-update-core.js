export const APP_CACHE_PREFIX = 'order-sheet-pwa-';

export function isAppCacheName(name = '') {
  return String(name).startsWith(APP_CACHE_PREFIX);
}

export function buildFreshUrl(href, stamp = Date.now()) {
  const url = new URL(href);
  url.searchParams.set('__app_refresh', String(stamp));
  return url.toString();
}

export function isAppServiceWorkerRegistration(registration, appBaseUrl) {
  try {
    const appBase = new URL(appBaseUrl);
    const scope = new URL(registration?.scope || '');
    if (scope.origin !== appBase.origin) return false;
    return scope.pathname === appBase.pathname || scope.pathname.startsWith(appBase.pathname);
  } catch {
    return false;
  }
}
