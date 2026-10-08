import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { navigate } from "astro:transitions/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { notifications } from "@/lib/notifications";

interface Props {
  path: string;
  revision: string;
  requestKey: string;
  canClose: boolean;
  canReopen: boolean;
  initialReason: string;
  reasonError?: string | undefined;
}
export function ClosureActions({
  path,
  revision,
  requestKey,
  canClose,
  canReopen,
  initialReason,
  reasonError,
}: Props) {
  const enhanced = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(initialReason);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (busy.current || !form.reportValidity()) return;
    const formData = new FormData(form);
    busy.current = true;
    setPending(true);
    setError("");
    notifications.loading({ id: requestKey, title: "Confirmando operación…" });
    try {
      await navigate(form.action, {
        formData,
        sourceElement: form,
        history: "replace",
      });
      const outcome = document.querySelector<HTMLElement>(
        "[data-closure-outcome]",
      );
      if (outcome?.dataset.closureOutcome === "success") {
        notifications.success({
          id: requestKey,
          title: outcome.dataset.message ?? "Operación registrada.",
        });
        document
          .getElementById("closure-state")
          ?.focus({ preventScroll: true });
      } else {
        notifications.dismiss(requestKey);
        const reasonField = document.getElementById("closure-reason");
        if (reasonField?.getAttribute("aria-invalid") === "true")
          reasonField.focus({ preventScroll: true });
        else
          document
            .getElementById("closure-error")
            ?.focus({ preventScroll: true });
      }
    } catch {
      notifications.dismiss(requestKey);
      setError(
        "No se pudo confirmar la operación. Reintenta la misma solicitud.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const hidden = (
    <>
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="requestKey" value={requestKey} />
    </>
  );
  const closeForm = (
    <form
      method="post"
      encType="application/x-www-form-urlencoded"
      action={`${path}?operation=close`}
      onSubmit={submit}
      aria-busy={pending}
      className="flex flex-col gap-4"
    >
      {hidden}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {enhanced ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
        ) : (
          <a
            href={path}
            className="inline-flex min-h-11 items-center justify-center underline underline-offset-4"
          >
            Cancelar
          </a>
        )}
        <Button type="submit" className="min-h-11" disabled={pending}>
          {pending ? "Confirmando…" : "Confirmar cierre"}
        </Button>
      </div>
    </form>
  );
  if (canReopen)
    return (
      <details
        className="bg-card w-full max-w-lg rounded-xl border p-4"
        open={Boolean(reasonError)}
      >
        <summary className="focus-visible:outline-ring min-h-11 cursor-pointer font-medium focus-visible:outline-2">
          Reabrir grupo
        </summary>
        <form
          method="post"
          encType="application/x-www-form-urlencoded"
          action={`${path}?operation=reopen`}
          onSubmit={submit}
          aria-busy={pending}
          className="mt-3 flex flex-col gap-3"
        >
          {hidden}
          <p className="text-muted-foreground text-sm">
            Permite corregir notas y asistencia. Los componentes y pesos siguen
            congelados.
          </p>
          <label htmlFor="closure-reason" className="text-sm font-medium">
            Motivo de reapertura (obligatorio)
          </label>
          <textarea
            id="closure-reason"
            name="reason"
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            aria-invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? "closure-reason-error" : undefined}
            className="bg-background focus-visible:outline-ring min-h-24 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-2"
          />
          {reasonError && (
            <p
              id="closure-reason-error"
              role="alert"
              className="text-destructive text-sm"
            >
              {reasonError}
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="outline"
            className="min-h-11 self-start"
            disabled={pending || (enhanced && !reason.trim())}
          >
            {pending ? "Confirmando…" : "Confirmar reapertura"}
          </Button>
        </form>
      </details>
    );
  if (!canClose) return null;
  if (!enhanced)
    return (
      <details className="bg-card rounded-xl border p-4">
        <summary className="min-h-11 cursor-pointer font-medium">
          Cerrar grupo
        </summary>
        <p className="my-3 text-sm">
          Se conservará una versión oficial y se bloquearán cambios de notas,
          asistencia y altas en este grupo. No archiva el curso.
        </p>
        {closeForm}
      </details>
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button className="min-h-11">Cerrar grupo</Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => {
          if (pending) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Cerrar grupo</DialogTitle>
          <DialogDescription>
            Se conservará una versión oficial y se bloquearán cambios de notas,
            asistencia y altas en este grupo. No archiva el curso.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="block">{closeForm}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
