import { parseMoneyInput } from "./presentation";
/** Admission only, including incomplete typing states. Domain parses exact cents. */
export function acceptsMoneyEdit(value: string, maxCents?: number): boolean {
  if (!/^\d{0,10}(?:[.,]\d{0,2})?$/u.test(value)) return false;
  if (maxCents === undefined || !value) return true;
  const [whole, fraction] = value.replace(",", ".").split(".");
  try {
    return parseMoneyInput(`${whole || "0"}.${fraction || "0"}`) <= maxCents;
  } catch {
    return false;
  }
}
export function bindMoneyInput(input: HTMLInputElement) {
  if (input.dataset.moneyBound) return;
  input.dataset.moneyBound = "true";
  let previous = input.value;
  let caret = input.selectionStart;
  const max = () =>
    input.dataset.moneyMax ? Number(input.dataset.moneyMax) : undefined;
  input.addEventListener("beforeinput", (event) => {
    previous = input.value;
    caret = input.selectionStart;
    if (
      event.isComposing ||
      event.data === null ||
      !event.inputType.startsWith("insert")
    )
      return;
    const next =
      input.value.slice(0, input.selectionStart ?? 0) +
      event.data +
      input.value.slice(input.selectionEnd ?? 0);
    if (!acceptsMoneyEdit(next, max())) event.preventDefault();
  });
  input.addEventListener("compositionstart", () => {
    previous = input.value;
    caret = input.selectionStart;
  });
  const accept = () => {
    // Deletion must remain possible even after the selected tariff lowered the max.
    if (
      acceptsMoneyEdit(input.value, max()) ||
      (input.value.length < previous.length && acceptsMoneyEdit(input.value))
    )
      previous = input.value;
    else {
      input.value = previous;
      input.setSelectionRange(caret, caret);
    }
  };
  input.addEventListener("input", (event) => {
    if (!(event instanceof InputEvent) || !event.isComposing) accept();
  });
  input.addEventListener("compositionend", accept);
}
