export function renumberRecognitions(items = []) {
  items.forEach((item, index) => {
    item.order = index + 1;
  });
  return items;
}

export function insertRecognitionAfter(items = [], afterId, newItem) {
  const index = items.findIndex(item => item.id === afterId);
  const insertAt = index >= 0 ? index + 1 : items.length;
  items.splice(insertAt, 0, newItem);
  renumberRecognitions(items);
  return insertAt;
}

export function removeRecognition(items = [], id) {
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return null;
  const [item] = items.splice(index, 1);
  renumberRecognitions(items);
  return { item, index };
}

export function restoreRecognition(items = [], snapshot) {
  if (!snapshot?.item) return null;
  const index = Math.max(0, Math.min(Number(snapshot.index) || 0, items.length));
  items.splice(index, 0, snapshot.item);
  renumberRecognitions(items);
  return snapshot.item;
}

export function moveRecognition(items = [], movingId, targetId, position = 'before', { adoptTargetGroup = true } = {}) {
  const fromIndex = items.findIndex(item => item.id === movingId);
  const targetIndex = items.findIndex(item => item.id === targetId);
  if (fromIndex < 0 || targetIndex < 0 || movingId === targetId) return null;

  const moving = items[fromIndex];
  const target = items[targetIndex];
  const previousGroup = {
    place: moving.place || '',
    time: moving.time || '',
    person: moving.person || ''
  };

  items.splice(fromIndex, 1);
  const targetAfterRemoval = items.findIndex(item => item.id === targetId);
  const insertAt = Math.max(0, Math.min(
    position === 'after' ? targetAfterRemoval + 1 : targetAfterRemoval,
    items.length
  ));

  if (adoptTargetGroup) {
    moving.place = target.place || '';
    moving.time = target.time || '';
    moving.person = target.person || '';
  }

  items.splice(insertAt, 0, moving);
  renumberRecognitions(items);
  return {
    item: moving,
    fromIndex,
    toIndex: insertAt,
    targetId,
    position: position === 'after' ? 'after' : 'before',
    previousGroup
  };
}
