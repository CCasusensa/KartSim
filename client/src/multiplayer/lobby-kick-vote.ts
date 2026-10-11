/**
 * 踢出投票: what the vote window shows and how it is opened. The release
 * put the vote in a plain confirm box (`syncKickVoteDialog`); the window
 * (`ui/kick-vote-window.ts`) shows the live count and the time left, and
 * answers through the same `castKickVote` commands.
 */

import type { LobbyRoom } from "./lobby-actions";
import type { ConfirmDialogFactory, LobbyDialogView } from "./lobby-dialogs";

export interface KickVoteStatus {
  /** The member the vote would remove. */
  targetName: string;
  yes: number;
  no: number;
  /** Members who may vote (the target excluded); a majority of them removes. */
  eligible: number;
  /** Local ms (performance.now scale) when the window opened; the bar runs from here. */
  openedAt: number;
  /** Local ms when the vote closes; undefined before a clock sample exists. */
  deadlineAt?: number;
}

export interface KickVoteDialogHost {
  state: { room?: LobbyRoom };
  client: { captureClock(): unknown };
}

export type KickVoteDialog = LobbyDialogView & { setBusy(busy: boolean): void };

export type KickVoteDialogLoader = (options: Record<string, unknown>,
  status: () => KickVoteStatus | undefined, vote: (approve: boolean) => void) =>
  Promise<KickVoteDialog> | KickVoteDialog;

/** The vote `voteId` as the window shows it now, or undefined once it is over. */
export function kickVoteStatus(room: LobbyRoom | undefined, voteId: string | undefined,
  openedAt: number, clock: unknown): KickVoteStatus | undefined {
  const vote = room?.kickVote;
  if (!room || !vote || !voteId || vote.voteId !== voteId) return undefined;
  const target = room.members.find(member => member.playerId === vote.targetId);
  if (!target) return undefined;
  const offset = typeof clock === "object" && clock !== null &&
    typeof (clock as { offsetMs?: unknown }).offsetMs === "number"
    ? (clock as { offsetMs: number }).offsetMs : undefined;
  return {
    targetName: target.name, yes: vote.yesIds.length, no: vote.noIds.length,
    eligible: vote.eligibleIds.length, openedAt,
    deadlineAt: vote.deadline !== undefined && offset !== undefined ? vote.deadline - offset : undefined,
  };
}

/**
 * The confirm-box factory `syncKickVoteDialog` expects, opening the vote
 * window instead: 同意 is the box's confirm, 反对 its cancel.
 */
export function kickVoteDialogFactory(host: KickVoteDialogHost, load: KickVoteDialogLoader,
  nowMs: () => number = () => performance.now()): ConfirmDialogFactory {
  return (options, _title, _message, onConfirm) => {
    const voteId = host.state.room?.kickVote?.voteId;
    const openedAt = nowMs();
    return load(options,
      () => kickVoteStatus(host.state.room, voteId, openedAt, host.client.captureClock()),
      approve => { if (approve) onConfirm(); else (options.cancel as () => void)(); });
  };
}
