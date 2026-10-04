import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";

/** Raw decimal BOB. The HTTP adapter must parse it once into CashInput.amountCents. */
export default function MoneyInput(props: ComponentProps<typeof Input>) {
  return <Input {...props} name="amount" type="text" inputMode="decimal" />;
}
