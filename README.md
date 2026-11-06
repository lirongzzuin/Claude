# Slack → API → Google Sheets 자동 기입 봇

> Slack 채널에 올라온 "할당실패건 삭제요청" 메시지에서 주문번호를 뽑아, 외부 API로 주문 정보를 조회하고 Google Sheets에 기록한 뒤 결과를 Slack으로 알려 주는 Google Apps Script 봇
> 1인 개발 · 2026.03

`Google Apps Script` `Slack Events API` `Slack Block Kit` `Google Sheets` `Node.js(테스트)` `Python(테스트)`

---

## 무엇을 해결하나

운영 채널에 정해진 양식(`[내용]` 섹션에 주문번호 목록)으로 올라오는 요청을 사람이 주문번호마다 조회해 시트에 옮겨 적는 대신,
봇이 아래 과정을 자동으로 처리합니다.

1. Slack 메시지에서 트리거 문구를 감지하고
2. `[내용]` 섹션에서 `YYYYMMDD-NNNNNNN` 형식의 주문번호를 중복 없이 추출한 뒤
3. 주문번호마다 외부 API를 조회해 (실패 시 재시도)
4. 응답 JSON을 설정한 컬럼 순서대로 시트에 추가하거나 기존 행을 갱신하고
5. 성공·실패 건수와 실패 사유를 Block Kit 메시지로 다시 채널에 알립니다.

## 아키텍처

```
Slack 채널 ── Events API(message.channels) ──▶ GAS Web App  doPost(e)
                                                 │  url_verification 챌린지 응답
                                                 ▼
                                   processSlackEvent_  (채널·키워드·봇 메시지 필터)
                                                 │
                     parseOrderNumbers_ ─▶ fetchWithRetry_ ─▶ writeToSheet_
                     ([내용] 섹션 정규식)   (인증 헤더·HTTP 코드별 오류)  (헤더 자동 생성·중복 행 갱신)
                                                 │
                                   _sendCompletionNotice / _handleError ──▶ Slack chat.postMessage
```

- 런타임 의존성 없이 GAS 내장 API(`UrlFetchApp`, `SpreadsheetApp`, `ContentService`, `Utilities`)만 사용합니다.
- 사용자가 고칠 곳은 파일 상단 `CONFIG` 한 곳으로 모았습니다.

## 기술적으로 집중한 부분

**어떤 API에도 붙일 수 있는 설정 구조**
- 문제: 조회 대상 API의 응답 구조와 인증 방식이 정해져 있지 않았습니다.
- 해결: `FIELD_MAP`에 `'customer.name'`처럼 점 표기 경로를 적으면 `getNestedValue_`가 중첩 JSON에서 값을 꺼내 시트 컬럼으로 옮깁니다. 인증은 `AUTH_TYPE`(`BEARER` · `API_KEY` · `BASIC` · `NONE`)에 따라 `buildAuthHeaders_`가 헤더를 만듭니다.
- 결과: 코드 수정 없이 설정만 바꿔 다른 API·다른 시트 양식에 적용할 수 있습니다.

**실패를 조용히 삼키지 않는 오류 처리**
- 문제: 웹훅으로 도는 스크립트는 실패해도 사용자가 알기 어렵습니다.
- 해결: 오류를 `PARSE` · `API` · `SHEETS` · `SYSTEM`으로 나누고, HTTP 401/403·404·5xx를 각각 다른 메시지로 바꿉니다. 주문번호별로 성공·실패를 모아 한 번에 요약해 보내고, 실패 건에는 사유를 붙입니다.
- 결과: 일부 주문만 실패해도 나머지는 처리되고, 무엇을 다시 봐야 하는지 채널에서 바로 알 수 있습니다.

**중복 기입 방지**
- `UPDATE_IF_DUPLICATE`가 켜져 있으면 `DUPLICATE_CHECK_COLUMN`(기본: 주문번호) 기준으로 기존 행을 찾아 덮어쓰고, 없으면 새 행을 추가합니다. 같은 요청이 두 번 올라와도 시트에 중복 행이 생기지 않습니다.

## 품질 / 테스트

GAS 코드는 로컬에서 실행할 수 없어서, 핵심 로직(키워드 감지, 주문번호 추출, 중첩 필드 추출, 행 변환 등)을 Node.js와 Python으로 옮긴 테스트 스크립트를 두었습니다.

| 스크립트 | 검사 항목 | 결과 |
|---|---|---|
| `slack-to-sheets/test.js` | 16개 | 16개 통과 |
| `slack-to-sheets/test.py` | 35개 (HTTP 오류 코드별 처리, 재시도 시뮬레이션, 완료 알림 블록 구조 포함) | 35개 통과 |

```bash
node slack-to-sheets/test.js
python3 slack-to-sheets/test.py
```

테스트 쪽 함수는 `Code.gs`를 옮겨 적은 것이라, 로직을 바꾸면 양쪽을 함께 고쳐야 합니다.

## 실행 방법

빌드 단계는 없습니다. 자세한 설치 순서는 [slack-to-sheets/README.md](slack-to-sheets/README.md)에 있습니다.

1. [script.google.com](https://script.google.com)에서 새 프로젝트를 만들고 `slack-to-sheets/Code.gs` 내용을 붙여넣습니다.
2. `CONFIG`의 Slack 봇 토큰, 채널 ID, API 주소·인증 값, `FIELD_MAP`, 스프레드시트 ID를 채웁니다.
3. 웹 앱으로 배포하고, 받은 URL을 Slack App의 Event Subscriptions Request URL에 등록합니다 (`message.channels` 구독, `channels:history` · `channels:read` · `chat:write` 권한).
4. GAS 에디터에서 `testWithSampleMessage`를 실행하면 주문번호 추출을 로그로 확인할 수 있습니다.

## 설정

| 항목 | 위치 |
|---|---|
| Slack 봇 토큰 · 감지 채널 · 트리거 문구 · 알림 채널 | `CONFIG.SLACK` |
| API 주소 · 쿼리 파라미터 · 인증 방식 · 재시도 | `CONFIG.API` |
| API 응답 → 시트 컬럼 매핑 | `CONFIG.FIELD_MAP` |
| 스프레드시트 ID · 시트 이름 · 중복 처리 | `CONFIG.SHEETS` |

저장소의 값은 모두 플레이스홀더입니다. 실제 토큰은 저장소에 올리지 마세요. 운영에서는 GAS의 스크립트 속성(`PropertiesService`)에 두는 편이 안전합니다.

## 개발 방식

Claude Code와 함께 설계·구현했습니다 (커밋의 `Co-Authored-By` 참고).
