const GALLERY_INPUT_SELECTOR = '#captureGalleryInput';
const SINGLE_BUTTON_SELECTOR = '#singleGalleryBtn';
const SPLIT_BUTTON_SELECTOR = '#splitGalleryBtn';

function configureGalleryInput(input, multiple) {
  input.value = '';
  input.accept = 'image/*';
  input.multiple = Boolean(multiple);
  input.removeAttribute('capture');
}

function openImageOnlyPicker(multiple) {
  const input = document.querySelector(GALLERY_INPUT_SELECTOR);
  if (!input) return false;
  configureGalleryInput(input, multiple);
  globalThis.dispatchEvent(new CustomEvent('order-sheet-picker-open'));
  input.click();
  return true;
}

function syncGalleryLabels() {
  const single = document.querySelector(SINGLE_BUTTON_SELECTOR);
  if (single && single.textContent !== '端末の写真から選ぶ') {
    single.textContent = '端末の写真から選ぶ';
  }

  const split = document.querySelector(SPLIT_BUTTON_SELECTOR);
  if (split) {
    const selected = Boolean(document.querySelector('#splitPartPreviews figure'));
    const complete = document.querySelectorAll('#splitPartPreviews figure').length >= 2;
    const label = complete ? '端末の写真2枚を選び直す' : selected ? '端末の写真から追加' : '端末の写真から2枚選ぶ';
    if (split.textContent !== label) split.textContent = label;
  }

  const input = document.querySelector(GALLERY_INPUT_SELECTOR);
  if (input) {
    input.accept = 'image/*';
    input.removeAttribute('capture');
  }
}

function setup() {
  document.addEventListener('click', event => {
    const button = event.target?.closest?.(`${SINGLE_BUTTON_SELECTOR}, ${SPLIT_BUTTON_SELECTOR}`);
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const multiple = button.matches(SPLIT_BUTTON_SELECTOR);
    openImageOnlyPicker(multiple);
  }, true);

  const startLabelSync = () => {
    syncGalleryLabels();
    const observer = new MutationObserver(syncGalleryLabels);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startLabelSync, { once: true });
  else startLabelSync();
}

if (typeof document !== 'undefined') setup();

export { configureGalleryInput, openImageOnlyPicker };
