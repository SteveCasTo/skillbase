import { useEffect, useSyncExternalStore } from "react";
import { AlertDialog } from "radix-ui";
import { Button } from "@/components/ui/button";
interface Props {
  formId: string;
  description: string;
}
export default function CancellationConfirmation({
  formId,
  description,
}: Props) {
  const enhanced = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const disabled = useSyncExternalStore(
    (notify) => {
      const form = document.getElementById(formId);
      form?.addEventListener("input", notify);
      form?.addEventListener("registration:updated", notify);
      return () => {
        form?.removeEventListener("input", notify);
        form?.removeEventListener("registration:updated", notify);
      };
    },
    () => {
      const form = document.getElementById(formId);
      if (!(form instanceof HTMLFormElement)) return true;
      const reason = form.elements.namedItem("reason");
      return (
        Boolean(form.dataset.pending) ||
        !(reason instanceof HTMLInputElement) ||
        !reason.value.trim() ||
        !reason.validity.valid
      );
    },
    () => false,
  );
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    form.noValidate = true;
  }, [formId]);
  return (
    <div className="flex flex-col gap-4">
      {!enhanced ? (
        <>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              required
              name="confirmed"
              value="true"
              className="accent-primary mt-1 size-5"
            />
            Confirmo la cancelación. {description}
          </label>
          <Button type="submit" variant="destructive">
            Cancelar preinscripción
          </Button>
        </>
      ) : (
        <AlertDialog.Root>
          <AlertDialog.Trigger asChild>
            <Button
              type="button"
              variant="destructive"
              disabled={disabled}
              data-cancel-trigger
            >
              Cancelar preinscripción
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="bg-foreground/40 fixed inset-0" />
            <AlertDialog.Content className="bg-background fixed top-1/2 left-1/2 flex w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-xl border p-6 shadow-lg">
              <AlertDialog.Title className="text-lg font-semibold">
                ¿Cancelar esta preinscripción?
              </AlertDialog.Title>
              <AlertDialog.Description className="text-muted-foreground text-sm">
                {description}
              </AlertDialog.Description>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <AlertDialog.Cancel asChild>
                  <Button type="button" variant="outline">
                    Conservar
                  </Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      const form = document.getElementById(formId);
                      if (form instanceof HTMLFormElement) form.requestSubmit();
                    }}
                  >
                    Confirmar cancelación
                  </Button>
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
    </div>
  );
}
