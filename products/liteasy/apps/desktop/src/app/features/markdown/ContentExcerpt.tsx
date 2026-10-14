import { ContentView, type ContentViewProps } from "./ContentView";

/** Visual clipping preserves Markdown structure and never becomes an evidence selector. */
export function ContentExcerpt(props: ContentViewProps) {
  return <div className="content-excerpt"><ContentView {...props} mediaPolicy="blocked" /></div>;
}
