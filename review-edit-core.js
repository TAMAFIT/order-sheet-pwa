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
