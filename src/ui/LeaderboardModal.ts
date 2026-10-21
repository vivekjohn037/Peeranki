import { fetchGlobalLeaderboard } from '../supabase';
import { escapeHtml } from './html';

export async function showLeaderboard() {
  if (document.querySelector('.pk-leaderboard')) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'pk-modal-backdrop pk-leaderboard';
  backdrop.style.display = 'flex';
  backdrop.style.zIndex = '100000';
  backdrop.innerHTML = `<section role="dialog" aria-modal="true" aria-label="Global leaderboard" style="background:#17212b;color:white;padding:24px;border-radius:16px;width:min(92vw,520px);max-height:85vh;overflow:auto">
    <h2>🏆 Global leaderboard</h2><p>100 points per match win. Tied winners each earn 100 points. Online matches count toward global rankings.</p>
    <div aria-live="polite" class="leaderboard-results">Loading rankings…</div>
    <button type="button" class="pk-btn-secondary">Close</button></section>`;
  const previousFocus = document.activeElement as HTMLElement | null;
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', keydown); previousFocus?.focus(); };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key === 'Tab') { event.preventDefault(); button.focus(); }
  };
  const button = backdrop.querySelector('button')!;
  button.onclick = close;
  backdrop.onclick = (event) => { if (event.target === backdrop) close(); };
  document.addEventListener('keydown', keydown);
  document.body.append(backdrop);
  button.focus();
  const results = backdrop.querySelector('.leaderboard-results')!;
  try {
    const rows = await fetchGlobalLeaderboard();
    results.innerHTML = rows.length ? `<table style="width:100%;text-align:left"><thead><tr><th>Rank</th><th>Player</th><th>Points</th><th>Wins</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(row.player_name)}</td><td>${escapeHtml(row.points)}</td><td>${escapeHtml(row.wins)}</td></tr>`).join('')}</tbody></table>` : '<p>No ranked matches yet. Win an online match to get started!</p>';
  } catch {
    results.textContent = 'Global rankings are unavailable. Check your connection and try again later.';
  }
}
