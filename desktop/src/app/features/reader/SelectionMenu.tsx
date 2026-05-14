type SelectionMenuProps = {
  visible: boolean;
  x: number;
  y: number;
  hasExistingHighlight: boolean;
  onHighlight: () => void;
  onRemoveHighlight: () => void;
  onAnnotate: () => void;
  onCopy: () => void;
};

export function SelectionMenu({ visible, x, y, hasExistingHighlight, onHighlight, onRemoveHighlight, onAnnotate, onCopy }: SelectionMenuProps) {
  if (!visible) return null;

  return (
    <div className="selection-menu" style={{ left: x, top: y - 40 }}>
      {hasExistingHighlight
        ? <button className="selection-menu-btn" onClick={onRemoveHighlight}>✕ 取消高亮</button>
        : <button className="selection-menu-btn" onClick={onHighlight}>🖍 高亮</button>
      }
      <button className="selection-menu-btn" onClick={onAnnotate}>📝 批注</button>
      <button className="selection-menu-btn" onClick={onCopy}>📋 复制</button>
    </div>
  );
}
