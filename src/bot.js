const MODELS = {
  gemini35: { name: 'Gemini 3.5 Flash-Lite', provider: 'gemini', id: 'gemini-3.5-flash-lite' },
  gemini31: { name: 'Gemini 3.1 Flash-Lite', provider: 'gemini', id: 'gemini-3.1-flash-lite' },
  free: { name: 'OpenRouter free (automatic)', provider: 'openrouter', id: 'openrouter/free' },
};
const SYSTEM = 'You are a helpful, friendly chat assistant. Reply naturally in the language the user uses. Be concise unless detail is requested.';
const HELP = 'Send me a message to chat. In a group, mention me (@username) or reply to one of my messages. To ask about someone else’s message, reply to it and mention me.\n\n/models — choose an AI model\n/reset — clear your conversation\n/help — show this help';

export function splitMessage(text, limit = 3500) {
  const chunks = [];
  let part = '';
  for (const char of text) {
    if (part.length + char.length > limit) { chunks.push(part); part = ''; }
    part += char;
  }
  if (part) chunks.push(part);
  return chunks;
}

export function createBot({ token, geminiKey, openrouterKey, fetchImpl = fetch, telegramBase = 'https://api.telegram.org', geminiBase = 'https://generativelanguage.googleapis.com', openrouterBase = 'https://openrouter.ai' }) {
  if (!token || token.includes('replace_with')) throw new Error('Set TELEGRAM_BOT_TOKEN to your BotFather token.');
  if (!geminiKey && !openrouterKey) throw new Error('Set at least one of GEMINI_API_KEY or OPENROUTER_API_KEY.');
  const available = Object.entries(MODELS).filter(([, model]) => model.provider === 'gemini' ? geminiKey : openrouterKey);
  const sessions = new Map();
  const busy = new Set();
  let active = 0;
  let botId;
  let username;

  // Only include known error codes in logs. Network error messages may contain URLs or secrets.
  function networkCode(error) {
    const allowed = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
    const pending = [error];
    const seen = new Set();
    while (pending.length && seen.size < 20) {
      const item = pending.shift();
      if (!item || typeof item !== 'object' || seen.has(item)) continue;
      seen.add(item);
      if (allowed.has(item.code)) return item.code;
      if (item.name === 'TimeoutError') return 'TIMEOUT';
      if (item.cause) pending.push(item.cause);
      if (Array.isArray(item.errors)) pending.push(...item.errors);
    }
    return 'NETWORK_ERROR';
  }
  function serviceError(message, retryable = false) {
    const error = new Error(message);
    error.retryable = retryable;
    return error;
  }
  async function jsonRequest(url, options, service, timeout = 60000) {
    let response;
    let data;
    try {
      response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeout) });
      data = await response.json();
    } catch (error) {
      // Non-JSON error responses still provide a useful HTTP status.
      if (response && !response.ok) {
        throw serviceError(`${service} returned HTTP ${response.status}.`, response.status === 429 || response.status >= 500);
      }
      if (error instanceof SyntaxError) throw serviceError(`${service} returned an invalid response. Please try again.`, true);
      throw serviceError(`${service} connection failed (${networkCode(error)}). Check network access and try again.`, true);
    }
    if (!response.ok || data.ok === false) {
      const status = Number.isInteger(data.error_code) && data.error_code >= 100 && data.error_code <= 599 ? data.error_code : response.status;
      if (status === 429) throw serviceError(`${service} is busy or its free limit was reached. Please try again later.`, true);
      if (service === 'Gemini' && status === 400) {
        // Google's structured reason is safe to match; do not expose its raw error message or metadata.
        const details = Array.isArray(data.error?.details) ? data.error.details : [];
        if (details.some(detail => detail?.reason === 'API_KEY_INVALID')) {
          throw serviceError('Gemini rejected the API key. The bot owner should check GEMINI_API_KEY in the host settings and use a valid Google AI Studio API key.');
        }
        throw serviceError('Gemini rejected the request (HTTP 400). The bot owner should check the Gemini key, model access, and provider settings.');
      }
      if (status === 401 || status === 403 || (service === 'Telegram' && status === 404)) {
        throw serviceError(service === 'Telegram' ? 'Telegram rejected the bot token or access. Check TELEGRAM_BOT_TOKEN in your host settings.' : `${service} rejected its API key or access. Check the bot configuration.`);
      }
      if (service === 'Telegram' && status === 409) throw serviceError('Telegram polling conflict. Stop other bot instances and check for an active webhook.');
      throw serviceError(`${service} request failed (HTTP ${status}). Please try again later.`, status >= 500);
    }
    return data;
  }
  async function telegram(method, body = {}, timeout = 60000) {
    const data = await jsonRequest(`${telegramBase}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, 'Telegram', timeout);
    return data.result;
  }
  function session(key) {
    if (!sessions.has(key)) {
      if (sessions.size >= 500) sessions.delete(sessions.keys().next().value);
      sessions.set(key, { model: available[0][0], history: [] });
    }
    const value = sessions.get(key);
    sessions.delete(key); sessions.set(key, value);
    return value;
  }
  async function send(chatId, text, replyId, extra = {}) {
    for (const chunk of splitMessage(text)) {
      await telegram('sendMessage', { chat_id: chatId, text: chunk, ...(replyId ? { reply_parameters: { message_id: replyId, allow_sending_without_reply: true } } : {}), ...extra });
    }
  }
  function keyboard() {
    return { inline_keyboard: available.map(([key, model]) => [{ text: model.name, callback_data: `model:${key}` }]) };
  }
  async function generate(model, history, prompt) {
    const turns = [...history, { role: 'user', text: prompt }];
    if (model.provider === 'gemini') {
      const data = await jsonRequest(`${geminiBase}/v1beta/models/${model.id}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: turns.map(turn => ({ role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.text }] })), generationConfig: { maxOutputTokens: 1024 } }),
      }, 'Gemini');
      const answer = data.candidates?.[0]?.content?.parts?.filter(part => part.text && !part.thought).map(part => part.text).join('');
      if (!answer) throw new Error('The model could not produce an answer. Please try a different question.');
      return answer;
    }
    const data = await jsonRequest(`${openrouterBase}/api/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${openrouterKey}` },
      body: JSON.stringify({ model: model.id, messages: [{ role: 'system', content: SYSTEM }, ...turns.map(turn => ({ role: turn.role, content: turn.text }))], max_tokens: 1024 }),
    }, 'OpenRouter');
    const answer = data.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) throw new Error('The model could not produce an answer. Please try a different question.');
    return answer;
  }
  async function handleUpdate(update) {
    if (update.callback_query) {
      const query = update.callback_query;
      const key = query.data?.startsWith('model:') ? query.data.slice(6) : '';
      const entry = available.find(([id]) => id === key);
      if (!query.message || !query.from || !entry) { await telegram('answerCallbackQuery', { callback_query_id: query.id, text: 'This model is unavailable.' }); return; }
      const userSession = session(`${query.message.chat.id}:${query.from.id}`);
      userSession.model = key; userSession.history = [];
      await telegram('answerCallbackQuery', { callback_query_id: query.id, text: `Selected ${entry[1].name}` });
      await send(query.message.chat.id, `Model selected: ${entry[1].name}. Conversation cleared.`, query.message.message_id);
      return;
    }
    const msg = update.message;
    if (!msg?.text || !msg.from || msg.from.is_bot || !msg.chat) return;
    const key = `${msg.chat.id}:${msg.from.id}`;
    const command = msg.text.match(/^\/(start|help|models|model|reset)(?:@([A-Za-z0-9_]+))?(?:\s|$)/i);
    if (command && command[2] && command[2].toLowerCase() !== username?.toLowerCase()) return;
    if (command) {
      const action = command[1].toLowerCase();
      if (action === 'start' || action === 'help') await send(msg.chat.id, HELP, msg.message_id);
      else if (action === 'models' || action === 'model') await send(msg.chat.id, `Choose your model. Current: ${MODELS[session(key).model].name}`, msg.message_id, { reply_markup: keyboard() });
      else { session(key).history = []; await send(msg.chat.id, 'Conversation cleared.', msg.message_id); }
      return;
    }
    const mention = username && new RegExp(`@${username}(?![A-Za-z0-9_])`, 'ig');
    const mentioned = Boolean(mention && mention.test(msg.text));
    const replyingToBot = msg.reply_to_message?.from?.id === botId;
    if (msg.chat.type !== 'private' && !mentioned && !replyingToBot) return;
    let prompt = mention ? msg.text.replace(mention, '').trim() : msg.text.trim();
    const quoted = msg.reply_to_message?.from?.id !== botId && (msg.reply_to_message?.text || msg.reply_to_message?.caption);
    if (quoted && mentioned) prompt = `Message being replied to:\n${quoted.slice(0, 3000)}\n\nUser's request:\n${prompt || 'Please respond to this message.'}`;
    if (!prompt) { await send(msg.chat.id, 'What would you like to ask?', msg.message_id); return; }
    if (prompt.length > 6000) { await send(msg.chat.id, 'Please keep your message under 6000 characters.', msg.message_id); return; }
    if (busy.has(key) || active >= 5) { await send(msg.chat.id, 'Please wait for the current request to finish and try again.', msg.message_id); return; }
    busy.add(key); active++;
    const userSession = session(key);
    const selected = userSession.model;
    const historyRef = userSession.history;
    const history = historyRef.slice();
    try {
      await telegram('sendChatAction', { chat_id: msg.chat.id, action: 'typing' }).catch(() => {});
      const answer = await generate(MODELS[selected], history, prompt);
      await send(msg.chat.id, answer, msg.message_id);
      // A model switch or reset while the request was running must stay effective.
      if (sessions.get(key) === userSession && userSession.model === selected && userSession.history === historyRef) {
        userSession.history = [...history, { role: 'user', text: prompt }, { role: 'assistant', text: answer.slice(0, 6000) }].slice(-12);
      }
    } catch (error) { await send(msg.chat.id, error.message || 'Something went wrong. Please try again later.', msg.message_id); }
    finally { busy.delete(key); active--; }
  }
  // Track the history object as well as its contents so /reset can invalidate an in-flight request.
  async function handle(update) { return handleUpdate(update); }
  async function initialize() { const me = await telegram('getMe', {}, 15000); botId = me.id; username = me.username; if (!username) throw new Error('Telegram did not return a bot username.'); return me; }
  async function poll(offset) { return telegram('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }, 40000); }
  return { initialize, poll, handle, telegram };
}
