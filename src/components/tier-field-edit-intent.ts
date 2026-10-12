/**
 * 사용자가 차수 칸을 직접 고친 한 번의 확정(commit)을 나타내는 클라이언트 의도.
 *
 * 렌더·새로고침·자동 계산·차수 추가/삭제/이름 변경 같은 저장에는 붙지 않는다.
 * 이 값은 "이 칸을 사람이 고쳤다"는 주장일 뿐이다 — 누가(actor)·어느 회사(owner)·무슨 기준(basis)·
 * 권한이 있는지는 담지 않으며, 그 판단은 받는 쪽(부모 앱·서버)이 따로 한다.
 */

/** 이전 값 — 저장본에 그 칸이 아예 없던 것(present:false)과 null·빈 글자·0 이 있던 것을 구분한다. */
export type TierFieldEditPrevious =
  | { present: false }
  | { present: true; value: string | number | boolean | null };

export type TierFieldEditIntentV1 = {
  version: 1;
  /** 확정 한 번마다 새로 만드는 UUID v4 */
  requestId: string;
  /** field=일반 칸 값, override=수식 칸 수동값 지정, restore=수동값 해제(수식값으로 복원) */
  kind: "field" | "override" | "restore";
  /** 저장본에 있는 차수의 id (화면 순서·역순 번호가 아님) */
  tierId: string;
  /** 저장소 키. override·restore 는 실제 저장 키(예: `_ovr_FOO`) */
  fieldKey: string;
  previous: TierFieldEditPrevious;
};

/** 차수 id → 마지막으로 저장된(또는 불러온) 그 차수의 원본 모양. id 가 겹치면 null(주인을 알 수 없음). */
export type TierPersistedShapes = ReadonlyMap<string, Readonly<Record<string, unknown>> | null>;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/** 안전한 난수로 UUID v4 를 만든다. 쓸 수 없으면 null — Math.random 으로 대신하지 않는다. */
function randomUuidV4(): string | null {
  try {
    const c = (globalThis as { crypto?: Partial<Crypto> }).crypto;
    if (typeof c?.randomUUID === "function") {
      const id = c.randomUUID();
      if (UUID_V4.test(id)) return id;
    }
    if (typeof c?.getRandomValues === "function") {
      const b = c.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
  } catch {
    /* 안전한 난수를 못 쓰면 의도를 만들지 않는다 */
  }
  return null;
}

/** 저장 문자열(JSON) 또는 배열에서 차수 목록을 꺼낸다. 비었거나 깨졌거나 배열이 아니면 빈 목록. */
function readTierList(raw: unknown): unknown[] {
  if (typeof raw === "string") {
    if (raw.trim() === "") return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

/**
 * 차수 목록의 원본 모양을 id 별로 기록한다.
 *
 * 화면용 차수(parseTiers)는 없던 칸을 null 로, 빈 글자를 null 로 바꾸므로 "이전 값이 원래 있었는지"는
 * 거기서 읽을 수 없다. 그래서 정규화하기 전 원본(불러온 값 · 방금 보낸 JSON)을 따로 얕게 복사해 둔다.
 * 문자열 id 가 없는 항목은 기록하지 않는다 — 화면이 붙인 임시 id 로 주인을 지어내지 않기 위해서다.
 */
export function snapshotPersistedTiers(raw: unknown): TierPersistedShapes {
  const shapes = new Map<string, Record<string, unknown> | null>();
  for (const item of readTierList(raw)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = hasOwn(item, "id") ? (item as { id?: unknown }).id : undefined;
    if (typeof id !== "string" || id === "") continue;
    shapes.set(id, shapes.has(id) ? null : { ...(item as Record<string, unknown>) });
  }
  return shapes;
}

function previousOf(
  shape: Readonly<Record<string, unknown>>,
  key: string,
): TierFieldEditPrevious | undefined {
  if (!hasOwn(shape, key)) return { present: false };
  const value = shape[key];
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) {
    return { present: true, value };
  }
  return undefined;
}

/**
 * 확정 한 번의 의도를 만든다. 반드시 값을 바꾸기 **전에** 부른다.
 *
 * 차수 자리(index)에서 실제 id 를 읽고, 그 id 가 목록에서 하나뿐이며 저장본 모양이 있을 때만 만든다.
 * 안전하게 정할 수 없으면(id 없음·겹침·저장본 없음·이전 값이 단순 값이 아님·안전한 난수 없음)
 * undefined — 의도를 지어내지 않는다. restore 는 실제로 지워진 수동값이 있을 때만 만든다.
 */
export function createTierFieldEditIntent(input: {
  kind: TierFieldEditIntentV1["kind"];
  tiers: ReadonlyArray<{ id?: unknown }>;
  index: number;
  fieldKey: string;
  shapes: TierPersistedShapes;
}): TierFieldEditIntentV1 | undefined {
  const { kind, tiers, index, fieldKey, shapes } = input;
  const tierId = tiers[index]?.id;
  if (typeof tierId !== "string" || tierId === "") return undefined;
  if (fieldKey === "" || fieldKey === "id") return undefined;
  if (tiers.filter((t) => t?.id === tierId).length !== 1) return undefined;
  const shape = shapes.get(tierId);
  if (!shape) return undefined;
  const previous = previousOf(shape, fieldKey);
  if (!previous) return undefined;
  if (kind === "restore" && !previous.present) return undefined;
  const requestId = randomUuidV4();
  if (!requestId) return undefined;
  return Object.freeze({
    version: 1 as const,
    requestId,
    kind,
    tierId,
    fieldKey,
    previous: Object.freeze(previous),
  });
}
