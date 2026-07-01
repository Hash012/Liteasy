export type PaneLayout = {
  center: number;
  left: number;
  right: number;
};

export type PaneCollapseState = {
  left: boolean;
  right: boolean;
};

export const defaultPaneLayout: PaneLayout = {
  center: 52,
  left: 24,
  right: 24
};

export const defaultPaneCollapseState: PaneCollapseState = {
  left: false,
  right: false
};
