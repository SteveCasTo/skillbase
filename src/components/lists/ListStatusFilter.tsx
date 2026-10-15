import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { buttonVariants } from "@/components/ui/button";
import type { ListFilterOption } from "./filters";

interface Props {
  value: string;
  options: readonly ListFilterOption[];
  label?: string;
}
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** Only the accessible picker hydrates; authorization and initial results remain SSR. */
export default function ListStatusFilter({
  value,
  options,
  label = "Filtrar por estado",
}: Props) {
  const [selected, setSelected] = useState(value);
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const trigger = useRef<HTMLButtonElement>(null);
  const statusInput = () =>
    trigger.current
      ?.closest("form")
      ?.querySelector<HTMLInputElement>("input[data-list-status]");
  useEffect(() => {
    const element = trigger.current
      ?.closest("form")
      ?.querySelector<HTMLInputElement>("input[data-list-status]");
    const sync = () => setSelected(element?.value ?? value);
    sync();
    element?.addEventListener("list-status-sync", sync);
    return () => element?.removeEventListener("list-status-sync", sync);
  }, [value]);
  return (
    <Select
      disabled={!ready}
      value={selected}
      onValueChange={(next) => {
        setSelected(next);
        const input = statusInput();
        if (input) {
          input.value = next;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }}
    >
      <SelectTrigger
        ref={trigger}
        aria-label={`${label}: ${options.find((option) => option.value === selected)?.label}`}
        className={buttonVariants({
          variant: "outline",
          className: "min-h-11 w-auto rounded-full",
        })}
      >
        <Filter aria-hidden="true" data-icon="inline-start" />
        <span>
          {options.find((option) => option.value === selected)?.label}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
