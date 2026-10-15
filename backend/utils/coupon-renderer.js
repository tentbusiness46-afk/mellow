const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const opentype = require('opentype.js');
const QRCode = require('qrcode');
const {
  ASSETS_DIR, FONT_FILE, FONT_SIZE, DIGIT_VARIANT, BATCH_MAX_WIDTH, BATCH_LABEL_PREFIX,
  COUPON_IMAGE_FORMAT, JPEG_QUALITY, COUPON_TEMPLATES,
} = require('../config/coupons');

// This renders thousands of images in a row, so don't let sharp hold on to
// them in its own cache.
sharp.cache(false);

// ---------- Text ----------
// Text is converted to vector outlines with opentype.js and drawn as SVG
// paths, rather than asking the image library to draw text with a font. That
// way the coupon looks the same on any machine - Windows, Mac or Render -
// because nothing depends on which fonts happen to be installed there.
let font;
function getFont() {
  if (!font) {
    // opentype.parse works in every version (loadSync was removed in newer ones).
    const file = fs.readFileSync(FONT_FILE);
    font = opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  }
  return font;
}

const DIGIT_NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

// Lays the text out glyph by glyph, swapping every digit for its full-height
// "lining" version, and returns the outline at the given size.
function textPath(text, fontSize) {
  const f = getFont();
  const scale = fontSize / f.unitsPerEm;
  const glyphs = Array.from(text).map((ch) => {
    if (DIGIT_VARIANT && ch >= '0' && ch <= '9') {
      const i = f.nameToGlyphIndex(`${DIGIT_NAMES[ch]}.${DIGIT_VARIANT}`);
      if (i) return f.glyphs.get(i);
    }
    return f.charToGlyph(ch);
  });

  const outline = new opentype.Path();
  let x = 0;
  glyphs.forEach((glyph, i) => {
    outline.extend(glyph.getPath(x, 0, fontSize));
    x += glyph.advanceWidth * scale;
    if (i < glyphs.length - 1) x += f.getKerningValue(glyph, glyphs[i + 1]) * scale;
  });
  return outline;
}

// Returns a small transparent SVG containing `text`, plus where it goes on
// the coupon. `x` is where the left edge of the ink should land and
// `baseline` is the line the letters sit on, both in coupon pixels.
function textOverlay(text, { x, baseline, size = FONT_SIZE, maxWidth }) {
  let fontSize = size;
  let bb = textPath(text, fontSize).getBoundingBox();
  if (maxWidth && bb.x2 - bb.x1 > maxWidth) {
    fontSize = (fontSize * maxWidth) / (bb.x2 - bb.x1);
    bb = textPath(text, fontSize).getBoundingBox();
  }

  const PAD = 3;
  const left = Math.max(0, Math.floor(x) - PAD);
  const top = Math.max(0, Math.floor(baseline + bb.y1) - PAD);
  const width = Math.ceil(x - left + (bb.x2 - bb.x1)) + PAD + 1;
  const height = Math.ceil(baseline + bb.y2) - top + PAD + 1;

  // Move the outline so its left edge lands on x and its baseline on `baseline`.
  const shifted = textPath(text, fontSize);
  shifted.commands.forEach((c) => {
    ['x', 'x1', 'x2'].forEach((k) => { if (k in c) c[k] += x - bb.x1 - left; });
    ['y', 'y1', 'y2'].forEach((k) => { if (k in c) c[k] += baseline - top; });
  });
  const d = shifted.toPathData(2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${d}" fill="#000000"/></svg>`;
  return { input: Buffer.from(svg), left, top };
}

// Characters in `text` the coupon font has no glyph for. They would print as
// empty boxes, so the admin is told before the batch is created instead.
function unsupportedCharacters(text) {
  const f = getFont();
  return [...new Set(Array.from(text).filter((ch) => f.charToGlyphIndex(ch) === 0))];
}

function batchLabel(batchNumber) {
  const text = String(batchNumber).trim();
  if (!BATCH_LABEL_PREFIX || text.startsWith(BATCH_LABEL_PREFIX)) return text;
  return BATCH_LABEL_PREFIX + text;
}

// ---------- QR ----------
// Built pixel by pixel at a whole-number scale so every module is perfectly
// sharp (no blurry edges from resizing), with a transparent background so
// the white "SCAN HERE" box shows through untouched.
function qrOverlay(code, template) {
  // Level Q survives a scuffed or creased print better than the default, and
  // a 13-character code still fits the smallest (21x21) QR size at this level.
  const qr = QRCode.create(code, { errorCorrectionLevel: 'Q' });
  const n = qr.modules.size;
  // 4 modules of clear space on each side is what scanners expect.
  const scale = Math.max(1, Math.floor(template.qrBoxSize / (n + 8)));
  const px = n * scale;

  const buf = Buffer.alloc(px * px * 4); // starts fully transparent
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue;
      for (let dy = 0; dy < scale; dy++) {
        let o = ((r * scale + dy) * px + c * scale) * 4;
        for (let dx = 0; dx < scale; dx++) {
          buf[o + 3] = 255; // black, opaque (RGB already 0)
          o += 4;
        }
      }
    }
  }

  return {
    input: buf,
    raw: { width: px, height: px, channels: 4 },
    left: Math.round(template.qrCenter.x - px / 2),
    top: Math.round(template.qrCenter.y - px / 2),
  };
}

// ---------- Output ----------
// Compositing adds an alpha channel the coupon doesn't need, so drop it
// before encoding (smaller files, faster).
const ENCODERS = {
  png: { ext: 'png', apply: (img) => img.removeAlpha().png({ compressionLevel: 6 }) },
  // 4:4:4 keeps colour edges (the QR, the text) as sharp as the brightness ones.
  jpg: {
    ext: 'jpg',
    apply: (img) => img.removeAlpha().jpeg({ quality: JPEG_QUALITY, chromaSubsampling: '4:4:4' }),
  },
};

/**
 * Prepares everything that is the same for every coupon in a batch (the
 * template pixels and the printed batch number), so each coupon afterwards
 * only has to draw its own QR and code.
 *
 *   const renderer = await createCouponRenderer({ value: 100, batchNumber: '61SBT16A' });
 *   const pngBuffer = await renderer.render('MLW-61-AB12CD');
 */
async function createCouponRenderer({ value, batchNumber, format = COUPON_IMAGE_FORMAT }) {
  const template = COUPON_TEMPLATES[value];
  if (!template) throw new Error(`No coupon template for ₦${value}.`);
  const encoder = ENCODERS[format];
  if (!encoder) throw new Error(`Unknown format "${format}".`);

  const { data, info } = await sharp(path.join(ASSETS_DIR, 'coupons', template.file))
    .flatten({ background: '#ffffff' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const base = { width: info.width, height: info.height, channels: info.channels };

  // Same on every coupon in the batch, so draw it once.
  const batch = textOverlay(batchLabel(batchNumber), { ...template.batch, maxWidth: BATCH_MAX_WIDTH });
  const batchPng = await sharp(batch.input).png().toBuffer();

  return {
    extension: encoder.ext,
    async render(code) {
      const codeText = textOverlay(code, template.code);
      const image = sharp(data, { raw: base }).composite([
        qrOverlay(code, template),
        codeText,
        { input: batchPng, left: batch.left, top: batch.top },
      ]);
      return encoder.apply(image).toBuffer();
    },
  };
}

module.exports = { createCouponRenderer, batchLabel, unsupportedCharacters };
