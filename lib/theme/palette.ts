/**
 * Visual identity: American ground and water travel.
 *
 * Source of truth for colours. app/globals.css mirrors these as Tailwind
 * theme tokens (--color-*), and tests/theme/palette.test.ts checks that the
 * two match and that every text/background pair below meets WCAG AA.
 */
export const palette = {
  /** Page background: asphalt. */
  asphalt: "#1C1E21",
  /** Cards and panels. */
  surface: "#26292D",
  /** Controls and raised elements on surfaces. */
  raised: "#31353A",
  /** Borders and outlines of controls (3:1 or better on asphalt and surface). */
  line: "#757B84",
  /** Decorative road surface in route lines. Not for text. */
  road: "#4A4F56",
  /** Off-white text. */
  ink: "#F3EFE6",
  /** Secondary text. */
  inkMuted: "#BDB8AE",
  /** Lane-marking yellow: primary actions and highlights. */
  lane: "#F2C230",
  /** Lane yellow, hovered. */
  laneBright: "#F6D262",
  /** Deep water blue: secondary actions, sign-style inputs. */
  water: "#174A7C",
  /** Light water blue: ferries on dark backgrounds, water accents. */
  waterLight: "#7DB7EA",
  /** Placeholder and hint text on water-blue signs. */
  signHint: "#C9D7E6",
  /** Muted green, reserved for "arrives on time". */
  go: "#86C295",
  /** Background for "arrives on time" badges. */
  goDeep: "#2E5E3B",
  /** Errors and validation messages. */
  danger: "#FF8F85",
} as const;

export type PaletteName = keyof typeof palette;

/** WCAG AA minimums: 4.5 for normal text, 3 for large text and UI parts. */
export const AA_TEXT = 4.5;
export const AA_UI = 3;

/**
 * Every foreground/background pair the UI uses, with the minimum it must
 * meet. Add a row whenever a new combination is introduced.
 */
export const usedPairs: {
  fg: PaletteName;
  bg: PaletteName;
  min: number;
  where: string;
}[] = [
  { fg: "ink", bg: "asphalt", min: AA_TEXT, where: "body text" },
  { fg: "ink", bg: "surface", min: AA_TEXT, where: "card text" },
  { fg: "ink", bg: "raised", min: AA_TEXT, where: "controls, notices" },
  { fg: "inkMuted", bg: "asphalt", min: AA_TEXT, where: "helper text, footer" },
  { fg: "inkMuted", bg: "surface", min: AA_TEXT, where: "card secondary text" },
  { fg: "inkMuted", bg: "raised", min: AA_TEXT, where: "schedule notice" },
  {
    fg: "asphalt",
    bg: "lane",
    min: AA_TEXT,
    where: "primary buttons, selected toggle",
  },
  {
    fg: "asphalt",
    bg: "laneBright",
    min: AA_TEXT,
    where: "primary button hover",
  },
  { fg: "lane", bg: "asphalt", min: AA_TEXT, where: "highlights on page" },
  {
    fg: "lane",
    bg: "surface",
    min: AA_TEXT,
    where: "links and highlights on cards",
  },
  { fg: "lane", bg: "raised", min: AA_TEXT, where: "tight-connection warning" },
  {
    fg: "ink",
    bg: "water",
    min: AA_TEXT,
    where: "sign inputs, booking buttons, notes",
  },
  {
    fg: "signHint",
    bg: "water",
    min: AA_TEXT,
    where: "placeholders on sign inputs",
  },
  { fg: "waterLight", bg: "asphalt", min: AA_TEXT, where: "water accents" },
  {
    fg: "waterLight",
    bg: "surface",
    min: AA_TEXT,
    where: "ferry labels on cards",
  },
  { fg: "go", bg: "asphalt", min: AA_TEXT, where: "on-time text" },
  { fg: "go", bg: "surface", min: AA_TEXT, where: "spare time on cards" },
  { fg: "ink", bg: "goDeep", min: AA_TEXT, where: "on-time badge" },
  { fg: "danger", bg: "asphalt", min: AA_TEXT, where: "validation errors" },
  { fg: "danger", bg: "surface", min: AA_TEXT, where: "errors in panels" },
  { fg: "line", bg: "asphalt", min: AA_UI, where: "control borders" },
  { fg: "line", bg: "surface", min: AA_UI, where: "control borders on cards" },
  { fg: "lane", bg: "asphalt", min: AA_UI, where: "focus outline" },
  { fg: "lane", bg: "surface", min: AA_UI, where: "focus outline on cards" },
  { fg: "ink", bg: "water", min: AA_UI, where: "sign border" },
  { fg: "go", bg: "surface", min: AA_UI, where: "on-time card border" },
];

/** WCAG 2.x relative luminance of "#rrggbb". */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}
