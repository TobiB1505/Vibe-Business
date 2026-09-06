import { pathBasename, pathExtension, pathSegments } from "../path-policy";
import type { DetectionContext } from "../context";
import type {
  BrandAssetRole,
  BrandAssetSignal,
  BrandColorRole,
  BrandColorSignal,
  BrandIntelligence,
  BrandTypefaceSignal,
  Confidence,
  Evidence,
} from "../schema";

/**
 * Brand detection from a repository (CORE-1 §11–§13).
 *
 * Two sources, both cheap and both deterministic:
 *
 *  1. **Tree paths** for assets. No image is ever downloaded — image
 *     extensions are binary and `mayFetchContent` refuses them — so an asset
 *     claim rests entirely on where a file sits and what it is called.
 *  2. **Design-token declarations** for colour and type, read from the small
 *     set of stylesheet/theme files the candidate selector now fetches.
 *
 * The rule this module exists to obey is CORE-1 §11's: *"Nicht einfach
 * irgendein SVG als Logo auswählen."* Nothing here scores a file for looking
 * vaguely brand-shaped. A path becomes a logo because it is named like one, in
 * a place logos live, and it says so with the confidence that naming earns —
 * `logo.svg` in `public/` is a different claim from `img/hero-logo-bg-4.png`
 * six directories down.
 *
 * Everything read here is UNTRUSTED repository data. Colour values and family
 * names are extracted with bounded regular expressions and never evaluated,
 * imported, or interpreted as instructions (CLAUDE.md rule 25).
 */

// ---------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------

/** Directory names that serve files to the public web, by convention. */
const WEB_ROOT_SEGMENTS = new Set(["public", "static", "www", "wwwroot", "web"]);

/** Directories that hold design assets without necessarily serving them. */
const ASSET_SEGMENTS = new Set(["assets", "images", "img", "icons", "brand", "logos", "media"]);

const IMAGE_EXTENSIONS = new Set(["svg", "png", "jpg", "jpeg", "webp", "avif", "ico", "gif"]);

type AssetRule = {
  role: BrandAssetRole;
  /** Matched against the basename without its extension, lowercased. */
  pattern: RegExp;
  /** True when the name alone is unambiguous, e.g. exactly "favicon". */
  exact: RegExp;
};

const ASSET_RULES: AssetRule[] = [
  {
    role: "favicon",
    pattern: /(^|[-_.])favicon([-_.]|$)/,
    exact: /^favicon$/,
  },
  {
    role: "app_icon",
    pattern:
      /(^|[-_.])(apple-touch-icon|android-chrome|maskable[-_]?icon|app[-_]?icon|icon)([-_.]|$)/,
    exact: /^(apple-touch-icon|icon|app-icon)$/,
  },
  {
    role: "open_graph_image",
    pattern:
      /(^|[-_.])(og[-_]?image|opengraph[-_]?image|twitter[-_]?image|social[-_]?(card|preview|image))([-_.]|$)/,
    exact: /^(og-image|opengraph-image|twitter-image)$/,
  },
  {
    role: "logo",
    pattern: /(^|[-_.])(logo|wordmark|lockup|brandmark)([-_.]|$)/,
    exact: /^(logo|wordmark|lockup)$/,
  },
];

/** Suffixes that mark a logo as a variant of the main one, not the main one. */
const LOGO_VARIANT =
  /(^|[-_.])(mono|monochrome|white|black|light|dark|inverse|inverted|alt|small|square|on-light|on-dark)([-_.]|$)/;

function withoutExtension(basename: string): string {
  const dotIndex = basename.lastIndexOf(".");
  return (dotIndex > 0 ? basename.slice(0, dotIndex) : basename).toLowerCase();
}

/**
 * The URL a repository path would be served at, when it lives under a web
 * root. `public/brand/logo.svg` → `/brand/logo.svg`.
 *
 * Null for a path we cannot map, which is the honest answer: a logo inside
 * `src/assets/` is bundled at a hashed URL we cannot predict, and inventing
 * one would produce a broken image in the product's own UI.
 */
export function servedPathFor(path: string): string | null {
  const segments = pathSegments(path);
  const rootIndex = segments.findIndex((segment) => WEB_ROOT_SEGMENTS.has(segment.toLowerCase()));
  if (rootIndex === -1) return null;
  const rest = segments.slice(rootIndex + 1);
  return rest.length > 0 ? `/${rest.join("/")}` : null;
}

/**
 * Next.js and friends treat `app/icon.svg` and `app/opengraph-image.png` as
 * file-convention metadata: they are served, but not from a web root.
 */
const FRAMEWORK_METADATA_DIRECTORIES = new Set(["app", "src/app", "pages", "src/pages"]);

function isFrameworkMetadataAsset(path: string): boolean {
  const segments = pathSegments(path);
  if (segments.length < 2) return false;
  const parent = segments.slice(0, -1).join("/");
  return FRAMEWORK_METADATA_DIRECTORIES.has(parent);
}

function assetConfidence(path: string, rule: AssetRule, stem: string): Confidence {
  const segments = pathSegments(path).map((segment) => segment.toLowerCase());
  const inWebRoot = segments.some((segment) => WEB_ROOT_SEGMENTS.has(segment));
  const inAssetDirectory = segments.some((segment) => ASSET_SEGMENTS.has(segment));

  // The name is the whole claim, so an exact name in a place the file is
  // actually served from is the only thing that earns `high`.
  if (rule.exact.test(stem) && (inWebRoot || isFrameworkMetadataAsset(path))) return "high";
  if (inWebRoot || inAssetDirectory || isFrameworkMetadataAsset(path)) return "medium";
  return "low";
}

export function detectBrandAssets(context: DetectionContext): BrandAssetSignal[] {
  const signals: BrandAssetSignal[] = [];

  for (const path of context.sourcePaths) {
    const extension = pathExtension(path);
    if (!IMAGE_EXTENSIONS.has(extension)) continue;

    const stem = withoutExtension(pathBasename(path));
    const rule = ASSET_RULES.find((candidate) => candidate.pattern.test(stem));
    if (!rule) continue;

    // A logo variant is still a real asset, but it is not *the* logo. Saying
    // so is what stops a monochrome mark being revealed as the brand.
    const role: BrandAssetRole =
      rule.role === "logo" && LOGO_VARIANT.test(stem) ? "logo_alternate" : rule.role;

    const evidence: Evidence[] = [{ kind: "file_path", path, detail: rule.role }];

    signals.push({
      role,
      path,
      servedPath: servedPathFor(path),
      confidence: assetConfidence(path, rule, stem),
      evidence,
    });
  }

  const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  const roleOrder: BrandAssetRole[] = [
    "logo",
    "logo_alternate",
    "favicon",
    "app_icon",
    "open_graph_image",
  ];

  signals.sort((a, b) => {
    const roleDelta = roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role);
    if (roleDelta !== 0) return roleDelta;
    const confidenceDelta = rank[a.confidence] - rank[b.confidence];
    if (confidenceDelta !== 0) return confidenceDelta;
    return (
      pathSegments(a.path).length - pathSegments(b.path).length || a.path.localeCompare(b.path)
    );
  });

  // Capped: a design-heavy repository can hold hundreds of icon sizes, and a
  // snapshot is a summary, not an inventory.
  return signals.slice(0, 24);
}

// ---------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------

export type DeclaredToken = { name: string; value: string };

/**
 * Extracts CSS custom-property declarations.
 *
 * A bounded scanner, not a CSS parser: we need `--name: value` pairs, and a
 * real parser would be a dependency and a much larger attack surface for a
 * hostile stylesheet. Every quantifier is bounded, so malformed CSS degrades
 * to "fewer tokens found" rather than to a hang.
 */
export function parseCustomProperties(css: string): DeclaredToken[] {
  const tokens: DeclaredToken[] = [];
  const pattern = /--([a-zA-Z0-9_-]{1,60})\s*:\s*([^;{}]{1,200})[;}]/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null && tokens.length < 400) {
    const value = match[2].trim();
    if (value === "") continue;
    tokens.push({ name: `--${match[1]}`, value });
  }
  return tokens;
}

/**
 * Hex only, deliberately.
 *
 * `rgb()`, `hsl()` and `oklch()` are perfectly valid colours, but resolving
 * them to a swatch means implementing colour-space conversion for a value we
 * would then display as a hex chip. A palette declared entirely in `oklch`
 * therefore contributes no colour evidence, which is a real gap and a much
 * better outcome than an approximate colour shown as the product's brand.
 */
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** RGB in 0–255, or null when the value is not an opaque, resolvable colour. */
export function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  if (!HEX_COLOR.test(value)) return null;
  let hex = value.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .slice(0, 3)
      .split("")
      .map((character) => character + character)
      .join("");
  }
  hex = hex.slice(0, 6);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

/** Normalizes a hex colour to lowercase six-digit form. */
function normalizeHex(value: string): string | null {
  const rgb = parseHexColor(value);
  if (!rgb) return null;
  const part = (channel: number) => channel.toString(16).padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

/**
 * HSV saturation and value, 0–1. Used to tell a brand colour from the
 * greyscale a design system is mostly made of.
 */
export function colorStrength(value: string): { saturation: number; brightness: number } | null {
  const rgb = parseHexColor(value);
  if (!rgb) return null;
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  return { saturation: max === 0 ? 0 : (max - min) / max, brightness: max / 255 };
}

/**
 * Token-name → role, matched on whole words.
 *
 * Word-boundary matching matters more than it looks: `--color-ground` contains
 * the substring "ground", and a careless `includes("ground")` would report a
 * near-black board colour as the product's background — which it is, by
 * accident, for exactly the wrong reason.
 */
const ROLE_RULES: { role: BrandColorRole; strong: RegExp; weak: RegExp }[] = [
  {
    role: "primary",
    strong: /(^|-)(primary|brand)(-(color|colour|500|600|default|base|main))?$/,
    weak: /(^|-)(primary|brand)(-|$)/,
  },
  {
    role: "secondary",
    strong: /(^|-)secondary(-(color|colour|500|600|default|base|main))?$/,
    weak: /(^|-)secondary(-|$)/,
  },
  {
    role: "accent",
    strong: /(^|-)(accent|highlight)(-(color|colour|default|base|main))?$/,
    weak: /(^|-)(accent|highlight)(-|$)/,
  },
  {
    role: "background",
    strong: /(^|-)(background|bg|canvas|page-background)$/,
    weak: /(^|-)(background|bg|canvas)(-|$)/,
  },
  {
    role: "foreground",
    strong: /(^|-)(foreground|fg|text|body-text|ink)$/,
    weak: /(^|-)(foreground|fg|text|ink)(-|$)/,
  },
];

/** Token-name fragments that mark a colour as a state, not a brand. */
const STATE_TOKEN =
  /(^|-)(success|warning|error|danger|destructive|info|muted|disabled|placeholder|border|ring|shadow|overlay|hover|focus|active|visited|tint|line|track|faint|meta)(-|$)/;

/**
 * Prefixes that make a token part of a *ramp* rather than a brand colour.
 *
 * The dogfood run against Vibe Business's own design system is why this
 * exists. `--color-fg-secondary` is step four of an eight-step foreground
 * ramp, and a naive `(^|-)secondary$` match reported that grey as the
 * product's secondary brand colour. `--color-mint-ink` — the near-black text
 * that sits *on* a mint fill — was likewise reported as the product's text
 * colour, in place of `--color-fg`.
 *
 * Both are the same mistake: a compound name whose head says what family it
 * belongs to, read as though the tail were the whole name.
 */
const RAMP_PREFIX =
  /^(fg|foreground|bg|background|text|surface|panel|card|well|field|border|line|ink|on)-/;

/** Colour prefix of a token name — `--color-mint-tint` → `mint`. */
export function colorFamily(tokenName: string): string {
  const stripped = tokenName.replace(/^--/, "").replace(/^(color|colour|theme|brand|palette)-/, "");
  const [head] = stripped.split("-");
  return head ?? stripped;
}

function tokenEvidence(path: string, token: DeclaredToken): Evidence[] {
  return [{ kind: "config_file", path, detail: token.name }];
}

type SourcedToken = DeclaredToken & { path: string };

/**
 * Turns declared tokens into role-assigned colours.
 *
 * Two passes, and the order is the point:
 *
 *  1. **By name.** A token literally called `--color-primary` says what it is,
 *     and that earns `high`. A weaker name (`--primary-foreground`) earns
 *     `medium`.
 *  2. **By colour.** When nothing is named, the saturated colours in a
 *     palette are the brand candidates — greys and near-blacks are the chrome
 *     every design system has. The largest saturated family leads, but this
 *     only ever earns `medium` (a clear lead) or `low`, because "the most
 *     tokens" is a decent guess and not a declaration.
 */
export function assignColorRoles(tokens: SourcedToken[]): BrandColorSignal[] {
  const resolved = new Map<string, string>();
  for (const token of tokens) {
    const hex = normalizeHex(token.value);
    if (hex) resolved.set(token.name, hex);
  }

  // One level of `var(--other)` indirection, which is how most token systems
  // alias a semantic name onto a palette entry. Deeper chains are left alone
  // rather than followed into a cycle.
  const aliasPattern = /^var\(\s*(--[a-zA-Z0-9_-]{1,60})/;
  for (const token of tokens) {
    if (resolved.has(token.name)) continue;
    const alias = aliasPattern.exec(token.value);
    if (!alias) continue;
    const target = resolved.get(alias[1]);
    if (target) resolved.set(token.name, target);
  }

  const signals: BrandColorSignal[] = [];
  const takenRoles = new Set<BrandColorRole>();

  /** The token name with its `--` and any `color-`/`theme-` prefix removed. */
  const bareName = (token: SourcedToken) =>
    token.name.replace(/^--/, "").replace(/^(color|colour|theme|palette)-/, "");

  /** Role words a bare name can equal outright, per role. */
  const EXACT_WORDS: Record<BrandColorRole, string[]> = {
    primary: ["primary", "brand"],
    secondary: ["secondary"],
    accent: ["accent", "highlight"],
    background: ["background", "bg", "canvas"],
    foreground: ["foreground", "fg", "text", "ink"],
  };

  for (const rule of ROLE_RULES) {
    for (const strength of ["strong", "weak"] as const) {
      if (takenRoles.has(rule.role)) break;

      const candidates = tokens.filter((token) => {
        const bare = bareName(token);
        if (!resolved.has(token.name)) return false;
        if (!rule[strength].test(bare)) return false;
        // A ramp step is not a brand colour, whatever its tail says.
        return !RAMP_PREFIX.test(bare);
      });

      if (candidates.length === 0) continue;

      // Specificity, not file order. `--color-fg` names the foreground;
      // `--color-mint-ink` merely ends in a word that also does, and it
      // happens to be declared first.
      const match = candidates.sort((a, b) => {
        const exactness = (token: SourcedToken) =>
          EXACT_WORDS[rule.role].includes(bareName(token)) ? 0 : 1;
        return exactness(a) - exactness(b) || bareName(a).length - bareName(b).length;
      })[0];

      takenRoles.add(rule.role);
      signals.push({
        role: rule.role,
        value: resolved.get(match.name)!,
        token: match.name,
        confidence: strength === "strong" ? "high" : "medium",
        evidence: tokenEvidence(match.path, match),
      });
    }
  }

  // Pass two: nothing declared a primary, so look at the palette itself.
  if (!takenRoles.has("primary") && !takenRoles.has("accent")) {
    const families = new Map<string, { count: number; best: SourcedToken; hex: string }>();

    for (const token of tokens) {
      const hex = resolved.get(token.name);
      if (!hex) continue;
      const bare = token.name.replace(/^--/, "");
      if (STATE_TOKEN.test(bare)) continue;

      const strength = colorStrength(hex);
      // Saturated and visible: excludes the greys, the near-blacks and the
      // near-whites that every palette is mostly made of.
      if (!strength || strength.saturation < 0.35 || strength.brightness < 0.15) continue;

      const family = colorFamily(token.name);
      const existing = families.get(family);
      if (existing) {
        existing.count += 1;
        // The shortest name in a family is its base: `--color-mint` over
        // `--color-mint-tint-soft`.
        if (token.name.length < existing.best.name.length) {
          existing.best = token;
          existing.hex = hex;
        }
      } else {
        families.set(family, { count: 1, best: token, hex });
      }
    }

    const ranked = [...families.values()].sort(
      (a, b) => b.count - a.count || a.best.name.localeCompare(b.best.name),
    );

    if (ranked.length > 0) {
      const [leader, runnerUp] = ranked;
      // A clear lead is a real signal; a three-way tie between mint, amber and
      // coral is a palette, not a brand colour, and saying so is the honest
      // answer (CORE-1 §12, §42).
      const clearLead = runnerUp === undefined || leader.count >= runnerUp.count * 1.5;
      signals.push({
        role: "primary",
        value: leader.hex,
        token: leader.best.name,
        confidence: clearLead ? "medium" : "low",
        evidence: tokenEvidence(leader.best.path, leader.best),
      });

      // Deliberately no runner-up. The dogfood made the case: the second
      // saturated family in Vibe Business's palette is amber, which is its
      // *waiting* status colour — not a secondary brand colour by any reading.
      // A guess at second place adds a claim without adding information.
    }
  }

  return signals;
}

// ---------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------

/** Generic families a stack falls back to. Never a brand typeface. */
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "inherit",
  "initial",
  "unset",
  "revert",
  "-apple-system",
  "blinkmacsystemfont",
  "segoe ui",
  "roboto",
  "helvetica",
  "helvetica neue",
  "arial",
  "sfmono-regular",
  "menlo",
  "monaco",
  "consolas",
  "courier",
  "courier new",
  "apple color emoji",
  "segoe ui emoji",
  "segoe ui symbol",
  "noto color emoji",
  "emoji",
  "math",
  "sans",
  "mono",
]);

/**
 * `--font-space-grotesk` → "Space Grotesk".
 *
 * This is the `next/font` convention, and it is the only reliable way to name
 * a self-hosted typeface without downloading the font file: the loader's
 * variable is the family, kebab-cased.
 */
export function humanizeFontToken(tokenName: string): string | null {
  const stripped = tokenName.replace(/^--font-/, "").replace(/^--/, "");
  if (stripped === "" || GENERIC_FAMILIES.has(stripped)) return null;
  // The role words are not families: `--font-sans: var(--font-inter)` names
  // the role on the left and the family on the right.
  if (
    ["sans", "serif", "mono", "monospace", "display", "body", "heading", "text"].includes(stripped)
  ) {
    return null;
  }
  return stripped
    .split("-")
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** First non-generic family in a CSS font stack, unquoted. */
export function firstConcreteFamily(stack: string): string | null {
  for (const raw of stack.split(",").slice(0, 12)) {
    const family = raw
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
    if (family === "" || family.startsWith("var(")) continue;
    if (GENERIC_FAMILIES.has(family.toLowerCase())) continue;
    if (family.length > 60) continue;
    return family;
  }
  return null;
}

const TYPE_ROLE_RULES: { role: BrandTypefaceSignal["role"]; pattern: RegExp }[] = [
  { role: "mono", pattern: /(^|-)(mono|monospace|code)(-|$)/ },
  { role: "display", pattern: /(^|-)(display|heading|headline|title|brand)(-|$)/ },
  { role: "body", pattern: /(^|-)(body|sans|serif|text|base|default)(-|$)/ },
];

export function detectTypefaces(
  tokens: SourcedToken[],
  stylesheets: { path: string; content: string }[],
): BrandTypefaceSignal[] {
  const signals: BrandTypefaceSignal[] = [];
  const takenRoles = new Set<BrandTypefaceSignal["role"]>();

  const fontTokens = tokens.filter((token) => /^--font-/.test(token.name));
  const byName = new Map(fontTokens.map((token) => [token.name, token]));

  for (const token of fontTokens) {
    const bare = token.name.replace(/^--/, "");
    const rule = TYPE_ROLE_RULES.find((candidate) => candidate.pattern.test(bare));
    if (!rule || takenRoles.has(rule.role)) continue;

    // A role token usually points at a loader variable: resolve one hop, then
    // fall back to the first concrete family in the stack.
    let family: string | null = null;
    const alias = /var\(\s*(--font-[a-zA-Z0-9_-]{1,60})/.exec(token.value);
    if (alias) family = humanizeFontToken(alias[1]);
    if (!family && alias && byName.has(alias[1])) {
      family = firstConcreteFamily(byName.get(alias[1])!.value);
    }
    family ??= firstConcreteFamily(token.value);
    if (!family) continue;

    takenRoles.add(rule.role);
    signals.push({
      role: rule.role,
      family,
      // A named role token pointing at a named family is as strong as this
      // gets without rendering the page.
      confidence: alias ? "high" : "medium",
      evidence: tokenEvidence(token.path, token),
    });
  }

  // Fall back to plain `font-family` declarations when no token system exists.
  if (signals.length === 0) {
    for (const sheet of stylesheets) {
      const pattern = /font-family\s*:\s*([^;{}]{1,200})[;}]/gi;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(sheet.content)) !== null) {
        const family = firstConcreteFamily(match[1]);
        if (!family) continue;
        signals.push({
          role: "body",
          family,
          confidence: "low",
          evidence: [{ kind: "config_file", path: sheet.path, detail: "font-family" }],
        });
        break;
      }
      if (signals.length > 0) break;
    }
  }

  return signals;
}

// ---------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------

export function detectBrand(context: DetectionContext): BrandIntelligence {
  const tokens: SourcedToken[] = [];
  for (const sheet of context.styleSheets) {
    for (const token of parseCustomProperties(sheet.content)) {
      tokens.push({ ...token, path: sheet.path });
    }
  }

  return {
    assets: detectBrandAssets(context),
    colors: assignColorRoles(tokens),
    typefaces: detectTypefaces(tokens, context.styleSheets),
    tokenSources: context.styleSheets.map((sheet) => sheet.path),
  };
}
