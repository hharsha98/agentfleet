"use client";

import { useEffect, useRef, useState } from "react";

import { renderMarkdownSafe, type Artifact } from "@/lib/artifacts";

const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 440;

const TYPE_LABEL: Record<Artifact["type"], string> = {
  code: "{ }",
  markdown: "M↓",
  chart: "📊",
};

export function ArtifactPanel({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isNarrow, setIsNarrow] = useState(false);
  const [copied, setCopied] = useState(false);
  const dragListenersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  // Panel becomes a full-width overlay below the `md` breakpoint. Reading the
  // viewport via matchMedia (rather than pure CSS) so the resize logic below
  // knows not to apply its inline pixel width on mobile.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Clean up any drag listeners left dangling if the panel unmounts mid-drag
  // (e.g. artifact closed while the user is still holding the handle).
  useEffect(() => {
    return () => {
      const listeners = dragListenersRef.current;
      if (listeners) {
        window.removeEventListener("mousemove", listeners.move);
        window.removeEventListener("mouseup", listeners.up);
      }
    };
  }, []);

  function handleDragStart(e: React.MouseEvent) {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const maxWidth = window.innerWidth * 0.7;
      const next = Math.min(maxWidth, Math.max(MIN_WIDTH, window.innerWidth - ev.clientX));
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragListenersRef.current = null;
    };
    dragListenersRef.current = { move: onMove, up: onUp };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(artifact.source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (permissions, insecure context) —
      // fail quietly rather than crash the panel.
    }
  }

  return (
    <div
      className={
        isNarrow
          ? "fixed inset-0 z-50 flex flex-col bg-background"
          : "relative flex h-full flex-shrink-0 flex-col border-l border-hairline bg-background"
      }
      style={isNarrow ? undefined : { width }}
    >
      {!isNarrow && (
        <div
          onMouseDown={handleDragStart}
          className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-accent/40"
        />
      )}

      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2 font-mono text-xs text-muted">
          <span>{TYPE_LABEL[artifact.type]}</span>
          <span className="text-foreground">{artifact.lang}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close artifact panel"
            className="text-muted transition-colors hover:text-foreground"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {artifact.type === "code" && <CodeArtifact source={artifact.source} />}
        {artifact.type === "markdown" && <MarkdownArtifact source={artifact.source} />}
        {artifact.type === "chart" && <ChartArtifact source={artifact.source} />}
      </div>
    </div>
  );
}

function CodeArtifact({ source }: { source: string }) {
  // Plain text only — safe by construction, never dangerouslySetInnerHTML.
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
      {source}
    </pre>
  );
}

function MarkdownArtifact({ source }: { source: string }) {
  // renderMarkdownSafe escapes all HTML before applying any transforms, so
  // the HTML it returns cannot contain attacker-controlled markup/script —
  // see the safety-model comment on that function in lib/artifacts.ts.
  const html = renderMarkdownSafe(source);
  return (
    <div
      className="prose-sm max-w-none text-sm leading-relaxed [&_a]:text-accent [&_code]:font-mono [&_code]:text-xs [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-hairline [&_pre]:p-2 [&_ul]:list-disc"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ChartArtifact({ source }: { source: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [invalid, setInvalid] = useState(false);
  const [prevSource, setPrevSource] = useState(source);

  // Reset the "invalid" fallback when switching to a different chart spec.
  // Adjusting state during render (React's documented pattern for "state
  // that resets when a prop changes") instead of inside the effect below
  // avoids an extra effect-driven render pass. Refs can't be read during
  // render under React 19's rules, so the previous value is tracked in
  // state rather than a ref.
  if (source !== prevSource) {
    setPrevSource(source);
    setInvalid(false);
  }

  useEffect(() => {
    let cancelled = false;
    let finalize: (() => void) | null = null;

    async function run() {
      let spec: unknown;
      try {
        spec = JSON.parse(source);
      } catch {
        if (!cancelled) setInvalid(true);
        return;
      }
      try {
        // Lazily imported inside this client-only effect so vega/vega-lite/
        // vega-embed never enter the SSR or main bundle — only fetched once
        // a chart artifact is actually opened.
        const vegaEmbedModule = await import("vega-embed");
        const vegaEmbed = vegaEmbedModule.default;
        if (cancelled || !containerRef.current) return;
        const result = await vegaEmbed(containerRef.current, spec as object, { actions: false });
        finalize = () => result.view.finalize();
      } catch {
        // Bad spec or the library failed to load — gracefully degrade to
        // showing the raw JSON instead of crashing the panel.
        if (!cancelled) setInvalid(true);
      }
    }
    run();

    return () => {
      cancelled = true;
      finalize?.();
    };
  }, [source]);

  if (invalid) {
    return (
      <div>
        <p className="mb-2 text-xs text-muted">chart spec invalid — showing source</p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
          {source}
        </pre>
      </div>
    );
  }

  return <div ref={containerRef} className="min-h-[200px]" />;
}
