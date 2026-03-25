# Slack → API → Google Sheets 자동 기입 봇

## 설치 순서

### 1단계: Google Apps Script 프로젝트 생성
1. [script.google.com](https://script.google.com) 접속
2. **새 프로젝트** 클릭
3. `Code.gs` 내용을 전체 복사 → 붙여넣기
4. 프로젝트 저장 (Ctrl+S)

### 2단계: CONFIG 수정
`Code.gs` 상단의 `CONFIG` 섹션에서 아래 4가지를 수정합니다.

| 항목 | 위치 | 설명 |
|------|------|------|
| Slack Bot Token | `CONFIG.SLACK.BOT_TOKEN` | `xoxb-...` 형태 |
| 감지 채널 ID | `CONFIG.SLACK.TARGET_CHANNEL_ID` | 채널 우클릭 > ID 복사 |
| API URL | `CONFIG.API.BASE_URL` | 조회할 API 주소 |
| 인증 방식/값 | `CONFIG.API.AUTH_TYPE` / `AUTH_VALUE` | BEARER, API_KEY 등 |
| 필드 매핑 | `CONFIG.FIELD_MAP` | API 응답 필드 → 시트 컬럼 |
| 스프레드시트 ID | `CONFIG.SHEETS.SPREADSHEET_ID` | URL에서 복사 |

### 3단계: Web App 배포
1. GAS 에디터 상단 **배포** > **새 배포** 클릭
2. 유형: **웹 앱** 선택
3. 설정:
   - 설명: `Slack Bot`
   - 실행 계정: **나**
   - 액세스 권한: **모든 사용자**
4. **배포** 클릭 → **웹 앱 URL** 복사

### 4단계: Slack App 설정
1. [api.slack.com/apps](https://api.slack.com/apps) 접속
2. **Create New App** > From scratch
3. **Event Subscriptions** 메뉴:
   - Enable Events: **ON**
   - Request URL: 3단계에서 복사한 **웹 앱 URL** 입력
   - Subscribe to bot events: `message.channels` 추가
4. **OAuth & Permissions** 메뉴:
   - Bot Token Scopes: `channels:history`, `channels:read` 추가
5. 앱을 워크스페이스에 **설치** → Bot Token 복사 → CONFIG에 붙여넣기
6. 감지할 채널에 봇 초대: `/invite @봇이름`

---

## FIELD_MAP 수정 방법

API 응답 JSON이 아래와 같다면:
```json
{
  "order_id": "20260101-0000001",
  "customer": {
    "name": "홍길동",
    "phone": "010-1234-5678"
  },
  "status": "FAILED",
  "amount": 50000
}
```

`FIELD_MAP`을 이렇게 설정하세요:
```javascript
FIELD_MAP: [
  { key: 'order_id',       header: '주문번호' },
  { key: 'customer.name',  header: '고객명'   },  // 중첩 필드는 점(.)으로 연결
  { key: 'customer.phone', header: '연락처'   },
  { key: 'status',         header: '상태'     },
  { key: 'amount',         header: '금액'     },
],
```

---

## 동작 확인 (테스트)
GAS 에디터에서 `testWithSampleMessage` 함수를 선택 후 **실행**하면
주문번호 추출이 정상 동작하는지 로그에서 확인할 수 있습니다.
