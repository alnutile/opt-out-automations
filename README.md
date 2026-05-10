# opt-out-handler

A single-service compliance opt-out handler.
Polls an IMAP inbox via the Zapier SDK, classifies + extracts with Claude,
writes every step to a Zapier Table (the state machine), and sends the
confirmation through SMTP — all through one durable integration layer.

**The narrative:** when the AI provider goes down, you swap one client.
The Zapier SDK code never moves.

---

## Architecture

- One Node.js service. One polling loop. No queues, no workers, no async fan-out.
- All integrations (IMAP, Zapier Tables, SMTP, Slack) go through `@zapier/zapier-sdk`.
- All AI calls go through `ai.js` → one function: `callAi(prompt, system)`.
- The `opt_outs` Zapier Table is the state machine. Every transition is persisted.
  If the process crashes mid-stream, restart picks up from the last step.

## Files

| File | Purpose |
| --- | --- |
| `index.js` | Polling loop + 6-step workflow |
| `ai.js` | The single point of AI client config (the demo moment) |
| `package.json` | Deps |
| `Procfile` | Railway worker process |
| `.env.example` | Required env vars |
| `sample_emails/` | One example per classification, plus the reply-to gotcha |

## Setup (local)

1. `npm install`
2. `cp .env.example .env` and fill in the blanks (see below)
3. `npm start`

## Required Zapier connections

Set up these connected apps in your Zapier workspace before running:

- **IMAP by Zapier** — the inbox we poll
- **SMTP by Zapier** — sends the confirmation reply
- **Slack** — used for `#opt-out-review` escalations

## Discovering action slugs and connection IDs

The exact action slugs (e.g., `find_email`, `send_email`) and your connection
IDs come from the SDK CLI. From inside this folder, after `npm install`:

```bash
npx @zapier/zapier-sdk login
npx @zapier/zapier-sdk --help          # see available commands
npx @zapier/zapier-sdk list-actions imap
npx @zapier/zapier-sdk list-actions smtp
npx @zapier/zapier-sdk list-actions slack
```

Paste the connection IDs into `.env`. The action slug placeholders in
`index.js` (`find_email`, `send_email`, `send_channel_message`,
`create_record`, etc.) may need to be tweaked once we see the real names —
that's a 30-second fix in one place.

## Server credentials (for Railway)

For server deployment we use Zapier client credentials, not the browser login:

```bash
npx @zapier/zapier-sdk create-client-credentials
```

Drop the resulting `ZAPIER_CLIENT_ID` and `ZAPIER_CLIENT_SECRET` into Railway
env vars.

## Tables schema

**`opt_outs`** (`OPT_OUTS_TABLE_ID`)
`raw_email`, `from_address`, `received_at`, `message_id`, `classification`,
`extracted_json`, `reply_draft`, `status`, `step`, `error`, `last_updated`

`status` ∈ `running | escalated | completed | error`
`step` ∈ `new_email | classifying | extracting | generating_reply | removing_from_customers | email_sent`

**`customers`** (`CUSTOMERS_TABLE_ID`)
`email`, `first_name`, `last_name`, `opted_out` (bool), `opted_out_at`

## Local dashboard (optional)

A tiny local-only dashboard shows total processed, status breakdown, last
poll heartbeat, and a 7-day bar chart. Not deployed — the `Procfile` only
starts the worker, so Railway never runs this.

```bash
npm run dashboard
# → http://localhost:3737
```

Run it alongside `npm start` in a second terminal. It reads the
`opt_outs` table directly through the Zapier SDK and the `.state.json`
heartbeat the worker writes after each poll tick.

## Deployment (Railway)

1. Push this folder to a GitHub repo.
2. New Railway project → deploy from repo.
3. Set every env var from `.env.example` in the Railway dashboard.
4. Railway autodetects `Procfile` and runs the `worker` process.

---

## Swapping providers

**This is the on-camera moment.**

When Anthropic has an outage (or you want to test against another model),
the only file that changes is `ai.js`. Three lines.

Before (Anthropic):

```js
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

export async function callAi(prompt, system) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return res.content[0].text;
}
```

After (OpenAI):

```js
import OpenAI from "openai";
const client = new OpenAI();
const MODEL = "gpt-4.1";

export async function callAi(prompt, system) {
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });
  return res.choices[0].message.content;
}
```

Three call sites in `index.js` use this function (classify, extract,
generate reply). None of them change. The Zapier SDK code — IMAP polling,
Tables read/write, SMTP send, Slack escalation — never moves.

That's the whole point.
