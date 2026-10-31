"use client";

import type { TableView } from "@poker-platform/shared/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { SwitchField } from "@/components/ui/switch";
import { Wallet } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { clamp, formatBB, formatChips } from "./format";
import { buyInRange, type BuyInMode } from "./logic";
import { PlayingCard } from "./playing-card";
import { usePreferences, type DeckStyle } from "./preferences";
import { unlockAudio } from "./sounds";
import type { TableCommands } from "./table-controller";

export type { BuyInMode } from "./logic";

export function BuyInDialog({
  open,
  onOpenChange,
  mode,
  view,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: BuyInMode;
  view: TableView;
  commands: TableCommands;
}) {
  const { min, max, reason } = buyInRange(view, mode);
  const s = view.settings;
  const bb = s.bigBlind;
  const initial = mode.kind === "sit" ? clamp(Math.min(s.bigBlind * 100, max), min, Math.max(min, max)) : Math.max(min, max);
  const [amount, setAmount] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountId = useId();

  useEffect(() => {
    if (open) {
      setAmount(initial);
      setError(null);
    }
    // Only reset when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const disabled = Boolean(reason) || max < min;
  const submit = async () => {
    setBusy(true);
    setError(null);
    const value = clamp(amount, min, max);
    const res = mode.kind === "sit" ? await commands.sit(mode.seat, value) : await commands.rebuy(value);
    setBusy(false);
    if (res.ok) onOpenChange(false);
    else setError(res.message);
  };

  const presets =
    mode.kind === "sit"
      ? [
          { label: "Min", value: min },
          { label: "100 BB", value: bb * 100 },
          { label: "Max", value: max },
        ]
      : [
          { label: "Min", value: min },
          { label: "Top up", value: max },
        ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-theme="dark"
        className="text-fg"
        size="sm"
        title={mode.kind === "sit" ? `Sit in seat ${mode.seat}` : "Add chips"}
        description={
          mode.kind === "sit"
            ? `Buy in between ${formatChips(s.minBuyIn)} and ${formatChips(s.maxBuyIn)} chips.`
            : `You can top up to ${formatChips(s.maxBuyIn)} chips at this table.`
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={busy} disabled={disabled}>
              {mode.kind === "sit" ? `Sit down with ${formatChips(amount)}` : `Add ${formatChips(amount)}`}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!disabled) void submit();
          }}
        >
          <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2.5 text-sm">
            <span className="flex items-center gap-2 text-muted">
              <Wallet className="h-4 w-4" aria-hidden /> Wallet
            </span>
            <span className="font-semibold tabular">{formatChips(view.viewer.walletBalance)}</span>
          </div>
          {reason ? (
            <p className="text-sm text-warning" role="alert">
              {reason}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <div className="flex items-end justify-between gap-3">
                  <label htmlFor={amountId} className="text-sm font-medium">
                    Amount
                  </label>
                  <span className="text-xs text-muted tabular">{formatBB(amount, bb)}</span>
                </div>
                <NumberInput
                  id={amountId}
                  value={amount}
                  onChange={(v) => setAmount(v)}
                  min={min}
                  max={max}
                  step={bb}
                  suffix="chips"
                />
                <Slider
                  value={clamp(amount, min, max)}
                  onValueChange={setAmount}
                  min={min}
                  max={Math.max(min + 1, max)}
                  step={1}
                  aria-label="Buy-in amount"
                  getValueText={(v) => `${formatChips(v)} chips, ${formatBB(v, bb)}`}
                />
                <div className="flex gap-2">
                  {presets.map((p) => {
                    const v = clamp(p.value, min, max);
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setAmount(v)}
                        className={cn(
                          "h-8 flex-1 rounded-md border text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                          amount === v ? "border-accent/70 bg-accent/15 text-fg" : "border-line bg-surface-2 text-muted hover:text-fg",
                        )}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="text-xs leading-5 text-muted">
                Blinds are {formatChips(s.smallBlind)}/{formatChips(bb)}. Chips come from your wallet and go back when you
                stand up.
              </p>
            </>
          )}
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

const DECK_OPTIONS: Array<{ value: DeckStyle; label: string }> = [
  { value: "four-color", label: "Four-colour" },
  { value: "two-color", label: "Two-colour" },
  { value: "pixel", label: "Classic pixel" },
];

export function SettingsDialog({
  open,
  onOpenChange,
  spectating,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spectating: boolean;
}) {
  const [prefs, update] = usePreferences();
  const soundOn = prefs.sound ?? !spectating;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-theme="dark" className="text-fg" size="sm" title="Table settings" description="Saved on this device.">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium" id="deck-style-label">
              Card style
            </span>
            <Segmented
              aria-label="Card style"
              value={prefs.deck}
              onValueChange={(deck) => update({ deck })}
              options={DECK_OPTIONS}
              fullWidth
              size="sm"
            />
            <div className="flex justify-center gap-2 rounded-lg bg-felt/60 py-3">
              {(["As", "Kh", "Qd", "Jc"] as const).map((code) => (
                <PlayingCard key={code} card={{ rank: code[0] as "A", suit: code[1] as "s" }} width={44} deck={prefs.deck} />
              ))}
            </div>
          </div>
          <SwitchField
            label="Show amounts in big blinds"
            description="Stacks, bets and pots in BB instead of chips."
            checked={prefs.showBB}
            onCheckedChange={(showBB) => update({ showBB })}
          />
          <SwitchField
            label="Confirm fold when checking is free"
            description="Avoid folding by accident."
            checked={prefs.confirmFold}
            onCheckedChange={(confirmFold) => update({ confirmFold })}
          />
          <SwitchField
            label="Sounds"
            description="Your turn, chips, cards and wins."
            checked={soundOn}
            onCheckedChange={(sound) => {
              if (sound) unlockAudio();
              update({ sound });
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
