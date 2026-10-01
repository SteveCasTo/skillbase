/** One synchronous lock shared by the editor and its editorial controls. */
export function synchronizeCourseRevision(
  courseId: string,
  revision: string,
): void {
  for (const form of document.querySelectorAll<HTMLFormElement>(
    "form[data-course-mutation-id]",
  )) {
    if (form.dataset.courseMutationId !== courseId) continue;
    form
      .querySelectorAll<HTMLInputElement>('input[name="revision"]')
      .forEach((control) => (control.value = revision));
  }
}

export function acquireCourseMutation(
  form: HTMLFormElement,
): (() => void) | null {
  const editor = document.querySelector<HTMLFormElement>(
    ".course-form[data-course-id]",
  );
  if (!editor) return () => {};
  if (editor.dataset.mutationPending === "true") return null;
  editor.dataset.mutationPending = "true";
  const controls = document.querySelectorAll<HTMLButtonElement>(
    '.course-form .submit-button, [data-confirm-trigger], .mutation-form button[type="submit"], [data-course-dialog-form] button[type="submit"], [data-editorial-retry]',
  );
  const previous = Array.from(
    controls,
    (control) => [control, control.disabled] as const,
  );
  for (const [control] of previous) control.disabled = true;
  form.setAttribute("aria-busy", "true");
  return () => {
    delete editor.dataset.mutationPending;
    form.removeAttribute("aria-busy");
    for (const [control, disabled] of previous) control.disabled = disabled;
    editor.dispatchEvent(new Event("course-form-change"));
  };
}
