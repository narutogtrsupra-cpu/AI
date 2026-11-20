import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot.js';

const photo = { file_id: 'photo-id', file_size: 3 };
function harness({ router = false, declaredSize = 3, bytes = Buffer.from('abc') } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body });
    if (url.endsWith('/getMe')) return Response.json({ ok: true, result: { id: 42, username: 'HelperBot' } });
    if (url.endsWith('/getFile')) return Response.json({ ok: true, result: { file_path: 'photos/file_1.jpg', file_size: declaredSize } });
    if (url.includes('/file/bot')) return new Response(bytes);
    if (url.includes('generateContent')) return Response.json({ candidates: [{ content: { parts: [{ text: 'Extracted text' }] } }] });
    if (url.endsWith('/chat/completions')) return Response.json({ choices: [{ message: { content: 'Extracted text' } }] });
    return Response.json({ ok: true, result: true });
  };
  const bot = createBot({ token: 'test-token', geminiKey: router ? '' : 'gemini-key', openrouterKey: router ? 'router-key' : '', fetchImpl });
  return { bot, calls, messages: () => calls.filter(c => c.url.endsWith('/sendMessage')).map(c => c.body.text) };
}
const update = (data = {}) => ({ message: { message_id: 10, chat: { id: 1, type: 'private' }, from: { id: 7 }, ...data } });

test('photo caption sends image bytes to Gemini and preserves normal text history', async () => {
  const h = harness(); await h.bot.initialize();
  await h.bot.handle(update({ photo: [photo], caption: 'Extract the text' }));
  const gen = h.calls.find(c => c.url.includes('generateContent')).body;
  assert.deepEqual(gen.contents[0].parts, [{ text: 'Extract the text' }, { inlineData: { mimeType: 'image/jpeg', data: 'YWJj' } }]);
  assert.equal(h.messages().at(-1), 'Extracted text');
  await h.bot.handle(update({ text: 'Thanks' }));
  const second = h.calls.filter(c => c.url.includes('generateContent')).at(-1).body;
  assert.equal(second.contents.length, 3);
  assert.equal(second.contents[0].parts[0].text, '[Photo attached] Extract the text');
  assert.equal(second.contents[2].parts.length, 1);
});

test('photo without caption waits for the same user to ask and reset clears it', async () => {
  const h = harness(); await h.bot.initialize();
  await h.bot.handle(update({ photo: [photo] }));
  assert.match(h.messages().at(-1), /Extract the text/);
  await h.bot.handle(update({ from: { id: 8 }, text: 'Hi' }));
  assert.equal(h.calls.filter(c => c.url.endsWith('/getFile')).length, 0);
  await h.bot.handle(update({ text: 'read it' }));
  assert.equal(h.calls.filter(c => c.url.endsWith('/getFile')).length, 1);
  await h.bot.handle(update({ photo: [photo] }));
  await h.bot.handle(update({ text: '/reset' }));
  await h.bot.handle(update({ text: 'hello' }));
  assert.equal(h.calls.filter(c => c.url.endsWith('/getFile')).length, 1);
});

test('group replies to photos and OpenRouter receives an image data URL', async () => {
  const h = harness({ router: true }); await h.bot.initialize();
  await h.bot.handle(update({ chat: { id: -1, type: 'group' }, text: '@HelperBot extract the text', reply_to_message: { photo: [photo], from: { id: 8 } } }));
  const req = h.calls.find(c => c.url.endsWith('/chat/completions')).body;
  assert.equal(req.model, 'openrouter/free');
  assert.deepEqual(req.messages.at(-1).content, [{ type: 'text', text: 'extract the text' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,YWJj' } }]);
  assert.ok(!JSON.stringify(req).includes('test-token'));
});

test('oversized images are rejected before download and model calls', async () => {
  const h = harness({ declaredSize: 6 * 1024 * 1024 }); await h.bot.initialize();
  await h.bot.handle(update({ photo: [photo], caption: 'read this' }));
  assert.match(h.messages().at(-1), /under 5 MB/);
  assert.equal(h.calls.filter(c => c.url.includes('/file/bot')).length, 0);
  assert.equal(h.calls.filter(c => c.url.includes('generateContent')).length, 0);
});

test('image documents work and the download stream is size limited', async () => {
  const h = harness({ bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }); await h.bot.initialize();
  await h.bot.handle(update({ document: { file_id: 'doc-id', file_size: 1, mime_type: 'image/png' }, caption: 'read this' }));
  assert.match(h.messages().at(-1), /under 5 MB/);
  assert.equal(h.calls.filter(c => c.url.includes('generateContent')).length, 0);
});

test('PNG sent as a document reaches Gemini with its correct MIME type', async () => {
  const h = harness(); await h.bot.initialize();
  await h.bot.handle(update({ document: { file_id: 'doc-id', file_size: 3, mime_type: 'image/png' }, caption: 'extract text' }));
  const request = h.calls.find(c => c.url.includes('generateContent')).body;
  assert.equal(request.contents[0].parts[1].inlineData.mimeType, 'image/png');
  assert.equal(h.calls.find(c => c.url.endsWith('/getFile')).body.file_id, 'doc-id');
});

test('unmentioned group photos are ignored', async () => {
  const h = harness(); await h.bot.initialize();
  await h.bot.handle(update({ chat: { id: -1, type: 'group' }, photo: [photo], caption: 'read this' }));
  assert.equal(h.messages().length, 0);
  assert.equal(h.calls.filter(c => c.url.endsWith('/getFile')).length, 0);
});
