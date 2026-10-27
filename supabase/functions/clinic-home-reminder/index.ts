const corsHeaders = {
  "Access-Control-Allow-Origin": "https://kafelife13-cpu.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
}

function normalizePhone(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

async function makeSignature(secret: string, date: string, salt: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(date + salt));
  return Array.from(new Uint8Array(signed)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function solapiFetch(apiKey: string, apiSecret: string, url: string, init: RequestInit = {}) {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replaceAll("-", "");
  const signature = await makeSignature(apiSecret, date, salt);
  return fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}` } });
}

async function rpc(name: string, payload: Record<string, unknown> = {}) {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: key!, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Database operation failed (${response.status})`);
  return response.json();
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({error:'POST required'},405);
  try {
    const savedPin=Deno.env.get('SOLAPI_SEND_PIN');
    const body=await req.json();
    if(!savedPin || String(body.sendPin??'')!==savedPin) return json({error:'Unauthorized'},403);
    const apiKey=Deno.env.get('SOLAPI_API_KEY'),apiSecret=Deno.env.get('SOLAPI_API_SECRET');
    const sender=normalizePhone(Deno.env.get('SOLAPI_SENDER_NUMBER'));
    if(!apiKey||!apiSecret||!sender||!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return json({error:'Configuration missing'},503);
    // SQL remains disabled until the owner approves this exact recurring message.
    await rpc('clinic_home_prepare_reminders');
    let accepted=0,uncertain=0;
    for(let i=0;i<100;i++) {
      const item=await rpc('clinic_home_claim_message');if(!item)break;
      let status='unknown',reference=null;
      try {
        const response=await solapiFetch(apiKey,apiSecret,'https://api.solapi.com/messages/v4/send-many/detail',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({messages:[{to:item.recipient,from:sender,text:item.text}]}),
          signal:AbortSignal.timeout(20000),
        });
        const result=await response.json();
        reference=result?.groupInfo?.groupId||result?.groupId||null;
        // Provider acceptance is not a delivered-to-handset claim.
        if(response.ok&&Number(result?.groupInfo?.count?.registeredSuccess)===1) {status='accepted';accepted++;}
        else if(response.status>=400&&response.status<500)status='failed';
      } catch { /* Uncertain network outcome must never be retried automatically. */ }
      await rpc('clinic_home_finish_message',{p_id:item.id,p_status:status,p_reference:reference});
      if(status!=='accepted')uncertain++;
    }
    return json({success:true,accepted,needsReview:uncertain});
  } catch { return json({error:'Clinic reminder processing failed; inspect claimed messages before retrying.'},500); }
});

