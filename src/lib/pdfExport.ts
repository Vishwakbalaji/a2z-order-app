/**
 * Order PDFs (A4, generated entirely on the phone — no server).
 *  - 'order':    for the distributor. S.No | Product Name | Quantity (Cases). NO prices.
 *  - 'detailed': for the rep. S.No | Product Name | Price/Case | Cases | Line Total + order value.
 */
import type { CompanyInfo, Totals } from '../types';
import type { Styles } from 'jspdf-autotable';
import { formatCents } from './money';
import { slug } from './normalize';
import { ymd } from './download';

export interface PdfLine {
  name: string;
  qty: number;
  priceCents: number | null;
  note?: string;
}
export interface PdfOrder {
  company: CompanyInfo;
  logoDataUrl: string | null; // null = bundled logo
  store: { name: string; address: string; phone: string; manager: string };
  rep: { name: string; phone: string };
  date: Date;
  orderNo?: string;
  lines: PdfLine[];
  totals: Totals;
  /** Shows "NEW STORE — FIRST ORDER" under the store details (a new store's first order only). */
  newStoreFirstOrder?: boolean;
}

let defaultLogo: Promise<string | null> | null = null;
function loadDefaultLogo(): Promise<string | null> {
  if (!defaultLogo) {
    defaultLogo = fetch('./logo.png')
      .then((r) => (r.ok ? r.blob() : null))
      .then(
        (b) =>
          b &&
          new Promise<string>((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result as string);
            fr.onerror = rej;
            fr.readAsDataURL(b);
          }),
      )
      .catch(() => null);
  }
  return defaultLogo;
}

function imageSize(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => res(null);
    img.src = dataUrl;
  });
}

export function orderFileName(storeName: string, date: Date, kind: 'order' | 'detailed') {
  return `${kind === 'detailed' ? 'Order_Detailed_' : 'Order_'}${slug(storeName)}_${ymd(date)}.pdf`;
}

const NAVY: [number, number, number] = [30, 58, 138];

export async function buildOrderPdf(o: PdfOrder, kind: 'order' | 'detailed'): Promise<{ blob: Blob; filename: string }> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  let y = M;

  // ---- header: logo + distributor
  const logo = o.logoDataUrl || (await loadDefaultLogo());
  let logoH = 0;
  if (logo) {
    const sz = await imageSize(logo);
    if (sz) {
      const maxW = 130, maxH = 62;
      const s = Math.min(maxW / sz.w, maxH / sz.h);
      const fmt = /^data:image\/jpe?g/i.test(logo) ? 'JPEG' : 'PNG';
      try {
        doc.addImage(logo, fmt, M, y, sz.w * s, sz.h * s);
        logoH = sz.h * s;
      } catch {
        /* unreadable image: skip */
      }
    }
  }
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  const rightX = W - M;
  let hy = y + 14;
  if (o.company.companyName) {
    doc.text(o.company.companyName, rightX, hy, { align: 'right' });
    hy += 15;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(60);
  for (const line of [o.company.companyAddress, o.company.companyPhone ? `Phone: ${o.company.companyPhone}` : ''].filter(Boolean)) {
    for (const l of doc.splitTextToSize(line, W / 2 - M) as string[]) {
      doc.text(l, rightX, hy, { align: 'right' });
      hy += 12;
    }
  }
  y = Math.max(y + logoH, hy) + 10;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(1.5);
  doc.line(M, y, W - M, y);
  y += 22;

  // ---- title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(kind === 'detailed' ? 'ORDER — DETAILED (INTERNAL COPY)' : 'PURCHASE ORDER', M, y);
  if (o.orderNo) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Order No: ${o.orderNo}`, W - M, y, { align: 'right' });
  }
  y += 16;

  // ---- store & rep info (two columns, wrapping)
  const colW = (W - 2 * M - 20) / 2;
  const block = (pairs: [string, string][], x: number, startY: number) => {
    let yy = startY;
    for (const [label, value] of pairs) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(90);
      doc.text(label, x, yy);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(20);
      const lines = doc.splitTextToSize(value || '—', colW - 92) as string[];
      lines.forEach((l, i) => doc.text(l, x + 92, yy + i * 12.5));
      yy += Math.max(1, lines.length) * 12.5 + 4;
    }
    return yy;
  };
  const dateStr = o.date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const y1 = block(
    [
      ['Store Name:', o.store.name],
      ['Store Address:', o.store.address],
      ['Store Phone:', o.store.phone],
      ['Store Manager:', o.store.manager],
    ],
    M,
    y + 12,
  );
  const y2 = block(
    [
      ['Sales Rep:', o.rep.name],
      ['Rep Phone:', o.rep.phone],
      ['Order Date:', dateStr],
    ],
    M + colW + 20,
    y + 12,
  );
  y = Math.max(y1, y2) + 8;

  // ---- new store label (first finalized order of a store marked "New Store")
  if (o.newStoreFirstOrder) {
    const label = 'NEW STORE — FIRST ORDER';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    const w = doc.getTextWidth(label) + 28;
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(200, 30, 38);
    doc.setLineWidth(1.6);
    doc.roundedRect(M, y, w, 28, 4, 4, 'FD');
    doc.setTextColor(200, 30, 38);
    doc.text(label, M + 14, y + 19);
    doc.setTextColor(20);
    y += 40;
  }

  // ---- table
  const lines = o.lines.filter((l) => l.qty > 0);
  const nameCell = (l: PdfLine) => (l.note ? `${l.name}\nNote: ${l.note}` : l.name);
  const head = kind === 'detailed' ? [['S.No', 'Product Name', 'Price/Case', 'Cases', 'Line Total']] : [['S.No', 'Product Name', 'Quantity (Cases)']];
  const body =
    kind === 'detailed'
      ? lines.map((l, i) => [String(i + 1), nameCell(l), l.priceCents == null ? 'N/A' : formatCents(l.priceCents), String(l.qty), l.priceCents == null ? 'N/A' : formatCents(l.priceCents * l.qty)])
      : lines.map((l, i) => [String(i + 1), nameCell(l), String(l.qty)]);
  const columnStyles: Record<string, Partial<Styles>> =
    kind === 'detailed'
      ? { 0: { cellWidth: 38, halign: 'center' as const }, 2: { cellWidth: 72, halign: 'right' as const }, 3: { cellWidth: 46, halign: 'right' as const }, 4: { cellWidth: 80, halign: 'right' as const } }
      : { 0: { cellWidth: 42, halign: 'center' as const }, 2: { cellWidth: 100, halign: 'right' as const, fontStyle: 'bold' as const, fontSize: 12 } };

  autoTable(doc, {
    startY: y,
    head,
    body,
    theme: 'grid',
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    margin: { left: M, right: M, top: M, bottom: 50 },
    styles: { font: 'helvetica', fontSize: 10.5, cellPadding: { top: 6, bottom: 6, left: 6, right: 6 }, overflow: 'linebreak', valign: 'middle', textColor: 20, lineColor: [200, 205, 215], lineWidth: 0.6 },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', halign: 'left' },
    alternateRowStyles: { fillColor: [245, 247, 251] },
    columnStyles,
    didParseCell: (d) => {
      if (d.section === 'head' && d.column.index !== 1) d.cell.styles.halign = d.column.index === 0 ? 'center' : 'right';
      if (kind === 'detailed' && d.section === 'body' && d.cell.raw === 'N/A') d.cell.styles.textColor = [180, 83, 9];
    },
  });

  // ---- totals
  const docAny = doc as unknown as { lastAutoTable?: { finalY: number } };
  y = (docAny.lastAutoTable?.finalY ?? y) + 26;
  const totalsRows: [string, string][] = [
    ['Total Products:', String(o.totals.products)],
    ['Total Cases:', String(o.totals.cases)],
  ];
  if (kind === 'detailed') totalsRows.push(['Total Order Value:', formatCents(o.totals.valueCents)]);
  const needed = totalsRows.length * 18 + (kind === 'detailed' && o.totals.unpricedLines ? 40 : 0) + 10;
  if (y + needed > H - 50) {
    doc.addPage();
    y = M + 10;
  }
  const boxW = 230;
  const bx = W - M - boxW;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(1);
  doc.roundedRect(bx, y - 13, boxW, totalsRows.length * 18 + 8, 4, 4);
  totalsRows.forEach(([k, v], i) => {
    const last = kind === 'detailed' && i === totalsRows.length - 1;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(last ? 12 : 11);
    doc.setTextColor(60);
    doc.text(k, bx + 10, y + i * 18);
    doc.setTextColor(20);
    doc.text(v, W - M - 10, y + i * 18, { align: 'right' });
  });
  y += totalsRows.length * 18 + 8;
  if (kind === 'detailed' && o.totals.unpricedLines) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(180, 83, 9);
    const msg = `Note: ${o.totals.unpricedLines} product(s) (${o.totals.unpricedCases} case(s)) have no price available and are NOT included in the Total Order Value.`;
    (doc.splitTextToSize(msg, W - 2 * M) as string[]).forEach((l, i) => doc.text(l, M, y + 6 + i * 12));
  }

  // ---- footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(120);
    doc.text(`${o.store.name} — ${dateStr}${o.orderNo ? ` — ${o.orderNo}` : ''}`, M, H - 24);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 24, { align: 'right' });
  }

  doc.setProperties({ title: `Order ${o.store.name} ${ymd(o.date)}`, subject: kind === 'detailed' ? 'Detailed order' : 'Order', creator: 'A2Z Order Pad' });
  const blob = doc.output('blob');
  return { blob, filename: orderFileName(o.store.name, o.date, kind) };
}
