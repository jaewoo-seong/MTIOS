"use client";

import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";

export type Locale = "en" | "ko";
export type RegionalPreferences = {
  locale: Locale;
  timezone: string;
  dateFormat: "short" | "medium" | "long";
  numberFormat: "locale";
  currency: "USD" | "KRW";
};

const defaults: RegionalPreferences = {
  locale: "en",
  timezone: "America/Indiana/Indianapolis",
  dateFormat: "medium",
  numberFormat: "locale",
  currency: "USD"
};

const ko: Record<string, string> = {
  "Executive Agent": "총괄 에이전트",
  "Projects": "프로젝트",
  "Documents": "문서",
  "Client & Data": "고객 및 데이터",
  "Knowledge Base": "지식 베이스",
  "Settings": "설정",
  "Project Command Center": "프로젝트 커맨드 센터",
  "Portfolio, knowledge, client data, decisions, and instructions": "포트폴리오, 지식, 고객 데이터, 결정 및 지시",
  "Long-lived context, agendas, execution, and outputs": "장기 맥락, 안건, 실행 및 결과물",
  "Working project outputs and saved reports": "작업 중인 프로젝트 결과물 및 저장된 보고서",
  "Configurable databases, records, imports, and enrichment": "구성 가능한 데이터베이스, 레코드, 가져오기 및 보강",
  "Approved organizational memory with provenance": "출처가 있는 승인된 조직 메모리",
  "Give the Executive Agent an instruction across projects, data, knowledge, or decisions.": "프로젝트, 데이터, 지식 또는 결정 전반에 대한 지시를 총괄 에이전트에 입력하세요.",
  "Add a project agenda, change scope, run the next batch, or request an output.": "프로젝트 안건 추가, 범위 변경, 다음 배치 실행 또는 결과물을 요청하세요.",
  "Draft, revise, save, export, or share a document.": "문서를 작성, 수정, 저장, 내보내기 또는 공유하세요.",
  "Enrich records, validate sources, create a view, or link data to a project.": "레코드 보강, 출처 검증, 보기 생성 또는 프로젝트에 데이터를 연결하세요.",
  "Propose memory, review findings, or link a project decision.": "메모리를 제안하거나 결과를 검토하거나 프로젝트 결정을 연결하세요.",
  "Adjust agent policy, model routing, tool access, or review gates.": "에이전트 정책, 모델 라우팅, 도구 접근 또는 검토 단계를 조정하세요.",
  "Delegate work": "작업 위임",
  "Review decisions": "결정 검토",
  "Summarize portfolio": "포트폴리오 요약",
  "Add agenda": "안건 추가",
  "Run next batch": "다음 배치 실행",
  "Change scope": "범위 변경",
  "Review plan": "계획 검토",
  "Draft report": "보고서 초안",
  "Save report": "보고서 저장",
  "Export": "내보내기",
  "Create database": "데이터베이스 만들기",
  "Import CSV": "CSV 가져오기",
  "Validate records": "레코드 검증",
  "Propose memory": "메모리 제안",
  "Review updates": "업데이트 검토",
  "Link decision": "결정 연결",
  "Adjust policy": "정책 조정",
  "Review access": "접근 검토",
  "Run audit": "감사 실행",
  "Clarify before execution": "실행 전 확인",
  "Adjust instruction": "지시 수정",
  "Agenda work type": "안건 작업 유형",
  "Sending instruction": "지시 전송 중",
  "needs you": "확인 필요",
  "active": "활성",
  "paused": "일시 중지",
  "completed": "완료",
  "archived": "보관",
  "queued": "대기",
  "working": "작업 중",
  "blocked": "차단됨",
  "review": "검토",
  "custom": "사용자 지정",
  "research": "리서치",
  "marketing": "마케팅",
  "brainstorming": "브레인스토밍",
  "content": "콘텐츠",
  "data enrichment": "데이터 보강",
  "document": "문서",
  "communication": "커뮤니케이션",
  "analysis": "분석",
  "operations": "운영",
  "No files attached. Open a document and set its project to ground the agent in real BOMs and quotations.": "연결된 파일이 없습니다. 문서를 열고 프로젝트를 지정하여 실제 BOM 및 견적을 에이전트 맥락에 포함하세요.",
  "{count} attached": "{count}개 연결됨",
  "{count} words": "{count}단어",
  "Loading…": "불러오는 중…",
  "No MCP tools available.": "사용 가능한 MCP 도구가 없습니다.",
  "Search": "검색",
  "Create project": "프로젝트 만들기",
  "Single workspace": "단일 워크스페이스",
  "Business Operating System": "비즈니스 운영 시스템",
  "Loading workspace": "워크스페이스 불러오는 중",
  "Loading documents": "문서 불러오는 중",
  "Loading knowledge base": "지식 베이스 불러오는 중",
  "Loading client data": "고객 데이터 불러오는 중",
  "Loading files…": "파일 불러오는 중…",
  "Loading preferences…": "환경설정 불러오는 중…",
  "Loading model routes…": "모델 경로 불러오는 중…",
  "Request failed": "요청에 실패했습니다",
  "Command failed": "명령에 실패했습니다",
  "Confirmation failed": "확인에 실패했습니다",
  "Dismiss error": "오류 닫기",
  "Active projects": "활성 프로젝트",
  "Working outputs": "작업 중인 결과물",
  "Saved reports": "저장된 보고서",
  "Archived projects": "보관된 프로젝트",
  "In flight": "진행 중",
  "Drafts in progress": "초안 작업 중",
  "Released": "완료됨",
  "Closed": "종료됨",
  "Start with a project": "프로젝트로 시작",
  "Projects give the Executive Agent durable context, constraints, agendas, and review gates.": "프로젝트는 총괄 에이전트에 지속적인 맥락, 제약조건, 안건 및 검토 단계를 제공합니다.",
  "Portfolio attention": "포트폴리오 주의사항",
  "No blockers or decisions require attention.": "확인이 필요한 차단 요소나 결정이 없습니다.",
  "Agent allocation": "에이전트 배정",
  "No worker runs are active.": "실행 중인 작업자 에이전트가 없습니다.",
  "No projects": "프로젝트 없음",
  "Create a project to establish context, constraints, agendas, and output requirements.": "프로젝트를 만들어 맥락, 제약조건, 안건 및 결과물 요구사항을 설정하세요.",
  "Project command center": "프로젝트 커맨드 센터",
  "Context": "맥락",
  "Scope": "범위",
  "Constraints": "제약조건",
  "Budget": "예산",
  "Review gates": "검토 단계",
  "Output requirements": "결과물 요구사항",
  "Not set": "설정 안 됨",
  "Agenda lifecycle": "안건 진행 상황",
  "No agendas yet. Use Executive Command to add the first instruction.": "아직 안건이 없습니다. 총괄 명령으로 첫 지시를 추가하세요.",
  "Milestones": "마일스톤",
  "Decisions, assumptions, and questions": "결정, 가정 및 질문",
  "Deliverables": "결과물",
  "Nothing recorded yet.": "아직 기록이 없습니다.",
  "Project files": "프로젝트 파일",
  "Workspace governance, models, tools, and approval policy": "워크스페이스 거버넌스, 모델, 도구 및 승인 정책",
  "Language & regional": "언어 및 지역",
  "Interface language": "인터페이스 언어",
  "Timezone": "시간대",
  "Date format": "날짜 형식",
  "Currency": "통화",
  "Short": "짧게",
  "Medium": "보통",
  "Long": "길게",
  "Save preferences": "환경설정 저장",
  "Model routing": "모델 라우팅",
  "Stage revision": "개정안 만들기",
  "Test": "테스트",
  "Approve": "승인",
  "Activate": "활성화",
  "Rollback": "되돌리기",
  "Last successful model": "마지막 성공 모델",
  "MCP tools": "MCP 도구",
  "allowed": "허용됨",
  "Review policy": "검토 정책",
  "External sends": "외부 전송",
  "Destructive writes": "파괴적 쓰기",
  "High-cost actions": "고비용 작업",
  "Approval required": "승인 필요",
  "Gmail": "Gmail",
  "Read selected threads and create drafts": "선택한 스레드를 읽고 초안 생성",
  "Connect": "연결",
  "Disconnect": "연결 해제",
  "No Gmail account connected.": "연결된 Gmail 계정이 없습니다.",
  "Sending and mailbox deletion are unavailable.": "메일 전송 및 사서함 삭제는 사용할 수 없습니다.",
  "New project": "새 프로젝트",
  "Create durable project context": "지속 가능한 프로젝트 맥락 만들기",
  "Project name": "프로젝트 이름",
  "Output language": "결과물 언어",
  "Objective": "목표",
  "One per line": "한 줄에 하나",
  "required": "필수",
  "Optional": "선택 사항",
  "Cancel": "취소",
  "Close dialog": "대화상자 닫기",
  "Executive Command": "총괄 명령",
  "Send instruction": "지시 보내기",
  "Confirm and execute": "확인 후 실행",
  "Adjust": "수정",
  "Select a project before adding an instruction.": "지시를 추가하기 전에 프로젝트를 선택하세요.",
  "Search workspace": "워크스페이스 검색",
  "Search query": "검색어",
  "Search results": "검색 결과",
  "Search projects, documents, agendas, knowledge…": "프로젝트, 문서, 안건, 지식 검색…",
  "Type at least two characters.": "두 글자 이상 입력하세요.",
  "Searching…": "검색 중…",
  "No client databases": "고객 데이터베이스 없음",
  "Create a database. Record changes enter through approved project proposals.": "데이터베이스를 만드세요. 레코드 변경은 승인된 프로젝트 제안을 통해 반영됩니다.",
  "Create client database": "고객 데이터베이스 만들기",
  "Database name": "데이터베이스 이름",
  "Databases": "데이터베이스",
  "Records": "레코드",
  "Changes require project approval": "변경에는 프로젝트 승인이 필요합니다",
  "No records yet": "아직 레코드가 없습니다",
  "Approve a client-data proposal from a project workspace to add records.": "레코드를 추가하려면 프로젝트 워크스페이스에서 고객 데이터 제안을 승인하세요.",
  "Client-data proposals": "고객 데이터 제안",
  "Review exact values before any database write": "데이터베이스에 쓰기 전에 정확한 값을 검토하세요",
  "Current": "현재",
  "Edit proposed values": "제안 값 편집",
  "None": "없음",
  "Delete entry": "항목 삭제",
  "Proposed": "제안됨",
  "Approved": "승인됨",
  "Rejected": "거부됨",
  "All": "전체",
  "Nothing awaiting review": "검토 대기 항목 없음",
  "No entries here": "여기에 항목이 없습니다",
  "New memory": "새 메모리",
  "Propose an entry": "항목 제안",
  "Entries enter as proposed and only become established fact once approved.": "항목은 제안 상태로 등록되며 승인된 후에만 확정된 사실이 됩니다.",
  "Collection": "컬렉션",
  "Title": "제목",
  "Content": "내용",
  "Source": "출처",
  "Save": "저장",
  "Folders": "폴더",
  "Create folder": "폴더 만들기",
  "Folder name": "폴더 이름",
  "No folders": "폴더 없음",
  "Documents live inside folders. Create one to start importing files.": "문서는 폴더 안에 저장됩니다. 파일 가져오기를 시작하려면 폴더를 만드세요.",
  "Import": "가져오기",
  "Drop files here to import": "가져올 파일을 여기에 놓으세요",
  "PDF, DOCX, HTML, CSV, TSV, JSON, Markdown, and text files are converted to readable markdown.": "PDF, DOCX, HTML, CSV, TSV, JSON, Markdown 및 텍스트 파일을 편집 가능한 문서로 변환합니다.",
  "Unknown project": "알 수 없는 프로젝트",
  "Not attached": "연결 안 됨",
  "Document view": "문서 보기",
  "Edited": "편집본",
  "Original": "원본",
  "Saving": "저장 중",
  "Close document": "문서 닫기",
  "Repair with AI": "AI로 복구",
  "Approve extraction": "추출 승인",
  "Retry conversion": "변환 재시도",
  "Delete document": "문서 삭제",
  "Preparing editor…": "편집기 준비 중…",
  "Start writing…": "작성 시작…",
  "Formatting": "서식",
  "Undo": "실행 취소",
  "Redo": "다시 실행",
  "Paragraph style": "문단 스타일",
  "Body text": "본문",
  "Bold": "굵게",
  "Italic": "기울임",
  "Underline": "밑줄",
  "Strikethrough": "취소선",
  "Inline code": "인라인 코드",
  "Bulleted list": "글머리 기호 목록",
  "Numbered list": "번호 목록",
  "Quote": "인용",
  "Divider": "구분선",
  "Link": "링크",
  "Insert table": "표 삽입",
  "Live activity": "실시간 활동",
  "Streaming": "스트리밍 중",
  "Connecting": "연결 중",
  "Disconnected": "연결 끊김",
  "Idle": "대기",
  "Live agent activity": "실시간 에이전트 활동",
  "Connecting to the activity stream…": "활동 스트림에 연결 중…",
  "No agent activity yet. Confirm an instruction to start a run.": "아직 에이전트 활동이 없습니다. 지시를 확인하여 실행을 시작하세요.",
  "Confirm": "확인",
  "Permanent": "영구 작업",
  "Create": "만들기",
  "Approve and apply": "승인 후 적용",
  "Approved memory is what the Executive Agent treats as established fact about MTI. Propose an entry, then approve it to put it into circulation.": "승인된 메모리는 총괄 에이전트가 MTI의 확정된 사실로 사용합니다. 항목을 제안한 뒤 승인하여 활용하세요."
  ,"Choose files": "파일 선택"
  ,"Converting {count} to markdown…": "{count}을 문서로 변환 중…"
  ,"Delete {title}": "{title} 삭제"
  ,"Delete “{title}”?": "“{title}”을 삭제하시겠습니까?"
  ,"Discard unsaved changes to this document?": "이 문서의 저장되지 않은 변경사항을 버리시겠습니까?"
  ,"Done": "완료"
  ,"Download original": "원본 다운로드"
  ,"Edit": "편집"
  ,"Export {title} as markdown": "{title}을 Markdown으로 내보내기"
  ,"Folder": "폴더"
  ,"Heading 1": "제목 1"
  ,"Heading 2": "제목 2"
  ,"Heading 3": "제목 3"
  ,"Heading 4": "제목 4"
  ,"Invalid JSON.": "유효하지 않은 JSON입니다."
  ,"Korean medical device manufacturers": "한국 의료기기 제조사"
  ,"Link URL": "링크 URL"
  ,"More research": "추가 조사"
  ,"No matches for “{query}”.": "“{query}”에 대한 결과가 없습니다."
  ,"Original {title}": "{title} 원본"
  ,"Project": "프로젝트"
  ,"Propose entry": "항목 제안"
  ,"Quotations": "견적서"
  ,"Record JSON": "레코드 JSON"
  ,"Reject": "거부"
  ,"Roll back": "되돌리기"
  ,"Save revision": "개정안 저장"
  ,"Select {operation} proposal": "{operation} 제안 선택"
  ,"This removes the entry from organizational memory. This cannot be undone.": "이 항목은 조직 메모리에서 삭제되며 되돌릴 수 없습니다."
  ,"Unsaved changes": "저장되지 않은 변경사항"
  ,"Use a JSON object with string values.": "문자열 값을 가진 JSON 객체를 사용하세요."
  ,"Use an http(s), mailto, or relative link.": "http(s), mailto 또는 상대 링크를 사용하세요."
  ,"esc close": "esc 닫기"
  ,"{filename} and its converted text will be removed permanently. This cannot be undone.": "{filename} 및 변환된 텍스트가 영구 삭제되며 되돌릴 수 없습니다."
  ,"{percent}% confidence": "신뢰도 {percent}%"
  ,"↑↓ navigate": "↑↓ 이동"
  ,"↵ open": "↵ 열기"
  ,"insert": "추가"
  ,"update": "수정"
  ,"delete": "삭제"
  ,"merge": "병합"
  ,"review required": "검토 필요"
  ,"applied": "적용됨"
  ,"conflict": "충돌"
  ,"rolled back": "되돌림"
  ,"Agendas": "안건"
  ,"Knowledge": "지식"
  ,"Client data": "고객 데이터"
  ,"Inbox": "받은 파일"
  ,"Reports": "보고서"
  ,"Reference": "참고자료"
  ,"English": "영어"
  ,"English + Korean": "영어 + 한국어"
  ,"Could not approve this document revision.": "이 문서 개정안을 승인할 수 없습니다."
  ,"Could not attach the document to that project.": "문서를 해당 프로젝트에 연결할 수 없습니다."
  ,"Could not create the database.": "데이터베이스를 만들 수 없습니다."
  ,"Could not create the folder.": "폴더를 만들 수 없습니다."
  ,"Could not delete the document.": "문서를 삭제할 수 없습니다."
  ,"Could not delete the entry.": "항목을 삭제할 수 없습니다."
  ,"Could not load Gmail connections.": "Gmail 연결을 불러올 수 없습니다."
  ,"Could not load client databases.": "고객 데이터베이스를 불러올 수 없습니다."
  ,"Could not load client-data proposals.": "고객 데이터 제안을 불러올 수 없습니다."
  ,"Could not load conversion detail.": "변환 세부정보를 불러올 수 없습니다."
  ,"Could not load documents.": "문서를 불러올 수 없습니다."
  ,"Could not load records.": "레코드를 불러올 수 없습니다."
  ,"Could not load the knowledge base.": "지식 베이스를 불러올 수 없습니다."
  ,"Could not move the document.": "문서를 이동할 수 없습니다."
  ,"Could not open the document.": "문서를 열 수 없습니다."
  ,"Could not save the document.": "문서를 저장할 수 없습니다."
  ,"Could not save the entry.": "항목을 저장할 수 없습니다."
  ,"Could not update the entry.": "항목을 업데이트할 수 없습니다."
  ,"Could not import {filename}.": "{filename}을 가져올 수 없습니다."
  ,"Cost limit": "비용 한도"
  ,"Structured output": "구조화 출력"
  ,"Planning and clarification": "계획 및 명확화"
  ,"Quality and decision review": "품질 및 의사결정 검토"
  ,"Sourced research": "출처 기반 조사"
  ,"Creative ideation": "창의적 아이디어 구상"
  ,"Long-form writing": "장문 작성"
  ,"Editing": "편집"
  ,"Structured extraction": "구조화 추출"
  ,"English and Korean translation": "영어 및 한국어 번역"
  ,"Fast classification": "빠른 분류"
  ,"Multilingual embeddings": "다국어 임베딩"
  ,"Multilingual reranking": "다국어 재정렬"
  ,"limit": "한도"
  ,"test": "테스트"
  ,"not_tested": "테스트 안 됨"
  ,"passed": "통과"
  ,"failed": "실패"
  ,"draft": "초안"
  ,"approved": "승인됨"
  ,"superseded": "대체됨"
  ,"rolled_back": "되돌림"
  ,"production-approved": "프로덕션 승인"
  ,"review-required": "검토 필요"
  ,"healthy": "정상"
  ,"unhealthy": "비정상"
  ,"unknown": "알 수 없음"
  ,"low": "낮음"
  ,"medium": "중간"
  ,"high": "높음"
  ,"none": "없음"
  ,"always": "항상"
  ,"conditional": "조건부"
  ,"connected": "연결됨"
  ,"revoked": "취소됨"
  ,"Gmail read and compose": "Gmail 읽기 및 초안 작성"
};

export function translate(
  locale: Locale,
  text: string,
  values: Record<string, string | number> = {}
) {
  let translated = locale === "ko" ? (ko[text] ?? text) : text;
  for (const [key, replacement] of Object.entries(values)) {
    translated = translated.replaceAll(`{${key}}`, String(replacement));
  }
  return translated;
}

export function hasKoreanTranslation(text: string) {
  return Object.hasOwn(ko, text);
}

type I18nValue = {
  preferences: RegionalPreferences;
  setPreferences: (value: RegionalPreferences) => void;
  t: (text: string, values?: Record<string, string | number>) => string;
  formatDate: (value: string | Date) => string;
  formatNumber: (value: number) => string;
  formatCurrency: (minorUnits: number, currency?: "USD" | "KRW") => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState(defaults);

  useEffect(() => {
    fetch("/api/v1/settings/preferences")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: { data?: RegionalPreferences }) => {
        if (payload.data) setPreferences(payload.data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.lang = preferences.locale;
  }, [preferences.locale]);

  const value = useMemo<I18nValue>(() => {
    const localeTag = preferences.locale === "ko" ? "ko-KR" : "en-US";
    const t = (text: string, values: Record<string, string | number> = {}) =>
      translate(preferences.locale, text, values);
    return {
      preferences,
      setPreferences,
      t,
      formatDate: (input) => new Intl.DateTimeFormat(localeTag, {
        dateStyle: preferences.dateFormat,
        timeZone: preferences.timezone
      }).format(new Date(input)),
      formatNumber: (input) => new Intl.NumberFormat(localeTag).format(input),
      formatCurrency: (minorUnits, currency = preferences.currency) => new Intl.NumberFormat(localeTag, {
        style: "currency",
        currency,
        maximumFractionDigits: currency === "KRW" ? 0 : 2
      }).format(currency === "KRW" ? minorUnits : minorUnits / 100)
    };
  }, [preferences]);

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider.");
  return value;
}
