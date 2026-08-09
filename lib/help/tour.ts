import type { HelpArticleId, HelpTopic } from "@/lib/help/content";
import type { Locale } from "@/lib/i18n";

/**
 * Steps target `data-help-anchor` attributes rather than CSS selectors. A
 * class name can be renamed during unrelated styling work and silently break
 * the tour; an explicit anchor is a declared contract, and a test asserts
 * every one referenced here still exists in the components.
 */
export type TourStep = {
  id: string;
  anchor: string;
  /** Module the tour switches to before showing this step. */
  page?: HelpTopic;
  title: Record<Locale, string>;
  body: Record<Locale, string>;
  article?: HelpArticleId;
};

export const tourSteps: TourStep[] = [
  {
    id: "modules",
    anchor: "sidebar-nav",
    page: "projects",
    title: { en: "Four modules, one chain", ko: "네 개의 모듈, 하나의 흐름" },
    body: {
      en: "Projects, Documents, and Client Databases are three views of the same research. Settings powers the agents that fill them.",
      ko: "프로젝트, 문서, 고객 데이터베이스는 같은 연구를 보는 세 가지 화면입니다. 설정은 이들을 채우는 에이전트를 구동합니다."
    },
    article: "how-it-connects"
  },
  {
    id: "projects",
    anchor: "project-list",
    page: "projects",
    title: { en: "Research starts with a project", ko: "연구는 프로젝트에서 시작합니다" },
    body: {
      en: "Each project is an isolated research program with one active strategy. Nothing runs until you approve that strategy.",
      ko: "각 프로젝트는 활성 전략 하나를 가진 독립된 연구 프로그램입니다. 전략을 승인하기 전까지는 아무것도 실행되지 않습니다."
    },
    article: "starting-a-project"
  },
  {
    id: "summary",
    anchor: "research-summary",
    page: "projects",
    title: { en: "Live state at a glance", ko: "현재 상태 한눈에 보기" },
    body: {
      en: "Active dossiers, the qualified queue, and the company target. The queue is backpressure; the target is how many companies the campaign collects in total.",
      ko: "진행 중인 조사서, 자격 충족 대기열, 기업 목표치입니다. 대기열은 속도 조절 장치이고, 목표치는 캠페인이 수집할 기업의 총량입니다."
    },
    article: "research-queue"
  },
  {
    id: "tabs",
    anchor: "research-tabs",
    page: "projects",
    title: { en: "Strategy, queue, dossiers", ko: "전략, 대기열, 조사서" },
    body: {
      en: "Work moves left to right. You approve a strategy, discovery fills the queue, and finished dossiers arrive in the third tab for your decision.",
      ko: "작업은 왼쪽에서 오른쪽으로 진행됩니다. 전략을 승인하면 탐색이 대기열을 채우고, 완성된 조사서가 세 번째 탭에 도착해 판정을 기다립니다."
    },
    article: "strategy"
  },
  {
    id: "documents",
    anchor: "nav-documents",
    page: "documents",
    title: { en: "Dossiers land here", ko: "조사서는 여기에 도착합니다" },
    body: {
      en: "Every finished dossier is an ordinary editable document. Saving creates an immutable version, and agent rework proposes a version rather than overwriting yours.",
      ko: "완성된 조사서는 모두 편집 가능한 일반 문서입니다. 저장하면 변경할 수 없는 버전이 생기고, 에이전트 재작업은 덮어쓰지 않고 새 버전을 제안합니다."
    },
    article: "documents"
  },
  {
    id: "client-data",
    anchor: "nav-data",
    page: "data",
    title: { en: "The same companies, as data", ko: "같은 기업, 데이터 형태로" },
    body: {
      en: "Each project has exactly one client database. Rows arrive from research and link straight back to their dossier — the narrative and the record are one company.",
      ko: "프로젝트마다 고객 데이터베이스가 정확히 하나 있습니다. 행은 연구를 통해 생성되며 해당 조사서로 바로 연결됩니다. 서술형 기록과 데이터는 같은 기업입니다."
    },
    article: "client-databases"
  },
  {
    id: "help",
    anchor: "module-help",
    page: "projects",
    title: { en: "Help is always one click away", ko: "도움말은 항상 한 번의 클릭 거리에 있습니다" },
    body: {
      en: "Every module and section has a question mark that opens its topic. Press ? anywhere, or reopen this tour from the help index.",
      ko: "모든 모듈과 섹션에는 해당 주제를 여는 물음표가 있습니다. 어디서든 ? 키를 누르거나 도움말 목록에서 이 둘러보기를 다시 열 수 있습니다."
    },
    article: "overview"
  }
];

export const tourStorageKey = "mti-os:help-tour-seen";

export const tourCopy: Record<Locale, {
  start: string;
  restart: string;
  next: string;
  back: string;
  done: string;
  skip: string;
  readMore: string;
  progress: string;
  label: string;
}> = {
  en: {
    start: "Take the tour",
    restart: "Replay the tour",
    next: "Next",
    back: "Back",
    done: "Done",
    skip: "Skip",
    readMore: "Read more",
    progress: "Step {current} of {total}",
    label: "Product tour"
  },
  ko: {
    start: "둘러보기 시작",
    restart: "둘러보기 다시 보기",
    next: "다음",
    back: "이전",
    done: "완료",
    skip: "건너뛰기",
    readMore: "자세히 보기",
    progress: "{total}단계 중 {current}단계",
    label: "제품 둘러보기"
  }
};
