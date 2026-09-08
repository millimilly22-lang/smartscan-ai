import React, { useMemo, useRef, useState } from 'react';
import Tesseract from 'tesseract.js';
import { jsPDF } from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const STORAGE_KEY = 'smartscan-ai-documents-v2';
const FREE_LIMIT = 5;
const money = /([$€£]?[A-Z]{0,3}\s?\d{1,9}(?:[.,]\d{2})?)/i;

function match(text, patterns, fallback = 'Not detected') {
  for (const pattern of patterns) {
    const found = text.match(pattern);
    if (found?.[1]) return found[1].trim();
  }
  return fallback;
}

function classify(text, name = '') {
  const s = `${text} ${name}`.toLowerCase();
  if (/invoice|vat invoice|tax invoice/.test(s)) return 'Invoice';
  if (/receipt|cashier|subtotal|change due/.test(s)) return 'Receipt';
  if (/contract|agreement|termination|party/.test(s)) return 'Contract';
  if (/statement|opening balance|closing balance/.test(s)) return 'Statement';
  if (/bill|payment due|utility/.test(s)) return 'Bill';
  return 'Document';
}

function currencyOf(text) {
  if (/\bPLN\b|zł|\bzl\b/i.test(text)) return 'PLN';
  if (/€|\bEUR\b/i.test(text)) return 'EUR';
  if (/£|\bGBP\b/i.test(text)) return 'GBP';
  if (/\$|\bUSD\b/i.test(text)) return 'USD';
  return 'Unknown';
}

function categoryOf(text, type) {
  const s = text.toLowerCase();
  if (/uber|taxi|flight|train|fuel|parking/.test(s)) return 'Travel';
  if (/restaurant|cafe|coffee|grocery|food/.test(s)) return 'Meals';
  if (/software|subscription|hosting|cloud|domain/.test(s)) return 'Software';
  if (/electric|water|internet|phone|utility|energy/.test(s)) return 'Utilities';
  if (/office|printer|paper|stationery|supplies/.test(s)) return 'Office';
  if (/hotel|accommodation|booking/.test(s)) return 'Accommodation';
  return ['Invoice', 'Receipt', 'Bill'].includes(type) ? 'Other expense' : 'Uncategorized';
}

function analyse(text, name) {
  const type = classify(text, name);
  const vendor = text.split(/\n+/).map(v => v.trim()).find(v => v.length > 2 && v.length < 80 && !/^(invoice|receipt|bill|statement|date|total)/i.test(v)) || 'Not detected';
  const total = match(text, [new RegExp(`(?:grand\\s*total|amount\\s*due|total\\s*due|balance\\s*due|total|amount)\\s*[:\\-]?\\s*${money.source}`, 'i')]);
  const tax = match(text, [new RegExp(`(?:vat|tax|gst)\\s*(?:amount)?\\s*[:\\-]?\\s*${money.source}`, 'i')]);
  const invoiceNumber = match(text, [/(?:invoice\s*(?:number|no\.?|#)|inv\.?\s*(?:no\.?|#)|receipt\s*(?:number|no\.?|#))\s*[:\-]?\s*([A-Z0-9\-\/_.]{2,40})/i]);
  const date = match(text, [/(?:invoice date|issue date|date)\s*[:\-]?\s*(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4})/i, /\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\b/]);
  const dueDate = match(text, [/(?:payment due|due date|pay by|due)\s*[:\-]?\s*(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4})/i]);
  const currency = currencyOf(`${total} ${text}`);
  const category = categoryOf(text, type);
  const flags = [];
  if (['Invoice', 'Receipt', 'Bill'].includes(type) && total === 'Not detected') flags.push('Total amount needs review');
  if (type === 'Invoice' && invoiceNumber === 'Not detected') flags.push('Invoice number was not found');
  if (['Invoice', 'Bill'].includes(type) && dueDate === 'Not detected') flags.push('No payment due date detected');
  if (/automatic renewal|auto-renew|automatically renew/i.test(text)) flags.push('Automatic renewal language detected');
  if (/penalty|termination fee|late fee/i.test(text)) flags.push('Fee or penalty language detected');
  const words = text.split(/\s+/).filter(Boolean).length;
  const summary = text ? `This appears to be a ${type.toLowerCase()} from ${vendor}. SmartScan extracted about ${words} words and categorized it as ${category.toLowerCase()}. Verify important values against the original document.` : 'No readable text was detected.';
  return { type, vendor, total, tax, invoiceNumber, date, dueDate, currency, category, flags, summary };
}

function numeric(value) {
  if (!value || value === 'Not detected') return 0;
  let s = value.replace(/[^0-9,.-]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else s = s.replace(',', '.');
  return Number.parseFloat(s) || 0;
}

async function readPdf(file, setProgress) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pages = [];
  const count = Math.min(pdf.numPages, 25);
  for (let i = 1; i <= count; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
    setProgress(Math.round((i / count) * 100));
  }
  return pages.join('\n\n');
}

function answer(question, doc) {
  if (!doc) return 'Open a document first.';
  const q = question.toLowerCase();
  const a = doc.analysis;
  if (/vendor|company|merchant|issuer/.test(q)) return `Detected vendor: ${a.vendor}.`;
  if (/tax|vat|gst/.test(q)) return `Detected tax/VAT: ${a.tax}.`;
  if (/invoice number|reference|receipt number/.test(q)) return `Detected reference: ${a.invoiceNumber}.`;
  if (/due|deadline|pay by/.test(q)) return `Detected due date: ${a.dueDate}.`;
  if (/total|amount|cost|price/.test(q)) return `Detected total: ${a.total}${a.currency !== 'Unknown' ? ` (${a.currency})` : ''}.`;
  if (/warning|risk|missing|review/.test(q)) return a.flags.length ? a.flags.join('; ') : 'No obvious missing key field was flagged. Verify the original document.';
  if (/summary|summarize|about/.test(q)) return a.summary;
  return 'Ask about the vendor, total, tax/VAT, due date, reference number, review flags, or summary.';
}

export default function App() {
  const fileRef = useRef(null);
  const [docs, setDocs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  });
  const [tab, setTab] = useState('home');
  const [activeId, setActiveId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [query, setQuery] = useState('');
  const [chat, setChat] = useState([]);
  const [search, setSearch] = useState('');

  const active = docs.find(d => d.id === activeId) || null;
  const expenseDocs = docs.filter(d => numeric(d.analysis?.total) > 0);
  const totals = useMemo(() => expenseDocs.reduce((acc, d) => {
    const c = d.analysis.currency || 'Unknown';
    acc[c] = (acc[c] || 0) + numeric(d.analysis.total);
    return acc;
  }, {}), [docs]);
  const filtered = docs.filter(d => `${d.name} ${d.text} ${d.analysis?.vendor} ${d.analysis?.invoiceNumber} ${d.analysis?.category}`.toLowerCase().includes(search.toLowerCase()));

  function save(next) {
    setDocs(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function processFile(file) {
    if (!file) return;
    if (docs.length >= FREE_LIMIT) { setTab('pro'); return; }
    setProcessing(true); setProgress(5);
    try {
      let text = ''; let imageUrl = '';
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        text = await readPdf(file, setProgress);
      } else {
        imageUrl = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(file); });
        const result = await Tesseract.recognize(file, 'eng', { logger: m => { if (m.status === 'recognizing text') setProgress(Math.max(10, Math.round((m.progress || 0) * 100))); } });
        text = result.data.text || '';
      }
      const doc = { id: crypto.randomUUID(), name: file.name, size: file.size, createdAt: new Date().toISOString(), imageUrl, text, analysis: analyse(text, file.name) };
      save([doc, ...docs]); setActiveId(doc.id); setChat([]); setTab('document');
    } catch (err) {
      alert(`Could not process this file: ${err.message || err}`);
    } finally { setProcessing(false); setProgress(0); }
  }

  function exportPdf() {
    if (!active) return;
    const pdf = new jsPDF();
    const a = active.analysis;
    pdf.setFontSize(18); pdf.text('SmartScan AI Report', 14, 18);
    pdf.setFontSize(10);
    const lines = [`File: ${active.name}`, `Type: ${a.type}`, `Vendor: ${a.vendor}`, `Total: ${a.total}`, `Tax/VAT: ${a.tax}`, `Currency: ${a.currency}`, `Reference: ${a.invoiceNumber}`, `Document date: ${a.date}`, `Due date: ${a.dueDate}`, `Category: ${a.category}`, '', 'Summary:', a.summary, '', 'Extracted text:', active.text || 'No text detected.'];
    pdf.text(pdf.splitTextToSize(lines.join('\n'), 180), 14, 28);
    pdf.save(`${active.name.replace(/\.[^.]+$/, '')}-smartscan.pdf`);
  }

  function exportCsv() {
    const rows = [['Date','Vendor','Type','Reference','Category','Currency','Total','Tax','Due date']];
    expenseDocs.forEach(d => rows.push([d.analysis.date,d.analysis.vendor,d.analysis.type,d.analysis.invoiceNumber,d.analysis.category,d.analysis.currency,d.analysis.total,d.analysis.tax,d.analysis.dueDate]));
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'smartscan-expenses.csv'; a.click(); URL.revokeObjectURL(url);
  }

  function askDoc() {
    if (!query.trim()) return;
    const q = query.trim();
    setChat(v => [...v, { role:'user', text:q }, { role:'ai', text:answer(q, active) }]);
    setQuery('');
  }

  function openDoc(id) { setActiveId(id); setChat([]); setTab('document'); }

  return <div className="app">
    <header><div className="brand" onClick={() => setTab('home')}><span>▣</span><b>SmartScan AI</b></div><nav><button onClick={() => setTab('home')}>Home</button><button onClick={() => setTab('documents')}>Documents</button><button onClick={() => setTab('expenses')}>Expenses</button><button className="pro" onClick={() => setTab('pro')}>PRO</button></nav></header>

    {tab === 'home' && <main className="home">
      <section className="hero"><div><span className="eyebrow">AI DOCUMENT ASSISTANT</span><h1>Scan it.<br/>Understand it.</h1><p>Turn receipts, invoices, bills, contracts and PDFs into searchable information, expenses and useful answers.</p><div className="actions"><button className="primary" onClick={() => fileRef.current?.click()}>＋ Scan or import</button><button className="secondary" onClick={() => setTab('documents')}>View documents</button></div><small>{docs.length}/{FREE_LIMIT} free saved scans used</small></div><div className="scanCard"><div className="paper">SMARTSCAN<div className="line"/><div className="line short"/><strong>OCR + AI</strong></div><span>Camera · Image · PDF</span></div></section>
      <section className="features"><article><b>English OCR</b><p>Read text from photographed documents.</p></article><article><b>Invoice intelligence</b><p>Detect vendor, total, VAT/tax, reference and due date.</p></article><article><b>Expense dashboard</b><p>Organize financial documents by category and currency.</p></article><article><b>Ask SmartScan</b><p>Ask focused questions about the active document.</p></article></section>
    </main>}

    {tab === 'documents' && <main className="page"><div className="pageHead"><div><span className="eyebrow">LIBRARY</span><h2>Documents</h2></div><button className="primary" onClick={() => fileRef.current?.click()}>＋ New scan</button></div><input className="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendor, filename, reference or category"/>{filtered.length ? <div className="cards">{filtered.map(d => <button className="docCard" key={d.id} onClick={() => openDoc(d.id)}><span>{d.analysis.type}</span><b>{d.analysis.vendor !== 'Not detected' ? d.analysis.vendor : d.name}</b><small>{d.analysis.total} · {d.analysis.category}</small></button>)}</div> : <div className="empty">No documents yet. Scan your first receipt, invoice or PDF.</div>}</main>}

    {tab === 'document' && active && <main className="page"><div className="pageHead"><div><span className="eyebrow">DOCUMENT</span><h2>{active.name}</h2></div><button className="secondary" onClick={exportPdf}>Export PDF</button></div>{active.analysis.flags.length > 0 && <div className="warning"><b>Review:</b> {active.analysis.flags.join(' · ')}</div>}<div className="docGrid"><section className="panel"><h3>Smart analysis</h3><p className="summary">{active.analysis.summary}</p><div className="facts">{[['Type',active.analysis.type],['Vendor',active.analysis.vendor],['Total',active.analysis.total],['Tax/VAT',active.analysis.tax],['Currency',active.analysis.currency],['Reference',active.analysis.invoiceNumber],['Date',active.analysis.date],['Due date',active.analysis.dueDate],['Category',active.analysis.category]].map(([k,v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div></section><section className="panel"><h3>Ask SmartScan</h3><div className="chat">{chat.length ? chat.map((m,i) => <div key={i} className={`bubble ${m.role}`}>{m.text}</div>) : <p>Ask about the vendor, total, tax, due date, reference, warnings or summary.</p>}</div><div className="ask"><input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && askDoc()} placeholder="Ask about this document…"/><button onClick={askDoc}>↑</button></div></section></div><section className="panel text"><h3>Extracted text</h3><pre>{active.text || 'No text detected.'}</pre></section></main>}

    {tab === 'expenses' && <main className="page"><div className="pageHead"><div><span className="eyebrow">PRO INSIGHTS</span><h2>Expenses</h2></div><button className="secondary" onClick={exportCsv} disabled={!expenseDocs.length}>Export CSV</button></div><div className="metrics"><article><span>Tracked expenses</span><strong>{expenseDocs.length}</strong></article>{Object.entries(totals).map(([c,v]) => <article key={c}><span>{c} total</span><strong>{c === 'Unknown' ? '' : `${c} `}{v.toFixed(2)}</strong></article>)}</div><div className="panel"><h3>Expense documents</h3>{expenseDocs.length ? expenseDocs.map(d => <button className="row" key={d.id} onClick={() => openDoc(d.id)}><div><b>{d.analysis.vendor}</b><small>{d.analysis.category} · {d.analysis.dueDate}</small></div><strong>{d.analysis.total}</strong></button>) : <div className="empty">Totals from invoices, receipts and bills will appear here.</div>}</div></main>}

    {tab === 'pro' && <main className="page proPage"><span className="eyebrow">SMARTSCAN PRO</span><h2>More scanning. More intelligence.</h2><div className="pricing"><article className="panel"><span>FREE</span><h3>$0</h3><p>Up to {FREE_LIMIT} saved scans</p><ul><li>English OCR</li><li>Basic analysis</li><li>PDF export</li></ul></article><article className="panel featured"><span>PRO</span><h3>$8.99 <small>/month</small></h3><p>or $59.99/year</p><ul><li>Expanded scanning limits</li><li>PDF text extraction</li><li>Invoice and tax fields</li><li>Expense dashboard + CSV</li><li>Payment deadline tools</li><li>Advanced document Q&A</li></ul><button className="primary" onClick={() => alert('Stripe checkout will be connected before Microsoft Store publication. This preview does not charge you.')}>Choose Pro</button></article></div></main>}

    <footer><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/support.html">Support</a><span>SmartScan AI · English</span></footer>

    <input ref={fileRef} hidden type="file" accept="image/*,.pdf" onChange={e => { processFile(e.target.files?.[0]); e.target.value=''; }}/>
    {processing && <div className="overlay"><div className="loader"><div className="spinner"/><h3>Analyzing document</h3><p>OCR, extraction and smart checks…</p><div className="bar"><i style={{width:`${progress}%`}}/></div><b>{progress}%</b></div></div>}
  </div>;
}
