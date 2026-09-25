import { useEffect, useRef, useState } from "react";
import {
  applyMarkdownAction,
  type MarkdownAction,
} from "./course-markdown-actions";
import { nextCourseInput } from "./course-input-filter";

interface Props {
  value: string;
  error?: string;
  disabled?: boolean;
  describedBy?: string;
}

const actions: {
  action: MarkdownAction;
  label: string;
  mark: string;
}[] = [
  { action: "heading", label: "Encabezado", mark: "H" },
  { action: "bold", label: "Negrita", mark: "B" },
  { action: "italic", label: "Cursiva", mark: "I" },
  { action: "code", label: "Código en línea", mark: "`" },
  { action: "ordered-list", label: "Lista numerada", mark: "1." },
  { action: "unordered-list", label: "Lista con viñetas", mark: "•" },
  { action: "link", label: "Enlace", mark: "↗" },
];

export default function CourseMarkdownEditor({
  value,
  error,
  disabled = false,
  describedBy,
}: Props) {
  const [markdown, setMarkdown] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const errorId = error ? "contentMarkdown-error" : undefined;
  const descriptionIds = [describedBy, errorId]
    .filter(
      (id, index, ids): id is string =>
        Boolean(id) && ids.indexOf(id) === index,
    )
    .join(" ");

  useEffect(() => {
    textareaRef.current?.dispatchEvent(
      new Event("course-form-change", { bubbles: true }),
    );
  }, [markdown]);

  function format(action: MarkdownAction) {
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;

    const { scrollTop, scrollLeft, selectionStart, selectionEnd } = textarea;
    const edit = applyMarkdownAction(
      markdown,
      selectionStart,
      selectionEnd,
      action,
    );
    setMarkdown(edit.value);

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      textarea.scrollTop = scrollTop;
      textarea.scrollLeft = scrollLeft;
    });
  }

  return (
    <div className="min-w-0">
      <div
        className="bg-muted/50 flex flex-wrap items-center gap-1 rounded-t-lg border border-b-0 p-1.5"
        role="toolbar"
        aria-label="Formato Markdown"
      >
        {actions.map(({ action, label, mark }, index) => (
          <span key={action} className="inline-flex items-center gap-1">
            {index > 0 && (index === 1 || index === 4 || index === 6) && (
              <span aria-hidden="true" className="bg-border mx-1 h-5 w-px" />
            )}
            <button
              type="button"
              disabled={disabled}
              aria-label={label}
              title={label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format(action)}
              className="focus-visible:ring-ring hover:bg-accent hover:text-accent-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-transparent text-sm font-semibold outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
            >
              <span aria-hidden="true">{mark}</span>
            </button>
          </span>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        id="contentMarkdown"
        name="contentMarkdown"
        rows={9}
        value={markdown}
        data-course-input="multiline"
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={descriptionIds || undefined}
        placeholder={"## Contenido\n- Tema 1\n- Tema 2"}
        onChange={(event) =>
          setMarkdown(
            nextCourseInput("multiline", markdown, event.currentTarget.value),
          )
        }
        className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-44 w-full min-w-0 resize-y rounded-b-lg border px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
      />
      {error && (
        <span id={errorId} className="text-destructive mt-1 block text-sm">
          {error}
        </span>
      )}
    </div>
  );
}
