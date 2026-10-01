import PdfReader from "../features/pdf/PdfReader";
import type { LibraryItem, LibraryRepository } from "../features/library/library.types";
import { usePdfController } from "./usePdfController";
import { useAnnotationController } from "./useAnnotationController";

export default function ReadingWorkspace({ item, scope, repository, onClose, onDetails }: {
  item: LibraryItem; scope: string; repository: LibraryRepository; onClose: () => void; onDetails: () => void;
}) {
  const reader = usePdfController(item, scope, repository);
  const annotations = useAnnotationController(item, scope, repository);
  return <PdfReader item={item} reader={reader} annotations={annotations} onClose={onClose} onDetails={onDetails} />;
}
