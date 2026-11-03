// JIMS WhatsApp Gateway — Phase 1 (staging; incoming webhook, paused).
// NEVER treat a WhatsApp click as a financial approval.
// Meta's verify_jwt must be disabled for a third-party webhook; GET challenge
// and POST X-Hub-Signature-256 are independently authenticated below.
const encoder = new TextEncoder();
function response(body: unknown, code = 200) {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: {"content-type": "application/json; charset=utf-8", "cache-control": "no-store"},
  });
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let i=0; i<a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
async function metaValid(raw: string, header: string, secret: string) {
  if (!/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(raw)));
  const expected = "sha256=" + [...digest].map(x=>x.toString(16).padStart(2,"0")).join("");
  return safeEqual(expected, header.toLowerCase());
}
Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const verify = Deno.env.get("JIMS_WA_VERIFY_TOKEN");
      if (!verify) return response({error:"Meta verification not configured"},503);
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode !== "subscribe" || !token || !safeEqual(token,verify) ||
          !challenge || challenge.length > 512) {
        return response({error:"Invalid verification"},403);
      }
      return new Response(challenge, {
        status:200, headers: {"content-type":"text/plain; charset=utf-8","cache-control":"no-store"},
      });
    }
    if (req.method !== "POST") return response({error:"Method not allowed"},405);
    const secret = Deno.env.get("JIMS_WA_META_APP_SECRET");
    if (!secret) return response({error:"Meta signature verification not configured"},503);
    if (Number(req.headers.get("content-length")||0) > 131072) return response({error:"Too large"},413);
    const raw = await req.text();
    if (encoder.encode(raw).length > 131072) return response({error:"Too large"},413);
    if (!await metaValid(raw, req.headers.get("x-hub-signature-256")||"", secret))
      return response({error:"Invalid signature"},403);
    const event = JSON.parse(raw);
    if (!event || event.object !== "whatsapp_business_account")
      return response({error:"Unexpected event type"},400);

    // Phase-1 fail-closed: do not process action clicks, create sessions,
    // send messages, update vouchers, or acknowledge an actual financial approval.
    // Phase 2 adds independently authenticated + MFA-verified decision execution
    // using the existing JIMS CEO/BOD role and current-round authority checks.
    return response({received:true, gateway:"paused", approvals_processed:0});
  } catch {
    return response({error:"Invalid webhook request"},400);
  }
});
