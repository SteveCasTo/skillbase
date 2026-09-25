export type MarkdownAction =
  | "heading"
  | "bold"
  | "italic"
  | "code"
  | "ordered-list"
  | "unordered-list"
  | "link";

export interface MarkdownEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export function applyMarkdownAction(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  action: MarkdownAction,
): MarkdownEdit {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const selected = value.slice(start, end);
  let replacement: string;
  let nextSelectionStart: number;
  let nextSelectionEnd: number;

  if (action === "heading") {
    const content = selected || "Título";
    const prefix =
      selected && start > 0 && value[start - 1] !== "\n" ? "\n## " : "## ";
    replacement = `${prefix}${content}`;
    nextSelectionStart = prefix.length;
    nextSelectionEnd = prefix.length + content.length;
  } else if (action === "ordered-list" || action === "unordered-list") {
    const content = selected || "Elemento";
    const prefix =
      action === "ordered-list"
        ? (index: number) => `${index + 1}. `
        : () => "- ";
    const lines = content.split("\n");
    replacement = lines
      .map((line, index) => `${prefix(index)}${line || "Elemento"}`)
      .join("\n");
    nextSelectionStart = replacement.length;
    nextSelectionEnd = replacement.length;
  } else {
    const patterns = {
      bold: ["**", "**", "texto"],
      italic: ["*", "*", "texto"],
      code: ["`", "`", "código"],
      link: ["[", "](https://)", "Texto del enlace"],
    } as const;
    const [prefix, suffix, placeholder] = patterns[action];
    const content = selected || placeholder;
    replacement = `${prefix}${content}${suffix}`;
    nextSelectionStart = prefix.length;
    nextSelectionEnd = prefix.length + content.length;
    if (action === "link" && !selected) {
      nextSelectionStart = prefix.length + content.length + 2;
      nextSelectionEnd = replacement.length - 1;
    }
  }

  return {
    value: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    selectionStart: start + nextSelectionStart,
    selectionEnd: start + nextSelectionEnd,
  };
}
