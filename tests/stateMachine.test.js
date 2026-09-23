import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_STATES,
  ALL_ORDER_STATUSES,
  validateStateTransition,
  getAvailableTransitions,
} from '../src/utils/stateMachine.js';

test('State Machine: Initial status definitions', () => {
  assert.equal(ORDER_STATES.DRAFT, 'Draft');
  assert.equal(ORDER_STATES.SUBMITTED, 'Submitted');
  assert.equal(ORDER_STATES.CONFIRMED, 'Confirmed');
  assert.equal(ORDER_STATES.IN_PRODUCTION, 'In Production');
  assert.equal(ORDER_STATES.QUALITY_CHECK, 'Quality Check');
  assert.equal(ORDER_STATES.SHIPPED, 'Shipped');
  assert.equal(ORDER_STATES.DELIVERED, 'Delivered');
  assert.equal(ORDER_STATES.CLOSED, 'Closed');
  assert.equal(ORDER_STATES.CANCELLED, 'Cancelled');
  assert.equal(ALL_ORDER_STATUSES.length, 9);
});

test('State Machine: Legal buyer transitions from Draft', () => {
  const result = validateStateTransition(ORDER_STATES.DRAFT, ORDER_STATES.SUBMITTED, 'buyer');
  assert.equal(result.valid, true);
});

test('State Machine: Sequential Admin progression', () => {
  // Submitted -> Confirmed
  const r1 = validateStateTransition(ORDER_STATES.SUBMITTED, ORDER_STATES.CONFIRMED, 'admin');
  assert.equal(r1.valid, true);

  // Confirmed -> In Production
  const r2 = validateStateTransition(ORDER_STATES.CONFIRMED, ORDER_STATES.IN_PRODUCTION, 'admin');
  assert.equal(r2.valid, true);

  // In Production -> Quality Check
  const r3 = validateStateTransition(ORDER_STATES.IN_PRODUCTION, ORDER_STATES.QUALITY_CHECK, 'admin');
  assert.equal(r3.valid, true);

  // Quality Check -> Shipped
  const r4 = validateStateTransition(ORDER_STATES.QUALITY_CHECK, ORDER_STATES.SHIPPED, 'admin');
  assert.equal(r4.valid, true);

  // Shipped -> Delivered
  const r5 = validateStateTransition(ORDER_STATES.SHIPPED, ORDER_STATES.DELIVERED, 'admin');
  assert.equal(r5.valid, true);

  // Delivered -> Closed
  const r6 = validateStateTransition(ORDER_STATES.DELIVERED, ORDER_STATES.CLOSED, 'admin');
  assert.equal(r6.valid, true);
});

test('State Machine: Illegal stage skip (Submitted -> Shipped) is rejected', () => {
  const result = validateStateTransition(ORDER_STATES.SUBMITTED, ORDER_STATES.SHIPPED, 'admin');
  assert.equal(result.valid, false);
  assert.match(result.error, /Illegal state transition/);
});

test('State Machine: Cancellation requires a valid reason', () => {
  const withoutReason = validateStateTransition(ORDER_STATES.SUBMITTED, ORDER_STATES.CANCELLED, 'admin', '');
  assert.equal(withoutReason.valid, false);
  assert.match(withoutReason.error, /cancellationReason is required/);

  const withReason = validateStateTransition(ORDER_STATES.SUBMITTED, ORDER_STATES.CANCELLED, 'admin', 'Customer requested spec change');
  assert.equal(withReason.valid, true);
});

test('State Machine: Terminal state cannot transition', () => {
  const closedResult = validateStateTransition(ORDER_STATES.CLOSED, ORDER_STATES.IN_PRODUCTION, 'admin');
  assert.equal(closedResult.valid, false);
  assert.match(closedResult.error, /terminal state/);

  const cancelledResult = validateStateTransition(ORDER_STATES.CANCELLED, ORDER_STATES.SUBMITTED, 'admin');
  assert.equal(cancelledResult.valid, false);
  assert.match(cancelledResult.error, /terminal state/);
});

test('State Machine: getAvailableTransitions returns permitted next actions', () => {
  const transitions = getAvailableTransitions(ORDER_STATES.CONFIRMED, 'admin');
  assert.deepEqual(transitions, [ORDER_STATES.IN_PRODUCTION, ORDER_STATES.CANCELLED]);
});
