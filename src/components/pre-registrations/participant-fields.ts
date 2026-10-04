export const participantFields = [
  { name: "ci", label: "CI", type: "text", max: 80, autocomplete: "off" },
  {
    name: "firstName",
    label: "Nombre",
    type: "text",
    max: 100,
    autocomplete: "given-name",
  },
  {
    name: "lastName",
    label: "Apellidos",
    type: "text",
    max: 150,
    autocomplete: "family-name",
  },
  {
    name: "email",
    label: "Correo electrónico",
    type: "email",
    max: 254,
    autocomplete: "email",
  },
  {
    name: "phone",
    label: "Teléfono (opcional)",
    type: "tel",
    max: 32,
    autocomplete: "tel",
  },
] as const;

/** Admission helper only; authoritative phone/CI validation remains in domain. */
export function acceptsPhoneEdit(value: string) {
  return /^\+?[\d\s()-]*$/u.test(value);
}
export function bindPhoneInputs(root: ParentNode = document) {
  root
    .querySelectorAll<HTMLInputElement>('input[type="tel"]')
    .forEach((input) => {
      if (input.dataset.phoneBound) return;
      input.dataset.phoneBound = "true";
      let previous = input.value;
      let caret = input.selectionStart;
      const accept = () => {
        if (acceptsPhoneEdit(input.value)) previous = input.value;
        else {
          input.value = previous;
          input.setSelectionRange(caret, caret);
        }
      };
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
        if (!acceptsPhoneEdit(next)) event.preventDefault();
      });
      input.addEventListener("input", (event) => {
        if (!(event instanceof InputEvent) || !event.isComposing) accept();
      });
      input.addEventListener("compositionend", accept);
      input.addEventListener("compositionstart", () => {
        previous = input.value;
        caret = input.selectionStart;
      });
    });
}
