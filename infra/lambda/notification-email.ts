import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export type NotificationMessage = {
  subject: string;
  headline: string;
  summary: string;
  detailLines?: string[];
  metaLines?: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  accentColor?: string;
  footerNote?: string;
};

export type NotificationDigestEntry = {
  eventType: string;
  subject: string;
  headline: string;
  summary: string;
  detailLines?: string[];
  projectTitle: string;
  venueName: string;
  actorName: string;
  occurredAt: string;
  ctaUrl?: string;
};

const ses = new SESv2Client({});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/New_York",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function renderShell(content: string, accentColor: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f7fb;font-family:Inter,Helvetica,Arial,sans-serif;color:#162033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;width:100%;background:#ffffff;border:1px solid #e3e8f4;border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(20,32,61,0.08);">
            <tr>
              <td style="padding:0;">
                <div style="height:6px;background:${accentColor};"></div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px;">
                  <div style="font-size:18px;font-weight:800;letter-spacing:-0.02em;color:#162033;">Adspace360</div>
                  <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#7a849a;">Workflow notification</div>
                </div>
                ${content}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderNotificationMessage(message: NotificationMessage) {
  const accentColor = message.accentColor || "#3b66f5";
  const detailList =
    message.detailLines && message.detailLines.length
      ? `<div style="margin-top:20px;padding:18px;border:1px solid #e6ecf7;border-radius:16px;background:#fbfcff;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${accentColor};">What changed</div>
          <ul style="margin:12px 0 0;padding-left:20px;color:#4e5973;">${message.detailLines
          .map((line) => `<li style="margin:0 0 8px;">${escapeHtml(line)}</li>`)
          .join("")}</ul>
        </div>`
      : "";
  const metaRows =
    message.metaLines && message.metaLines.length
      ? `<div style="margin-top:20px;padding:16px 18px;background:#f7f9fd;border:1px solid #e6ecf7;border-radius:14px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#7a849a;">Project context</div>
          <div style="margin-top:8px;display:grid;gap:6px;">${message.metaLines
          .map((line) => `<div style="font-size:13px;line-height:1.6;color:#5a657d;">${escapeHtml(line)}</div>`)
          .join("")}</div>
        </div>`
      : "";
  const cta =
    message.ctaLabel && message.ctaUrl
      ? `<div style="margin-top:24px;"><a href="${escapeHtml(message.ctaUrl)}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:${accentColor};color:#ffffff;text-decoration:none;font-weight:700;">${escapeHtml(message.ctaLabel)}</a></div>`
      : "";
  const footer = message.footerNote
    ? `<div style="margin-top:22px;font-size:12px;line-height:1.6;color:#7a849a;">${escapeHtml(message.footerNote)}</div>`
    : "";

  const html = renderShell(
    `
      <div style="font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${accentColor};">Adspace360 Notification</div>
      <h1 style="margin:12px 0 10px;font-size:28px;line-height:1.15;color:#162033;">${escapeHtml(message.headline)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.7;color:#4e5973;">${escapeHtml(message.summary)}</p>
      ${detailList}
      ${metaRows}
      ${cta}
      ${footer}
    `,
    accentColor
  );

  const textParts = [
    message.headline,
    "",
    message.summary,
    ...(message.detailLines?.length ? ["", ...message.detailLines.map((line) => `- ${line}`)] : []),
    ...(message.metaLines?.length ? ["", ...message.metaLines] : []),
    ...(message.ctaLabel && message.ctaUrl ? ["", `${message.ctaLabel}: ${message.ctaUrl}`] : []),
    ...(message.footerNote ? ["", message.footerNote] : []),
  ];

  return {
    html,
    text: textParts.join("\n"),
  };
}

export function renderDigestMessage(args: {
  customerName: string;
  ruleLabel: string;
  entries: NotificationDigestEntry[];
  ctaLabel?: string;
  ctaUrl?: string;
}) {
  const accentColor = "#2a9d67";
  const subject = `${args.ruleLabel}: ${args.entries.length} update${args.entries.length === 1 ? "" : "s"} for ${args.customerName}`;
  const cards = args.entries
    .map(
      (entry) => `
        <div style="margin-top:16px;padding:18px;border:1px solid #e6ecf7;border-radius:16px;background:#fbfcff;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#2a9d67;">${escapeHtml(entry.projectTitle)} • ${escapeHtml(entry.venueName)}</div>
            <div style="font-size:12px;line-height:1.6;color:#7a849a;">${escapeHtml(formatDateTime(entry.occurredAt))}</div>
          </div>
          <div style="margin-top:8px;font-size:20px;line-height:1.3;font-weight:700;color:#162033;">${escapeHtml(entry.headline)}</div>
          <div style="margin-top:8px;font-size:14px;line-height:1.7;color:#4e5973;">${escapeHtml(entry.summary)}</div>
          <div style="margin-top:12px;font-size:12px;line-height:1.6;color:#7a849a;">Updated by ${escapeHtml(entry.actorName)}</div>
          ${
            entry.detailLines?.length
              ? `<ul style="margin:14px 0 0;padding-left:20px;color:#4e5973;">${entry.detailLines
                  .map((line) => `<li style="margin:0 0 8px;">${escapeHtml(line)}</li>`)
                  .join("")}</ul>`
              : ""
          }
          ${
            entry.ctaUrl
              ? `<div style="margin-top:16px;"><a href="${escapeHtml(entry.ctaUrl)}" style="color:#2a9d67;text-decoration:none;font-weight:700;">Open project</a></div>`
              : ""
          }
        </div>
      `
    )
    .join("");
  const cta =
    args.ctaLabel && args.ctaUrl
      ? `<div style="margin-top:24px;"><a href="${escapeHtml(args.ctaUrl)}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:${accentColor};color:#ffffff;text-decoration:none;font-weight:700;">${escapeHtml(args.ctaLabel)}</a></div>`
      : "";
  const html = renderShell(
    `
      <div style="font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${accentColor};">Adspace360 Digest</div>
      <h1 style="margin:12px 0 10px;font-size:28px;line-height:1.15;color:#162033;">${escapeHtml(args.ruleLabel)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.7;color:#4e5973;">Here is the latest workflow summary for ${escapeHtml(args.customerName)}.</p>
      ${cards}
      ${cta}
      <div style="margin-top:24px;font-size:12px;line-height:1.6;color:#7a849a;">Sent automatically from noreply@adspace360.com based on your customer notification rules.</div>
    `,
    accentColor
  );
  const text = [
    args.ruleLabel,
    "",
    `Workflow summary for ${args.customerName}`,
    "",
    ...args.entries.flatMap((entry) => [
      `${entry.projectTitle} / ${entry.venueName}`,
      entry.headline,
      entry.summary,
      ...(entry.detailLines?.map((line) => `- ${line}`) || []),
      `By ${entry.actorName} at ${formatDateTime(entry.occurredAt)}`,
      entry.ctaUrl ? `Open project: ${entry.ctaUrl}` : "",
      "",
    ]),
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export async function sendNotificationEmail(args: {
  sender: string;
  recipients: string[];
  subject: string;
  html: string;
  text: string;
}) {
  const recipients = Array.from(new Set(args.recipients.map((entry) => entry.trim()).filter(Boolean)));
  if (!args.sender.trim() || recipients.length === 0) return;
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: args.sender,
      Destination: {
        ToAddresses: recipients,
      },
      Content: {
        Simple: {
          Subject: {
            Data: args.subject,
            Charset: "UTF-8",
          },
          Body: {
            Html: {
              Data: args.html,
              Charset: "UTF-8",
            },
            Text: {
              Data: args.text,
              Charset: "UTF-8",
            },
          },
        },
      },
    })
  );
}
