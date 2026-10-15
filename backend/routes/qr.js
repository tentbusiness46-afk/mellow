const express = require('express');
const ExcelJS = require('exceljs');
const { nanoid } = require('nanoid');
const db = require('../db/client');
const { requireUser, requireAdmin } = require('../middleware/auth');
const { generateCode, generateQrPngBuffer } = require('../utils/qr');

const router = express.Router();

// ---------- Customer: scan a code ----------
router.post('/scan', requireUser, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || !code.trim()) {
      return res.status(400).json({ error: 'No code detected. Please try scanning again.' });
    }
    const cleanCode = code.trim().toUpperCase();

    const lookup = await db.execute({ sql: 'SELECT * FROM qr_codes WHERE code = ?', args: [cleanCode] });
    const qr = lookup.rows[0];

    if (!qr) {
      return res.status(404).json({ error: 'This code is not recognized.' });
    }
    if (qr.is_used) {
      return res.status(409).json({ error: 'This code has already been redeemed.' });
    }

    // Guard the update with is_used = 0 so a simultaneous scan of the same
    // code from two devices can't both succeed.
    const update = await db.execute({
      sql: `UPDATE qr_codes SET is_used = 1, used_by = ?, used_at = datetime('now') WHERE code = ? AND is_used = 0`,
      args: [req.userId, cleanCode],
    });

    if (update.rowsAffected !== 1) {
      return res.status(409).json({ error: 'This code has already been redeemed.' });
    }

    await db.execute({
      sql: 'UPDATE users SET balance = balance + ? WHERE id = ?',
      args: [qr.value, req.userId],
    });

    const balanceResult = await db.execute({ sql: 'SELECT balance FROM users WHERE id = ?', args: [req.userId] });

    res.json({
      message: `\u20a6${qr.value} added to your balance!`,
      value: qr.value,
      balance: balanceResult.rows[0].balance,
    });
  } catch (err) {
    console.error('[qr/scan]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- Admin: list batches grouped by value ----------
router.get('/admin/batches', requireAdmin, async (req, res) => {
  const result = await db.execute(`
    SELECT b.id, b.batch_number, b.value, b.quantity, b.created_at,
           SUM(CASE WHEN c.is_used = 1 THEN 1 ELSE 0 END) as used_count
    FROM qr_batches b
    LEFT JOIN qr_codes c ON c.batch_id = b.id
    GROUP BY b.id
    ORDER BY b.created_at DESC
  `);
  res.json({ batches: result.rows });
});

// ---------- Admin: generate a new batch ----------
router.post('/admin/generate', requireAdmin, async (req, res) => {
  try {
    const batchNumber = (req.body.batch_number || '').trim();
    const value = parseInt(req.body.value, 10);
    const quantity = parseInt(req.body.quantity, 10);

    if (!batchNumber) return res.status(400).json({ error: 'Please enter a batch number.', field: 'batchNumber' });
    if (!value || value <= 0) return res.status(400).json({ error: 'Please enter a valid denomination.', field: 'value' });
    if (!quantity || quantity <= 0 || quantity > 5000) {
      return res.status(400).json({ error: 'Please enter a quantity between 1 and 5000.', field: 'quantity' });
    }

    const batchId = nanoid();
    await db.execute({
      sql: 'INSERT INTO qr_batches (id, batch_number, value, quantity) VALUES (?, ?, ?, ?)',
      args: [batchId, batchNumber, value, quantity],
    });

    for (let i = 0; i < quantity; i++) {
      await db.execute({
        sql: 'INSERT INTO qr_codes (id, code, value, batch_id) VALUES (?, ?, ?, ?)',
        args: [nanoid(), generateCode(), value, batchId],
      });
    }

    res.json({ message: `Generated ${quantity} codes worth \u20a6${value} each.`, batch_id: batchId });
  } catch (err) {
    console.error('[qr/admin/generate]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- Admin: export a batch as an XLSX file ----------
// Three columns: Batch Number, Code, and the plain QR image itself (no
// branding/label baked into the image - just the scannable code).
router.get('/admin/batches/:id/export', requireAdmin, async (req, res) => {
  try {
    const batchResult = await db.execute({ sql: 'SELECT * FROM qr_batches WHERE id = ?', args: [req.params.id] });
    const batch = batchResult.rows[0];
    if (!batch) return res.status(404).json({ error: 'Batch not found.' });

    const codesResult = await db.execute({
      sql: 'SELECT code FROM qr_codes WHERE batch_id = ? ORDER BY created_at ASC',
      args: [req.params.id],
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('QR Codes');
    sheet.columns = [
      { header: 'Batch Number', key: 'batch_number', width: 22 },
      { header: 'Code', key: 'code', width: 28 },
      { header: 'QR Code', key: 'qr_image', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };

    let rowIndex = 2;
    for (const row of codesResult.rows) {
      sheet.getRow(rowIndex).height = 55;
      sheet.getCell('A' + rowIndex).value = batch.batch_number;
      sheet.getCell('B' + rowIndex).value = row.code;

      const pngBuffer = await generateQrPngBuffer(row.code);
      const imageId = workbook.addImage({ buffer: pngBuffer, extension: 'png' });
      sheet.addImage(imageId, {
        tl: { col: 2, row: rowIndex - 1 },
        ext: { width: 55, height: 55 },
      });

      rowIndex++;
    }

    const safeName = (batch.batch_number || 'batch').replace(/[^a-zA-Z0-9-_]+/g, '-');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="mellow-qr-${safeName}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[qr/admin/export]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong generating the export.' });
  }
});

module.exports = router;
