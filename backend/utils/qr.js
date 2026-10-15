const QRCode = require('qrcode');
const { customAlphabet } = require('nanoid');

// Unambiguous alphabet (no 0/O/1/I/l) since these might occasionally be read
// off a printed label by a human, not just scanned. 22 chars -> effectively
// unguessable (22^22 possibilities) so a code can't be brute-forced by
// incrementing/guessing a neighbouring value.
const generateCode = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 22);

/**
 * Builds a printable label as a self-contained SVG string: QR code + the
 * naira value + MelloW branding. SVG is used (rather than a rasterized
 * canvas) so no native image dependencies are needed to generate it, and it
 * still prints cleanly at any size.
 */
async function generateLabelSVG(code, value) {
  const qrSvg = await QRCode.toString(code, {
    type: 'svg',
    margin: 0,
    color: { dark: '#1a0a0a', light: '#ffffff' },
  });

  // Strip the outer <svg> wrapper from the QR so we can re-embed it inside our label
  const innerQr = qrSvg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const qrViewBoxMatch = qrSvg.match(/viewBox="([\d.\s]+)"/);
  const qrViewBox = qrViewBoxMatch ? qrViewBoxMatch[1] : '0 0 100 100';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="520" viewBox="0 0 400 520">
  <rect width="400" height="520" rx="20" fill="#ffffff" stroke="#7a1620" stroke-width="3"/>
  <text x="200" y="46" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="#3d0f10">Mello<tspan fill="#b3202f" font-style="italic">ll</tspan>W</text>
  <text x="200" y="70" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" fill="#7a1620" letter-spacing="1">bare essentials, elevated</text>
  <g transform="translate(60, 95)">
    <svg width="280" height="280" viewBox="${qrViewBox}">${innerQr}</svg>
  </g>
  <text x="200" y="420" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="42" fill="#3d0f10">&#8358;${value}</text>
  <text x="200" y="450" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#8a8a8a">Scan in the MelloW app to redeem</text>
  <text x="200" y="490" text-anchor="middle" font-family="Courier New, monospace" font-size="11" fill="#b0b0b0">${code}</text>
</svg>`;
}

/**
 * Plain QR code image as a PNG buffer - just the scannable code, no MelloW
 * branding, no denomination text, no label. Used for the admin XLSX export,
 * where the code and its value live in separate spreadsheet columns instead.
 */
async function generateQrPngBuffer(code) {
  return QRCode.toBuffer(code, {
    type: 'png',
    margin: 1,
    width: 300,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

module.exports = { generateCode, generateLabelSVG, generateQrPngBuffer };
