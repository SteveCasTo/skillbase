import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
interface Props {
  targetId: string;
  title: string;
  description: string;
  destructive?: boolean;
  initialOpen?: boolean;
  disabled?: boolean;
  formFooter?: boolean;
}
/** Move the existing SSR form, retaining its inputs, bindings and React islands. */
export default function RegistrationActionDialog({
  targetId,
  title,
  description,
  destructive = false,
  initialOpen = false,
  disabled = false,
  formFooter = false,
}: Props) {
  const enhanced = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(initialOpen);
  const [pending, setPending] = useState(false);
  const [cancelHost, setCancelHost] = useState<HTMLElement | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const source = useRef<HTMLElement | null>(null);
  const moveForm = useCallback((host: HTMLDivElement | null) => {
    if (host && target.current) {
      host.append(target.current);
      return () => {
        if (source.current && target.current)
          source.current.append(target.current);
      };
    }
    return undefined;
  }, []);
  useEffect(() => {
    target.current = document.getElementById(targetId);
    source.current = target.current?.parentElement ?? null;
    if (source.current) source.current.hidden = true;
    const form = target.current?.querySelector("form");
    if (!form) return;
    if (formFooter) {
      const fallback = form.querySelector<HTMLElement>(
        "[data-dialog-cancel-fallback]",
      );
      if (fallback) fallback.hidden = true;
      setCancelHost(form.querySelector<HTMLElement>("[data-dialog-cancel]"));
    }
    const observe = new MutationObserver(() =>
      setPending(Boolean(form.dataset.pending)),
    );
    observe.observe(form, {
      attributes: true,
      attributeFilter: ["data-pending"],
    });
    const close = () => flushSync(() => setOpen(false));
    form.addEventListener("registration:closing", close);
    return () => {
      observe.disconnect();
      form.removeEventListener("registration:closing", close);
    };
  }, [targetId, initialOpen, formFooter]);
  if (disabled)
    return (
      <Button
        type="button"
        variant={destructive ? "destructive" : "outline"}
        disabled
      >
        {title}
      </Button>
    );
  if (!enhanced)
    return (
      <a
        href={`#${targetId}`}
        data-operation-trigger={targetId}
        className={buttonVariants({
          variant: destructive ? "destructive" : "outline",
          className: "min-h-11",
        })}
      >
        {title}
      </a>
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
          type="button"
          variant={destructive ? "destructive" : "outline"}
          data-operation-trigger={targetId}
          className="min-h-11"
        >
          {title}
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        {...(!description ? { "aria-describedby": undefined } : {})}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div data-dialog-host ref={moveForm} />
        {!formFooter && (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Volver
            </Button>
          </DialogFooter>
        )}
        {formFooter &&
          cancelHost &&
          createPortal(
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-11 w-full whitespace-normal"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Volver
            </Button>,
            cancelHost,
          )}
      </DialogContent>
    </Dialog>
  );
}
