/** Placeholder until the replay stage lands (replay-session, TIMEATTACK.md). */
import type { ReadyHomeController } from "./ready-home";

export interface ReplaySessionRequest {
  trackId: string;
  trackPath: string;
  trackTitle: string;
  ksv: Uint8Array;
  riderName: string;
  kartName: string;
  recordMs: number;
  speed: number;
  booster: number;
  onReturn(): void;
}

export async function startReplaySession(controller: ReadyHomeController, request: ReplaySessionRequest): Promise<void> {
  void controller;
  throw new Error(`录像观看尚未就绪（${request.riderName}）。`);
}
