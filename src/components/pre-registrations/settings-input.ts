/** Admission of integer drafts, including empty/zero; domain owns final ranges. */
export function acceptsSettingsIntegerEdit(
  value: string,
  max: number,
): boolean {
  return /^\d*$/u.test(value) && (!value || Number(value) <= max);
}

export function initializeSettingsInputs(root: ParentNode = document) {
  root
    .querySelectorAll<HTMLInputElement>("[data-settings-integer]")
    .forEach((input) => {
      if (input.dataset.integerBound) return;
      input.dataset.integerBound = "true";
      let previous = input.value;
      let caret = input.selectionStart;
      const accepts = (value: string) =>
        acceptsSettingsIntegerEdit(value, Number(input.dataset.integerMax));
      const capture = () => {
        previous = input.value;
        caret = input.selectionStart;
      };
      input.addEventListener("beforeinput", (event) => {
        if (event.isComposing) return;
        capture();
        if (event.data === null || !event.inputType.startsWith("insert"))
          return;
        const next =
          input.value.slice(0, input.selectionStart ?? 0) +
          event.data +
          input.value.slice(input.selectionEnd ?? 0);
        if (!accepts(next)) event.preventDefault();
      });
      const accept = () => {
        if (accepts(input.value)) previous = input.value;
        else {
          input.value = previous;
          input.setSelectionRange(caret, caret);
        }
      };
      input.addEventListener("input", (event) => {
        if (!(event instanceof InputEvent) || !event.isComposing) accept();
      });
      input.addEventListener("compositionstart", capture);
      input.addEventListener("compositionend", accept);
    });
}
