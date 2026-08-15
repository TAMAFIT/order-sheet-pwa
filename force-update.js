import { buildFreshUrl, isAppCacheName, isAppServiceWorkerRegistration } from './force-update-core.js';

function ensureButton() {
  let button = document.querySelector('#forceUpdateBtn');
  if (button) return button;
  const topbar = document.querySelector('.topbar');
  if (!topbar) return null;

  let actions = topbar.querySelector('.topbar-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'topbar-actions';
    const install = topbar.querySelector('#installBtn');
    if (install) {
      install.insertAdjacentElement('beforebegin', actions);
      actions.appendChild(install);
    } else {
      topbar.appendChild(actions);
    }
  }

  button = document.createElement('button');
  button.id = 'forceUpdateBtn';
  button.type = 'button';
  button.className = 'force-update-btn';
  button.textContent = '最新版を読み込む';
  button.title = '学習データを消さずに、アプリ本体だけ最新版へ更新します';
  actions.prepend(button);
  return button;
}

const button = ensureButton();

async function clearAppCaches() {
  if (!('caches' in globalThis)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter(isAppCacheName).map(key => caches.delete(key)));
}

async function installFreshServiceWorker(appBaseUrl) {
  if (!('serviceWorker' in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  const appRegistrations = registrations.filter(registration => isAppServiceWorkerRegistration(registration, appBaseUrl));
  await Promise.all(appRegistrations.map(registration => registration.unregister()));

  const stamp = Date.now();
  const registration = await navigator.serviceWorker.register(`./sw.js?refresh=${stamp}`, {
    scope: './',
    updateViaCache: 'none'
  });

  const worker = registration.installing || registration.waiting || registration.active;
  if (!worker || worker.state === 'activated') return;

  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 2500);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

export async function forceRefreshApp() {
  const appBaseUrl = new URL('./', location.href).toString();
  if (button) {
    button.disabled = true;
    button.textContent = '更新中…';
  }

  try {
    await clearAppCaches();
    await installFreshServiceWorker(appBaseUrl);
  } catch (error) {
    console.warn('Force refresh preparation failed; continuing with cache-busting reload.', error);
  }

  location.replace(buildFreshUrl(appBaseUrl));
}

button?.addEventListener('click', forceRefreshApp);
