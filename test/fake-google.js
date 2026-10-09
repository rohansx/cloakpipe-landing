// In-memory stand-in for the Google token endpoint and the Sheets v4 API,
// used as `fetch` in tests. It records every call and models one spreadsheet.

export const SHEET_ID = 'sheet-123';
export const TOKEN = 'ya29.secret-access-token';

export function fakeGoogle({ tabs = { Waitlist: [] }, failAt = null, failStatus = 500 } = {}) {
  const calls = [];
  const sheet = { tabs: structuredClone(tabs) };

  const tabOf = (range) => {
    const m = /^'((?:[^']|'')+)'!/.exec(range);
    return m ? m[1].replace(/''/g, "'") : null;
  };
  const fail = (stage) =>
    new Response(JSON.stringify({ error: { code: failStatus, message: `boom at ${stage} for ${SHEET_ID}`, status: 'INTERNAL' } }), { status: failStatus });

  async function fetch(input, init = {}) {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ url, method, headers: new Headers(init.headers), body: init.body });

    if (url.href === 'https://oauth2.googleapis.com/token') {
      if (failAt === 'token') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      return Response.json({ access_token: TOKEN, expires_in: 3600 });
    }
    if (new Headers(init.headers).get('authorization') !== `Bearer ${TOKEN}`) return new Response('{}', { status: 401 });

    const prefix = `/v4/spreadsheets/${SHEET_ID}`;
    if (url.origin !== 'https://sheets.googleapis.com' || !url.pathname.startsWith(prefix)) return new Response('{}', { status: 404 });
    const rest = url.pathname.slice(prefix.length);

    if (rest === ':batchUpdate' && method === 'POST') {
      if (failAt === 'addSheet') return fail('addSheet');
      const req = JSON.parse(init.body).requests[0].addSheet.properties.title;
      sheet.tabs[req] = [];
      return Response.json({ replies: [{ addSheet: { properties: { title: req } } }] });
    }

    const m = /^\/values\/([^:]+)(:append)?$/.exec(rest);
    if (!m) return new Response('{}', { status: 404 });
    const range = decodeURIComponent(m[1]);
    const tab = tabOf(range);
    if (!(tab in sheet.tabs)) {
      return new Response(JSON.stringify({ error: { code: 400, message: `Unable to parse range: ${range}`, status: 'INVALID_ARGUMENT' } }), { status: 400 });
    }
    const rows = sheet.tabs[tab];

    if (method === 'GET') {
      if (failAt === 'read') return fail('read');
      const values = rows.map((r) => r.slice(0, 2));
      return Response.json(values.length ? { range, values } : { range });
    }
    if (method === 'PUT') {
      if (failAt === 'header') return fail('header');
      const { values } = JSON.parse(init.body);
      rows[0] = values[0];
      return Response.json({ updatedRange: range });
    }
    if (method === 'POST' && m[2]) {
      if (failAt === 'append') return fail('append');
      const { values } = JSON.parse(init.body);
      rows.push(...values);
      return Response.json({ updates: { updatedRows: values.length } });
    }
    return new Response('{}', { status: 405 });
  }

  return { fetch, calls, sheet };
}
