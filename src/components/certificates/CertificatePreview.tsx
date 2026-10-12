import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/private-nav/Skeleton";
import { notifications } from "@/lib/notifications";

function Preview({
  type,
  label,
}: {
  type: "APPROVAL" | "INSTRUCTOR";
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const endpoint = `/app/configuracion/certificados/vista-previa.pdf?type=${type}`;
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    let objectUrl = "";
    const id = `certificate-preview-${crypto.randomUUID()}`;
    notifications.loading({ id, title: "Cargando vista previa…" });
    void (async () => {
      try {
        const response = await fetch(endpoint, {
          credentials: "same-origin",
          cache: "no-store",
          signal: abort.signal,
        });
        if (
          !response.ok ||
          !response.headers.get("Content-Type")?.includes("application/pdf")
        )
          throw new Error(
            "No se pudo cargar la vista previa. Revisa los ajustes o vuelve a intentar.",
          );
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        notifications.dismiss(id);
      } catch (failure) {
        if (!abort.signal.aborted) {
          const message =
            failure instanceof Error
              ? failure.message
              : "No se pudo cargar la vista previa.";
          setError("Vista previa no disponible.");
          notifications.error({ id, title: message });
        }
      }
    })();
    return () => {
      abort.abort();
      notifications.dismiss(id);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, endpoint, attempt]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setUrl("");
        setError("");
        setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">{label}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {label.replace("Previsualizar", "Vista previa de")}
          </DialogTitle>
          <DialogDescription>
            Vista previa con la configuración guardada.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert">{error}</p>
            <Button
              variant="outline"
              onClick={() => {
                setUrl("");
                setError("");
                setAttempt(attempt + 1);
              }}
            >
              Reintentar
            </Button>
          </div>
        ) : url ? (
          <>
            <iframe
              title={label}
              src={url}
              className="h-[65dvh] w-full rounded-lg border"
            />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline underline-offset-4"
            >
              Abrir PDF en otra pestaña
            </a>
          </>
        ) : (
          <div role="status" aria-label="Cargando vista previa">
            <Skeleton className="h-[65dvh] w-full" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
export default function CertificatePreview() {
  return (
    <div className="flex flex-wrap gap-3">
      <Preview type="APPROVAL" label="Previsualizar aprobación" />
      <Preview type="INSTRUCTOR" label="Previsualizar instructor" />
    </div>
  );
}
