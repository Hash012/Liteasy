import type { AssistantMode } from "./assistant.types";

type ModeSwitchProps = {
  mode: AssistantMode;
  onChange: (mode: AssistantMode) => void;
};

const modes: Array<{ id: AssistantMode; label: string }> = [
  { id: "explain", label: "名词解释" },
  { id: "command", label: "命令" },
  { id: "qa", label: "问答" }
];

export function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  return (
    <div className="mode-switch">
      {modes.map((item) => (
        <button
          className={item.id === mode ? "mode-button active" : "mode-button"}
          key={item.id}
          onClick={() => onChange(item.id)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
