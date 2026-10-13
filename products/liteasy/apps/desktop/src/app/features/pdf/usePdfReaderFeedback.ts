import { useCallback, useEffect, useRef, useState } from "react";

/** Navigation announcements expire independently of persistent progress and errors. */
export function usePdfReaderFeedback() {
  const [status, setPersistentStatus] = useState("");
  const [announcement, setAnnouncement] = useState({ text: "", sequence: 0 });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const cancelAnnouncement = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setAnnouncement((current) => ({ ...current, text: "" }));
  }, []);
  const setStatus = useCallback((message: string) => {
    cancelAnnouncement();
    setPersistentStatus(message);
  }, [cancelAnnouncement]);
  const announceNavigation = useCallback((message: string) => {
    clearTimeout(timer.current);
    setAnnouncement((current) => ({ text: message, sequence: current.sequence + 1 }));
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setAnnouncement((current) => ({ ...current, text: "" }));
    }, 2000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { status, setStatus, announcement, announceNavigation };
}
