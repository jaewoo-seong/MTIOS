"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, BookOpen, Compass, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  helpArticle,
  helpArticles,
  isHelpArticleId,
  type HelpArticle,
  type HelpArticleId
} from "@/lib/help/content";
import { HelpSystemMap } from "@/components/help-system-map";
import { tourCopy } from "@/lib/help/tour";

export function HelpDrawer({ open, articleId, onOpenChange, onSelectArticle, onStartTour }: {
  open: boolean;
  articleId: HelpArticleId | null;
  onOpenChange: (open: boolean) => void;
  onSelectArticle: (id: HelpArticleId | null) => void;
  onStartTour: () => void;
}) {
  const { t, preferences } = useI18n();
  const [query, setQuery] = useState("");
  const articles = useMemo(() => helpArticles(preferences.locale), [preferences.locale]);
  const active = articleId ? helpArticle(articleId, preferences.locale) : null;

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return articles;
    return articles.filter((item) =>
      `${item.title} ${item.summary}`.toLowerCase().includes(term)
      || item.blocks.some((block) => "text" in block && block.text.toLowerCase().includes(term))
    );
  }, [articles, query]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="help-overlay" />
        <Dialog.Content className="help-drawer" aria-describedby={undefined}>
          <header className="help-drawer-head">
            {active ? (
              <button className="help-back" onClick={() => onSelectArticle(null)}>
                <ArrowLeft size={15} /> {t("All help topics")}
              </button>
            ) : (
              <Dialog.Title className="help-drawer-title"><BookOpen size={16} /> {t("Help and tutorials")}</Dialog.Title>
            )}
            <Dialog.Close className="help-close" aria-label={t("Close help")}><X size={16} /></Dialog.Close>
          </header>

          {active ? (
            <ArticleView article={active} onSelectArticle={onSelectArticle} locale={preferences.locale} />
          ) : (
            <div className="help-drawer-body">
              <button className="help-tour-start" onClick={onStartTour}>
                <Compass size={16} />
                <span>
                  <strong>{tourCopy[preferences.locale]?.start ?? tourCopy.en.start}</strong>
                  <small>{t("A seven-step walkthrough of how the modules connect.")}</small>
                </span>
              </button>
              <label className="help-search">
                <Search size={14} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("Search help")}
                  aria-label={t("Search help")}
                />
              </label>
              {matches.length === 0 ? (
                <p className="help-empty">{t("No help topic matches that search.")}</p>
              ) : (
                <ul className="help-index">
                  {matches.map((item) => (
                    <li key={item.id}>
                      <button onClick={() => onSelectArticle(item.id as HelpArticleId)}>
                        <strong>{item.title}</strong>
                        <span>{item.summary}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ArticleView({ article, onSelectArticle, locale }: {
  article: HelpArticle;
  onSelectArticle: (id: HelpArticleId) => void;
  locale: Parameters<typeof helpArticle>[1];
}) {
  return (
    <article className="help-drawer-body help-article">
      <Dialog.Title asChild><h2>{article.title}</h2></Dialog.Title>
      <p className="help-article-summary">{article.summary}</p>
      {article.blocks.map((block, index) => {
        if (block.kind === "map") return <HelpSystemMap key={index} locale={locale} onOpenArticle={onSelectArticle} />;
        if (block.kind === "note") return <aside className="help-note" key={index}>{block.text}</aside>;
        if (block.kind === "steps") {
          return <ol className="help-steps" key={index}>{block.items.map((item) => <li key={item}>{item}</li>)}</ol>;
        }
        return <p key={index}>{block.text}</p>;
      })}
      {article.related.length > 0 && (
        <footer className="help-related">
          <span>Related</span>
          <div>
            {article.related.filter(isHelpArticleId).map((id) => (
              <button key={id} onClick={() => onSelectArticle(id)}>{helpArticle(id, locale).title}</button>
            ))}
          </div>
        </footer>
      )}
    </article>
  );
}
