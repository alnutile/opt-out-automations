// mock-email.js — generate a random plausible opt-out email via AI.
// Run with: npm run mockemail
// Copy the output and paste into your email client, send to opt-out@emailautomations.cloud.

import "dotenv/config";
import { callAi } from "./ai.js";

const tag = Math.floor(Math.random() * 90000) + 10000;
const replyTo = `dailyaistudio+${tag}@gmail.com`;

const scenarios = [
  {
    type: "opt_out",
    description:
      `A simple polite unsubscribe request from a real-sounding person. ` +
      `Include their full name in the body. State their contact email as ${replyTo} ` +
      `naturally — e.g., "you can confirm at ${replyTo}".`,
  },
  {
    type: "delete",
    description:
      `A formal GDPR Article 17 erasure request. Include the data subject's full name ` +
      `and possibly a phone number. State that the confirmation of erasure should be sent ` +
      `to ${replyTo}.`,
  },
  {
    type: "opt_out_gotcha",
    description:
      `An unsubscribe request where the sender is filing on behalf of someone else ` +
      `(e.g., an assistant or paralegal). The body MUST explicitly request that the ` +
      `confirmation be sent to ${replyTo} (a DIFFERENT address than the From header would ` +
      `suggest). Phrase it like 'please send confirmation to ${replyTo}, not to me'. ` +
      `Include the data subject's name.`,
  },
  {
    type: "know",
    description:
      `A curious, polite question asking how the sender ended up on the mailing list. ` +
      `NOT asking to be removed yet, just wants information. Include the sender's name ` +
      `and state their email as ${replyTo}.`,
  },
  {
    type: "other",
    description:
      "A very short, vague, ambiguous message — something like 'stop' or 'pls remove' " +
      "with no identifying info. Body should be terse and unclear who is asking.",
  },
];

const pick = scenarios[Math.floor(Math.random() * scenarios.length)];

const system =
  "You generate realistic-looking compliance emails for testing an opt-out handler. " +
  "Output ONLY the email — start with 'Subject: ...' on the first line, then a blank line, then the body. " +
  "No commentary, no markdown, no quotes around the output. Vary names, phrasing, and details each time so the message looks unique.";

const prompt = `Generate a unique, plausible email matching this scenario:\n\n${pick.description}`;

const text = (await callAi(prompt, system)).trim();

console.log("\n──────────────────────────────────────────────");
console.log(`  scenario:    ${pick.type}`);
console.log(`  reply-to:    ${replyTo}`);
console.log("──────────────────────────────────────────────\n");
console.log(text);
console.log("\n──────────────────────────────────────────────");
console.log("  Paste into your mail client and send to:");
console.log("  → opt-out@emailautomations.cloud");
console.log("──────────────────────────────────────────────\n");
