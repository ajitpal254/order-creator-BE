/**
 * stateMachine.test.js
 * Tests for the Order state transition validator.
 */
import { describe, it, expect } from 'vitest';
import {
  validateStateTransition,
  getAvailableTransitions,
  ORDER_STATES,
  ALL_ORDER_STATUSES,
} from '../src/utils/stateMachine.js';

describe('validateStateTransition — happy paths', () => {
  it('allows user to submit a draft', () => {
    const r = validateStateTransition(ORDER_STATES.DRAFT, ORDER_STATES.SUBMITTED, 'user');
    expect(r.valid).toBe(true);
  });

  it('allows admin to confirm a submitted order', () => {
    const r = validateStateTransition(ORDER_STATES.SUBMITTED, ORDER_STATES.CONFIRMED, 'admin');
    expect(r.valid).toBe(true);
  });

  it('allows super_admin to do anything admin can', () => {
    const r = validateStateTransition(ORDER_STATES.SUBMITTED, ORDER_STATES.CONFIRMED, 'super_admin');
    expect(r.valid).toBe(true);
  });

  it('allows shipping_officer to ship a QC-passed order', () => {
    const r = validateStateTransition(ORDER_STATES.QUALITY_CHECK, ORDER_STATES.SHIPPED, 'shipping_officer');
    expect(r.valid).toBe(true);
  });

  it('allows cancellation with a reason', () => {
    const r = validateStateTransition(ORDER_STATES.SUBMITTED, ORDER_STATES.CANCELLED, 'admin', 'Customer requested');
    expect(r.valid).toBe(true);
  });
});

describe('validateStateTransition — rejection paths', () => {
  it('rejects user trying to confirm an order', () => {
    const r = validateStateTransition(ORDER_STATES.SUBMITTED, ORDER_STATES.CONFIRMED, 'user');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/not authorized/i);
  });

  it('rejects skipping states (Draft → Shipped)', () => {
    const r = validateStateTransition(ORDER_STATES.DRAFT, ORDER_STATES.SHIPPED, 'admin');
    expect(r.valid).toBe(false);
  });

  it('rejects transition from terminal state Closed', () => {
    const r = validateStateTransition(ORDER_STATES.CLOSED, ORDER_STATES.SUBMITTED, 'admin');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/terminal/i);
  });

  it('rejects transition from terminal state Cancelled', () => {
    const r = validateStateTransition(ORDER_STATES.CANCELLED, ORDER_STATES.DRAFT, 'admin');
    expect(r.valid).toBe(false);
  });

  it('rejects cancellation without a reason', () => {
    const r = validateStateTransition(ORDER_STATES.SUBMITTED, ORDER_STATES.CANCELLED, 'admin', '');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/cancellationReason/i);
  });

  it('rejects cancellation with whitespace-only reason', () => {
    const r = validateStateTransition(ORDER_STATES.SUBMITTED, ORDER_STATES.CANCELLED, 'admin', '   ');
    expect(r.valid).toBe(false);
  });

  it('rejects an entirely invalid target status', () => {
    const r = validateStateTransition(ORDER_STATES.DRAFT, 'FLYING', 'admin');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Invalid status/i);
  });

  it('rejects same-state transition', () => {
    const r = validateStateTransition(ORDER_STATES.SUBMITTED, ORDER_STATES.SUBMITTED, 'admin');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/already in state/i);
  });
});

describe('getAvailableTransitions', () => {
  it('returns next states for a user from Draft', () => {
    const transitions = getAvailableTransitions(ORDER_STATES.DRAFT, 'user');
    expect(transitions).toContain(ORDER_STATES.SUBMITTED);
    expect(transitions).toContain(ORDER_STATES.CANCELLED);
  });

  it('returns empty array from terminal states', () => {
    expect(getAvailableTransitions(ORDER_STATES.CLOSED, 'admin')).toHaveLength(0);
    expect(getAvailableTransitions(ORDER_STATES.CANCELLED, 'admin')).toHaveLength(0);
  });

  it('returns fewer transitions for user than for admin from Submitted', () => {
    const userT = getAvailableTransitions(ORDER_STATES.SUBMITTED, 'user');
    const adminT = getAvailableTransitions(ORDER_STATES.SUBMITTED, 'admin');
    expect(adminT.length).toBeGreaterThan(userT.length);
  });
});

describe('ALL_ORDER_STATUSES', () => {
  it('contains all 9 expected statuses', () => {
    expect(ALL_ORDER_STATUSES).toHaveLength(9);
    expect(ALL_ORDER_STATUSES).toContain('Draft');
    expect(ALL_ORDER_STATUSES).toContain('Cancelled');
    expect(ALL_ORDER_STATUSES).toContain('Delivered');
  });
});
