import type { Env } from '../env';

export interface DeliveryAttempt {
  ok: boolean;
  configured: boolean;
  expired?: boolean;
  error?: string;
}

export function emailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendEmail(
  env: Env,
  input: { to: string; subject: string; html: string; unsubscribeUrl?: string }
): Promise<DeliveryAttempt> {
  if (!emailConfigured(env)) {
    return { ok: false, configured: false, error: 'E-posta sağlayıcısı yapılandırılmadı' };
  }

  const headers: Record<string, string> = {};
  if (input.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${input.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        headers,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      return { ok: false, configured: true, error: `E-posta HTTP ${response.status}${detail ? `: ${detail}` : ''}` };
    }
    return { ok: true, configured: true };
  } catch (error) {
    return { ok: false, configured: true, error: error instanceof Error ? error.message : 'E-posta bağlantı hatası' };
  }
}
