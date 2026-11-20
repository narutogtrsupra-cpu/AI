// Retry temporary Telegram failures without making the host restart the process.
export async function connectTelegram(bot, { wait, log, isStopping }) {
  let retryDelay = 5000;
  while (!isStopping()) {
    try {
      return await bot.initialize();
    } catch (error) {
      if (!error.retryable) throw error;
      log(`${error.message} Retrying in ${retryDelay / 1000} seconds.`);
      await wait(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 60000);
    }
  }
  return null;
}
