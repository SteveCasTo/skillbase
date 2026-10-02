import { useState, useSyncExternalStore } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  required?: boolean;
  minLength?: number;
  error?: string | undefined;
}

export default function PasswordField({
  name,
  label,
  autoComplete,
  required = true,
  minLength,
  error,
}: Props) {
  const [visible, setVisible] = useState(false);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={name}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          maxLength={128}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${name}-error`}
        />
        <Button
          type="button"
          disabled={!hydrated}
          variant="outline"
          size="icon"
          aria-controls={name}
          aria-label={`${visible ? "Ocultar" : "Mostrar"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
      <p
        id={`${name}-error`}
        data-auth-field-error={name}
        className="text-destructive text-sm"
        hidden={!error}
      >
        {error}
      </p>
    </div>
  );
}
