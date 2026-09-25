import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => mocks[id] ?? require(id), loaded, loaded.exports);
  return loaded.exports;
}
const pid = 'abcdefghijklmnopqrst';
const second = 'ABCDEFGHIJKLMNOPQRST';
const url = 'https://calendars.partiful.com/getCalendar?id=test-secret';
function calendar(fields) { return `BEGIN:VCALENDAR\r\n${fields.map(f => `BEGIN:VEVENT\r\n${f}\r\nEND:VEVENT`).join('\r\n')}\r\nEND:VCALENDAR`; }
function library(client = {}) {
  return load('src/lib/partiful-calendar.ts', {
    '@/lib/auth': { db: () => client },
    '@/lib/events-index': { partifulIdToEventId: async () => new Map([[pid, 'event-1']]) },
  });
}
function query(data, error = null) {
  const q = { data, error };
  for (const name of ['select', 'eq', 'in', 'update', 'upsert', 'maybeSingle']) q[name] = () => q;
  return q;
}

test('strict URL allowlist and webcal canonicalization', () => {
  const { normalizeFeedUrl: normalize } = library();
  assert.equal(normalize(url.replace('https:', 'webcal:')), url);
  assert.equal(normalize(url), url);
  for (const bad of [null, '', 'https://evil.com/getCalendar?id=x', 'https://calendars.partiful.com/getCalendar', 'https://calendars.partiful.com/foo/getCalendar?id=x', 'https://calendars.partiful.com/getCalendar/?id=x', url.replace('https:', 'http:'), url.replace('.com/', '.com:8443/'), url.replace('https://', 'https://user:pass@'), `${url}&id=duplicate`]) assert.equal(normalize(bad), null);
});

test('ICS unfolds, extracts every URL and bare UID, deduplicates, ignores irrelevant events', () => {
  const { partifulIdsFromIcs } = library();
  const ics = calendar([`UID:${pid}`, `URL:https://partiful.com/e/${pid}`, `DESCRIPTION;LANGUAGE=en:https://partiful.com/e/ABCDEFGHIJ\r\n KLMNOPQRST and https://partiful.com/e/${pid}`, `UID:irrelevant\r\nURL:https://evilpartiful.com/e/${second}`, 'DESCRIPTION:unrelated']);
  assert.deepEqual(partifulIdsFromIcs(ics), [pid, second]);
  assert.deepEqual(partifulIdsFromIcs(`URL:https://partiful.com/e/${pid}`), []);
  assert.deepEqual(partifulIdsFromIcs(calendar([`URL:https://partiful.com/e/${pid}extra`])), []);
});

test('AES-GCM random IV, round trip, tamper rejection, no plaintext', () => {
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-key-not-a-real-secret';
  try {
    const { encryptFeed, decryptFeed, fingerprint } = library();
    const a = encryptFeed(url), b = encryptFeed(url);
    assert.notEqual(a, b);
    assert.equal(Buffer.from(a.split(':')[0], 'base64').length, 12);
    assert.equal(decryptFeed(a), url);
    assert.equal(decryptFeed(b), url);
    assert.equal(a.includes('test-secret'), false);
    assert.equal(decryptFeed('invalid'), null);
    const parts = a.split(':'); parts[1] = Buffer.alloc(16).toString('base64');
    assert.equal(decryptFeed(parts.join(':')), null);
    assert.equal(fingerprint(url), fingerprint(url));
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(() => library().encryptFeed(url), /not configured/);
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
  }
});

test('sync sends deduplicated matched rows to transaction and uses safe fetch options', async (t) => {
  const calls = [];
  const client = { rpc: async (...args) => { calls.push(args); return { data: true }; }, from: () => query(null) };
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    assert.equal(input, url); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.ok(options.signal);
    return new Response(calendar([`UID:${pid}`, `URL:https://partiful.com/e/${pid}`, 'UID:irrelevant']));
  });
  const result = await library(client).syncConnection('user-1', url);
  assert.deepEqual(result, { matched: 1, total: 3 });
  assert.deepEqual(calls[0][1].p_events, [{ event_id: 'event-1', partiful_id: pid }]);
});

test('invalid/truncated/error feed never writes attendance; RPC errors are reported safely', async (t) => {
  let writes = 0;
  const client = { rpc: async () => { writes++; return { error: { message: url } }; }, from: () => query(null) };
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('<html>bad</html>'));
  assert.ok((await library(client).syncConnection('u', url)).error);
  assert.equal(writes, 0);
  fetchMock.mock.mockImplementation(async () => new Response('BEGIN:VCALENDAR\nBEGIN:VEVENT\nEND:VCALENDAR'));
  assert.ok((await library(client).syncConnection('u', url)).error);
  assert.equal(writes, 0);
  fetchMock.mock.mockImplementation(async () => new Response(calendar([`UID:${pid}`])));
  const result = await library(client).syncConnection('u', url);
  assert.ok(result.error); assert.equal(JSON.stringify(result).includes(url), false);
});

test('event index uses actual snapshot URLs and rejects unrelated hosts', async () => {
  const index = load('src/lib/events-index.ts', { '@/lib/snapshot': { getEvents: async city => {
    assert.equal(city, 'sf'); return { source: 'local', events: [{ id: 'event-1', url: `https://partiful.com/e/${pid}` }, { id: 'bad', url: `https://evil.com/e/${second}` }] };
  } } });
  assert.deepEqual([...await index.partifulIdToEventId()], [[pid, 'event-1']]);
});

test('API authentication, validation, safe success/error/status/disconnect responses', async () => {
  let signedIn = true, fail = false, disconnected = false;
  const saved = [], created = [], sessions = [];
  const api = load('src/app/api/partiful/route.ts', {
    '@/lib/auth': {
      socialEnabled: () => true,
      newInviteCode: () => 'code',
      startSession: async id => { sessions.push(id); },
      currentUser: async () => signedIn ? { id: 'u' } : null,
      db: () => ({ from: () => ({
        upsert: async row => { saved.push(row); return {}; },
        insert: row => { created.push(row); return { select: () => ({ single: async () => ({ data: { id: 'new-user' } }) }) }; },
      }) }),
    },
    '@/lib/partiful-calendar': {
      ...library(), encryptFeed: () => 'encrypted-secret', fingerprint: () => 'fingerprint',
      syncConnection: async () => fail ? { error: 'Sync failed' } : { matched: 1, total: 2 },
      getConnection: async () => ({ status: { connected: true, lastSyncedAt: null, eventCount: 1 }, feedUrl: url, feed_enc: 'encrypted-secret' }),
      disconnectConnection: async () => { disconnected = true; },
    },
  });
  const post = value => api.POST(new Request('http://localhost/api/partiful', { method: 'POST', body: JSON.stringify(value) }));
  assert.equal((await post({ url: 'bad' })).status, 400);
  const response = await post({ url });
  assert.deepEqual(await response.json(), { connected: true, matched: 1, total: 2 });
  assert.equal(saved[0].feed_enc, 'encrypted-secret');
  const status = await api.GET();
  assert.deepEqual(await status.json(), { connected: true, lastSyncedAt: null, eventCount: 1 });
  fail = true; assert.equal((await post({ url })).status, 502);
  assert.deepEqual(await (await api.DELETE()).json(), { ok: true }); assert.ok(disconnected);
  signedIn = false; fail = false;
  // Signed out: junk never creates an account; a valid link silently does.
  assert.equal((await post({ url: 'bad' })).status, 400); assert.equal(created.length, 0);
  assert.equal((await post({ url })).status, 200);
  assert.equal(created.length, 1); assert.deepEqual(sessions, ['new-user']); assert.equal(saved.at(-1).user_id, 'new-user');
  assert.equal((await api.GET()).status, 401);
  assert.equal((await api.DELETE()).status, 401);
});

test('social keeps hidden friends private and includes viewer membership safely', async () => {
  let refreshed = false;
  const responses = [query([{ user_b: 'visible' }, { user_b: 'hidden' }]), query([]), query([{ event_id: 'event-1' }]), query([{ id: 'visible', name: 'A', visibility: 'friends', pf_profile_id: 'profile' }, { id: 'hidden', name: 'B', visibility: 'nobody', pf_profile_id: 'secret' }]), query([{ user_id: 'visible', event_id: 'event-1' }, { user_id: 'hidden', event_id: 'event-1' }])];
  const api = load('src/app/api/social/route.ts', {
    '@/lib/auth': { socialEnabled: () => true, currentUser: async () => ({ id: 'u' }), db: () => ({ from: () => { assert.ok(refreshed); return responses.shift(); } }) },
    '@/lib/partiful-calendar': { refreshIfStale: async () => { refreshed = true; }, getConnection: async () => ({ inPartiful: ['event-1'], status: { connected: true, lastSyncedAt: null, eventCount: 1 }, feedUrl: url }) },
  });
  const body = await (await api.GET()).json();
  assert.deepEqual(body.going, { 'event-1': ['visible'] });
  assert.deepEqual(body.mine, ['event-1']); assert.deepEqual(body.inPartiful, ['event-1']);
  assert.equal(body.friends[1].pfProfileId, null); assert.equal(JSON.stringify(body).includes(url), false);
});

test('refresh observes six-hour threshold and isolates safe status from encrypted material', async (t) => {
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  try {
    let synced = 0;
    let row;
    const lib = library({ from: () => query(row), rpc: async () => { synced++; return { data: true }; } });
    row = { feed_enc: lib.encryptFeed(url), feed_fp: lib.fingerprint(url), event_count: 1, imported_event_ids: ['event-1'], last_synced_at: new Date().toISOString() };
    t.mock.method(globalThis, 'fetch', async () => new Response(calendar([`UID:${pid}`])));
    await lib.refreshIfStale('u'); assert.equal(synced, 0);
    row.last_synced_at = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    await lib.refreshIfStale('u'); assert.equal(synced, 1);
    const connection = await lib.getConnection('u');
    assert.deepEqual(Object.keys(connection.status).sort(), ['connected', 'eventCount', 'lastSyncedAt']);
    assert.deepEqual(connection.inPartiful, ['event-1']);
    row = null; await lib.refreshIfStale('u'); assert.equal(synced, 1);
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
  }
});

test('15-second abort remains active while reading the response body', async (t) => {
  let expire, cleared = false;
  t.mock.method(globalThis, 'setTimeout', (callback, ms) => { assert.equal(ms, 15000); expire = callback; return 123; });
  t.mock.method(globalThis, 'clearTimeout', id => { assert.equal(id, 123); cleared = true; });
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => ({ ok: true, body: { getReader: () => ({ read: () => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
    queueMicrotask(expire);
  }) }) } }));
  const result = await library({ from: () => query(null) }).syncConnection('u', url);
  assert.ok(result.error); assert.ok(cleared);
});
