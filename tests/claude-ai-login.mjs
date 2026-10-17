import assert from 'node:assert/strict';

let handler;
globalThis.Deno = {
  env: { get: key => ({ ANTHROPIC_API_KEY: 'fake-key', SUPABASE_URL: 'https://test.invalid' })[key] },
  serve: fn => { handler = fn; },
};
await import('../supabase/functions/claude-ai/index.ts');

const credentials = { id: 'fake-student', pw: 'fake-password', role: 'student' };
const cases = [
  ['active student', credentials, { status: 'active', role: 'student' }, 200],
  ['active teacher', { ...credentials, role: 'teacher' }, { status: 'active', role: 'teacher' }, 200],
  ['missing credentials', undefined, null, 401],
  ['wrong password', { ...credentials, pw: 'wrong' }, null, 401],
  ['role mismatch', credentials, { status: 'active', role: 'teacher' }, 401],
  ['pending account', credentials, { status: 'pending', role: 'student' }, 401],
  ['admin role', { ...credentials, role: 'admin' }, { status: 'active', role: 'admin' }, 401],
  ['authentication failure', credentials, null, 401, 500],
];
const originalFetch = globalThis.fetch;
try {
  for (const [name, c, user, expected, authStatus = 200] of cases) {
    let claudeCalls = 0;
    let authCalls = 0;
    globalThis.fetch = async (url, options) => {
      if (url === 'https://test.invalid/rest/v1/rpc/authenticate_user') {
        authCalls++;
        assert.deepEqual(JSON.parse(options.body), { p_id: c.id, p_password: c.pw, p_role: c.role });
        assert.equal(options.headers.apikey, 'fake-anon-key');
        assert.equal(options.headers.Authorization, 'Bearer fake-anon-key');
        return Response.json(user, { status: authStatus });
      }
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      claudeCalls++;
      assert.equal(JSON.parse(options.body).credentials, undefined);
      return Response.json({ content: [{ type: 'text', text: 'ok' }] });
    };
    const response = await handler(new Request('https://test.invalid/functions/v1/claude-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: 'fake-anon-key' },
      body: JSON.stringify({ credentials: c, payload: { messages: [{ role: 'user', content: 'test' }] } }),
    }));
    assert.equal(response.status, expected, name);
    assert.equal(claudeCalls, expected === 200 ? 1 : 0, `${name}: Claude calls`);
    assert.equal(authCalls, !c || c.role === 'admin' ? 0 : 1, `${name}: authentication calls`);
    if (expected === 401) assert.equal((await response.json()).error.message, '본인 계정으로 다시 로그인해 주세요.');
    console.log(`PASS ${name}`);
  }
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.Deno;
}
