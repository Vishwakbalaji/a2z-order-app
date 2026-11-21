/** Weekly Sales & Commission Report PDF (private — for the rep, never sent to the distributor). */
import type { WeeklyReport } from '../types';
import type { Styles } from 'jspdf-autotable';
import { formatCents } from './money';
import { formatDay, formatNy } from './week';

const NAVY: [number, number, number] = [30, 58, 138];

async function logoData(custom: string | null): Promise<string | null> {
  if (custom) return custom;
  try {
    const b = await (await fetch('./logo.png')).blob();
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.onerror = rej;
      fr.readAsDataURL(b);
    });
  } catch {
    return null;
  }
}

export function weeklyReportFileName(r: WeeklyReport) {
  const suffix = r.status === 'provisional' ? '_PROVISIONAL' : r.revision ? `_Revised_R${r.revision}` : '';
  return `Weekly_Sales_Report_${r.start}_to_${r.end}${suffix}.pdf`;
}

export async function buildWeeklyReportPdf(r: WeeklyReport, customLogo: string | null): Promise<{ blob: Blob; filename: string }> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const d = r.data;
  let y = M;

  // header
  const logo = await logoData(customLogo);
  if (logo) {
    const img = await new Promise<{ w: number; h: number } | null>((res) => {
      const i = new Image();
      i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
      i.onerror = () => res(null);
      i.src = logo;
    });
    if (img) {
      const s = Math.min(110 / img.w, 52 / img.h);
      try {
        doc.addImage(logo, /^data:image\/jpe?g/i.test(logo) ? 'JPEG' : 'PNG', M, y, img.w * s, img.h * s);
      } catch {
        /* skip */
      }
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...NAVY);
  doc.text(r.company.companyName || '', W - M, y + 14, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(60);
  doc.text(`Sales Representative: ${r.rep.name}`, W - M, y + 30, { align: 'right' });
  doc.text(`Representative Phone: ${r.rep.phone || '—'}`, W - M, y + 43, { align: 'right' });
  y += 62;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(1.5);
  doc.line(M, y, W - M, y);
  y += 22;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(20);
  doc.text('WEEKLY SALES & COMMISSION REPORT', M, y);
  y += 16;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(70);
  const period = `${formatDay(r.start, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} – ${formatDay(r.end, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
  doc.text(`Week ${r.weekNumber}   ·   Report ID: ${r.status === 'provisional' ? 'PROVISIONAL (week not finished)' : r.id}`, M, y);
  y += 13;
  doc.text(`Reporting period: ${period} (America/New_York)`, M, y);
  y += 13;
  doc.text(`${r.status === 'provisional' ? 'Generated' : 'Finalized'}: ${formatNy(r.createdAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}${r.revision ? `   ·   Revision ${r.revision} (replaces ${r.supersedes}) — ${r.revisionReason || ''}` : ''}`, M, y);
  y += 10;
  if (r.status === 'provisional') {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 83, 9);
    const warn = doc.splitTextToSize('PROVISIONAL — the week is still in progress; numbers can still change. The final report is created after Friday 11:59 PM.', W - 2 * M) as string[];
    doc.text(warn, M, y + 12);
    y += 12 + warn.length * 12;
  }
  y += 10;

  const table = (head: string[], body: (string | number)[][], columnStyles: Record<string, Partial<Styles>> = {}) => {
    autoTable(doc, {
      startY: y,
      head: [head],
      body: body.map((r) => r.map(String)),
      theme: 'grid',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      margin: { left: M, right: M, bottom: 50 },
      styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 5, overflow: 'linebreak', textColor: 20, lineColor: [200, 205, 215], lineWidth: 0.6 },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 251] },
      columnStyles,
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
  };
  const heading = (t: string) => {
    if (y > H - 110) {
      doc.addPage();
      y = M;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text(t, M, y);
    y += 8;
  };
  const note = (t: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80);
    const lines = doc.splitTextToSize(t, W - 2 * M) as string[];
    doc.text(lines, M, y + 6);
    y += lines.length * 12 + 14;
  };
  const right = { halign: 'right' as const };
  const firstWeek = d.nonOrdering === null;

  heading('Weekly Summary');
  table(
    ['Metric', 'Value'],
    [
      ['New Stores Added', d.newStores.length],
      ['Total Active Stores', d.activeStores],
      ['Total Orders Received', d.ordersCount],
      ['Stores That Placed Orders', d.distinctStores],
      ['Stores Without Orders', firstWeek ? 'Not Applicable — First Week' : d.nonOrdering!.length],
      ['Total Cases Ordered', d.totalCases],
      ['Total Weekly Sales', formatCents(d.salesCents)],
      ['Commission Rate', `${d.commissionRateBps / 100}%`],
      ['My Weekly Commission', formatCents(d.commissionCents)],
    ],
    { 1: { ...right, fontStyle: 'bold' } },
  );

  heading(`A. New Stores Added This Week: ${d.newStores.length}`);
  if (!d.newStores.length) note('No New Stores Added This Week.');
  else table(['S.No', 'Store Name', 'Store Location', 'Date Added'], d.newStores.map((s, i) => [i + 1, s.name, s.location, formatNy(s.addedAt)]), { 0: { cellWidth: 36, halign: 'center' } });

  heading(`B. Orders Received: ${d.ordersCount} orders from ${d.distinctStores} stores`);
  if (!d.storesWithOrders.length) note('No orders were finalized this week.');
  else
    table(
      ['S.No', 'Store Name', 'Store Location', 'Orders', 'Cases', 'Total Sales Value'],
      d.storesWithOrders.map((s, i) => [i + 1, s.name, s.location, s.orders, s.cases, formatCents(s.valueCents) + (s.pendingOrders ? ` (+${s.pendingOrders} awaiting prices)` : '')]),
      { 0: { cellWidth: 36, halign: 'center' }, 3: { ...right, cellWidth: 46 }, 4: { ...right, cellWidth: 46 }, 5: { ...right, cellWidth: 100 } },
    );
  if (d.flaggedOrders.length) {
    note(
      `Flagged — not included in confirmed sales until prices are added: ${d.flaggedOrders.map((f) => `#${f.orderNo} ${f.storeName} (${f.unpricedLines} product(s) without price)`).join('; ')}.`,
    );
  }

  heading('C. Total Weekly Sales');
  table(
    ['Total Orders Received', 'Distinct Stores That Ordered', 'Total Cases Ordered', 'Total Weekly Sales Value'],
    [[d.ordersCount, d.distinctStores, d.totalCases, formatCents(d.salesCents)]],
    { 0: right, 1: right, 2: right, 3: { ...right, fontStyle: 'bold' } },
  );

  heading('D. Stores That Did Not Place Orders');
  if (firstWeek) note('Not Applicable — First Week. This analysis starts from Week 2.');
  else {
    note(`Total Active Stores: ${d.activeStores}   ·   Stores That Placed Orders: ${d.distinctStores}   ·   Stores That Did Not Place Orders: ${d.nonOrdering!.length}`);
    if (d.nonOrdering!.length)
      table(['S.No', 'Store Name', 'Store Location', 'Last Order Date'], d.nonOrdering!.map((s, i) => [i + 1, s.name, s.location, s.lastOrderAt ? formatNy(s.lastOrderAt) : 'No Previous Order']), { 0: { cellWidth: 36, halign: 'center' } });
    note('Active stores = stores registered by the end of the week and not archived. Stores archived before or during the week are not listed.');
  }

  heading('E. My 1% Commission');
  table(
    ['Total Weekly Sales', 'Commission Rate', 'My Weekly Commission'],
    [[formatCents(d.salesCents), `${d.commissionRateBps / 100}%`, formatCents(d.commissionCents)]],
    { 0: right, 1: right, 2: { ...right, fontStyle: 'bold' } },
  );
  note('Commission = Total Weekly Sales × 1%, rounded to the cent. Based on finalized orders only; voided orders and orders with missing prices are not included.');

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(120);
    doc.text(`Private — personal sales report · ${r.status === 'provisional' ? 'PROVISIONAL' : r.id}`, M, H - 24);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 24, { align: 'right' });
  }
  doc.setProperties({ title: `Weekly Sales Report ${r.start} to ${r.end}`, creator: 'A2Z Order Pad' });
  return { blob: doc.output('blob'), filename: weeklyReportFileName(r) };
}
