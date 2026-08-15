import { OrderDb } from './db.js';
import { moveRecognition } from './review-edit-core.js';

const HOLD_MS = 340;
const CANCEL_DISTANCE = 11;
const INTERACTIVE = 'button,input,textarea,select,a,label,.review-editor,[contenteditable="true"]';
let setupDone = false;

export function nativeSelectionAllowed(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = String(target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  if (target.isContentEditable === true) return true;
  return Boolean(target.closest?.('[contenteditable="true"]'));
}

export function clampHorizontalDrag(deltaX, limit = 18) {
  const safeLimit = Math.max(0, Number(limit) || 0);
  return Math.max(-safeLimit, Math.min(safeLimit, Number(deltaX) || 0));
}

function installStyles() {
  if (document.querySelector('#reviewReorderV18Styles')) return;
  const style = document.createElement('style');
  style.id = 'reviewReorderV18Styles';
  style.textContent = `
    .review-line{position:relative;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
    .review-line.is-reorder-origin{opacity:.2;filter:saturate(.55);transition:opacity .12s ease}
    .review-drag-ghost{position:fixed!important;z-index:10001!important;margin:0!important;pointer-events:none!important;opacity:.98!important;box-shadow:0 18px 44px rgba(20,50,30,.28)!important;border-color:#2e6b45!important;background:#fff!important;transform-origin:center center;will-change:transform;transition:box-shadow .12s ease,border-color .12s ease}
    .review-drag-ghost .review-editor{display:none!important}
    .review-line.reorder-target-before::before,.review-line.reorder-target-after::after{content:'';position:absolute;left:5px;right:5px;height:5px;border-radius:999px;background:#2e6b45;box-shadow:0 0 0 3px rgba(46,107,69,.13);z-index:8}
    .review-line.reorder-target-before::before{top:-6px}.review-line.reorder-target-after::after{bottom:-6px}
    body.review-reorder-active{overscroll-behavior:contain;cursor:grabbing}
    body.review-reorder-active *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}
  `;
  document.head.append(style);
}

function clone(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.classList.remove('has-action');
  toast.replaceChildren(document.createTextNode(message));
  toast.dataset.type = 'info';
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2300);
}

function persistReorderedSession(items, movedId) {
  try {
    const db = new OrderDb();
    const session = db.data.sessions.find(entry =>
      Array.isArray(entry?.recognitions) && entry.recognitions.some(item => item.id === movedId)
    );
    if (!session) return;
    session.recognitions = clone(items);
    session.recognitionCount = items.length;
    session.confirmedCount = items.filter(item => item.status === 'confirmed').length;
    session.resolvedCount = items.filter(item => item.status === 'confirmed' && !item.cancelled).length;
    db.saveSession(session);
  } catch (error) {
    console.warn('Review reorder session save failed', error);
  }
}

function clearTargets(list) {
  list.querySelectorAll('.reorder-target-before,.reorder-target-after').forEach(element => {
    element.classList.remove('reorder-target-before', 'reorder-target-after');
  });
}

function updateGroupAddButtons(list) {
  list.querySelectorAll('.review-person-group').forEach(group => {
    const cards = [...group.querySelectorAll(':scope > .review-line')];
    const addButton = group.querySelector(':scope > .group-add-item');
    if (!cards.length) {
      group.remove();
      return;
    }
    if (addButton) addButton.dataset.id = cards.at(-1).dataset.id || '';
  });
}

function applyDomMove(list, movingId, targetId, position, items) {
  const moving = list.querySelector(`.review-line[data-id="${CSS.escape(movingId)}"]`);
  const target = list.querySelector(`.review-line[data-id="${CSS.escape(targetId)}"]`);
  if (!moving || !target || moving === target) return;

  const sourceGroup = moving.closest('.review-person-group');
  const targetGroup = target.closest('.review-person-group');
  if (!targetGroup) return;

  if (position === 'after') targetGroup.insertBefore(moving, target.nextSibling);
  else targetGroup.insertBefore(moving, target);

  if (sourceGroup && sourceGroup !== targetGroup && !sourceGroup.querySelector(':scope > .review-line')) sourceGroup.remove();

  for (const item of items) {
    const orderBadge = list.querySelector(`.review-line[data-id="${CSS.escape(item.id)}"] .paper-order`);
    if (orderBadge) orderBadge.textContent = String(item.order || '');
  }
  updateGroupAddButtons(list);
}

function nearestDropTarget(list, movingId, y) {
  const cards = [...list.querySelectorAll('.review-line[data-id]')]
    .filter(card => card.dataset.id !== movingId && !card.classList.contains('review-drag-ghost'));
  if (!cards.length) return null;

  let best = null;
  let bestDistance = Infinity;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { card, position: y >= center ? 'after' : 'before' };
    }
  }
  return bestDistance <= Math.max(90, window.innerHeight * .16) ? best : null;
}

export function setupReviewReorder(getItems) {
  if (setupDone || typeof document === 'undefined') return;
  setupDone = true;
  installStyles();

  const list = document.querySelector('#reviewList');
  if (!list) return;
  const guide = document.querySelector('.review-guide');
  if (guide && !guide.dataset.reorderHint) {
    guide.dataset.reorderHint = '1';
    guide.append(document.createTextNode(' 順番が違う時はカードの空いている所を長押しして、そのまま移動できます。'));
  }

  let drag = null;
  let suppressClickUntil = 0;

  const stopAnimation = snapshot => {
    if (snapshot?.paintFrame) cancelAnimationFrame(snapshot.paintFrame);
    if (snapshot?.scrollFrame) cancelAnimationFrame(snapshot.scrollFrame);
  };

  const removeGhost = snapshot => {
    snapshot?.ghost?.remove();
    snapshot?.card?.classList.remove('is-reorder-origin');
  };

  function resetDrag() {
    if (!drag) return;
    const snapshot = drag;
    clearTimeout(snapshot.timer);
    stopAnimation(snapshot);
    removeGhost(snapshot);
    clearTargets(list);
    document.body.classList.remove('review-reorder-active');
    drag = null;
  }

  function paintGhost() {
    if (!drag?.active || !drag.ghost) return;
    drag.paintFrame = 0;
    const dx = clampHorizontalDrag(drag.currentX - drag.startX);
    const dy = drag.currentY - drag.startY;
    drag.ghost.style.transform = `translate3d(${dx}px,${dy}px,0) scale(1.018)`;
  }

  function updateTarget() {
    if (!drag?.active) return;
    clearTargets(list);
    drag.targetId = '';
    drag.position = 'before';
    const target = nearestDropTarget(list, drag.movingId, drag.currentY);
    if (!target) return;
    drag.targetId = target.card.dataset.id || '';
    drag.position = target.position;
    target.card.classList.add(target.position === 'after' ? 'reorder-target-after' : 'reorder-target-before');
  }

  function autoScrollLoop() {
    if (!drag?.active) return;
    const edge = Math.min(110, window.innerHeight * .18);
    let speed = 0;
    if (drag.currentY < edge) speed = -Math.ceil((edge - drag.currentY) / edge * 13);
    else if (drag.currentY > window.innerHeight - edge) speed = Math.ceil((drag.currentY - (window.innerHeight - edge)) / edge * 13);
    if (speed) {
      window.scrollBy(0, speed);
      updateTarget();
    }
    drag.scrollFrame = requestAnimationFrame(autoScrollLoop);
  }

  function moveActiveDrag(x, y) {
    if (!drag?.active) return;
    drag.currentX = x;
    drag.currentY = y;
    if (!drag.paintFrame) drag.paintFrame = requestAnimationFrame(paintGhost);
    updateTarget();
  }

  function beginDrag() {
    if (!drag || drag.active) return;
    const rect = drag.card.getBoundingClientRect();
    const ghost = drag.card.cloneNode(true);
    ghost.classList.remove('is-confirmed', 'is-cancelled');
    ghost.classList.add('review-drag-ghost');
    ghost.removeAttribute('data-id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.append(ghost);

    drag.active = true;
    drag.ghost = ghost;
    drag.currentX = drag.currentX ?? drag.startX;
    drag.currentY = drag.currentY ?? drag.startY;
    drag.card.classList.add('is-reorder-origin');
    document.body.classList.add('review-reorder-active');
    try { window.getSelection?.()?.removeAllRanges?.(); } catch {}
    try { navigator.vibrate?.(16); } catch {}
    paintGhost();
    updateTarget();
    drag.scrollFrame = requestAnimationFrame(autoScrollLoop);
    showToast('そのまま指で動かして、入れたい位置で離してください');
  }

  function finishDrag() {
    if (!drag) return;
    const snapshot = drag;
    clearTimeout(snapshot.timer);
    stopAnimation(snapshot);
    removeGhost(snapshot);
    clearTargets(list);
    document.body.classList.remove('review-reorder-active');
    drag = null;

    if (!snapshot.active || !snapshot.targetId) return;
    const items = getItems?.();
    if (!Array.isArray(items) || !items.length) return;
    const result = moveRecognition(items, snapshot.movingId, snapshot.targetId, snapshot.position, { adoptTargetGroup: true });
    if (!result) return;
    applyDomMove(list, snapshot.movingId, snapshot.targetId, snapshot.position, items);
    persistReorderedSession(items, snapshot.movingId);
    suppressClickUntil = Date.now() + 550;
    showToast('順番を変更しました');
  }

  function startHold(card, x, y, inputType, pointerId = null) {
    resetDrag();
    drag = {
      inputType,
      pointerId,
      movingId: card.dataset.id || '',
      card,
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      active: false,
      targetId: '',
      position: 'before',
      ghost: null,
      paintFrame: 0,
      scrollFrame: 0,
      timer: setTimeout(beginDrag, HOLD_MS)
    };
  }

  document.addEventListener('selectstart', event => {
    if (!nativeSelectionAllowed(event.target)) event.preventDefault();
  }, true);

  document.addEventListener('contextmenu', event => {
    if (!nativeSelectionAllowed(event.target)) event.preventDefault();
  }, true);

  list.addEventListener('touchstart', event => {
    if (event.touches?.length !== 1 || event.target.closest(INTERACTIVE)) return;
    const card = event.target.closest('.review-line[data-id]');
    if (!card || !list.contains(card)) return;
    const touch = event.touches[0];
    startHold(card, touch.clientX, touch.clientY, 'touch');
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', event => {
    if (!drag || drag.inputType !== 'touch') return;
    const touch = event.touches?.[0];
    if (!touch) return;
    if (!drag.active) {
      const distance = Math.hypot(touch.clientX - drag.startX, touch.clientY - drag.startY);
      if (distance > CANCEL_DISTANCE) resetDrag();
      return;
    }
    event.preventDefault();
    moveActiveDrag(touch.clientX, touch.clientY);
  }, { capture: true, passive: false });

  document.addEventListener('touchend', () => {
    if (drag?.inputType === 'touch') finishDrag();
  }, { capture: true, passive: false });

  document.addEventListener('touchcancel', () => {
    if (drag?.inputType === 'touch') resetDrag();
  }, true);

  list.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0 || event.target.closest(INTERACTIVE)) return;
    const card = event.target.closest('.review-line[data-id]');
    if (!card || !list.contains(card)) return;
    startHold(card, event.clientX, event.clientY, 'pointer', event.pointerId);
  }, true);

  document.addEventListener('pointermove', event => {
    if (!drag || drag.inputType !== 'pointer' || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance > CANCEL_DISTANCE) resetDrag();
      return;
    }
    event.preventDefault();
    moveActiveDrag(event.clientX, event.clientY);
  }, { capture: true, passive: false });

  document.addEventListener('pointerup', event => {
    if (drag?.inputType === 'pointer' && event.pointerId === drag.pointerId) finishDrag();
  }, { capture: true, passive: false });

  document.addEventListener('pointercancel', event => {
    if (drag?.inputType === 'pointer' && event.pointerId === drag.pointerId) resetDrag();
  }, true);

  list.addEventListener('click', event => {
    if (Date.now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
