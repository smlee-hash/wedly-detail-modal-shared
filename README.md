# @wedly/detail-modal-shared

WEDLY 하이브 협업 앱과 ERP 앱이 함께 쓰는 **DB 상세모달 부품 모음**입니다.

## 들어있는 부품
- `DetailModal` — DB 상세모달 본체 (상세 정보 / 히스토리 / 파일 패널)
- `MeetingsTab` — 차수 방문 일정 카드
- `SettlementInfoTab` — 정산 정보 + 스코어카드
- `CustomSelect` — 위들리 디자인 커스텀 드롭다운
- 어드민 전용 도구 (컬럼 추가·이동·숨김·삭제, 섹션 순서 드래그)

## 사용 방법

### 1. 설치
```bash
npm install git+https://github.com/smlee-hash/wedly-detail-modal-shared.git
```

또는 `package.json`:
```json
{
  "dependencies": {
    "@wedly/detail-modal-shared": "github:smlee-hash/wedly-detail-modal-shared"
  }
}
```

### 2. Next.js 설정
`next.config.ts` 에 추가:
```ts
const nextConfig = {
  transpilePackages: ["@wedly/detail-modal-shared"],
};
```

### 3. Tailwind 설정
`tailwind.config.js` 의 `content` 배열에 추가:
```js
content: [
  "./src/**/*.{js,ts,jsx,tsx}",
  "./node_modules/@wedly/detail-modal-shared/src/**/*.{js,ts,jsx,tsx}",
],
```

### 4. 사용
```tsx
import { DetailModal } from "@wedly/detail-modal-shared";

<DetailModal
  row={selectedRow}
  scope="hive-tax-amendment"  // 또는 "erp-tax-amendment"
  onClose={...}
  onUpdate={...}
  customColumns={...}
  // ... 기타 prop
/>
```

## 파일 행 줄 끝 자리(getRowExtras)

파일 목록(`FilesTab`)의 줄마다 상태 글·단추를 더하고, 제거와 분류 바꾸기를 막을 수 있습니다.
행마다 `getRowExtras` 가 돌려준 값을 그대로 따릅니다. 예를 들어 PPT 를 새로 만드는 중인 줄에
"디자인 중 · 8분" 같은 글과 「취소」 단추를 보여 줄 때 씁니다.

```tsx
<FilesTab
  files={files}
  getRowExtras={(file) => file.fileName.endsWith(".pptx")
    ? { sub: <span>디자인 중 · 8분</span>, action: <button type="button">취소</button>, removable: false, categoryLocked: true }
    : null}
/>
```

- `sub` — 이름 아래 줄을 이것으로 바꿉니다(올린 시각·`renderFileNote` 대신). 링크 안이라 누르는 요소는 넣지 않습니다.
- `action` — 이름 링크 바로 뒤, 크기 앞에 그대로 놓습니다. 감싸지 않으니 폭·줄임은 넘기는 쪽이 정합니다.
- `removable` — `false` 면 「파일 제거」 단추 대신 같은 폭(24px) 빈칸을 둬서 다른 줄과 열을 맞춥니다.
- `categoryLocked` — `true` 면 분류를 누를 수 없는 글로 보입니다(분류 이름은 그대로).

안 넘기거나 `null`·빈 객체면 그 줄은 지금과 똑같다(내려받기·파일 제거).

기존 끼움 자리와의 관계: `sub` 는 `renderFileNote` 보다 앞서고, `renderFileEditor` 가 그리는 행은 `getRowExtras` 를 무시합니다.

## 이름표(scope) 분리 원칙

같은 부품을 여러 페이지에서 쓸 때, 각 페이지가 **자기 이름표**를 전달합니다.
- 컬럼 순서·숨김·섹션 매핑·스코어카드 등 화면 설정은 **이름표 단위로 별도 저장**
- 행 데이터(미팅·정산·컬럼 값)는 **같은 DB 공유**

## 위들리 디자인 토큰

부품은 위들리 디자인 토큰 클래스(예: `bg-wedly-accent`, `border-wedly-bd`)를 사용합니다.
사용하는 앱의 `globals.css` 에 위들리 토큰 변수가 정의되어 있어야 합니다.
