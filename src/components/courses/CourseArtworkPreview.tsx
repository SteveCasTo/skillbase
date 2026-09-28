import { useState } from "react";

import "./course-artwork-preview.css";

type Context = "featured" | "posters" | "mobile" | "detail";

const contexts: { id: Context; label: string }[] = [
  { id: "featured", label: "Destacado" },
  { id: "posters", label: "Afiches" },
  { id: "mobile", label: "Móvil" },
  { id: "detail", label: "Detalle" },
];

interface Props {
  src: string | null;
}

export default function CourseArtworkPreview({ src }: Props) {
  const [context, setContext] = useState<Context>("featured");

  return (
    <section
      className="artwork-context-preview"
      aria-label="Vistas previas públicas"
    >
      <div className="artwork-context-heading">
        <h3>Así se verá la foto</h3>
        <p>Comprueba el encuadre antes de guardar el recorte.</p>
      </div>
      <div
        className="artwork-context-options"
        role="group"
        aria-label="Formato de vista previa"
      >
        {contexts.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={context === id}
            onClick={() => setContext(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className={`artwork-context-stage artwork-context-${context}`}
        aria-busy={!src}
      >
        {!src ? (
          <p role="status">Actualizando vista previa…</p>
        ) : context === "posters" ||
          context === "mobile" ||
          context === "detail" ? (
          <div className="artwork-context-pair">
            <figure>
              <div className="artwork-context-image artwork-context-first">
                <img src={src} alt="" />
              </div>
              <figcaption>
                {context === "posters"
                  ? "Afiche ancho"
                  : context === "mobile"
                    ? "Destacado móvil"
                    : "Detalle en escritorio"}
              </figcaption>
            </figure>
            <figure>
              <div className="artwork-context-image artwork-context-second">
                <img src={src} alt="" />
              </div>
              <figcaption>
                {context === "posters"
                  ? "Afiche estrecho"
                  : context === "mobile"
                    ? "Otro curso móvil"
                    : "Detalle en móvil"}
              </figcaption>
            </figure>
          </div>
        ) : (
          <figure>
            <div className="artwork-context-image">
              <img src={src} alt="" />
            </div>
            <figcaption>Destacado en escritorio</figcaption>
          </figure>
        )}
      </div>
    </section>
  );
}
