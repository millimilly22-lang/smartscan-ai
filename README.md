# SmartScan AI

English-first document scanner and expense assistant for Microsoft Windows/PWA, with an iOS path prepared for later.

## Current features
- Camera/image OCR with Tesseract.js
- PDF text extraction with PDF.js
- Invoice, receipt, bill, statement, contract and document classification
- Vendor, total, VAT/tax, reference, date, due-date and currency extraction
- Expense categories and CSV export
- Document Q&A
- Local document history
- PDF report export
- Responsive PWA interface
- Free plan preview: 5 saved scans
- SmartScan Pro pricing prepared at $8.99/month or $59.99/year

## Run locally
```bash
npm install
npm run dev
```

## Production build
```bash
npm run build
```

For Microsoft Store publication, deploy the `dist` build to HTTPS, package the PWA for Windows, then upload it through Partner Center.

Do not commit `.env` files, Stripe secret keys, AI provider secrets, or database credentials.
