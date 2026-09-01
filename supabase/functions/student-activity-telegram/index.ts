const corsHeaders = {
  "Access-Control-Allow-Origin": "https://kafelife13-cpu.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST 요청만 지원합니다." }, 405);
  try {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || Deno.env.get("TG_BOT_TOKEN");
    const chatId = Deno.env.get("TELEGRAM_CHAT_ID") || Deno.env.get("TG_CHAT_ID");
    if (!token || !chatId) return json({ error: "텔레그램 비밀키가 설정되지 않았습니다." }, 503);
    const body = await req.json();
    const studentName = clean(body?.student_name, 60) || "학생";
    const studentId = clean(body?.student_id, 60);
    const activity = clean(body?.activity, 80) || "학생 활동";
    const detail = clean(body?.detail, 800);
    const occurredAt = body?.occurred_at ? new Date(body.occurred_at) : new Date();
    if (Number.isNaN(occurredAt.getTime())) return json({ error: "활동 시간이 올바르지 않습니다." }, 400);
    const stamp = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(occurredAt);
    const text = [
      "🔔 국어왕 학생 활동",
      `학생: ${studentName}${studentId ? ` (${studentId})` : ""}`,
      `활동: ${activity}`,
      detail ? `내용: ${detail}` : "",
      `시간: ${stamp}`,
    ].filter(Boolean).join("\n");
    const telegram = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const result = await telegram.json();
    if (!telegram.ok || !result?.ok) return json({ error: result?.description || "텔레그램 전송 실패" }, 502);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function clean(value: unknown, max: number) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
