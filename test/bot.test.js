import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot, splitMessage } from '../src/bot.js';

function harness({ gemini = true, router = true } = {}) {
  const calls = [];
  let failProvider = false;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, headers: options.headers });
    if (url.includes('/bot')) {
      const method = url.split('/').pop();
      return Response.json({ ok: true, result: method === 'getMe' ? { id: 42, username: 'HelperBot' } : true });
    }
    if (failProvider) return Response.json({ error: 'rate limited' }, { status: 429 });
    if (url.includes('generateContent')) return Response.json({ candidates: [{ content: { parts: [{ text: 'Gemini answer' }] } }] });
    return Response.json({ choices: [{ message: { content: 'Free answer' } }] });
  };
  const bot = createBot({ token: 'test-token', geminiKey: gemini ? 'gemini-key' : '', openrouterKey: router ? 'router-key' : '', fetchImpl });
  const messages = () => calls.filter(c => c.url.endsWith('/sendMessage')).map(c => c.body);
  return { bot, calls, messages, fail: () => { failProvider = true; } };
}
const message = (text, opts = {}) => ({ message: { message_id: 10, chat: { id: opts.chat ?? 1, type: opts.type ?? 'private' }, from: { id: opts.user ?? 7 }, text, ...(opts.reply ? { reply_to_message: opts.reply } : {}) } });

test('group mention, reply, context, and reset', async () => {
  const h = harness(); await h.bot.initialize();
  await h.bot.handle(message('hello everyone', { type: 'group' }));
  assert.equal(h.messages().length, 0);
  await h.bot.handle(message('@HelperBot explain this', { type: 'group', reply: { from: { id: 8 }, text: 'Original message' } }));
  const first = h.calls.find(c => c.url.includes('generateContent'));
  assert.equal(first.body.contents[0].parts[0].text, "Message being replied to:\nOriginal message\n\nUser's request:\nexplain this");
  assert.equal(h.messages().at(-1).text, 'Gemini answer');
  await h.bot.handle(message('tell me more', { type: 'group', reply: { from: { id: 42 } } }));
  assert.equal(h.calls.filter(c => c.url.includes('generateContent')).at(-1).body.contents.length, 3);
  await h.bot.handle(message('/reset@HelperBot', { type: 'group' }));
  await h.bot.handle(message('@HelperBot new topic', { type: 'group' }));
  assert.equal(h.calls.filter(c => c.url.includes('generateContent')).at(-1).body.contents.length, 1);
});

test('model picker selects free router per user and clears context', async () => {
  const h = harness(); await h.bot.initialize();
  await h.bot.handle(message('hi'));
  await h.bot.handle(message('/models'));
  assert.equal(h.messages().at(-1).reply_markup.inline_keyboard.length, 3);
  await h.bot.handle({ callback_query: { id: 'q', from: { id: 7 }, data: 'model:free', message: { message_id: 11, chat: { id: 1 } } } });
  await h.bot.handle(message('next'));
  const request = h.calls.find(c => c.url.endsWith('/chat/completions'));
  assert.equal(request.body.model, 'openrouter/free');
  assert.equal(request.body.messages.length, 2);
  await h.bot.handle(message('another person', { user: 8 }));
  assert.equal(h.calls.filter(c => c.url.includes('generateContent')).length, 2);
});

test('only configured models are offered and provider errors are safe', async () => {
  const h = harness({ gemini: false }); await h.bot.initialize();
  await h.bot.handle(message('/models'));
  assert.equal(h.messages().at(-1).reply_markup.inline_keyboard.length, 1);
  h.fail(); await h.bot.handle(message('hello'));
  assert.match(h.messages().at(-1).text, /free limit/);
  assert.ok(!JSON.stringify(h.messages()).includes('router-key'));
});

test('requires credentials and splits long Unicode messages safely', () => {
  assert.throws(() => createBot({ token: '', geminiKey: 'x' }), /TELEGRAM_BOT_TOKEN/);
  assert.throws(() => createBot({ token: 'x' }), /at least one/);
  const source = '🙂'.repeat(4000);
  const parts = splitMessage(source);
  assert.equal(parts.join(''), source);
  assert.ok(parts.every(part => part.length <= 3500));
});

test('Telegram startup reports safe network codes and retries until it connects', async () => {
  const { connectTelegram } = await import('../src/startup.js');
  let attempts = 0;
  const waits = [];
  const logs = [];
  const token = 'secret-token';
  const bot = createBot({ token, geminiKey: 'secret-key', fetchImpl: async () => {
    attempts++;
    if (attempts === 1) throw new TypeError(`failed for ${token}`, { cause: Object.assign(new Error('secret-key'), { code: 'ENETUNREACH' }) });
    if (attempts === 2) return Response.json({ ok: false, error_code: 503 }, { status: 503 });
    return Response.json({ ok: true, result: { id: 42, username: 'HelperBot' } });
  } });
  const me = await connectTelegram(bot, { wait: async ms => waits.push(ms), log: line => logs.push(line), isStopping: () => false });
  assert.equal(me.username, 'HelperBot');
  assert.deepEqual(waits, [5000, 10000]);
  assert.match(logs[0], /Telegram connection failed \(ENETUNREACH\)/);
  assert.match(logs[1], /Telegram request failed \(HTTP 503\)/);
  assert.ok(!logs.join().includes(token));
  assert.ok(!logs.join().includes('secret-key'));
});

test('Telegram rejects bad tokens without retrying', async () => {
  const { connectTelegram } = await import('../src/startup.js');
  const bot = createBot({ token: 'secret-token', geminiKey: 'x', fetchImpl: async () => Response.json({ ok: false, error_code: 404, description: 'secret-token' }, { status: 404 }) });
  await assert.rejects(connectTelegram(bot, { wait: () => assert.fail('must not retry'), log: () => {}, isStopping: () => false }), error => {
    assert.match(error.message, /TELEGRAM_BOT_TOKEN/);
    assert.ok(!error.message.includes('secret-token'));
    return true;
  });
});

test('Gemini invalid key response gives a specific safe message', async () => {
  const sent = [];
  const bot = createBot({ token: 'test-token', geminiKey: 'private-gemini-key', fetchImpl: async (url, options) => {
    if (url.endsWith('/getMe')) return Response.json({ ok: true, result: { id: 42, username: 'HelperBot' } });
    if (url.endsWith('/sendMessage')) { sent.push(JSON.parse(options.body).text); return Response.json({ ok: true, result: true }); }
    if (url.includes('generateContent')) return Response.json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'private-gemini-key', details: [{ reason: 'API_KEY_INVALID', metadata: { leaked: 'private-gemini-key' } }] } }, { status: 400 });
    return Response.json({ ok: true, result: true });
  } });
  await bot.initialize();
  await bot.handle(message('hello'));
  assert.match(sent.at(-1), /Gemini rejected the API key/);
  assert.match(sent.at(-1), /GEMINI_API_KEY/);
  assert.ok(!sent.at(-1).includes('private-gemini-key'));
});

test('other Gemini 400 errors do not claim the key is invalid', async () => {
  const sent = [];
  const bot = createBot({ token: 'test-token', geminiKey: 'private-gemini-key', fetchImpl: async (url, options) => {
    if (url.endsWith('/getMe')) return Response.json({ ok: true, result: { id: 42, username: 'HelperBot' } });
    if (url.endsWith('/sendMessage')) { sent.push(JSON.parse(options.body).text); return Response.json({ ok: true, result: true }); }
    if (url.includes('generateContent')) return Response.json({ error: { code: 400, message: 'private-gemini-key', status: 'INVALID_ARGUMENT' } }, { status: 400 });
    return Response.json({ ok: true, result: true });
  } });
  await bot.initialize();
  await bot.handle(message('hello'));
  assert.match(sent.at(-1), /Gemini rejected the request \(HTTP 400\)/);
  assert.doesNotMatch(sent.at(-1), /rejected the API key/);
  assert.ok(!sent.at(-1).includes('private-gemini-key'));
});
