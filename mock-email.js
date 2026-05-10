// mock-email.js — generate a random plausible opt-out email via AI.
// Run with: npm run mockemail
// Copy the output and paste into your email client, send to opt-out@emailautomations.cloud.

import "dotenv/config";
import { callAi } from "./ai.js";

const scenarios = [
  {
    type: "opt_out",
    description:
      "A simple polite unsubscribe request from a real-sounding person. Include their full name and personal email address clearly in the body.",
  },
  {
    type: "delete",
    description:
      "A formal GDPR Article 17 erasure request. Include the data subject's full name, personal email, and possibly a phone number. Sign off professionally.",
  },
  {
    type: "opt_out_gotcha",
    description:
      "An unsubscribe request where the sender is filing on behalf of someone else (e.g., an assistant or paralegal). The body MUST explicitly request that the confirmation be sent to a DIFFERENT email address than would be used by default — phrase it like 'please send confirmation to compliance@...' or 'reply to ... not me'. Include both names and both addresses clearly.",
  },
  {
    type: "know",
    description:
      "A curious, polite question asking how the sender ended up on the mailing list. They are NOT asking to be removed yet, they just want information about the data source. Include the sender's name.",
  },
  {
    type: "other",
    description:
      "A very short, vague, ambiguous message — something like 'stop' or 'pls remove' with no identifying info, possibly forwarded from another address. The body should be terse and unclear who is asking.",
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
console.log(`  scenario: ${pick.type}`);
console.log("──────────────────────────────────────────────\n");
console.log(text);
console.log("\n──────────────────────────────────────────────");
console.log("  Paste into your mail client and send to:");
console.log("  → opt-out@emailautomations.cloud");
console.log("──────────────────────────────────────────────\n");
