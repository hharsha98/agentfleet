// Open Graph card, generated at build time by next/og rather than checked in
// as a 1200x630 binary. Confirmed available in this Next: node_modules/next/
// og.js re-exports dist/server/og/image-response, which ships in 16.2.10.
//
// Per node_modules/next/dist/docs/.../01-metadata/opengraph-image.md this is
// a file convention — exporting `alt`, `size` and `contentType` below is what
// populates og:image:alt / :width / :height / :type, so app/layout.tsx must
// NOT also list an `images` key or the tag is emitted twice. The absolute URL
// comes from the `metadataBase` added to that file.
//
// Two deliberate non-uses of the doc's example: no `fonts` option (loading a
// .ttf would put the binary back in git, so this rides ImageResponse's
// built-in face) and no readFile of a local logo (the mark is an inline SVG
// data URI). That keeps the whole card text-only in source control.
//
// Satori, which renders this, is not a browser: every element with more than
// one child needs an explicit `display: "flex"`, and there is no cascade, so
// each colour and size is set on the node that uses it.
import { ImageResponse } from "next/og";

export const alt =
  "AgentFleet — run a team of AI agents that research, build, and ship for you.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Same three-node delta as components/brand/logo.tsx, at the same 24 grid and
// 1.75 stroke weight — scaled up here it keeps the proportions of the in-app
// mark exactly. Inlined rather than imported because satori renders images,
// not React SVG components from our own tree.
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="132" height="132" fill="none" stroke="#5e6ad2" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4.75" r="2.25" fill="#5e6ad2" stroke="none"/><circle cx="4.75" cy="18.5" r="2.25"/><circle cx="19.25" cy="18.5" r="2.25"/><path d="M10.74 7.14 6.01 16.11"/><path d="M13.26 7.14 17.99 16.11"/></svg>`;

const markSrc = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`;

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          // The landing page's own palette: --background with the accent and
          // violet ambient glows that app/page.tsx paints behind the hero.
          backgroundColor: "#0a0a0a",
          backgroundImage:
            "radial-gradient(1000px 500px at 15% -10%, rgba(94,106,210,0.30), transparent 60%), radial-gradient(800px 450px at 100% 110%, rgba(139,127,240,0.18), transparent 60%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* A raw <img>, not next/image: satori renders this tree, and the
              next/image runtime does not exist inside ImageResponse. */}
          <img src={markSrc} width={132} height={132} alt="" />
          <div
            style={{
              display: "flex",
              fontSize: 82,
              letterSpacing: "-0.03em",
              color: "#f4f4f5",
            }}
          >
            AgentFleet
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              fontSize: 46,
              lineHeight: 1.25,
              letterSpacing: "-0.02em",
              color: "#f4f4f5",
              maxWidth: 940,
            }}
          >
            Run a team of AI agents that research, build, and ship for you.
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#a1a1aa" }}>
            17 built-in agents · mission board · evals &amp; guardrails · open
            source, self-hosted
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              width: 120,
              height: 3,
              backgroundColor: "#5e6ad2",
            }}
          />
          <div style={{ display: "flex", fontSize: 24, color: "#a1a1aa" }}>
            FastAPI · LangGraph · Postgres + pgvector · Next.js
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
