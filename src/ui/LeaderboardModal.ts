import { fetchGlobalLeaderboard } from '../supabase';
import { escapeHtml } from './html';

export async function showLeaderboard() {
  if (document.querySelector('.pk-leaderboard')) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'pk-modal-backdrop pk-leaderboard';
  backdrop.style.display = 'flex';
  backdrop.style.zIndex = '100000';
  backdrop.innerHTML = `<section class="pk-rank-dialog" role="dialog" aria-modal="true" aria-labelledby="pk-rank-title">
    <header class="pk-rank-header"><div><div class="pk-rank-eyebrow">PEERANKI · WORLD RANKINGS</div><h2 id="pk-rank-title">The winners’ circle<span aria-hidden="true">🏆</span></h2><p>Every victory leaves its mark.</p></div><span class="pk-rank-live"><i></i> GLOBAL</span></header>
    <div class="pk-rank-results" aria-live="polite"><div class="pk-rank-empty">Loading the winners’ circle…</div></div>
    <footer class="pk-rank-footer"><div><strong>+100 points per win</strong><span>Online matches only · Tied winners earn full points</span></div><button type="button" class="pk-rank-close">Back to game <span aria-hidden="true">↗</span></button></footer></section>`;
  const previousFocus = document.activeElement as HTMLElement | null;
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', keydown, true); previousFocus?.focus(); };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key === 'Tab') { event.preventDefault(); button.focus(); }
  };
  const button = backdrop.querySelector('button')!;
  button.onclick = close;
  backdrop.onclick = (event) => { if (event.target === backdrop) close(); };
  document.addEventListener('keydown', keydown, true);
  document.body.append(backdrop);
  button.focus({ preventScroll: true });
  const results = backdrop.querySelector('.pk-rank-results')!;
  try {
    const rows = await fetchGlobalLeaderboard();
    if (!rows.length) {
      results.innerHTML = '<div class="pk-rank-empty"><span aria-hidden="true">✦</span><h3>Your name could be first.</h3><p>Win an online match to claim a place in the rankings.</p></div>';
      return;
    }
    const first = rows[0];
    const number = (value: number) => escapeHtml(Number(value).toLocaleString());
    const rank = (index: number) => rows.findIndex(row => row.points === rows[index].points && row.wins === rows[index].wins) + 1;
    results.innerHTML = `<div class="pk-rank-champion"><div class="pk-rank-crown" aria-hidden="true">♛</div><div class="pk-rank-champion-name"><span>LEADING THE WORLD</span><h3>${escapeHtml(first.player_name)}</h3><p>${number(first.wins)} ${first.wins === 1 ? 'victory' : 'victories'}</p></div><div class="pk-rank-champion-score">${number(first.points)}<span>POINTS</span></div></div>
      <div class="pk-rank-list-heading"><h3>Global leaderboard</h3><span>TOP ${rows.length} / 100</span></div>
      <div class="pk-rank-table-wrap"><table class="pk-rank-table"><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Points</th><th scope="col">Wins</th></tr></thead><tbody>${rows.map((row, index) => `<tr class="${rank(index) <= 3 ? 'pk-rank-top' : ''}"><td><span class="pk-rank-place pk-rank-place-${rank(index)}">${String(rank(index)).padStart(2, '0')}</span></td><th scope="row"><span class="pk-rank-player">${escapeHtml(row.player_name)}</span>${rank(index) === 1 ? '<small>FRONTRUNNER</small>' : ''}</th><td class="pk-rank-points">${number(row.points)}</td><td>${number(row.wins)}</td></tr>`).join('')}</tbody></table></div>`;
  } catch {
    results.innerHTML = '<div class="pk-rank-empty"><h3>Rankings are taking a break.</h3><p>Check your connection and open the leaderboard again.</p></div>';
  }
}
