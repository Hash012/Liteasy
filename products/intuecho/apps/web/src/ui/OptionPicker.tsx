import { Dropdown, Option } from "@fluentui/react-components";

export type PickerOption = { value: string; label: string; disabled?: boolean };
export function OptionPicker({ value, onValueChange, options, label, disabled = false }: {
  value: string; onValueChange: (value: string) => void; options: PickerOption[]; label: string; disabled?: boolean;
}) {
  return <Dropdown aria-label={label} disabled={disabled} className="community-option-picker" selectedOptions={[value]}
    value={options.find((option) => option.value === value)?.label ?? value}
    onOptionSelect={(_, data) => { if (data.optionValue !== undefined) onValueChange(data.optionValue); }}>
    {options.map((option) => <Option key={option.value} value={option.value} text={option.label} disabled={option.disabled}>{option.label}</Option>)}
  </Dropdown>;
}
