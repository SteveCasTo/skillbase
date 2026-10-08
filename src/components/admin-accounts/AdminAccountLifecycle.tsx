import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { navigate } from "astro:transitions/client";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AdminAccountDto } from "@/domain/admin-accounts/types";
import { notifications } from "@/lib/notifications";
import { adminAccountActions } from "./presentation";
import { postAdminAccount } from "./request";

interface Props {
  initialAccount: AdminAccountDto;
  actorId: string;
  endpoint: string;
  initialError: string | null;
}
const subscribeHydration = () => () => {};
export default function AdminAccountLifecycle({
  initialAccount,
  actorId,
  endpoint,
  initialError,
}: Props) {
  const [account, setAccount] = useState(initialAccount);
  const enhanced = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initialError);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const errorNode = useRef<HTMLParagraphElement>(null);
  const page = () =>
    root.current?.closest<HTMLElement>("[data-admin-account-details]");
  useEffect(() => {
    const container = root.current?.closest<HTMLElement>(
      "[data-admin-account-details]",
    );
    const sync = () => setPending(Boolean(container?.dataset.pending));
    const updated = (event: Event) =>
      setAccount((event as CustomEvent<AdminAccountDto>).detail);
    container?.addEventListener("admin-account:pending", sync);
    container?.addEventListener("admin-account:updated", updated);
    return () => {
      container?.removeEventListener("admin-account:pending", sync);
      container?.removeEventListener("admin-account:updated", updated);
    };
  }, []);
  useEffect(() => {
    if (error && enhanced) errorNode.current?.focus();
  }, [error, enhanced]);
  const action = account.action;
  const presentation = action ? adminAccountActions[action] : null;
  const copy = presentation
    ? `${presentation.copy}${actorId === account.id && action !== "activate" ? " Tu sesión se cerrará." : ""}`
    : "";
  const mutate = async () => {
    const container = page();
    if (!action || !container || container.dataset.pending) return;
    container.dataset.pending = "true";
    container.setAttribute("aria-busy", "true");
    container.dispatchEvent(new Event("admin-account:pending"));
    setOpen(false);
    setError(null);
    const id = crypto.randomUUID();
    notifications.loading({ id, title: "Actualizando cuenta…" });
    try {
      const result = await postAdminAccount(
        `${endpoint}?operation=${action}`,
        new URLSearchParams({ revision: account.revision }),
      );
      if (!result.ok) {
        setError(result.message);
        notifications.dismiss(id);
      } else if (!result.value.actorActive) window.location.assign("/login");
      else {
        notifications.success({ id, title: result.message });
        await navigate(
          result.value.deleted
            ? "/app/administradores?success=deleted"
            : endpoint,
        );
      }
    } catch {
      notifications.dismiss(id);
      setError(
        "No pudimos confirmar la operación. Recarga para comprobar el estado de la cuenta.",
      );
    } finally {
      delete container.dataset.pending;
      container.removeAttribute("aria-busy");
      container.dispatchEvent(new Event("admin-account:pending"));
    }
  };
  return (
    <div
      ref={root}
      className="flex max-w-full flex-col items-start gap-3"
      aria-busy={pending}
    >
      {action &&
        presentation &&
        (enhanced ? (
          <>
            <Button
              ref={trigger}
              variant={presentation.destructive ? "destructive" : "outline"}
              className="min-h-11"
              disabled={pending}
              onClick={() => setOpen(true)}
            >
              {presentation.label}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent
                showCloseButton={false}
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  document
                    .querySelector<HTMLButtonElement>(
                      "[data-admin-dialog-cancel]",
                    )
                    ?.focus();
                }}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  trigger.current?.focus();
                }}
              >
                <DialogHeader>
                  <DialogTitle>{presentation.label}</DialogTitle>
                  <DialogDescription>{copy}</DialogDescription>
                </DialogHeader>
                <DialogFooter className="grid grid-cols-2">
                  <DialogClose asChild>
                    <Button
                      data-admin-dialog-cancel
                      variant="outline"
                      className="min-h-11"
                    >
                      Cancelar
                    </Button>
                  </DialogClose>
                  <Button
                    variant={
                      presentation.destructive ? "destructive" : "default"
                    }
                    className="min-h-11"
                    onClick={() => void mutate()}
                  >
                    Confirmar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <details>
            <summary
              className={buttonVariants({
                variant: presentation.destructive ? "destructive" : "outline",
                className: "min-h-11 cursor-pointer",
              })}
            >
              {presentation.label}
            </summary>
            <form
              method="post"
              action={`${endpoint}?operation=${action}`}
              className="bg-card mt-3 flex max-w-lg flex-col gap-3 rounded-xl border p-4"
              data-astro-reload
            >
              <p className="text-sm">{copy}</p>
              <input type="hidden" name="revision" value={account.revision} />
              <button
                type="submit"
                className={buttonVariants({
                  variant: presentation.destructive ? "destructive" : "default",
                  className: "min-h-11",
                })}
              >
                Confirmar
              </button>
              <a
                href={endpoint}
                className={buttonVariants({
                  variant: "outline",
                  className: "min-h-11",
                })}
              >
                Cancelar
              </a>
            </form>
          </details>
        ))}
      <p
        ref={errorNode}
        role="alert"
        tabIndex={-1}
        hidden={!error}
        className="text-destructive max-w-lg text-sm"
      >
        {error}
      </p>
      {error && (
        <a
          href={endpoint}
          data-astro-reload
          className="text-sm underline underline-offset-4"
        >
          Recargar cuenta
        </a>
      )}
      <p role="status" className="sr-only">
        {pending ? "Actualizando cuenta…" : ""}
      </p>
    </div>
  );
}
