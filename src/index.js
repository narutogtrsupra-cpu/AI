import { createBot } from './bot.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const bot = createBot({ token: process.env.TELEGRAM_BOT_TOKEN, geminiKey: process.env.GEMINI_API_KEY, openrouterKey: process.env.OPENROUTER_API_KEY });
  const me = await bot.initialize();
  console.log(`Connected as @${me.username}. Listening for messages.`);
  let offset = 0;
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });
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
