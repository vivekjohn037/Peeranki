export const QUICK_MESSAGES = ['Good luck! 🍀', 'Nice shot! 🎯', 'Well played! 👏', 'That was close! 😅', 'Rematch? ⚔️', 'Thanks! 🙌'];
export interface ChatMessage { id: string; sender: string; text: string; }
export function normalizeChatMessage(value: unknown): ChatMessage | null {
  const v = value as Partial<ChatMessage> | null;
  if (!v || typeof v.id !== 'string' || !v.id || v.id.length > 100 || typeof v.sender !== 'string' || !v.sender || v.sender.length > 100 || typeof v.text !== 'string') return null;
  const text = v.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!text || text.length > 160) return null;
  return { id: v.id, sender: v.sender, text };
}
/** Bounded, room-scoped deduplication and spam protection. */
export class ChatInbox {
  private seen = new Set<string>();
  private last = new Map<string, number>();
  accept(value: unknown, now = Date.now()): ChatMessage | null {
    const message = normalizeChatMessage(value);
    if (!message || this.seen.has(message.id) || now - (this.last.get(message.sender) ?? -Infinity) < 1000) return null;
    this.seen.add(message.id); this.last.set(message.sender, now);
    if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value!);
    if (this.last.size > 20) this.last.delete(this.last.keys().next().value!);
    return message;
  }
}
