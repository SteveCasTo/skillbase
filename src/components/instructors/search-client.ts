import { normalizeRegistrationSearch } from "@/domain/pre-registrations/search";

/** The authorized SSR list is complete; typing needs no extra private request. */
export function bindInstructorSearch(root: ParentNode) {
  const form = root.querySelector<HTMLFormElement>("[data-instructor-search]");
  const input = form?.querySelector<HTMLInputElement>('input[name="search"]');
  const results = root.querySelector<HTMLElement>(
    "[data-instructor-search-results]",
  );
  const empty = root.querySelector<HTMLElement>(
    "[data-instructor-search-empty]",
  );
  if (!form || !input || !results || !empty) return () => {};

  const entries = [
    ...results.querySelectorAll<HTMLElement>("[data-instructor-search-entry]"),
  ];
  const controller = new AbortController();
  const apply = (updateUrl: boolean) => {
    const query = normalizeRegistrationSearch(input.value);
    let count = 0;
    for (const entry of entries) {
      entry.hidden = !entry.dataset.instructorSearchEntry?.includes(query);
      if (!entry.hidden) count++;
    }
    results.hidden = count === 0;
    empty.hidden = count > 0;
    if (updateUrl) {
      const url = new URL(window.location.href);
      if (query) url.searchParams.set("search", input.value);
      else url.searchParams.delete("search");
      window.history.replaceState(window.history.state, "", url);
    }
  };
  input.addEventListener("input", () => apply(true), {
    signal: controller.signal,
  });
  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      apply(true);
    },
    { signal: controller.signal },
  );
  window.addEventListener(
    "popstate",
    () => {
      input.value =
        new URL(window.location.href).searchParams.get("search") ?? "";
      apply(false);
    },
    { signal: controller.signal },
  );
  apply(false);
  form.dataset.bound = "true";
  return () => {
    controller.abort();
    delete form.dataset.bound;
  };
}
