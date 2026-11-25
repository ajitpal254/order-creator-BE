/**
 * escapeRegExp.js
 * Helpers for safely compiling user-supplied search strings into RegExps.
 *
 * User input must never be compiled into a RegExp verbatim: metacharacters
 * such as ".*" would match everything and "(" would throw a SyntaxError
 * (SEC-06). Always escape first, and truncate over-long input.
 */

export const MAX_SEARCH_LENGTH = 64;

/**
 * Escapes every regex metacharacter in a string so it is matched literally.
 * @param {string} str
 * @returns {string}
 */
export const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds a case-insensitive RegExp that matches the user's search string
 * literally. The input is trimmed and truncated to MAX_SEARCH_LENGTH
 * characters before escaping.
 * @param {string} search - raw user-supplied search string
 * @returns {RegExp}
 */
export const createSearchRegex = (search) => {
  const truncated = String(search).trim().slice(0, MAX_SEARCH_LENGTH);
  return new RegExp(escapeRegExp(truncated), 'i');
};
