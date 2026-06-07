// JARVIS — people-sync Edge Function
// Syncs iCloud contacts via CardDAV → saves to people table
// Vault keys: APPLE_CALDAV_USER, APPLE_CALDAV_PASSWORD (same as calendar)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const CALDAV_USER = Deno.env.get('APPLE_CALDAV_USER') ?? '';
  const CALDAV_PASS = Deno.env.get('APPLE_CALDAV_PASSWORD') ?? '';
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!CALDAV_USER || !CALDAV_PASS) {
    return new Response(JSON.stringify({ ok: false, error: 'APPLE_CALDAV_USER or APPLE_CALDAV_PASSWORD not set in Vault' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const auth = 'Basic ' + btoa(CALDAV_USER + ':' + CALDAV_PASS);

  try {
    // Step 1: Well-known discovery (same pattern as apple-calendar that works)
    let principalUrl = '';
    try {
      const wk = await fetch('https://contacts.icloud.com/.well-known/carddav', {
        method: 'PROPFIND',
        redirect: 'follow',
        headers: { 'Authorization': auth, 'Depth': '0', 'Content-Type': 'application/xml' },
        body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`,
      });
      const txt = await wk.text();
      const m = txt.match(/<[^>]*href[^>]*>\s*([^<]+principal[^<]*)\s*<\/[^>]*href>/i);
      if (m) principalUrl = m[1].startsWith('http') ? m[1] : `https://contacts.icloud.com${m[1]}`;
    } catch (_) { /* fall through to fallback */ }

    // Fallback: derive from CalDAV user ID (Apple uses numeric DSID in path)
    if (!principalUrl) {
      // Extract user ID from CALDAV_USER email by trying known p-caldav hosts
      const userPrefix = CALDAV_USER.split('@')[0];
      principalUrl = `https://contacts.icloud.com/${userPrefix}/principal/`;
    }

    // Step 2: Find addressbook-home-set
    const abRes = await fetch(principalUrl, {
      method: 'PROPFIND',
      headers: { 'Authorization': auth, 'Depth': '0', 'Content-Type': 'application/xml' },
      body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><D:prop><card:addressbook-home-set/></D:prop></D:propfind>`,
    });
    const abTxt = await abRes.text();
    const abMatch = abTxt.match(/<[^>]*href[^>]*>\s*([^<]+)\s*<\/[^>]*href>/ig);
    let abHomePath = '';
    if (abMatch) {
      for (const m of abMatch) {
        const inner = m.replace(/<[^>]+>/g, '').trim();
        if (inner.includes('carddav') || inner.includes('addressbook') || (inner !== '/' && inner !== principalUrl)) {
          abHomePath = inner.startsWith('http') ? inner : `https://contacts.icloud.com${inner}`;
          break;
        }
      }
    }
    if (!abHomePath) abHomePath = principalUrl.replace('/principal/', '/carddavhome/card/');

    // Step 3: Fetch all vCards
    const vcRes = await fetch(abHomePath, {
      method: 'REPORT',
      headers: { 'Authorization': auth, 'Depth': '1', 'Content-Type': 'application/xml' },
      body: `<?xml version="1.0"?><card:addressbook-query xmlns:D="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><D:prop><D:getetag/><card:address-data/></D:prop></card:addressbook-query>`,
    });
    const vcText = await vcRes.text();

    if (!vcRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: `CardDAV fetch failed: ${vcRes.status}`, url: abHomePath }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Step 4: Parse vCards
    const vcardBlocks = vcText.match(/BEGIN:VCARD[\s\S]*?END:VCARD/g) ?? [];
    const contacts = [];
    for (const vcard of vcardBlocks) {
      const fnMatch = vcard.match(/^FN[;:](.+)/m);
      const name = fnMatch?.[1]?.trim().replace(/^;/, '');
      if (!name || name.includes('@') || name.length < 2) continue;
      const telMatch = vcard.match(/^TEL[^:]*:(.+)/m);
      const emailMatch = vcard.match(/^EMAIL[^:]*:(.+)/m);
      const bdayMatch = vcard.match(/^BDAY[;:](\d{4}-?\d{2}-?\d{2})/m);
      const uidMatch = vcard.match(/^UID[;:](.+)/m);
      let bday: string | null = null;
      if (bdayMatch) {
        const raw = bdayMatch[1].replace(/-/g, '');
        bday = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
      }
      contacts.push({
        name,
        phone: telMatch?.[1]?.trim().replace(/[\s\-\(\)\.]/g, '') ?? null,
        email: emailMatch?.[1]?.trim() ?? null,
        birthday: bday,
        icloud_uid: uidMatch?.[1]?.trim() ?? '',
      });
    }

    // Step 5: Upsert — skip core circle (no icloud_uid), skip duplicates
    let added = 0;
    for (const c of contacts) {
      if (!c.icloud_uid) continue;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/people`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey': SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({ name: c.name, phone: c.phone, email: c.email, birthday: c.birthday, icloud_uid: c.icloud_uid, is_core_circle: false }),
      });
      if (r.ok || r.status === 409) added++;
    }

    return new Response(JSON.stringify({ ok: true, added, total: contacts.length, addressbook: abHomePath }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
