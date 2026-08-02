// Telegram bot bildirimleri (opsiyonel — token ayarlanmissa calisir)

export function escTg(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Telegram HTML'inde href degeri icin guvenli baglanti uretir.
 * Oznitelik icinde tirnak da kacirilmali (escTg tirnagi kacirmaz) ve
 * yalnizca http/https kabul edilir - bozuk/uydurma bir URL mesaja
 * sahte baglanti enjekte edemesin.
 */
export function tgLink(url: string, text: string): string {
  const safeText = escTg(text || 'Ürün');
  let ok = false;
  try {
    const u = new URL(url);
    ok = u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    ok = false;
  }
  if (!ok) return `<b>${safeText}</b>`;
  const href = encodeURI(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<a href="${href}">${safeText}</a>`;
}

export async function sendTelegram(token: string, chatId: string, html: string): Promise<boolean> {
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: false },
      }),
    });
    const j: any = await res.json().catch(() => null);
    return Boolean(j?.ok);
  } catch {
    return false;
  }
}

/** Bot'a /start yazan son kullanicinin chat id'sini bulur (kurulum sihirbazi icin) */
export async function detectChatId(
  token: string
): Promise<{ ok: boolean; chatId?: string; name?: string; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=20`);
    const j: any = await res.json().catch(() => null);
    if (!j?.ok) return { ok: false, error: j?.description ?? 'Token geçersiz görünüyor' };
    const updates: any[] = j.result ?? [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const msg = updates[i]?.message ?? updates[i]?.edited_message;
      const chat = msg?.chat;
      if (chat?.id) {
        const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || chat.title || '';
        return { ok: true, chatId: String(chat.id), name };
      }
    }
    return { ok: false, error: 'Mesaj bulunamadı. Önce Telegram\'da botunuza "/start" yazın, sonra tekrar deneyin.' };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Bağlantı hatası' };
  }
}
