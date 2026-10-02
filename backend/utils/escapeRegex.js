/**
 * Escapes regex metacharacters in user-supplied strings before they are passed
 * to `new RegExp()`.
 *
 * Without this, a search term such as `a|b(` produces a broken pattern, and a
 * deliberately crafted term can trigger catastrophic backtracking (ReDoS) that
 * blocks the event loop.
 */
const escapeRegex = (input = '') =>
  String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds a case-insensitive, escaped regex for a search term.
 */
const searchRegex = (input = '') => new RegExp(escapeRegex(String(input).trim()), 'i');

module.exports = { escapeRegex, searchRegex };