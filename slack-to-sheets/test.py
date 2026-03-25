import re
import json

# ============================================================
# GAS 핵심 로직 + 예외처리 검증 (Python 포팅)
# ============================================================

TRIGGER_KEYWORD = '할당실패건 삭제요청'

FIELD_MAP = [
    {'key': 'order_id',          'header': '주문번호'},
    {'key': 'customer_name',     'header': '고객명'},
    {'key': 'brand',             'header': '브랜드'},
    {'key': 'status',            'header': '상태'},
    {'key': 'amount',            'header': '금액'},
    {'key': 'delivery.address',  'header': '배송지'},
]

# ── 테스트 대상 함수 ──────────────────────────────────────────

def parse_order_numbers(text):
    if not text or not isinstance(text, str):
        raise ValueError('파싱할 텍스트가 비어있거나 올바르지 않습니다.')
    content_match = re.search(r'\[내용\]([\s\S]*?)(?:\[|$)', text)
    target_text   = content_match.group(1) if content_match else text
    matches       = re.findall(r'\d{8}-\d{7}', target_text)
    return list(dict.fromkeys(matches))

def get_nested_value(obj, key_path):
    if not key_path:
        return ''
    keys   = key_path.split('.')
    result = obj
    for k in keys:
        if isinstance(result, dict) and k in result:
            result = result[k]
        else:
            return ''
    return result if result is not None else ''

def map_api_data_to_row(api_data):
    return [get_nested_value(api_data, f['key']) for f in FIELD_MAP]

# HTTP 상태 코드별 예외 처리 (GAS fetchOrderData_ 동일 로직)
def handle_http_error(code, order_number):
    if code == 200:
        return None  # 정상
    elif code in (401, 403):
        raise Exception(f'인증 오류 (HTTP {code}): API 토큰을 확인해주세요.')
    elif code == 404:
        raise Exception(f'데이터 없음 (HTTP 404): 주문번호 {order_number} 조회 결과 없음')
    elif code >= 500:
        raise Exception(f'API 서버 오류 (HTTP {code}): 잠시 후 다시 시도하세요.')
    else:
        raise Exception(f'예상치 못한 HTTP 상태 코드: {code}')

# ── 테스트 유틸 ───────────────────────────────────────────────

passed = 0
failed = 0

def assert_eq(label, actual, expected):
    global passed, failed
    if actual == expected:
        print(f'  ✅ {label}')
        passed += 1
    else:
        print(f'  ❌ {label}')
        print(f'     기대값: {json.dumps(expected, ensure_ascii=False)}')
        print(f'     실제값: {json.dumps(actual, ensure_ascii=False)}')
        failed += 1

def assert_raises(label, fn, expected_keyword):
    global passed, failed
    try:
        fn()
        print(f'  ❌ {label} (예외 발생 안 함)')
        failed += 1
    except Exception as e:
        if expected_keyword in str(e):
            print(f'  ✅ {label}')
            passed += 1
        else:
            print(f'  ❌ {label}')
            print(f'     기대 키워드: {expected_keyword}')
            print(f'     실제 메시지: {str(e)}')
            failed += 1


# ── TEST 1: 트리거 키워드 감지 ───────────────────────────────
print('\n[TEST 1] 트리거 키워드 감지')

msg1 = '할당실패건 삭제요청- 예시센터 B2C\n[내용]\n1. 20260101-0000001'
msg2 = '일반 메시지입니다'
assert_eq('트리거 포함 메시지 감지',   TRIGGER_KEYWORD in msg1, True)
assert_eq('트리거 없는 메시지 미감지', TRIGGER_KEYWORD in msg2, False)


# ── TEST 2: 주문번호 추출 ─────────────────────────────────────
print('\n[TEST 2] 주문번호 추출')

sample_message = """할당실패건 삭제요청- 예시센터 B2C
[고객사 / 브랜드 / 채널] 예시고객사
[관련 번호] 20260101-0000001 외 11건
[내용]
1. 20260101-0000001
2. 20260101-0000002
3. 20260102-0000003
4. 20260102-0000004
5. 20260103-0000005"""

order_numbers = parse_order_numbers(sample_message)
assert_eq('[내용] 섹션에서 5건 추출',      len(order_numbers), 5)
assert_eq('첫 번째 주문번호 정확성',        order_numbers[0], '20260101-0000001')
assert_eq('마지막 주문번호 정확성',         order_numbers[4], '20260103-0000005')
assert_eq('[관련 번호] 중복 제외 확인',     order_numbers.count('20260101-0000001'), 1)


# ── TEST 3: 파싱 예외처리 ─────────────────────────────────────
print('\n[TEST 3] 파싱 예외처리')

assert_raises('None 입력 시 ValueError',
              lambda: parse_order_numbers(None),
              '비어있거나')
assert_raises('숫자 입력 시 ValueError',
              lambda: parse_order_numbers(12345),
              '비어있거나')
assert_eq('주문번호 없으면 빈 배열',        parse_order_numbers('할당실패건 삭제요청 내용 없음'), [])
assert_eq('[내용] 섹션 없으면 전체 탐색',   len(parse_order_numbers('할당실패건\n20260101-0000001 20260101-0000002')), 2)


# ── TEST 4: HTTP 오류 코드별 예외처리 ─────────────────────────
print('\n[TEST 4] HTTP 오류 코드별 예외처리')

assert_raises('401 → 인증 오류 메시지',
              lambda: handle_http_error(401, 'ORD-001'),
              '인증 오류')
assert_raises('403 → 인증 오류 메시지',
              lambda: handle_http_error(403, 'ORD-001'),
              '인증 오류')
assert_raises('404 → 데이터 없음 메시지',
              lambda: handle_http_error(404, 'ORD-001'),
              '데이터 없음')
assert_raises('500 → 서버 오류 메시지',
              lambda: handle_http_error(500, 'ORD-001'),
              'API 서버 오류')
assert_raises('503 → 서버 오류 메시지',
              lambda: handle_http_error(503, 'ORD-001'),
              'API 서버 오류')
assert_raises('302 → 예상치 못한 코드',
              lambda: handle_http_error(302, 'ORD-001'),
              '예상치 못한')
assert_eq('200 → None 반환 (정상)',         handle_http_error(200, 'ORD-001'), None)


# ── TEST 5: 재시도 로직 시뮬레이션 ───────────────────────────
print('\n[TEST 5] 재시도 로직 시뮬레이션')

call_count = [0]

def mock_api_fail_twice(order_number, max_retry=2):
    """처음 2회 실패 후 3번째에 성공하는 API 모의"""
    last_error = None
    for attempt in range(max_retry + 1):
        try:
            call_count[0] += 1
            if call_count[0] <= 2:
                raise Exception('네트워크 일시 오류')
            return {'order_id': order_number, 'status': 'OK'}
        except Exception as e:
            last_error = e
    raise Exception(f'API 조회 실패 ({max_retry+1}회 시도): {last_error}')

call_count[0] = 0
result = mock_api_fail_twice('20260101-0000001', max_retry=2)
assert_eq('3번째 시도 성공 반환',   result['status'], 'OK')
assert_eq('총 3회 호출 확인',       call_count[0], 3)

# 재시도 모두 실패 케이스
call_count[0] = 0
assert_raises('재시도 소진 시 예외',
              lambda: mock_api_fail_twice('FAIL-ORDER', max_retry=1),
              'API 조회 실패')


# ── TEST 6: 중첩 필드 추출 + 없는 필드 예외처리 ───────────────
print('\n[TEST 6] 중첩 필드 추출 및 예외처리')

mock_api = {
    'order_id':      '20260101-0000001',
    'customer_name': '예시고객사',
    'brand':         '브랜드A',
    'status':        'FAILED',
    'amount':        150000,
    'delivery': {'address': '서울시 강남구'},
}

assert_eq('단순 필드: order_id',          get_nested_value(mock_api, 'order_id'), '20260101-0000001')
assert_eq('중첩 필드: delivery.address',  get_nested_value(mock_api, 'delivery.address'), '서울시 강남구')
assert_eq('없는 필드 → 빈 문자열',        get_nested_value(mock_api, 'nonexistent.field'), '')
assert_eq('빈 키 → 빈 문자열',            get_nested_value(mock_api, ''), '')
assert_eq('None 객체 → 빈 문자열',        get_nested_value(None, 'order_id'), '')


# ── TEST 7: FIELD_MAP → 행 변환 ──────────────────────────────
print('\n[TEST 7] FIELD_MAP → 시트 행 변환')

row = map_api_data_to_row(mock_api)
assert_eq('행 길이 = FIELD_MAP 길이',     len(row), len(FIELD_MAP))
assert_eq('row[0] = 주문번호',            row[0], '20260101-0000001')
assert_eq('row[3] = 상태',               row[3], 'FAILED')
assert_eq('row[5] = 배송지(중첩)',        row[5], '서울시 강남구')


# ── TEST 8: 완료 알림 메시지 구조 검증 ───────────────────────
print('\n[TEST 8] 완료 알림 블록 구조 검증')

def build_completion_blocks(results):
    total  = len(results['success']) + len(results['failed'])
    has_err = len(results['failed']) > 0
    blocks  = []
    blocks.append({'type': 'header', 'text': {'type': 'plain_text',
        'text': '⚠️ 처리 완료 (일부 오류)' if has_err else '✅ 처리 완료'}})
    blocks.append({'type': 'section', 'fields': [
        {'type': 'mrkdwn', 'text': f'*전체*\n{total}건'},
        {'type': 'mrkdwn', 'text': f'*성공*\n{len(results["success"])}건'},
        {'type': 'mrkdwn', 'text': f'*실패*\n{len(results["failed"])}건'},
    ]})
    if results['failed']:
        blocks.append({'type': 'divider'})
        fail_text = '\n'.join([f':x: `{f["id"]}`\n    _{f["reason"]}_' for f in results['failed']])
        blocks.append({'type': 'section', 'text': {'type': 'mrkdwn',
            'text': ':rotating_light: *처리 실패 목록*\n' + fail_text}})
    return blocks

# 전체 성공
blocks_ok = build_completion_blocks({'success': ['A', 'B', 'C'], 'failed': []})
assert_eq('전체 성공 시 헤더 텍스트',     blocks_ok[0]['text']['text'], '✅ 처리 완료')
assert_eq('전체 성공 시 블록 수',         len(blocks_ok), 2)

# 일부 실패
blocks_fail = build_completion_blocks({
    'success': ['A'],
    'failed' : [{'id': 'B', 'reason': '404 오류'}, {'id': 'C', 'reason': '인증 오류'}]
})
assert_eq('일부 실패 시 헤더 텍스트',     blocks_fail[0]['text']['text'], '⚠️ 처리 완료 (일부 오류)')
assert_eq('실패 블록 포함 확인',          any('실패 목록' in str(b) for b in blocks_fail), True)
assert_eq('실패 이유 포함 확인',          '404 오류' in str(blocks_fail), True)

# 전체 실패
blocks_all_fail = build_completion_blocks({
    'success': [],
    'failed' : [{'id': 'X', 'reason': '서버 오류'}]
})
success_field = next(f for f in blocks_all_fail[1]['fields'] if '성공' in f['text'])
assert_eq('전체 실패 시 성공 0건 표기',   success_field['text'], '*성공*\n0건')


# ── 결과 요약 ─────────────────────────────────────────────────
print('\n' + '='*55)
print(f'결과: {passed + failed}개 중 {passed}개 통과, {failed}개 실패')
if failed == 0:
    print('모든 테스트 통과 ✅  GAS 배포 준비 완료')
else:
    print('일부 테스트 실패 ❌  Code.gs 확인 필요')
print('='*55)
