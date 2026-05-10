// index.js — opt-out handler polling loop.
// One service, one loop. The Zapier `opt_outs` Table is the state machine.

import "dotenv/config";
import fs from "node:fs/promises";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { callAi } from "./ai.js";

const {
  ZAPIER_CLIENT_ID,
  ZAPIER_CLIENT_SECRET,
  ZAPIER_IMAP_CONNECTION_ID,
  ZAPIER_SMTP_CONNECTION_ID,
  ZAPIER_SLACK_CONNECTION_ID,
  OPT_OUTS_TABLE_ID,
  CUSTOMERS_TABLE_ID,
  SLACK_REVIEW_CHANNEL = "#opt-out-review",
  POLL_INTERVAL_SECONDS = "60",
  COMPANY_NAME,
  FROM_EMAIL,
} = process.env;

const slackChannel = SLACK_REVIEW_CHANNEL.replace(/^#/, "");
const stamp = () => new Date().toISOString();

const sdk = createZapierSdk({
  credentials: {
    type: "client_credentials",
    clientId: ZAPIER_CLIENT_ID,
    clientSecret: ZAPIER_CLIENT_SECRET,
  },
});

// --- table helpers --------------------------------------------------------

async function createRow(tableId, data) {
  const res = await sdk.createTableRecords({
    table: tableId,
    keyMode: "names",
    records: [{ data }],
  });
  return res.data[0];
}

async function updateRow(tableId, id, data) {
  await sdk.updateTableRecords({
    table: tableId,
    keyMode: "names",
    records: [{ id, data }],
  });
}

async function findOne(tableId, fieldKey, value) {
  const page = await sdk.listTableRecords({
    table: tableId,
    keyMode: "names",
    filters: [{ fieldKey, operator: "exact", value }],
    maxItems: 1,
  });
  return page.data[0] ?? null;
}

async function setStep(rowId, step, extra = {}) {
  return updateRow(OPT_OUTS_TABLE_ID, rowId, { step, last_updated: stamp(), ...extra });
}

// --- IMAP polling ---------------------------------------------------------

async function fetchNewEmails() {
  const page = await sdk.runAction({
    app: "imap",
    actionType: "read",
    action: "email",
    connectionId: ZAPIER_IMAP_CONNECTION_ID,
    inputs: { mailbox: "INBOX" },
  });
  console.log(`imap poll: ${page.data?.length ?? 0} items`);
  return (page.data ?? []).map(normalizeEmail);
}

function normalizeEmail(raw) {
  const name = raw.from_name?.trim() ?? "";
  const addr = raw.from_address?.trim() ?? "";
  const from = name && addr ? `${name} <${addr}>` : (addr || name);
  let receivedAt = stamp();
  if (raw.date) {
    const d = new Date(raw.date);
    if (!Number.isNaN(d.getTime())) receivedAt = d.toISOString();
  }
  return {
    message_id: raw.id ?? null,
    from,
    subject: raw.subject ?? "",
    body: raw.plain_message ?? raw.message_reply_only ?? raw.message ?? "",
    received_at: receivedAt,
  };
}

async function alreadyProcessed(messageId) {
  if (!messageId) return false;
  return Boolean(await findOne(OPT_OUTS_TABLE_ID, "gmail_message_id", messageId));
}

// --- AI steps -------------------------------------------------------------

async function classify(email) {
  const system =
    "You classify compliance emails. Reply with ONLY one of: opt_out, delete, know, other.";
  const prompt = `Subject: ${email.subject}\nFrom: ${email.from}\n\n${email.body}\n\nClassification:`;
  const raw = (await callAi(prompt, system)).trim().toLowerCase();
  return ["opt_out", "delete", "know", "other"].includes(raw) ? raw : "other";
}

async function extract(email) {
  const system =
    "You extract structured data from compliance emails. Output ONLY valid JSON, no prose. " +
    'Schema: {"first_name": string|null, "last_name": string|null, "email_address": string|null, ' +
    '"phone": string|null, "reply_to_address": string, "confidence_score": number}. ' +
    "reply_to_address: scan the BODY for an alternate address ('please send confirmation to...', " +
    "a different email in a signature, a forwarded chain). Only fall back to the From: header if " +
    "the body doesn't specify otherwise. confidence_score (0..1) reflects how sure you are about " +
    "reply_to_address and identity together — drop it when the body has competing addresses.";
  const prompt = `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body}`;
  const raw = await callAi(prompt, system);
  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    return JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  } catch {
    return null;
  }
}

async function generateReply(name) {
  const system =
    "You write concise compliance confirmation emails. 2 sentences. Professional. No fluff.";
  const today = new Date().toISOString().slice(0, 10);
  const who = name?.trim() || "you";
  const prompt = `Write a 2-sentence professional confirmation that ${COMPANY_NAME} has removed ${who} from our list, dated ${today}.`;
  return callAi(prompt, system);
}

// --- Zapier writes (SMTP + Slack) -----------------------------------------

async function sendConfirmation(toAddr, subject, body) {
  return sdk.runAction({
    app: "smtp",
    actionType: "write",
    action: "outbound",
    connectionId: ZAPIER_SMTP_CONNECTION_ID,
    inputs: {
      from_email: FROM_EMAIL,
      from_name: COMPANY_NAME,
      to: toAddr,
      subject,
      body,
    },
  });
}

async function postSlack(text) {
  return sdk.runAction({
    app: "slack",
    actionType: "write",
    action: "channel_message",
    connectionId: ZAPIER_SLACK_CONNECTION_ID,
    inputs: { channel: slackChannel, text },
  });
}

async function escalate(rowId, reason, summary) {
  await updateRow(OPT_OUTS_TABLE_ID, rowId, { status: "escalated", last_updated: stamp() });
  return postSlack(
    `:rotating_light: Opt-out needs human review (${reason})\nRow: ${rowId}\n${summary}`
  );
}

// --- customer side-effect -------------------------------------------------

async function markCustomerOptedOut(emailAddr) {
  if (!emailAddr) return false;
  const found = await findOne(CUSTOMERS_TABLE_ID, "email", emailAddr);
  if (!found) return false;
  await updateRow(CUSTOMERS_TABLE_ID, found.id, {
    opted_out: true,
    opted_out_at: stamp(),
  });
  return true;
}

// --- pipeline -------------------------------------------------------------

async function processEmail(email) {
  if (await alreadyProcessed(email.message_id)) return;

  // 1. record the raw email + start state
  const row = await createRow(OPT_OUTS_TABLE_ID, {
    raw_email: email.body,
    from_address: email.from,
    received_at: email.received_at,
    gmail_message_id: email.message_id ?? "",
    status: "running",
    step: "new_email",
    last_updated: stamp(),
  });

  try {
    // 2. classify
    await setStep(row.id, "classifying");
    const classification = await classify(email);
    await updateRow(OPT_OUTS_TABLE_ID, row.id, { classification, last_updated: stamp() });

    if (classification === "know" || classification === "other") {
      return escalate(row.id, classification, `From: ${email.from}\nSubject: ${email.subject}`);
    }

    // 3. extract
    await setStep(row.id, "extracting");
    const data = await extract(email);
    if (!data) return escalate(row.id, "extract_parse_failed", email.subject);
    await updateRow(OPT_OUTS_TABLE_ID, row.id, {
      extracted_json: JSON.stringify(data),
      last_updated: stamp(),
    });
    if ((data.confidence_score ?? 0) < 0.7 || !data.reply_to_address) {
      return escalate(
        row.id,
        "low_confidence",
        `confidence=${data.confidence_score} reply_to=${data.reply_to_address}`
      );
    }

    // 4. generate reply
    await setStep(row.id, "generating_reply");
    const reply = await generateReply([data.first_name, data.last_name].filter(Boolean).join(" "));
    await updateRow(OPT_OUTS_TABLE_ID, row.id, { reply_draft: reply, last_updated: stamp() });

    // 5. mark customer opted out (best-effort)
    await setStep(row.id, "removing_from_customers");
    await markCustomerOptedOut(data.email_address);

    // 6. send confirmation
    await sendConfirmation(
      data.reply_to_address,
      `Opt-out confirmed — ${COMPANY_NAME}`,
      reply
    );
    await updateRow(OPT_OUTS_TABLE_ID, row.id, {
      status: "completed",
      step: "email_sent",
      last_updated: stamp(),
    });
  } catch (err) {
    await updateRow(OPT_OUTS_TABLE_ID, row.id, {
      status: "error",
      error: String(err?.stack ?? err),
      last_updated: stamp(),
    });
    throw err;
  }
}

async function tick() {
  let emails = [];
  let err = null;
  try {
    emails = await fetchNewEmails();
  } catch (e) {
    err = e;
    console.error("fetchNewEmails failed:", e);
  }
  for (const email of emails) {
    try {
      await processEmail(email);
    } catch (e) {
      console.error("processEmail failed:", e);
    }
  }
  await heartbeat({ last_tick: stamp(), emails_seen: emails.length, error: err ? String(err) : null });
}

async function heartbeat(state) {
  try {
    await fs.writeFile(".state.json", JSON.stringify(state, null, 2));
  } catch {}
}

async function main() {
  const intervalMs = Number(POLL_INTERVAL_SECONDS) * 1000;
  console.log(`opt-out-handler started. polling every ${POLL_INTERVAL_SECONDS}s`);
  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main();
