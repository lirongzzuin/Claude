// ============================================================
// 로컬 테스트 스크립트 (Node.js)
// GAS 배포 전 핵심 로직 검증용
// ============================================================

const CONFIG = {
  SLACK: {
    TRIGGER_KEYWORD: '할당실패건 삭제요청',
    TARGET_CHANNEL_ID: 'C0XXXXXXXXX',
  },
  FIELD_MAP: [
    { key: 'order_id',      header: '주문번호' },
    { key: 'customer_name', header: '고객명'   },
    { key: 'brand',         header: '브랜드'   },
    { key: 'status',        header: '상태'     },
    { key: 'amount',        header: '금액'     },
    { key: 'delivery.address', header: '배송지' }, // 중첩 필드 테스트
  ],
};

// ── 테스트 대상 함수들 ────────────────────────────────────────

function parseOrderNumbers(text) {
  const contentMatch = text.match(/\[내용\]([\s\S]*?)(?:\[|$)/);
  const targetText   = contentMatch ? contentMatch[1] : text;
  const pattern      = /\d{8}-\d{7}/g;
  const matches      = targetText.match(pattern);
  return matches ? [...new Set(matches)] : [];
}

function getNestedValue(obj, keyPath) {
  if (!keyPath) return '';
  const result = keyPath.split('.').reduce((acc, key) => {
    return (acc !== null && acc !== undefined) ? acc[key] : undefined;
  }, obj);
  return (result !== null && result !== undefined) ? result : '';
}

function mapApiDataToRow(apiData) {
  return CONFIG.FIELD_MAP.map(field => getNestedValue(apiData, field.key));
}

// ── 테스트 케이스 ────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    console.log(`     기대값: ${JSON.stringify(expected)}`);
    console.log(`     실제값: ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── TEST 1: 트리거 키워드 감지 ───────────────────────────────
console.log('\n[TEST 1] 트리거 키워드 감지');

const msg1 = '할당실패건 삭제요청- 예시센터 B2C\n[내용]\n1. 20260101-0000001';
const msg2 = '일반 메시지입니다';
assert('트리거 포함 메시지 감지',   msg1.includes(CONFIG.SLACK.TRIGGER_KEYWORD), true);
assert('트리거 없는 메시지 미감지', msg2.includes(CONFIG.SLACK.TRIGGER_KEYWORD), false);

// ── TEST 2: 주문번호 추출 ─────────────────────────────────────
console.log('\n[TEST 2] 주문번호 추출');

const sampleMessage = `할당실패건 삭제요청- 예시센터 B2C
[고객사 / 브랜드 / 채널] 예시고객사
[관련 번호] 20260101-0000001 외 11건
[내용]
1. 20260101-0000001
2. 20260101-0000002
3. 20260102-0000003
4. 20260102-0000004
5. 20260103-0000005`;

const orderNumbers = parseOrderNumbers(sampleMessage);
assert('[내용] 섹션에서 5건 추출',     orderNumbers.length, 5);
assert('첫 번째 주문번호 정확성',       orderNumbers[0], '20260101-0000001');
assert('마지막 주문번호 정확성',        orderNumbers[4], '20260103-0000005');
assert('[관련 번호] 중복 제외 확인',    orderNumbers.filter(n => n === '20260101-0000001').length, 1);

// ── TEST 3: 주문번호 없는 경우 ────────────────────────────────
console.log('\n[TEST 3] 엣지 케이스');

const msgNoContent = '할당실패건 삭제요청 내용 없음';
assert('주문번호 없으면 빈 배열',       parseOrderNumbers(msgNoContent), []);

const msgNoSection = '할당실패건 삭제요청\n20260101-0000001 20260101-0000002';
assert('[내용] 섹션 없으면 전체 텍스트에서 추출', parseOrderNumbers(msgNoSection).length, 2);

// ── TEST 4: 중첩 필드 값 추출 ────────────────────────────────
console.log('\n[TEST 4] API 응답 필드 추출 (중첩 포함)');

const mockApiResponse = {
  order_id: '20260101-0000001',
  customer_name: '예시고객사',
  brand: '브랜드A',
  status: 'FAILED',
  amount: 150000,
  delivery: {
    address: '서울시 강남구',
  },
};

assert('단순 필드: order_id',            getNestedValue(mockApiResponse, 'order_id'), '20260101-0000001');
assert('단순 필드: status',              getNestedValue(mockApiResponse, 'status'), 'FAILED');
assert('중첩 필드: delivery.address',    getNestedValue(mockApiResponse, 'delivery.address'), '서울시 강남구');
assert('없는 필드: undefined 처리',      getNestedValue(mockApiResponse, 'nonexistent.field'), '');

// ── TEST 5: FIELD_MAP → 행 데이터 변환 ───────────────────────
console.log('\n[TEST 5] FIELD_MAP → 시트 행 변환');

const row = mapApiDataToRow(mockApiResponse);
assert('행 길이 = FIELD_MAP 길이',       row.length, CONFIG.FIELD_MAP.length);
assert('행[0] = 주문번호',               row[0], '20260101-0000001');
assert('행[3] = 상태',                   row[3], 'FAILED');
assert('행[5] = 배송지(중첩)',           row[5], '서울시 강남구');

// ── 결과 요약 ─────────────────────────────────────────────────
console.log('\n' + '='.repeat(50));
console.log(`결과: ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패`);
if (failed === 0) {
  console.log('모든 테스트 통과 ✅ GAS 배포 준비 완료');
} else {
  console.log('일부 테스트 실패 ❌ Code.gs 확인 필요');
}
console.log('='.repeat(50));
