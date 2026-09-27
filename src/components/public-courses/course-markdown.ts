export type MarkdownNode = {
  type:
    | "text"
    | "strong"
    | "emphasis"
    | "code"
    | "link"
    | "break"
    | "heading"
    | "paragraph"
    | "unordered-list"
    | "ordered-list"
    | "list-item"
    | "blockquote"
    | "code-block"
    | "separator";
  value?: string;
  href?: string;
  level?: number;
  children?: MarkdownNode[];
};

function safeHref(href: string): string | null {
  const value = href.trim();
  if (
    !value ||
    value.includes("\\") ||
    [...value].some((char) => char.charCodeAt(0) <= 0x20)
  )
    return null;

  if (/^(?:https?:|mailto:)/i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:")
        return url.href;
      if (url.protocol === "mailto:" && url.pathname) return url.href;
    } catch {
      return null;
    }
  }

  if (/^(?:\/|#|\?|\.)/.test(value) && !value.startsWith("//")) return value;
  return null;
}

function parseInline(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const pattern =
    /\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|`([^`]+)`| {2}\n/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor)
      nodes.push({ type: "text", value: text.slice(cursor, index) });
    if (match[1] !== undefined) {
      const children = parseInline(match[1]);
      const href = safeHref(match[2]!);
      nodes.push(
        ...(href ? [{ type: "link" as const, href, children }] : children),
      );
    } else if (match[3] !== undefined || match[4] !== undefined) {
      nodes.push({
        type: "strong",
        children: parseInline(match[3] ?? match[4]!),
      });
    } else if (match[5] !== undefined || match[6] !== undefined) {
      nodes.push({
        type: "emphasis",
        children: parseInline(match[5] ?? match[6]!),
      });
    } else if (match[7] !== undefined) {
      nodes.push({ type: "code", value: match[7] });
    } else {
      nodes.push({ type: "break" });
    }
    cursor = index + match[0].length;
  }

  if (cursor < text.length)
    nodes.push({ type: "text", value: text.slice(cursor) });
  return nodes;
}

export function parseCourseMarkdown(markdown: string): MarkdownNode[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (!line) {
      index++;
      continue;
    }

    if (/^```/.test(line)) {
      index++;
      const code: string[] = [];
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index]!)) {
        code.push(lines[index]!);
        index++;
      }
      if (index < lines.length) index++;
      blocks.push({ type: "code-block", value: code.join("\n") });
      continue;
    }

    if (/^(?:---+|\*\*\*+|___+)$/.test(line)) {
      blocks.push({ type: "separator" });
      index++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1]!.length,
        children: parseInline(heading[2]!),
      });
      index++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index]!)) {
        quote.push(lines[index]!.replace(/^\s*>\s?/, ""));
        index++;
      }
      blocks.push({
        type: "blockquote",
        children: parseInline(quote.join("\n")),
      });
      continue;
    }

    const listItem = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/.exec(lines[index]!);
    if (listItem) {
      const ordered = /^\d/.test(listItem[2]!);
      const items: MarkdownNode[] = [];
      while (index < lines.length) {
        const item = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/.exec(lines[index]!);
        if (!item || /^\d/.test(item[2]!) !== ordered) break;
        items.push({ type: "list-item", children: parseInline(item[3]!) });
        index++;
      }
      blocks.push({
        type: ordered ? "ordered-list" : "unordered-list",
        children: items,
      });
      continue;
    }

    const paragraph = [line];
    index++;
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^(#{1,6})\s+/.test(lines[index]!.trim()) &&
      !/^\s*>/.test(lines[index]!) &&
      !/^\s*```/.test(lines[index]!) &&
      !/^(?:---+|\*\*\*+|___+)$/.test(lines[index]!.trim()) &&
      !/^\s*(?:[-+*]|\d+[.)])\s+/.test(lines[index]!)
    ) {
      paragraph.push(lines[index]!.trim());
      index++;
    }
    blocks.push({
      type: "paragraph",
      children: parseInline(paragraph.join("\n")),
    });
  }

  return blocks;
}
