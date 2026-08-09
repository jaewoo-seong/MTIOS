"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { HelpDrawer } from "@/components/help-drawer";
import { HelpTour } from "@/components/help-tour";
import { isHelpArticleId, type HelpArticleId, type HelpTopic } from "@/lib/help/content";
import { tourStorageKey } from "@/lib/help/tour";

type HelpContextValue = {
  openHelp: (article?: HelpArticleId) => void;
  closeHelp: () => void;
  startTour: () => void;
  /** The shell registers module navigation so tour steps can switch pages. */
  registerNavigator: (navigate: (page: HelpTopic) => void) => void;
};

const HelpContext = createContext<HelpContextValue | null>(null);

/**
 * Owns the help drawer so any module can open a specific topic without the
 * shell having to thread a callback down to it.
 */
export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [articleId, setArticleId] = useState<HelpArticleId | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const navigatorRef = useRef<((page: HelpTopic) => void) | null>(null);

  const openHelp = useCallback((article?: HelpArticleId) => {
    setArticleId(article ?? null);
    setOpen(true);
  }, []);
  const closeHelp = useCallback(() => {
    setOpen(false);
    setArticleId(null);
  }, []);

  const registerNavigator = useCallback((navigate: (page: HelpTopic) => void) => {
    navigatorRef.current = navigate;
  }, []);
  const navigate = useCallback((page: HelpTopic) => navigatorRef.current?.(page), []);

  const startTour = useCallback(() => {
    setOpen(false);
    setArticleId(null);
    setTourOpen(true);
  }, []);
  const finishTour = useCallback(() => {
    setTourOpen(false);
    try { window.localStorage.setItem(tourStorageKey, "true"); } catch { /* private mode */ }
  }, []);

  // First run only. Dismissing or completing it records the flag, so the tour
  // never reappears on its own.
  useEffect(() => {
    let seen = true;
    try { seen = window.localStorage.getItem(tourStorageKey) === "true"; } catch { seen = true; }
    if (seen) return;
    // startTour, not setTourOpen: a deep link such as ?help=… may already have
    // opened the drawer, and the two must never be stacked on top of each other.
    const timer = window.setTimeout(startTour, 1200);
    return () => window.clearTimeout(timer);
  }, [startTour]);

  // ?help=<article> makes any topic linkable and survives a reload.
  useEffect(() => {
    const read = () => {
      const help = new URLSearchParams(window.location.search).get("help");
      if (isHelpArticleId(help)) {
        setArticleId(help);
        setOpen(true);
      }
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  // The URL follows the drawer so a topic can be shared, but with replaceState
  // so opening help never adds a step to the back button.
  useEffect(() => {
    const url = new URL(window.location.href);
    const current = url.searchParams.get("help");
    const next = open && articleId ? articleId : null;
    if (current === next) return;
    if (next) url.searchParams.set("help", next);
    else url.searchParams.delete("help");
    window.history.replaceState({}, "", url);
  }, [open, articleId]);

  // "?" opens help, except while typing, where it is just a character.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <HelpContext.Provider value={{ openHelp, closeHelp, startTour, registerNavigator }}>
      {children}
      <HelpDrawer
        open={open}
        articleId={articleId}
        onOpenChange={(next) => (next ? setOpen(true) : closeHelp())}
        onSelectArticle={setArticleId}
        onStartTour={startTour}
      />
      {tourOpen && <HelpTour onFinish={finishTour} onNavigate={navigate} onOpenArticle={openHelp} />}
    </HelpContext.Provider>
  );
}

export function useHelp() {
  const value = useContext(HelpContext);
  if (!value) throw new Error("useHelp must be used inside HelpProvider.");
  return value;
}

/**
 * The standard way to point at a help topic from inside a module. Without a
 * label it is a compact "?" for a section header; with one it reads as a link
 * for empty states.
 */
export function HelpLink({ article, label, title, anchor }: {
  article: HelpArticleId;
  label?: string;
  title?: string;
  anchor?: string;
}) {
  const { openHelp } = useHelp();
  const accessibleName = title ?? (label ? undefined : "Open help for this section");
  return (
    <button
      type="button"
      className={label ? "help-link" : "help-link icon"}
      data-help-anchor={anchor}
      title={accessibleName}
      aria-label={accessibleName}
      onClick={(event) => {
        event.stopPropagation();
        openHelp(article);
      }}
    >
      <CircleHelp size={label ? 14 : 15} aria-hidden />
      {label}
    </button>
  );
}
