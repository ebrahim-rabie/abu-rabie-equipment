/**
 * Egyptian mobile number helpers.
 *
 * Customers type their number in whatever form is convenient (+20, 0020, 010…,
 * 1xxxxxxxxx). Everything is normalised to the local 11-digit form before it
 * reaches the database, so one person cannot register two accounts.
 */

const VALID_EGYPT_MOBILE = /^(01[0125])\d{8}$/;

const normalizeEgyptPhone = (raw) => {
  let digits = String(raw || '')
    .trim()
    .replace(/[^\d+]/g, '')
    .replace(/^\+/, '');

  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('20')) digits = digits.slice(2);

  // 01012345678 -> 10012345678 in international form
  if (digits.startsWith('2') && digits.length === 11) digits = digits.slice(1);

  // 1xxxxxxxxx (9 digits) -> 01xxxxxxxx
  if (/^1[0125]\d{8}$/.test(digits)) digits = `0${digits}`;

  return digits;
};

const isValidEgyptPhone = (raw) => VALID_EGYPT_MOBILE.test(normalizeEgyptPhone(raw));

/** Renders a normalized local number in international form for wa.me links. */
const toInternational = (raw) => `20${normalizeEgyptPhone(raw).replace(/^0/, '')}`;

module.exports = {
  normalizeEgyptPhone,
  isValidEgyptPhone,
  toInternational,
  VALID_EGYPT_MOBILE,
};