const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// Coupons are always printed as "MLW-61-" + 6 characters. The prefix is part
// of what gets encoded in the QR and typed in manually, so changing it here
// changes it everywhere.
const CODE_PREFIX = 'MLW-61-';

// The most codes one batch can hold. Raised from 5000 because a printed run
// is 10,000 coupons.
const MAX_QUANTITY = 20000;

// The longest batch number the admin can type. It is printed on the coupon
// exactly as entered, so this keeps it inside the "BATCH NO." area.
const MAX_BATCH_NUMBER_LENGTH = 30;

// Shown in front of the batch number on the coupon (the client's sample reads
// "#61SBT16A"). Not added if the admin already typed it. Set to '' to print
// the batch number with nothing in front of it.
const BATCH_LABEL_PREFIX = '#';

const FONT_FILE = path.join(ASSETS_DIR, 'fonts', 'Gelasio-Bold.ttf');
// Size (px on the 2000px-wide template) and digit style that reproduce the
// client's sample: the same text measures within 1px of it at this size.
// Gelasio's default digits are old-style (short, uneven, like lowercase), so
// the full-height "tabular lining" set is used instead.
const FONT_SIZE = 31.8;
const DIGIT_VARIANT = 'tf';
const BATCH_MAX_WIDTH = 300; // px; longer batch numbers are scaled down to fit

// Image format inside the ZIP: 'jpg' or 'png'.
// The client's green and red templates carry faint background noise, which
// PNG (lossless) has to store faithfully: ~1.1 MB per coupon, ~11 GB for
// 10,000, and 4-5x slower to produce. High-quality JPEG (4:4:4, no colour
// smoothing) is visually identical for print at ~0.25 MB each.
const COUPON_IMAGE_FORMAT = 'jpg';
const JPEG_QUALITY = 92;

// Only these denominations can be generated. To add one: drop a blank
// template (2000x940 PNG, code and batch text removed) into assets/coupons/
// and add an entry here.
//   qrCenter / qrBoxSize : centre and size of the white "SCAN HERE" box
//   code / batch         : where the left edge of the text and its baseline sit
// Positions were measured from the client's blank templates. The blue one is
// laid out 2px lower than the other two, hence its own numbers.
const COUPON_TEMPLATES = {
  100: {
    file: 'coupon-100.png',
    qrCenter: { x: 1656, y: 309 },
    qrBoxSize: 447,
    code: { x: 129, baseline: 674 },
    batch: { x: 1012, baseline: 674 },
  },
  150: {
    file: 'coupon-150.png',
    qrCenter: { x: 1661.5, y: 308.5 },
    qrBoxSize: 450,
    code: { x: 130, baseline: 676 },
    batch: { x: 1015, baseline: 676 },
  },
  200: {
    file: 'coupon-200.png',
    qrCenter: { x: 1656, y: 309 },
    qrBoxSize: 447,
    code: { x: 129, baseline: 674 },
    batch: { x: 1012, baseline: 674 },
  },
};

const ALLOWED_VALUES = Object.keys(COUPON_TEMPLATES).map(Number);

module.exports = {
  ASSETS_DIR,
  CODE_PREFIX,
  MAX_QUANTITY,
  MAX_BATCH_NUMBER_LENGTH,
  BATCH_LABEL_PREFIX,
  FONT_FILE,
  FONT_SIZE,
  DIGIT_VARIANT,
  BATCH_MAX_WIDTH,
  COUPON_IMAGE_FORMAT,
  JPEG_QUALITY,
  COUPON_TEMPLATES,
  ALLOWED_VALUES,
};
