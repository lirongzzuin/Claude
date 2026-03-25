// ============================================================
//  Slack → API 조회 → Google Sheets 자동 기입 봇
//  수정이 필요한 부분은 아래 [CONFIG] 섹션만 변경하세요.
// ============================================================


// ============================================================
// [CONFIG] ← 여기만 수정하면 됩니다
// ============================================================
const CONFIG = {

  // ----------------------------------------------------------
  // 1. Slack 설정
  // ----------------------------------------------------------
  SLACK: {
    // Slack Bot Token (Slack App > OAuth & Permissions > Bot User OAuth Token)
    BOT_TOKEN: 'xoxb-YOUR-SLACK-BOT-TOKEN',

    // 감지할 채널 ID (Slack 채널 우클릭 > 채널 ID 복사)
    // 비워두면 모든 채널에서 감지
    TARGET_CHANNEL_ID: 'C0XXXXXXXXX',

    // 감지할 메시지 키워드 (이 문구가 포함된 메시지만 처리)
    TRIGGER_KEYWORD: '할당실패건 삭제요청',

    // 오류/완료 알림을 받을 채널 ID (감지 채널과 다르게 설정 가능)
    // 비워두면 원본 메시지 채널로 알림 전송
    NOTIFY_CHANNEL_ID: '',
  },

  // ----------------------------------------------------------
  // 2. 외부 API 설정
  // ----------------------------------------------------------
  API: {
    // 조회할 API의 기본 URL
    BASE_URL: 'https://api.example.com/v1/orders',

    // 주문번호를 전달하는 쿼리 파라미터명
    QUERY_PARAM: 'id',

    // 인증 방식: 'API_KEY' | 'BEARER' | 'BASIC' | 'NONE'
    AUTH_TYPE: 'BEARER',

    // 인증 값
    // - AUTH_TYPE이 'API_KEY'  → API Key 값
    // - AUTH_TYPE이 'BEARER'   → Bearer Token 값
    // - AUTH_TYPE이 'BASIC'    → 'username:password' 형태
    // - AUTH_TYPE이 'NONE'     → 비워두세요
    AUTH_VALUE: 'YOUR-API-TOKEN',

    // API Key 방식일 때 헤더명
    API_KEY_HEADER: 'x-api-key',

    // 추가 헤더 (없으면 {} 로 두세요)
    EXTRA_HEADERS: {},

    // API 실패 시 재시도 횟수 (0 = 재시도 없음)
    RETRY_COUNT: 2,

    // 재시도 대기 시간 (밀리초)
    RETRY_DELAY_MS: 1000,
  },

  // ----------------------------------------------------------
  // 3. API 응답 → Sheets 컬럼 매핑
  //    key   : API 응답 JSON의 필드명 (중첩은 'a.b.c' 형태로)
  //    header: 시트에 표시할 컬럼 헤더명
  // ----------------------------------------------------------
  FIELD_MAP: [
    { key: 'order_id',      header: '주문번호'  },
    { key: 'customer_name', header: '고객명'    },
    { key: 'brand',         header: '브랜드'    },
    { key: 'channel',       header: '채널'      },
    { key: 'status',        header: '상태'      },
    { key: 'amount',        header: '금액'      },
    { key: 'created_at',    header: '생성일시'  },
    // 중첩 필드 예시: { key: 'delivery.address', header: '배송지' },
  ],

  // ----------------------------------------------------------
  // 4. Google Sheets 설정
  // ----------------------------------------------------------
  SHEETS: {
    // 스프레드시트 ID (URL의 /d/ 다음 부분)
    SPREADSHEET_ID: 'YOUR-SPREADSHEET-ID',

    // 데이터를 기입할 시트(탭) 이름
    SHEET_NAME: '실패건관리',

    // 헤더 행 번호
    HEADER_ROW: 1,

    // 데이터 시작 행 번호
    DATA_START_ROW: 2,

    // true: 중복 주문번호는 기존 행 업데이트 / false: 항상 새 행 추가
    UPDATE_IF_DUPLICATE: true,

    // 중복 체크할 컬럼 헤더명
    DUPLICATE_CHECK_COLUMN: '주문번호',
  },

};
// ============================================================
// [CONFIG] 끝 - 아래는 수정 불필요
// ============================================================


// ============================================================
// 오류 타입 상수
// ============================================================
const ERROR_TYPE = {
  PARSE    : 'PARSE',    // 메시지 파싱 오류
  API      : 'API',      // 외부 API 호출 오류
  SHEETS   : 'SHEETS',   // Google Sheets 기입 오류
  SYSTEM   : 'SYSTEM',   // 예상치 못한 시스템 오류
};


// ============================================================
// Slack Event API Webhook 수신
// ============================================================
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      Logger.log('[doPost] 빈 요청 수신');
      return _response('EMPTY_REQUEST');
    }

    const payload = JSON.parse(e.postData.contents);

    // Slack URL 검증 챌린지 응답
    if (payload.type === 'url_verification') {
      return ContentService
        .createTextOutput(payload.challenge)
        .setMimeType(ContentService.MimeType.TEXT);
    }

    // 이벤트 처리
    if (payload.event) {
      processSlackEvent_(payload.event);
    }

    return _response('OK');

  } catch (err) {
    Logger.log('[doPost 시스템 오류] ' + err.message + '\n' + err.stack);
    return _response('ERROR');
  }
}


// ============================================================
// Slack 이벤트 처리
// ============================================================
function processSlackEvent_(event) {
  // 메시지 이벤트 & 일반 사용자 메시지만 처리
  if (event.type !== 'message' || event.subtype || event.bot_id) return;

  const text      = event.text    || '';
  const channelId = event.channel || '';

  // 채널 필터
  if (CONFIG.SLACK.TARGET_CHANNEL_ID && channelId !== CONFIG.SLACK.TARGET_CHANNEL_ID) return;

  // 트리거 키워드 감지
  if (!text.includes(CONFIG.SLACK.TRIGGER_KEYWORD)) return;

  Logger.log('[감지] 트리거 메시지 수신 | 채널: ' + channelId);

  // 알림 채널 결정 (설정값 우선, 없으면 원본 채널)
  const notifyChannelId = CONFIG.SLACK.NOTIFY_CHANNEL_ID || channelId;

  // 처리 시작 알림
  _sendSlack(notifyChannelId, [
    { type: 'section', text: { type: 'mrkdwn', text: ':hourglass_flowing_sand: *할당실패건 처리 시작*\n메시지를 분석 중입니다...' } },
  ]);

  // 주문번호 추출
  let orderNumbers;
  try {
    orderNumbers = parseOrderNumbers_(text);
  } catch (err) {
    _handleError(notifyChannelId, ERROR_TYPE.PARSE, '주문번호 추출 실패', err);
    return;
  }

  if (orderNumbers.length === 0) {
    _sendSlack(notifyChannelId, [
      { type: 'section', text: { type: 'mrkdwn', text: ':warning: *주문번호를 찾을 수 없습니다*\n`[내용]` 섹션에 주문번호 형식(YYYYMMDD-NNNNNNN)이 있는지 확인해주세요.' } },
    ]);
    return;
  }

  Logger.log('[추출] ' + orderNumbers.length + '건: ' + orderNumbers.join(', '));

  // 결과 집계
  const results = { success: [], failed: [] };

  orderNumbers.forEach(function(orderNumber) {
    try {
      // API 조회 (재시도 포함)
      const apiData = fetchWithRetry_(orderNumber);

      if (!apiData) {
        results.failed.push({ id: orderNumber, reason: 'API 응답 데이터 없음' });
        return;
      }

      // Sheets 기입
      writeToSheet_(apiData);
      results.success.push(orderNumber);
      Logger.log('[완료] ' + orderNumber);

    } catch (err) {
      Logger.log('[처리 실패] ' + orderNumber + ' | ' + err.message);
      results.failed.push({ id: orderNumber, reason: err.message });
    }
  });

  // 처리 완료 알림 (성공/실패 요약)
  _sendCompletionNotice(notifyChannelId, results);
}


// ============================================================
// 주문번호 추출 (YYYYMMDD-NNNNNNN 패턴)
// ============================================================
function parseOrderNumbers_(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('파싱할 텍스트가 비어있거나 올바르지 않습니다.');
  }

  // [내용] 섹션만 추출 (없으면 전체 텍스트 사용)
  const contentMatch = text.match(/\[내용\]([\s\S]*?)(?:\[|$)/);
  const targetText   = contentMatch ? contentMatch[1] : text;

  const matches = targetText.match(/\d{8}-\d{7}/g);
  return matches ? [...new Set(matches)] : [];
}


// ============================================================
// 외부 API 조회 (재시도 로직 포함)
// ============================================================
function fetchWithRetry_(orderNumber) {
  const maxRetry = CONFIG.API.RETRY_COUNT;
  let lastError  = null;

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      if (attempt > 0) {
        Logger.log('[재시도] ' + orderNumber + ' (' + attempt + '/' + maxRetry + ')');
        Utilities.sleep(CONFIG.API.RETRY_DELAY_MS);
      }

      const result = fetchOrderData_(orderNumber);
      if (result) return result;

    } catch (err) {
      lastError = err;
      Logger.log('[API 오류] 시도 ' + (attempt + 1) + ' | ' + err.message);
    }
  }

  // 모든 재시도 소진
  throw new Error(
    'API 조회 실패 (' + (maxRetry + 1) + '회 시도): ' + (lastError ? lastError.message : '응답 없음')
  );
}


// ============================================================
// 외부 API 단건 조회
// ============================================================
function fetchOrderData_(orderNumber) {
  const url = CONFIG.API.BASE_URL
    + '?' + CONFIG.API.QUERY_PARAM + '=' + encodeURIComponent(orderNumber);

  const options = {
    method            : 'get',
    muteHttpExceptions: true,
    headers           : buildAuthHeaders_(),
  };

  Logger.log('[API 요청] ' + url);

  let response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (err) {
    throw new Error('네트워크 오류: ' + err.message);
  }

  const code = response.getResponseCode();
  const body = response.getContentText();
  Logger.log('[API 응답] HTTP ' + code + ' | ' + body.substring(0, 200));

  // HTTP 상태 코드별 처리
  if (code === 200) {
    try {
      return JSON.parse(body);
    } catch (err) {
      throw new Error('API 응답 JSON 파싱 실패: ' + err.message);
    }
  } else if (code === 401 || code === 403) {
    throw new Error('인증 오류 (HTTP ' + code + '): API 토큰을 확인해주세요.');
  } else if (code === 404) {
    throw new Error('데이터 없음 (HTTP 404): 주문번호 ' + orderNumber + ' 조회 결과 없음');
  } else if (code >= 500) {
    throw new Error('API 서버 오류 (HTTP ' + code + '): 잠시 후 다시 시도하세요.');
  } else {
    throw new Error('예상치 못한 HTTP 상태 코드: ' + code);
  }
}


// ============================================================
// 인증 헤더 생성
// ============================================================
function buildAuthHeaders_() {
  const headers = Object.assign({}, CONFIG.API.EXTRA_HEADERS);

  switch (CONFIG.API.AUTH_TYPE) {
    case 'BEARER':
      headers['Authorization'] = 'Bearer ' + CONFIG.API.AUTH_VALUE;
      break;
    case 'API_KEY':
      headers[CONFIG.API.API_KEY_HEADER] = CONFIG.API.AUTH_VALUE;
      break;
    case 'BASIC':
      headers['Authorization'] = 'Basic ' + Utilities.base64Encode(CONFIG.API.AUTH_VALUE);
      break;
    case 'NONE':
    default:
      break;
  }

  return headers;
}


// ============================================================
// Google Sheets 기입
// ============================================================
function writeToSheet_(apiData) {
  if (!apiData || typeof apiData !== 'object') {
    throw new Error('API 응답 데이터가 유효하지 않습니다.');
  }

  let ss, sheet;

  try {
    ss    = SpreadsheetApp.openById(CONFIG.SHEETS.SPREADSHEET_ID);
    sheet = ss.getSheetByName(CONFIG.SHEETS.SHEET_NAME);
  } catch (err) {
    throw new Error('스프레드시트 접근 실패: ' + err.message);
  }

  if (!sheet) {
    throw new Error('시트를 찾을 수 없습니다: "' + CONFIG.SHEETS.SHEET_NAME + '"');
  }

  // 헤더 초기화
  ensureHeaders_(sheet);

  // FIELD_MAP 순서대로 값 추출
  const rowData = CONFIG.FIELD_MAP.map(function(field) {
    return getNestedValue_(apiData, field.key);
  });

  try {
    if (CONFIG.SHEETS.UPDATE_IF_DUPLICATE) {
      const existingRow = findDuplicateRow_(sheet, rowData);
      if (existingRow > 0) {
        sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
        Logger.log('[Sheets] 기존 행 업데이트: ' + existingRow + '행');
        return;
      }
    }
    sheet.appendRow(rowData);
    Logger.log('[Sheets] 새 행 추가 완료');
  } catch (err) {
    throw new Error('Sheets 기입 실패: ' + err.message);
  }
}


// ============================================================
// 헤더 행 자동 생성 (최초 1회)
// ============================================================
function ensureHeaders_(sheet) {
  const headers      = CONFIG.FIELD_MAP.map(function(f) { return f.header; });
  const headerRange  = sheet.getRange(CONFIG.SHEETS.HEADER_ROW, 1, 1, headers.length);
  const currentVals  = headerRange.getValues()[0];
  const isEmpty      = currentVals.every(function(v) { return v === ''; });

  if (isEmpty) {
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4a86e8');
    headerRange.setFontColor('#ffffff');
    Logger.log('[Sheets] 헤더 자동 생성 완료');
  }
}


// ============================================================
// 중복 행 탐색
// ============================================================
function findDuplicateRow_(sheet, rowData) {
  const colIndex = CONFIG.FIELD_MAP.findIndex(function(f) {
    return f.header === CONFIG.SHEETS.DUPLICATE_CHECK_COLUMN;
  });
  if (colIndex < 0) return -1;

  const checkValue = rowData[colIndex];
  const lastRow    = sheet.getLastRow();
  if (lastRow < CONFIG.SHEETS.DATA_START_ROW) return -1;

  const colValues = sheet.getRange(
    CONFIG.SHEETS.DATA_START_ROW,
    colIndex + 1,
    lastRow - CONFIG.SHEETS.DATA_START_ROW + 1,
    1
  ).getValues();

  for (let i = 0; i < colValues.length; i++) {
    if (String(colValues[i][0]) === String(checkValue)) {
      return CONFIG.SHEETS.DATA_START_ROW + i;
    }
  }

  return -1;
}


// ============================================================
// 중첩 JSON 필드 값 추출 ('a.b.c' → obj.a.b.c)
// ============================================================
function getNestedValue_(obj, keyPath) {
  if (!keyPath) return '';
  const result = keyPath.split('.').reduce(function(acc, key) {
    return (acc !== null && acc !== undefined) ? acc[key] : undefined;
  }, obj);
  return (result !== null && result !== undefined) ? result : '';
}


// ============================================================
// Slack 메시지 전송 (Block Kit 형식)
// ============================================================
function _sendSlack(channelId, blocks) {
  if (!channelId || !CONFIG.SLACK.BOT_TOKEN) {
    Logger.log('[Slack 알림 스킵] 채널 ID 또는 BOT_TOKEN 미설정');
    return;
  }

  const payload = {
    channel: channelId,
    blocks : blocks,
  };

  try {
    const response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
      method           : 'post',
      muteHttpExceptions: true,
      headers          : {
        'Authorization': 'Bearer ' + CONFIG.SLACK.BOT_TOKEN,
        'Content-Type' : 'application/json; charset=utf-8',
      },
      payload: JSON.stringify(payload),
    });

    const result = JSON.parse(response.getContentText());
    if (!result.ok) {
      Logger.log('[Slack 전송 실패] ' + result.error);
    }
  } catch (err) {
    Logger.log('[Slack 전송 오류] ' + err.message);
  }
}


// ============================================================
// 처리 완료 알림 (성공/실패 요약)
// ============================================================
function _sendCompletionNotice(channelId, results) {
  const total   = results.success.length + results.failed.length;
  const hasErr  = results.failed.length > 0;

  const blocks = [];

  // 헤더
  blocks.push({
    type: 'header',
    text: {
      type : 'plain_text',
      text : hasErr ? '⚠️ 할당실패건 처리 완료 (일부 오류)' : '✅ 할당실패건 처리 완료',
      emoji: true,
    },
  });

  // 요약
  blocks.push({
    type  : 'section',
    fields: [
      { type: 'mrkdwn', text: '*전체*\n' + total + '건' },
      { type: 'mrkdwn', text: '*성공*\n' + results.success.length + '건' },
      { type: 'mrkdwn', text: '*실패*\n' + results.failed.length + '건' },
    ],
  });

  // 성공 목록
  if (results.success.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':white_check_mark: *처리 완료*\n' + results.success.map(function(id) {
          return '`' + id + '`';
        }).join('  '),
      },
    });
  }

  // 실패 목록 (원인 포함)
  if (results.failed.length > 0) {
    blocks.push({ type: 'divider' });
    const failText = results.failed.map(function(f) {
      return ':x: `' + f.id + '`\n    _' + f.reason + '_';
    }).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: ':rotating_light: *처리 실패 목록*\n' + failText },
    });
  }

  // 타임스탬프
  blocks.push({ type: 'divider' });
  blocks.push({
    type   : 'context',
    elements: [{ type: 'mrkdwn', text: '처리 시각: ' + new Date().toLocaleString('ko-KR') }],
  });

  _sendSlack(channelId, blocks);
}


// ============================================================
// 오류 발생 시 Slack 알림
// ============================================================
function _handleError(channelId, errorType, context, err) {
  const msg = err ? err.message : '알 수 없는 오류';

  Logger.log('[' + errorType + ' 오류] ' + context + ' | ' + msg);
  if (err && err.stack) Logger.log(err.stack);

  const typeEmoji = {
    PARSE : ':mag:',
    API   : ':satellite:',
    SHEETS: ':spreadsheet:',
    SYSTEM: ':red_circle:',
  };

  _sendSlack(channelId, [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🚨 봇 오류 발생', emoji: true },
    },
    {
      type  : 'section',
      fields: [
        { type: 'mrkdwn', text: '*오류 유형*\n' + (typeEmoji[errorType] || '') + ' ' + errorType },
        { type: 'mrkdwn', text: '*발생 위치*\n' + context },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*오류 내용*\n```' + msg + '```' },
    },
    { type: 'divider' },
    {
      type    : 'context',
      elements: [{ type: 'mrkdwn', text: '발생 시각: ' + new Date().toLocaleString('ko-KR') }],
    },
  ]);
}


// ============================================================
// HTTP 응답 헬퍼
// ============================================================
function _response(text) {
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.TEXT);
}


// ============================================================
// [테스트용] GAS 에디터에서 직접 실행 가능
// ============================================================
function testWithSampleMessage() {
  const sampleText = [
    '할당실패건 삭제요청- 예시센터 B2C',
    '[고객사 / 브랜드 / 채널] 예시고객사',
    '[관련 번호] 20260101-0000001 외 11건',
    '[내용]',
    '1. 20260101-0000001',
    '2. 20260101-0000002',
    '3. 20260102-0000003',
    '4. 20260102-0000004',
    '5. 20260103-0000005',
  ].join('\n');

  Logger.log('=== 주문번호 추출 테스트 ===');
  const numbers = parseOrderNumbers_(sampleText);
  Logger.log('추출 결과: ' + JSON.stringify(numbers));
  Logger.log('총 ' + numbers.length + '건');
}
