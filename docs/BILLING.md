# Quotations and invoices

Bharath Interior Decor's quotation and invoice module: drafting, revisions, conversion, issuing, payments, receipts, PDFs and the business settings that feed them. It is part of the existing Next.js application (same login, same database, same tenant isolation) and works inside the Android app because it is just more pages and API routes on the hosted server.

Nothing else (CRM, inventory, purchasing, customer portal) was added.

## Who can do what

| Action | Administrator | Manager | Salesperson |
|---|---|---|---|
| View, draft, edit drafts, send, accept/reject, revise, duplicate, convert quotations; view and draft invoices | yes | needs **canViewPayments** | no |
| Issue, cancel, correct invoices; record and void payments | yes | needs **canVerifyPayments** | no |
| Business details and numbering | yes | read business details only | no |

Managers see all documents of their company, not only their team's, because documents are not tied to a salesperson. A document linked to a client record can only use clients the manager may see. Every route re-checks authentication, role, permission and company on the server; company isolation is the same tenant-scoped database client the rest of the app uses (`QuotationItem` and `InvoiceItem` are classified as child tables in `src/lib/db/tenancy.ts`).

## Data model (migration `4_quotations_and_invoices`)

Additive only: seven new tables and their enums, no existing table or row is touched. Rollback notes are at the top of the migration file.

`business_profiles` (one row per company), `document_sequences`, `quotations` + `quotation_items`, `invoices` + `invoice_items`, `invoice_payments`.

Each document stores its customer details as typed (a snapshot, optionally linked to a client), every calculated figure, and — once sent or issued — a frozen copy of the business details (`businessSnapshot`), so later settings changes never rewrite a document that has left the building.

## Calculation rules

Implemented once in `src/lib/domain/documentCalc.ts` and used by the server, the editor preview and (through the saved values) the PDF. All money is integer paise with half-up rounding.

1. Line gross = quantity × rate (quantity up to 3 decimals).
2. Line discount: percentage of gross, or a fixed amount capped at the gross.
3. The overall discount (percentage or amount) is spread over the lines in proportion to their value (largest-remainder, so the parts add up exactly). Shipping and other charges are separate taxable lines at the "charges GST rate".
4. Tax per line = taxable × rate, rounded to the paisa. CGST and SGST are each half the rate (rounded separately, so always equal); IGST is the whole rate.
5. Grand total = taxable value + tax, rounded to the nearest rupee when the setting is on; the round-off is stored and shown separately.

Tax mode: **no GST** unless the business has switched GST on in settings. With GST on, CGST+SGST applies when the customer's state equals the business state (or is unknown), otherwise IGST; a document can still be made non-GST. A GST invoice cannot be issued while the business GSTIN is empty. Nothing (GSTIN, bank, address, phone) is ever pre-filled.

Amount in words uses Indian numbering (thousand, lakh, crore).

## Numbering

Configurable per kind (quotation, invoice, receipt): prefix, digit count, optional calendar (`2026`) or financial-year (`2026-27`, April–March) token, next number. The counter resets when the year token changes.

- Taken inside the same transaction as the document, under a per-company advisory lock, with unique constraints as a backstop. A number already in use is skipped, so moving the counter by hand never creates a duplicate.
- Quotation numbers are given at creation. **Invoice numbers are given when the invoice is issued**, so issued numbers have no gaps from abandoned drafts. A cancelled or corrected invoice keeps its number.

## Workflows

**Quotation:** `DRAFT` → `SENT` → `ACCEPTED` / `REJECTED` (reason required); `SENT` past its valid-until date becomes `EXPIRED` (applied when documents are read). Only drafts are editable or deletable (revision-1 drafts only). **Revise** (from sent, accepted, rejected or expired) creates revision N+1 as a new draft with the same number, and marks the previous revision `REVISED` without changing it; all revisions stay listed and viewable. An accepted quotation that already has a live invoice cannot be revised. **Convert** (accepted only) copies customer, lines, prices, discounts and tax figures exactly into a draft invoice; converting again returns the same invoice.

**Invoice:** `DRAFT` (fully editable, deletable) → `ISSUED` → `PARTIALLY_PAID` → `PAID`, or `CANCELLED`. `OVERDUE` is shown for open invoices past their due date; it is derived, not stored. Issuing recomputes the totals from the saved lines one last time, assigns the number and freezes the business details. **An issued invoice is never edited**; the API refuses. To change one:

- **Cancel** (reason required): only when it has no recorded payments. The invoice keeps its number and figures.
- **Correct**: cancels the original (with the reason) and opens a linked editable copy; repeating the call returns the copy already open.
- Payments are **voided** (reason required, kept in the record), which restores the balance.

**Payments:** against issued/partly paid invoices, amount ≤ outstanding (checked under a row lock, so parallel payments can never overpay), date not in the future, method, reference, notes. Each payment form carries an idempotency key: the same key records one payment. Each payment gets a receipt number and a receipt PDF.

Every change writes an audit-log entry (module `QUOTATION`, `INVOICE`, `INVOICE_PAYMENT`, `BILLING_SETTINGS`) with old and new key figures; the document pages show it as History.

## PDFs

`GET /api/quotations/:id/pdf`, `/api/invoices/:id/pdf`, `/api/invoices/:id/payments/:paymentId/receipt` (add `?download=1` to force a download). They are rendered from the saved record only (`src/features/billing/pdf.ts`, `pdfData.ts`): black/gold header with the logo, business and customer details, itemised table (header repeated on every page), totals, tax summary by rate, amount in words, payment terms, bank/payment details when configured, notes, terms, signature block, "Page x of y", and a watermark for drafts, cancelled, superseded, expired, rejected and voided documents.

- Amounts are printed as "Rs." — the built-in PDF fonts have no ₹ glyph.
- Text must be Latin script; names or addresses in other scripts need an embedded font (not included).
- In the browser: Preview/Download/Print. In the Android app the PDF is fetched with the session and handed to the system share sheet (open, save, print, WhatsApp, email) through the existing `openDocument` helper.
- **WhatsApp and email are manual sharing**, not automated sending: in a browser they open a prefilled message (attach the downloaded PDF); in the app the share sheet sends the PDF file itself. No message is sent by the server.

## Settings

Settings → **Business details** (administrators): business name, legal name, address, contact, GSTIN/PAN, GST on/off and default rate, rounding, default validity and due days, default payment terms, notes and terms for quotations and invoices, bank and UPI details, signatory label, and numbering. The logo is the fixed official artwork (`public/brand/logo-512.png`); a per-company logo upload is not implemented.

## Files

- Schema and migration: `prisma/schema.prisma`, `prisma/migrations/4_quotations_and_invoices/`
- Domain: `src/lib/domain/documentCalc.ts`, `amountInWords.ts`
- Server: `src/features/billing/` (schemas, business, sequences, documents, quotations, invoices, pdf, pdfData, http, lock)
- API: `src/app/api/billing/*`, `src/app/api/quotations/*`, `src/app/api/invoices/*`
- UI: `src/components/billing/*`, pages under `src/app/(admin)/quotations`, `invoices`, `settings/business`
- Tests: `tests/unit/documentCalc.test.ts`, `tests/unit/billingPdf.test.ts`, `tests/integration/billing.test.ts`

## Known limits

- Invoices are not tied to the client ledger/outstanding balance used by the existing order and collection flow; invoice balances are tracked on the invoice itself.
- No credit notes, no recurring invoices, no automated reminders or messaging.
- Quotation expiry is applied when documents are read or listed (no scheduled job), so a quotation may show as sent until someone opens the list.
- A draft revision (revision ≥ 2) cannot be deleted, only edited, to keep the revision history intact.
