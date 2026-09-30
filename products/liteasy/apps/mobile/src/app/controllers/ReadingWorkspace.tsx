import PdfReader from "../features/pdf/PdfReader";
import type { LibraryItem, LibraryRepository } from "../features/library/library.types";
import { usePdfController } from "./usePdfController";

export default function ReadingWorkspace({ item, scope, repository, onClose, onDetails }: {
  item: LibraryItem; scope: string; repository: LibraryRepository; onClose: () => void; onDetails: () => void;
}) {
  const reader = usePdfController(item, scope, repository);
  return <PdfReader item={item} reader={reader} onClose={onClose} onDetails={onDetails} />;
}
