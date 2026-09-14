import { createContext, useContext } from "react";
import type { HelpPort } from "./help.types";

export const HelpContext = createContext<HelpPort | null>(null);
export const useHelp = () => useContext(HelpContext);
