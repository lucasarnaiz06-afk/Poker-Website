export type EngineErrorCode =
  | "INVALID_CARD"
  | "DUPLICATE_CARD"
  | "INVALID_DECK"
  | "DECK_EXHAUSTED"
  | "BAD_RANDOM"
  | "INVALID_HAND_SIZE"
  | "INVALID_CONFIG"
  | "INVALID_STRADDLE"
  | "INVALID_RANGE"
  | "HAND_COMPLETE"
  | "NOT_BETTING"
  | "NOT_RUNOUT_DECISION"
  | "UNKNOWN_PLAYER"
  | "NOT_YOUR_TURN"
  | "INVALID_ACTION"
  | "CANNOT_CHECK"
  | "NOTHING_TO_CALL"
  | "CANNOT_RAISE"
  | "INVALID_AMOUNT";

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}
