export type VoiceTurnPhase =
  | 'preparing'
  | 'responding'
  | 'interrupted'
  | 'complete';

export type VoiceTurnCancelReason =
  | 'flux-start'
  | 'local-vad'
  | 'stop-button'
  | 'superseded'
  | 'cleanup'
  | 'limit';

export type VoiceTurnSnapshot = {
  id: number;
  phase: VoiceTurnPhase;
  cancelled: boolean;
  cancelReason?: VoiceTurnCancelReason;
};

type ActiveVoiceTurn = VoiceTurnSnapshot & {
  controllers: Set<AbortController>;
};

/**
 * Owns the cancellable work for exactly one buyer turn. Async callbacks retain
 * the returned id and must verify it before mutating UI, so a cancelled turn
 * cannot resume playback or overwrite the next turn.
 */
export class VoiceSessionController {
  private sequence = 0;
  private active: ActiveVoiceTurn | null = null;

  begin(): number {
    this.cancelActive('superseded');
    const id = ++this.sequence;
    this.active = {
      id,
      phase: 'preparing',
      cancelled: false,
      controllers: new Set(),
    };
    return id;
  }

  register(turnId: number, controller: AbortController): boolean {
    if (!this.isCurrent(turnId)) {
      controller.abort();
      return false;
    }
    this.active!.controllers.add(controller);
    return true;
  }

  transition(turnId: number, phase: Extract<VoiceTurnPhase, 'preparing' | 'responding'>): boolean {
    if (!this.isCurrent(turnId)) return false;
    this.active!.phase = phase;
    return true;
  }

  isCurrent(turnId: number): boolean {
    return Boolean(
      this.active &&
        this.active.id === turnId &&
        !this.active.cancelled &&
        this.active.phase !== 'complete',
    );
  }

  cancelActive(reason: VoiceTurnCancelReason): VoiceTurnSnapshot | null {
    const turn = this.active;
    if (!turn || turn.cancelled || turn.phase === 'complete') return null;
    turn.cancelled = true;
    turn.cancelReason = reason;
    turn.phase = 'interrupted';
    for (const controller of turn.controllers) controller.abort();
    turn.controllers.clear();
    return this.toSnapshot(turn);
  }

  complete(turnId: number): boolean {
    if (!this.active || this.active.id !== turnId || this.active.cancelled) {
      return false;
    }
    this.active.phase = 'complete';
    this.active.controllers.clear();
    return true;
  }

  snapshot(): VoiceTurnSnapshot | null {
    return this.active ? this.toSnapshot(this.active) : null;
  }

  private toSnapshot(turn: ActiveVoiceTurn): VoiceTurnSnapshot {
    return {
      id: turn.id,
      phase: turn.phase,
      cancelled: turn.cancelled,
      cancelReason: turn.cancelReason,
    };
  }
}
