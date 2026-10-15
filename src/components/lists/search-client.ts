import { normalizeRegistrationSearch } from "@/domain/pre-registrations/search";
import {
  matchesListFilter,
  selectedListFilter,
  type ListFilterOption,
} from "./filters";

/** Filter only the complete, authorized server list; no new private requests. */
export function bindListSearch(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>("[data-list-search]");
  const input = form?.querySelector<HTMLInputElement>('input[name="search"]');
  const status = form?.querySelector<HTMLInputElement>("[data-list-status]");
  const results = root.querySelector<HTMLElement>("[data-list-results]");
  const empty = root.querySelector<HTMLElement>("[data-list-empty]");
  if (!form || !input) return () => {};
  const options: readonly ListFilterOption[] = JSON.parse(
    form.querySelector<HTMLElement>("[data-list-filter-options]")?.dataset
      .listFilterOptions ?? "[]",
  );
  const entries = [
    ...(results?.querySelectorAll<HTMLElement>("[data-list-entry]") ?? []),
  ];
  const controller = new AbortController();
  const defaultStatus = form.dataset.listDefaultStatus ?? "ALL";
  const apply = (updateUrl: boolean) => {
    const query = normalizeRegistrationSearch(input.value);
    const selected = status?.value ?? "ALL";
    let count = 0;
    for (const entry of entries) {
      entry.hidden =
        !entry.dataset.listEntry?.includes(query) ||
        !matchesListFilter(entry.dataset.listStatus ?? "", selected);
      if (!entry.hidden) count++;
    }
    if (results) results.hidden = count === 0;
    if (empty) empty.hidden = count > 0;
    const message = empty?.querySelector<HTMLElement>(
      "[data-list-empty-message]",
    );
    if (message)
      message.textContent = query
        ? options.length
          ? "No hay resultados que coincidan. Prueba otra búsqueda o cambia el filtro."
          : "No hay resultados que coincidan. Prueba otra búsqueda."
        : `No hay ${root.dataset.searchList} en «${options.find((option) => option.value === selected)?.label ?? "Todos"}».`;
    const countMessage = root.querySelector<HTMLElement>("[data-list-count]");
    if (countMessage) countMessage.textContent = `${count} resultados.`;
    if (updateUrl) {
      const url = new URL(window.location.href);
      if (query) url.searchParams.set("search", input.value);
      else url.searchParams.delete("search");
      if (options.length) url.searchParams.set("status", selected);
      window.history.replaceState(window.history.state, "", url);
    }
  };
  input.addEventListener("input", () => apply(true), {
    signal: controller.signal,
  });
  form.addEventListener("change", () => apply(true), {
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
  const restore = () => {
    const url = new URL(window.location.href);
    input.value = url.searchParams.get("search") ?? "";
    if (status) {
      status.value = selectedListFilter(
        url.searchParams.get("status") ?? defaultStatus,
        options,
      );
      status.dispatchEvent(new Event("list-status-sync"));
    }
    apply(false);
  };
  window.addEventListener("popstate", restore, { signal: controller.signal });
  root.querySelector<HTMLAnchorElement>("[data-list-reset]")?.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      input.value = "";
      if (status) {
        status.value = defaultStatus;
        status.dispatchEvent(new Event("list-status-sync"));
      }
      apply(true);
      input.focus();
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
