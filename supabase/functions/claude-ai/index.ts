const corsHeaders = {
  "Access-Control-Allow-Origin": "https://kafelife13-cpu.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: { message: "POST 요청만 지원합니다." } }, 405);

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: { message: "서버에 Claude API 키가 설정되지 않았습니다." } }, 503);

    const requestBody = await req.json();
    const payload = requestBody?.payload;
    if (!payload || !Array.isArray(payload.messages)) {
      return json({ error: { message: "AI 요청 형식이 올바르지 않습니다." } }, 400);
    }

    // 클라이언트가 임의의 고비용 모델·토큰 수를 지정하지 못하게 서버에서 제한합니다.
    const safePayload = {
      ...payload,
      model: "claude-sonnet-5",
      max_tokens: Math.min(Math.max(Number(payload.max_tokens) || 2000, 1), 4000),
    };

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(safePayload),
    });
    const data = await upstream.json();
    return json(data, upstream.status);
  } catch (error) {
    return json({ error: { message: error instanceof Error ? error.message : String(error) } }, 500);
  }
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
