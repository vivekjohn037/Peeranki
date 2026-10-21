import { Capacitor } from '@capacitor/core';
import { showLeaderboard } from './LeaderboardModal';

interface MenuOptions {
  playerName: string;
  muted: boolean;
  onName: (name: string) => void;
  onPlay: (online: boolean) => void;
  onSettings: () => void;
  onGuide: () => void;
  onExit: () => void;
  onMute: () => boolean;
}

export class MainMenuComponent {
  private root: HTMLElement;

  constructor(parent: HTMLElement, options: MenuOptions) {
    this.root = document.createElement('main');
    this.root.className = 'pk-home';
    this.root.innerHTML = `
      <div class="pk-home-shell">
        <header class="pk-home-top"><a class="pk-home-brand" href="#" aria-label="Peeranki home"><img src="assets/peeranki-logo.webp" alt=""/><span>PEERANKI<small>THE KERALA STRATEGY GAME</small></span></a>
          <nav aria-label="Quick actions">${Capacitor.getPlatform() !== 'android' ? '<a href="/download.html" class="pk-home-download" aria-label="Download Android app">↓ <span>Get Android app</span></a>' : ''}<button type="button" class="pk-home-sound" aria-label="Mute music"></button></nav>
        </header>
        <div class="pk-home-content">
          <section class="pk-home-story" aria-labelledby="pk-home-title"><div class="pk-home-eyebrow"><span></span> ROOTED IN KERALA. READY FOR RIVALRY.</div>
            <h1 id="pk-home-title">Small village.<br><em>Big rivalries.</em></h1><p class="pk-home-intro">Build your arsenal. Pick your moment.<br>Be the last tower standing.</p>
            <div class="pk-home-player"><div class="pk-home-player-icon" aria-hidden="true">♟</div><div><label for="peeranki-menu-name">WHAT SHOULD WE CALL YOU?</label><input id="peeranki-menu-name" type="text" maxlength="16" autocomplete="nickname" placeholder="Enter your name" spellcheck="false"/></div><span class="pk-home-pencil" aria-hidden="true">✎</span></div>
            <div class="pk-home-player-note">Your name follows you into every battle.</div>
          </section>
          <section class="pk-home-modes" aria-label="Choose your game mode"><div class="pk-home-section-label">CHOOSE YOUR BATTLE <span>01 — 02</span></div>
            <button type="button" class="pk-home-mode pk-home-online"><div class="pk-home-mode-top"><span class="pk-home-mode-icon" aria-hidden="true">⚔</span><span class="pk-home-tag"><i></i> PLAY TOGETHER</span><span class="pk-home-arrow" aria-hidden="true">↗</span></div><h2>Challenge the world</h2><p>Bring your friends. Meet your rivals.<br>Make your mark on the global leaderboard.</p><div class="pk-home-mode-bottom"><span>ONLINE MULTIPLAYER</span><strong>Let’s play <span aria-hidden="true">→</span></strong></div></button>
            <button type="button" class="pk-home-mode pk-home-offline"><div class="pk-home-mode-top"><span class="pk-home-mode-icon" aria-hidden="true">♜</span><span class="pk-home-tag">YOUR OWN PACE</span><span class="pk-home-arrow" aria-hidden="true">↗</span></div><h2>Sharpen your strategy</h2><p>Take on the bots. Try a new tactic.<br>Your next great rivalry starts here.</p><div class="pk-home-mode-bottom"><span>OFFLINE · VS BOTS</span><strong>Practice <span aria-hidden="true">→</span></strong></div></button>
            <button type="button" class="pk-home-ranks"><span class="pk-home-ranks-icon" aria-hidden="true">♛</span><span><strong>The winners’ circle</strong><small>100 points per win. How high will you climb?</small></span><span aria-hidden="true">↗</span></button>
          </section>
        </div>
        <footer class="pk-home-footer"><span class="pk-home-origin">A little Kerala. A lot of strategy.</span><nav aria-label="Game options"><button type="button" data-action="guide">How to play</button><span>·</span><button type="button" data-action="settings">Settings</button><span>·</span><button type="button" data-action="exit">Exit game</button></nav></footer>
      </div>`;
    const input = this.root.querySelector<HTMLInputElement>('input')!;
    input.value = options.playerName;
    input.addEventListener('input', () => options.onName(input.value));
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { input.blur(); this.root.querySelector<HTMLButtonElement>('.pk-home-online')!.focus(); } });
    const sound = this.root.querySelector<HTMLButtonElement>('.pk-home-sound')!;
    const setSound = (muted: boolean) => { sound.textContent = muted ? '🔇' : '🔊'; sound.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music'); sound.setAttribute('aria-pressed', String(muted)); };
    setSound(options.muted);
    sound.onclick = () => setSound(options.onMute());
    this.root.querySelector<HTMLAnchorElement>('.pk-home-brand')!.onclick = event => event.preventDefault();
    this.root.querySelector<HTMLButtonElement>('.pk-home-online')!.onclick = () => options.onPlay(true);
    this.root.querySelector<HTMLButtonElement>('.pk-home-offline')!.onclick = () => options.onPlay(false);
    this.root.querySelector<HTMLButtonElement>('.pk-home-ranks')!.onclick = () => { void showLeaderboard(); };
    this.root.querySelector<HTMLButtonElement>('[data-action="guide"]')!.onclick = options.onGuide;
    this.root.querySelector<HTMLButtonElement>('[data-action="settings"]')!.onclick = options.onSettings;
    this.root.querySelector<HTMLButtonElement>('[data-action="exit"]')!.onclick = options.onExit;
    parent.append(this.root);
  }

  destroy() { this.root.remove(); }
}
