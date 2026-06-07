// JARVIS — people-sync Edge Function
// Syncs iCloud contacts via CardDAV → saves to people table
// Vault keys: APPLE_CALDAV_USER, APPLE_CALDAV_PASSWORD

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CARDDAV_URL = 'https://contacts.icloud.com';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const CALDAV_USER = Deno.env.get('APPLE_CALDAV_USER');
    const CALDAV_PASS = Deno.env.get('APPLE_CALDAV_PASSWORD');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!CALDAV_USER || !CALDAV_PASS) {
      return new Response(JSON.stringify({ ok: false, error: 'APPLE_CALDAV_USER or APPLE_CALDAV_PASSWORD not set' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const auth = 'Basic ' + btoa(CALDAV_USER + ':' + CALDAV_PASS);

    // Step 1: Discover principal URL
    const principalRes = await fetch(CARDDAV_URL + '/', {
      method: 'PROPFIND',
      headers: {
        'Authorization': auth,
        'Depth': '0',
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop><D:current-user-principal/></D:prop>
</D:propfind>`,
    });

    const principalText = await principalRes.text();
    const hrefMatch = principalText.match(/<D:href>([^<]+)<\/D:href>/);
    if (!hrefMatch) throw new Error('Could not discover principal URL');

    const principalPath = hrefMatch[1];
    const baseUrl = CARDDAV_URL + principalPath;

    // Step 2: Find address book home
    const abHomeRes = await fetch(CARDDAV_URL + principalPath, {
      method: 'PROPFIND',
      headers: {
        'Authorization': auth,
        'Depth': '0',
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <D:prop><card:addressbook-home-set/></D:prop>
</D:propfind>`,
    });

    const abHomeText = await abHomeRes.text();
    const abMatch = abHomeText.match(/<[^>]*href>([^<]+)<\/[^>]*href>/);
    if (!abMatch) throw new Error('Could not find address book home');

    const abHomePath = abMatch[1];

    // Step 3: Fetch all contacts (vCards)
    const vcardRes = await fetch(CARDDAV_URL + abHomePath, {
      method: 'REPORT',
      headers: {
        'Authorization': auth,
        'Depth': '1',
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<card:addressbook-query xmlns:D="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <card:address-data/>
  </D:prop>
</card:addressbook-query>`,
    });

    const vcardText = await vcardRes.text();

    // Parse vCards
    const contacts: Array<{name: string, phone: string|null, email: string|null, birthday: string|null, icloud_uid: string}> = [];
    const vcardBlocks = vcardText.match(/BEGIN:VCARD[\s\S]*?END:VCARD/g) || [];

    for (const vcard of vcardBlocks) {
      const fnMatch = vcard.match(/FN:(.+)/);
      const name = fnMatch?.[1]?.trim();
      if (!name || name.includes('@')) continue;

      const telMatch = vcard.match(/TEL[^:]*:([^\r\n]+)/);
      const emailMatch = vcard.match(/EMAIL[^:]*:([^\r\n]+)/);
      const bdayMatch = vcard.match(/BDAY:(\d{4}-?\d{2}-?\d{2})/);
      const uidMatch = vcard.match(/UID:([^\r\n]+)/);

      let bday: string|null = null;
      if (bdayMatch) {
        const raw = bdayMatch[1].replace(/-/g, '');
        bday = raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8);
      }

      contacts.push({
        name,
        phone: telMatch?.[1]?.trim().replace(/[\s\-\(\)]/g,'') || null,
        email: emailMatch?.[1]?.trim() || null,
        birthday: bday,
        icloud_uid: uidMatch?.[1]?.trim() || '',
      });
    }

    // Step 4: Upsert to Supabase (skip existing icloud_uid, skip core circle)
    let added = 0;
    for (const contact of contacts) {
      if (!contact.icloud_uid) continue;
      const res = await fetch(SUPABASE_URL + '/rest/v1/people', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'apikey': SUPABASE_KEY!,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          birthday: contact.birthday,
          icloud_uid: contact.icloud_uid,
          is_core_circle: false,
        }),
      });
      if (res.ok) added++;
    }

    return new Response(JSON.stringify({ ok: true, added, total: contacts.length }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('[people-sync]', e.message);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
