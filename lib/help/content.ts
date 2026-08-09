import type { Locale } from "@/lib/i18n";

/**
 * Help content is deliberately kept out of the `t()` dictionary. The i18n
 * coverage test requires a Korean translation for every `t()` key, which is
 * right for interface labels and wrong for paragraphs: it would turn every
 * copy edit into a blocking two-language change and fill i18n.tsx with prose.
 * Here, English is canonical and a locale may translate any subset; anything
 * untranslated falls back to English rather than failing a build.
 */

export type HelpBlock =
  | { kind: "text"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "note"; text: string }
  | { kind: "map" };

export type HelpArticle = {
  id: string;
  title: string;
  summary: string;
  blocks: HelpBlock[];
  related: string[];
};

/** Modules from the primary navigation, used to check help coverage. */
export type HelpTopic = "projects" | "documents" | "data" | "settings";

export const helpArticleOrder = [
  "overview",
  "how-it-connects",
  "starting-a-project",
  "strategy",
  "research-queue",
  "reviewing-dossiers",
  "documents",
  "client-databases",
  "model-routing",
  "what-runs-automatically",
  "nothing-is-happening"
] as const;

export type HelpArticleId = typeof helpArticleOrder[number];

/** Which navigation module each article explains. */
export const helpArticleTopics: Record<HelpArticleId, HelpTopic[]> = {
  overview: ["projects", "documents", "data", "settings"],
  "how-it-connects": ["projects", "documents", "data", "settings"],
  "starting-a-project": ["projects"],
  strategy: ["projects"],
  "research-queue": ["projects"],
  "reviewing-dossiers": ["projects", "documents"],
  documents: ["documents"],
  "client-databases": ["data"],
  "model-routing": ["settings"],
  "what-runs-automatically": ["projects", "settings"],
  "nothing-is-happening": ["projects", "settings"]
};

const english: Record<HelpArticleId, HelpArticle> = {
  overview: {
    id: "overview",
    title: "What this program does",
    summary: "One continuous loop that turns a research strategy into decision-ready company dossiers.",
    blocks: [
      { kind: "text", text: "MTI OS runs continuous company research. You describe who you want to find and why; the system discovers matching companies, researches each one against a fixed format, and hands you a cited dossier plus a database row for every company it qualifies." },
      { kind: "text", text: "You approve the strategy and the results. Everything between those two decisions runs on its own." },
      { kind: "steps", items: [
        "You state an objective and approve a research strategy.",
        "Discovery finds companies that match it, up to the approved company target.",
        "Dossier workers research each company and write a cited master document.",
        "You approve, return, or decline each dossier."
      ] },
      { kind: "note", text: "Nothing an agent produces is final until you decide on it. Returning a dossier sends it back for more research rather than deleting it." }
    ],
    related: ["how-it-connects", "starting-a-project"]
  },
  "how-it-connects": {
    id: "how-it-connects",
    title: "How everything connects",
    summary: "Projects, strategies, queues, dossiers, and client databases are one chain, not separate tools.",
    blocks: [
      { kind: "text", text: "Every part of the product hangs off a project. Reading this diagram top to bottom is the fastest way to understand why a change in one place shows up in another." },
      { kind: "map" },
      { kind: "text", text: "The project is the root. It has exactly one active strategy and exactly one client database. The strategy governs discovery and every dossier written after it is approved." },
      { kind: "text", text: "A company that gets researched ends up in two places at once: a master dossier in Documents, and a row in that project's client database. They are two views of the same company — the database row stores the structured fields and links directly to the dossier document." },
      { kind: "note", text: "This is why deleting or replacing a dossier affects the client database view, and why the client database has no \"add company\" of its own: rows arrive from research." },
      { kind: "text", text: "Settings sits outside the chain but powers all of it. Model routing decides which model does each job, and research provider accounts supply the search and registry access the workers need." }
    ],
    related: ["client-databases", "documents", "what-runs-automatically"]
  },
  "starting-a-project": {
    id: "starting-a-project",
    title: "Starting a research project",
    summary: "Create the project, talk to the strategist, approve a strategy. Research begins at approval.",
    blocks: [
      { kind: "steps", items: [
        "Create a project with a clear objective — who you want to find and what makes them worth pursuing.",
        "On the Strategy tab, tell the strategist what you want. It proposes a complete strategy version.",
        "Read the proposal, ask for changes in the same conversation, then approve it.",
        "Discovery and dossier work start automatically once a strategy is active."
      ] },
      { kind: "note", text: "A project does nothing until a strategy is approved. If a new project looks idle, that is almost always why." },
      { kind: "text", text: "Approving also creates the project's client database and its continuous campaign. You do not create those separately." }
    ],
    related: ["strategy", "nothing-is-happening"]
  },
  strategy: {
    id: "strategy",
    title: "Strategies and why versions are frozen",
    summary: "The active strategy defines who is found, what evidence is gathered, and what every dossier must contain.",
    blocks: [
      { kind: "text", text: "A strategy version is immutable once approved. Asking for changes creates a new version rather than editing the old one, so you can always tell which rules produced a given dossier." },
      { kind: "text", text: "The parts that matter most day to day:" },
      { kind: "steps", items: [
        "Geography, industries, and target profile — who discovery looks for.",
        "Qualification rules — what makes a company worth a dossier.",
        "Evidence coverage — which official registries and sources each dossier is allowed to use.",
        "Dossier research blueprint — the exact sections every dossier must contain, and the evidence each one needs.",
        "Company target — how many qualified companies this campaign should collect before discovery stops."
      ] },
      { kind: "note", text: "A dossier already in progress keeps the strategy version it started with. Approving a new strategy affects the next batch, not work already claimed." }
    ],
    related: ["research-queue", "reviewing-dossiers", "how-it-connects"]
  },
  "research-queue": {
    id: "research-queue",
    title: "The research queue",
    summary: "Queue maximum and company target are different limits. Confusing them explains most surprises here.",
    blocks: [
      { kind: "text", text: "The queue holds discovered companies waiting for a dossier. You control how fast it drains and how full it gets." },
      { kind: "steps", items: [
        "Dossier workers — how many companies are researched at the same time.",
        "Queue maximum — how many companies are allowed to sit waiting. Automatic mode keeps this at three times the worker count.",
        "Priority and hold — reorder the queue or park a company without removing it."
      ] },
      { kind: "note", text: "Queue maximum is backpressure, not a goal. It stops discovery running far ahead of research. The company target on the strategy is the real total for the campaign — when that is reached, discovery stops for good." },
      { kind: "text", text: "Changing the worker count while automatic mode is on recalculates the queue maximum. Adjusting the maximum by hand switches that project to a manual override, which then survives worker changes until you press Auto." }
    ],
    related: ["strategy", "nothing-is-happening", "what-runs-automatically"]
  },
  "reviewing-dossiers": {
    id: "reviewing-dossiers",
    title: "Reviewing and deciding on a dossier",
    summary: "Approve, return, or deny. Returning asks for more research; denying rejects the company.",
    blocks: [
      { kind: "text", text: "Completed dossiers appear under the Dossiers tab as a list or as paper cards. Clicking a row or card selects it; opening the title or the card link takes you to the full editable document." },
      { kind: "steps", items: [
        "Approve — the company and its dossier are accepted.",
        "Return — sends it back for revision; use the feedback panel to say what is missing.",
        "Deny — the company is rejected and drops out of review."
      ] },
      { kind: "text", text: "Feedback and rework run in a separate queue from primary research, so asking for a revision never takes a dossier worker away from a new company." },
      { kind: "note", text: "Agent rework proposes a new document version. It does not overwrite your manual edits — you accept the proposed version explicitly." }
    ],
    related: ["documents", "how-it-connects"]
  },
  documents: {
    id: "documents",
    title: "Documents and versions",
    summary: "Dossiers are ordinary documents. Every save creates an immutable version.",
    blocks: [
      { kind: "text", text: "A master dossier lives in Documents like any other file, and can be edited by hand. Saving creates a new immutable version, so earlier states are never lost." },
      { kind: "text", text: "Agent revisions arrive as proposed versions rather than replacements. If you edited the document after the agent started, accepting the proposal is checked against your newer edit rather than silently discarding it." },
      { kind: "note", text: "Documents produced by research stay linked to their company. That link is what puts the dossier on the matching client database row." }
    ],
    related: ["reviewing-dossiers", "client-databases"]
  },
  "client-databases": {
    id: "client-databases",
    title: "Client databases",
    summary: "One database per project, filled by research, with each row linked to its dossier.",
    blocks: [
      { kind: "text", text: "Each research project gets exactly one client database, created when you approve the first strategy. It is the structured view of everything that project has researched." },
      { kind: "text", text: "Rows arrive from research rather than being typed in. When a dossier is published, its company becomes a row carrying the structured fields — qualification score, disposition, research status — and a direct link to the dossier document." },
      { kind: "note", text: "That link is the connection between Documents and Client Databases. The dossier is the narrative; the row is the same company as data you can sort, filter, and export." }
    ],
    related: ["how-it-connects", "documents"]
  },
  "model-routing": {
    id: "model-routing",
    title: "Model routing and research providers",
    summary: "Which model does each job, and which API accounts the researchers are allowed to use.",
    blocks: [
      { kind: "text", text: "Each kind of work — company research, dossier writing, editing, extraction — is a route with its own model policy." },
      { kind: "steps", items: [
        "Auto — scores the eligible models for each individual task and picks per task.",
        "Manual — pins one model for every task on that job."
      ] },
      { kind: "text", text: "Research provider accounts hold the search and registry access workers use. Secrets stay in deployment environment variables; the account here only names which variable to read and tracks quota and health." },
      { kind: "note", text: "Registering an account does not supply a key. If the named environment variable is missing, the provider still shows as unconfigured." }
    ],
    related: ["what-runs-automatically", "nothing-is-happening"]
  },
  "what-runs-automatically": {
    id: "what-runs-automatically",
    title: "What runs on its own, and what waits for you",
    summary: "Four decisions are yours. Everything else is continuous.",
    blocks: [
      { kind: "text", text: "These wait for a person:" },
      { kind: "steps", items: [
        "Approving a strategy version.",
        "Deciding on a completed dossier.",
        "Asking for a revision.",
        "Pausing or resuming research."
      ] },
      { kind: "text", text: "These run continuously without you: discovery, queueing, dossier research and publication, client-database row creation, and restarting stalled work after an outage or deployment." },
      { kind: "note", text: "Because research is continuous, pausing is the correct way to stop spend — not closing the page." }
    ],
    related: ["research-queue", "nothing-is-happening"]
  },
  "nothing-is-happening": {
    id: "nothing-is-happening",
    title: "Nothing is being discovered",
    summary: "Work through these in order; one of them is almost always the reason.",
    blocks: [
      { kind: "steps", items: [
        "No strategy is approved yet — a project does nothing until one is active.",
        "Research is paused — check the status pill in the project header.",
        "Discovery is switched off — the queue controls have a separate discovery toggle.",
        "The queue is already full — discovery waits for workers to drain it below the queue maximum.",
        "The company target has been reached — discovery stops permanently for that campaign.",
        "No research provider is configured — without search access, discovery has nothing to search with."
      ] },
      { kind: "note", text: "The last two are the quiet ones: both look identical to an idle queue. Compare the company target against how many companies the project has already collected, then check provider status in Settings." }
    ],
    related: ["research-queue", "model-routing", "what-runs-automatically"]
  }
};

/**
 * Translations may cover any subset of articles. Missing ones fall back to
 * English, so a partially translated locale is a degraded experience rather
 * than a broken one.
 */
/**
 * The research workspace itself is not localized — its tabs and buttons render
 * in English regardless of locale. Where an article tells the reader which
 * control to use, the English label follows in parentheses so it can actually
 * be found on screen.
 */
const korean: Partial<Record<HelpArticleId, Partial<HelpArticle>>> = {
  overview: {
    title: "이 프로그램의 역할",
    summary: "연구 전략을 의사결정에 바로 쓸 수 있는 기업 조사서로 바꾸는 하나의 연속 루프입니다.",
    blocks: [
      { kind: "text", text: "MTI OS는 기업 조사를 연속적으로 수행합니다. 어떤 기업을 왜 찾고 싶은지 설명하면 시스템이 조건에 맞는 기업을 발굴하고, 정해진 형식에 따라 각 기업을 조사한 뒤, 자격을 충족한 기업마다 출처가 표기된 조사서와 데이터베이스 행을 만들어 전달합니다." },
      { kind: "text", text: "사람이 내리는 결정은 전략을 승인하는 것과 결과를 판정하는 것 두 가지입니다. 그 사이의 모든 과정은 자동으로 진행됩니다." },
      { kind: "steps", items: [
        "목표를 정하고 연구 전략을 승인합니다.",
        "탐색이 전략에 맞는 기업을 승인된 목표치까지 발굴합니다.",
        "조사서 작업자가 각 기업을 조사해 출처가 표기된 마스터 문서를 작성합니다.",
        "각 조사서를 승인(Approve), 반려(Return), 거절(Deny) 중 하나로 판정합니다."
      ] },
      { kind: "note", text: "에이전트가 만든 결과는 사용자가 판정하기 전까지 확정되지 않습니다. 조사서를 반려해도 삭제되지 않고 추가 조사를 위해 되돌아갑니다." }
    ]
  },
  "how-it-connects": {
    title: "각 기능의 연결 구조",
    summary: "프로젝트, 전략, 대기열, 조사서, 고객 데이터베이스는 별개의 도구가 아니라 하나의 흐름입니다.",
    blocks: [
      { kind: "text", text: "제품의 모든 기능은 프로젝트에 연결되어 있습니다. 아래 다이어그램을 위에서 아래로 읽으면 한 곳의 변경이 왜 다른 곳에 나타나는지 가장 빠르게 이해할 수 있습니다." },
      { kind: "map" },
      { kind: "text", text: "프로젝트가 출발점입니다. 프로젝트마다 활성 전략 하나와 고객 데이터베이스 하나가 있습니다. 전략은 탐색을 통제하며, 승인된 이후 작성되는 모든 조사서의 기준이 됩니다." },
      { kind: "text", text: "조사가 끝난 기업은 동시에 두 곳에 남습니다. 문서(Documents)의 마스터 조사서, 그리고 해당 프로젝트 고객 데이터베이스의 행입니다. 둘은 같은 기업의 서로 다른 표현이며, 데이터베이스 행은 구조화된 필드를 저장하면서 조사서 문서로 직접 연결됩니다." },
      { kind: "note", text: "그래서 조사서를 삭제하거나 교체하면 고객 데이터베이스 화면에도 영향이 있고, 고객 데이터베이스에는 기업을 직접 추가하는 기능이 없습니다. 행은 연구를 통해 만들어집니다." },
      { kind: "text", text: "설정(Settings)은 이 흐름 밖에 있지만 전체를 구동합니다. 모델 라우팅이 각 작업을 맡을 모델을 정하고, 연구 제공자 계정이 작업자에게 필요한 검색과 공식 등록부 접근 권한을 공급합니다." }
    ]
  },
  "starting-a-project": {
    title: "연구 프로젝트 시작하기",
    summary: "프로젝트를 만들고 전략가와 논의한 뒤 전략을 승인하면 연구가 시작됩니다.",
    blocks: [
      { kind: "steps", items: [
        "찾고자 하는 대상과 그 기업이 가치 있는 이유를 명확히 담아 프로젝트를 만듭니다.",
        "전략(Strategy) 탭에서 원하는 바를 전략가에게 설명하면 완성된 전략 버전을 제안합니다.",
        "제안을 검토하고 같은 대화에서 수정을 요청한 뒤 승인합니다.",
        "전략이 활성화되면 탐색과 조사서 작업이 자동으로 시작됩니다."
      ] },
      { kind: "note", text: "전략이 승인되기 전까지 프로젝트는 아무 작업도 하지 않습니다. 새 프로젝트가 멈춰 있어 보인다면 대부분 이것이 원인입니다." },
      { kind: "text", text: "승인 시 프로젝트의 고객 데이터베이스와 연속 캠페인도 함께 생성됩니다. 따로 만들 필요가 없습니다." }
    ]
  },
  strategy: {
    title: "전략과 버전 고정",
    summary: "활성 전략이 탐색 대상과 증거 범위, 모든 조사서의 구성을 정의합니다.",
    blocks: [
      { kind: "text", text: "전략 버전은 승인되면 변경할 수 없습니다. 수정을 요청하면 기존 버전을 고치는 대신 새 버전이 만들어지므로, 특정 조사서가 어떤 기준으로 작성되었는지 언제든 확인할 수 있습니다." },
      { kind: "text", text: "일상적으로 가장 중요한 항목은 다음과 같습니다." },
      { kind: "steps", items: [
        "지역, 산업, 대상 프로필 — 탐색이 찾을 기업의 조건입니다.",
        "자격 기준 — 조사서를 작성할 만한 기업인지 판단하는 규칙입니다.",
        "증거 범위 — 각 조사서가 사용할 수 있는 공식 등록부와 출처입니다.",
        "조사서 연구 설계 — 모든 조사서가 포함해야 할 섹션과 각 섹션에 필요한 증거입니다.",
        "기업 목표치 — 이 캠페인이 수집할 자격 충족 기업의 총 수이며, 도달하면 탐색이 멈춥니다."
      ] },
      { kind: "note", text: "이미 진행 중인 조사서는 시작 당시의 전략 버전을 그대로 유지합니다. 새 전략 승인은 다음 배치부터 적용되며 이미 착수된 작업에는 영향을 주지 않습니다." }
    ]
  },
  "research-queue": {
    title: "연구 대기열",
    summary: "대기열 상한과 기업 목표치는 서로 다른 제한입니다. 이 둘을 혼동하는 데서 대부분의 혼란이 생깁니다.",
    blocks: [
      { kind: "text", text: "대기열에는 조사서 작성을 기다리는 기업이 들어 있습니다. 대기열이 얼마나 빨리 소진되는지와 얼마나 많이 쌓이는지를 사용자가 조절합니다." },
      { kind: "steps", items: [
        "조사서 작업자(Dossier workers) — 동시에 조사할 기업 수입니다.",
        "대기열 상한(Queue maximum) — 대기 상태로 둘 수 있는 기업 수입니다. 자동 모드에서는 작업자 수의 3배로 유지됩니다.",
        "우선순위와 보류(Hold) — 순서를 바꾸거나, 기업을 제거하지 않고 잠시 멈춥니다."
      ] },
      { kind: "note", text: "대기열 상한은 목표가 아니라 속도 조절 장치입니다. 탐색이 조사보다 지나치게 앞서가지 않도록 막습니다. 캠페인의 실제 총량은 전략의 기업 목표치이며, 목표치에 도달하면 탐색은 영구적으로 중단됩니다." },
      { kind: "text", text: "자동 모드에서 작업자 수를 바꾸면 대기열 상한이 다시 계산됩니다. 상한을 직접 조정하면 해당 프로젝트는 수동 설정으로 전환되고, Auto 3× 버튼을 누르기 전까지 작업자 수를 바꿔도 그 값이 유지됩니다." }
    ]
  },
  "reviewing-dossiers": {
    title: "조사서 검토와 판정",
    summary: "승인, 반려, 거절 중 하나를 선택합니다. 반려는 추가 조사를 요청하고, 거절은 해당 기업을 제외합니다.",
    blocks: [
      { kind: "text", text: "완료된 조사서는 조사서(Dossiers) 탭에 목록 또는 문서 카드 형태로 표시됩니다. 행이나 카드를 클릭하면 선택되고, 제목이나 카드의 링크를 열면 전체 문서를 편집할 수 있는 화면으로 이동합니다." },
      { kind: "steps", items: [
        "승인(Approve) — 기업과 조사서를 확정합니다.",
        "반려(Return) — 개정을 위해 되돌립니다. 피드백 패널에 부족한 내용을 적어 주세요.",
        "거절(Deny) — 해당 기업을 제외하고 검토 목록에서 내립니다."
      ] },
      { kind: "text", text: "피드백과 재작업은 기본 연구와 별도의 대기열에서 처리됩니다. 개정을 요청해도 새 기업을 맡고 있는 조사서 작업자를 빼앗지 않습니다." },
      { kind: "note", text: "에이전트 재작업은 새 문서 버전을 제안할 뿐 기존 내용을 덮어쓰지 않습니다. 제안된 버전은 사용자가 명시적으로 수락해야 반영됩니다." }
    ]
  },
  documents: {
    title: "문서와 버전",
    summary: "조사서도 일반 문서이며, 저장할 때마다 변경할 수 없는 버전이 생성됩니다.",
    blocks: [
      { kind: "text", text: "마스터 조사서는 다른 파일과 마찬가지로 문서(Documents)에 저장되며 직접 편집할 수 있습니다. 저장할 때마다 변경할 수 없는 새 버전이 만들어지므로 이전 상태가 사라지지 않습니다." },
      { kind: "text", text: "에이전트 개정안은 교체가 아니라 제안된 버전으로 도착합니다. 에이전트가 작업을 시작한 뒤 문서를 직접 수정했다면 제안을 수락할 때 최신 편집 내용과 대조되므로, 사용자의 수정이 조용히 사라지지 않습니다." },
      { kind: "note", text: "연구로 생성된 문서는 해당 기업과 계속 연결되어 있습니다. 이 연결이 고객 데이터베이스의 해당 행에 조사서를 표시하는 근거입니다." }
    ]
  },
  "client-databases": {
    title: "고객 데이터베이스",
    summary: "프로젝트당 하나씩 생성되고 연구로 채워지며, 각 행이 해당 조사서와 연결됩니다.",
    blocks: [
      { kind: "text", text: "연구 프로젝트마다 고객 데이터베이스가 정확히 하나씩 생성되며, 첫 전략을 승인할 때 만들어집니다. 해당 프로젝트가 조사한 모든 내용을 구조화해 보여 주는 화면입니다." },
      { kind: "text", text: "행은 직접 입력하는 것이 아니라 연구를 통해 만들어집니다. 조사서가 발행되면 그 기업이 하나의 행이 되고, 자격 점수·판정·연구 상태 같은 구조화된 필드와 조사서 문서로 향하는 직접 링크를 함께 가집니다." },
      { kind: "note", text: "이 링크가 문서와 고객 데이터베이스를 잇는 연결 고리입니다. 조사서가 서술형 기록이라면, 행은 정렬·필터·내보내기가 가능한 데이터 형태의 같은 기업입니다." }
    ]
  },
  "model-routing": {
    title: "모델 라우팅과 연구 제공자",
    summary: "각 작업을 맡을 모델과 연구 작업자가 사용할 API 계정을 설정합니다.",
    blocks: [
      { kind: "text", text: "기업 조사, 조사서 작성, 편집, 추출처럼 작업 종류마다 고유한 모델 정책을 가진 경로가 있습니다." },
      { kind: "steps", items: [
        "자동(Auto) — 각 작업마다 사용 가능한 모델을 평가해 건별로 선택합니다.",
        "수동(Manual) — 해당 작업의 모든 태스크에 한 모델을 고정합니다."
      ] },
      { kind: "text", text: "연구 제공자 계정은 작업자가 사용하는 검색과 공식 등록부 접근 권한을 관리합니다. 실제 키 값은 배포 환경 변수에 보관되며, 여기에 등록하는 계정은 어떤 환경 변수를 읽을지 지정하고 사용량과 상태를 추적할 뿐입니다." },
      { kind: "note", text: "계정을 등록한다고 해서 키가 공급되는 것은 아닙니다. 지정한 환경 변수가 없으면 제공자는 여전히 미설정 상태로 표시됩니다." }
    ]
  },
  "what-runs-automatically": {
    title: "자동으로 실행되는 작업과 확인이 필요한 작업",
    summary: "네 가지 결정만 사람이 하고, 나머지는 계속 실행됩니다.",
    blocks: [
      { kind: "text", text: "다음 네 가지는 사람의 결정을 기다립니다." },
      { kind: "steps", items: [
        "전략 버전 승인",
        "완료된 조사서 판정",
        "개정 요청",
        "연구 일시 중지 및 재개"
      ] },
      { kind: "text", text: "다음은 사용자가 없어도 계속 실행됩니다. 탐색, 대기열 관리, 조사서 조사와 발행, 고객 데이터베이스 행 생성, 그리고 장애나 배포 이후 중단된 작업의 재시작입니다." },
      { kind: "note", text: "연구는 계속 실행되므로, 비용을 멈추려면 페이지를 닫는 것이 아니라 일시 중지를 사용해야 합니다." }
    ]
  },
  "nothing-is-happening": {
    title: "탐색이 진행되지 않을 때",
    summary: "아래 순서대로 확인하면 대부분 원인을 찾을 수 있습니다.",
    blocks: [
      { kind: "steps", items: [
        "아직 승인된 전략이 없습니다. 활성 전략이 없으면 프로젝트는 아무 작업도 하지 않습니다.",
        "연구가 일시 중지되었습니다. 프로젝트 헤더의 상태 표시를 확인하세요.",
        "탐색이 꺼져 있습니다. 대기열 제어 영역에 별도의 탐색 토글이 있습니다.",
        "대기열이 이미 가득 찼습니다. 작업자가 대기열을 상한 아래로 줄일 때까지 탐색이 기다립니다.",
        "기업 목표치에 도달했습니다. 해당 캠페인의 탐색은 영구적으로 중단됩니다.",
        "연구 제공자가 설정되지 않았습니다. 검색 권한이 없으면 탐색이 사용할 수단이 없습니다."
      ] },
      { kind: "note", text: "마지막 두 가지는 겉으로 드러나지 않습니다. 둘 다 대기열이 비어 있는 것과 똑같이 보입니다. 기업 목표치와 이미 수집된 기업 수를 비교한 뒤, 설정에서 제공자 상태를 확인하세요." }
    ]
  }
};

const translations: Partial<Record<Locale, Partial<Record<HelpArticleId, Partial<HelpArticle>>>>> = { ko: korean };

export function helpArticles(locale: Locale): HelpArticle[] {
  return helpArticleOrder.map((id) => helpArticle(id, locale));
}

export function helpArticle(id: HelpArticleId, locale: Locale): HelpArticle {
  const base = english[id];
  const override = translations[locale]?.[id];
  return override ? { ...base, ...override } : base;
}

export function isHelpArticleId(value: string | null | undefined): value is HelpArticleId {
  return typeof value === "string" && (helpArticleOrder as readonly string[]).includes(value);
}

export { english as englishHelpArticles, translations as helpTranslations };
