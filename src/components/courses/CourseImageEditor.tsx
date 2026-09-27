import { useEffect, useRef, useState } from "react";
import { ImagePlus, Move } from "lucide-react";

import { Button } from "@/components/ui/button";

const WIDTH = 1200;
const HEIGHT = 750;
const LIMIT = 12 * 1024 * 1024;

async function simpleWebp(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP")
    throw new Error("No se pudo preparar la foto WebP.");
  if (text(12, 4) === "VP8 " || text(12, 4) === "VP8L") return blob;
  if (text(12, 4) !== "VP8X" || bytes[20] !== 0x20)
    throw new Error("El navegador generó un formato WebP no compatible.");

  let offset = 30;
  let imageChunk: Uint8Array | undefined;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error("Imagen WebP inválida.");
    const name = text(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) throw new Error("Imagen WebP inválida.");
    if (name === "VP8 " || name === "VP8L") {
      if (imageChunk) throw new Error("Imagen WebP inválida.");
      imageChunk = bytes.subarray(offset, end);
    } else if (name !== "ICCP") {
      throw new Error("El navegador generó un formato WebP no compatible.");
    }
    offset = end;
  }
  if (!imageChunk) throw new Error("Imagen WebP inválida.");

  const simple = new Uint8Array(12 + imageChunk.length);
  simple.set(bytes.subarray(0, 12));
  simple.set(imageChunk, 12);
  const simpleView = new DataView(simple.buffer);
  simpleView.setUint32(4, simple.length - 8, true);
  return new Blob([simple], { type: "image/webp" });
}

interface Props {
  courseId?: string;
  /** Server-generated key already saved for this course, not an arbitrary URL. */
  currentArtwork?: string | null;
  /** URL derived server-side from the canonical saved artwork key. */
  currentArtworkUrl?: string | null;
  /** Called only when the upload succeeds; persist the returned key via the admin save use case. */
  onUploaded?: (key: string) => void;
  onPrepared?: (file: File | null) => void;
}

export default function CourseImageEditor({
  courseId,
  currentArtwork,
  currentArtworkUrl,
  onUploaded,
  onPrepared,
}: Props) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [focusX, setFocusX] = useState(50);
  const [focusY, setFocusY] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(currentArtwork ?? "");
  const [savedPreview, setSavedPreview] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef<string | null>(null);
  const selectionVersion = useRef(0);
  const cropVersion = useRef(0);
  const drag = useRef<{
    x: number;
    y: number;
    focusX: number;
    focusY: number;
  } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const cover = image
    ? Math.max(WIDTH / image.naturalWidth, HEIGHT / image.naturalHeight)
    : 0;
  const imageWidth = image ? (image.naturalWidth * cover * zoom) / WIDTH : 1;
  const imageHeight = image ? (image.naturalHeight * cover * zoom) / HEIGHT : 1;
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  const changeCrop = (x: number, y: number) => {
    const nextX = clamp(x);
    const nextY = clamp(y);
    if (nextX === focusX && nextY === focusY) return;
    ++cropVersion.current;
    setFocusX(nextX);
    setFocusY(nextY);
    setPrepared(false);
    setPreview(null);
    notifyPrepared(null);
  };
  const notifyPrepared = (file: File | null) => {
    onPrepared?.(file);
    if (!courseId)
      window.dispatchEvent(
        new CustomEvent("course-artwork-prepared", { detail: file }),
      );
  };

  useEffect(() => {
    if (!image) return;
    let active = true;
    const timer = window.setTimeout(() => {
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) return;
      // One landscape master: object-fit: cover on the featured billboard, cards
      // and detail. Subject focus remains available at every aspect ratio.
      const base = Math.max(
        WIDTH / image.naturalWidth,
        HEIGHT / image.naturalHeight,
      );
      const sourceWidth = WIDTH / (base * zoom);
      const sourceHeight = HEIGHT / (base * zoom);
      context.drawImage(
        image,
        ((image.naturalWidth - sourceWidth) * focusX) / 100,
        ((image.naturalHeight - sourceHeight) * focusY) / 100,
        sourceWidth,
        sourceHeight,
        0,
        0,
        WIDTH,
        HEIGHT,
      );
      canvas.toBlob(
        (blob) => {
          if (!active) return;
          if (!blob) {
            setError("Este navegador no puede exportar WebP.");
            return;
          }
          const next = URL.createObjectURL(blob);
          setPreview((previous) => {
            if (previous) URL.revokeObjectURL(previous);
            return next;
          });
        },
        "image/webp",
        0.85,
      );
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [image, zoom, focusX, focusY]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  useEffect(
    () => () => {
      if (selection.current) URL.revokeObjectURL(selection.current);
    },
    [],
  );

  useEffect(
    () => () => {
      if (savedPreview) URL.revokeObjectURL(savedPreview);
    },
    [savedPreview],
  );

  async function choose(file?: File) {
    if (!file || busy) return;
    if (input.current) input.current.value = "";
    const version = ++selectionVersion.current;
    setError(null);
    if (
      !/\.(png|jpe?g|webp)$/i.test(file.name) ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > LIMIT ||
      !file.size
    ) {
      setError("Selecciona una foto JPG, PNG o WebP de hasta 12 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    const photo = new Image();
    photo.onload = () => {
      if (version !== selectionVersion.current) {
        URL.revokeObjectURL(url);
        return;
      }
      if (photo.naturalWidth < 400 || photo.naturalHeight < 250) {
        URL.revokeObjectURL(url);
        setError("La foto debe medir al menos 400 × 250 píxeles.");
        return;
      }
      ++cropVersion.current;
      if (!courseId)
        window.dispatchEvent(
          new CustomEvent("course-artwork-selection", { detail: true }),
        );
      notifyPrepared(null);
      setPrepared(false);
      setPreview(null);
      if (selection.current) URL.revokeObjectURL(selection.current);
      selection.current = url;
      setZoom(1);
      setFocusX(50);
      setFocusY(50);
      setImage(photo);
    };
    photo.onerror = () => {
      URL.revokeObjectURL(url);
      if (version === selectionVersion.current)
        setError("No se pudo abrir la foto.");
    };
    photo.src = url;
  }

  function removeSelection() {
    ++cropVersion.current;
    ++selectionVersion.current;
    setImage(null);
    setPrepared(false);
    setError(null);
    if (input.current) input.current.value = "";
    if (selection.current) URL.revokeObjectURL(selection.current);
    selection.current = null;
    notifyPrepared(null);
    window.dispatchEvent(
      new CustomEvent("course-artwork-selection", { detail: false }),
    );
  }

  async function save() {
    if (!courseId || !preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await fetch(preview)
        .then((response) => response.blob())
        .then(simpleWebp);
      const form = new FormData();
      form.append("courseId", courseId);
      form.append(
        "image",
        new File([blob], "foto.webp", { type: "image/webp" }),
      );
      const response = await fetch("/app/cursos/imagen", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const body: unknown = await response.json();
      if (
        !response.ok ||
        !body ||
        typeof body !== "object" ||
        !("artwork" in body) ||
        typeof body.artwork !== "string"
      )
        throw new Error(
          body &&
            typeof body === "object" &&
            "error" in body &&
            typeof body.error === "string"
            ? body.error
            : "No se pudo subir la foto.",
        );
      setSaved(body.artwork);
      setSavedPreview(URL.createObjectURL(blob));
      setUploaded(true);
      onUploaded?.(body.artwork);
      window.dispatchEvent(
        new CustomEvent("course-artwork-uploaded", {
          detail: { courseId, key: body.artwork },
        }),
      );
      setImage(null);
      if (selection.current) URL.revokeObjectURL(selection.current);
      selection.current = null;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No se pudo subir la foto.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function prepare() {
    if (!preview || busy) return;
    const version = cropVersion.current;
    setBusy(true);
    setError(null);
    try {
      const blob = await fetch(preview)
        .then((response) => response.blob())
        .then(simpleWebp);
      if (version !== cropVersion.current) return;
      if (blob.size > 4 * 1024 * 1024)
        throw new Error("La foto recortada no puede superar 4 MB.");
      notifyPrepared(new File([blob], "foto.webp", { type: "image/webp" }));
      setPrepared(true);
    } catch (caught) {
      notifyPrepared(null);
      setPrepared(false);
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo preparar la foto.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0" data-course-image-editor>
      <p className="text-sm font-medium" id="course-image-title">
        Foto del curso{" "}
        <span className="text-muted-foreground font-normal">(opcional)</span>
      </p>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Seleccionar foto del curso"
        onChange={(event) => void choose(event.target.files?.[0])}
      />
      <div
        className={`group bg-muted relative mt-3 aspect-[8/5] overflow-hidden rounded-xl ${dragging ? "ring-primary ring-2" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void choose(event.dataTransfer.files[0]);
        }}
      >
        {image ? (
          <div
            ref={frame}
            data-crop-frame
            tabIndex={0}
            role="group"
            aria-label="Encuadre de la foto: arrastra para mover; usa las flechas para ajustar"
            className="focus-visible:ring-ring absolute inset-0 cursor-grab overflow-hidden outline-none select-none focus-visible:ring-4 focus-visible:ring-inset active:cursor-grabbing"
            style={{ touchAction: "none" }}
            onPointerDown={(event) => {
              if (event.button !== 0 || busy) return;
              drag.current = {
                x: event.clientX,
                y: event.clientY,
                focusX,
                focusY,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!drag.current || !frame.current) return;
              const bounds = frame.current.getBoundingClientRect();
              const overflowX = bounds.width * (imageWidth - 1);
              const overflowY = bounds.height * (imageHeight - 1);
              changeCrop(
                drag.current.focusX -
                  (overflowX
                    ? ((event.clientX - drag.current.x) / overflowX) * 100
                    : 0),
                drag.current.focusY -
                  (overflowY
                    ? ((event.clientY - drag.current.y) / overflowY) * 100
                    : 0),
              );
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onKeyDown={(event) => {
              if (busy) return;
              const step = event.shiftKey ? 10 : 2;
              if (
                !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                  event.key,
                )
              )
                return;
              event.preventDefault();
              changeCrop(
                focusX +
                  (event.key === "ArrowLeft"
                    ? -step
                    : event.key === "ArrowRight"
                      ? step
                      : 0),
                focusY +
                  (event.key === "ArrowUp"
                    ? -step
                    : event.key === "ArrowDown"
                      ? step
                      : 0),
              );
            }}
          >
            <img
              src={image.src}
              alt="Vista previa del encuadre del curso"
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{
                width: `${imageWidth * 100}%`,
                height: `${imageHeight * 100}%`,
                left: `${(1 - imageWidth) * focusX}%`,
                top: `${(1 - imageHeight) * focusY}%`,
              }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-2 rounded-lg border border-white/70 shadow-[0_0_0_1px_rgb(0_0_0_/_0.15)]"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            >
              <Move className="size-4" />
            </span>
          </div>
        ) : saved && (savedPreview || currentArtworkUrl) ? (
          <button
            type="button"
            aria-label="Elegir otra imagen del curso"
            className="focus-visible:outline-ring size-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-3px]"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            <img
              src={savedPreview ?? currentArtworkUrl ?? ""}
              alt="Foto actual del curso"
              className="size-full object-cover"
            />
          </button>
        ) : (
          <div className="border-border flex size-full flex-col items-center justify-center gap-3 border-2 border-dashed text-center">
            <ImagePlus
              aria-hidden="true"
              className="text-muted-foreground size-7"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => input.current?.click()}
            >
              Seleccionar foto
            </Button>
            <span className="text-muted-foreground text-xs">
              JPG, PNG o WebP · máx. 12 MB
            </span>
          </div>
        )}
        {(image || saved) && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            className="absolute right-3 bottom-3 shadow-sm sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
            onClick={() => input.current?.click()}
          >
            <ImagePlus data-icon="inline-start" /> Reemplazar imagen
          </Button>
        )}
      </div>
      {image && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
            <span>Arrastra para encuadrar</span>
            <span>1200 × 750 px</span>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <span>Zoom</span>
            <input
              className="accent-primary min-w-0 flex-1"
              type="range"
              disabled={busy}
              min="1"
              max="2"
              step="0.05"
              value={zoom}
              onChange={(event) => {
                ++cropVersion.current;
                setZoom(Number(event.target.value));
                setPrepared(false);
                setPreview(null);
                notifyPrepared(null);
              }}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={busy || !preview}
              onClick={() => void (courseId ? save() : prepare())}
            >
              {busy
                ? "Preparando foto…"
                : courseId
                  ? "Subir foto recortada"
                  : "Usar este recorte"}
            </Button>
            {!courseId && (
              <Button type="button" variant="ghost" onClick={removeSelection}>
                Quitar foto
              </Button>
            )}
          </div>
          {!courseId && (
            <p role="status" className="text-muted-foreground text-sm">
              {prepared
                ? "Foto lista para crear el borrador."
                : "Confirma el recorte antes de crear el borrador."}
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {error}
        </p>
      )}
      {saved && !image && uploaded && (
        <p role="status" className="mt-3 text-sm">
          Foto cargada. Usa “Guardar cambios” para conservarla.
        </p>
      )}
    </div>
  );
}
