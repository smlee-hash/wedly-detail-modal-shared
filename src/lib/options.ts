export const FIELD_OPTIONS: Record<string, string[]> = {
  // ERP tax-amendment 의 옵션 정의 (HIVE 데이터 소스).
  "05경정계약진행상태": [
    "가망", "계약대기", "계약완료", "경정청구 신청 완료", "계약서 전송 완료",
    "인용완료", "계약보류", "수금완료", "계약취하", "보완처리중",
    "정산완료", "계약불가", "내용증명발송", "기경정 보완", "방문컨설팅예정", "방문컨설팅완료",
  ],
  "13세무업체": ["서월", "세람"],
  "14사업자유형": ["개인사업자", "법인사업자"],
  "16조회통화자": ["대표", "직원"],
  "42기장계약진행상태": ["대기중", "계약보류", "계약완료"],
  "37일차영업팀소속": ["한국서비스지원센터"],
  "38이차영업팀소속": ["한국서비스지원센터"],
  "39계약담당자소속": ["한국서비스지원센터"],
  "02발송상태": ["발송 전", "발송완료"],
  "54DB분류": ["TheLink", "TheLink2", "한국중소기업협회"],
  "30반론유형": [
    "기장 세무사 반론", "환급 후 환수 및 사후 관리", "도입 단선",
    "환급액이 얼마 안된다", "혼자 불안해함", "지속 부재",
  ],
};

export const READONLY_TYPES = new Set([
  "formula", "last_edited_time", "last_edited_by", "auto_increment_id", "file",
]);

const CUSTOM_OPTIONS_KEY = "wedly-hive-custom-options";
const CUSTOM_COLORS_KEY = "wedly-hive-custom-colors";
const HIDDEN_OPTIONS_KEY = "wedly-hive-hidden-options";

// 서버 공유 설정 동기화 — 모든 디바이스/유저가 같은 옵션/색상/숨김 설정을 보도록
const SHARED_CONFIG_API = "/api/hive-config";

async function pushToServer(field: "customOptions" | "customColors" | "hiddenOptions", value: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch(SHARED_CONFIG_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
  } catch { /* ignore — localStorage write 가 우선이므로 다음 sync 에서 복구 */ }
}

/**
 * 서버 공유 설정에서 옵션/색상/숨김 설정을 가져와 localStorage 에 반영.
 * SubsidyClient 마운트 시 1회 호출. 이후 'option-color-changed' 이벤트로 셀 리렌더 트리거.
 *
 * 서버에 해당 키가 없는데 로컬에 값이 있으면 → 자동 seeding (= 처음 접속한 디바이스의 값을 서버로 푸시).
 * 이렇게 해야 기능 deploy 이전부터 localStorage 에만 쌓여있던 PC 의 색상 설정이 서버로 올라가서
 * 모바일에서도 동일하게 보인다.
 */
export async function loadSharedOptionConfig(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const res = await fetch(SHARED_CONFIG_API);
    const json = await res.json();
    const cfg: Record<string, unknown> = (json?.success && json?.data && typeof json.data === "object")
      ? (json.data as Record<string, unknown>)
      : {};

    // 1) 서버에 있는 값을 로컬로 가져오기
    let changed = false;
    if (cfg.customOptions && typeof cfg.customOptions === "object") {
      localStorage.setItem(CUSTOM_OPTIONS_KEY, JSON.stringify(cfg.customOptions));
      changed = true;
    }
    if (cfg.customColors && typeof cfg.customColors === "object") {
      localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(cfg.customColors));
      changed = true;
    }
    if (cfg.hiddenOptions && typeof cfg.hiddenOptions === "object") {
      localStorage.setItem(HIDDEN_OPTIONS_KEY, JSON.stringify(cfg.hiddenOptions));
      changed = true;
    }

    // 2) 서버에 없는데 로컬에 값이 있는 키가 있으면 → 시드로 서버에 푸시
    const seed: Record<string, unknown> = {};
    if (!cfg.customOptions) {
      const localOpts = loadCustomOptions();
      if (Object.keys(localOpts).length > 0) seed.customOptions = localOpts;
    }
    if (!cfg.customColors) {
      const localColors = loadCustomColors();
      if (Object.keys(localColors).length > 0) seed.customColors = localColors;
    }
    if (!cfg.hiddenOptions) {
      const localHidden = loadHiddenOptions();
      if (Object.keys(localHidden).length > 0) seed.hiddenOptions = localHidden;
    }
    if (Object.keys(seed).length > 0) {
      try {
        await fetch(SHARED_CONFIG_API, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(seed),
        });
      } catch { /* ignore */ }
    }

    if (changed) {
      window.dispatchEvent(new CustomEvent("option-color-changed"));
    }
  } catch { /* ignore */ }
}

// 색상 농도 5단계 — Tailwind 표준 팔레트 사용 (50/100/200/500/700)
export type ColorShade = {
  /** 농도 라벨 (연하게/살짝/보통/진하게/매우 진함) */
  shade: string;
  /** Tailwind background class (예: bg-blue-100) */
  bg: string;
  /** Tailwind text class (예: text-blue-700) */
  text: string;
  /** 미리보기용 hex (배경 기준) */
  bgHex: string;
};

export type ColorFamily = {
  name: string;
  shades: ColorShade[];
};

// 10 colors × 5 shades = 50 색상 옵션
// Tailwind JIT 호환을 위해 클래스명은 모두 정적 리터럴로 작성됨
export const OPTION_COLOR_FAMILIES: ColorFamily[] = [
  { name: "회색", shades: [
    { shade: "연하게",  bg: "bg-slate-50",  text: "text-slate-700", bgHex: "#f8fafc" },
    { shade: "살짝",    bg: "bg-slate-100", text: "text-slate-700", bgHex: "#f1f5f9" },
    { shade: "보통",    bg: "bg-slate-200", text: "text-slate-800", bgHex: "#e2e8f0" },
    { shade: "진하게",  bg: "bg-slate-500", text: "text-white",     bgHex: "#64748b" },
    { shade: "매우 진함", bg: "bg-slate-700", text: "text-white",   bgHex: "#334155" },
  ]},
  { name: "파랑", shades: [
    { shade: "연하게",  bg: "bg-blue-50",  text: "text-blue-700", bgHex: "#eff6ff" },
    { shade: "살짝",    bg: "bg-blue-100", text: "text-blue-700", bgHex: "#dbeafe" },
    { shade: "보통",    bg: "bg-blue-200", text: "text-blue-800", bgHex: "#bfdbfe" },
    { shade: "진하게",  bg: "bg-blue-500", text: "text-white",    bgHex: "#3b82f6" },
    { shade: "매우 진함", bg: "bg-blue-700", text: "text-white",  bgHex: "#1d4ed8" },
  ]},
  { name: "초록", shades: [
    { shade: "연하게",  bg: "bg-emerald-50",  text: "text-emerald-700", bgHex: "#ecfdf5" },
    { shade: "살짝",    bg: "bg-emerald-100", text: "text-emerald-700", bgHex: "#d1fae5" },
    { shade: "보통",    bg: "bg-emerald-200", text: "text-emerald-800", bgHex: "#a7f3d0" },
    { shade: "진하게",  bg: "bg-emerald-500", text: "text-white",       bgHex: "#10b981" },
    { shade: "매우 진함", bg: "bg-emerald-700", text: "text-white",     bgHex: "#047857" },
  ]},
  { name: "노랑", shades: [
    { shade: "연하게",  bg: "bg-yellow-50",  text: "text-yellow-700", bgHex: "#fefce8" },
    { shade: "살짝",    bg: "bg-yellow-100", text: "text-yellow-700", bgHex: "#fef9c3" },
    { shade: "보통",    bg: "bg-yellow-200", text: "text-yellow-800", bgHex: "#fef08a" },
    { shade: "진하게",  bg: "bg-yellow-500", text: "text-white",      bgHex: "#eab308" },
    { shade: "매우 진함", bg: "bg-yellow-700", text: "text-white",    bgHex: "#a16207" },
  ]},
  { name: "주황", shades: [
    { shade: "연하게",  bg: "bg-orange-50",  text: "text-orange-700", bgHex: "#fff7ed" },
    { shade: "살짝",    bg: "bg-orange-100", text: "text-orange-700", bgHex: "#ffedd5" },
    { shade: "보통",    bg: "bg-orange-200", text: "text-orange-800", bgHex: "#fed7aa" },
    { shade: "진하게",  bg: "bg-orange-500", text: "text-white",      bgHex: "#f97316" },
    { shade: "매우 진함", bg: "bg-orange-700", text: "text-white",    bgHex: "#c2410c" },
  ]},
  { name: "빨강", shades: [
    { shade: "연하게",  bg: "bg-red-50",  text: "text-red-700", bgHex: "#fef2f2" },
    { shade: "살짝",    bg: "bg-red-100", text: "text-red-700", bgHex: "#fee2e2" },
    { shade: "보통",    bg: "bg-red-200", text: "text-red-800", bgHex: "#fecaca" },
    { shade: "진하게",  bg: "bg-red-500", text: "text-white",   bgHex: "#ef4444" },
    { shade: "매우 진함", bg: "bg-red-700", text: "text-white", bgHex: "#b91c1c" },
  ]},
  { name: "보라", shades: [
    { shade: "연하게",  bg: "bg-purple-50",  text: "text-purple-700", bgHex: "#faf5ff" },
    { shade: "살짝",    bg: "bg-purple-100", text: "text-purple-700", bgHex: "#f3e8ff" },
    { shade: "보통",    bg: "bg-purple-200", text: "text-purple-800", bgHex: "#e9d5ff" },
    { shade: "진하게",  bg: "bg-purple-500", text: "text-white",      bgHex: "#a855f7" },
    { shade: "매우 진함", bg: "bg-purple-700", text: "text-white",    bgHex: "#7e22ce" },
  ]},
  { name: "분홍", shades: [
    { shade: "연하게",  bg: "bg-pink-50",  text: "text-pink-700", bgHex: "#fdf2f8" },
    { shade: "살짝",    bg: "bg-pink-100", text: "text-pink-700", bgHex: "#fce7f3" },
    { shade: "보통",    bg: "bg-pink-200", text: "text-pink-800", bgHex: "#fbcfe8" },
    { shade: "진하게",  bg: "bg-pink-500", text: "text-white",    bgHex: "#ec4899" },
    { shade: "매우 진함", bg: "bg-pink-700", text: "text-white",  bgHex: "#be185d" },
  ]},
  { name: "하늘", shades: [
    { shade: "연하게",  bg: "bg-sky-50",  text: "text-sky-700", bgHex: "#f0f9ff" },
    { shade: "살짝",    bg: "bg-sky-100", text: "text-sky-700", bgHex: "#e0f2fe" },
    { shade: "보통",    bg: "bg-sky-200", text: "text-sky-800", bgHex: "#bae6fd" },
    { shade: "진하게",  bg: "bg-sky-500", text: "text-white",   bgHex: "#0ea5e9" },
    { shade: "매우 진함", bg: "bg-sky-700", text: "text-white", bgHex: "#0369a1" },
  ]},
  { name: "남색", shades: [
    { shade: "연하게",  bg: "bg-indigo-50",  text: "text-indigo-700", bgHex: "#eef2ff" },
    { shade: "살짝",    bg: "bg-indigo-100", text: "text-indigo-700", bgHex: "#e0e7ff" },
    { shade: "보통",    bg: "bg-indigo-200", text: "text-indigo-800", bgHex: "#c7d2fe" },
    { shade: "진하게",  bg: "bg-indigo-500", text: "text-white",      bgHex: "#6366f1" },
    { shade: "매우 진함", bg: "bg-indigo-700", text: "text-white",    bgHex: "#4338ca" },
  ]},
];

// 하위 호환 — 기존 OPTION_COLOR_PALETTE 사용처가 있으므로 "보통" 농도로 flatten한 10개
export const OPTION_COLOR_PALETTE = OPTION_COLOR_FAMILIES.map((f) => ({
  name: f.name,
  bg: f.shades[2].bg,
  text: f.shades[2].text,
  hex: f.shades[2].bgHex,
}));

export type CustomOptionColor = { bg: string; text: string };

function loadCustomOptions(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(CUSTOM_OPTIONS_KEY) || "{}"); } catch { return {}; }
}

function loadHiddenOptions(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(HIDDEN_OPTIONS_KEY) || "{}"); } catch { return {}; }
}

function loadCustomColors(): Record<string, CustomOptionColor> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY) || "{}"); } catch { return {}; }
}

export function getFieldOptions(fieldKey: string): string[] {
  const base = FIELD_OPTIONS[fieldKey] || [];
  const custom = loadCustomOptions()[fieldKey] || [];
  const hidden = new Set(loadHiddenOptions()[fieldKey] || []);
  const merged = [...base, ...custom.filter((o) => !base.includes(o))];
  return merged.filter((o) => !hidden.has(o));
}

export function addCustomOption(fieldKey: string, optionName: string): void {
  const custom = loadCustomOptions();
  if (!custom[fieldKey]) custom[fieldKey] = [];
  if (!custom[fieldKey].includes(optionName)) {
    custom[fieldKey].push(optionName);
    localStorage.setItem(CUSTOM_OPTIONS_KEY, JSON.stringify(custom));
    pushToServer("customOptions", custom);
  }
  // 숨김 목록에 있다면 제거 (재추가 시 다시 보이도록)
  const hidden = loadHiddenOptions();
  if (hidden[fieldKey]?.includes(optionName)) {
    hidden[fieldKey] = hidden[fieldKey].filter((o) => o !== optionName);
    localStorage.setItem(HIDDEN_OPTIONS_KEY, JSON.stringify(hidden));
    pushToServer("hiddenOptions", hidden);
  }
}

export function removeCustomOption(fieldKey: string, optionName: string): void {
  // custom으로 추가된 옵션이면 직접 제거, 기본(FIELD_OPTIONS) 옵션이면 hidden 목록에 추가
  const base = FIELD_OPTIONS[fieldKey] || [];
  if (base.includes(optionName)) {
    const hidden = loadHiddenOptions();
    if (!hidden[fieldKey]) hidden[fieldKey] = [];
    if (!hidden[fieldKey].includes(optionName)) {
      hidden[fieldKey].push(optionName);
      localStorage.setItem(HIDDEN_OPTIONS_KEY, JSON.stringify(hidden));
      pushToServer("hiddenOptions", hidden);
    }
  } else {
    const custom = loadCustomOptions();
    if (!custom[fieldKey]) return;
    custom[fieldKey] = custom[fieldKey].filter((o) => o !== optionName);
    localStorage.setItem(CUSTOM_OPTIONS_KEY, JSON.stringify(custom));
    pushToServer("customOptions", custom);
  }
}

export function getOptionColor(optionName: string): CustomOptionColor | null {
  const colors = loadCustomColors();
  return colors[optionName] || null;
}

export function setOptionColor(optionName: string, color: CustomOptionColor): void {
  const colors = loadCustomColors();
  colors[optionName] = color;
  localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors));
  pushToServer("customColors", colors);
}

export function getOptionColorClass(optionName: string, statusColors?: Record<string, string>, badgeColors?: Record<string, string>): string {
  const custom = getOptionColor(optionName);
  if (custom) return `${custom.bg} ${custom.text}`;
  if (statusColors?.[optionName]) return statusColors[optionName];
  if (badgeColors?.[optionName]) return badgeColors[optionName];
  return "bg-wedly-bg-gray text-wedly-t1";
}
