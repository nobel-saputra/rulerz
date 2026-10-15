import { getModels } from "../../lib/models";

export async function GET() {
  const { free } = await getModels();
  return Response.json(
    { models: free },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
