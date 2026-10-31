"use client";

import {
  LOBBY_NAME_LIMITS,
  LOBBY_PASSWORD_LIMITS,
  parseTableSettings,
  TABLE_FEATURE_DESCRIPTIONS,
  TABLE_SETTINGS_PRESETS,
  type TableSettingsPresetId,
} from "@poker-platform/shared/lobbies/client";
import {
  DEFAULT_TABLE_SETTINGS,
  TABLE_SETTINGS_LIMITS as LIMITS,
  type TableSettings,
  type VoteRule,
} from "@poker-platform/shared/types";
import { Check, ChevronDown, Globe, Lock, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createGameAction, type CreateGameState } from "@/app/lobby/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatChips } from "@/components/ui/chips";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { InfoTip } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { SwitchField } from "@/components/ui/switch";
import { CopyButton } from "./copy-button";

type Visibility = "PUBLIC" | "PRIVATE";

/** Form state. Buy-ins are edited in big blinds and converted to chips on submit. */
type Draft = {
  presetId: TableSettingsPresetId | null;
  name: string;
  visibility: Visibility;
  password: string;
  settings: TableSettings;
  minBuyInBB: number;
  maxBuyInBB: number;
};

const STAKE_SHORTCUTS = [
  [1, 2],
  [5, 10],
  [25, 50],
  [100, 200],
] as const;

const VOTE_RULE_OPTIONS = [
  { value: "majority" as const, label: "Majority" },
  { value: "unanimous" as const, label: "Everyone" },
];

function draftFromSettings(settings: TableSettings, presetId: TableSettingsPresetId | null, name: string): Draft {
  return {
    presetId,
    name,
    visibility: "PUBLIC",
    password: "",
    settings,
    minBuyInBB: Math.round(settings.minBuyIn / settings.bigBlind),
    maxBuyInBB: Math.round(settings.maxBuyIn / settings.bigBlind),
  };
}

const DEFAULT_PRESET = TABLE_SETTINGS_PRESETS[1] ?? TABLE_SETTINGS_PRESETS[0];

/** "Sam's table" (trimmed to the name limit). */
export function defaultTableName(displayName: string | null | undefined) {
  const name = displayName?.trim();
  const base = name ? `${name}'s table` : "My table";
  return base.length > LOBBY_NAME_LIMITS.max ? "My table" : base;
}

function initialDraft(name: string): Draft {
  return DEFAULT_PRESET
    ? draftFromSettings(DEFAULT_PRESET.settings, DEFAULT_PRESET.id, name)
    : draftFromSettings(DEFAULT_TABLE_SETTINGS, null, name);
}

/** Fields that live under "More options": an error there opens it on submit. */
const ADVANCED_ERROR_KEYS = /^(password|settings\.(variant|smallBlind|bigBlind|ante|minBuyIn|maxBuyIn|actionTimeSec|timeBankSec|bombPot|nitGame|bountyGame))/;

function toSettings(draft: Draft): TableSettings {
  return {
    ...draft.settings,
    minBuyIn: draft.minBuyInBB * draft.settings.bigBlind,
    maxBuyIn: draft.maxBuyInBB * draft.settings.bigBlind,
  };
}

function validateDraft(draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();

  if (name.length < LOBBY_NAME_LIMITS.min) {
    errors.name = `Give your table a name (at least ${LOBBY_NAME_LIMITS.min} characters).`;
  } else if (name.length > LOBBY_NAME_LIMITS.max) {
    errors.name = `Keep the name under ${LOBBY_NAME_LIMITS.max} characters.`;
  }

  if (draft.password && draft.password.length < LOBBY_PASSWORD_LIMITS.min) {
    errors.password = `Passwords need at least ${LOBBY_PASSWORD_LIMITS.min} characters.`;
  }

  const result = parseTableSettings(toSettings(draft));

  if (!result.ok) {
    for (const issue of result.issues) {
      errors[`settings.${issue.path}`] ??= issue.message;
    }
  }

  return errors;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SubFields({ open, children }: { open: boolean; children: ReactNode }) {
  if (!open) {
    return null;
  }

  return (
    <div className="ml-0 grid gap-4 rounded-lg border border-line bg-surface-2/50 p-4 animate-slide-up sm:grid-cols-2">
      {children}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" loading={pending} className="sm:min-w-[132px]">
      Create game
    </Button>
  );
}

export type CreateGameDialogProps = {
  /** Wallet balance, used for a gentle buy-in hint. null when unknown. */
  chipBalance: number | null;
  /** Host's display name, for the default table name ("Sam's table"). */
  displayName?: string | null;
  trigger?: ReactNode;
};

export function CreateGameDialog({ chipBalance, displayName, trigger }: CreateGameDialogProps) {
  const defaultName = defaultTableName(displayName);
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(defaultName));
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [state, formAction] = useFormState<CreateGameState, FormData>(createGameAction, { status: "idle" });

  const errors = useMemo(() => validateDraft(draft), [draft]);
  const serverErrors = state.status === "error" ? state.fieldErrors : {};
  const hasErrors = Object.keys(errors).length > 0;
  const s = draft.settings;

  useEffect(() => {
    if (!open) {
      return;
    }

    // Reset on every open unless we're showing the "created" screen.
    setTouched(new Set());
    setSubmitted(false);
    setMoreOpen(false);
  }, [open]);

  function errorFor(key: string) {
    const show = submitted || touched.has(key);

    return (show ? errors[key] : undefined) ?? serverErrors[key];
  }

  function touch(...keys: string[]) {
    setTouched((current) => {
      const next = new Set(current);

      keys.forEach((key) => next.add(key));

      return next;
    });
  }

  function patch(partial: Partial<Draft>, ...keys: string[]) {
    setDraft((current) => ({ ...current, presetId: null, ...partial }));
    touch(...keys);
  }

  function patchSettings(partial: Partial<TableSettings>, ...keys: string[]) {
    setDraft((current) => ({ ...current, presetId: null, settings: { ...current.settings, ...partial } }));
    touch(...keys.map((key) => `settings.${key}`));
  }

  function applyPreset(id: TableSettingsPresetId) {
    const preset = TABLE_SETTINGS_PRESETS.find((item) => item.id === id);

    if (!preset) {
      return;
    }

    // The name (default "Sam's table") is kept; presets only change the rules.
    setDraft((current) => ({
      ...draftFromSettings(preset.settings, preset.id, current.name.trim() ? current.name : defaultName),
      visibility: current.visibility,
      password: current.password,
    }));
  }

  const payload = JSON.stringify({
    name: draft.name.trim(),
    visibility: draft.visibility,
    password: draft.password,
    settings: toSettings(draft),
  });

  const minBuyInChips = draft.minBuyInBB * s.bigBlind;
  const maxBuyInChips = draft.maxBuyInBB * s.bigBlind;
  const buyInError = errorFor("settings.minBuyIn") ?? errorFor("settings.maxBuyIn");
  const created = state.status === "created" ? state : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next && created) {
          // Start fresh after a successful create.
          setDraft(initialDraft(defaultName));
        }
      }}
    >
      <DialogTrigger asChild>{trigger ?? <Button leftIcon={<Plus aria-hidden />}>Create game</Button>}</DialogTrigger>

      {created && open ? (
        <DialogContent
          title="Your private table is ready"
          description="Only people with the invite link can find it."
          size="md"
          footer={
            <Button asChild>
              <Link href={`/lobby/${created.lobbyId}`}>Go to table</Link>
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-fg">
                <Check className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">{created.name}</p>
                <p className="text-[13px] text-muted">You&apos;re seated. Share the link to invite friends.</p>
              </div>
            </div>
            {created.invitePath ? (
              <Field label="Invite link">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={
                      typeof window === "undefined"
                        ? created.invitePath
                        : `${window.location.origin}${created.invitePath}`
                    }
                    onFocus={(event) => event.currentTarget.select()}
                    className="font-mono text-[13px]"
                  />
                  <CopyButton text={created.invitePath} label="Copy" size="md" />
                </div>
              </Field>
            ) : null}
          </div>
        </DialogContent>
      ) : (
        <DialogContent
          title="Create a game"
          description="Pick a style, name it and go. Everything else has sensible defaults."
          size="xl"
          bodyClassName="px-0 py-0"
        >
          <form
            action={formAction}
            noValidate
            onSubmit={(event) => {
              setSubmitted(true);

              if (hasErrors) {
                event.preventDefault();
                const form = event.currentTarget;

                if (Object.keys(errors).some((key) => ADVANCED_ERROR_KEYS.test(key))) {
                  setMoreOpen(true);
                }

                // Move focus to the first invalid field once errors render.
                window.setTimeout(() => {
                  form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
                }, 0);
              }
            }}
          >
            <div className="flex flex-col gap-5 px-5 py-5 sm:px-6">
              <input type="hidden" name="payload" value={payload} />

              {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}

              <fieldset>
                <legend className="mb-2 text-[13px] font-medium text-fg">Style</legend>
                <div className="grid grid-cols-3 gap-2">
                  {TABLE_SETTINGS_PRESETS.map((preset) => {
                    const active = draft.presetId === preset.id;

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={active}
                        title={preset.description}
                        onClick={() => applyPreset(preset.id)}
                        className={cn(
                          "flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition-colors sm:p-3",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                          active ? "border-accent/60 bg-accent/10" : "border-line bg-surface-2 hover:bg-surface-3",
                        )}
                      >
                        <span className="flex w-full items-start justify-between gap-1 text-[13px] font-medium leading-5 text-fg sm:text-sm">
                          {preset.label}
                          {active ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden /> : null}
                        </span>
                        <span className="hidden text-xs leading-5 text-muted sm:block">{preset.description}</span>
                      </button>
                    );
                  })}
                </div>
                {draft.presetId ? (
                  <p className="mt-2 text-xs text-muted sm:hidden">
                    {TABLE_SETTINGS_PRESETS.find((preset) => preset.id === draft.presetId)?.description}
                  </p>
                ) : null}
              </fieldset>

              <Field label="Table name" error={errorFor("name")}>
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  onBlur={() => touch("name")}
                  maxLength={LOBBY_NAME_LIMITS.max}
                  placeholder={defaultName}
                  autoComplete="off"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
                <Field
                  label="Blinds"
                  error={errorFor("settings.smallBlind") ?? errorFor("settings.bigBlind")}
                  hint="Small / big blind. Custom amounts are under More options."
                >
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Common blinds">
                    {STAKE_SHORTCUTS.map(([small, big]) => {
                      const active = s.smallBlind === small && s.bigBlind === big;

                      return (
                        <button
                          key={big}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            patchSettings(
                              { smallBlind: small, bigBlind: big, ante: Math.min(s.ante, big) },
                              "smallBlind",
                              "bigBlind",
                            )
                          }
                          className={cn(
                            "tabular h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            active
                              ? "border-accent/50 bg-accent/10 text-fg"
                              : "border-line bg-surface-2 text-muted hover:text-fg",
                          )}
                        >
                          {small}/{big}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <Field label="Seats" error={errorFor("settings.maxPlayers")}>
                  <NumberInput
                    value={s.maxPlayers}
                    onChange={(maxPlayers) => patchSettings({ maxPlayers }, "maxPlayers")}
                    min={LIMITS.maxPlayers.min}
                    max={LIMITS.maxPlayers.max}
                  />
                </Field>
              </div>

              <div className="tabular flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px]">
                <span className="text-muted">
                  Buy-in{" "}
                  <span className="font-medium text-fg">
                    {formatChips(minBuyInChips)} – {formatChips(maxBuyInChips)}
                  </span>{" "}
                  chips ({draft.minBuyInBB}–{draft.maxBuyInBB} BB)
                </span>
                {chipBalance !== null ? (
                  <span className={cn(chipBalance < minBuyInChips && !buyInError ? "text-warning" : "text-subtle")}>
                    You have {formatChips(chipBalance)}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <Segmented
                  aria-label="Who can join"
                  fullWidth
                  value={draft.visibility}
                  onValueChange={(visibility) => setDraft((current) => ({ ...current, visibility }))}
                  options={[
                    { value: "PUBLIC", label: "Public", icon: <Globe aria-hidden /> },
                    { value: "PRIVATE", label: "Private", icon: <Lock aria-hidden /> },
                  ]}
                />
                <p className="text-[13px] text-muted">
                  {draft.visibility === "PUBLIC"
                    ? "Listed in the lobby so anyone can join."
                    : "Hidden from the lobby. You'll get an invite link to share."}
                </p>
              </div>

              <div className="border-t border-line pt-4">
                <button
                  type="button"
                  aria-expanded={moreOpen}
                  aria-controls="create-game-more"
                  onClick={() => setMoreOpen((value) => !value)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg py-1 text-left text-sm font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span>
                    More options
                    <span className="block text-xs font-normal text-muted">
                      Game type, blinds and buy-ins, timing, side games, table rules, password
                    </span>
                  </span>
                  <ChevronDown
                    className={cn("h-4 w-4 shrink-0 text-muted transition-transform", moreOpen && "rotate-180")}
                    aria-hidden
                  />
                </button>
              </div>

              {moreOpen ? (
                <div id="create-game-more" className="flex flex-col gap-6 animate-slide-up">
                  <Section title="Game">
                    <Field label="Game" error={errorFor("settings.variant")}>
                      <Segmented
                        aria-label="Game"
                        fullWidth
                        value={s.variant}
                        onValueChange={(variant) => patchSettings({ variant }, "variant")}
                        options={[
                          { value: "NLHE", label: "Hold'em" },
                          { value: "PLO", label: "Omaha (PLO)" },
                        ]}
                      />
                    </Field>
                  </Section>

                  <Section title="Blinds and buy-ins" description="Chips are play money. Buy-ins are set in big blinds (BB).">
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <Field label="Small blind" error={errorFor("settings.smallBlind")}>
                        <NumberInput
                          value={s.smallBlind}
                          onChange={(smallBlind) => patchSettings({ smallBlind }, "smallBlind")}
                          min={1}
                          max={LIMITS.bigBlind.max}
                        />
                      </Field>
                      <Field label="Big blind" error={errorFor("settings.bigBlind")}>
                        <NumberInput
                          value={s.bigBlind}
                          onChange={(bigBlind) => patchSettings({ bigBlind }, "bigBlind")}
                          min={LIMITS.bigBlind.min}
                          max={LIMITS.bigBlind.max}
                        />
                      </Field>
                      <Field
                        label="Ante"
                        className="col-span-2 sm:col-span-1"
                        error={errorFor("settings.ante")}
                        hint="0 for no ante"
                        labelAside={
                          <InfoTip label="About antes">
                            A small forced bet every player pays each hand, on top of the blinds. Makes pots bigger.
                          </InfoTip>
                        }
                      >
                        <NumberInput
                          value={s.ante}
                          onChange={(ante) => patchSettings({ ante }, "ante")}
                          min={0}
                          max={s.bigBlind}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Min buy-in" error={errorFor("settings.minBuyIn")}>
                        <NumberInput
                          value={draft.minBuyInBB}
                          onChange={(minBuyInBB) => patch({ minBuyInBB }, "settings.minBuyIn")}
                          min={LIMITS.buyInBB.min}
                          max={LIMITS.buyInBB.max}
                          step={10}
                          suffix="BB"
                        />
                      </Field>
                      <Field label="Max buy-in" error={errorFor("settings.maxBuyIn")}>
                        <NumberInput
                          value={draft.maxBuyInBB}
                          onChange={(maxBuyInBB) => patch({ maxBuyInBB }, "settings.maxBuyIn")}
                          min={LIMITS.buyInBB.min}
                          max={LIMITS.buyInBB.max}
                          step={10}
                          suffix="BB"
                        />
                      </Field>
                    </div>
                  </Section>

                  <Section title="Timing">
                    <div className="grid gap-6 sm:grid-cols-2">
                      <SliderField
                        label="Time to act"
                        value={s.actionTimeSec}
                        min={LIMITS.actionTimeSec.min}
                        max={LIMITS.actionTimeSec.max}
                        step={5}
                        unit="s"
                        hint="How long each player has per decision."
                        onChange={(actionTimeSec) => patchSettings({ actionTimeSec }, "actionTimeSec")}
                      />
                      <SliderField
                        label="Time bank"
                        value={s.timeBankSec}
                        min={LIMITS.timeBankSec.min}
                        max={LIMITS.timeBankSec.max}
                        step={10}
                        unit="s"
                        hint="Extra time per player for tough spots."
                        onChange={(timeBankSec) => patchSettings({ timeBankSec }, "timeBankSec")}
                      />
                    </div>
                  </Section>

                  <Section
                    title="Side games"
                    description="Optional fun. Players start and stop them by voting at the table."
                  >
                    <div className="flex flex-col gap-4">
                      <SwitchField
                        label="Bomb pots"
                        description={TABLE_FEATURE_DESCRIPTIONS.BOMB_POT}
                        labelAside={
                          <InfoTip label="About bomb pots" title="Bomb pots">
                            When a vote passes (or every N hands), every player puts in the ante and the hand starts on the
                            flop. Action starts left of the button. With double board, each pot is split between two boards.
                          </InfoTip>
                        }
                        checked={s.bombPot.enabled}
                        onCheckedChange={(enabled) => patchSettings({ bombPot: { ...s.bombPot, enabled } }, "bombPot")}
                      />
                      <SubFields open={s.bombPot.enabled}>
                        <Field label="Ante per player" error={errorFor("settings.bombPot.anteBB")}>
                          <NumberInput
                            value={s.bombPot.anteBB}
                            onChange={(anteBB) => patchSettings({ bombPot: { ...s.bombPot, anteBB } }, "bombPot.anteBB")}
                            min={LIMITS.bombPotAnteBB.min}
                            max={LIMITS.bombPotAnteBB.max}
                            suffix="BB"
                          />
                        </Field>
                        <Field
                          label="Automatic bomb pot"
                          hint={
                            s.bombPot.everyNHands === 0
                              ? "Every N hands (0 = only by vote)"
                              : `Every ${s.bombPot.everyNHands === 1 ? "hand" : `${s.bombPot.everyNHands} hands`}, and by vote`
                          }
                          error={errorFor("settings.bombPot.everyNHands")}
                        >
                          <NumberInput
                            value={s.bombPot.everyNHands}
                            onChange={(everyNHands) =>
                              patchSettings({ bombPot: { ...s.bombPot, everyNHands } }, "bombPot.everyNHands")
                            }
                            min={LIMITS.bombPotEveryNHands.min}
                            max={LIMITS.bombPotEveryNHands.max}
                            suffix="hands"
                          />
                        </Field>
                        <VoteRuleField
                          value={s.bombPot.voteRule}
                          onChange={(voteRule) => patchSettings({ bombPot: { ...s.bombPot, voteRule } }, "bombPot")}
                        />
                        <SwitchField
                          label="Double board"
                          description="Deal two boards; each pot is split between them."
                          className="self-end"
                          checked={s.bombPot.doubleBoard}
                          onCheckedChange={(doubleBoard) =>
                            patchSettings({ bombPot: { ...s.bombPot, doubleBoard } }, "bombPot")
                          }
                        />
                      </SubFields>

                      <SwitchField
                        label="Nit game"
                        description={TABLE_FEATURE_DESCRIPTIONS.NIT_GAME}
                        labelAside={
                          <InfoTip label="About the nit game" title="Nit game">
                            Once started, everyone is a &quot;nit&quot;. Win any pot and you&apos;re safe. When only one nit
                            is left, they pay the penalty to every other player and the round ends.
                          </InfoTip>
                        }
                        checked={s.nitGame.enabled}
                        onCheckedChange={(enabled) => patchSettings({ nitGame: { ...s.nitGame, enabled } }, "nitGame")}
                      />
                      <SubFields open={s.nitGame.enabled}>
                        <Field label="Penalty to each player" error={errorFor("settings.nitGame.penaltyBB")}>
                          <NumberInput
                            value={s.nitGame.penaltyBB}
                            onChange={(penaltyBB) =>
                              patchSettings({ nitGame: { ...s.nitGame, penaltyBB } }, "nitGame.penaltyBB")
                            }
                            min={LIMITS.nitPenaltyBB.min}
                            max={LIMITS.nitPenaltyBB.max}
                            suffix="BB"
                          />
                        </Field>
                        <VoteRuleField
                          value={s.nitGame.voteRule}
                          onChange={(voteRule) => patchSettings({ nitGame: { ...s.nitGame, voteRule } }, "nitGame")}
                        />
                      </SubFields>

                      <SwitchField
                        label="7-2 bounty"
                        description={TABLE_FEATURE_DESCRIPTIONS.BOUNTY_GAME}
                        labelAside={
                          <InfoTip label="About the 7-2 bounty" title="7-2 bounty">
                            7-2 is the worst starting hand. Win a pot with it (any suits) and show your cards, and every
                            other player dealt in pays you the bounty. Win without a showdown? Click Show to claim it.
                          </InfoTip>
                        }
                        checked={s.bountyGame.enabled}
                        onCheckedChange={(enabled) =>
                          patchSettings({ bountyGame: { ...s.bountyGame, enabled } }, "bountyGame")
                        }
                      />
                      <SubFields open={s.bountyGame.enabled}>
                        <Field label="Bounty from each player" error={errorFor("settings.bountyGame.bountyBB")}>
                          <NumberInput
                            value={s.bountyGame.bountyBB}
                            onChange={(bountyBB) =>
                              patchSettings({ bountyGame: { ...s.bountyGame, bountyBB } }, "bountyGame.bountyBB")
                            }
                            min={LIMITS.bountyBB.min}
                            max={LIMITS.bountyBB.max}
                            suffix="BB"
                          />
                        </Field>
                        <VoteRuleField
                          value={s.bountyGame.voteRule}
                          onChange={(voteRule) =>
                            patchSettings({ bountyGame: { ...s.bountyGame, voteRule } }, "bountyGame")
                          }
                        />
                      </SubFields>
                    </div>
                  </Section>

                  <Section title="Table rules">
                    <div className="flex flex-col gap-4">
                      <SwitchField
                        label="Straddle"
                        description={TABLE_FEATURE_DESCRIPTIONS.STRADDLE}
                        checked={s.straddle}
                        onCheckedChange={(straddle) => patchSettings({ straddle }, "straddle")}
                      />
                      <SwitchField
                        label="Run it twice"
                        description={TABLE_FEATURE_DESCRIPTIONS.RUN_IT_TWICE}
                        checked={s.runItTwice}
                        onCheckedChange={(runItTwice) => patchSettings({ runItTwice }, "runItTwice")}
                      />
                      <SwitchField
                        label="Allow spectators"
                        description="People can watch without a seat. They never see hidden cards."
                        checked={s.allowSpectators}
                        onCheckedChange={(allowSpectators) => patchSettings({ allowSpectators }, "allowSpectators")}
                      />
                      <SwitchField
                        label="Table chat"
                        description="Text chat and emotes for everyone at the table."
                        checked={s.chatEnabled}
                        onCheckedChange={(chatEnabled) => patchSettings({ chatEnabled }, "chatEnabled")}
                      />
                      <SwitchField
                        label="Auto start"
                        description="Deal automatically once two players are seated. Off: you press Start."
                        checked={s.autoStart}
                        onCheckedChange={(autoStart) => patchSettings({ autoStart }, "autoStart")}
                      />
                    </div>
                  </Section>

                  <Section title="Password">
                    <Field
                      label="Table password"
                      optional
                      error={errorFor("password")}
                      hint="Players will need it to join, even with the invite link."
                    >
                      <Input
                        type="password"
                        value={draft.password}
                        onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
                        onBlur={() => touch("password")}
                        autoComplete="new-password"
                        maxLength={LOBBY_PASSWORD_LIMITS.max}
                      />
                    </Field>
                  </Section>
                </div>
              ) : null}
            </div>

            <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-surface px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-end sm:px-6 sm:pb-4">
              {submitted && hasErrors ? (
                <p className="text-center text-[13px] text-danger sm:mr-auto sm:text-left" role="status">
                  Fix the highlighted fields first.
                </p>
              ) : (
                <p className="tabular mr-auto hidden text-[13px] text-muted sm:block">
                  {s.variant === "PLO" ? "Omaha" : "Hold'em"} · {formatChips(s.smallBlind)}/{formatChips(s.bigBlind)} ·{" "}
                  {s.maxPlayers} seats
                </p>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <SubmitButton />
              </div>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint: string;
  onChange: (value: number) => void;
}) {
  const id = `slider-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span id={`${id}-label`} className="text-[13px] font-medium text-fg">
          {label}
        </span>
        <span className="tabular text-sm font-medium text-fg">
          {value}
          <span className="text-muted"> {unit}</span>
        </span>
      </div>
      <Slider
        value={value}
        onValueChange={onChange}
        min={min}
        max={max}
        step={step}
        aria-labelledby={`${id}-label`}
        getValueText={(seconds) => `${seconds} seconds`}
      />
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

function VoteRuleField({ value, onChange }: { value: VoteRule; onChange: (value: VoteRule) => void }) {
  return (
    <Field
      label="Starts when"
      hint={value === "majority" ? "More than half of seated players vote yes." : "Every seated player votes yes."}
      labelAside={
        <InfoTip label="About votes">
          Any player can propose starting or stopping this game. Votes last 20 seconds.
        </InfoTip>
      }
    >
      <Segmented
        aria-label="Vote rule"
        fullWidth
        size="sm"
        value={value}
        onValueChange={onChange}
        options={VOTE_RULE_OPTIONS}
      />
    </Field>
  );
}
