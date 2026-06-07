// JARVIS — people-sync Edge Function v3
// Syncs iCloud contacts via CardDAV → updates core circle info + adds full contact list
// Vault keys: APPLE_CALDAV_USER, APPLE_CALDAV_PASSWORD

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Known iCloud contact hosts to try (shard may vary, try common ones)
const CONTACT_HOSTS = [
  'https://p171-contacts.icloud.com',
  'https://p01-contacts.icloud.com',
  'https://p06-contacts.icloud.com',
  'https://contacts.icloud.com',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const CALDAV_USER = Deno.env.get('APPLE_CALDAV_USER') ?? '';
  const CALDAV_PASS = Deno.env.get('APPLE_CALDAV_PASSWORD') ?? '';
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!CALDAV_USER || !CALDAV_PASS) {
    return new Response(JSON.stringify({ ok: false, error: 'APPLE_CALDAV_USER or APPLE_CALDAV_PASSWORD not set' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const auth = 'Basic ' + btoa(CALDAV_USER + ':' + CALDAV_PASS);
  const supaHeaders = { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' };

  try {
    // ── Step 1: Fetch existing people ──
    const existingRes = await fetch(`${SUPABASE_URL}/rest/v1/people?select=id,name,contact_name,icloud_uid,is_core_circle`, { headers: supaHeaders });
    const existing: Array<{id:number,name:string,contact_name:string|null,icloud_uid:string|null,is_core_circle:boolean}> = existingRes.ok ? await existingRes.json() : [];
    const byContactName = new Map<string, typeof existing[0]>();
    const byIcloudUid = new Map<string, typeof existing[0]>();
    for (const p of existing) {
      if (p.contact_name) byContactName.set(p.contact_name.toLowerCase().trim(), p);
      if (p.icloud_uid) byIcloudUid.set(p.icloud_uid, p);
    }

    // ── Step 2: Discover user ID via CalDAV well-known (reuse working pattern) ──
    let userId = '17710551327'; // known from working CalDAV session
    let contactHost = 'https://p171-contacts.icloud.com';

    try {
      const wk = await fetch('https://contacts.icloud.com/.well-known/carddav', {
        method: 'PROPFIND', redirect: 'follow',
        headers: { 'Authorization': auth, 'Depth': '0', 'Content-Type': 'application/xml' },
        body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`,
      });
      const txt = await wk.text();
      // Extract numeric user ID from href like /17710551327/principal/
      const idMatch = txt.match(/\/(\d{8,12})\//);
      if (idMatch) userId = idMatch[1];
      // Extract host from href if absolute URL
      const hostMatch = txt.match(/https?:\/\/(p\d+-contacts\.icloud\.com)/i);
      if (hostMatch) contactHost = `https://${hostMatch[1]}`;
    } catch (_) { /* use known defaults */ }

    // ── Step 3: Try REPORT on known URL patterns ──
    const candidateUrls = [
      `${contactHost}/${userId}/carddavhome/card/`,
      `${contactHost}/${userId}/carddavhome/`,
      `https://contacts.icloud.com/${userId}/carddavhome/card/`,
      `https://contacts.icloud.com/${userId}/carddavhome/`,
    ];

    let vcText = '';
    let successUrl = '';

    for (const url of candidateUrls) {
      try {
        const r = await fetch(url, {
          method: 'REPORT',
          headers: { 'Authorization': auth, 'Depth': '1', 'Content-Type': 'application/xml' },
          body: `<?xml version="1.0"?><card:addressbook-query xmlns:D="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><D:prop><D:getetag/><card:address-data/></D:prop></card:addressbook-query>`,
        });
        if (r.ok) {
          vcText = await r.text();
          if (vcText.includes('BEGIN:VCARD')) { successUrl = url; break; }
        }
      } catch (_) { continue; }
    }

    // Debug: return first 3 vCards raw if ?debug=1
    const url2 = new URL(req.url);
    if (url2.searchParams.get('debug') === '1') {
      const sample = (vcText.match(/BEGIN:VCARD[\s\S]*?END:VCARD/g) ?? []).slice(0,3);
      return new Response(JSON.stringify({ url: successUrl, sample }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (!vcText || !vcText.includes('BEGIN:VCARD')) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'No vCards found — tried all known URL patterns',
        userId,
        contactHost,
        tried: candidateUrls,
      }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── Step 4: Parse vCards ──
    const vcardBlocks = vcText.match(/BEGIN:VCARD[\s\S]*?END:VCARD/g) ?? [];
    let updated = 0, added = 0;

    for (const vcard of vcardBlocks) {
      const fnMatch = vcard.match(/^FN[;:](.+)/m);
      const name = fnMatch?.[1]?.trim().replace(/\r/g, '');
      if (!name || name.length < 2) continue;

      // Handle vCard 3.0 (TEL;TYPE=CELL:+1234) and 4.0 (TEL;VALUE=uri:tel:+1234)
      const telRaw = vcard.match(/^TEL[^:]*:(.+)/m)?.[1]?.trim().replace(/\r/g, '') ?? null;
      const phone = telRaw ? telRaw.replace(/^tel:/i, '').replace(/[\s\-\(\)\.]/g, '') : null;
      const email = vcard.match(/^EMAIL[^:]*:(.+)/m)?.[1]?.trim().replace(/\r/g, '') ?? null;
      const icloud_uid = vcard.match(/^UID[;:](.+)/m)?.[1]?.trim().replace(/\r/g, '') ?? '';

      let bday: string|null = null;
      // Handle all Apple vCard birthday formats:
      // BDAY:1990-01-15  |  BDAY:19900115  |  BDAY;VALUE=date:1990-01-15
      // BDAY;X-APPLE-OMIT-YEAR=1604:1604-01-15  |  BDAY:--0115 (no year)
      const bdayLine = vcard.match(/^BDAY[^:]*:(.+)/m)?.[1]?.trim().replace(/\r/g,'') ?? '';
      if (bdayLine && !bdayLine.startsWith('--')) {
        const raw = bdayLine.replace(/-/g, '').replace(/T.*/, '');
        // Skip Apple's fake year 1604 (means no year saved) — store as current-year placeholder
        const year = raw.slice(0,4);
        if (raw.length >= 8 && year !== '1604') {
          bday = `${year}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
        } else if (raw.length >= 4 && year !== '1604') {
          // partial date — skip
          bday = null;
        }
      }

      // Only patch fields that actually exist in iCloud — never overwrite with null
      const patch: Record<string,unknown> = {};
      if (icloud_uid) patch.icloud_uid = icloud_uid;
      if (phone) patch.phone = phone;
      if (email) patch.email = email;
      if (bday) patch.birthday = bday;

      const existByUid = icloud_uid ? byIcloudUid.get(icloud_uid) : undefined;
      const existByName = byContactName.get(name.toLowerCase().trim());
      const match = existByUid ?? existByName;

      if (match) {
        // Update existing person (core circle or prior sync) with iCloud data
        await fetch(`${SUPABASE_URL}/rest/v1/people?id=eq.${match.id}`, {
          method: 'PATCH', headers: supaHeaders, body: JSON.stringify(patch),
        });
        if (icloud_uid && !byIcloudUid.has(icloud_uid)) byIcloudUid.set(icloud_uid, match);
        updated++;
      } else if (icloud_uid && !byIcloudUid.has(icloud_uid)) {
        // New contact — insert
        const r = await fetch(`${SUPABASE_URL}/rest/v1/people`, {
          method: 'POST',
          headers: { ...supaHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ name, phone, email, birthday: bday, icloud_uid, is_core_circle: false }),
        });
        if (r.ok) {
          byIcloudUid.set(icloud_uid, { id: -1, name, contact_name: name, icloud_uid, is_core_circle: false });
          added++;
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, updated, added, total: vcardBlocks.length, url: successUrl }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
