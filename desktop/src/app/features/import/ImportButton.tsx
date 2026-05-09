type ImportButtonProps = {
  onImport: () => void;
};

export function ImportButton({ onImport }: ImportButtonProps) {
  return (
    <button className="library-button" type="button" onClick={onImport}>
      导入文献
    </button>
  );
}
