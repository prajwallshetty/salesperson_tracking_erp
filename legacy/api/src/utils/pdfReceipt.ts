import PDFDocument from 'pdfkit';
import { Response } from 'express';

export interface PaymentReceiptData {
  receiptNumber: string;
  clientName: string;
  clientAddress?: string;
  amount: number;
  paymentMethod: string;
  transactionReference?: string | null;
  status: string;
  collectedBy: string;
  collectedAt: Date;
  verifiedBy?: string | null;
  notes?: string | null;
}

export function generatePaymentReceiptPDF(data: PaymentReceiptData, res: Response): void {
  const doc = new PDFDocument({ size: 'A5', margin: 40 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="receipt-${data.receiptNumber}.pdf"`);

  doc.pipe(res);

  // Header banner
  doc.rect(0, 0, doc.page.width, 70).fill('#0f766e');
  doc.fontSize(18).fillColor('#ffffff').text('SALES ERP — PAYMENT RECEIPT', 40, 25, { align: 'left' });
  doc.fontSize(10).fillColor('#ccfbf1').text('Official Electronic Collection Voucher', 40, 48);

  doc.moveDown(3);

  // Status Badge
  const badgeColor = data.status === 'VERIFIED' ? '#16a34a' : data.status === 'REJECTED' ? '#dc2626' : '#d97706';
  doc.rect(doc.page.width - 150, 85, 110, 26).fill(badgeColor);
  doc.fontSize(10).fillColor('#ffffff').text(data.status, doc.page.width - 150, 92, { width: 110, align: 'center' });

  // Receipt Number & Date
  doc.fontSize(10).fillColor('#64748b').text('Receipt Number:', 40, 90);
  doc.fontSize(12).fillColor('#0f172a').text(data.receiptNumber, 130, 89);

  doc.fontSize(10).fillColor('#64748b').text('Date & Time:', 40, 110);
  doc.fontSize(10).fillColor('#0f172a').text(new Date(data.collectedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), 130, 110);

  // Divider
  doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(40, 135).lineTo(doc.page.width - 40, 135).stroke();

  // Client Details
  doc.fontSize(10).fillColor('#64748b').text('Received From:', 40, 150);
  doc.fontSize(12).fillColor('#0f172a').text(data.clientName, 130, 149);

  if (data.clientAddress) {
    doc.fontSize(9).fillColor('#64748b').text(data.clientAddress, 130, 168, { width: doc.page.width - 170 });
  }

  // Payment Details Table
  const tableY = 205;
  doc.rect(40, tableY, doc.page.width - 80, 28).fill('#f1f5f9');
  doc.fontSize(10).fillColor('#334155').text('Payment Method', 50, tableY + 8);
  doc.fontSize(10).fillColor('#334155').text('Transaction Reference', 160, tableY + 8);
  doc.fontSize(10).fillColor('#334155').text('Amount Received', doc.page.width - 140, tableY + 8, { align: 'right' });

  doc.fontSize(11).fillColor('#0f172a').text(data.paymentMethod, 50, tableY + 36);
  doc.fontSize(10).fillColor('#475569').text(data.transactionReference || 'N/A (Cash/Direct)', 160, tableY + 36);
  doc.fontSize(14).fillColor('#0f766e').text(`INR ${data.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, doc.page.width - 160, tableY + 34, { align: 'right' });

  doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(40, tableY + 60).lineTo(doc.page.width - 40, tableY + 60).stroke();

  // Footer Audit Trail
  const auditY = 290;
  doc.fontSize(9).fillColor('#64748b').text('Collected By:', 40, auditY);
  doc.fontSize(10).fillColor('#0f172a').text(data.collectedBy, 130, auditY);

  if (data.verifiedBy) {
    doc.fontSize(9).fillColor('#64748b').text('Verified By:', 40, auditY + 18);
    doc.fontSize(10).fillColor('#0f172a').text(data.verifiedBy, 130, auditY + 18);
  }

  if (data.notes) {
    doc.fontSize(9).fillColor('#64748b').text('Notes:', 40, auditY + 36);
    doc.fontSize(9).fillColor('#334155').text(data.notes, 130, auditY + 36, { width: doc.page.width - 170 });
  }

  // Security Notice
  doc.fontSize(8).fillColor('#94a3b8').text(
    'This is a computer-generated voucher issued by Salesperson Tracking & Sales Management ERP. Subject to account clearance.',
    40,
    doc.page.height - 45,
    { align: 'center', width: doc.page.width - 80 }
  );

  doc.end();
}
