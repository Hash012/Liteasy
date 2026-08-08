type ImportButtonProps = {
  onImport: () => void | Promise<void>;
  label?: string;
};

export function ImportButton({ onImport, label = "导入文献" }: ImportButtonProps) {
  return (
    <button className="library-button" type="button" onClick={onImport}>
      {label}
    </button>
  );
}
