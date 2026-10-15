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
    if (!token) return json({ error: "텔레그램 봇 토큰이 설정되지 않았습니다." }, 503);
    const configuredChatId = Deno.env.get("TELEGRAM_CHAT_ID") || Deno.env.get("TG_CHAT_ID");
    const body = await req.json();
    const category = activityCategory(String(body?.activity || ""));
    let routes: Record<string, string> = {};
    try { routes = JSON.parse(Deno.env.get("TELEGRAM_CATEGORY_CHAT_IDS") || "{}"); } catch { return json({ error: "텔레그램 알림방 설정을 확인해 주세요." }, 503); }
    const routedChatId = String(routes[category] || "");
    if (routedChatId && !/^-?\d+$/.test(routedChatId)) return json({ error: "텔레그램 알림방 번호가 올바르지 않습니다." }, 503);
    const chatId = routedChatId || configuredChatId || await findLatestPrivateChatId(token);
    if (!chatId) return json({ error: "봇 채팅방을 찾지 못했습니다. 텔레그램에서 봇에게 메시지를 한 번 보내주세요." }, 503);
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
      `🔔 국어왕 · ${categoryLabels[category] || "학생 활동"}`,
      `학생: ${studentName}${studentId ? ` (${studentId})` : ""}`,
      `활동: ${activity}`,
      detail ? `내용: ${detail}` : "",
      `시간: ${stamp}`,
    ].filter(Boolean).join("\n");
    // Standard Bot API only: never enable paid broadcasts. Respect Telegram's retry delay.
    for (let attempt = 0; attempt < 3; attempt++) {
      const telegram = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      const result = await telegram.json();
      if (telegram.ok && result?.ok) return json({ ok: true, category });
      const retryAfter = Number(result?.parameters?.retry_after || 0);
      if (telegram.status === 429 && retryAfter > 0 && retryAfter <= 40 && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, (retryAfter + 1) * 1000));
        continue;
      }
      return json({ error: result?.description || "텔레그램 전송 실패" }, 502);
    }
    return json({ error: "텔레그램 재시도 횟수를 초과했습니다." }, 502);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});


const categoryLabels: Record<string, string> = {
  homework: "과제입력", clinic_grading: "클리닉 채점", scores: "성적입력",
  clinic_requests: "클리닉 변경신청", attendance: "출결", qa: "질의응답", consultation: "상담신청",
};
function activityCategory(activity: string) {
  if (/상담/.test(activity)) return "consultation";
  if (/등원|하원|출결|출석|결석|지각/.test(activity)) return "attendance";
  if (/질문|Q&A|질의|답변/.test(activity)) return "qa";
  if (/클리닉.*신청|클리닉.*변경|클리닉.*취소/.test(activity)) return "clinic_requests";
  if (/클리닉.*채점|클리닉.*재풀이/.test(activity)) return "clinic_grading";
  if (/과제|숙제/.test(activity)) return "homework";
  if (/성적|시험.*제출|모의고사|재채점|어휘.*제출|오답 OX/.test(activity)) return "scores";
  return "activity";
}

async function findLatestPrivateChatId(token: string) {
  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  if (!response.ok) return "";
  const data = await response.json();
  const updates = Array.isArray(data?.result) ? data.result : [];
  for (let i = updates.length - 1; i >= 0; i--) {
    const chat = updates[i]?.message?.chat || updates[i]?.edited_message?.chat;
    if (chat?.id && chat?.type === "private") return String(chat.id);
  }
  return "";
}

function clean(value: unknown, max: number) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
