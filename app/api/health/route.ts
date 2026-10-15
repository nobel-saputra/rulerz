import { getModels } from "../../lib/models";

export async function GET() {
  const { free } = await getModels();
  return Response.json({ ok: !!process.env.OPENROUTER_API_KEY, freeModels: free.length });
}
