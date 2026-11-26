/**
 * Response envelopes used across the H.A. Overseas API.
 *
 * Shapes verified against the backend source:
 * - Single-resource responses: `{ success: true, data }` (sometimes with
 *   an additional `message`), e.g. src/controllers/addressController.js.
 * - Paginated lists: the standardised envelope emitted by
 *   `paginatedResponse` in src/utils/paginate.js (QOL-12) and mirrored in
 *   src/utils/openapi.js (`paginatedEnvelope`).
 * - Errors: `{ success: false, message }` (validation failures add an
 *   `errors` array — see src/middleware/validate.js).
 */
/** Successful single-resource (or action) response. */
export interface ApiSuccess<T> {
    success: true;
    data: T;
    message?: string;
}
/** Standardised paginated list envelope: { success, count, total, page, limit, data }. */
export interface ApiPaginated<T> {
    success: true;
    /** Number of items on this page (data.length). */
    count: number;
    /** Total number of matching items across all pages. */
    total: number;
    page: number;
    limit: number;
    data: T[];
}
/** One field-level validation error (src/middleware/validate.js). */
export interface ApiValidationError {
    field: string;
    message: string;
}
/** Error response. */
export interface ApiError {
    success: false;
    message: string;
    errors?: ApiValidationError[];
    error?: string;
}
/** Discriminated union of every API response shape. */
export type ApiResponse<T> = ApiSuccess<T> | ApiPaginated<T> | ApiError;
/** Mongo ObjectId as it appears in JSON responses. */
export type ObjectIdString = string;
/** ISO 8601 timestamp as serialized in JSON responses (Mongoose Date). */
export type IsoDateString = string;
/** Fields every timestamped Mongoose document carries in JSON form. */
export interface Timestamps {
    createdAt: IsoDateString;
    updatedAt: IsoDateString;
}
