import { createBot } from './bot.js';
import { connectTelegram } from './startup.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const bot = createBot({ token: process.env.TELEGRAM_BOT_TOKEN, geminiKey: process.env.GEMINI_API_KEY, openrouterKey: process.env.OPENROUTER_API_KEY, cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID?.trim(), cloudflareToken: process.env.CLOUDFLARE_API_TOKEN?.trim() });
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });
  console.log('Connecting to Telegram...');
  const me = await connectTelegram(bot, { wait: delay, log: message => console.error(message), isStopping: () => stopping });
  if (!me || stopping) return;
  console.log(`Connected as @${me.username}. Listening for messages.`);
  let offset = 0;
  while (!stopping) {
    try {
      const updates = await bot.poll(offset);
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        // Keep polling while the model is answering; each user has one request at a time.
        bot.handle(update).catch(error => console.error('Update failed:', error.message));
      }
    } catch (error) {
      console.error('Polling failed:', error.message);
      await delay(5000);
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
