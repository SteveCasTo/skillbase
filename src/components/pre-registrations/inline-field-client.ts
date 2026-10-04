export function initializeInlineFields() {
  document
    .querySelectorAll<HTMLElement>("[data-inline-field]")
    .forEach((root) => {
      if (root.dataset.bound) return;
      root.dataset.bound = "true";
      const form = root.closest("form");
      const display = root.querySelector<HTMLElement>("[data-inline-display]");
      const editor = root.querySelector<HTMLElement>("[data-inline-editor]");
      const input = root.querySelector<HTMLInputElement>(
        "input:not([type=hidden])",
      );
      const edit = root.querySelector<HTMLButtonElement>("[data-inline-edit]");
      const cancel = root.querySelector<HTMLButtonElement>(
        "[data-inline-cancel]",
      );
      if (form && input) {
        const baseline = JSON.parse(
          form.dataset.participantBaseline ?? form.dataset.baseline ?? "{}",
        ) as Record<string, string | number | null>;
        if (input.name in baseline) {
          const attempted = input.value;
          input.defaultValue = String(baseline[input.name] ?? "");
          input.value = attempted;
        }
      }
      const change = (open: boolean) => {
        if (display) display.hidden = open;
        if (editor) editor.hidden = !open;
        root.dataset.editing = String(open);
        if (open) input?.focus();
        else edit?.focus();
      };
      if (display) display.hidden = false;
      if (cancel) cancel.hidden = false;
      // Retain recoverable SSR errors and attempted input in its editor.
      const invalid =
        Boolean(form?.querySelector('[aria-invalid="true"]')) ||
        Boolean(
          form?.dataset.lastSubmitted &&
          input &&
          input.value !== input.defaultValue,
        );
      if (editor) editor.hidden = !invalid;
      if (display) display.hidden = invalid;
      root.dataset.editing = String(invalid);
      edit?.addEventListener("click", () => change(true));
      cancel?.addEventListener("click", () => {
        if (form?.dataset.pending) return;
        if (input) {
          input.value = input.defaultValue;
          input.setAttribute("aria-invalid", "false");
        }
        form
          ?.querySelectorAll<HTMLElement>(
            "[data-field-error], [data-form-error]",
          )
          .forEach((node) => {
            node.textContent = "";
          });
        change(false);
        form?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      form?.addEventListener("registration:saved", () => change(false));
    });
}
initializeInlineFields();
document.addEventListener("astro:page-load", initializeInlineFields);
