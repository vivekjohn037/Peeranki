import { QUICK_MESSAGES } from '../game/chat';

export class ChatComponent {
  private panel = document.createElement('section');
  private toggle = document.createElement('button');
  private input: HTMLInputElement;
  private list: HTMLElement;
  private status: HTMLElement;
  private buttons: HTMLButtonElement[];
  private ready = false;
  private sending = false;
  private lastSent = -Infinity;
  private unread = 0;
  private open = false;
  private returnFocus: HTMLElement | null = null;
  private send: (text: string) => Promise<void>;
  constructor(send: (text: string) => Promise<void>) {
    this.send = send;
    this.toggle.type = 'button'; this.toggle.className = 'pk-btn-icon pk-chat-toggle';
    this.toggle.textContent = '💬'; this.toggle.setAttribute('aria-label', 'Open match chat');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.panel.className = 'pk-chat'; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Match chat');
    this.panel.innerHTML = `<header><div><strong>Match chat</strong><small>Only players in this room · not saved</small></div><button type="button" aria-label="Close chat">✕</button></header><div class="pk-chat-messages" role="log" aria-live="polite" aria-relevant="additions"><p class="pk-chat-empty">Say hello to your opponents 👋</p></div><div class="pk-chat-quick" aria-label="Quick messages"></div><form><input aria-label="Message" maxlength="160" placeholder="Type a message…" autocomplete="off" enterkeyhint="send"><button type="submit">Send</button></form><small class="pk-chat-status" role="status">Connecting…</small>`;
    this.input = this.panel.querySelector('input')!;
    this.list = this.panel.querySelector('.pk-chat-messages')!;
    this.status = this.panel.querySelector('.pk-chat-status')!;
    const quick = this.panel.querySelector('.pk-chat-quick')!;
    QUICK_MESSAGES.forEach(text => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = () => void this.submit(text); quick.append(b); });
    this.buttons = Array.from(this.panel.querySelectorAll('form button, .pk-chat-quick button'));
    this.toggle.onclick = () => this.setOpen(!this.open);
    this.panel.querySelector('header button')!.addEventListener('click', () => this.setOpen(false));
    this.panel.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); if (!this.input.matches(':disabled')) void this.submit(this.input.value); });
    this.panel.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); this.setOpen(false); } });
    for (const type of ['pointerdown', 'pointerup', 'click']) this.panel.addEventListener(type, event => event.stopPropagation());
    this.setReady(false);
  }
  getButton() { return this.toggle; }
  getElement() { return this.panel; }
  setOpen(open: boolean) {
    this.open = open; this.panel.hidden = !open; this.toggle.setAttribute('aria-expanded', String(open));
    if (open) { this.returnFocus = document.activeElement as HTMLElement; this.unread = 0; this.toggle.textContent = '💬'; this.list.scrollTop = this.list.scrollHeight; }
    else { this.input.blur(); this.returnFocus?.focus({ preventScroll: true }); }
  }
  setReady(ready: boolean) { this.ready = ready; this.input.disabled = !ready; this.buttons.forEach(b => b.disabled = !ready || this.sending); this.status.textContent = ready ? 'Be kind · 160 characters max' : 'Chat reconnecting…'; }
  add(name: string, text: string, own: boolean) {
    this.list.querySelector('.pk-chat-empty')?.remove();
    const row = document.createElement('p'); row.className = own ? 'pk-chat-own' : '';
    const author = document.createElement('strong'); author.textContent = own ? 'You' : name;
    const body = document.createElement('span'); body.textContent = text;
    row.append(author, body); this.list.append(row);
    while (this.list.children.length > 50) this.list.firstElementChild?.remove();
    this.list.scrollTop = this.list.scrollHeight;
    if (!own && !this.open) { this.unread++; this.toggle.textContent = `💬 ${Math.min(this.unread, 99)}`; }
  }
  private async submit(value: string) {
    const text = value.trim(); if (!text || text.length > 160 || !this.ready || this.sending) return;
    if (Date.now() - this.lastSent < 1000) { this.status.textContent = 'Wait a moment before sending again.'; return; }
    this.sending = true; this.setReady(this.ready);
    try { await this.send(text); this.lastSent = Date.now(); if (this.input.value.trim() === text) this.input.value = ''; }
    catch (error) { this.status.textContent = error instanceof Error ? error.message : 'Message was not sent.'; }
    finally { this.sending = false; this.buttons.forEach(b => b.disabled = !this.ready); }
  }
  destroy() { this.panel.remove(); this.toggle.remove(); }
}
