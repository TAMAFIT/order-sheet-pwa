export function normalizeQuarterTurns(value = 0) {
  const turns = Number(value) || 0;
  return ((Math.round(turns) % 4) + 4) % 4;
}

export function portraitRotationFor(width, height, manualQuarterTurns = 0) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  const autoTurns = w > h ? 1 : 0;
  return normalizeQuarterTurns(autoTurns + manualQuarterTurns);
}

export function rotatedSize(width, height, quarterTurns = 0) {
  const turns = normalizeQuarterTurns(quarterTurns);
  return turns % 2
    ? { width: Number(height) || 0, height: Number(width) || 0 }
    : { width: Number(width) || 0, height: Number(height) || 0 };
}
