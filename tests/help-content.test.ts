import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  englishHelpArticles,
  helpArticle,
  helpArticleOrder,
  helpArticles,
  helpArticleTopics,
  helpTranslations,
  isHelpArticleId,
  type HelpArticleId
} from "@/lib/help/content";
import { helpSystemMapCopy, mapEdges, mapNodes } from "@/lib/help/system-map";
import { tourSteps } from "@/lib/help/tour";

/**
 * Help text drifts away from the product silently, which is the same failure
 * the i18n coverage test exists to prevent. These bind the content to things
 * that break loudly when the product moves underneath it.
 */

function navigationModules() {
  const source = readFileSync("components/business-os.tsx", "utf8");
  const block = source.slice(source.indexOf("const navItems"), source.indexOf("const pageCopy"));
  return [...block.matchAll(/id: "([a-z]+)"/g)].map((match) => match[1]);
}

function componentSources() {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full)) files.push(full);
    }
  };
  walk("components");
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

describe("help content", () => {
  it("exposes every ordered article", () => {
    for (const id of helpArticleOrder) {
      expect(englishHelpArticles[id], id).toBeDefined();
      expect(englishHelpArticles[id].title.length, id).toBeGreaterThan(0);
      expect(englishHelpArticles[id].blocks.length, id).toBeGreaterThan(0);
    }
    expect(helpArticles("en")).toHaveLength(helpArticleOrder.length);
  });

  it("resolves every related link to a real article", () => {
    for (const id of helpArticleOrder) {
      for (const related of englishHelpArticles[id].related) {
        expect(isHelpArticleId(related), `${id} -> ${related}`).toBe(true);
        expect(related, `${id} must not relate to itself`).not.toBe(id);
      }
    }
  });

  it("covers every navigation module with at least one article", () => {
    const covered = new Set(Object.values(helpArticleTopics).flat());
    for (const module of navigationModules()) {
      expect(covered.has(module as never), `no help article covers "${module}"`).toBe(true);
    }
  });

  it("keeps topic entries for every article", () => {
    for (const id of helpArticleOrder) {
      expect(helpArticleTopics[id], id).toBeDefined();
      expect(helpArticleTopics[id].length, id).toBeGreaterThan(0);
    }
  });

  it("falls back to English for untranslated articles instead of breaking", () => {
    for (const id of helpArticleOrder) {
      const korean = helpArticle(id, "ko");
      expect(korean.id).toBe(id);
      expect(korean.blocks.length, id).toBeGreaterThan(0);
      expect(korean.title.length, id).toBeGreaterThan(0);
    }
  });

  it("has no orphaned translations", () => {
    for (const [locale, articles] of Object.entries(helpTranslations)) {
      for (const id of Object.keys(articles ?? {})) {
        expect(isHelpArticleId(id), `${locale} translates unknown article "${id}"`).toBe(true);
      }
    }
  });

  it("only renders block kinds the drawer knows how to display", () => {
    const rendered = new Set(["text", "steps", "note", "map"]);
    for (const id of helpArticleOrder) {
      for (const block of englishHelpArticles[id].blocks) {
        expect(rendered.has(block.kind), `${id} uses unsupported block "${block.kind}"`).toBe(true);
      }
    }
  });

  it("translates every article into Korean, bodies included", () => {
    for (const id of helpArticleOrder) {
      const translated = helpTranslations.ko?.[id];
      expect(translated?.title, `${id} has no Korean title`).toBeTruthy();
      expect(translated?.summary, `${id} has no Korean summary`).toBeTruthy();
      expect(translated?.blocks?.length, `${id} has no Korean body`).toBeGreaterThan(0);
    }
  });

  it("keeps the same block structure in every translation", () => {
    // A translation that drops a block silently loses content — most
    // importantly the system map, which is the whole point of one article.
    for (const [locale, articles] of Object.entries(helpTranslations)) {
      for (const [id, article] of Object.entries(articles ?? {})) {
        if (!article?.blocks) continue;
        const source = englishHelpArticles[id as HelpArticleId].blocks.map((block) => block.kind);
        expect(article.blocks.map((block) => block.kind), `${locale}/${id} block structure`).toEqual(source);
      }
    }
  });

  it("localizes every node and edge the map actually draws", () => {
    const drawnNodes = mapNodes.map((node) => node.id);
    const drawnEdges = mapEdges.flatMap((edge) => edge.label ? [edge.label] : []);
    for (const [locale, copy] of Object.entries(helpSystemMapCopy)) {
      for (const id of drawnNodes) {
        expect(copy.nodes[id]?.title, `${locale} map node "${id}" has no title`).toBeTruthy();
        expect(copy.nodes[id]?.detail, `${locale} map node "${id}" has no detail`).toBeTruthy();
      }
      for (const id of drawnEdges) {
        expect(copy.edges[id], `${locale} map edge "${id}" has no label`).toBeTruthy();
      }
      expect(copy.caption.length, `${locale} map caption`).toBeGreaterThan(0);
      expect(copy.alt.length, `${locale} map alt text`).toBeGreaterThan(0);
    }
  });

  it("points every map node at a real article", () => {
    for (const node of mapNodes) {
      if (!node.article) continue;
      expect(isHelpArticleId(node.article), `map node "${node.id}"`).toBe(true);
    }
  });

  it("points every contextual HelpLink at a real article", () => {
    // A typo here would render a control that opens nothing, with no error.
    const links = [...componentSources().matchAll(/<HelpLink\s[^>]*article="([^"]+)"/g)].map((match) => match[1]);
    expect(links.length, "no HelpLink entry points found").toBeGreaterThan(0);
    for (const article of links) {
      expect(isHelpArticleId(article), `HelpLink article="${article}"`).toBe(true);
    }
  });

  it("gives every navigation module a header help topic", () => {
    const source = readFileSync("components/business-os.tsx", "utf8");
    const block = source.slice(source.indexOf("const pageHelp"), source.indexOf("async function api"));
    const mapped = [...block.matchAll(/(\w+): "([a-z-]+)"/g)];
    const modules = navigationModules();
    expect(mapped.map((match) => match[1]).sort()).toEqual([...modules].sort());
    for (const [, , article] of mapped) {
      expect(isHelpArticleId(article), `pageHelp -> ${article}`).toBe(true);
    }
  });

  it("anchors every tour step to a real data-help-anchor", () => {
    // The reason steps target explicit anchors instead of CSS selectors: a
    // renamed class would break the tour silently, this fails the build.
    const source = componentSources();
    const literal = [...source.matchAll(/data-help-anchor="([^"]+)"/g)].map((match) => match[1]);
    // Template anchors such as `nav-${item.id}` are expanded from their source.
    const templated = [...source.matchAll(/data-help-anchor=\{`([^`]+)`\}/g)].map((match) => match[1]);
    const navExpanded = templated.includes("nav-${item.id}")
      ? navigationModules().map((module) => `nav-${module}`)
      : [];
    // `anchor="…"` is the prop form used by HelpLink.
    const viaProp = [...source.matchAll(/<HelpLink\s[^>]*anchor="([^"]+)"/g)].map((match) => match[1]);
    const available = new Set([...literal, ...navExpanded, ...viaProp]);

    for (const step of tourSteps) {
      expect(available.has(step.anchor), `tour step "${step.id}" targets missing anchor "${step.anchor}"`).toBe(true);
    }
  });

  it("keeps tour steps coherent", () => {
    const ids = tourSteps.map((step) => step.id);
    expect(new Set(ids).size, "duplicate tour step ids").toBe(ids.length);
    for (const step of tourSteps) {
      expect(step.title.en.length, `${step.id} title`).toBeGreaterThan(0);
      expect(step.title.ko.length, `${step.id} Korean title`).toBeGreaterThan(0);
      expect(step.body.en.length, `${step.id} body`).toBeGreaterThan(0);
      expect(step.body.ko.length, `${step.id} Korean body`).toBeGreaterThan(0);
      if (step.article) expect(isHelpArticleId(step.article), `${step.id} article`).toBe(true);
      if (step.page) expect(navigationModules(), `${step.id} page`).toContain(step.page);
    }
  });

  it("renders the system map somewhere, since it is the connection explainer", () => {
    const withMap = helpArticleOrder.filter((id: HelpArticleId) =>
      englishHelpArticles[id].blocks.some((block) => block.kind === "map")
    );
    expect(withMap).toContain("how-it-connects");
    expect(componentSources()).toContain("HelpSystemMap");
  });
});
