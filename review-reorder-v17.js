import { OrderDb } from './db.js';
import { moveRecognition } from './review-edit-core.js';

const HOLD_MS = 480;
const CANCEL_DISTANCE = 10;
const INTERACTIVE = 'button,input,textarea,select,a,label,.review-editor';
let setupDone = false;

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
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
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

function clearTargetClasses(list) {
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

export function setupReviewReorder(getItems) {
  if (setupDone || typeof document === 'undefined') return;
  setupDone = true;

  const list = document.querySelector('#reviewList');
  if (!list) return;
  const guide = document.querySelector('.review-guide');
  if (guide && !guide.dataset.reorderHint) {
    guide.dataset.reorderHint = '1';
    guide.append(document.createTextNode(' 順番や注文者が違う時は、カードを長押しして正しい位置へ移動できます。'));
  }

  let drag = null;
  let suppressClickUntil = 0;

  function cancelHold() {
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.card) drag.card.classList.remove('is-reorder-dragging');
    clearTargetClasses(list);
    document.body.classList.remove('review-reorder-active');
    drag = null;
  }

  function beginDrag() {
    if (!drag) return;
    drag.active = true;
    drag.card.classList.add('is-reorder-dragging');
    document.body.classList.add('review-reorder-active');
    try { navigator.vibrate?.(18); } catch {}
    showToast('そのまま正しい位置まで動かして、指を離してください');
  }

  function updateTarget(x, y) {
    if (!drag?.active) return;
    const element = document.elementFromPoint(x, y);
    const target = element?.closest?.('.review-line[data-id]');
    clearTargetClasses(list);
    drag.targetId = '';
    drag.position = 'before';
    if (!target || target.dataset.id === drag.movingId || !list.contains(target)) return;
    const rect = target.getBoundingClientRect();
    drag.targetId = target.dataset.id || '';
    drag.position = y >= rect.top + rect.height / 2 ? 'after' : 'before';
    target.classList.add(drag.position === 'after' ? 'reorder-target-after' : 'reorder-target-before');
  }

  function finishDrag() {
    if (!drag) return;
    const snapshot = drag;
    clearTimeout(snapshot.timer);
    snapshot.card?.classList.remove('is-reorder-dragging');
    clearTargetClasses(list);
    document.body.classList.remove('review-reorder-active');
    drag = null;

    if (!snapshot.active || !snapshot.targetId) return;
    const items = getItems?.();
    if (!Array.isArray(items) || !items.length) return;
    const result = moveRecognition(items, snapshot.movingId, snapshot.targetId, snapshot.position, { adoptTargetGroup: true });
    if (!result) return;
    applyDomMove(list, snapshot.movingId, snapshot.targetId, snapshot.position, items);
    persistReorderedSession(items, snapshot.movingId);
    suppressClickUntil = Date.now() + 500;
    showToast('順番を変更しました。別の注文者へ移した場合は注文者も変更しています');
  }

  list.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target.closest(INTERACTIVE)) return;
    const card = event.target.closest('.review-line[data-id]');
    if (!card || !list.contains(card)) return;
    cancelHold();
    drag = {
      pointerId: event.pointerId,
      movingId: card.dataset.id || '',
      card,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      targetId: '',
      position: 'before',
      timer: setTimeout(beginDrag, HOLD_MS)
    };
  }, true);

  document.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance > CANCEL_DISTANCE) cancelHold();
      return;
    }
    event.preventDefault();
    updateTarget(event.clientX, event.clientY);
  }, { capture: true, passive: false });

  document.addEventListener('touchmove', event => {
    if (!drag?.active) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    event.preventDefault();
    updateTarget(touch.clientX, touch.clientY);
  }, { capture: true, passive: false });

  document.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.active) event.preventDefault();
    finishDrag();
  }, { capture: true, passive: false });

  document.addEventListener('pointercancel', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    cancelHold();
  }, true);

  list.addEventListener('click', event => {
    if (Date.now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
