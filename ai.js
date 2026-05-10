// ai.js — single point of model client config.
//
// THIS FILE IS THE DEMO MOMENT.
// To swap providers, change the three lines below. index.js never moves.

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
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

// --- Swap to OpenAI: replace the three lines above with these ---
//
// import OpenAI from "openai";
// const client = new OpenAI(); // reads OPENAI_API_KEY from env
// const MODEL = "gpt-4.1";
//
// export async function callAi(prompt, system) {
//   const res = await client.chat.completions.create({
//     model: MODEL,
//     messages: [
//       { role: "system", content: system },
//       { role: "user", content: prompt },
//     ],
//   });
//   return res.choices[0].message.content;
// }
