import { escapeHtml } from './html';

interface LobbyPlayer { name: string; sessionId: string; }
interface LobbyViewState {
  code: string; capacity: number; publicRoom: boolean; host: boolean;
  hostSession: string; localSession: string; minutes: number; players: LobbyPlayer[];
}

export class LobbyComponent {
  private root: HTMLElement;
  private state: LobbyViewState;
  private starting = false;
  private leaving = false;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  private rosterKey = '';

  constructor(parent: HTMLElement, state: LobbyViewState, onStart: () => void, onLeave: () => Promise<void>) {
    this.state = state;
    this.root = document.createElement('main');
    this.root.className = 'pk-lobby';
    this.root.innerHTML = `<div class="pk-lobby-shell">
      <header class="pk-lobby-header"><div class="pk-lobby-brand"><img src="assets/peeranki-logo.webp" alt=""/><span>PEERANKI</span></div><span class="pk-lobby-connected"><i></i> CONNECTED</span></header>
      <div class="pk-lobby-body"><section class="pk-lobby-info" aria-labelledby="pk-lobby-title"><div class="pk-lobby-eyebrow">THE BATTLE STARTS HERE</div><h1 id="pk-lobby-title">Waiting room<span>.</span></h1><p class="pk-lobby-intro">Gather your rivals.<br>Your next match is almost ready.</p>
        <button type="button" class="pk-lobby-code" aria-label="Copy room code"><span>ROOM CODE</span><strong></strong><small>Tap to copy <span aria-hidden="true">⧉</span></small></button>
        <div class="pk-lobby-match"><span class="pk-lobby-privacy"></span><span class="pk-lobby-capacity"></span><span class="pk-lobby-duration"></span></div>
        <div class="pk-lobby-search"><span class="pk-lobby-search-icon" aria-hidden="true">⌕</span><div><strong class="pk-lobby-status" role="status"></strong><p class="pk-lobby-hint"></p></div></div>
      </section>
      <section class="pk-lobby-roster" aria-label="Room players"><header><div><span>YOUR MATCH</span><h2>Players assembled</h2></div><div class="pk-lobby-count"><strong>0</strong><span></span></div></header><div class="pk-lobby-progress" aria-hidden="true"><span></span></div><div class="pk-lobby-slots"></div><div class="pk-lobby-roster-note">Everyone starts with a gun. Strategy does the rest.</div></section></div>
      <footer class="pk-lobby-footer"><button type="button" class="pk-lobby-leave">← <span>Leave room</span></button><span class="pk-lobby-footnote"></span><button type="button" class="pk-lobby-start">Start game <span aria-hidden="true">→</span></button></footer>
    </div>`;
    this.root.querySelector<HTMLButtonElement>('.pk-lobby-code')!.onclick = async () => {
      const caption = this.root.querySelector('.pk-lobby-code small')!;
      try {
        await navigator.clipboard.writeText(this.state.code);
        caption.textContent = 'Copied! Share it with your friends.';
        this.root.querySelector('.pk-lobby-code')!.classList.add('is-copied');
        if (this.copyTimer) clearTimeout(this.copyTimer);
        this.copyTimer = setTimeout(() => { caption.textContent = 'Tap to copy ⧉'; this.root.querySelector('.pk-lobby-code')!.classList.remove('is-copied'); this.copyTimer = null; }, 2200);
      } catch { caption.textContent = 'Select and copy the code above.'; }
    };
    this.root.querySelector<HTMLButtonElement>('.pk-lobby-start')!.onclick = () => { if (!this.starting && !this.leaving) onStart(); };
    this.root.querySelector<HTMLButtonElement>('.pk-lobby-leave')!.onclick = async () => {
      if (this.leaving) return;
      this.leaving = true;
      this.root.querySelector<HTMLButtonElement>('.pk-lobby-leave')!.disabled = true;
      this.setStatus('Leaving room…', 'waiting');
      await onLeave();
    };
    parent.append(this.root);
    this.update(state);
  }

  update(state: LobbyViewState) {
    this.state = state;
    this.root.classList.toggle('pk-lobby-large', state.capacity > 5);
    const count = state.players.length, missing = Math.max(0, state.capacity - count);
    this.root.querySelector('.pk-lobby-code strong')!.textContent = state.code;
    this.root.querySelector('.pk-lobby-privacy')!.textContent = state.publicRoom ? 'PUBLIC ROOM' : 'PRIVATE ROOM';
    this.root.querySelector('.pk-lobby-capacity')!.textContent = `${state.capacity} players`;
    this.root.querySelector('.pk-lobby-duration')!.textContent = `${state.minutes} min match`;
    this.root.querySelector('.pk-lobby-count strong')!.textContent = String(count).padStart(2, '0');
    this.root.querySelector('.pk-lobby-count>span')!.textContent = `/ ${String(state.capacity).padStart(2, '0')}`;
    this.root.querySelector<HTMLElement>('.pk-lobby-progress span')!.style.width = `${Math.min(100, count / state.capacity * 100)}%`;
    this.root.querySelector('.pk-lobby-hint')!.textContent = state.publicRoom ? 'Your match starts automatically when the room is full.' : state.host ? 'Share the room code. Start when everyone has joined.' : 'The host will start once everyone has joined.';
    this.root.querySelector('.pk-lobby-footnote')!.textContent = state.publicRoom ? 'Finding your next rivals' : 'A good rivalry starts with friends';
    const start = this.root.querySelector<HTMLButtonElement>('.pk-lobby-start')!;
    start.hidden = state.publicRoom || !state.host;
    start.disabled = missing > 0 || this.starting || this.leaving;
    start.textContent = this.starting ? 'Starting…' : 'Start game →';
    if (!this.starting && !this.leaving) this.setStatus(missing ? `Waiting for ${missing} more ${missing === 1 ? 'player' : 'players'}` : state.publicRoom ? 'Room full. Starting the match…' : state.host ? 'Everyone’s here. Ready when you are.' : 'Everyone’s here. Waiting for the host…', missing ? 'waiting' : 'ready');
    const key = JSON.stringify([state.players, state.capacity, state.hostSession, state.localSession]);
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    const slots = this.root.querySelector<HTMLElement>('.pk-lobby-slots')!;
    slots.classList.toggle('pk-lobby-many', state.capacity > 5);
    slots.style.setProperty('--slot-rows', String(state.capacity > 5 ? Math.ceil(state.capacity / 2) : state.capacity));
    slots.innerHTML = Array.from({length: state.capacity}, (_, index) => {
      const player = state.players[index];
      return player ? `<div class="pk-lobby-slot is-joined"><span class="pk-lobby-seat">${String(index + 1).padStart(2, '0')}</span><div class="pk-lobby-initial" aria-hidden="true">${escapeHtml(Array.from(player.name)[0]?.toUpperCase() || 'P')}</div><div class="pk-lobby-player"><strong>${player.sessionId === state.hostSession ? '<span class="pk-lobby-host-crown" title="Host">♛</span> ' : ''}${escapeHtml(player.name)}${player.sessionId === state.localSession ? ' <small>YOU</small>' : ''}</strong><span>${player.sessionId === state.hostSession ? '♛ HOST' : 'PLAYER'}</span></div><span class="pk-lobby-ready"><i></i> READY</span></div>` : `<div class="pk-lobby-slot is-empty"><span class="pk-lobby-seat">${String(index + 1).padStart(2, '0')}</span><div class="pk-lobby-initial" aria-hidden="true">+</div><div class="pk-lobby-player"><strong>Open slot</strong><span>Waiting for a rival</span></div><span class="pk-lobby-wait" aria-hidden="true">···</span></div>`;
    }).join('');
  }

  setStarting(value: boolean) { this.starting = value; this.update(this.state); if (value) this.setStatus('Starting the match…', 'ready'); }
  setStatus(message: string, kind: 'waiting' | 'ready' | 'error') {
    const status = this.root.querySelector<HTMLElement>('.pk-lobby-status')!;
    status.textContent = message;
    status.dataset.kind = kind;
  }
  destroy() { if (this.copyTimer) clearTimeout(this.copyTimer); this.root.remove(); }
}
