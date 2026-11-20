<!-- coderabbit-ai-generated:v1 -->

# Free AI Telegram bot

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:99035fa07b5a9650c27bfffefb82432b283de276d0613abb3207ba49eba6577f -->

A text and photo chatbot for private chats and Telegram groups. It offers Google Gemini 3.5 Flash-Lite, Gemini 3.1 Flash-Lite, and OpenRouter's automatic free-model router when their keys are configured. It remembers a short conversation for each person in each chat while the process is running.

<!-- /coderabbit-ai-generated:v1 -->

## Before you start

- Node.js 20 or newer.
- A bot token from [@BotFather](https://t.me/BotFather): send `/newbot` and follow the prompts. Keep the token secret.
- At least one API key: [Google AI Studio](https://aistudio.google.com/apikey) for Gemini, or [OpenRouter](https://openrouter.ai/settings/keys) for its free router. Configure both to offer all choices.

**Keep it free:** use a Gemini project on the free tier with billing disabled. Google lists free-tier usage for the included Gemini models, subject to availability and rate limits. The OpenRouter option uses only `openrouter/free`, which chooses an available free model; it does not provide a fixed model. Free quotas, regional availability, hosting terms, and model availability can change. Check [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [OpenRouter free router](https://openrouter.ai/docs/guides/routing/routers/free-router), and [FadeHost](https://fadehost.com/telegram-bot-hosting/) before deploying. Actual OpenAI ChatGPT models are not included because free API access is not guaranteed; the free router may select an unrelated model.

## Run locally

Copy `.env.example` to `.env` and replace the placeholders with your token and at least one key. Leave an unused provider key empty. Do not share or commit `.env`.

```sh
cp .env.example .env
# Edit .env with your own values
node --env-file=.env src/index.js
```

There are no external packages to install. Alternatively, set the same environment variables in your shell and run `npm start`. Send `/start` to your bot in Telegram. Run only one instance of the bot at a time. This bot uses long polling; if you previously configured a webhook, remove it through the Telegram Bot API before starting polling.

## Deploy on FadeHost

1. Publish the project to a GitHub repository or upload the files in the FadeHost panel. Do not upload `.env` or expose keys in your repository.
2. Create an account at [FadeHost](https://fadehost.com/telegram-bot-hosting/). In **Apps**, choose **Host something** and a Telegram bot, then select your repository or upload the project. Choose the free bot plan and a Node.js runtime (20 or newer).
3. In the app's environment variables, set `TELEGRAM_BOT_TOKEN` and at least one of `GEMINI_API_KEY` and `OPENROUTER_API_KEY`. Use a Gemini project without billing enabled. Set the start command to `npm start` if the panel asks for one.
4. Deploy and check the console for `Connected as @...`. Open your bot in Telegram and send `/start`, then `/models` to choose a configured model. If it does not start, check the token, keys, Node version, and console. If Telegram reports a polling conflict, stop other instances and remove any old webhook.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:1b1d49d209e58882c877f3a16bb6da084d389508efe375d1437d97a8e2d062c9 -->

FadeHost advertises one free always-on bot per person, with 256 MB RAM, 3 GB disk, and a daily traffic limit. Confirm the current plan in the panel. Deployment requires your own FadeHost account and tokens.

### Telegram connection problems

The bot first contacts Telegram's `getMe` API. If the console says `Telegram connection failed`, it will retry temporary failures automatically. `TIMEOUT`, `ENETUNREACH`, or `UND_ERR_CONNECT_TIMEOUT` can indicate a host network problem; `ENOTFOUND` or `EAI_AGAIN` can indicate DNS trouble. If the error persists, ask FadeHost support to check DNS and outgoing HTTPS access to `api.telegram.org` on port 443 from your bot's container. Share the error code, but never your bot token or API keys. If the console says Telegram rejected the token, check the exact `TELEGRAM_BOT_TOKEN` value from BotFather and restart the bot.

If your host provides a terminal, you can test the network without exposing your token:

```sh
curl -I --connect-timeout 10 --max-time 15 https://api.telegram.org
```

An HTTP response, including a redirect, shows that this command reached Telegram; a DNS or connection timeout should be investigated with the host. This test does not verify your token or prove that Node.js can connect.


<!-- /coderabbit-ai-generated:v1 -->
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:aab7ca0084545d31f339eedae0e7927f5d439c797cb22abe02c7e5843ca5ac05 -->

## Gemini request problems

If the bot says Gemini rejected the API key, create or copy a key from [Google AI Studio](https://aistudio.google.com/apikey), set `GEMINI_API_KEY` to that key in FadeHost's environment settings, save, and restart the app. Use a free-tier Google project with billing disabled. Never send the key in a Telegram chat or share it in a screenshot.

A general Gemini HTTP 400 can have other causes. Check the selected model, project and API access in Google AI Studio, and try another configured model with `/models`. See [Google's troubleshooting guide](https://ai.google.dev/gemini-api/docs/troubleshooting).

## Use in Telegram


<!-- /coderabbit-ai-generated:v1 -->
- In a private chat, send any text. Use `/models` (or `/model`) to choose your model, `/reset` to clear your conversation, and `/help` for instructions. Switching models also clears your conversation.
- Add the bot to a group. Mention it, for example `@YourBot hello`, or reply to a bot message. To ask about another person's message, reply to it and mention the bot: `@YourBot explain this`.
- For ordinary mentions in groups, disable privacy mode with BotFather's `/setprivacy`, then remove and re-add the bot to the group if necessary. With privacy disabled the bot can receive group messages, but it only responds to mentions, replies to itself, and its commands. Commands addressed to a different bot are ignored.
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:44c6bc0cd5d85de34429c59c9f3b299e6a625dc2be8f9d6bf05c892a3fb2d91e -->

- To extract text, send a photo with the caption `Extract the text`, or send a photo first and then ask your question. You can also reply to a photo with a question (mention the bot in a group). JPEG, PNG, and WebP image files are supported up to 5 MB. The selected provider receives the image. Free model availability and image support can vary.
- Model selection and memory are separate for each person in each chat. Group replies are visible to the group. The message, quoted text, image, and recent conversation are sent to the selected provider. Memory, pending photos, and model selections are held in RAM and are lost on restart. Only the question and answer are remembered after processing; reply to or resend the photo for another visual question. Voice messages are not processed.

<!-- /coderabbit-ai-generated:v1 -->
- Free providers can be busy or limit requests. If that happens, wait or select another configured model. This is designed for light use, with a cap on simultaneous requests.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:f26a7aecd1488b28e8732067f7291f0d1f815b7c9878f29bf512f7327dbf468d -->

## Generate an image

1. Keep your Cloudflare account on the [Workers Free plan](https://developers.cloudflare.com/workers-ai/platform/pricing/). Workers AI has a shared daily free allowance; the bot does not switch to another service when you reach it.
2. In Cloudflare **Workers AI → Use REST API**, create a Workers AI API token and copy the account ID. See the [Workers AI REST setup guide](https://developers.cloudflare.com/workers-ai/get-started/rest-api/).
3. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in FadeHost and deploy. Keep your existing chat provider key.
4. Send `/image a blue cat reading a book` in a private chat. In a group, use `/image@YourBot a blue cat reading a book`. The bot sends your description to [Cloudflare FLUX.1 Schnell](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/).

For a Telegram timeout that continues after redeployment, check the FadeHost logs for the operation name (for example, `sendMessage` or `getUpdates`). The bot retries photo downloads and reply delivery once on temporary failures. A reply may appear twice if Telegram accepted the first send but its response timed out.

## Test


<!-- /coderabbit-ai-generated:v1 -->
```sh
npm test
```

Tests use mocked Telegram and model responses; live accounts are required to verify an actual deployment.
