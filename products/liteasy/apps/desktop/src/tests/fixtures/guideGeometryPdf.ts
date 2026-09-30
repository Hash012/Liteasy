/** Small authored PDF, with an initially offscreen fourth page and mixed-font multiline text. */
export const guideGeometryQuote = "The visible record is selected from committed versions before the transaction starts, keeping reads consistent across threads.";
export function guideGeometryPdf() {
  const streams = ["BT /F1 12 Tf 50 350 Td (Page one) Tj ET", "BT /F1 12 Tf 50 350 Td (Page two) Tj ET", "BT /F1 12 Tf 50 350 Td (Page three) Tj ET",
    "BT /F1 12 Tf 50 350 Td (The ) Tj /F2 12 Tf (visible record) Tj /F1 12 Tf ( is selected) Tj 0 -20 Td (from committed versions before) Tj 0 -20 Td (the transaction starts, keeping) Tj 0 -20 Td (reads consistent across threads.) Tj ET"];
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [5 0 R 7 0 R 9 0 R 11 0 R] /Count 4 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>"];
  streams.forEach((stream, index) => objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 400] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return Buffer.from(pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
