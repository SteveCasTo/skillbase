import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Select } from "radix-ui";

interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  name: string;
  label: string;
  value: string;
  options: readonly Option[];
  placeholder: string;
  disabled?: boolean;
  error?: string;
}

/** A form-associated Radix Select, scoped to the course editor island. */
export default function CourseSelect({
  name,
  label,
  value,
  options,
  placeholder,
  disabled,
  error,
}: Props) {
  const [selectedValue, setSelectedValue] = useState(value);

  return (
    <div
      className="flex min-w-0 flex-col gap-2 text-sm font-medium"
      data-invalid={Boolean(error)}
    >
      <label id={`${name}-label`} htmlFor={`${name}-select`}>
        {label}
      </label>
      <Select.Root
        name={name}
        value={selectedValue}
        onValueChange={setSelectedValue}
        disabled={disabled ?? false}
        required
      >
        <Select.Trigger
          id={`${name}-select`}
          aria-labelledby={`${name}-label`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
          className="bg-background focus-visible:ring-ring flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm shadow-xs outline-none focus-visible:ring-2 disabled:opacity-60"
        >
          <Select.Value placeholder={placeholder} />
          <Select.Icon>
            <ChevronDown size={16} aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            className="bg-popover text-popover-foreground z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-auto rounded-lg border p-1 shadow-md"
          >
            <Select.Viewport>
              <Select.Group>
                {options.map((option) => (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled ?? false}
                    className="focus:bg-accent focus:text-accent-foreground relative flex min-h-10 cursor-pointer items-center rounded-md py-2 pr-8 pl-3 text-sm outline-none data-[disabled]:opacity-50"
                  >
                    <Select.ItemText>{option.label}</Select.ItemText>
                    <Select.ItemIndicator className="absolute right-2">
                      <Check size={16} aria-hidden="true" />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Group>
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {error && (
        <span id={`${name}-error`} className="text-destructive text-sm">
          {error}
        </span>
      )}
    </div>
  );
}
