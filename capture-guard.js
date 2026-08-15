const ACTIVE_SCAN_KEY = 'order-sheet-active-scan-v1';
const ACTION_AWAITING_KEY = 'order-sheet-action-awaiting-v1';
const LEGACY_AWAITING_KEY = 'order-sheet-awaiting-chatgpt';

export function shouldSuppressReturnHandling({ pickerOpen = false, activeStatus = '', actionAwaiting = false } = {}) {
  return Boolean(pickerOpen || (!actionAwaiting && activeStatus === 'captured'));
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function activeStatus() {
  return String(readJson(ACTIVE_SCAN_KEY)?.status || '');
}

function hasActionAwaiting() {
  return Boolean(readJson(ACTION_AWAITING_KEY)?.scanId);
}

function clearOldReturnState() {
  localStorage.removeItem(ACTION_AWAITING_KEY);
  localStorage.removeItem(LEGACY_AWAITING_KEY);
}

function clearOldAnalysisUi() {
  const review = document.querySelector('#reviewArea');
  const result = document.querySelector('#resultArea');
  const textarea = document.querySelector('#analysisJson');
  if (review) review.hidden = true;
  if (result) result.hidden = true;
  if (textarea) textarea.value = '';
}

function setup() {
  const input = document.querySelector('#imageInput');
  if (!input) return;

  let pickerOpen = false;
  let releaseTimer = null;

  input.addEventListener('click', () => {
    pickerOpen = true;
    clearTimeout(releaseTimer);
    clearOldReturnState();
  }, true);

  input.addEventListener('change', event => {
    pickerOpen = false;
    clearTimeout(releaseTimer);
    if (event.target.files?.length) clearOldAnalysisUi();
  }, true);

  const suppressIfCaptureReturn = event => {
    const suppress = shouldSuppressReturnHandling({
      pickerOpen,
      activeStatus: activeStatus(),
      actionAwaiting: hasActionAwaiting()
    });
    if (!suppress) return;
    event.stopImmediatePropagation();
    if (pickerOpen) {
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => { pickerOpen = false; }, 900);
    }
  };

  window.addEventListener('focus', suppressIfCaptureReturn, true);
  document.addEventListener('visibilitychange', event => {
    if (document.visibilityState === 'visible') suppressIfCaptureReturn(event);
  }, true);
}

if (typeof document !== 'undefined') setup();
