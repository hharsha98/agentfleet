// Curated starter workflows — the "one-click import" template gallery the
// workflows page and the builder's empty canvas both read from.
//
// WHY THIS EXISTS: a blank canvas plus a 17-agent palette tells a newcomer
// nothing about what a workflow IS or which steps sensibly follow which. Four
// worked examples do, in one click.
//
// HARD RULES for anything added here — each one is a real failure mode the
// API will punish, not a style preference:
//
//  1. `agent_slug` must be a slug that actually exists in
//     apps/api/scripts/seed_agents.py's BUILTIN list. compile_workflow()
//     raises `unknown_agent` as a HARD error (never a silent fallback to
//     "orchestrator" — see that module's docstring), so a typo here turns a
//     one-click example into an instant red ring.
//  2. Pick an agent whose seeded system prompt actually fits the step. An
//     example that asks Clinical Research to list programming languages is
//     worse than no example at all.
//  3. Every node needs a real, specific `instruction`. An empty one compiles
//     to `description: ""`, the agent receives only the title, and
//     find_warnings() flags `empty_instruction` because the agent typically
//     replies asking for clarification instead of doing the work.
//  4. Node/edge ids must match the API's `^[A-Za-z0-9_-]{1,64}$`
//     (WORKFLOW_ID_RE) — plain kebab-case slugs only, no spaces or dots.
//     Ids only need to be unique WITHIN one example's graph.
//  5. `position` must lay the graph out readably on arrival, so a newcomer
//     never has to discover "Arrange by wave" before the example makes
//     sense. Columns are one dependency hop apart; parallel steps stack.
//
// Agents used below are all builtin: market-intelligence, patent-scout,
// deep-research, competitor-monitor, fact-checker, creative-writer,
// sql-analytics, data-analyst, orchestrator, system-architect.

// Mirrors components/workflow/layout.ts's NODE_W + H_GAP / NODE_H + V_GAP so
// example graphs sit on the same grid "Arrange by wave" would produce — the
// button stays near-a-no-op on a freshly loaded example rather than visibly
// jerking everything sideways.
const COL = 280;
const ROW = 130;

export type ExampleGraphNode = {
  id: string;
  agent_slug: string;
  title: string;
  instruction: string;
  needs_approval: boolean;
  position: { x: number; y: number };
};

export type ExampleGraphEdge = { id: string; source: string; target: string };

/** Matches the API's WorkflowGraphIn (apps/api/app/schemas.py) exactly, so an
 *  example can be POSTed to /api/v1/workflows verbatim. */
export type ExampleGraph = {
  schema_version: 1;
  nodes: ExampleGraphNode[];
  edges: ExampleGraphEdge[];
};

export type WorkflowExample = {
  id: string;
  name: string;
  description: string;
  /** One-line hint about the SHAPE, shown on the card — this is what makes
   *  "waves" concrete before the user has drawn anything themselves. */
  shape: string;
  graph: ExampleGraph;
};

export const WORKFLOW_EXAMPLES: WorkflowExample[] = [
  {
    id: "verified-explainer",
    name: "Verified explainer",
    description:
      "Check a claim against live sources, gather the numbers behind it, then write a short explainer that only uses what was verified.",
    shape: "3 steps in a straight line — 3 waves, one step per wave.",
    graph: {
      schema_version: 1,
      nodes: [
        {
          id: "verify",
          agent_slug: "fact-checker",
          title: "Verify the claim",
          instruction:
            'Verify this claim: "Global sales of electric cars passed 17 million vehicles in 2024." Say plainly whether it is TRUE, FALSE, or UNVERIFIABLE from what you find. Cite the URL of every source you actually read, and call out explicitly where two sources disagree on the number.',
          needs_approval: false,
          position: { x: 0, y: 0 },
        },
        {
          id: "numbers",
          agent_slug: "deep-research",
          title: "Gather the numbers behind it",
          instruction:
            "Building on the verdict from the previous step, collect the underlying figures: worldwide electric-car sales for each of the last five years, and the three largest markets by volume in the most recent year. Give a source URL for every figure, and mark any figure that is an estimate or a projection rather than a reported total.",
          needs_approval: false,
          position: { x: COL, y: 0 },
        },
        {
          id: "explainer",
          agent_slug: "creative-writer",
          title: "Draft a 300-word explainer",
          instruction:
            "Write a 300-word explainer for a general business audience using ONLY the verdict and the figures from the previous two steps. Open with the single most surprising number. Plain prose, no bullet lists, no headings. Do not introduce any statistic that did not appear above, and do not soften the verdict.",
          needs_approval: false,
          position: { x: COL * 2, y: 0 },
        },
      ],
      edges: [
        { id: "verify-numbers", source: "verify", target: "numbers" },
        { id: "numbers-explainer", source: "numbers", target: "explainer" },
      ],
    },
  },
  {
    id: "competitor-teardown",
    name: "Competitor teardown",
    description:
      "Two research steps run side by side, a third combines them into a positioning brief, and the last one posts a digest to Slack once you approve it.",
    shape: "Fan-out then fan-in — 2 steps share wave 1, so wave 2 waits for both.",
    graph: {
      schema_version: 1,
      nodes: [
        {
          id: "recent-moves",
          agent_slug: "market-intelligence",
          title: "Recent moves and funding",
          instruction:
            "Research Figma's last six months: funding or earnings news, pricing changes, leadership changes, and major product launches. For each item give the date, one sentence on what changed, and the URL of the page you actually read. Skip anything routine, speculative, or older than six months. If you find nothing material, say so plainly.",
          needs_approval: false,
          position: { x: 0, y: 0 },
        },
        {
          id: "ip-filings",
          agent_slug: "patent-scout",
          title: "Patent and IP filings",
          instruction:
            "Search Google Patents and the USPTO for patents and published applications assigned to Figma filed in the last three years. For each one, give the patent or publication number, title, filing date, a plain-language sentence on what it claims, and a URL. If you find none, say so plainly rather than guessing at numbers.",
          needs_approval: false,
          position: { x: 0, y: ROW },
        },
        {
          id: "positioning-brief",
          agent_slug: "deep-research",
          title: "Write the positioning brief",
          instruction:
            "Using the competitor news and the patent findings from the two previous steps, write a one-page positioning brief with exactly three sections: (1) what they are investing in, (2) where the product is heading over the next year, (3) two specific gaps a smaller competitor could attack. Cite the source URLs the earlier steps gave you for every factual claim, and label anything you are inferring as an inference.",
          needs_approval: false,
          position: { x: COL, y: ROW / 2 },
        },
        {
          id: "slack-digest",
          agent_slug: "competitor-monitor",
          title: "Post the digest to Slack",
          instruction:
            "Turn the positioning brief above into a five-bullet Slack digest: one short plain-text line per bullet, no markdown headings, most material change first. Then actually call the send_slack tool with it. If the brief found nothing material, still send a one-line note saying so.",
          needs_approval: true,
          position: { x: COL * 2, y: ROW / 2 },
        },
      ],
      edges: [
        { id: "moves-brief", source: "recent-moves", target: "positioning-brief" },
        { id: "ip-brief", source: "ip-filings", target: "positioning-brief" },
        { id: "brief-slack", source: "positioning-brief", target: "slack-digest" },
      ],
    },
  },
  {
    id: "quarterly-sales-review",
    name: "Quarterly sales review",
    description:
      "Three SQL queries run at the same time against the demo sales schema, then one step turns their real numbers into a written review.",
    shape: "Three-way fan-out into one step — only 2 waves for 4 steps.",
    graph: {
      schema_version: 1,
      nodes: [
        {
          id: "by-region",
          agent_slug: "sql-analytics",
          title: "Revenue by region",
          instruction:
            "Query analytics_sales for total revenue (SUM(quantity * unit_price)) grouped by region over the last 90 days, ordered highest first. Show the exact SQL you ran in a ```sql block and report the real numbers it returned — never estimate.",
          needs_approval: false,
          position: { x: 0, y: 0 },
        },
        {
          id: "top-products",
          agent_slug: "data-analyst",
          title: "Top products, charted",
          instruction:
            "Query analytics_sales for the top five products by revenue (SUM(quantity * unit_price)) over the last 90 days. Show the SQL you ran, report the real numbers, and include a ```vega-lite bar chart built from exactly the rows the query returned.",
          needs_approval: false,
          position: { x: 0, y: ROW },
        },
        {
          id: "customer-mix",
          agent_slug: "sql-analytics",
          title: "Customer mix by plan",
          instruction:
            "Query analytics_customers for a count of customers grouped by plan (Free, Pro, Enterprise) and by region. Show the SQL you ran and report the real counts, including any plan or region that came back with zero customers.",
          needs_approval: false,
          position: { x: 0, y: ROW * 2 },
        },
        {
          id: "review",
          agent_slug: "orchestrator",
          title: "Write the quarterly review",
          instruction:
            "Using only the numbers the three queries above returned, write a one-page review covering: the headline revenue figure, the strongest and the weakest region, the top product by revenue, and how the customer mix splits across plans. Quote the actual figures. Finish with one question this data cannot answer, and say what would be needed to answer it.",
          needs_approval: false,
          position: { x: COL, y: ROW },
        },
      ],
      edges: [
        { id: "region-review", source: "by-region", target: "review" },
        { id: "products-review", source: "top-products", target: "review" },
        { id: "mix-review", source: "customer-mix", target: "review" },
      ],
    },
  },
  {
    id: "architecture-decision",
    name: "Architecture decision record",
    description:
      "Survey the real options for a technical choice, design the simplest one that fits, then write it up as a one-page ADR.",
    shape: "3 steps in a straight line — each one reads the step before it.",
    graph: {
      schema_version: 1,
      nodes: [
        {
          id: "survey",
          agent_slug: "deep-research",
          title: "Survey the options",
          instruction:
            "Research the current options for running background jobs in a Python FastAPI service: Celery, Arq, Dramatiq, and Postgres-backed queues such as pgqueuer. For each one, report project maturity and release activity, what infrastructure it requires to operate, and what tends to break at scale. Read the docs or posts with fetch_url before citing them, and give a URL per claim.",
          needs_approval: false,
          position: { x: 0, y: 0 },
        },
        {
          id: "design",
          agent_slug: "system-architect",
          title: "Design the simplest option",
          instruction:
            "From the survey above, pick the simplest option that still supports automatic retries and scheduled jobs. Justify the choice against each rejected alternative in one paragraph apiece, using only the facts the survey established. Include a Mermaid diagram of the resulting deployment in a ```mermaid block, and name the trade-offs you are knowingly accepting.",
          needs_approval: false,
          position: { x: COL, y: 0 },
        },
        {
          id: "adr",
          agent_slug: "creative-writer",
          title: "Write it up as an ADR",
          instruction:
            "Turn the decision above into a one-page architecture decision record with exactly four sections: Context, Decision, Consequences, and Alternatives considered. Stay under 400 words. Preserve the trade-offs exactly as the previous step stated them — do not soften or drop any of them, and add no new claims.",
          needs_approval: false,
          position: { x: COL * 2, y: 0 },
        },
      ],
      edges: [
        { id: "survey-design", source: "survey", target: "design" },
        { id: "design-adr", source: "design", target: "adr" },
      ],
    },
  },
];
