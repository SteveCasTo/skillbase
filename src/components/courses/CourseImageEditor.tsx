import { useEffect, useRef, useState } from "react";

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
  courseId: string;
  /** Server-generated key already saved for this course, not an arbitrary URL. */
  currentArtwork?: string | null;
  /** Called only when the upload succeeds; persist the returned key via the admin save use case. */
  onUploaded?: (key: string) => void;
}

export default function CourseImageEditor({
  courseId,
  currentArtwork,
  onUploaded,
}: Props) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [focusX, setFocusX] = useState(50);
  const [focusY, setFocusY] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(currentArtwork ?? "");
  const [uploaded, setUploaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!image) return;
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
  }, [image, zoom, focusX, focusY]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function choose(file?: File) {
    if (!file) return;
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
      URL.revokeObjectURL(url);
      if (photo.naturalWidth < 400 || photo.naturalHeight < 250) {
        setError("La foto debe medir al menos 400 × 250 píxeles.");
        return;
      }
      setZoom(1);
      setFocusX(50);
      setFocusY(50);
      setImage(photo);
    };
    photo.onerror = () => {
      URL.revokeObjectURL(url);
      setError("No se pudo abrir la foto.");
    };
    photo.src = url;
  }

  async function save() {
    if (!preview || busy) return;
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
      setUploaded(true);
      onUploaded?.(body.artwork);
      window.dispatchEvent(
        new CustomEvent("course-artwork-uploaded", {
          detail: { courseId, key: body.artwork },
        }),
      );
      setImage(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No se pudo subir la foto.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="bg-card rounded-xl border p-5 shadow-xs sm:p-7"
      aria-labelledby="course-image-title"
    >
      <h2 id="course-image-title" className="text-xl font-semibold">
        Foto del curso (opcional)
      </h2>
      <p className="text-muted-foreground mt-2 text-sm">
        Usa solo una fotografía propia o autorizada. Ajusta el encuadre antes de
        subirla. La imagen se mostrará públicamente al publicar el curso.
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
        className={`mt-5 rounded-lg border-2 border-dashed p-5 text-center ${dragging ? "border-primary bg-secondary" : "border-border"}`}
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
        <p className="text-sm">
          Arrastra una foto aquí o selecciónala con el botón.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => input.current?.click()}
        >
          Seleccionar foto
        </Button>
      </div>
      {preview && image && (
        <div className="mt-5 space-y-4">
          <p className="text-sm font-medium">Vista previa del recorte</p>
          <img
            src={preview}
            alt="Vista previa del encuadre del curso"
            className="aspect-[8/5] w-full max-w-xl rounded-lg object-cover"
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-2 text-sm">
              Acercar{" "}
              <input
                type="range"
                min="1"
                max="2"
                step="0.05"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
            <label className="grid gap-2 text-sm">
              Foco horizontal{" "}
              <input
                type="range"
                min="0"
                max="100"
                value={focusX}
                onChange={(event) => setFocusX(Number(event.target.value))}
              />
            </label>
            <label className="grid gap-2 text-sm">
              Foco vertical{" "}
              <input
                type="range"
                min="0"
                max="100"
                value={focusY}
                onChange={(event) => setFocusY(Number(event.target.value))}
              />
            </label>
          </div>
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {busy ? "Subiendo foto…" : "Subir foto recortada"}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {error}
        </p>
      )}
      {saved && !image && (
        <p role="status" className="mt-3 text-sm">
          {uploaded
            ? "Foto cargada correctamente, pero aún no está guardada en el curso. Usa “Guardar cambios” para conservarla."
            : "Este curso ya tiene una foto guardada. Sube otra para reemplazarla."}
        </p>
      )}
    </section>
  );
}
