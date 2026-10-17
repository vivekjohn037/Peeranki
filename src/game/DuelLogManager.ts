import type { RpsChoice } from './rules.ts';
import { RPS_LABELS } from './rules.ts';

export interface DuelFighterInfo {
  id: number;
  name: string;
  avatar?: string;
  choice: RpsChoice;
}

export interface DuelOutcomeEntry {
  id: string;
  round: number;
  clashNumber: number;
  timestamp: number;
  player1: DuelFighterInfo;
  player2: DuelFighterInfo;
  result: 'win' | 'tie';
  winnerId?: number;
  winnerName?: string;
  winnerChoice?: RpsChoice;
  loserId?: number;
  loserName?: string;
  loserChoice?: RpsChoice;
  summaryText: string;
  narrative: string;
  isSample?: boolean;
}

export interface DuelStatsSummary {
  totalClashes: number;
  totalTies: number;
  totalDecisiveWins: number;
  rockCount: number;
  paperCount: number;
  scissorsCount: number;
  mostFavoredChoice: RpsChoice | 'balanced';
  winLeaderboard: Array<{ name: string; wins: number }>;
}

const STORAGE_KEY = 'peeranki_recent_duel_history';
const MAX_HISTORY_ENTRIES = 40;

const RPS_EMOJIS: Record<RpsChoice, string> = {
  rock: '🪨',
  paper: '📄',
  scissors: '✂️',
};

const RPS_VERBS: Record<RpsChoice, Record<RpsChoice, string>> = {
  rock: { scissors: 'crushes', paper: 'is covered by', rock: 'bounces off' },
  paper: { rock: 'covers', scissors: 'is cut by', paper: 'flutters against' },
  scissors: { paper: 'cuts through', rock: 'is crushed by', scissors: 'parries against' },
};

export class DuelLogManager {
  private static instance?: DuelLogManager;

  private currentMatchLog: DuelOutcomeEntry[] = [];

  public static getInstance(): DuelLogManager {
    if (!DuelLogManager.instance) {
      DuelLogManager.instance = new DuelLogManager();
    }
    return DuelLogManager.instance;
  }

  public recordDuelOutcome(params: {
    round: number;
    clashNumber: number;
    player1: DuelFighterInfo;
    player2: DuelFighterInfo;
    result: 'win' | 'tie';
    winnerId?: number;
    winnerName?: string;
    winnerChoice?: RpsChoice;
    loserId?: number;
    loserName?: string;
    loserChoice?: RpsChoice;
    summaryText?: string;
    narrative?: string;
  }): DuelOutcomeEntry {
    const timestamp = Date.now();
    const id = `duel-${timestamp}-${Math.random().toString(36).slice(2, 7)}`;

    const p1ChoiceEmoji = RPS_EMOJIS[params.player1.choice];

    let summaryText = params.summaryText;
    let narrative = params.narrative;

    if (!summaryText) {
      if (params.result === 'tie') {
        summaryText = `Round ${params.round} (Clash #${params.clashNumber}): Both picked ${p1ChoiceEmoji} ${params.player1.choice.toUpperCase()} — Tie!`;
      } else {
        const winChoice = params.winnerChoice || 'rock';
        const loseChoice = params.loserChoice || 'scissors';
        summaryText = `Round ${params.round} (Clash #${params.clashNumber}): ${params.winnerName} (${RPS_EMOJIS[winChoice]} ${winChoice.toUpperCase()}) defeated ${params.loserName} (${RPS_EMOJIS[loseChoice]} ${loseChoice.toUpperCase()})!`;
      }
    }

    if (!narrative) {
      if (params.result === 'tie') {
        narrative = `${params.player1.name} and ${params.player2.name} both threw ${p1ChoiceEmoji} ${params.player1.choice.toUpperCase()}! The weapons clashed in a stalemate tie! Redraw scheduled!`;
      } else {
        const winChoice = params.winnerChoice || 'rock';
        const loseChoice = params.loserChoice || 'scissors';
        const verb = RPS_VERBS[winChoice]?.[loseChoice] || 'beats';
        narrative = `${params.winnerName} selected ${RPS_EMOJIS[winChoice]} ${winChoice.toUpperCase()} which ${verb} ${params.loserName}'s ${RPS_EMOJIS[loseChoice]} ${loseChoice.toUpperCase()}! ${params.winnerName} wins the duel!`;
      }
    }

    const entry: DuelOutcomeEntry = {
      id,
      round: params.round,
      clashNumber: params.clashNumber,
      timestamp,
      player1: params.player1,
      player2: params.player2,
      result: params.result,
      winnerId: params.winnerId,
      winnerName: params.winnerName,
      winnerChoice: params.winnerChoice,
      loserId: params.loserId,
      loserName: params.loserName,
      loserChoice: params.loserChoice,
      summaryText,
      narrative,
    };

    this.currentMatchLog.push(entry);
    this.persistToRecentHistory(entry);

    return entry;
  }

  public getCurrentMatchLog(): DuelOutcomeEntry[] {
    return [...this.currentMatchLog];
  }

  public getRecentHistory(): DuelOutcomeEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch {
      // ignore JSON storage error
    }
    return [];
  }

  public clearCurrentMatchLog(): void {
    this.currentMatchLog = [];
  }

  public clearAllHistory(): void {
    this.currentMatchLog = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  private persistToRecentHistory(entry: DuelOutcomeEntry): void {
    try {
      const history = this.getRecentHistory();
      const updated = [entry, ...history.filter((e) => e.id !== entry.id)].slice(0, MAX_HISTORY_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore localStorage quota error
    }
  }

  /**
   * Returns current match log if non-empty, otherwise recent session history,
   * or a realistic demo sample log if no duels have occurred yet.
   */
  public getEffectiveLog(): { entries: DuelOutcomeEntry[]; isCurrentMatch: boolean; isSample: boolean } {
    if (this.currentMatchLog.length > 0) {
      return { entries: [...this.currentMatchLog], isCurrentMatch: true, isSample: false };
    }

    const recent = this.getRecentHistory();
    if (recent.length > 0) {
      return { entries: recent, isCurrentMatch: false, isSample: false };
    }

    return { entries: this.generateSampleDuelLog(), isCurrentMatch: false, isSample: true };
  }

  public getDuelStats(entries: DuelOutcomeEntry[] = this.currentMatchLog): DuelStatsSummary {
    let rockCount = 0;
    let paperCount = 0;
    let scissorsCount = 0;
    let totalTies = 0;
    let totalDecisiveWins = 0;
    const winCounts: Record<string, number> = {};

    entries.forEach((e) => {
      [e.player1.choice, e.player2.choice].forEach((c) => {
        if (c === 'rock') rockCount++;
        else if (c === 'paper') paperCount++;
        else if (c === 'scissors') scissorsCount++;
      });

      if (e.result === 'tie') {
        totalTies++;
      } else {
        totalDecisiveWins++;
        if (e.winnerName) {
          winCounts[e.winnerName] = (winCounts[e.winnerName] || 0) + 1;
        }
      }
    });

    let mostFavoredChoice: RpsChoice | 'balanced' = 'balanced';
    if (rockCount > paperCount && rockCount > scissorsCount) mostFavoredChoice = 'rock';
    else if (paperCount > rockCount && paperCount > scissorsCount) mostFavoredChoice = 'paper';
    else if (scissorsCount > rockCount && scissorsCount > paperCount) mostFavoredChoice = 'scissors';

    const winLeaderboard = Object.entries(winCounts)
      .map(([name, wins]) => ({ name, wins }))
      .sort((a, b) => b.wins - a.wins);

    return {
      totalClashes: entries.length,
      totalTies,
      totalDecisiveWins,
      rockCount,
      paperCount,
      scissorsCount,
      mostFavoredChoice,
      winLeaderboard,
    };
  }

  /**
   * Generates a beautifully formatted ASCII text summary and audit log.
   */
  public generateFormattedTextSummary(entries: DuelOutcomeEntry[] = this.currentMatchLog): string {
    const effectiveEntries = entries.length > 0 ? entries : this.getEffectiveLog().entries;
    const stats = this.getDuelStats(effectiveEntries);

    const divider = '======================================================================';
    const subDivider = '----------------------------------------------------------------------';

    const lines: string[] = [];
    lines.push(divider);
    lines.push('             PEERANKI · DUEL SHOWDOWN COMBAT LOG & SUMMARY            ');
    lines.push(divider);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push(`Total Clashes Fought : ${stats.totalClashes}`);
    lines.push(`Decisive Duel Wins   : ${stats.totalDecisiveWins} (${stats.totalClashes > 0 ? Math.round((stats.totalDecisiveWins / stats.totalClashes) * 100) : 0}%)`);
    lines.push(`Stalemate Ties       : ${stats.totalTies} (${stats.totalClashes > 0 ? Math.round((stats.totalTies / stats.totalClashes) * 100) : 0}%)`);
    lines.push(
      `Hand Frequencies     : 🪨 Rock: ${stats.rockCount}  |  📄 Paper: ${stats.paperCount}  |  ✂️ Scissors: ${stats.scissorsCount}`,
    );
    lines.push(`Dominant Weapon      : ${stats.mostFavoredChoice.toUpperCase()}`);

    if (stats.winLeaderboard.length > 0) {
      lines.push('');
      lines.push('🏆 DUEL WIN LEADERS:');
      stats.winLeaderboard.forEach((leader, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : ' •';
        lines.push(`  ${medal} ${leader.name.padEnd(20)} : ${leader.wins} showdown win${leader.wins === 1 ? '' : 's'}`);
      });
    }

    lines.push('');
    lines.push(subDivider);
    lines.push('CHRONOLOGICAL DUEL CLASH TIMELINE:');
    lines.push(subDivider);

    effectiveEntries.forEach((entry, index) => {
      const timeStr = new Date(entry.timestamp).toLocaleTimeString();
      const p1Choice = RPS_LABELS[entry.player1.choice];
      const p2Choice = RPS_LABELS[entry.player2.choice];
      const badge = entry.result === 'tie' ? '[STALEMATE TIE]' : `[VICTORY: ${entry.winnerName}]`;

      lines.push(`[#${index + 1}] Round ${entry.round} · Clash #${entry.clashNumber} (${timeStr})  ${badge}`);
      lines.push(`   Contestant A: ${entry.player1.name} => ${p1Choice}`);
      lines.push(`   Contestant B: ${entry.player2.name} => ${p2Choice}`);
      lines.push(`   Outcome Log : ${entry.narrative}`);
      lines.push('');
    });

    lines.push(divider);
    lines.push('              END OF PEERANKI DUEL COMBAT RECORD                      ');
    lines.push(divider);

    return lines.join('\n');
  }

  public generateSampleDuelLog(): DuelOutcomeEntry[] {
    const now = Date.now();
    return [
      {
        id: 'sample-1',
        round: 1,
        clashNumber: 1,
        timestamp: now - 180000,
        player1: { id: 1, name: 'Commander Red', choice: 'rock' },
        player2: { id: 2, name: 'Cyber Blue', choice: 'scissors' },
        result: 'win',
        winnerId: 1,
        winnerName: 'Commander Red',
        winnerChoice: 'rock',
        loserId: 2,
        loserName: 'Cyber Blue',
        loserChoice: 'scissors',
        summaryText: 'Round 1 (Clash #1): Commander Red (🪨 ROCK) defeated Cyber Blue (✂️ SCISSORS)!',
        narrative: 'Commander Red selected 🪨 ROCK which crushed Cyber Blue\'s ✂️ SCISSORS! Commander Red won the duel!',
        isSample: true,
      },
      {
        id: 'sample-2',
        round: 2,
        clashNumber: 1,
        timestamp: now - 120000,
        player1: { id: 1, name: 'Commander Red', choice: 'paper' },
        player2: { id: 3, name: 'Bot Falcon', choice: 'paper' },
        result: 'tie',
        summaryText: 'Round 2 (Clash #1): Both picked 📄 PAPER — Stalemate tie!',
        narrative: 'Commander Red and Bot Falcon both threw 📄 PAPER! Hand shields collided with equal pressure. Stalemate tie!',
        isSample: true,
      },
      {
        id: 'sample-3',
        round: 2,
        clashNumber: 2,
        timestamp: now - 90000,
        player1: { id: 1, name: 'Commander Red', choice: 'scissors' },
        player2: { id: 3, name: 'Bot Falcon', choice: 'paper' },
        result: 'win',
        winnerId: 1,
        winnerName: 'Commander Red',
        winnerChoice: 'scissors',
        loserId: 3,
        loserName: 'Bot Falcon',
        loserChoice: 'paper',
        summaryText: 'Round 2 (Clash #2): Commander Red (✂️ SCISSORS) defeated Bot Falcon (📄 PAPER)!',
        narrative: 'Commander Red adapted and unleashed ✂️ SCISSORS, cutting through Bot Falcon\'s 📄 PAPER for the round victory!',
        isSample: true,
      },
      {
        id: 'sample-4',
        round: 3,
        clashNumber: 1,
        timestamp: now - 30000,
        player1: { id: 4, name: 'Iron Sentinel', choice: 'rock' },
        player2: { id: 1, name: 'Commander Red', choice: 'paper' },
        result: 'win',
        winnerId: 1,
        winnerName: 'Commander Red',
        winnerChoice: 'paper',
        loserId: 4,
        loserName: 'Iron Sentinel',
        loserChoice: 'rock',
        summaryText: 'Round 3 (Clash #1): Commander Red (📄 PAPER) defeated Iron Sentinel (🪨 ROCK)!',
        narrative: 'Commander Red shrouded Iron Sentinel\'s heavy 🪨 ROCK with tactical 📄 PAPER, sealing match dominance!',
        isSample: true,
      },
    ];
  }
}

export const duelLogManager = DuelLogManager.getInstance();
