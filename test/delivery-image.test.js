import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot.js';

const message = (text, fields = {}) => ({
  message: { message_id: 9, chat: { id: 1, type: 'private' }, from: { id: 7 }, text, ...fields },
});
const timeout = () => new DOMException('synthetic timeout', 'TimeoutError');
const jpeg = Buffer.from([255, 216, 255, 217]);

async function harness({ failSend = 0, failDownload = false, cloudflare = false, uploadTimeout = false } = {}) {
  const seen = { answers: [], pictures: [], steps: [], prompts: [], downloads: 0, generations: 0 };
  const bot = createBot({
    token: 'fake-token', geminiKey: 'fake-key',
    cloudflareAccountId: cloudflare ? 'fake-account' : undefined,
    cloudflareToken: cloudflare ? 'fake-cf-token' : undefined,
    wait: async ms => seen.steps.push(ms),
    fetchImpl: async (url, options) => {
      if (url.endsWith('/getMe')) return Response.json({ ok: true, result: { username: 'MathBot', id: 42 } });
      if (url.endsWith('/sendChatAction')) return new Promise(() => {});
      if (url.endsWith('/getFile')) return Response.json({ ok: true, result: { file_path: 'photos/example.jpg' } });
      if (url.includes('/file/bot')) {
        if (++seen.downloads === 1 && failDownload) throw timeout();
        return new Response(jpeg);
      }
      if (url.includes('generateContent')) {
        seen.generations++;
        return Response.json({ candidates: [{ content: { parts: [{ text: 'The answer is 4.' }] } }] });
      }
      if (url.includes('api.cloudflare.com')) {
        seen.prompts.push({ url, body: JSON.parse(options.body), auth: options.headers.authorization });
        return Response.json({ success: true, result: { image: jpeg.toString('base64') } });
      }
      if (url.endsWith('/sendMessage')) {
        seen.answers.push(JSON.parse(options.body).text);
        if (seen.answers.length <= failSend) throw timeout();
      }
      if (url.endsWith('/sendPhoto')) {
        const picture = options.body.get('photo');
        seen.pictures.push({ bytes: Buffer.from(await picture.arrayBuffer()), chat: options.body.get('chat_id'), reply: JSON.parse(options.body.get('reply_parameters')) });
        if (uploadTimeout && seen.pictures.length === 1) throw timeout();
      }
      return Response.json({ ok: true, result: true });
    },
  });
  await bot.initialize();
  return { bot, seen };
}

test('a Telegram timeout retries the answer without regenerating it or waiting for typing', { timeout: 1500 }, async () => {
  const { bot, seen } = await harness({ failSend: 1 });
  await bot.handle(message('2 + 2?'));
  assert.equal(seen.generations, 1);
  assert.deepEqual(seen.answers, ['The answer is 4.', 'The answer is 4.']);
  assert.deepEqual(seen.steps, [1500]);
});

test('persistent delivery failure names the Telegram operation and does not send an error reply', async () => {
  const { bot, seen } = await harness({ failSend: 2 });
  await assert.rejects(bot.handle(message('2 + 2?')), /sendMessage: Telegram connection failed \(TIMEOUT\)/);
  assert.deepEqual(seen.answers, ['The answer is 4.', 'The answer is 4.']);
});

test('a photo containing a math problem is downloaded again after a transient failure', async () => {
  const { bot, seen } = await harness({ failDownload: true });
  await bot.handle(message(undefined, { caption: 'Solve this', photo: [{ file_id: 'photo-1' }] }));
  assert.equal(seen.downloads, 2);
  assert.equal(seen.generations, 1);
  assert.deepEqual(seen.answers, ['The answer is 4.']);
});

test('/image uploads the generated JPEG and retries upload without generating again', async () => {
  const { bot, seen } = await harness({ cloudflare: true, uploadTimeout: true });
  await bot.handle(message('/image a blue cat'));
  assert.equal(seen.prompts.length, 1);
  assert.deepEqual(seen.prompts[0], {
    url: 'https://api.cloudflare.com/client/v4/accounts/fake-account/ai/run/@cf/black-forest-labs/flux-1-schnell',
    body: { prompt: 'a blue cat', steps: 4 }, auth: 'Bearer fake-cf-token',
  });
  assert.equal(seen.pictures.length, 2);
  assert.deepEqual(seen.pictures.at(-1), { bytes: jpeg, chat: '1', reply: { message_id: 9, allow_sending_without_reply: true } });
  assert.equal(seen.generations, 0);
});

test('/image is optional and unaddressed group commands do not use the allowance', async () => {
  const { bot, seen } = await harness();
  await bot.handle(message('/image a cat', { chat: { id: -1, type: 'group' } }));
  assert.equal(seen.answers.length, 0);
  await bot.handle(message('/image a cat'));
  assert.match(seen.answers[0], /not enabled/);
  assert.equal(seen.prompts.length, 0);
});
