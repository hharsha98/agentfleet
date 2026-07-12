// Pure, dependency-free helpers for turning an assistant message's raw text
// into renderable "parts" (Phase 10 J — artifacts side panel). No React here
// on purpose: chat-ui.tsx and artifact-panel.tsx both consume this, and
// keeping it framework-free makes it trivial to unit-test and impossible to
// break streaming (it just re-parses the full string on every render).

export type ArtifactType = "code" | "markdown" | "chart";

export type Artifact = {
  id: string;
  type: ArtifactType;
  lang: string;
  source: string;
};

export type Part = { kind: "text"; value: string } | { kind: "artifact"; artifact: Artifact };

const CHART_LANGS = new Set(["vega-lite", "vegalite", "chart"]);
const MARKDOWN_LANGS = new Set(["markdown", "md"]);
const MIN_LINES_FOR_CODE = 6;

// A fence delimiter is a line that, once trimmed, is ``` optionally followed
// by a language tag (letters/digits/-/+/./#, no spaces) — matches the spec's
// "lines of ```" definition. Anything fancier (~~~ fences, `js {1-3}` meta)
// is out of scope for this hand-rolled parser.
const FENCE_RE = /^```([A-Za-z0-9_+\-.#]*)\s*$/;

function isFence(line: string): { lang: string } | null {
  const m = FENCE_RE.exec(line.trim());
  return m ? { lang: m[1] ?? "" } : null;
}

function classify(lang: string, bodyLines: string[]): ArtifactType | null {
  const l = lang.toLowerCase();
  if (CHART_LANGS.has(l)) return "chart";
  if (MARKDOWN_LANGS.has(l)) return "markdown";
  if (l.length > 0 || bodyLines.length >= MIN_LINES_FOR_CODE) return "code";
  return null; // short + no language tag => stays inline as plain text
}

/**
 * Split an assistant message into text/artifact parts. Never throws — worst
 * case on unexpected input, the whole message comes back as a single text
 * part so the UI degrades to "just show the raw message" instead of crashing.
 */
export function parseMessageParts(content: string): Part[] {
  try {
    return parse(content);
  } catch {
    return [{ kind: "text", value: content }];
  }
}

function parse(content: string): Part[] {
  const lines = content.split("\n");
  const parts: Part[] = [];
  let textBuf: string[] = [];
  let artifactIndex = 0;

  const flushText = () => {
    if (textBuf.length === 0) return;
    const value = textBuf.join("\n");
    if (value.length > 0) parts.push({ kind: "text", value });
    textBuf = [];
  };

  let i = 0;
  while (i < lines.length) {
    const fence = isFence(lines[i]);
    if (!fence) {
      textBuf.push(lines[i]);
      i++;
      continue;
    }

    // Look for a matching closing fence further down.
    let closeIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (isFence(lines[j])) {
        closeIdx = j;
        break;
      }
    }

    if (closeIdx === -1) {
      // Unclosed trailing fence — mid-stream token boundary landed inside a
      // code block. Keep it verbatim as text so we never mangle partial
      // output; it'll get reclassified once the closing fence streams in.
      textBuf.push(...lines.slice(i));
      i = lines.length;
      break;
    }

    const bodyLines = lines.slice(i + 1, closeIdx);
    const type = classify(fence.lang, bodyLines);

    if (type === null) {
      // Too short and untagged — leave the fences in place as plain text.
      textBuf.push(...lines.slice(i, closeIdx + 1));
    } else {
      flushText();
      parts.push({
        kind: "artifact",
        artifact: {
          id: `art-${artifactIndex}`,
          type,
          lang: fence.lang || "text",
          source: bodyLines.join("\n"),
        },
      });
      artifactIndex++;
    }

    i = closeIdx + 1;
  }

  flushText();
  return parts;
}

// --- Minimal safe markdown renderer (used by the "markdown" artifact kind) ---

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return trimmed;
  return null; // drop javascript:, data:, and anything else we don't allowlist
}

function inline(text: string): string {
  let out = text;
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/\b_([^_]+)_\b/g, "<em>$1</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    const safe = sanitizeUrl(url);
    return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  });
  return out;
}

/**
 * Escape-then-transform: every character from `source` is HTML-escaped
 * FIRST, and only then do we look for markdown patterns in the escaped
 * string and wrap them in tags we generate ourselves. Because no raw `<`,
 * `>`, `&`, or quote from the source can ever reach the output, the only
 * markup in the result is markup this function wrote — so rendering the
 * RESULT with dangerouslySetInnerHTML cannot execute attacker HTML/script.
 */
export function renderMarkdownSafe(source: string): string {
  try {
    return render(escapeHtml(source));
  } catch {
    return escapeHtml(source); // never throw; worst case, show escaped plain text
  }
}

function render(escaped: string): string {
  const lines = escaped.split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${paragraph.join("<br/>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it) => `<li>${it}</li>`).join("");
    blocks.push(`<${list.type}>${items}</${list.type}>`);
    list = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line.trim())) {
      flushParagraph();
      flushList();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (or run off the end if unclosed — fine, still safe)
      blocks.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    const ulItem = /^[-*+]\s+(.*)$/.exec(line);
    const olItem = /^\d+\.\s+(.*)$/.exec(line);
    if (ulItem || olItem) {
      flushParagraph();
      const type = ulItem ? "ul" : "ol";
      const text = (ulItem ?? olItem)![1];
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(inline(text));
      i++;
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      i++;
      continue;
    }

    flushList();
    paragraph.push(inline(line));
    i++;
  }

  flushParagraph();
  flushList();
  return blocks.join("\n");
}
