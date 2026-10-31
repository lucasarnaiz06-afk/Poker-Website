/**
 * Preset avatars: deterministic gradient + initials SVGs. No uploads. Client-safe.
 * Render with `avatarSvg(id, label)` (string) or `getAvatarPreset(id)` for custom rendering.
 */

export type AvatarPreset = {
  id: string;
  from: string;
  to: string;
  angle: number;
  /** Text colour on top of the gradient. */
  ink: string;
};

const PALETTE: Array<[string, string]> = [
  ["#10b981", "#065f46"],
  ["#34d399", "#0e7490"],
  ["#22d3ee", "#1d4ed8"],
  ["#60a5fa", "#4338ca"],
  ["#818cf8", "#6d28d9"],
  ["#a78bfa", "#be185d"],
  ["#f472b6", "#9d174d"],
  ["#fb7185", "#b91c1c"],
  ["#f97316", "#9a3412"],
  ["#f5c451", "#c2410c"],
  ["#facc15", "#15803d"],
  ["#a3e635", "#047857"],
  ["#2dd4bf", "#155e75"],
  ["#38bdf8", "#312e81"],
  ["#c084fc", "#1e3a8a"],
  ["#e879f9", "#7c2d12"],
  ["#fda4af", "#6b21a8"],
  ["#fcd34d", "#7f1d1d"],
  ["#86efac", "#1e3a8a"],
  ["#94a3b8", "#1e293b"],
  ["#cbd5e1", "#475569"],
  ["#fbbf24", "#78350f"],
  ["#4ade80", "#14532d"],
  ["#67e8f9", "#581c87"],
];

const ANGLES = [135, 45, 160, 20, 110, 75];

export const AVATAR_PRESETS: readonly AvatarPreset[] = PALETTE.map(([from, to], index) => ({
  id: `g${String(index + 1).padStart(2, "0")}`,
  from,
  to,
  angle: ANGLES[index % ANGLES.length] ?? 135,
  ink: "#ffffff",
}));

export const AVATAR_IDS = AVATAR_PRESETS.map((preset) => preset.id);

export function isAvatarId(value: unknown): value is string {
  return typeof value === "string" && AVATAR_IDS.includes(value);
}

function hashString(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

/** Default avatar for a user without one (stable per seed, e.g. the user id). */
export function defaultAvatarId(seed: string): string {
  return AVATAR_PRESETS[hashString(seed) % AVATAR_PRESETS.length]!.id;
}

export function getAvatarPreset(id: string | null | undefined, seed = ""): AvatarPreset {
  return AVATAR_PRESETS.find((preset) => preset.id === id) ?? AVATAR_PRESETS[hashString(seed || "x") % AVATAR_PRESETS.length]!;
}

export function avatarInitials(label: string | null | undefined): string {
  const words = (label ?? "").replace(/[_\-.]+/g, " ").trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return "?";
  }

  if (words.length === 1) {
    return words[0]!.slice(0, 2).toUpperCase();
  }

  return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Self-contained SVG markup (safe to use as an <img> data URL or inline). */
export function avatarSvg(id: string | null | undefined, label: string | null | undefined, size = 64): string {
  const preset = getAvatarPreset(id, label ?? "");
  const initials = escapeXml(avatarInitials(label));
  const radians = (preset.angle * Math.PI) / 180;
  const x2 = (50 + Math.cos(radians) * 50).toFixed(1);
  const y2 = (50 + Math.sin(radians) * 50).toFixed(1);
  const x1 = (100 - Number(x2)).toFixed(1);
  const y1 = (100 - Number(y2)).toFixed(1);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><defs><linearGradient id="a" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%"><stop offset="0" stop-color="${preset.from}"/><stop offset="1" stop-color="${preset.to}"/></linearGradient></defs><rect width="100" height="100" rx="50" fill="url(#a)"/><text x="50" y="50" dy="0.35em" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="38" font-weight="600" fill="${preset.ink}">${initials}</text></svg>`;
}

export function avatarDataUrl(id: string | null | undefined, label: string | null | undefined, size = 64) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(id, label, size))}`;
}
