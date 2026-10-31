"use client";

import { useCallback, useSyncExternalStore } from "react";

export type DeckStyle = "two-color" | "four-color" | "pixel";

export type TablePreferences = {
  deck: DeckStyle;
  /** Show stacks, bets and pots in big blinds instead of chips. */
  showBB: boolean;
  /** Ask before folding when checking is free. */
  confirmFold: boolean;
  /** null = automatic (on when seated, off when spectating). */
  sound: boolean | null;
};

export const DEFAULT_PREFERENCES: TablePreferences = {
  deck: "four-color",
  showBB: false,
  confirmFold: true,
  sound: null,
};

const STORAGE_KEY = "poker.table.preferences.v1";
const listeners = new Set<() => void>();
let current: TablePreferences = DEFAULT_PREFERENCES;
let loaded = false;

function load(): TablePreferences {
  if (loaded) return current;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TablePreferences>;
      current = {
        deck: parsed.deck === "two-color" || parsed.deck === "pixel" || parsed.deck === "four-color" ? parsed.deck : DEFAULT_PREFERENCES.deck,
        showBB: typeof parsed.showBB === "boolean" ? parsed.showBB : DEFAULT_PREFERENCES.showBB,
        confirmFold: typeof parsed.confirmFold === "boolean" ? parsed.confirmFold : DEFAULT_PREFERENCES.confirmFold,
        sound: typeof parsed.sound === "boolean" ? parsed.sound : null,
      };
    }
  } catch {
    // Private mode / blocked storage: defaults are fine.
  }
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences(): [TablePreferences, (patch: Partial<TablePreferences>) => void] {
  const prefs = useSyncExternalStore(subscribe, load, () => DEFAULT_PREFERENCES);
  const update = useCallback((patch: Partial<TablePreferences>) => {
    current = { ...load(), ...patch };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // ignore
    }
    listeners.forEach((l) => l());
  }, []);
  return [prefs, update];
}
