import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { navigate } from "astro:transitions/client";
import { Button } from "@/components/ui/button";
import { confirmationFooterClassName } from "@/components/ui/confirmation-footer";
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
import { Input } from "@/components/ui/input";

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
  const [open, setOpen] = useState(Boolean(reasonError));
  const [reason, setReason] = useState(initialReason);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (busy.current || !form.reportValidity()) return;
    const formData = new FormData(form);
    busy.current = true;
    setPending(true);
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
        const reasonField = document.getElementById("closure-reason");
        if (reasonField?.getAttribute("aria-invalid") === "true") {
          notifications.dismiss(requestKey);
          reasonField.focus({ preventScroll: true });
        } else {
          const message = document.getElementById("closure-error");
          notifications.error({
            id: requestKey,
            title:
              message?.textContent?.trim() ||
              "No se pudo confirmar la operación. Reintenta la misma solicitud.",
          });
          if (message) message.hidden = true;
        }
      }
    } catch {
      notifications.error({
        id: requestKey,
        title:
          "No se pudo confirmar la operación. Reintenta la misma solicitud.",
      });
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
      <div className={confirmationFooterClassName}>
        {enhanced ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full min-w-0 whitespace-normal"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Volver
          </Button>
        ) : (
          <a
            href={path}
            className="inline-flex min-h-11 items-center justify-center underline underline-offset-4"
          >
            Volver
          </a>
        )}
        <Button
          type="submit"
          className="min-h-11 w-full min-w-0 whitespace-normal"
          disabled={pending}
        >
          {pending ? "Confirmando…" : "Confirmar cierre"}
        </Button>
      </div>
    </form>
  );
  const reopenForm = (
    <form
      method="post"
      encType="application/x-www-form-urlencoded"
      action={`${path}?operation=reopen`}
      onSubmit={submit}
      aria-busy={pending}
      className="flex flex-col gap-3"
    >
      {hidden}
      <label htmlFor="closure-reason" className="text-sm font-medium">
        Motivo de reapertura (opcional)
      </label>
      <Input
        id="closure-reason"
        name="reason"
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={pending}
        aria-invalid={Boolean(reasonError)}
        aria-describedby={reasonError ? "closure-reason-error" : undefined}
        className="min-h-11"
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
      <div className={confirmationFooterClassName}>
        {enhanced ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full min-w-0 whitespace-normal"
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
        <Button
          type="submit"
          className="min-h-11 w-full min-w-0 whitespace-normal"
          disabled={pending}
        >
          {pending ? "Confirmando…" : "Confirmar reapertura"}
        </Button>
      </div>
    </form>
  );
  if (canReopen && !enhanced)
    return (
      <details
        className="bg-card w-full max-w-lg rounded-xl border p-4"
        open={Boolean(reasonError)}
      >
        <summary className="focus-visible:outline-ring mb-3 min-h-11 cursor-pointer font-medium focus-visible:outline-2">
          Reabrir grupo
        </summary>
        {reopenForm}
      </details>
    );
  if (!canClose && !canReopen) return null;
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
        <Button
          className="min-h-11"
          variant={canReopen ? "outline" : "default"}
        >
          {canReopen ? "Reabrir grupo" : "Cerrar grupo"}
        </Button>
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
          <DialogTitle>
            {canReopen ? "Reabrir grupo" : "Cerrar grupo"}
          </DialogTitle>
          <DialogDescription className={canReopen ? "sr-only" : undefined}>
            {canReopen
              ? "Indica un motivo si lo necesitas."
              : "Se conservará una versión oficial y se bloquearán cambios de notas, asistencia y altas en este grupo. No archiva el curso."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter layout="content">
          {canReopen ? reopenForm : closeForm}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
