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
