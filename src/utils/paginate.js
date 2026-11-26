/**
 * Shared pagination helpers (QOL-12).
 *
 * The standardised list envelope across the API is:
 *   { success: true, count, total, page, limit, data }
 *
 * Defaults/caps mirror the endpoints standardised in v0.1/v0.2
 * (GET /api/users, GET /api/orders): page defaults to 1 (floored at 1),
 * limit defaults to 100 and is capped at 100 (floored at 1). Callers
 * whose historical default differs (e.g. products also default to 100)
 * can pass { defaultLimit } — the cap stays 100 everywhere.
 */

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 100;

/**
 * Parse page/limit out of a request query.
 * @param {import('express').Request} req
 * @param {{ defaultLimit?: number, maxLimit?: number }} [options]
 * @returns {{ page: number, limit: number, skip: number }}
 */
export const parsePagination = (req, { defaultLimit = DEFAULT_PAGE_LIMIT, maxLimit = MAX_PAGE_LIMIT } = {}) => {
  const query = req?.query ?? {};
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

/**
 * Emit the standard list envelope.
 * @param {import('express').Response} res
 * @param {{ items: unknown[], total: number, page: number, limit: number, status?: number }} payload
 */
export const paginatedResponse = (res, { items, total, page, limit, status = 200 }) => {
  return res.status(status).json({
    success: true,
    count: items.length,
    total,
    page,
    limit,
    data: items,
  });
};
