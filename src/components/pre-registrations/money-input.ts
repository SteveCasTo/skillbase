/** Admission only, including incomplete typing states. Domain parses final cents. */
export function acceptsMoneyEdit(value: string): boolean {
  return /^\d{0,10}(?:[.,]\d{0,2})?$/u.test(value);
}
export function bindMoneyInput(input: HTMLInputElement) {
  let previous = input.value;
  input.addEventListener("input", () => {
    if (acceptsMoneyEdit(input.value)) previous = input.value;
    else input.value = previous;
  });
}
