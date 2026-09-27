export type MarkdownAction =
  | "heading"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6"
  | "bold"
  | "italic"
  | "code"
  | "code-block"
  | "ordered-list"
  | "unordered-list"
  | "blockquote"
  | "separator"
  | "link";

export interface MarkdownEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

type HeadingAction = Extract<MarkdownAction, `heading${string}`>;

function isHeadingAction(action: MarkdownAction): action is HeadingAction {
  return action === "heading" || /^heading-[1-6]$/.test(action);
}

export function applyMarkdownAction(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  action: MarkdownAction,
): MarkdownEdit {
  let start = Math.max(0, Math.min(selectionStart, value.length));
  let end = Math.max(start, Math.min(selectionEnd, value.length));
  if (
    start < end &&
    (action === "ordered-list" ||
      action === "unordered-list" ||
      action === "blockquote")
  ) {
    start = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = value.indexOf("\n", end);
    end = lineEnd === -1 ? value.length : lineEnd;
  }
  const selected = value.slice(start, end);
  let replacement: string;
  let nextSelectionStart: number;
  let nextSelectionEnd: number;

  if (isHeadingAction(action)) {
    const content = selected || "Título";
    const level = action === "heading" ? 2 : Number(action.slice(-1));
    const marker = `${"#".repeat(level)} `;
    const prefix = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    const suffix = end < value.length && value[end] !== "\n" ? "\n" : "";
    replacement = `${prefix}${marker}${content}${suffix}`;
    nextSelectionStart = prefix.length;
    nextSelectionStart += marker.length;
    nextSelectionEnd = nextSelectionStart + content.length;
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
  } else if (action === "blockquote") {
    const content = selected || "Cita";
    const lines = content.split("\n");
    replacement = lines.map((line) => `> ${line || "Cita"}`).join("\n");
    nextSelectionStart = 0;
    nextSelectionEnd = replacement.length;
  } else if (action === "code-block") {
    const content = selected || "código";
    const prefix = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    const suffix = end < value.length && value[end] !== "\n" ? "\n" : "";
    replacement = `${prefix}\`\`\`\n${content}\n\`\`\`${suffix}`;
    nextSelectionStart = prefix.length + 4;
    nextSelectionEnd = nextSelectionStart + content.length;
  } else if (action === "separator") {
    const prefix = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    const suffix = end < value.length && value[end] !== "\n" ? "\n" : "";
    replacement = `${prefix}---${suffix}`;
    nextSelectionStart = prefix.length;
    nextSelectionEnd = nextSelectionStart + 3;
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
