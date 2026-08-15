import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionSnapshot, findResumeSession, groupRecognitions, recentRestorableSessions } from '../session-history-core.js';

test('buildSessionSnapshot stores complete review state without sharing references', () => {
  const recognitions = [
    { id: 'a', status: 'confirmed', cancelled: false, quantity: 2 },
    { id: 'b', status: 'pending', cancelled: false, quantity: 1 }
  ];
  const snapshot = buildSessionSnapshot({ id: 's1', scanId: 'scan', recognitions });
  assert.equal(snapshot.recognitionCount, 2);
  assert.equal(snapshot.confirmedCount, 1);
  assert.equal(snapshot.resolvedCount, 1);
  assert.equal(snapshot.workflowStatus, 'review');
  recognitions[0].quantity = 9;
  assert.equal(snapshot.recognitions[0].quantity, 2);
});

test('findResumeSession skips completed and legacy sessions without item state', () => {
  const sessions = [
    { id: 'complete', workflowStatus: 'complete', recognitions: [{ id: 'x' }] },
    { id: 'legacy' },
    { id: 'pending', workflowStatus: 'review', recognitions: [{ id: 'y' }] }
  ];
  assert.equal(findResumeSession(sessions)?.id, 'pending');
  assert.deepEqual(recentRestorableSessions(sessions, 10).map(session => session.id), ['complete', 'pending']);
});

test('groupRecognitions creates one add point per contiguous customer group', () => {
  const groups = groupRecognitions([
    { id: 'a', place: 'A', time: '10', person: '泉近さん' },
    { id: 'b', place: 'A', time: '10', person: '泉近さん' },
    { id: 'c', place: 'A', time: '10', person: '木田さん' }
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].items.map(item => item.id), ['a', 'b']);
  assert.deepEqual(groups[1].items.map(item => item.id), ['c']);
});
