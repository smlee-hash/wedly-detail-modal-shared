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

## 이름표(scope) 분리 원칙

같은 부품을 여러 페이지에서 쓸 때, 각 페이지가 **자기 이름표**를 전달합니다.
- 컬럼 순서·숨김·섹션 매핑·스코어카드 등 화면 설정은 **이름표 단위로 별도 저장**
- 행 데이터(미팅·정산·컬럼 값)는 **같은 DB 공유**

## 위들리 디자인 토큰

부품은 위들리 디자인 토큰 클래스(예: `bg-wedly-accent`, `border-wedly-bd`)를 사용합니다.
사용하는 앱의 `globals.css` 에 위들리 토큰 변수가 정의되어 있어야 합니다.
