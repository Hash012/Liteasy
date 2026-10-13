import { createContext } from "react";

/** Authoring previews render data without the workspace's read/write/network capabilities. */
export const VisualPreviewContext = createContext(false);
