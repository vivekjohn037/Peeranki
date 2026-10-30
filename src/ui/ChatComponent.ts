import type { VoiceState } from '../game/VoiceChat';
import { QUICK_MESSAGES } from '../game/chat';

export class ChatComponent {
  private voiceEl: HTMLElement | null = null;
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
  mountVoice(actions: {join:()=>void; mute:()=>void; deafen:()=>void; leave:()=>void}) {
    this.voiceEl=document.createElement('div'); this.voiceEl.className='pk-voice';
    this.voiceEl.innerHTML='<div class="pk-voice-heading"><strong>🎙 Voice chat</strong><span class="pk-voice-count"></span></div><div class="pk-voice-actions"><button type="button" data-voice="join">Join voice</button><button type="button" data-voice="mute" hidden>Mute mic</button><button type="button" data-voice="deafen" hidden>Mute speakers</button><button type="button" data-voice="leave" hidden>Leave voice</button></div><small class="pk-voice-status" role="status">Voice is off · join to talk</small>';
    for(const [key,action] of Object.entries(actions)) this.voiceEl.querySelector('[data-voice="'+key+'"]')!.addEventListener('click',action);
    this.panel.querySelector('header')!.after(this.voiceEl);
  }
  updateVoice(state: VoiceState) {
    if(!this.voiceEl)return;
    const button=(key:string)=>this.voiceEl!.querySelector<HTMLButtonElement>('[data-voice="'+key+'"]')!;
    button('join').hidden=state.joined; button('join').disabled=state.busy; button('join').textContent=state.busy?'Joining…':'Join voice';
    for(const key of ['mute','deafen'])button(key).hidden=!state.joined;
    button('leave').hidden=!state.joined&&!state.busy;
    button('mute').textContent=state.muted?'Unmute mic':'Mute mic'; button('mute').setAttribute('aria-pressed',String(state.muted));
    button('deafen').textContent=state.deafened?'Unmute speakers':'Mute speakers'; button('deafen').setAttribute('aria-pressed',String(state.deafened));
    this.voiceEl.querySelector('.pk-voice-status')!.textContent=state.message;
    this.voiceEl.querySelector('.pk-voice-count')!.textContent=state.joined ? state.connected+' connected' : 'Off';
    this.toggle.classList.toggle('pk-voice-active',state.joined);
    this.toggle.setAttribute('aria-label',state.joined ? 'Open match chat · '+(state.muted?'microphone muted':'microphone on') : 'Open match chat');
    this.toggle.title=state.joined ? (state.muted?'Voice joined · microphone muted':'Voice joined · microphone on') : 'Open match chat';
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
