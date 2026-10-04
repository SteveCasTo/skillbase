import type { ParticipantDto } from "@/domain/pre-registrations/types";
import type { AdminInterestRegistrationDto } from "@/domain/interests/types";
import { createLatestSearch } from "./request-state";

/** Supplied by the future authorized route adapter; never guesses a URL. */
export function bindParticipantLookup(
  root: HTMLElement,
  adapter: {
    load: (
      query: string,
      signal: AbortSignal,
    ) => Promise<{
      participants: readonly ParticipantDto[];
      interests: readonly AdminInterestRegistrationDto[];
    }>;
    onResults: (result: {
      participants: readonly ParticipantDto[];
      interests: readonly AdminInterestRegistrationDto[];
    }) => void;
  },
) {
  const search = createLatestSearch<Awaited<ReturnType<typeof adapter.load>>>();
  const input = root.querySelector<HTMLInputElement>('input[name="search"]');
  const loading = root.querySelector<HTMLElement>("[data-search-loading]");
  const results = root.querySelector<HTMLElement>("[data-search-results]");
  const error = root.querySelector<HTMLElement>("[data-search-error]");
  let generation = 0;
  const pending = (value: boolean) => {
    root.setAttribute("aria-busy", String(value));
    if (loading) loading.hidden = !value;
    if (results) results.hidden = value;
  };
  const run = async () => {
    const token = ++generation;
    const query = input?.value.trim() ?? "";
    search.cancel();
    if (error) error.textContent = "";
    if (query.length < 2 || query.length > 100) {
      pending(false);
      adapter.onResults({ participants: [], interests: [] });
      return;
    }
    pending(true);
    // Remove old private results before starting another authorized lookup.
    adapter.onResults({ participants: [], interests: [] });
    try {
      const result = await search.run(query, adapter.load);
      if (result && token === generation)
        adapter.onResults({
          participants: result.participants.slice(0, 30),
          interests: result.interests.slice(0, 30),
        });
    } catch {
      if (token === generation && error)
        error.textContent =
          "No se pudo buscar. Reintenta o completa los datos directamente.";
    } finally {
      if (token === generation) pending(false);
    }
  };
  input?.addEventListener("input", run);
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    void run();
  };
  const form = root.querySelector<HTMLFormElement>("[data-search-form]");
  form?.addEventListener("submit", submit);
  return () => {
    ++generation;
    search.cancel();
    input?.removeEventListener("input", run);
    form?.removeEventListener("submit", submit);
  };
}
