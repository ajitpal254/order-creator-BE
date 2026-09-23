/**
 * Order State Machine definitions and transition rules
 * Based on H.A. Overseas Order Creator Lifecycle Specification
 */

export const ORDER_STATES = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  CONFIRMED: 'Confirmed',
  IN_PRODUCTION: 'In Production',
  QUALITY_CHECK: 'Quality Check',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export const ALL_ORDER_STATUSES = Object.values(ORDER_STATES);

/**
 * Valid transitions lookup table
 * [CurrentState]: { [NextState]: [AllowedRoles] }
 */
export const ALLOWED_TRANSITIONS = {
  [ORDER_STATES.DRAFT]: {
    [ORDER_STATES.SUBMITTED]: ['user', 'buyer', 'admin'],
    [ORDER_STATES.CANCELLED]: ['user', 'buyer', 'admin'],
  },
  [ORDER_STATES.SUBMITTED]: {
    [ORDER_STATES.CONFIRMED]: ['admin', 'sales_manager', 'super_admin'],
    [ORDER_STATES.CANCELLED]: ['admin', 'super_admin'],
  },
  [ORDER_STATES.CONFIRMED]: {
    [ORDER_STATES.IN_PRODUCTION]: ['admin', 'production_supervisor', 'super_admin'],
    [ORDER_STATES.CANCELLED]: ['admin', 'super_admin'],
  },
  [ORDER_STATES.IN_PRODUCTION]: {
    [ORDER_STATES.QUALITY_CHECK]: ['admin', 'production_supervisor', 'qc_inspector', 'super_admin'],
    [ORDER_STATES.CANCELLED]: ['admin', 'super_admin'],
  },
  [ORDER_STATES.QUALITY_CHECK]: {
    [ORDER_STATES.SHIPPED]: ['admin', 'shipping_officer', 'super_admin'],
    [ORDER_STATES.CANCELLED]: ['admin', 'super_admin'],
  },
  [ORDER_STATES.SHIPPED]: {
    [ORDER_STATES.DELIVERED]: ['admin', 'shipping_officer', 'user', 'buyer', 'super_admin'],
  },
  [ORDER_STATES.DELIVERED]: {
    [ORDER_STATES.CLOSED]: ['admin', 'super_admin', 'system'],
  },
  [ORDER_STATES.CLOSED]: {}, // Terminal state
  [ORDER_STATES.CANCELLED]: {}, // Terminal state
};

/**
 * Validates whether a state transition is legal for a given role
 * @param {string} currentStatus - Current status of the order
 * @param {string} targetStatus - Target status to transition to
 * @param {string} userRole - Role of the requesting user ('admin', 'user', etc.)
 * @param {string} [cancellationReason] - Reason required if transitioning to Cancelled
 * @returns {{ valid: boolean, error?: string }}
 */
export const validateStateTransition = (currentStatus, targetStatus, userRole, cancellationReason) => {
  if (!ALL_ORDER_STATUSES.includes(targetStatus)) {
    return {
      valid: false,
      error: `Invalid status "${targetStatus}". Must be one of: ${ALL_ORDER_STATUSES.join(', ')}`,
    };
  }

  if (currentStatus === targetStatus) {
    return {
      valid: false,
      error: `Order is already in state "${currentStatus}".`,
    };
  }

  // Check if terminal
  if ([ORDER_STATES.CLOSED, ORDER_STATES.CANCELLED].includes(currentStatus)) {
    return {
      valid: false,
      error: `Cannot transition from terminal state "${currentStatus}".`,
    };
  }

  const validNextStates = ALLOWED_TRANSITIONS[currentStatus] || {};
  const allowedRoles = validNextStates[targetStatus];

  if (!allowedRoles) {
    const legalNext = Object.keys(validNextStates);
    const optionsText = legalNext.length > 0 ? legalNext.join(', ') : 'none (terminal)';
    return {
      valid: false,
      error: `Illegal state transition from "${currentStatus}" to "${targetStatus}". Allowed next states: [${optionsText}].`,
    };
  }

  const role = userRole || 'user';
  if (!allowedRoles.includes(role)) {
    return {
      valid: false,
      error: `Role "${role}" is not authorized to transition order from "${currentStatus}" to "${targetStatus}". Required roles: [${allowedRoles.join(', ')}].`,
    };
  }

  if (targetStatus === ORDER_STATES.CANCELLED && (!cancellationReason || !cancellationReason.trim())) {
    return {
      valid: false,
      error: 'A non-empty cancellationReason is required when cancelling an order.',
    };
  }

  return { valid: true };
};

/**
 * Returns list of allowed next states for a given order and user role
 */
export const getAvailableTransitions = (currentStatus, userRole = 'user') => {
  const transitions = ALLOWED_TRANSITIONS[currentStatus] || {};
  return Object.entries(transitions)
    .filter(([_, roles]) => roles.includes(userRole))
    .map(([status]) => status);
};
