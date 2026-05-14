export type NoteGroup = {
  id: string;
  paperId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
};

export type Note = {
  id: string;
  groupId: string;
  paperId: string;
  selectedText: string;
  noteText: string;
  pageNo: number;
  bbox: string | null;
  color: string;
  createdAt: string;
};
