import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import CourseArtworkPreview from "./CourseArtworkPreview";

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
  onPrepared?: (file: File | null) => void;
}

export default function CourseImageEditor({
  courseId,
  currentArtwork,
  currentArtworkUrl,
  onPrepared,
}: Props) {
  void courseId;
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [focusX, setFocusX] = useState(50);
  const [focusY, setFocusY] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const saved = currentArtwork ?? "";
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<{
    file: File | null;
    url: string;
  } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
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
  const dialog = useRef<HTMLDialogElement>(null);
  const replaceFocus = useRef<HTMLElement | null>(null);
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
    setPreview(null);
  };
  const notifyPrepared = (file: File | null) => {
    onPrepared?.(file);
    window.dispatchEvent(
      new CustomEvent("course-artwork-prepared", { detail: file }),
    );
  };

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (dialogOpen && !element.open) element.showModal();
    if (!dialogOpen && element.open) element.close();
  }, [dialogOpen]);

  function finishDialog() {
    setDialogOpen(false);
    requestAnimationFrame(() => replaceFocus.current?.focus());
  }

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
      if (confirmed) URL.revokeObjectURL(confirmed.url);
    },
    [confirmed],
  );

  useEffect(() => {
    const savedHandler = () => {
      setConfirmed((previous) =>
        previous?.file
          ? { file: null, url: URL.createObjectURL(previous.file) }
          : previous,
      );
    };
    window.addEventListener("course-artwork-saved", savedHandler);
    return () =>
      window.removeEventListener("course-artwork-saved", savedHandler);
  }, []);

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
      window.dispatchEvent(
        new CustomEvent("course-artwork-selection", { detail: true }),
      );
      setPreview(null);
      if (selection.current) URL.revokeObjectURL(selection.current);
      selection.current = url;
      setZoom(1);
      setFocusX(50);
      setFocusY(50);
      setImage(photo);
      setDialogOpen(true);
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
    setError(null);
    if (input.current) input.current.value = "";
    if (selection.current) URL.revokeObjectURL(selection.current);
    selection.current = null;
    notifyPrepared(confirmed?.file ?? null);
    window.dispatchEvent(
      new CustomEvent("course-artwork-selection", { detail: false }),
    );
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
      const file = new File([blob], "foto.webp", { type: "image/webp" });
      setConfirmed({ file, url: URL.createObjectURL(blob) });
      notifyPrepared(file);
      setImage(null);
      if (selection.current) URL.revokeObjectURL(selection.current);
      selection.current = null;
      window.dispatchEvent(
        new CustomEvent("course-artwork-selection", { detail: false }),
      );
      finishDialog();
    } catch (caught) {
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
        {confirmed ? (
          <button
            type="button"
            aria-label="Elegir otra imagen del curso"
            className="size-full"
            onClick={(event) => {
              replaceFocus.current = event.currentTarget;
              input.current?.click();
            }}
          >
            <img
              src={confirmed.url}
              alt={
                confirmed.file
                  ? "Vista previa del recorte del curso"
                  : "Foto actual del curso"
              }
              className="size-full object-cover"
            />
          </button>
        ) : saved && currentArtworkUrl ? (
          <button
            type="button"
            aria-label="Elegir otra imagen del curso"
            className="size-full"
            onClick={(event) => {
              replaceFocus.current = event.currentTarget;
              input.current?.click();
            }}
          >
            <img
              src={currentArtworkUrl}
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
              onClick={(event) => {
                replaceFocus.current = event.currentTarget;
                input.current?.click();
              }}
            >
              Seleccionar foto
            </Button>
            <span className="text-muted-foreground text-xs">
              JPG, PNG o WebP · máx. 12 MB
            </span>
          </div>
        )}
        {(image || saved || confirmed) && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            className="absolute right-3 bottom-3 shadow-sm sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
            onClick={(event) => {
              replaceFocus.current = event.currentTarget;
              input.current?.click();
            }}
          >
            <ImagePlus data-icon="inline-start" /> Reemplazar imagen
          </Button>
        )}
      </div>
      <dialog
        ref={dialog}
        aria-labelledby="course-crop-title"
        onCancel={(event) => {
          event.preventDefault();
          removeSelection();
          finishDialog();
        }}
        onClose={() => setDialogOpen(false)}
        className="bg-card text-card-foreground fixed inset-0 m-auto max-h-[90dvh] w-[min(92vw,42rem)] max-w-none overflow-y-auto rounded-2xl p-5 shadow-xl backdrop:bg-black/60"
      >
        <h2 id="course-crop-title" className="text-lg font-semibold">
          Recortar foto del curso
        </h2>
        {image && (
          <>
            <div className="bg-muted relative mt-4 aspect-[8/5] overflow-hidden rounded-xl select-none">
              <img
                src={image.src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none"
                style={{
                  width: `${imageWidth * 80}%`,
                  height: `${imageHeight * 80}%`,
                  left: `${10 + (1 - imageWidth) * focusX * 0.8}%`,
                  top: `${10 + (1 - imageHeight) * focusY * 0.8}%`,
                }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-[10%] bg-black/50 backdrop-blur-[2px]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[10%] bg-black/50 backdrop-blur-[2px]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-[10%] bottom-[10%] left-0 w-[10%] bg-black/50 backdrop-blur-[2px]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-[10%] right-0 bottom-[10%] w-[10%] bg-black/50 backdrop-blur-[2px]"
              />
              <div
                ref={frame}
                data-crop-frame
                tabIndex={0}
                role="group"
                aria-label="Encuadre de la foto: arrastra para mover; usa las flechas para ajustar"
                className="focus-visible:ring-ring absolute inset-[10%] cursor-grab rounded-lg border border-white outline-none focus-visible:ring-4 focus-visible:ring-inset active:cursor-grabbing"
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
                    ![
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                    ].includes(event.key)
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
                <span
                  aria-hidden="true"
                  className="bg-primary pointer-events-none absolute -top-1 -left-1 size-2 rounded-full border border-white shadow-sm"
                />
                <span
                  aria-hidden="true"
                  className="bg-primary pointer-events-none absolute -top-1 -right-1 size-2 rounded-full border border-white shadow-sm"
                />
                <span
                  aria-hidden="true"
                  className="bg-primary pointer-events-none absolute -bottom-1 -left-1 size-2 rounded-full border border-white shadow-sm"
                />
                <span
                  aria-hidden="true"
                  className="bg-primary pointer-events-none absolute -right-1 -bottom-1 size-2 rounded-full border border-white shadow-sm"
                />
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
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
                    setPreview(null);
                  }}
                />
              </label>
              <CourseArtworkPreview src={preview} />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={busy || !preview}
                  onClick={() => void prepare()}
                >
                  {busy ? "Preparando foto…" : "Guardar recorte"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    removeSelection();
                    finishDialog();
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          </>
        )}
      </dialog>
      {error && !dialogOpen && (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
