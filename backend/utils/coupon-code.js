const { customAlphabet } = require('nanoid');
const { CODE_PREFIX } = require('../config/coupons');

// Uppercase letters and digits, leaving out 0, 1, O, I and L so a code read
// off a printed coupon and typed by hand can't be mistaken. 31 characters ^ 6
// is ~887 million combinations per prefix.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const randomSuffix = customAlphabet(ALPHABET, 6);

function generateCouponCode() {
  return CODE_PREFIX + randomSuffix();
}

module.exports = { generateCouponCode };
