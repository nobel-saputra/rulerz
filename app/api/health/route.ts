export const runtime = "nodejs";

export async function GET() {
  let freeModels = 0;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models");
    const j = await r.json();
    freeModels = j.data.filter((m: any) => m.id.endsWith(":free")).length;
  } catch {
    freeModels = 0;
  }
  return Response.json({ ok: !!process.env.OPENROUTER_API_KEY, freeModels });
}
