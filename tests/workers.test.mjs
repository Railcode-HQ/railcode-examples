import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Exercise the actual worker and published SDK, mocking only the platform HTTP
// boundary. No live tenant, credentials, connector calls or LLM spend.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'railcode-worker-tests-'));
const apps = {};
for (const path of ['apps/chat', 'apps/crm', 'apps/kanban', 'agents/pitch-deck', 'agents/proposals']) {
  const name = path.split('/').at(-1);
  const outfile = join(output, `${name}.mjs`);
  await build({ entryPoints: [join(root, path, 'server/index.ts')], outfile,
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], logLevel: 'silent' });
  apps[name] = (await import(pathToFileURL(outfile).href)).default;
}
const granolaOutput = join(output, 'granola.mjs');
await build({ entryPoints: [join(root, 'apps/crm/frontend/src/lib/granola.ts')],
  outfile: granolaOutput, bundle: true, format: 'esm', platform: 'browser',
  target: 'es2022', logLevel: 'silent' });
const granola = await import(pathToFileURL(granolaOutput).href);
after(() => rm(output, { recursive: true, force: true }));

let user;
let connectorResult;
let connection;
let connectorList;
const kv = new Map();
const files = new Map();
const calls = [];
const originalFetch = globalThis.fetch;
globalThis.__RAILCODE_AMBIENT__ = { getStore: () => ({ user, token: 'test',
  dataPlaneUrl: 'https://mock.invalid', trigger: 'http', invocationId: 'test', claims: {} }) };
after(() => { globalThis.fetch = originalFetch; delete globalThis.__RAILCODE_AMBIENT__; });
const json = (value, status = 200) => Response.json(value, { status });

globalThis.fetch = async (input, init = {}) => {
  // Frontend helpers use same-origin worker routes; forward them into Hono.
  if (typeof input === 'string' && input.startsWith('/api/')) return apps.crm.request(input, init);
  const url = new URL(input);
  assert.equal(url.hostname, 'mock.invalid', 'tests must never call a live service');
  const path = decodeURIComponent(url.pathname).replace('/fn/data', '');
  const method = init.method ?? 'GET';
  calls.push({ path, method, body: init.body });
  if (path.startsWith('/kv/')) {
    const [, , collection, ...parts] = path.split('/');
    const key = parts.join('/');
    const location = `${collection}/${key}`;
    if (method === 'PUT') {
      const { value } = JSON.parse(init.body);
      kv.set(location, value);
      return json({ value });
    }
    if (method === 'DELETE') { kv.delete(location); return new Response(null, { status: 204 }); }
    if (key) return kv.has(location) ? json({ value: kv.get(location) }) : json({}, 404);
    const prefix = url.searchParams.get('prefix') ?? '';
    const rows = [...kv].filter(([key]) => key.startsWith(`${collection}/${prefix}`))
      .map(([key, value]) => ({ key: key.slice(collection.length + 1), value }));
    const size = Number(url.searchParams.get('size') ?? 100);
    const page = Number(url.searchParams.get('page') ?? 1);
    return json({ items: rows.slice((page - 1) * size, page * size) });
  }
  if (path.startsWith('/files/')) {
    const name = path.slice('/files/'.length);
    if (method === 'DELETE') { files.delete(name); return new Response(null, { status: 204 }); }
    if (method === 'GET') return files.has(name) ? new Response(files.get(name)) : json({}, 404);
    if (method === 'PUT' && name === 'blob') {
      files.set(url.searchParams.get('name'), init.body);
      return json({ name: url.searchParams.get('name') });
    }
  }
  if (path === '/service-connectors') return json(connectorList);
  if (path === '/service-connectors/call') return json({ result: connectorResult });
  if (path === '/service-connectors/granola/connection') {
    return connection ? json(connection) : json({ detail: { code: 'connector_not_found' } }, 404);
  }
  throw new Error(`Unexpected platform call: ${method} ${path}`);
};

beforeEach(() => {
  user = { id: 'alice', name: 'Alice', email: 'alice@example.test', is_admin: false };
  kv.clear(); files.clear(); calls.length = 0;
  connectorResult = [{ type: 'text', text: 'meeting notes' }];
  connection = { status: 'ready', credential_mode: 'per_user', linked: true, consented: true, connect_url: null };
  connectorList = [
    { name: 'granola', provider: 'granola', has_tools: true },
    { name: 'unrelated', provider: 'gmail', has_tools: true },
  ];
});
const post = (app, path, body) => app.request(path, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const crm = (body) => post(apps.crm, '/api/rc/kv', body);

test('chat rejects traversal in attachment reads and deletes before calling storage', async () => {
  files.set('attachments/bob/secret', 'private');
  for (const id of ['../bob/secret', '..\\bob\\secret', '../../secret', '%2e%2e%2fbob%2fsecret']) {
    for (const method of ['GET', 'DELETE']) {
      const response = await apps.chat.request(`/api/attachments/${encodeURIComponent(id)}`, { method });
      assert.equal(response.status, 400);
    }
  }
  assert.equal(calls.length, 0);
  assert.equal(files.get('attachments/bob/secret'), 'private');
});

test('chat permits safe attachment reads within the caller namespace', async () => {
  const id = '90f84c4c-d09b-4628-98f2-9b19946a1139';
  files.set(`attachments/alice/${id}`, 'mine');
  files.set(`attachments/bob/${id}`, 'theirs');
  const response = await apps.chat.request(`/api/attachments/${id}`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'mine');
});

test('chat rejects poisoned batch IDs and message metadata before any side effects', async () => {
  let response = await post(apps.chat, '/api/attachments/urls', { ids: ['../bob/secret'] });
  assert.equal(response.status, 400);
  response = await post(apps.chat, '/api/chat', { convId: 'conv_safe', question: 'hi',
    attachments: [{ id: '../bob/secret' }], prefs: {} });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test('chat rejects traversal in conversation IDs and accepts existing generated IDs', async () => {
  const response = await apps.chat.request('/api/conversations/..%2F..%2Fbob/messages');
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await apps.chat.request('/api/conversations/conv_mf2wxyabcd/messages')).status, 200);
});

test('CRM keeps private collections private regardless of mine flag', async () => {
  await crm({ collection: 'notifRead', op: 'put', key: 'state', mine: true, value: { read: ['one'] } });
  user = { ...user, id: 'bob' };
  for (const mine of [false, true, undefined]) {
    assert.deepEqual(await (await crm({ collection: 'notifRead', op: 'list', mine })).json(), { items: [] });
    assert.deepEqual(await (await crm({ collection: 'notifRead', op: 'get', key: 'alice:state', mine })).json(), { value: null });
    await crm({ collection: 'notifRead', op: 'put', key: 'alice:state', mine, value: { read: ['tampered'] } });
    await crm({ collection: 'notifRead', op: 'delete', key: 'alice:state', mine });
    assert.deepEqual(kv.get('notifRead/alice:state'), { read: ['one'], __owner: 'alice' });
  }
});

test('CRM stamps private ownership and enforces it on reads and deletes', async () => {
  await crm({ collection: 'notifRead', op: 'put', key: 'state', value: { __owner: 'bob' } });
  assert.equal(kv.get('notifRead/alice:state').__owner, 'alice');
  kv.set('notifRead/alice:poisoned', { __owner: 'bob' });
  assert.deepEqual(await (await crm({ collection: 'notifRead', op: 'get', key: 'poisoned' })).json(), { value: null });
  await crm({ collection: 'notifRead', op: 'delete', key: 'poisoned' });
  assert.ok(kv.has('notifRead/alice:poisoned'));
});

test('CRM shares only declared collections and rejects URL traversal', async () => {
  await crm({ collection: 'companies', op: 'put', key: 'co_acme', mine: true, value: { name: 'Acme' } });
  user = { ...user, id: 'bob' };
  assert.deepEqual(await (await crm({ collection: 'companies', op: 'get', key: 'co_acme' })).json(), { value: { name: 'Acme' } });
  for (const collection of ['unknownPrivate', '../notifRead', 'companies/../notifRead']) {
    assert.equal((await crm({ collection, op: 'list' })).status, 400);
  }
  for (const key of ['../notifRead/alice:state', '..\\secret', '.', '..']) {
    assert.equal((await crm({ collection: 'companies', op: 'get', key })).status, 400);
  }
});

test('CRM calls only declared Granola tools, as the caller, through a per-user connector', async () => {
  const response = await post(apps.crm, '/api/rc/connectors', { op: 'call', name: 'granola', tool: 'list_meetings', args: { time_range: 'last_30_days' } });
  assert.deepEqual(await response.json(), [{ type: 'text', text: 'meeting notes' }]);
  const call = JSON.parse(calls.at(-1).body);
  assert.equal(call.connector, 'granola');
  assert.equal(call.tool, 'list_meetings');
  assert.deepEqual(call.arguments, { time_range: 'last_30_days' });
  assert.equal((await post(apps.crm, '/api/rc/connectors', { op: 'call', name: 'gmail', tool: 'send_email' })).status, 403);
  assert.equal((await post(apps.crm, '/api/rc/connectors', { op: 'call', name: 'granola', tool: 'delete_meeting' })).status, 403);
  assert.equal((await post(apps.crm, '/api/rc/connectors', { op: 'list' })).status, 400);
  assert.equal((await post(apps.crm, '/api/rc/pc', { op: 'connect' })).status, 404);
});

test('CRM refuses a shared Granola connector, so nobody reads another account', async () => {
  connection = { status: 'ready', credential_mode: 'shared', linked: true, consented: true, connect_url: null };
  let response = await post(apps.crm, '/api/rc/connectors', { op: 'call', name: 'granola', tool: 'get_meeting_transcript', args: { meeting_id: 'm1' } });
  assert.equal(response.status, 403);
  assert.equal(calls.some((call) => call.path === '/service-connectors/call'), false);
  response = await post(apps.crm, '/api/rc/connectors', { op: 'connection' });
  assert.deepEqual(await response.json(), { status: 'shared', connectUrl: null });
  assert.equal(await granola.isGranolaConnected(), false);
});

test('CRM fails closed when the connection cannot be checked', async () => {
  connection = null;
  assert.equal((await post(apps.crm, '/api/rc/connectors', { op: 'call', name: 'granola', tool: 'list_meetings' })).status, 404);
  assert.equal(calls.some((call) => call.path === '/service-connectors/call'), false);
  const response = await post(apps.crm, '/api/rc/connectors', { op: 'connection' });
  assert.deepEqual(await response.json(), { status: 'missing', connectUrl: null });
});

test('CRM reports a per-user Granola connection and where to link it', async () => {
  connection = { status: 'consent_required', credential_mode: 'per_user', linked: true,
    consented: false, connect_url: 'https://acme.example/connect/granola?app=crm' };
  const response = await post(apps.crm, '/api/rc/connectors', { op: 'connection' });
  assert.deepEqual(await response.json(),
    { status: 'consent_required', connectUrl: 'https://acme.example/connect/granola?app=crm' });
  assert.equal(await granola.isGranolaConnected(), false);
  connection = { status: 'ready', credential_mode: 'per_user', linked: true, consented: true, connect_url: null };
  assert.equal(await granola.isGranolaConnected(), true);
});

test('Kanban rejects an attachment belonging to another card without changing either', async () => {
  kv.set('cards/a', { id: 'a', attachments: [] });
  kv.set('cards/b', { id: 'b', attachments: [{ id: 'file-b' }] });
  files.set('file-b', 'B');
  const response = await apps.kanban.request('/api/cards/a/attachments/file-b', { method: 'DELETE' });
  assert.equal(response.status, 404);
  assert.equal(files.get('file-b'), 'B');
  assert.deepEqual(kv.get('cards/b').attachments, [{ id: 'file-b' }]);
  assert.equal(calls.filter((call) => call.method !== 'GET').length, 0);
});

test('Kanban still deletes a real attachment from its own card', async () => {
  kv.set('cards/a', { id: 'a', attachments: [{ id: 'file-a' }] });
  files.set('file-a', 'A');
  assert.equal((await apps.kanban.request('/api/cards/a/attachments/file-a', { method: 'DELETE' })).status, 200);
  assert.equal(files.has('file-a'), false);
  assert.deepEqual(kv.get('cards/a').attachments, []);
});

test('Proposals cannot start overlapping runs or delete coordination state', async () => {
  const responses = await Promise.all(Array.from({ length: 5 }, () => apps.proposals.request('/api/run', { method: 'POST' })));
  assert.ok(responses.every((response) => response.status === 404));
  assert.equal((await apps.proposals.request('/api/run', { method: 'DELETE' })).status, 404);
  assert.equal(calls.length, 0);
});

test('Proposals reads and edits the scheduled org agent shared output', async () => {
  kv.set('proposals/p1', { id: 'p1', fileName: 'proposals/p1.docx', title: 'Acme' });
  kv.set('state/scout', { outcome: 'drafted' });
  files.set('proposals/p1.docx', 'original');
  const state = await (await apps.proposals.request('/api/state')).json();
  assert.equal(state.proposals[0].id, 'p1');
  assert.equal(state.scout.outcome, 'drafted');
  assert.equal(await (await apps.proposals.request('/api/proposals/p1/docx')).text(), 'original');
  const saved = await apps.proposals.request('/api/proposals/p1/docx', { method: 'PUT', body: 'edited' });
  assert.equal(saved.status, 200);
  assert.equal(new TextDecoder().decode(files.get('proposals/p1.docx')), 'edited');
  assert.equal(kv.get('proposals/p1').editedBy, 'Alice');
});

test('all workers require a verified caller', async () => {
  user = null;
  for (const app of Object.values(apps)) assert.equal((await app.request('/api/me')).status, 409);
  assert.equal(calls.length, 0);
});

test('CRM parses Granola results through the frontend, worker and new SDK together', async () => {
  const text = '<meetings_data><meeting id="m1" title="Acme &amp; Co" date="2026-09-10"><known_participants>alice@acme.test</known_participants><summary>Discussed proposal</summary></meeting></meetings_data>';
  for (const result of [[{ type: 'text', text }], { content: [{ type: 'text', text }] }]) {
    connectorResult = result;
    assert.equal(await granola.isGranolaConnected(), true);
    const [meeting] = await granola.listRecentMeetings();
    assert.equal(meeting.id, 'm1');
    assert.equal(meeting.title, 'Acme & Co');
    const detail = await granola.fetchMeetingDetail('m1');
    assert.equal(detail.notesMarkdown, 'Discussed proposal');
  }
});
