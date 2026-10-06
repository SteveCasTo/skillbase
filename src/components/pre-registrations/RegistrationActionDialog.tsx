import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
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
}
/** Move the existing SSR form, retaining its inputs, bindings and React islands. */
export default function RegistrationActionDialog({
  targetId,
  title,
  description,
  destructive = false,
  initialOpen = false,
}: Props) {
  const enhanced = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(initialOpen);
  const [pending, setPending] = useState(false);
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
  }, [targetId, initialOpen]);
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
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div data-dialog-host ref={moveForm} />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
