/*
 * Transactional email through Resend's REST API (https://resend.com/docs/api-reference/emails/send-email).
 * Configure RESEND_API_KEY and EMAIL_FROM (an address on a domain you have verified with Resend: SPF + DKIM records).
 * With no key configured, local/dev runs print the message to the server log instead; a deployed site reports failure
 * so callers never pretend an email went out.
 */
const { env, IS_DEPLOYED, BASE_URL } = require('./config');

async function send({ to, subject, text, html }) {
  const key = env('RESEND_API_KEY'), from = env('EMAIL_FROM');
  if (!key || !from) {
    if (!IS_DEPLOYED) { console.log('[pasteboard:email:dev] to=' + to + ' subject=' + subject + '\n' + text); return { sent: false, dev: true }; }
    console.error('[pasteboard] RESEND_API_KEY / EMAIL_FROM are not set — cannot send email to ' + to);
    return { sent: false, error: 'Email is not configured on the server.' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html: html || undefined }),
    });
    if (!res.ok) { console.error('[pasteboard] email provider rejected message', res.status, await res.text().catch(() => '')); return { sent: false, error: 'The email provider rejected the message.' }; }
    return { sent: true };
  } catch (e) { console.error('[pasteboard] email send failed', e && e.message); return { sent: false, error: 'Could not reach the email provider.' }; }
}

const wrap = (title, bodyHtml) => '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111827"><h2 style="font-size:18px">' + title + '</h2>' + bodyHtml + '<p style="color:#6b7280;font-size:12px;margin-top:28px">PasteBoard · ' + BASE_URL + '</p></div>';
const btn = (url, label) => '<p><a href="' + url + '" style="display:inline-block;background:#111827;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">' + label + '</a></p><p style="font-size:12px;color:#6b7280">Or paste this link into your browser:<br>' + url + '</p>';

const mail = {
  verify: (to, url) => send({ to, subject: 'Verify your PasteBoard email', text: 'Confirm your email address to finish setting up PasteBoard:\n' + url + '\n\nThis link expires in 48 hours. If you did not sign up, ignore this email.', html: wrap('Verify your email', '<p>Confirm your email address to finish setting up PasteBoard.</p>' + btn(url, 'Verify email') + '<p style="font-size:12px;color:#6b7280">Expires in 48 hours. If you did not sign up, ignore this email.</p>') }),
  reset: (to, url) => send({ to, subject: 'Reset your PasteBoard password', text: 'Someone asked to reset the password for this PasteBoard account.\nSet a new password here (valid for 30 minutes, works once):\n' + url + '\n\nIf this was not you, ignore this email — your password has not changed.', html: wrap('Reset your password', '<p>Someone asked to reset the password for this PasteBoard account. This link works once and expires in 30 minutes.</p>' + btn(url, 'Choose a new password') + '<p style="font-size:12px;color:#6b7280">If this was not you, ignore this email — your password has not changed.</p>') }),
  invite: (to, url, inviter, accountName) => send({ to, subject: inviter + ' invited you to PasteBoard', text: inviter + ' invited you to join ' + accountName + ' on PasteBoard.\nAccept the invitation (expires in 7 days):\n' + url + '\n\nYour clipboard history, snippets and other content always stay on your own computer.', html: wrap('You’re invited to PasteBoard', '<p><b>' + inviter + '</b> invited you to join <b>' + accountName + '</b>.</p>' + btn(url, 'Accept invitation') + '<p style="font-size:12px;color:#6b7280">Expires in 7 days. Your clipboard history, snippets and other content always stay on your own computer.</p>') }),
};
module.exports = { send, mail };
