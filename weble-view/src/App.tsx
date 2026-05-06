import React, { useEffect, useMemo, useRef, useState } from "react";
import FullCalendarOriginal from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import koLocale from "@fullcalendar/core/locales/ko";
import { Campaign, fetchAllCampaignPages } from "./api/weble";

const FullCalendar = FullCalendarOriginal as unknown as React.ComponentType<
  Record<string, unknown>
>;

type Status = "idle" | "loading" | "done" | "error";
type ActiveSelect = "__ALL__" | "true" | "false";

function safeString(v: unknown) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function categoryToText(category: unknown) {
  if (Array.isArray(category)) return category.map((c) => safeString(c)).filter(Boolean).join(", ");
  return safeString(category);
}

const CATEGORY_CHILDREN_ORDER = [
  "가공식품",
  "가전",
  "건강식품",
  "과자음료",
  "도서",
  "디지털",
  "메이크업",
  "모바일",
  "모바일앱",
  "바디",
  "배송형",
  "생활용품",
  "스마트기기",
  "스킨케어",
  "스포츠",
  "신발",
  "애완용품",
  "여성의류",
  "여행용품",
  "웹서비스",
  "유아동도서",
  "유아동용품",
  "육아용품",
  "음향기기",
  "이미용가전",
  "인테리어",
  "잡화",
  "주방용품",
  "지역_기타",
  "헤어",
  "PC주변기기"
] as const;

type CategoryChild = (typeof CATEGORY_CHILDREN_ORDER)[number];

const CATEGORY_PARENT_ORDER = [
  "식품",
  "가전·디지털",
  "뷰티",
  "패션",
  "리빙·인테리어",
  "유아·육아",
  "반려",
  "스포츠·여행",
  "서비스·기타"
] as const;

type CategoryParent = (typeof CATEGORY_PARENT_ORDER)[number];

function categoryParentOf(child: string): CategoryParent {
  switch (child) {
    case "가공식품":
    case "건강식품":
    case "과자음료":
      return "식품";
    case "가전":
    case "디지털":
    case "스마트기기":
    case "모바일":
    case "모바일앱":
    case "음향기기":
    case "이미용가전":
    case "PC주변기기":
      return "가전·디지털";
    case "메이크업":
    case "스킨케어":
    case "헤어":
    case "바디":
      return "뷰티";
    case "여성의류":
    case "신발":
    case "잡화":
      return "패션";
    case "생활용품":
    case "주방용품":
    case "인테리어":
      return "리빙·인테리어";
    case "유아동도서":
    case "유아동용품":
    case "육아용품":
      return "유아·육아";
    case "애완용품":
      return "반려";
    case "스포츠":
    case "여행용품":
      return "스포츠·여행";
    case "도서":
    case "웹서비스":
    case "배송형":
    case "지역_기타":
    default:
      return "서비스·기타";
  }
}

function normalizeCategoryValue(category: unknown) {
  // 목록 API의 category가 배열/문자열 모두 올 수 있음. 여기서는 "하위 항목(leaf)"만 뽑는다.
  if (Array.isArray(category)) {
    // 배열이면 마지막 값을 leaf로 취급 (예: ["생활용품", "주방용품"] -> "주방용품")
    for (let i = category.length - 1; i >= 0; i -= 1) {
      const v = safeString(category[i]).trim();
      if (v) return v;
    }
    return "";
  }
  return safeString(category).trim();
}

function includesCategory(c: Campaign, q: string) {
  const cat = c.category;
  if (!q) return true;
  const qq = q.toLowerCase();
  if (Array.isArray(cat)) return cat.some((x) => safeString(x).toLowerCase().includes(qq));
  return safeString(cat).toLowerCase().includes(qq);
}

function jsonSearch(c: Campaign, q: string) {
  if (!q) return true;
  const qq = q.toLowerCase();
  try {
    return JSON.stringify(c).toLowerCase().includes(qq);
  } catch {
    return false;
  }
}

function formatScalar(v: unknown) {
  if (v === null) return "null";
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "bigint") return `${v.toString()}n`;
  return String(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function MiniValueView({
  value,
  depth,
  maxDepth,
  path,
  expandAll
}: {
  value: unknown;
  depth: number;
  maxDepth: number;
  path: string;
  expandAll?: boolean;
}) {
  if (depth > maxDepth) return <span className="muted">…</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">[]</span>;
    if (expandAll) {
      return (
        <div style={{ paddingLeft: depth === 0 ? 0 : 12, marginTop: depth === 0 ? 0 : 4 }}>
          {value
            .map((v, i) => ({ v, i }))
            .filter(({ v }) => !shouldHideValue(v))
            .map(({ v, i }) => (
              <div key={`${path}[${i}]`} className="kvRow">
                <div className="key">[{i}]</div>
                <div>
                  <MiniValueView
                    value={v}
                    depth={depth + 1}
                    maxDepth={maxDepth}
                    path={`${path}[${i}]`}
                    expandAll={expandAll}
                  />
                </div>
              </div>
            ))}
        </div>
      );
    }
    return (
      <details>
        <summary className="muted">배열({value.length})</summary>
        <div style={{ paddingLeft: 12, marginTop: 4 }}>
          {value
            .map((v, i) => ({ v, i }))
            .filter(({ v }) => !shouldHideValue(v))
            .slice(0, 30)
            .map(({ v, i }) => (
              <div key={`${path}[${i}]`} className="kvRow">
                <div className="key">[{i}]</div>
                <div>
                  <MiniValueView
                    value={v}
                    depth={depth + 1}
                    maxDepth={maxDepth}
                    path={`${path}[${i}]`}
                    expandAll={expandAll}
                  />
                </div>
              </div>
            ))}
          {value.filter((v) => !shouldHideValue(v)).length > 30 ? (
            <div className="muted">… (처음 30개만 표시)</div>
          ) : null}
        </div>
      </details>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className="muted">{`{}`}</span>;
    if (expandAll) {
      return (
        <div style={{ paddingLeft: depth === 0 ? 0 : 12, marginTop: depth === 0 ? 0 : 4 }}>
          {entries
            .filter(([, v]) => !shouldHideValue(v))
            .map(([k, v]) => (
              <div key={`${path}.${k}`} className="kvRow">
                <div className="key" title={k}>
                  {k}
                </div>
                <div>
                  <MiniValueView
                    value={v}
                    depth={depth + 1}
                    maxDepth={maxDepth}
                    path={`${path}.${k}`}
                    expandAll={expandAll}
                  />
                </div>
              </div>
            ))}
        </div>
      );
    }
    return (
      <details>
        <summary className="muted">객체({entries.length})</summary>
        <div style={{ paddingLeft: 12, marginTop: 4 }}>
          {entries
            .filter(([, v]) => !shouldHideValue(v))
            .slice(0, 80)
            .map(([k, v]) => (
              <div key={`${path}.${k}`} className="kvRow">
                <div className="key" title={k}>
                  {k}
                </div>
                <div>
                  <MiniValueView
                    value={v}
                    depth={depth + 1}
                    maxDepth={maxDepth}
                    path={`${path}.${k}`}
                    expandAll={expandAll}
                  />
                </div>
              </div>
            ))}
          {entries.filter(([, v]) => !shouldHideValue(v)).length > 80 ? (
            <div className="muted">… (처음 80개 키만 표시)</div>
          ) : null}
        </div>
      </details>
    );
  }

  const text = formatScalar(value);
  return (
    <span title={text} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
      {text}
    </span>
  );
}

const KOREAN_HEADERS: Record<string, string> = {
  id: "ID",
  item: "상품명",
  title: "제목",
  brief: "요약",
  media: "매체",
  status: "상태",
  active: "활성",
  type: "유형",
  class: "클래스",
  category: "카테고리",
  label: "라벨",
  localTag: "로컬태그",
  createdAt: "생성일",
  updatedAt: "수정일",
  startedOn: "시작일",
  endedOn: "종료일",
  requestStartedOn: "신청시작",
  requestEndedOn: "신청종료",
  clientPickStartedOn: "선정시작",
  clientPickEndedOn: "선정종료",
  entryAnnouncedOn: "발표일",
  draftStartedOn: "초안시작",
  draftEndedOn: "초안종료",
  postingStartedOn: "포스팅시작",
  postingEndedOn: "포스팅종료",
  resultAnnouncedOn: "결과발표",
  reviewerLimit: "리뷰어수",
  requiredPostCount: "필수포스트수",
  order: "주문",
  orderQuantity: "수량",
  thumbnail: "썸네일",
  contentImage: "콘텐츠이미지",
  isStarred: "즐겨찾기(응답)",
  venue: "장소",
  campaignData: "캠페인데이터",
  campaignOptions: "캠페인옵션",
  campaignStats: "캠페인통계",
  campaignCouponData: "쿠폰데이터",
  campaignCouponOption: "쿠폰옵션"
};

function headerLabelForKey(key: string) {
  if (key === "__starredConfirm") return "즐겨찾기(확인)";
  return KOREAN_HEADERS[key] ?? `필드(${key})`;
}

function headerSubLabelForKey(key: string) {
  if (key === "__starredConfirm") return "starreds-confirm";
  return key;
}

function labelForDetailKey(key: string) {
  // Detail drawer: show Korean label; keep original key as fallback.
  const k = key;
  return KOREAN_HEADERS[k] ?? k;
}

function statusPillClass(status: Status) {
  if (status === "loading") return "pill pill--primary";
  if (status === "done") return "pill pill--success";
  if (status === "error") return "pill pill--danger";
  return "pill";
}

function isLikelyUrl(v: string) {
  return /^https?:\/\//i.test(v);
}

function isNil(v: unknown) {
  return v === null || v === undefined;
}

function isBlankString(v: unknown) {
  return typeof v === "string" && v.trim().length === 0;
}

function shouldHideValue(v: unknown) {
  // Per request: hide null-ish values in UI.
  if (isNil(v) || isBlankString(v)) return true;
  // Also hide zero values (0 or "0") per request.
  if (typeof v === "number" && v === 0) return true;
  if (typeof v === "string" && v.trim() === "0") return true;
  return false;
}

function hasVisibleDescendant(value: unknown, depthLeft = 8): boolean {
  if (depthLeft <= 0) return false;
  if (shouldHideValue(value)) return false;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string" || typeof value === "bigint")
    return true;

  if (Array.isArray(value)) {
    return value.some((v) => hasVisibleDescendant(v, depthLeft - 1));
  }

  if (isPlainObject(value)) {
    return Object.values(value).some((v) => hasVisibleDescendant(v, depthLeft - 1));
  }

  // other primitives (symbol/function) treated as visible stringified
  return true;
}

type ScheduleItem = {
  key: string;
  label: string;
  kind: "range" | "point";
  eventType: "request" | "draft" | "clientPick" | "posting" | "announce" | "result";
  start?: Date;
  end?: Date;
  date?: Date;
};

function parseYmd(input: string) {
  const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatYmd(dt: Date) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysUtc(dt: Date, days: number) {
  return new Date(dt.getTime() + days * 86400000);
}

function startOfMonthUtc(dt: Date) {
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
}

function endOfMonthUtc(dt: Date) {
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
}

function CampaignSchedule({ campaign }: { campaign: Record<string, unknown> }) {
  const getDate = (key: string) => {
    const raw = safeString(campaign[key]);
    if (!raw) return null;
    return parseYmd(raw);
  };

  const phases: Array<{ key: string; label: string; startKey: string; endKey: string }> = [
    { key: "request", label: "신청", startKey: "requestStartedOn", endKey: "requestEndedOn" },
    { key: "draft", label: "초안", startKey: "draftStartedOn", endKey: "draftEndedOn" },
    { key: "clientPick", label: "선정", startKey: "clientPickStartedOn", endKey: "clientPickEndedOn" },
    { key: "posting", label: "포스팅", startKey: "postingStartedOn", endKey: "postingEndedOn" }
  ];

  const milestones: Array<{ key: string; label: string; dateKey: string }> = [
    { key: "entryAnnouncedOn", label: "발표일", dateKey: "entryAnnouncedOn" },
    { key: "resultAnnouncedOn", label: "결과발표", dateKey: "resultAnnouncedOn" }
  ];

  const items: ScheduleItem[] = [];
  for (const p of phases) {
    const s = getDate(p.startKey);
    const e = getDate(p.endKey);
    if (s && e) {
      items.push({
        key: p.key,
        label: p.label,
        kind: "range",
        eventType: p.key as ScheduleItem["eventType"],
        start: s,
        end: e
      });
    } else if (s) {
      items.push({
        key: p.key + ".start",
        label: `${p.label} 시작`,
        kind: "point",
        eventType: p.key as ScheduleItem["eventType"],
        date: s
      });
    } else if (e) {
      items.push({
        key: p.key + ".end",
        label: `${p.label} 종료`,
        kind: "point",
        eventType: p.key as ScheduleItem["eventType"],
        date: e
      });
    }
  }
  for (const m of milestones) {
    const d = getDate(m.dateKey);
    if (d)
      items.push({
        key: m.key,
        label: m.label,
        kind: "point",
        eventType: m.key === "entryAnnouncedOn" ? "announce" : "result",
        date: d
      });
  }

  items.sort((a, b) => {
    const da = a.kind === "range" ? a.start!.getTime() : a.date!.getTime();
    const db = b.kind === "range" ? b.start!.getTime() : b.date!.getTime();
    return da - db;
  });
  if (items.length === 0) return null;

  const min = new Date(
    Math.min(
      ...items.map((it) => (it.kind === "range" ? it.start!.getTime() : it.date!.getTime()))
    )
  );

  const colorByEventType: Record<ScheduleItem["eventType"], string> = {
    request: "#9ca3af",
    draft: "#7c3aed",
    clientPick: "#0ea5e9",
    posting: "#16a34a",
    announce: "#f59e0b",
    result: "#ef4444"
  };

  const titleByEventType: Record<ScheduleItem["eventType"], string> = {
    request: "모집",
    draft: "체험&리뷰",
    clientPick: "체험&리뷰",
    posting: "체험&리뷰",
    announce: "마감",
    result: "마감"
  };

  const events = items.map((it) => {
    const color = colorByEventType[it.eventType];
    const title = titleByEventType[it.eventType];
    if (it.kind === "range") {
      return {
        title,
        start: formatYmd(it.start!),
        end: formatYmd(addDaysUtc(it.end!, 1)),
        allDay: true,
        backgroundColor: color,
        borderColor: color,
        textColor: "#ffffff",
        classNames: [`evt--${it.eventType}`]
      };
    }
    return {
      title,
      start: formatYmd(it.date!),
      end: formatYmd(addDaysUtc(it.date!, 1)),
      allDay: true,
      backgroundColor: color,
      borderColor: color,
      textColor: "#ffffff",
      classNames: [`evt--${it.eventType}`]
    };
  });

  return (
    <section className="detailSection">
      <div className="detailSection__head">
        <div className="detailSection__title">일정</div>
      </div>
      <div className="detailSection__body">
        <div className="scheduleCalendar">
          <FullCalendar
            plugins={[dayGridPlugin]}
            initialView="dayGridMonth"
            initialDate={formatYmd(min)}
            locale={koLocale}
            height="auto"
            headerToolbar={{ left: "", center: "title", right: "today prev,next" }}
            fixedWeekCount={false}
            showNonCurrentDates={true}
            dayMaxEvents={true}
            events={events}
          />
        </div>
      </div>
    </section>
  );
}

function DetailValue({ k, value }: { k: string; value: unknown }) {
  if (shouldHideValue(value)) return null;

  if (typeof value === "boolean") {
    return (
      <label className="detailCheck">
        <input type="checkbox" checked={value} readOnly />
        <span>{value ? "true" : "false"}</span>
      </label>
    );
  }

  if (typeof value === "string" && isLikelyUrl(value)) {
    const isImageKey = k === "thumbnail" || k === "contentImage";
    if (isImageKey) {
      return (
        <a className="detailImageLink" href={value} target="_blank" rel="noreferrer">
          <div className="detailImage">
            <img src={value} alt={k} loading="lazy" />
          </div>
        </a>
      );
    }
    return (
      <div className="detailUrl">
        <a href={value} target="_blank" rel="noreferrer">
          {value}
        </a>
      </div>
    );
  }

  if (k === "category" && Array.isArray(value)) {
    const filtered = value.filter((v) => !shouldHideValue(v));
    if (filtered.length === 0) return null;
    return (
      <div className="detailChips">
        {filtered.map((v, i) => (
          <span key={`${k}.${i}`} className="pill">
            {safeString(v) || (v === null ? "null" : String(v))}
          </span>
        ))}
      </div>
    );
  }

  if (Array.isArray(value)) {
    if (!hasVisibleDescendant(value)) return null;
    // For arrays: show as chips when scalar-ish, otherwise fall back to tree.
    const visible = value.filter((v) => !shouldHideValue(v));
    if (visible.length === 0) return null;
    const allScalar = visible.every((v) => v === null || ["string", "number", "boolean"].includes(typeof v));
    if (allScalar) {
      return (
        <div className="detailChips">
          {visible.map((v, i) => (
            <span key={`${k}.${i}`} className="pill">
              {safeString(v) || (v === null ? "null" : String(v))}
            </span>
          ))}
        </div>
      );
    }
    return <MiniValueView value={value} depth={0} maxDepth={8} path={`detail.${k}`} expandAll />;
  }

  if (isPlainObject(value)) {
    if (!hasVisibleDescendant(value)) return null;
    return <MiniValueView value={value} depth={0} maxDepth={10} path={`detail.${k}`} expandAll />;
  }

  const text = formatScalar(value);
  return <div className="detailText">{text || <span className="muted">-</span>}</div>;
}

function DetailSection({
  title,
  originalKey,
  value
}: {
  title: string;
  originalKey?: string;
  value: unknown;
}) {
  const hiddenKeys = new Set<string>([
    // hide duplicates already shown on card
    "item",
    "byDeadline",
    "category",
    "label",
    "startedOn",
    "endedOn",
    "reviewerLimit",
    // hide unwanted noise
    "status",
    "active",
    "media",
    "id",
    // hide images in detail (already on card)
    "thumbnail"
  ]);

  return (
    <section className="detailSection">
      <div className="detailSection__head">
        <div className="detailSection__title">
          {title}
          {originalKey ? <span className="detailSection__sub">{originalKey}</span> : null}
        </div>
      </div>
      <div className="detailSection__body">
        {(() => {
          if (isPlainObject(value)) {
            const rows = Object.entries(value).filter(([k, v]) => !hiddenKeys.has(k) && hasVisibleDescendant(v));
            if (rows.length === 0) return null;
            return rows.map(([k, v]) => (
              <div key={k} className="detailRow">
                <div className="detailKey" title={k}>
                  {labelForDetailKey(k)}
                  <span className="detailKey__sub">{k}</span>
                </div>
                <div className="detailVal">
                  <DetailValue k={k} value={v} />
                </div>
              </div>
            ));
          }

          if (!hasVisibleDescendant(value)) return null;
          return (
            <div className="detailRow">
              <div className="detailKey">{title}</div>
              <div className="detailVal">
                <DetailValue k={originalKey ?? title} value={value} />
              </div>
            </div>
          );
        })()}
      </div>
    </section>
  );
}

function extractTextFromHtml(html: string) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const text = (doc.body?.textContent ?? "").replace(/\u00a0/g, " ");
    return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
}

function extractKeywordsFromBlogKeywordHtml(html: string) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const kwEl = doc.querySelector(".mission-keywords");
    const raw = (kwEl?.textContent ?? "").replace(/\u00a0/g, " ").trim();
    if (!raw) return "";
    return raw
      .split(/[,\n]/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(",");
  } catch {
    const raw = html.replace(/<[^>]*>/g, " ").replace(/\u00a0/g, " ").trim();
    return raw
      .split(/[,\n]/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(",");
  }
}

export default function App() {
  // Fetch state
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");

  // Fetch params
  const [cat, setCat] = useState("제품");
  const [limit, setLimit] = useState(35);
  const [mediaInput, setMediaInput] = useState("blog");
  const [sort, setSort] = useState("latest");
  const [type, setType] = useState("play");
  const [startPage, setStartPage] = useState(1);

  // Loaded data
  const [items, setItems] = useState<Campaign[]>([]);
  const [pagesFetched, setPagesFetched] = useState<number>(0);
  const [totalReported, setTotalReported] = useState<number | undefined>(undefined);
  const [lastPage, setLastPage] = useState<number | undefined>(undefined);
  const [cacheInfo, setCacheInfo] = useState<{ restored: boolean; at?: number }>({ restored: false });

  // Auth
  const [rememberToken, setRememberToken] = useState<boolean>(() => {
    try {
      return localStorage.getItem("webleView.rememberToken") === "1";
    } catch {
      return false;
    }
  });
  const [bearerToken, setBearerToken] = useState(() => {
    try {
      const remember = localStorage.getItem("webleView.rememberToken") === "1";
      return remember ? localStorage.getItem("webleView.bearerToken") ?? "" : "";
    } catch {
      return "";
    }
  });
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Selected (drawer)
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<Record<string, unknown> | null>(null);
  const [selectedDetailStatus, setSelectedDetailStatus] = useState<Status>("idle");
  const selectedDetailAbortRef = useRef<AbortController | null>(null);

  // Filters - text
  const [qAll, setQAll] = useState("");
  const [qItem, setQItem] = useState("");
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);

  // Filters - select
  const [selMedia, setSelMedia] = useState<string>("__ALL__");
  const [selStatus, setSelStatus] = useState<string>("__ALL__");
  const [selActive, setSelActive] = useState<ActiveSelect>("__ALL__");
  const [selCategoryParent, setSelCategoryParent] = useState<string>("__ALL__");
  const [selCategoryChild, setSelCategoryChild] = useState<string>("__ALL__");
  const [selLabel, setSelLabel] = useState<string>("__ALL__");
  const [excludePaybackLabel, setExcludePaybackLabel] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const autoLoadedRef = useRef(false);

  const cacheKey = "webleView.cache.v1";
  const cacheTtlMs = 1000 * 60 * 10; // 10 minutes

  // Close drawer on Esc
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // Load campaign detail when selected changes
  useEffect(() => {
    selectedDetailAbortRef.current?.abort();
    setSelectedDetail(null);
    setSelectedDetailStatus(selected ? "loading" : "idle");

    const id =
      selected && typeof (selected as Record<string, unknown>).id === "number"
        ? ((selected as Record<string, unknown>).id as number)
        : null;
    if (!selected || !id) return;

    const ctl = new AbortController();
    selectedDetailAbortRef.current = ctl;

    const token = (bearerToken ?? "").trim().replace(/^Bearer\\s+/i, "");
    fetch(`/campaigns/${id}`, {
      signal: ctl.signal,
      headers: token
        ? {
            accept: "application/json, text/plain, */*",
            authorization: `Bearer ${token}`
          }
        : { accept: "application/json, text/plain, */*" }
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        }
        return (await res.json()) as Record<string, unknown>;
      })
      .then((json) => {
        if (!ctl.signal.aborted) {
          setSelectedDetail(json);
          setSelectedDetailStatus("done");
        }
      })
      .catch((e) => {
        if (ctl.signal.aborted) return;
        console.error(e);
        setSelectedDetailStatus("error");
      });

    return () => ctl.abort();
  }, [selected, bearerToken]);

  // Persist token locally (optional)
  useEffect(() => {
    try {
      localStorage.setItem("webleView.rememberToken", rememberToken ? "1" : "0");
      if (rememberToken) {
        localStorage.setItem("webleView.bearerToken", bearerToken);
      } else {
        localStorage.removeItem("webleView.bearerToken");
      }
    } catch {
      // ignore storage errors
    }
  }, [rememberToken, bearerToken]);

  // Restore cached campaigns on load (fast UI)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        at: number;
        items: Campaign[];
        pagesFetched?: number;
        totalReported?: number;
        lastPage?: number;
      };
      if (!parsed?.at || !Array.isArray(parsed.items)) return;
      if (Date.now() - parsed.at > cacheTtlMs) return;

      // restore data only (do not expose/restore fixed query params)
      setItems(parsed.items);
      setPagesFetched(parsed.pagesFetched ?? 0);
      setTotalReported(typeof parsed.totalReported === "number" ? parsed.totalReported : undefined);
      setLastPage(typeof parsed.lastPage === "number" ? parsed.lastPage : undefined);
      setCacheInfo({ restored: true, at: parsed.at });
    } catch {
      // ignore cache errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filterOptions = useMemo(() => {
    const medias = new Set<string>();
    const statuses = new Set<string>();
    const categoryParents = new Set<string>(CATEGORY_PARENT_ORDER);
    const categoryChildrenByParent = new Map<string, Set<string>>();
    const labels = new Set<string>();
    let hasActiveTrue = false;
    let hasActiveFalse = false;

    // Start with predefined children list (always visible)
    for (const child of CATEGORY_CHILDREN_ORDER) {
      const parent = categoryParentOf(child);
      const set = categoryChildrenByParent.get(parent) ?? new Set<string>();
      set.add(child);
      categoryChildrenByParent.set(parent, set);
    }

    for (const c of items) {
      const m = safeString(c.media);
      const s = safeString(c.status);
      if (m) medias.add(m);
      if (s) statuses.add(s);

      if (c.active === true) hasActiveTrue = true;
      if (c.active === false) hasActiveFalse = true;

      const lbl = safeString((c as Record<string, unknown>).label);
      if (lbl) labels.add(lbl);

      const leaf = normalizeCategoryValue(c.category);
      if (!leaf) continue;

      const parent = categoryParentOf(leaf);
      const set = categoryChildrenByParent.get(parent) ?? new Set<string>();
      set.add(leaf);
      categoryChildrenByParent.set(parent, set);
    }

    const toSorted = (set: Set<string>) => Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));

    const orderedChildren = (arr: string[]) => {
      const orderIdx = new Map<string, number>();
      CATEGORY_CHILDREN_ORDER.forEach((x, i) => orderIdx.set(x, i));
      return arr.slice().sort((a, b) => (orderIdx.get(a) ?? 999) - (orderIdx.get(b) ?? 999));
    };

    return {
      medias: toSorted(medias),
      statuses: toSorted(statuses),
      categoryParents: CATEGORY_PARENT_ORDER.filter((p) => categoryParents.has(p)),
      categoryChildrenByParent: new Map(
        Array.from(categoryChildrenByParent.entries()).map(([p, set]) => [p, orderedChildren(toSorted(set))])
      ),
      labels: toSorted(labels),
      activeChoices: { hasActiveTrue, hasActiveFalse }
    };
  }, [items]);

  const filtered = useMemo(() => {
    const qqItem = qItem.trim().toLowerCase();
    const qqAll = qAll.trim();
    const effectiveCategoryChildren =
      selCategoryChild !== "__ALL__"
        ? [selCategoryChild]
        : selCategoryParent !== "__ALL__"
          ? filterOptions.categoryChildrenByParent.get(selCategoryParent) ?? []
          : [];

    return items.filter((c) => {
      const lbl = safeString((c as Record<string, unknown>).label);
      if (excludePaybackLabel && lbl.includes("페이백")) return false;

      if (selMedia !== "__ALL__" && safeString(c.media) !== selMedia) return false;
      if (selStatus !== "__ALL__" && safeString(c.status) !== selStatus) return false;
      if (selActive !== "__ALL__") {
        const want = selActive === "true";
        if (c.active !== want) return false;
      }
      if (effectiveCategoryChildren.length) {
        if (!effectiveCategoryChildren.some((leaf) => includesCategory(c, leaf))) return false;
      }
      if (selLabel !== "__ALL__" && safeString((c as Record<string, unknown>).label) !== selLabel) return false;

      if (qqItem && !safeString(c.item).toLowerCase().includes(qqItem)) return false;
      if (!jsonSearch(c, qqAll)) return false;
      return true;
    });
  }, [
    items,
    qAll,
    qItem,
    selMedia,
    selStatus,
    selActive,
    selCategoryParent,
    selCategoryChild,
    selLabel,
    excludePaybackLabel,
    filterOptions
  ]);

  const allTableKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const c of filtered) {
      if (!c || typeof c !== "object") continue;
      for (const k of Object.keys(c)) keys.add(k);
    }
    const preferred = [
      "__starredConfirm",
      "id",
      "item",
      "media",
      "status",
      "active",
      "category",
      "label",
      "createdAt",
      "updatedAt",
      "startedOn",
      "endedOn",
      "thumbnail",
      "contentImage"
    ];
    const preferredSet = new Set(preferred);
    const rest = Array.from(keys).filter((k) => !preferredSet.has(k));
    rest.sort((a, b) => a.localeCompare(b, "en"));
    return [...preferred, ...rest];
  }, [filtered]);

  async function loadAll() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setStatus("loading");
    setError("");
    setItems([]);
    setPagesFetched(0);
    setTotalReported(undefined);
    setLastPage(undefined);

    try {
      const medias = mediaInput
        .split(/[,\s]+/g)
        .map((s) => s.trim())
        .filter(Boolean);
      const uniqMedias = Array.from(new Set(medias.length ? medias : ["blog"]));

      let mergedItems: Campaign[] = [];
      let pagesSum = 0;
      let totalReportedMax: number | undefined;
      let lastPageMax: number | undefined;

      // media별로 전체 페이지를 각각 조회 후 합산
      for (const m of uniqMedias) {
        const res = await fetchAllCampaignPages({
          cat,
          limit,
          media: [m],
          sort,
          type,
          startPage,
          signal: ac.signal,
          bearerToken
        });
        mergedItems = mergedItems.concat(res.items);
        pagesSum += res.pagesFetched;
        if (typeof res.totalReported === "number") {
          totalReportedMax = Math.max(totalReportedMax ?? 0, res.totalReported);
        }
        if (typeof res.lastPage === "number") {
          lastPageMax = Math.max(lastPageMax ?? 0, res.lastPage);
        }
      }

      // id 기준 중복 제거(같은 캠페인이 여러 media에 걸쳐 올 수 있음)
      const byId = new Map<number, Campaign>();
      for (const it of mergedItems) {
        const id = typeof it.id === "number" ? it.id : Number((it as unknown as Record<string, unknown>).id);
        if (!Number.isFinite(id)) continue;
        byId.set(id, it);
      }

      const deduped = Array.from(byId.values());
      setItems(deduped);
      setPagesFetched(pagesSum);
      setTotalReported(totalReportedMax);
      setLastPage(lastPageMax);
      setStatus("done");

      // cache campaigns (no token stored)
      try {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            at: Date.now(),
            items: deduped,
            pagesFetched: pagesSum,
            totalReported: totalReportedMax,
            lastPage: lastPageMax
          })
        );
      } catch {
        // ignore cache errors
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Auto-load when token exists (once per session)
  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (!bearerToken.trim()) return;
    if (status === "loading") return;
    // if cache restored, don't auto-fetch immediately; user can refresh manually
    if (items.length > 0) return;
    autoLoadedRef.current = true;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bearerToken, status, items.length]);

  function stop() {
    abortRef.current?.abort();
  }

  function resetFilters() {
    setSelMedia("__ALL__");
    setSelStatus("__ALL__");
    setSelActive("__ALL__");
    setSelCategoryParent("__ALL__");
    setSelCategoryChild("__ALL__");
    setSelLabel("__ALL__");
    setExcludePaybackLabel(true);
    setQAll("");
    setQItem("");
  }

  const activeFilterChips = useMemo(() => {
    const chips: { id: string; label: string; onRemove: () => void }[] = [];
    if (excludePaybackLabel) chips.push({ id: "noPayback", label: "라벨: 페이백 제외", onRemove: () => setExcludePaybackLabel(false) });
    if (selMedia !== "__ALL__") chips.push({ id: "media", label: `매체: ${selMedia}`, onRemove: () => setSelMedia("__ALL__") });
    if (selStatus !== "__ALL__") chips.push({ id: "status", label: `상태: ${selStatus}`, onRemove: () => setSelStatus("__ALL__") });
    if (selActive !== "__ALL__") chips.push({ id: "active", label: `활성: ${selActive}`, onRemove: () => setSelActive("__ALL__") });
    if (selCategoryParent !== "__ALL__" && selCategoryChild === "__ALL__") {
      chips.push({
        id: "categoryParent",
        label: `카테고리: ${selCategoryParent}`,
        onRemove: () => setSelCategoryParent("__ALL__")
      });
    }
    if (selCategoryChild !== "__ALL__") {
      chips.push({
        id: "categoryChild",
        label: `카테고리: ${selCategoryParent} › ${selCategoryChild}`,
        onRemove: () => setSelCategoryChild("__ALL__")
      });
    }
    if (selLabel !== "__ALL__") chips.push({ id: "label", label: `라벨: ${selLabel}`, onRemove: () => setSelLabel("__ALL__") });
    if (qAll.trim()) chips.push({ id: "qAll", label: `검색: "${qAll.trim()}"`, onRemove: () => setQAll("") });
    if (qItem.trim()) chips.push({ id: "qItem", label: `상품명: "${qItem.trim()}"`, onRemove: () => setQItem("") });
    return chips;
  }, [excludePaybackLabel, selMedia, selStatus, selActive, selCategoryParent, selCategoryChild, selLabel, qAll, qItem]);

  return (
    <div className={selected ? "app-shell app-shell--withDetail" : "app-shell"}>
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__logo" />
          <div>
            <div className="sidebar__title">Weble Campaigns</div>
            <div className="sidebar__subtitle">전체 페이지 + 필터 view</div>
          </div>
        </div>

        <section className="section">
          <div className="section__head">
            <div className="section__title">인증</div>
          </div>
          <div className="section__body">
            <div className="field">
              <label>Bearer Token (저장 안 함)</label>
              <input
                className="input"
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                placeholder="토큰 붙여넣기"
              />
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-soft)" }}>
                <input
                  type="checkbox"
                  checked={rememberToken}
                  onChange={(e) => setRememberToken(e.target.checked)}
                />
                이 브라우저에 토큰 기억하기
              </label>
              <button
                className="btn btn--danger btn--sm"
                onClick={() => {
                  setBearerToken("");
                  setRememberToken(false);
                }}
                title="저장된 토큰 삭제"
              >
                토큰 삭제
              </button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              주의: “기억하기”를 켜면 이 PC/브라우저의 localStorage에 저장됩니다.
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section__head">
            <div className="section__title">필터</div>
            <button className="btn btn--ghost btn--sm" onClick={resetFilters}>
              초기화
            </button>
          </div>
          <div className="section__body">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-soft)" }}>
                <input
                  type="checkbox"
                  checked={excludePaybackLabel}
                  onChange={(e) => setExcludePaybackLabel(e.target.checked)}
                />
                라벨에 “페이백” 포함된 캠페인 제외
              </label>
            </div>

            <div className="field">
              <label>상품명 키워드</label>
              <input
                className="input"
                value={qItem}
                onChange={(e) => setQItem(e.target.value)}
                placeholder="예: 모닝티"
              />
            </div>

            {filterOptions.medias.length > 1 ? (
              <div className="field">
                <label>매체 (media)</label>
                <select className="select" value={selMedia} onChange={(e) => setSelMedia(e.target.value)}>
                  <option value="__ALL__">전체</option>
                  {filterOptions.medias.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {filterOptions.statuses.length > 1 ? (
              <div className="field">
                <label>상태 (status)</label>
                <select className="select" value={selStatus} onChange={(e) => setSelStatus(e.target.value)}>
                  <option value="__ALL__">전체</option>
                  {filterOptions.statuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {filterOptions.activeChoices.hasActiveTrue && filterOptions.activeChoices.hasActiveFalse ? (
              <div className="field">
                <label>활성 (active)</label>
                <select
                  className="select"
                  value={selActive}
                  onChange={(e) => setSelActive(e.target.value as ActiveSelect)}
                >
                  <option value="__ALL__">전체</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>
            ) : null}
            <div className="field">
              <label>라벨 (label)</label>
              <select className="select" value={selLabel} onChange={(e) => setSelLabel(e.target.value)}>
                <option value="__ALL__">전체</option>
                {filterOptions.labels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section__head">
            <div className="section__title">고급 검색</div>
            <button className="btn btn--ghost btn--sm" onClick={() => setShowAdvancedSearch((v) => !v)}>
              {showAdvancedSearch ? "접기" : "펼치기"}
            </button>
          </div>
          {showAdvancedSearch ? (
            <div className="section__body">
              <div className="field">
                <label>전체(JSON) 검색</label>
                <input
                  className="input"
                  value={qAll}
                  onChange={(e) => setQAll(e.target.value)}
                  placeholder='예: "REQUEST" 또는 "모닝티"'
                />
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                이 검색은 모든 필드를 대상으로 합니다. 느리거나 과하면 끄고 사용하세요.
              </div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              필요할 때만 펼쳐서 사용
            </div>
          )}
        </section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar__title">
            <h1>Weble 캠페인 전체조회</h1>
            <span className="muted">/v1/campaigns</span>
          </div>
          <div className="row">
            <span className={statusPillClass(status)}>
              조회: {status}
              {pagesFetched ? ` · ${pagesFetched}p` : ""}
              {typeof lastPage === "number" ? ` / ${lastPage}` : ""}
              {typeof totalReported === "number" ? ` · total ${totalReported}` : ""}
            </span>
            <button className="btn btn--ghost" type="button" onClick={() => setShowAuthModal(true)}>
              인증
            </button>
            {cacheInfo.restored ? <span className="pill">{`캐시 복원됨`}</span> : null}
            <button className="btn" onClick={stop} disabled={status !== "loading"}>
              중지
            </button>
            <button className="btn btn--primary" onClick={loadAll} disabled={status === "loading"}>
              전체 페이지 조회
            </button>
          </div>
        </header>

        <div className="content">
          <div className="topControls">
            <button className="btn btn--ghost btn--sm" onClick={resetFilters} type="button">
              필터 초기화
            </button>
            <label className="topControls__check">
              <input
                type="checkbox"
                checked={excludePaybackLabel}
                onChange={(e) => setExcludePaybackLabel(e.target.checked)}
              />
              라벨 “페이백” 제외
            </label>
            <input
              className="input"
              value={qItem}
              onChange={(e) => setQItem(e.target.value)}
              placeholder="상품명 키워드"
              style={{ minWidth: 220 }}
            />
            {filterOptions.labels.length > 1 ? (
              <select className="select" value={selLabel} onChange={(e) => setSelLabel(e.target.value)}>
                <option value="__ALL__">라벨 전체</option>
                {filterOptions.labels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            ) : null}
            {filterOptions.medias.length > 1 ? (
              <select className="select" value={selMedia} onChange={(e) => setSelMedia(e.target.value)}>
                <option value="__ALL__">매체 전체</option>
                {filterOptions.medias.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : null}
            {filterOptions.statuses.length > 1 ? (
              <select className="select" value={selStatus} onChange={(e) => setSelStatus(e.target.value)}>
                <option value="__ALL__">상태 전체</option>
                {filterOptions.statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="toolbar">
            <input
              className="input search"
              placeholder="빠른 검색 (고급: 전체 JSON 부분일치)"
              value={qAll}
              onChange={(e) => setQAll(e.target.value)}
            />
            <div className="row" style={{ flex: 1, justifyContent: "flex-end" }}>
              <span className="muted">
                결과 <strong style={{ color: "var(--text)" }}>{filtered.length}</strong>{" "}
                <span className="muted">/ 원본 {items.length}</span>
              </span>
            </div>
          </div>

          <div className="tabs">
            <button
              className={selCategoryParent === "__ALL__" ? "tab tab--active" : "tab"}
              onClick={() => {
                setSelCategoryParent("__ALL__");
                setSelCategoryChild("__ALL__");
              }}
              type="button"
            >
              전체
            </button>
            {filterOptions.categoryParents.map((p) => (
              <button
                key={p}
                className={selCategoryParent === p ? "tab tab--active" : "tab"}
                onClick={() => {
                  setSelCategoryParent(p);
                  setSelCategoryChild("__ALL__");
                }}
                type="button"
                title={p}
              >
                {p}
              </button>
            ))}
          </div>

          {selCategoryParent !== "__ALL__" &&
          (filterOptions.categoryChildrenByParent.get(selCategoryParent)?.length ?? 0) > 0 ? (
            <div className="tabs tabs--sub">
              <button
                className={selCategoryChild === "__ALL__" ? "tab tab--active" : "tab"}
                onClick={() => setSelCategoryChild("__ALL__")}
                type="button"
              >
                전체
              </button>
              {(filterOptions.categoryChildrenByParent.get(selCategoryParent) ?? []).map((c) => (
                <button
                  key={c}
                  className={selCategoryChild === c ? "tab tab--active" : "tab"}
                  onClick={() => setSelCategoryChild(c)}
                  type="button"
                  title={c}
                >
                  {c}
                </button>
              ))}
            </div>
          ) : null}

          {activeFilterChips.length > 0 ? (
            <div className="activeFilters">
              {activeFilterChips.map((chip) => (
                <span key={chip.id} className="pill pill--primary">
                  {chip.label}
                  <span className="pill__close" onClick={chip.onRemove} role="button" aria-label="필터 제거">
                    ×
                  </span>
                </span>
              ))}
              <button className="btn btn--ghost btn--sm" onClick={resetFilters}>
                모두 지우기
              </button>
            </div>
          ) : null}

          {status === "error" ? <div className="alert">조회 에러: {error}</div> : null}

          <div className="cardsCard">
            {filtered.length === 0 ? (
              <div className="empty">
                {items.length === 0
                  ? "아직 조회된 데이터가 없습니다. 우측 상단의 ‘전체 페이지 조회’를 눌러주세요."
                  : "필터 결과가 없습니다. 좌측 사이드바에서 필터를 완화해보세요."}
              </div>
            ) : (
              <div className="cardGrid">
                {filtered.map((c) => {
                  const id = safeString(c.id);
                  const item = safeString(c.item);
                  const label = safeString((c as Record<string, unknown>).label);
                  const thumb = safeString((c as Record<string, unknown>).thumbnail);

                  const byDeadline = (c as Record<string, unknown>).byDeadline;
                  const reviewerLimit = (c as Record<string, unknown>).reviewerLimit;
                  const campaignData = (c as Record<string, unknown>).campaignData as Record<string, unknown> | undefined;
                  const campaignStats = (c as Record<string, unknown>).campaignStats as Record<string, unknown> | undefined;

                  const reward = campaignData ? safeString(campaignData.reward) : "";
                  const pointRaw = campaignData?.point;
                  const point = typeof pointRaw === "number" ? pointRaw : Number(pointRaw);

                  const requestCountRaw = campaignStats?.requestCount;
                  const requestCount =
                    typeof requestCountRaw === "number" ? requestCountRaw : Number(requestCountRaw);

                  const reviewerLimitNum = typeof reviewerLimit === "number" ? reviewerLimit : Number(reviewerLimit);
                  const hasRequest = Number.isFinite(requestCount) && Number.isFinite(reviewerLimitNum);
                  const requestRatio = hasRequest
                    ? Math.max(0, Math.min(1, reviewerLimitNum > 0 ? requestCount / reviewerLimitNum : 0))
                    : 0;

                  const labelTags = label
                    .split(";")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 6);

                  const cardTagsRaw = Array.isArray((c as Record<string, unknown>).tags)
                    ? (((c as Record<string, unknown>).tags as unknown[]) ?? [])
                    : [];
                  const cardTagGroups = (() => {
                    const m = new Map<string, string[]>();
                    for (const t of cardTagsRaw) {
                      if (!t || typeof t !== "object") continue;
                      const obj = t as Record<string, unknown>;
                      const type = safeString(obj.type) || "etc";
                      const name = safeString(obj.name);
                      if (!name) continue;
                      const arr = m.get(type) ?? [];
                      arr.push(name);
                      m.set(type, arr);
                    }
                    for (const [k, arr] of m.entries()) {
                      arr.sort((a, b) => a.localeCompare(b, "ko"));
                      m.set(k, Array.from(new Set(arr)).slice(0, 8));
                    }
                    return m;
                  })();
                  const cardTagTypeLabel = (type: string) => {
                    if (type === "category") return "카테고리";
                    if (type === "Team") return "팀";
                    if (type === "Experience") return "체험유형";
                    return type;
                  };

                  return (
                    <div key={id + safeString((c as Record<string, unknown>).hash)} className="campaignCard">
                      <button className="campaignCard__click" onClick={() => setSelected(c)} title="상세 보기" />
                      <div className="campaignCard__thumb">
                        {thumb ? <img src={thumb} alt={item || id} loading="lazy" /> : <div className="thumbPlaceholder">NO IMAGE</div>}
                      </div>
                      <div className="campaignCard__body">
                        <div className="campaignCard__top">
                          <div className="campaignCard__title" title={item || undefined}>
                            {item || <span className="muted">상품명 없음</span>}
                          </div>
                          <div className="campaignCard__meta">
                            {/* 숨김: ID */}
                          </div>
                        </div>

                        {/* 숨김: status / active / media */}

                        <div className="cardMetaStack">
                          <div className="cardMetaRow">
                            {typeof byDeadline === "number" ? (
                              <span className="pill pill--primary">{`D-${byDeadline}`}</span>
                            ) : (
                              <span className="pill">D-?</span>
                            )}
                          </div>

                          <div className="cardMetaRow">
                            {reward ? (
                              <span className="cardMetaStack__reward" title={reward}>
                                {reward}
                              </span>
                            ) : (
                              <span className="muted">제공내역 없음</span>
                            )}
                          </div>

                          {Number.isFinite(point) && point > 0 ? (
                            <div className="cardMetaRow">
                              <span className="pill" title={`${point.toLocaleString()}P`}>{`${point.toLocaleString()}P`}</span>
                            </div>
                          ) : null}

                          {hasRequest ? (
                            <div className="cardMetaRow">
                              <div className="cardMetaStack__req">
                                <div className="cardMetaStack__reqBar" aria-hidden="true">
                                  <div className="cardMetaStack__reqFill" style={{ width: `${requestRatio * 100}%` }} />
                                </div>
                                <div
                                  className="cardMetaStack__reqText"
                                  title={`신청 ${requestCount.toLocaleString()} / ${reviewerLimitNum.toLocaleString()}명`}
                                >{`신청 ${requestCount.toLocaleString()} / ${reviewerLimitNum.toLocaleString()}명`}</div>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="campaignCard__kv">
                          {label ? (
                            <div className="kvRow" style={{ borderBottom: "none" }}>
                              <div className="key">라벨</div>
                              <div>
                                {labelTags.length ? (
                                  <div className="detailChips">
                                    {labelTags.map((t) => (
                                      <span key={t} className="pill">
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  label
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        {cardTagGroups.size ? (
                          <div className="campaignCard__tags">
                            {Array.from(cardTagGroups.entries()).map(([type, names]) => (
                              <div key={type} className="tagGroup tagGroup--card">
                                <div className="tagGroup__title">{cardTagTypeLabel(type)}</div>
                                <div className="detailChips">
                                  {names.map((n) => (
                                    <span key={`${type}.${n}`} className="pill">
                                      {n}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {selected ? (
        <>
          <div className="drawer__backdrop" onClick={() => setSelected(null)} />
          <aside className="drawer" role="dialog" aria-modal="true">
            <div className="drawer__head">
              <div>
                <div className="drawer__title">캠페인 상세</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  id={safeString(selected.id)} · {safeString(selected.item)}
                </div>
              </div>
              <div className="row">
                <button
                  className="btn btn--sm"
                  onClick={() => {
                    const text = JSON.stringify(selected, null, 2);
                    void navigator.clipboard?.writeText(text);
                  }}
                >
                  JSON 복사
                </button>
                <button className="btn btn--sm" onClick={() => setSelected(null)}>
                  닫기
                </button>
              </div>
            </div>
            <div className="drawer__body">
              {(() => {
                const base = selected as unknown as Record<string, unknown>;
                const detail = selectedDetail ?? null;
                const c = (detail ? { ...base, ...detail } : base) as Record<string, unknown>;

                const item = safeString(c.item);
                const id = typeof c.id === "number" ? c.id : null;
                const media = safeString(c.media);
                const status = safeString(c.status);
                const active = typeof c.active === "boolean" ? c.active : null;

                const requestStartedOn = safeString(c.requestStartedOn);
                const requestEndedOn = safeString(c.requestEndedOn);
                const entryAnnouncedOn = safeString(c.entryAnnouncedOn);
                const postingStartedOn = safeString(c.postingStartedOn);
                const postingEndedOn = safeString(c.postingEndedOn);
                const resultAnnouncedOn = safeString(c.resultAnnouncedOn);

                const stats = isPlainObject(c.campaignStats) ? (c.campaignStats as Record<string, unknown>) : null;
                const requestCount = stats && typeof stats.requestCount === "number" ? stats.requestCount : null;
                const reviewerLimit = typeof c.reviewerLimit === "number" ? c.reviewerLimit : null;

                const contentImage = safeString(c.contentImage);
                const replaceDictionaryWork = isPlainObject(c.replaceDictionaryWork)
                  ? (c.replaceDictionaryWork as Record<string, unknown>)
                  : null;
                const blogRewardDetail = replaceDictionaryWork ? safeString(replaceDictionaryWork.blogRewardDetail) : "";
                const blogCampaignMission = replaceDictionaryWork ? safeString(replaceDictionaryWork.blogCampaignMission) : "";
                const blogKeyword = replaceDictionaryWork ? safeString(replaceDictionaryWork.blogKeyword) : "";
                const addNotice = replaceDictionaryWork ? safeString(replaceDictionaryWork.addNotice) : "";

                const campaignOptions = isPlainObject(c.campaignOptions) ? (c.campaignOptions as Record<string, unknown>) : null;
                const requiredReviewLinks =
                  campaignOptions && Array.isArray(campaignOptions.requiredReviewLinks)
                    ? (campaignOptions.requiredReviewLinks as unknown[])
                        .map((x) => safeString(x))
                        .filter(Boolean)
                    : [];

                const missionKeywords =
                  Array.isArray((c as Record<string, unknown>).missionKeywords)
                    ? ((c as Record<string, unknown>).missionKeywords as unknown[])
                        .map((x) => safeString(x))
                        .filter(Boolean)
                    : [];

                const htmlBlock = (html: string) => (
                  <div className="htmlBlock" dangerouslySetInnerHTML={{ __html: html }} />
                );

                const copyKeywords = async () => {
                  const fromArray = missionKeywords.length
                    ? missionKeywords
                        .flatMap((x) => x.split(","))
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .join(",")
                    : "";
                  const fromHtml = blogKeyword ? extractKeywordsFromBlogKeywordHtml(blogKeyword) : "";
                  const payload = (fromArray || fromHtml).trim();
                  if (!payload) return;
                  try {
                    await navigator.clipboard?.writeText(payload);
                  } catch {
                    // ignore
                  }
                };

                const keywordList = (() => {
                  if (missionKeywords.length) {
                    return missionKeywords
                      .flatMap((x) => x.split(","))
                      .map((s) => s.trim())
                      .filter(Boolean);
                  }
                  const raw = blogKeyword ? extractKeywordsFromBlogKeywordHtml(blogKeyword) : "";
                  return raw
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                })();

                const periodRows: Array<{ title: string; value: string }> = [
                  requestStartedOn || requestEndedOn
                    ? { title: "캠페인 신청기간", value: `${requestStartedOn || "-"} ~ ${requestEndedOn || "-"}` }
                    : null,
                  entryAnnouncedOn ? { title: "인플루언서 발표", value: entryAnnouncedOn } : null,
                  postingStartedOn || postingEndedOn
                    ? { title: "콘텐츠 등록기간", value: `${postingStartedOn || "-"} ~ ${postingEndedOn || "-"}` }
                    : null,
                  resultAnnouncedOn ? { title: "캠페인 결과발표", value: resultAnnouncedOn } : null,
                  requestCount !== null && reviewerLimit !== null
                    ? { title: "신청자", value: `${requestCount.toLocaleString()} / ${reviewerLimit.toLocaleString()}명` }
                    : null
                ].filter(Boolean) as Array<{ title: string; value: string }>;

                return (
                  <div className="campaignDetail">
                    <div className="campaignHead">
                      <div className="campaignHead__titleRow">
                        <h2 className="campaignHead__title">{item || "-"}</h2>
                      </div>
                      <div className="campaignHead__meta">
                        {selectedDetailStatus === "loading" ? <span className="pill pill--primary">상세 로딩…</span> : null}
                        {selectedDetailStatus === "error" ? <span className="pill">상세 로드 실패</span> : null}
                      </div>
                    </div>

                    {/* 썸네일은 카드에서만 표시 (상세에서는 비노출) */}

                    {contentImage ? (
                      <div className="detailSection">
                        <div className="detailSection__head">
                          <div className="detailSection__title">상세 이미지</div>
                        </div>
                        <div className="detailSection__body">
                          <div className="detailImage detailImage--scroll">
                            <img className="detailImage__img" src={contentImage} alt="contentImage" loading="lazy" />
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <CampaignSchedule campaign={c} />

                    {blogRewardDetail ? (
                      <div className="detailSection">
                        <div className="detailSection__head">
                          <div className="detailSection__title">제공 내역</div>
                        </div>
                        <div className="detailSection__body">{htmlBlock(blogRewardDetail)}</div>
                      </div>
                    ) : null}

                    {blogCampaignMission || missionKeywords.length || requiredReviewLinks.length ? (
                      <div className="detailSection">
                        <div className="detailSection__head">
                          <div className="detailSection__title">캠페인 미션</div>
                        </div>
                        <div className="detailSection__body">
                          {missionKeywords.length ? (
                            <div className="detailChips" style={{ marginBottom: 10 }}>
                              {missionKeywords.map((k) => (
                                <span key={k} className="pill">
                                  {k}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {requiredReviewLinks.length ? (
                            <div className="linkList" style={{ marginBottom: blogCampaignMission ? 10 : 0 }}>
                              {requiredReviewLinks.map((href) => (
                                <a key={href} className="linkItem" href={href} target="_blank" rel="noreferrer">
                                  {href}
                                </a>
                              ))}
                            </div>
                          ) : null}
                          {blogCampaignMission ? htmlBlock(blogCampaignMission) : null}
                        </div>
                      </div>
                    ) : null}

                    {keywordList.length ? (
                      <div className="detailSection">
                        <div className="detailSection__head">
                          <div className="detailSection__title">키워드</div>
                          <button className="btn btn--sm btn--ghost" type="button" onClick={() => void copyKeywords()}>
                            키워드 전체 복사
                          </button>
                        </div>
                        <div className="detailSection__body">
                          <div className="detailChips">
                            {keywordList.map((k) => (
                              <span key={k} className="pill">
                                {k}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {addNotice ? (
                      <div className="detailSection">
                        <div className="detailSection__head">
                          <div className="detailSection__title">추가 안내사항</div>
                        </div>
                        <div className="detailSection__body">{htmlBlock(addNotice)}</div>
                      </div>
                    ) : null}
                  </div>
                );
              })()}
            </div>
          </aside>
        </>
      ) : null}

      {showAuthModal ? (
        <>
          <div className="modal__backdrop" onClick={() => setShowAuthModal(false)} />
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal__head">
              <div className="modal__title">인증</div>
              <button className="btn btn--sm" onClick={() => setShowAuthModal(false)} type="button">
                닫기
              </button>
            </div>
            <div className="modal__body">
              <div className="field">
                <label>Bearer Token</label>
                <input
                  className="input"
                  value={bearerToken}
                  onChange={(e) => setBearerToken(e.target.value)}
                  placeholder="토큰 붙여넣기"
                />
              </div>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <label className="topControls__check">
                  <input
                    type="checkbox"
                    checked={rememberToken}
                    onChange={(e) => setRememberToken(e.target.checked)}
                  />
                  이 브라우저에 토큰 기억하기
                </label>
                <button
                  className="btn btn--danger btn--sm"
                  type="button"
                  onClick={() => {
                    setBearerToken("");
                    setRememberToken(false);
                  }}
                >
                  토큰 삭제
                </button>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                주의: “기억하기”를 켜면 이 PC/브라우저의 localStorage에 저장됩니다.
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
