# Mobile PDF fixtures

`fixtures.mjs` creates original PDFs in memory for mobile browser acceptance tests. Pages contain searchable Helvetica text, page 3 contains only a grayscale bitmap, and the outline jumps to page 2. The page count can be increased to verify that rendering stays bounded. No external publication or network resource is needed.
