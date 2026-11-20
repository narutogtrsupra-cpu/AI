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

  async function jsonRequest(url, options, timeout = 60000) {
    let response;
    try { response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeout) }); }
    catch { throw new Error('The service could not be reached. Please try again.'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('The service returned an invalid response.'); }
    if (!response.ok || data.ok === false) {
      if (response.status === 429 || data.error_code === 429) throw new Error('The service is busy or its free limit was reached. Please try again later.');
      if (response.status === 401 || response.status === 403) throw new Error('The service rejected its API key or access. Check the bot configuration.');
      if (response.status === 409 || data.error_code === 409) throw new Error('Telegram polling conflict. Stop other bot instances and check for an active webhook.');
      throw new Error(`Service request failed (${response.status}). Please try again later.`);
    }
    return data;
  }
  async function telegram(method, body = {}, timeout = 60000) {
    const data = await jsonRequest(`${telegramBase}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, timeout);
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
      });
      const answer = data.candidates?.[0]?.content?.parts?.filter(part => part.text && !part.thought).map(part => part.text).join('');
      if (!answer) throw new Error('The model could not produce an answer. Please try a different question.');
      return answer;
    }
    const data = await jsonRequest(`${openrouterBase}/api/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${openrouterKey}` },
      body: JSON.stringify({ model: model.id, messages: [{ role: 'system', content: SYSTEM }, ...turns.map(turn => ({ role: turn.role, content: turn.text }))], max_tokens: 1024 }),
    });
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
  async function initialize() { const me = await telegram('getMe'); botId = me.id; username = me.username; if (!username) throw new Error('Telegram did not return a bot username.'); return me; }
  async function poll(offset) { return telegram('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }, 40000); }
  return { initialize, poll, handle, telegram };
}
