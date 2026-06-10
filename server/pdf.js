'use strict';
const PDFDocument = require('pdfkit');

// Draws the model into a PDF and resolves with the full Buffer.
function renderPdfBuffer(model) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
    const chunks = [];
    doc.on('data', (d) => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).font('Helvetica-Bold').text(model.header);
    doc.moveDown(0.2);
    doc.fontSize(13).font('Helvetica-Bold')
      .text(`Bandit Wargame — ${model.levelLabel}`);
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica');
    doc.text(`Student: ${model.name}`);
    doc.text(`Email:   ${model.email}`);
    doc.text(`Date:    ${model.date}`);
    doc.text(`Level:   ${model.levelLabel}  ("${model.title}")`);
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').text('Commands used (in order):');
    doc.moveDown(0.2);
    doc.font('Courier').fontSize(10);
    model.commands.forEach((cmd, i) => {
      doc.text(`${String(i + 1).padStart(3, ' ')}  ${cmd}`);
    });
    if (model.commands.length === 0) {
      doc.font('Helvetica-Oblique').text('(no commands captured)');
    }
    doc.moveDown(0.6);

    doc.font('Helvetica-Bold').fontSize(10)
      .text(`Password for ${model.nextUser}: `, { continued: true })
      .font('Courier').text(model.discoveredPassword || '(not captured)');
    doc.font('Helvetica').text(`Commands run: ${model.commandCount}`);

    doc.end();
  });
}

module.exports = { renderPdfBuffer };
