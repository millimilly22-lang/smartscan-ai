# SmartScan AI — Microsoft Store publishing

## Release path
1. Deploy the production Vite build to a public HTTPS host.
2. Package the deployed PWA for Windows using PWABuilder.
3. Use the Microsoft Partner Center identity values for the reserved SmartScan AI product.
4. Upload the generated Windows package to Partner Center.
5. Complete pricing, availability, properties, age ratings, packages and Store listing.

## Render settings
- Build command: `npm run build`
- Publish directory: `dist`

## Pricing
- Free download
- SmartScan Pro: $8.99/month
- SmartScan Pro Annual: $59.99/year

## Before certification
- Connect and test Stripe or another Microsoft-permitted secure billing flow for the Windows version.
- Add final support contact details.
- Replace placeholder support/contact copy where needed.
- Test OCR, PDF extraction, expense export and document history on Windows 10/11.
- Prepare Store screenshots and logo assets.
- Complete the age rating questionnaire accurately.
