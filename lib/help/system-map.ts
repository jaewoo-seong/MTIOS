import type { Locale } from "@/lib/i18n";
import type { HelpArticleId } from "@/lib/help/content";

/**
 * Wording and geometry for the connection diagram. It lives beside the rest of
 * the help copy rather than in the component so it is plain TypeScript that
 * tests can import directly.
 */

export type MapNode = {
  id: string;
  x: number;
  y: number;
  w: number;
  article?: HelpArticleId;
  tone?: "root" | "support";
};

export const mapNodeHeight = 52;

export const mapNodes: MapNode[] = [
  { id: "project", x: 220, y: 16, w: 200, tone: "root", article: "starting-a-project" },
  { id: "strategy", x: 30, y: 104, w: 200, article: "strategy" },
  { id: "database", x: 410, y: 104, w: 200, article: "client-databases" },
  { id: "campaign", x: 30, y: 192, w: 200, article: "research-queue" },
  { id: "records", x: 410, y: 192, w: 200, article: "client-databases" },
  { id: "queue", x: 30, y: 280, w: 200, article: "research-queue" },
  { id: "settings", x: 410, y: 280, w: 200, tone: "support", article: "model-routing" },
  { id: "dossier", x: 220, y: 372, w: 200, article: "reviewing-dossiers" }
];

export type MapEdge = {
  d: string;
  label?: string;
  labelX?: number;
  labelY?: number;
  emphasis?: boolean;
  dashed?: boolean;
};

export const mapEdges: MapEdge[] = [
  { d: "M 280 68 C 240 88, 180 84, 140 104" },
  { d: "M 360 68 C 400 88, 460 84, 500 104" },
  { d: "M 130 156 L 130 192" },
  { d: "M 130 244 L 130 280" },
  { d: "M 510 156 L 510 192" },
  // The queue feeds the dossier worker, which publishes the document.
  { d: "M 130 332 C 130 362, 190 372, 250 380", label: "researched", labelX: 92, labelY: 364 },
  // The link operators most often ask about. Its label sits below the Settings
  // box rather than beside it, which would overlap.
  { d: "M 480 244 C 460 300, 430 356, 396 380", label: "linkedDossier", labelX: 502, labelY: 356, emphasis: true },
  { d: "M 410 306 L 240 306", label: "powersWorkers", labelX: 325, labelY: 297, dashed: true }
];

export type MapCopy = {
  nodes: Record<string, { title: string; detail: string }>;
  edges: Record<string, string>;
  caption: string;
  alt: string;
};

export const helpSystemMapCopy: Record<Locale, MapCopy> = {
  en: {
    nodes: {
      project: { title: "Project", detail: "the root of everything" },
      strategy: { title: "Strategy version", detail: "one active, frozen once approved" },
      database: { title: "Client database", detail: "exactly one per project" },
      campaign: { title: "Campaign + discovery", detail: "finds companies to the target" },
      records: { title: "Client records", detail: "one row per company" },
      queue: { title: "Research queue", detail: "waiting for a dossier worker" },
      settings: { title: "Settings", detail: "models + provider accounts" },
      dossier: { title: "Master dossier", detail: "the cited document you review" }
    },
    edges: { researched: "researched", linkedDossier: "linked dossier", powersWorkers: "powers workers" },
    caption: "A company ends up in two places at once: a master dossier, and a linked row in the project’s client database.",
    alt: "How a project connects to strategy, discovery, the research queue, master dossiers, and the client database"
  },
  ko: {
    nodes: {
      project: { title: "프로젝트", detail: "모든 것의 출발점" },
      strategy: { title: "전략 버전", detail: "활성 1개, 승인 후 고정" },
      database: { title: "고객 데이터베이스", detail: "프로젝트당 정확히 1개" },
      campaign: { title: "캠페인 + 탐색", detail: "목표치까지 기업 발굴" },
      records: { title: "고객 레코드", detail: "기업당 1행" },
      queue: { title: "연구 대기열", detail: "조사서 작업자 대기 중" },
      settings: { title: "설정", detail: "모델 + 제공자 계정" },
      dossier: { title: "마스터 조사서", detail: "검토할 출처 표기 문서" }
    },
    edges: { researched: "조사 완료", linkedDossier: "연결된 조사서", powersWorkers: "작업자 구동" },
    caption: "한 기업은 동시에 두 곳에 기록됩니다. 마스터 조사서, 그리고 프로젝트 고객 데이터베이스의 연결된 행입니다.",
    alt: "프로젝트가 전략, 탐색, 연구 대기열, 마스터 조사서, 고객 데이터베이스와 연결되는 구조"
  }
};
