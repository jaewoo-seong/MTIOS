import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards against the drift that let the localization gap be misreported for
 * weeks: the plan recorded "47 untranslated strings" long after all but one
 * had actually been translated, because nothing checked. A count in a
 * document goes stale silently; a failing test does not.
 */

function sourceFiles(dir: string, found: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if ([".next", "node_modules", ".git"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(full)) found.push(full);
  }
  return found;
}

function translatedKeys() {
  const source = readFileSync("lib/i18n.tsx", "utf8");
  const start = source.indexOf("const ko:");
  const end = source.indexOf("\n};", start);
  // Entries appear both as `"k": v` and comma-first as `,"k": v`, so match a
  // quoted key followed by a colon anywhere rather than anchoring to line start.
  return new Set(
    [...source.slice(start, end).matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map((match) => match[1])
  );
}

function usedKeys() {
  const used = new Map<string, string>();
  for (const file of [...sourceFiles("components"), ...sourceFiles("app")]) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
      if (!used.has(match[1])) used.set(match[1], file);
    }
  }
  return used;
}

describe("Korean localization coverage", () => {
  it("translates every string passed to t()", () => {
    const known = translatedKeys();
    const missing = [...usedKeys()]
      .filter(([key]) => !known.has(key))
      .map(([key, file]) => `${key}  (${file})`);

    expect(missing).toEqual([]);
  });

  it("keeps every placeholder token intact in the Korean text", () => {
    const source = readFileSync("lib/i18n.tsx", "utf8");
    const start = source.indexOf("const ko:");
    const end = source.indexOf("\n};", start);
    const offenders: string[] = [];

    for (const entry of source.slice(start, end).matchAll(
      /"((?:[^"\\]|\\.)*)"\s*:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g
    )) {
      const [, english, korean] = entry;
      // A dropped {count} or {title} renders a literal gap in the UI, which is
      // the one localization bug a reader cannot work around.
      const wanted = [...english.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      const got = [...korean.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      if (wanted.join(",") !== got.join(",")) {
        offenders.push(`${english} -> ${korean}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
