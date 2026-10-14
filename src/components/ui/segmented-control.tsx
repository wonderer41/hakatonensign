import { cx } from "./cx";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name of the group, e.g. "Library". */
  label: string;
  options: readonly [SegmentedOption<T>, SegmentedOption<T>];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Two buttons sharing a border (Temp | Permanent). The pressed one is #D8E2DC with pond text and
 * aria-pressed="true". 36px tall as designed; the hit area is stretched to 44px in CSS.
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange, disabled, className }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className={cx("segmented", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__option"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => {
            if (option.value !== value) onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
