<!-- coderabbit-ai-generated:v1 -->

# Free AI Telegram bot

A text chatbot for private chats and Telegram groups. It offers Google Gemini 3.5 Flash-Lite, Gemini 3.1 Flash-Lite, and OpenRouter's automatic free-model router when their keys are configured. It remembers a short conversation for each person in each chat while the process is running.

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

FadeHost advertises one free always-on bot per person, with 256 MB RAM, 3 GB disk, and a daily traffic limit. Confirm the current plan in the panel. Deployment requires your own FadeHost account and tokens.

## Use in Telegram

- In a private chat, send any text. Use `/models` (or `/model`) to choose your model, `/reset` to clear your conversation, and `/help` for instructions. Switching models also clears your conversation.
- Add the bot to a group. Mention it, for example `@YourBot hello`, or reply to a bot message. To ask about another person's message, reply to it and mention the bot: `@YourBot explain this`.
- For ordinary mentions in groups, disable privacy mode with BotFather's `/setprivacy`, then remove and re-add the bot to the group if necessary. With privacy disabled the bot can receive group messages, but it only responds to mentions, replies to itself, and its commands. Commands addressed to a different bot are ignored.
- Model selection and memory are separate for each person in each chat. Group replies are visible to the group. The message, quoted text, and recent conversation are sent to the selected provider. Memory and model selections are held in RAM and are lost on restart. Only text and text captions on a quoted message are supported; images and voice messages are not processed.
- Free providers can be busy or limit requests. If that happens, wait or select another configured model. This is designed for light use, with a cap on simultaneous requests.

## Test

```sh
npm test
```

Tests use mocked Telegram and model responses; live accounts are required to verify an actual deployment.
