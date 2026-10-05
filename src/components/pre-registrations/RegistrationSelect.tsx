import { useEffect, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  id: string;
  name: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  error?: string | undefined;
  required?: boolean;
  placeholder?: string;
}
/** HTML select stays usable until hydration, including when JS fails. */
export default function RegistrationSelect({
  id,
  name,
  label,
  value,
  options,
  error,
  required = true,
  placeholder = "Selecciona una opción",
}: Props) {
  const [enhanced, setEnhanced] = useState(false);
  const [selected, setSelected] = useState(value);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const fallback = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    setSelected(fallback.current?.value ?? value);
    setEnhanced(true);
  }, [value]);
  const change = (next: string) => {
    if (next === "__registration_all__") next = "";
    setSelected(next);
    if (fallback.current) {
      fallback.current.value = next;
      fallback.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-2" data-invalid={Boolean(error)}>
      <label
        id={`${id}-label`}
        htmlFor={enhanced ? `${id}-trigger` : id}
        className="text-sm font-medium"
      >
        {label}
      </label>
      <select
        ref={fallback}
        id={id}
        name={name}
        defaultValue={value}
        required={required}
        hidden={enhanced}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-error`}
        className="border-input bg-background focus-visible:ring-ring min-h-11 w-full rounded-md border px-3 outline-none focus-visible:ring-2"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      {enhanced && (
        <Select value={selected} onValueChange={change}>
          <SelectTrigger
            id={`${id}-trigger`}
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-error`}
            aria-invalid={Boolean(error)}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent container={portalContainer}>
            <SelectGroup>
              {!required && (
                <SelectItem value="__registration_all__">
                  {placeholder}
                </SelectItem>
              )}
              {options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled ?? false}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
      <p
        id={`${id}-error`}
        data-field-error={name}
        className="text-destructive text-sm empty:hidden"
      >
        {error}
      </p>
      <div ref={setPortalContainer} className="contents" />
    </div>
  );
}
