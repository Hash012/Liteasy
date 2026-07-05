export type PaneLayout = {
  bottom: number;
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
  bottom: 32,
  center: 52,
  left: 24,
  right: 24
};

export const defaultPaneCollapseState: PaneCollapseState = {
  bottom: true,
  left: false,
  right: false
};
