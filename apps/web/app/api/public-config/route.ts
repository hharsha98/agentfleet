import { publicConfigFromEnv } from "@/lib/public-config";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(publicConfigFromEnv(), {
    headers: { "Cache-Control": "no-store" },
  });
}
