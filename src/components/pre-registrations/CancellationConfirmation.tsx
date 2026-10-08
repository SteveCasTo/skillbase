import { useEffect, useSyncExternalStore } from "react";
import { AlertDialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
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
    <div className="flex min-w-0 flex-col gap-4 [&>button]:h-full [&>button]:w-full [&>button]:whitespace-normal">
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
            Anular inscripción
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
              Anular inscripción
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="bg-foreground/40 fixed inset-0 z-50" />
            <AlertDialog.Content className="bg-background fixed top-1/2 left-1/2 z-50 flex w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-xl border p-6">
              <AlertDialog.Title className="text-lg font-semibold">
                ¿Anular esta inscripción?
              </AlertDialog.Title>
              <AlertDialog.Description className="text-muted-foreground text-sm">
                {description} La cancelación no se puede deshacer.
              </AlertDialog.Description>
              <DialogFooter>
                <AlertDialog.Cancel asChild>
                  <Button type="button" variant="outline">
                    Volver
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
                    Anular inscripción
                  </Button>
                </AlertDialog.Action>
              </DialogFooter>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
    </div>
  );
}
