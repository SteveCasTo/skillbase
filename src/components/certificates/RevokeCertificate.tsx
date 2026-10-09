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
import { confirmationFooterClassName } from "@/components/ui/confirmation-footer";
import { notifications } from "@/lib/notifications";

interface Props {
  path: string;
  revision: number;
  requestKey: string;
  initialReason?: string | undefined;
  initialError?: string;
}
export default function RevokeCertificate({
  path,
  revision,
  requestKey,
  initialReason = "",
  initialError = "",
}: Props) {
  const enhanced = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(Boolean(initialError));
  const [reason, setReason] = useState(initialReason);
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const key = useRef(requestKey);
  const alert = useRef<HTMLParagraphElement>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lock.current || !event.currentTarget.reportValidity()) return;
    const body = new FormData(event.currentTarget);
    key.current ||= crypto.randomUUID();
    body.set("requestKey", key.current);
    lock.current = true;
    setPending(true);
    setError("");
    notifications.loading({ id: key.current, title: "Revocando certificado…" });
    try {
      const response = await fetch(`${path}?operation=revoke`, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new URLSearchParams(
          [...body].flatMap(([name, value]) =>
            typeof value === "string" ? [[name, value]] : [],
          ),
        ),
        credentials: "same-origin",
      });
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("ok" in result))
        throw new Error("Invalid response");
      if (response.ok && result.ok === true) {
        notifications.success({
          id: key.current,
          title: "Certificado revocado.",
        });
        setOpen(false);
        await navigate(path, { history: "replace" });
      } else {
        notifications.dismiss(key.current);
        setError(
          "message" in result && typeof result.message === "string"
            ? result.message
            : "No se pudo confirmar la revocación.",
        );
        alert.current?.focus();
        if (response.status === 409) key.current = "";
      }
    } catch {
      notifications.dismiss(key.current);
      setError(
        "No se pudo confirmar la revocación. Reintenta la misma solicitud.",
      );
      alert.current?.focus();
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  const form = (
    <form
      method="post"
      action={`${path}?operation=revoke`}
      onSubmit={submit}
      aria-busy={pending}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="requestKey" value={requestKey} />
      <label htmlFor="revocation-reason" className="text-sm font-medium">
        Motivo de revocación (obligatorio)
      </label>
      <textarea
        id="revocation-reason"
        name="reason"
        required
        maxLength={500}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        disabled={pending}
        aria-describedby="revocation-error"
        className="bg-background focus-visible:outline-ring min-h-24 w-full rounded-lg border px-3 py-2 text-sm focus-visible:outline-2"
      />
      <p
        id="revocation-error"
        ref={alert}
        role="alert"
        tabIndex={-1}
        className="text-destructive text-sm empty:hidden"
      >
        {error}
      </p>
      <div className={confirmationFooterClassName}>
        {enhanced ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Volver
          </Button>
        ) : (
          <a
            href={path}
            className="inline-flex min-h-11 items-center justify-center underline"
          >
            Volver
          </a>
        )}
        <Button
          type="submit"
          variant="destructive"
          disabled={pending || (enhanced && !reason.trim())}
        >
          {pending ? "Revocando…" : "Revocar"}
        </Button>
      </div>
    </form>
  );
  if (!enhanced)
    return (
      <details className="rounded-xl border p-4">
        <summary className="min-h-11 cursor-pointer font-medium">
          Revocar certificado
        </summary>
        <p className="my-3 text-sm">
          La credencial dejará de ser válida. Se conservan el documento y su
          historial.
        </p>
        {form}
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
        <Button variant="outline" className="min-h-11">
          Revocar certificado
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Revocar certificado</DialogTitle>
          <DialogDescription>
            La credencial dejará de ser válida. Se conservan el documento y su
            historial.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter layout="content">{form}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
