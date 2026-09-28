import { expect, test } from "vitest";
import { decompressPalmDoc, readMobiDocument } from "../app/features/reading-library/mobiDocument";
import { parseReadingFile } from "../app/features/reading-library/parseReadingFile";

function mobiFixture(compression = 1, body = "<html><body><h1>Chapter one</h1><p>Hello researcher.</p><img recindex=\"1\" /></body></html>") {
  const text = new TextEncoder().encode(body);
  const header = new Uint8Array(280); const view = new DataView(header.buffer);
  view.setUint16(0, compression); view.setUint32(4, text.length); view.setUint16(8, 1); view.setUint16(10, 4096);
  header.set(new TextEncoder().encode("MOBI"), 16);
  view.setUint32(20, 232); view.setUint32(28, 65001); view.setUint32(36, 6);
  view.setUint32(84, 256); view.setUint32(88, 9); header.set(new TextEncoder().encode("Test book"), 256); view.setUint32(108, 2);
  const image = new Uint8Array([137, 80, 78, 71]);
  const bytes = new Uint8Array(102 + header.length + text.length + image.length); const pdb = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("BOOKMOBI"), 60); pdb.setUint16(76, 3);
  pdb.setUint32(78, 102); pdb.setUint32(86, 102 + header.length); pdb.setUint32(94, 102 + header.length + text.length);
  bytes.set(header, 102); bytes.set(text, 102 + header.length); bytes.set(image, 102 + header.length + text.length);
  return bytes;
}
test.each([1, 2])("reads MOBI compression %i into bounded sanitized chapters and images", async (compression) => {
  const book = await parseReadingFile({ name: "classic.mobi", bytes: mobiFixture(compression) });
  expect(book).toMatchObject({ format: "mobi", title: "Test book" });
  expect(book.chapters[0].plainText).toContain("Hello researcher.");
  expect(book.chapters[0].content).toContain('data-reading-image="images/1"');
  expect(book.resources).toHaveLength(1);
});
test("PalmDOC handles back references and rejects corrupt or expanding records", () => {
  expect(new TextDecoder().decode(decompressPalmDoc(new Uint8Array([97, 98, 99, 128, 24]), 6))).toBe("abcabc");
  expect(() => decompressPalmDoc(new Uint8Array([128, 24]), 10)).toThrow();
  expect(() => decompressPalmDoc(new Uint8Array([97, 98, 99, 128, 24]), 5)).toThrow("超过");
  expect(() => decompressPalmDoc(new Uint8Array([8, 65]), 10)).toThrow();
});
test("MOBI rejects encryption, invalid offsets, oversized declared text and unsupported KF8", () => {
  const bytes = mobiFixture(); const view = new DataView(bytes.buffer);
  view.setUint16(102 + 12, 2); expect(() => readMobiDocument(bytes)).toThrow("加密"); view.setUint16(102 + 12, 0);
  view.setUint32(102 + 4, 128 * 1024 * 1024); expect(() => readMobiDocument(bytes)).toThrow("8 MB"); view.setUint32(102 + 4, 1);
  view.setUint32(102 + 36, 8); expect(() => readMobiDocument(bytes)).toThrow("KF8"); view.setUint32(102 + 36, 6);
  view.setUint32(78, 10); expect(() => readMobiDocument(bytes)).toThrow("损坏");
});
test("HTML and FB2 share the safe renderer, preserve metadata and drop executable content", async () => {
  const html = await parseReadingFile({ name: "paper.html", bytes: new TextEncoder().encode('<html><head><title>Research</title></head><body><h1>Methods</h1><script>evil()</script><p onclick="evil()">Result</p></body></html>') });
  expect(html.title).toBe("Research"); expect(html.chapters[0].content).toContain("Result"); expect(html.chapters[0].content).not.toContain("evil");
  const fb2 = await parseReadingFile({ name: "classic.fb2", bytes: new TextEncoder().encode('<FictionBook xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><book-title>经典</book-title><author><first-name>Ada</first-name><last-name>Lovelace</last-name></author></title-info></description><body><section><title><p>开始</p></title><p>正文</p><image l:href="#cover"/></section></body><binary id="cover" content-type="image/png">iVBORw==</binary></FictionBook>') });
  expect(fb2).toMatchObject({ format: "fb2", title: "经典", authors: ["Ada Lovelace"] }); expect(fb2.chapters[0].plainText).toContain("正文"); expect(fb2.resources).toHaveLength(1);
});


test("HUFF/CDIC decompresses dictionary codes and rejects dictionary cycles", () => {
  const header = mobiFixture().slice(102, 382); const hv = new DataView(header.buffer);
  hv.setUint16(0, 17480); hv.setUint32(4, 8); hv.setUint32(112, 2); hv.setUint32(116, 2); hv.setUint32(108, 0xffffffff);
  const huff = new Uint8Array(1304); const h = new DataView(huff.buffer);
  huff.set(new TextEncoder().encode("HUFF")); h.setUint32(8, 24); h.setUint32(12, 1048);
  for (let i = 0; i < 256; i++) h.setUint32(24 + i * 4, 128 | 1 | (1 << 8));
  const dictionary = new Uint8Array(26); const d = new DataView(dictionary.buffer);
  dictionary.set(new TextEncoder().encode("CDIC")); d.setUint32(4, 16); d.setUint32(8, 2); d.setUint32(12, 1);
  d.setUint16(16, 4); d.setUint16(18, 7); d.setUint16(20, 0x8001); dictionary[22] = 66; d.setUint16(23, 0x8001); dictionary[25] = 65;
  const records = [header, new Uint8Array([0b01010101]), huff, dictionary];
  const bytes = new Uint8Array(110 + records.reduce((sum, record) => sum + record.length, 0)); const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("BOOKMOBI"), 60); view.setUint16(76, 4); let offset = 110;
  records.forEach((record, i) => { view.setUint32(78 + i * 8, offset); bytes.set(record, offset); offset += record.length; });
  expect(readMobiDocument(bytes).html).toBe("ABABABAB");
  const dictionaryStart = 110 + header.length + 1 + huff.length;
  view.setUint16(dictionaryStart + 23, 1); bytes[dictionaryStart + 25] = 0;
  expect(() => readMobiDocument(bytes)).toThrow("损坏");
});
