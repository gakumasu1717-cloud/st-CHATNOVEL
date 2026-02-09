# 📖 Chat Novel — SillyTavern Extension

> SillyTavern 채팅을 웹소설 형태로 읽는 리더 확장

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-AGPL--3.0-green)

## 기능

### 🔖 웹소설 리더
- ST 위에 **전체화면 오버레이** (z-index 최상위)
- 위→아래 **연속 스크롤** (리디/카카페 스타일)  
- **상단 프로그레스 바** (읽기 진행률)
- 현재 위치 **자동 저장** (다시 열면 이어 읽기)
- **Space/PageDown** = 페이지 단위 스크롤, **↑↓** = 일반 스크롤

### 📚 사이드바 네비게이션
- 좌측 접이식 사이드바
- 챕터 목록 — 클릭하면 해당 위치로 점프
- 현재 챕터 하이라이트
- **텍스트 검색** → 결과 위치로 이동

### 💬 텍스트 처리
- 유저 + 캐릭터 메시지 모두 표시
- 시스템/OOC 메시지도 포함
- **마크다운 렌더링** (`#`, `**`, `*`, `` ` ``, etc.)
- `{{user}}` / `{{char}}` 매크로 자동 치환
- **대사 감지** — `"쌍따옴표"`, `「꺽쇠」`, `'작은따옴표'` 등 자동 스타일링

### 🔧 정규식 엔진 연동
- ST에 등록된 **모든 정규식** 자동 읽기 & 적용
- `{{img::파일명}}` → 이미지 삽입 + **라이트박스**
- `<choices>` → **선택지 카드 UI** (읽기 전용)
- 상태창, 커스텀 서식 등 모든 regex 변환 포함

### 🎨 테마 4종
| 테마 | 배경 | 참고 |
|------|------|------|
| 다크 노블 (기본) | `#0f0f14` | 리디북스 다크 |
| 라이트 클래식 | `#faf8f5` | 리디북스 라이트 |
| 세피아 빈티지 | `#f4ecd8` | 종이 질감 |
| 미드나잇 블루 | `#0d1117` | 카카페 다크 |

### ⚙️ 커스터마이징
- **폰트 크기** (12~24px 슬라이더)
- **줄간격** (1.4~2.4)
- **본문 너비** (500~900px)
- **폰트 패밀리** (고딕 / 명조)
- **대사 스타일링** on/off
- **이미지 표시** on/off

### 📤 HTML 내보내기
- **단일 HTML 파일** — CSS/JS 인라인 (외부 의존성 없음)
- 사이드바 네비게이션, 테마, 프로그레스 바 포함
- 이미지 처리: **Base64 임베드** 또는 **URL 참조**
- 오프라인 브라우저로 열기 가능

### 📖 챕터 자동 분할
- **메시지 수 기반** (기본 20, 사용자 설정)
- **시간 간격 기반** (N시간 이상이면 새 챕터)
- 설정에서 조합 또는 끄기 가능

---

## 설치

### 방법 1: ST 내부 설치 (권장)
1. SillyTavern에서 **Extensions** → **Install Extension** 클릭
2. URL 입력: `https://github.com/gakumasu1717-cloud/st-CHATNOVEL`
3. 설치 완료 후 새로고침

### 방법 2: 수동 설치
```bash
cd SillyTavern/data/<user-handle>/extensions
git clone https://github.com/gakumasu1717-cloud/st-CHATNOVEL.git
```
SillyTavern 새로고침

### 방법 3: 전체 사용자 설치
```bash
cd SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/gakumasu1717-cloud/st-CHATNOVEL.git
```

---

## 사용법

### 열기
- 채팅 화면에서 **📖 아이콘** 클릭
- 또는 슬래시 커맨드: `/novel`

### 키보드 단축키
| 키 | 동작 |
|----|------|
| `Space` / `PageDown` | 한 페이지 아래 스크롤 |
| `PageUp` | 한 페이지 위 스크롤 |
| `↑` / `↓` | 일반 스크롤 |
| `Home` / `End` | 처음 / 끝으로 |
| `ESC` | 리더 닫기 |

### UI 버튼
| 버튼 | 기능 |
|------|------|
| `≡` | 사이드바 토글 |
| `🎨` | 테마 변경 |
| `⚙️` | 설정 패널 |
| `📤` | HTML 내보내기 |
| `✕` | 리더 닫기 |

---

## 파일 구조

```
st-CHATNOVEL/
├── manifest.json           # 확장 메타데이터
├── index.js                # 진입점, ST 이벤트 훅
├── src/
│   ├── parser.js           # JSONL 파싱
│   ├── regexEngine.js      # ST 정규식 읽기 & 변환 실행
│   ├── imageHandler.js     # 이미지 감지 & 렌더링 & 라이트박스
│   ├── chapterizer.js      # 챕터 분할
│   ├── renderer.js         # 마크다운 + 대사 감지 → HTML
│   ├── reader.js           # 리더 UI 컨트롤러
│   ├── sidebar.js          # 사이드바 네비게이션 & 검색
│   ├── themes.js           # 테마 관리
│   ├── exporter.js         # HTML 내보내기
│   └── settings.js         # 설정 관리
├── styles/
│   └── reader.css          # 리더 스타일시트
└── README.md
```

---

## 코드 흐름

```
[사용자가 📖 클릭 or /novel 입력]
        │
        ▼
① context.chat 로드 (현재 채팅)
        │
        ▼
② 메시지 파싱 (parser.js)
   - swipe_id로 현재 swipe 선택
   - send_date 정규화
   - {{user}}/{{char}} 매크로 치환
        │
        ▼
③ ST 정규식 로드 & 적용 (regexEngine.js)
   - extensionSettings.regex 읽기
   - 각 메시지에 정규식 순차 적용
   - {{img::X}} → <img>, <choices> → HTML 카드 등
        │
        ▼
④ 마크다운 렌더링 (renderer.js)
   - # → <h1>, ** → <strong>, * → <em> 등
   - 대사 패턴 감지 & 스타일 래핑
        │
        ▼
⑤ 챕터 분할 (chapterizer.js)
   - 메시지 수 / 시간 간격 기준
        │
        ▼
⑥ 리더 UI 렌더링 (reader.js)
   - 오버레이 생성
   - 사이드바 + 본문 + 프로그레스 바
   - 테마 / 타이포그래피 적용
        │
        ▼
⑦ (선택) HTML 내보내기 (exporter.js)
   - 변환 완료된 HTML을 단일 파일로 패키징
   - 이미지 base64 변환 (선택)
```

---

## 호환성

- **SillyTavern** 1.12.0 이상 권장
- 모던 브라우저 (Chrome, Firefox, Edge, Safari)
- 모바일 반응형 지원

---

## 라이센스

AGPL-3.0

---

## 기여

이슈, PR, 제안 환영합니다!
