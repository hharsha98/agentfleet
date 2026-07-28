import WorkflowBuilder from "@/components/workflow/workflow-builder";

// Thin server shell: all data fetching and editing state lives in the
// client builder below. `params` is a Promise in this Next version, so it
// must be awaited (verified against node_modules/next/dist/docs/01-app/
// 03-api-reference/03-file-conventions/page.md — "Page Props Helper":
// PageProps<'/route'> is a globally available generated helper, filled in
// from .next/types/routes.d.ts at build/dev/typegen time, no import
// needed).
export default async function WorkflowBuilderPage(props: PageProps<"/workflows/[id]">) {
  const { id } = await props.params;
  return <WorkflowBuilder workflowId={id} />;
}
