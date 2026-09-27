import { useEffect, useState } from "react";

function currentPixelRatio() {
  const ratio = window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/** Monitor moves can change raster density without changing the reader's CSS width. */
export function usePdfPixelRatio() {
  const [ratio, setRatio] = useState(currentPixelRatio);
  useEffect(() => {
    let media: MediaQueryList | undefined;
    function update() {
      media?.removeEventListener("change", update);
      const next = currentPixelRatio();
      setRatio(next);
      media = window.matchMedia?.(`(resolution: ${next}dppx)`);
      media?.addEventListener("change", update);
    }
    update();
    window.addEventListener("resize", update);
    return () => {
      media?.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return ratio;
}
