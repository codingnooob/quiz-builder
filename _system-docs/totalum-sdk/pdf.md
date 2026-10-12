# PDF — `totalum.pdf` (invoices, reports, tickets)

A real Chrome renders your HTML, so CSS works (flex, grid, fonts, `page-break-after: always`). Server-side only.
Never install `pdfkit`, `jspdf`, `@react-pdf/renderer` or `puppeteer`.

<!-- totalum-sdk:signatures pdf -->
| Call | Returns |
|---|---|
| `totalum.pdf.fromHtml({ name, html?, base64HtmlString?, options?, waitForSelector? })` | `{ key, fileName, url, usage }` |
| `totalum.pdf.fromUrl({ url, name, options?, cookies?, headers? })` | `{ key, fileName, url, usage }` |
<!-- /totalum-sdk:signatures -->

- `options`: `format?: 'A4' | 'Letter'`, `landscape?`, `margin?: { top: '20mm', … }`, `printBackground?`,
  `displayHeaderFooter?`, `headerTemplate?`, `footerTemplate?`. Each call stores a new file; `fromUrl` needs a public page.

HTML ≤ 10 MB; inline the CSS (`<style>`) and use absolute image URLs. The `url` is public-by-link: store `key` and
`url` on the row (e.g. `invoices.pdf_url`) and link to it; generate once per document, not per view. Cost ≈ 0.002
credits a PDF.

## Recipe — an invoice PDF

```ts
// in the server action that finalises the invoice (escapeHtml: see email.md)
import { totalum } from 'totalum-sdk';

const html = `<!doctype html><html><head><style>
  body { font-family: Helvetica, Arial, sans-serif; color: #111; } table { width: 100%; border-collapse: collapse; }
  td, th { padding: 6px; border-bottom: 1px solid #ddd; text-align: left; } .total { font-size: 20px; font-weight: 700; }
</style></head><body>
  <h1>Invoice ${escapeHtml(invoice.number)}</h1>
  <table><tr><th>Item</th><th>Qty</th><th>Price</th></tr>
  ${invoice.lines.map((l) => `<tr><td>${escapeHtml(l.name)}</td><td>${l.qty}</td><td>${l.price.toFixed(2)} €</td></tr>`).join('')}
  </table><p class="total">Total: ${invoice.total.toFixed(2)} €</p>
</body></html>`;
try {
  const pdf = await totalum.pdf.fromHtml({ name: `invoice-${invoice.number}`, html, options: { format: 'A4', printBackground: true } });
  await db.update(invoices).set({ pdfUrl: pdf.url, pdfKey: pdf.key }).where(eq(invoices.id, invoice.id));
} catch (err) {
  console.error('invoice PDF failed', err);
}
```

Several pages: one `<section style="page-break-after: always">` per page. E-mail it: `attachments: [{ filename:
'invoice.pdf', url: pdf.url }]` (`email.md`).

Errors: `CREATE_PDF_FROM_HTML_ERROR`, `GENERATE_PDF_BY_URL_ERROR`, `PDF_TIMEOUT` (simplify the page or drop
`waitForSelector`), `PDF_TOO_LARGE` (HTML > 10 MB: link images instead of inlining them), `URL_NOT_ALLOWED`.
