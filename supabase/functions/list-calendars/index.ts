
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const USER = Deno.env.get("APPLE_CALDAV_USER") ?? "";
  const PASS = Deno.env.get("APPLE_CALDAV_PASSWORD") ?? "";
  const auth = "Basic " + btoa(USER + ":" + PASS);

  // Well-known discovery
  const wk = await fetch("https://caldav.icloud.com/.well-known/caldav", {
    method: "PROPFIND", redirect: "follow",
    headers: { Authorization: auth, Depth: "0", "Content-Type": "application/xml" },
    body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`,
  });
  const wkTxt = await wk.text();
  const hrefMatch = wkTxt.match(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/i);
  const principalPath = hrefMatch?.[1] ?? "/17710551327/principal/";
  const principalUrl = principalPath.startsWith("http") ? principalPath : `https://p171-caldav.icloud.com${principalPath}`;

  // Get calendar home
  const homeRes = await fetch(principalUrl, {
    method: "PROPFIND",
    headers: { Authorization: auth, Depth: "0", "Content-Type": "application/xml" },
    body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>`,
  });
  const homeTxt = await homeRes.text();
  const homeMatch = homeTxt.match(/<[^>]*href[^>]*>([^<]+calendars[^<]*)<\/[^>]*href>/i);
  const homeUrl = homeMatch?.[1]?.startsWith("http") ? homeMatch[1] : `https://p171-caldav.icloud.com${homeMatch?.[1] ?? "/17710551327/calendars/"}`;

  // List all collections
  const listRes = await fetch(homeUrl, {
    method: "PROPFIND",
    headers: { Authorization: auth, Depth: "1", "Content-Type": "application/xml" },
    body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:displayname/><D:resourcetype/><C:supported-calendar-component-set/></D:prop></D:propfind>`,
  });
  const listTxt = await listRes.text();

  // Parse all collections with names and types
  const collections: {name: string, url: string, types: string[]}[] = [];
  const responses = listTxt.match(/<[^>]*response[^>]*>[\s\S]*?<\/[^>]*response>/gi) ?? [];
  for (const r of responses) {
    const href = r.match(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/i)?.[1]?.trim() ?? "";
    const name = r.match(/<displayname[^>]*>([^<]*)<\/displayname>/i)?.[1]?.trim() ?? "";
    const comps = [...r.matchAll(/name=["']([A-Z]+)["']/gi)].map(m => m[1]);
    if (href && href !== homeUrl && !href.endsWith("/calendars/")) {
      collections.push({ name, url: href, types: comps });
    }
  }

  return new Response(JSON.stringify({ homeUrl, collections }, null, 2), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
