"""Read-only verification of public synthetic export evidence. No document scripts run."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,tempfile,unicodedata,zipfile
import xml.etree.ElementTree as ET
import pymupdf
from PIL import Image
root=Path(__file__).resolve().parent
hashes=json.loads((root/'sha256.json').read_text())
for name,expected in hashes.items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==expected,name
receipts=json.loads((root/'native-receipts.json').read_text())
for item in receipts:
 data=(root/item['fileName']).read_bytes();assert len(data)==item['receipt']['byteLength'];assert hashlib.sha256(data).hexdigest()==item['receipt']['sha256']
 assert item['receipt']['sources'][0]['sha256']==hashlib.sha256((root/'windows-input.md').read_bytes()).hexdigest()
normalize=lambda text:re.sub(r'\s+','',unicodedata.normalize('NFKC',text))
checks={}
with tempfile.TemporaryDirectory(prefix='liteasy-export-check-') as directory:
 temp=Path(directory)
 for file,sentinels in [('windows-report.pdf',['合成Windows报告','WINDOWS_TABLE_TAIL','WINDOWS_SOURCE_LAST_PARAGRAPH']),('research-report.pdf',['TAIL_EXPORT_MARKER','CODE_LAST_LINE'])]:
  document=pymupdf.open(root/file);text=normalize(''.join(page.get_text() for page in document));assert all(x in text for x in sentinels)
  # A visible semantic text page has no full-page raster replacement.
  if file=='windows-report.pdf': assert not document[0].get_images()
  checks[file]={'pages':len(document),'text':'PASS'}
  if file=='windows-report.pdf': document[1].get_pixmap(matrix=pymupdf.Matrix(1.25,1.25)).save(temp/'native-mupdf.png')
 legacy=pymupdf.open(root/'orientation.pdf');legacy[0].get_pixmap().save(temp/'legacy-mupdf.png')
 subprocess.run(['pdftoppm','-png','-scale-to-x','596','-scale-to-y','842','-singlefile',str(root/'orientation.pdf'),str(temp/'legacy-poppler')],check=True)
 subprocess.run(['pdftoppm','-f','2','-l','2','-png','-scale-to-x','744','-scale-to-y','1053','-singlefile',str(root/'windows-report.pdf'),str(temp/'native-poppler')],check=True)
 subprocess.run(['pdftotext','-layout',str(root/'windows-report.pdf'),str(temp/'native.txt')],check=True)
 text=normalize((temp/'native.txt').read_text());assert 'WINDOWS_SOURCE_LAST_PARAGRAPH' in text and 'WINDOWS_TABLE_TAIL' in text
 for name,top,bottom in [('legacy-mupdf.png',(50,50),(50,750)),('legacy-poppler.png',(50,50),(50,750)),('native-mupdf.png',(100,100),(100,850)),('native-poppler.png',(100,100),(100,850))]:
  image=Image.open(temp/name).convert('RGB');a,b=image.getpixel(top),image.getpixel(bottom);assert a[0]>a[2]+100 and b[2]>b[0]+100;checks[name]='upright'
 with zipfile.ZipFile(root/'windows-report.zip') as archive:
  assert all(not Path(p).is_absolute() and '..' not in Path(p).parts for p in archive.namelist());moved=temp/'moved';archive.extractall(moved)
  markdown=(moved/'document.md').read_text();images=re.findall(r'!\[[^\]]*\]\((assets/[^)]+)\)',markdown);assert images
  for image in images: Image.open(moved/image).verify()
  assert 'data:image' not in markdown and 'blob:' not in markdown and 'file://' not in markdown
  checks['moved_markdown_zip']='PASS'
 with zipfile.ZipFile(root/'windows-report.docx') as archive:
  xml=archive.read('word/document.xml');ET.fromstring(xml)
  for element in [b'<w:p>',b'<w:tbl>',b'<w:drawing>',b'<m:f>',b'<m:rad>',b'<w:footerReference']: assert element in xml,element
  assert b'PAGE' in archive.read('word/footer1.xml');assert any(p.startswith('word/media/') for p in archive.namelist());assert not any('vbaProject' in p for p in archive.namelist());checks['docx_semantics']='PASS'
print(json.dumps(checks,ensure_ascii=False,indent=2))
