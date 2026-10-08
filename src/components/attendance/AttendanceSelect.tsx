import { useEffect, useRef, useState, type ComponentProps } from "react";
import RegistrationSelect from "@/components/pre-registrations/RegistrationSelect";

/** A cancelled attendance edit resets both the HTML control and hydrated select. */
export default function AttendanceSelect(
  props: ComponentProps<typeof RegistrationSelect>,
) {
  const root = useRef<HTMLDivElement>(null);
  const [reset, setReset] = useState(0);
  const [value, setValue] = useState(props.value);
  useEffect(() => {
    const form = root.current?.closest("form");
    const restore = () => {
      const baseline = JSON.parse(form?.dataset.baseline ?? "{}") as Record<
        string,
        string
      >;
      setValue(baseline[props.name] ?? "");
      setReset((current) => current + 1);
    };
    form?.addEventListener("attendance:reset", restore);
    return () => form?.removeEventListener("attendance:reset", restore);
  }, [props.name]);
  return (
    <div ref={root}>
      <RegistrationSelect
        key={reset}
        {...props}
        value={value}
        error={reset ? undefined : props.error}
      />
    </div>
  );
}
