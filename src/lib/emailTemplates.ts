const INK = "#101828";
const MUTED = "#5b6472";
const BORDER = "#e6e9f0";
const SURFACE = "#f7f8fc";
const PRIMARY = "#3b56d9";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function baseTemplate(bodyHtml: string): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:${SURFACE};font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">
<tr><td style="background:${INK};padding:20px 28px;">
<span style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:-0.01em;">🏠 Homelab Panel</span>
</td></tr>
<tr><td style="padding:28px;color:${INK};font-size:14px;line-height:1.6;">
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 28px;background:${SURFACE};border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;">
Cet email a été envoyé automatiquement par ton Homelab Panel.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Wraps plain text (as already used throughout the app) into a minimally-styled branded email —
 * a safe default so every existing sendMail() call gets a nicer result without changes. */
export function simpleEmailHtml(text: string): string {
  const paragraphs = text
    .split("\n\n")
    .map((p) => `<p style="margin:0 0 14px;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return baseTemplate(paragraphs);
}

export function buttonEmailHtml(opts: { intro: string; buttonLabel: string; buttonUrl: string; footerNote?: string }): string {
  return baseTemplate(`
    <p style="margin:0 0 20px;">${escapeHtml(opts.intro).replace(/\n/g, "<br>")}</p>
    <p style="margin:0 0 24px;text-align:center;">
      <a href="${opts.buttonUrl}" style="display:inline-block;background:${PRIMARY};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;">${escapeHtml(opts.buttonLabel)}</a>
    </p>
    ${opts.footerNote ? `<p style="margin:0;color:${MUTED};font-size:12px;">${escapeHtml(opts.footerNote)}</p>` : ""}
  `);
}
