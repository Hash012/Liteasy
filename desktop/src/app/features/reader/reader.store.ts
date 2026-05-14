export type Highlight = {
  id: string;
  pageNo: number;
  bbox: string;        // JSON-serialized rect: {x,y,width,height}
  color: string;
  noteId?: string;
};

export function createReaderStore() {
  let pageNumber = 1;
  let totalPages = 0;
  let scale = 1.2;

  return {
    getPageNumber() { return pageNumber; },
    setPageNumber(n: number) { pageNumber = n; },
    getTotalPages() { return totalPages; },
    setTotalPages(n: number) { totalPages = n; },
    getScale() { return scale; },
    setScale(s: number) { scale = s; },
  };
}
