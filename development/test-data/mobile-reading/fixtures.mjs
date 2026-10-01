// Original synthetic PDF, including a bitmap-only page and an internal outline.
// Generated in memory by browser tests; no downloaded papers or generated artifacts are committed.
export function readingPdf(pageCount = 3) {
  const objects = [];
  const add = (value) => { objects.push(value); return objects.length; };
  const catalog = add("");
  const pages = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const image = add("<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 9 >>\nstream\n00FF8040>\nendstream");
  const ids = [];
  for (let index = 1; index <= pageCount; index++) {
    const content = index === 3 ? `q 200 0 0 200 100 200 cm /Im1 Do Q` : `BT /F1 24 Tf 40 500 Td (Mobile reading page ${index}) Tj 0 -40 Td (A searchable chapter.) Tj ET`;
    const stream = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    ids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  const outline = add("");
  const chapter = add(`<< /Title (Second chapter) /Parent ${outline} 0 R /Dest [${ids[Math.min(1, ids.length - 1)]} 0 R /Fit] >>`);
  objects[outline - 1] = `<< /Type /Outlines /First ${chapter} 0 R /Last ${chapter} 0 R /Count 1 >>`;
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R /Outlines ${outline} 0 R >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${ids.map((id) => `${id} 0 R`).join(" ")}] /Count ${ids.length} >>`;
  let body = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
