"use client";

import type { DeckStyle, Preferences, ThemePreference } from "@poker-platform/shared/accounts/preferences";
import { useState } from "react";
import { usePreferences as useTablePreferences } from "@/components/table/preferences";
import { Field, Input, Segmented, SwitchField, toast, useTheme } from "@/components/ui";
import { updatePreferencesAction } from "../actions";
import { Section } from "../_components/section";

const DECK_OPTIONS = [
  { value: "clean", label: "Clean" },
  { value: "four-color", label: "Four-color" },
  { value: "pixel", label: "Classic pixel" },
] as const satisfies ReadonlyArray<{ value: DeckStyle; label: string }>;

const THEME_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string }>;

/** The table (and /tools) read the deck from this device's table preferences; keep them in step. */
const TABLE_DECK: Record<DeckStyle, "two-color" | "four-color" | "pixel"> = {
  clean: "two-color",
  "four-color": "four-color",
  pixel: "pixel",
};

function sameList(a: number[], b: number[]) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function parseList(raw: string) {
  return raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
}

export function PreferencesForm({ initial }: { initial: Preferences }) {
  const [prefs, setPrefs] = useState(initial);
  const { setTheme } = useTheme();
  const [, updateTablePrefs] = useTablePreferences();
  const [preflop, setPreflop] = useState(initial.betPresets.preflopBB.join(", "));
  const [postflop, setPostflop] = useState(initial.betPresets.postflopPotPct.join(", "));

  /** Every change saves immediately and confirms with a toast (no Save buttons on this page). */
  function save(update: Partial<Preferences>) {
    const previous = prefs;
    setPrefs({ ...prefs, ...update });

    void updatePreferencesAction(update).then((result) => {
      if (result.ok) {
        setPrefs(result.preferences);
        setPreflop(result.preferences.betPresets.preflopBB.join(", "));
        setPostflop(result.preferences.betPresets.postflopPotPct.join(", "));
        toast({ title: "Preferences saved", tone: "success", duration: 2000 });
      } else {
        setPrefs(previous);
        setPreflop(previous.betPresets.preflopBB.join(", "));
        setPostflop(previous.betPresets.postflopPotPct.join(", "));
        toast({ title: "Couldn't save", description: result.error, tone: "error" });
      }
    });
  }

  function saveBetPresets() {
    const next = { preflopBB: parseList(preflop), postflopPotPct: parseList(postflop).map(Math.round) };

    if (sameList(next.preflopBB, prefs.betPresets.preflopBB) && sameList(next.postflopPotPct, prefs.betPresets.postflopPotPct)) {
      return;
    }

    save({ betPresets: next });
  }

  return (
    <>
      <Section title="Table" description="How cards and the table look and behave.">
        <div className="space-y-5">
          <Field label="Deck style" hint="Four-color makes diamonds blue and clubs green.">
            <Segmented
              aria-label="Deck style"
              value={prefs.deckStyle}
              options={DECK_OPTIONS}
              onValueChange={(deckStyle) => {
                updateTablePrefs({ deck: TABLE_DECK[deckStyle] });
                save({ deckStyle });
              }}
            />
          </Field>
          <SwitchField label="Sounds" description="Deal, chip and turn sounds." checked={prefs.sounds} onCheckedChange={(sounds) => save({ sounds })} />
          <SwitchField
            label="Auto-muck losing hands"
            description="Don't show your cards at showdown when you lose."
            checked={prefs.autoMuckLosingHands}
            onCheckedChange={(autoMuckLosingHands) => save({ autoMuckLosingHands })}
          />
          <SwitchField
            label="Confirm fold when check is free"
            description="Ask before folding when you could check instead."
            checked={prefs.confirmFoldWhenCheckFree}
            onCheckedChange={(confirmFoldWhenCheckFree) => save({ confirmFoldWhenCheckFree })}
          />
        </div>
      </Section>

      <Section title="Bet presets" description="Quick-bet buttons next to the raise slider (up to 4 each). Saved when you leave a field.">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveBetPresets();
          }}
        >
          <Field label="Preflop" hint="Big blinds, e.g. 2.5, 3, 4">
            <Input
              value={preflop}
              onChange={(event) => setPreflop(event.target.value)}
              onBlur={saveBetPresets}
              trailing="BB"
              inputMode="decimal"
              enterKeyHint="done"
            />
          </Field>
          <Field label="Postflop" hint="Percent of the pot, e.g. 33, 50, 75, 100">
            <Input
              value={postflop}
              onChange={(event) => setPostflop(event.target.value)}
              onBlur={saveBetPresets}
              trailing="% pot"
              inputMode="numeric"
              enterKeyHint="done"
            />
          </Field>
        </form>
      </Section>

      <Section title="Appearance">
        <Field label="Theme" hint="The table always uses the dark felt.">
          <Segmented
            aria-label="Theme"
            value={prefs.theme}
            options={THEME_OPTIONS}
            onValueChange={(theme) => {
              setTheme(theme);
              save({ theme });
            }}
          />
        </Field>
      </Section>
    </>
  );
}
