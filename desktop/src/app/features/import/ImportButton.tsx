type ImportButtonProps = {
  onImport: () => void;
  disabled?: boolean;
};

export function ImportButton({ onImport, disabled }: ImportButtonProps) {
  return (
    <button className="library-button" type="button" onClick={onImport} disabled={disabled}>
      导入文献
    </button>
  );
}
