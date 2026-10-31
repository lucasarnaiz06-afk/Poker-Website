// Compile-time check that the engine's types match the wire contract in @poker-platform/shared.
import type {
  ActionType as WireActionType,
  HandPhase as WireHandPhase,
  LegalActions as WireLegalActions,
} from "@poker-platform/shared/types";
import { describe, expect, it } from "vitest";
import { toPublicCard, type ActionType, type HandPhase, type LegalActions, type LastAction } from "../src";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const legalActionsMatch: Equal<LegalActions, WireLegalActions> = true;
const phaseMatches: Equal<HandPhase, WireHandPhase> = true;
const actionTypeMatches: Equal<ActionType, WireActionType> = true;
type WireLastAction = NonNullable<import("@poker-platform/shared/types").TableSeatView["lastAction"]>;
const lastActionAssignable: Equal<LastAction, WireLastAction> = true;
const publicCard: import("@poker-platform/shared/types").PublicCard = toPublicCard("As");

describe("wire contract", () => {
  it("engine types match @poker-platform/shared", () => {
    expect([legalActionsMatch, phaseMatches, actionTypeMatches, lastActionAssignable]).toEqual([true, true, true, true]);
    expect(publicCard).toEqual({ rank: "A", suit: "s" });
  });
});
