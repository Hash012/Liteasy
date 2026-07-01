export type PaneLayout = {
  center: number;
  left: number;
  right: number;
};

export type PaneCollapseState = {
  bottom: boolean;
  left: boolean;
  right: boolean;
};

export const defaultPaneLayout: PaneLayout = {
  center: 52,
  left: 24,
  right: 24
};

export const defaultPaneCollapseState: PaneCollapseState = {
  bottom: false,
  left: false,
  right: false
};
