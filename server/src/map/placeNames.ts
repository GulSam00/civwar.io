/**
 * 기지·수도 지명 (사용자 2026-10-14 → v4.5 2026-10-15 양식 분리, 프로토콜 §22).
 *
 * - 지명 데이터는 **양식별로 따로** 보관한다: 서양식 판타지(유럽풍) / 동양식 판타지.
 * - 매치마다 양식을 **하나만** 골라(시드 결정론) 그 양식 안에서만 뽑는다 — 한 판 안의 지명은 양식이 일관된다.
 * - 당장은 서양식 판타지만 쓴다(ACTIVE_PLACE_NAME_STYLES). 동양식 데이터는 보관만 한다.
 * - [A-108] 표기 = **한국어 음차**(예: Aldermere → 알더미어) — UI 가 한국어 전용이라 음차만 보관·송신한다.
 * - 배정 = (룸 시드) 결정론 셔플 후 기지 순서대로 [A-92]. 매치 안 고유. 같은 시드면 같은 양식·같은 이름.
 */
import { Mulberry32 } from './rng.js';

export type PlaceNameStyle = 'western' | 'eastern';

/** 서양식 판타지 (유럽풍) — 한국어 음차, 135개 */
const WESTERN: readonly string[] = [
  // 영국·북유럽풍 합성 지명
  '알더미어', '레이븐홀트', '애시퍼드', '블랙무어', '브라이트워터', '브라이어우드', '콜더무어', '콜드워터', '크레스트폴', '던모어',
  '이스트마치', '엘름스테드', '페어헤이븐', '폭스할로', '글렌무어', '골드크레스트', '그레이워치', '할로미어', '호크리지', '아이언홀드',
  '킹스브리지', '라크스퍼', '린덴폴', '매로데일', '미스트베일', '노스월드', '오크하트', '올드캐슬', '파인크레스트', '레이븐즈워스',
  '레드워터', '로즈무어', '솔트마시', '실버브룩', '스톤브리지', '스톰홀드', '손버리', '웨스털리', '화이트클리프', '윌로미어',
  '윈드미어', '울프스든', '앰벌리', '배로필드', '벨헤이븐', '브램블윅', '신더무어', '코퍼힐', '돈퍼드', '딥웰',
  '더스크미어', '이글크레스트', '엠버턴', '에버셰이드', '펀윅', '프로스트홀름', '글리머데일', '그린할로', '해로게이트', '헤더무어',
  '할로브룩', '아이비우드', '케스트렐홈', '레이크무어', '로마시', '메이플크로스', '메로비', '문필드', '모스그레이브', '네틀브룩',
  '오큰퍼드', '페블턴', '퀼셔', '레이븐소프', '리버엔드', '룩우드', '러시미어', '세이블크레스트', '섀도펜', '스카이리치',
  '사우스월드', '스타폴', '선헤이븐', '스완미어', '시슬다운', '손윅', '엄버퍼드', '베일크레스트', '웨스트무어', '위스퍼우드',
  '와일더무어', '윈덤', '야로비', '브래컨리지', '콜드하버', '드래건미어', '엘더글렌', '팰로미어', '갤로무어', '하트웰',
  '아이언미어', '주니퍼베일', '킹스무어', '랜턴폴', '마이어필드', '나이트할로', '오스터홀트', '펜할로', '퀸즈버리', '라임홀트',
  '스태그무어', '타이드워터', '언더힐', '베스퍼홀드', '렌필드', '유데일', '제퍼미어',
  // 대륙풍 (독일·프랑스풍)
  '알덴부르크', '브렌하임', '카스텔마르', '드라켄펠스', '아이젠발트', '그라우부르크', '호엔마르크', '칼텐브룬', '린덴호프', '몽클레르',
  '로젠탈', '발몽', '바렌홀트', '볼펜로데', '슈테른할', '모르벤', '벨케르', '보몽',
];

/** 동양식 판타지 — 보관용 (현재 미사용). 고유어풍 80 + 한자어풍 40 */
const EASTERN: readonly string[] = [
  '가람', '가온', '갈매', '감내', '개울목', '거먹재', '고요담', '곰나루', '구름재', '금빛골',
  '기슭말', '꽃마루', '나래', '나루터', '너울', '노을재', '누리', '늘봄', '다래골', '단비',
  '달빛골', '달무리', '대숲말', '도담', '돌모루', '두메', '들꽃골', '마루', '매화촌', '모래내',
  '목련골', '물안개', '미리내', '바람골', '반딧골', '별마루', '보라내', '보름골', '부엉재', '비단골',
  '빛나루', '산마루', '새벽골', '샘골', '서리재', '솔바람', '솔뫼', '수정골', '숲내', '시냇골',
  '아람', '안개골', '여울', '연꽃골', '오색골', '우듬지', '은하골', '이슬재', '잎새골', '자작골',
  '잔물결', '참나무', '청솔', '초롱골', '태백', '푸른내', '하늬', '한가람', '해오름', '햇살골',
  '호수골', '흰모래', '버들골', '갈대밭', '너와촌', '돌담골', '머루골', '벼랑끝', '살구골', '쑥고개',
  '청운', '백야', '운룡', '현무', '주작', '청룡', '백호', '월하', '송학', '천검',
  '비연', '설봉', '홍엽', '금강', '은월', '자운', '취운', '벽해', '낙화', '청학',
  '옥룡', '서운', '연화', '무릉', '도원', '천풍', '청하', '백운', '홍운', '황룡',
  '흑산', '설원', '운해', '용연', '봉황', '학림', '난향', '죽림', '송림', '매림',
];

export const PLACE_NAME_POOLS: Readonly<Record<PlaceNameStyle, readonly string[]>> = { western: WESTERN, eastern: EASTERN };
/** 매치에서 고를 수 있는 양식 — 사용자 결정 2026-10-15: 당장은 서양식 판타지만 */
export const ACTIVE_PLACE_NAME_STYLES: readonly PlaceNameStyle[] = ['western'];

/** 하위 호환: 현재 활성 양식의 풀 (테스트·스크립트용) */
export const PLACE_NAME_POOL: readonly string[] = WESTERN;

/** 매치 양식 — (시드) 결정론. 활성 양식이 하나면 항상 그것 */
export function pickPlaceNameStyle(seed: number): PlaceNameStyle {
  const k = ACTIVE_PLACE_NAME_STYLES.length;
  return ACTIVE_PLACE_NAME_STYLES[k === 1 ? 0 : ((seed >>> 0) ^ 0x2f6b1d93) % k];
}

/**
 * count 개 지명 (seed 결정론, 고유, 한 양식만). style 생략 = pickPlaceNameStyle(seed).
 * count 가 풀보다 크면 "이름 2" 꼴로 접미사를 붙여 고유성을 지킨다 (기지 최대 24 ≪ 풀 120+ 이라 실제로는 안 생긴다).
 */
export function assignPlaceNames(seed: number, count: number, style: PlaceNameStyle = pickPlaceNameStyle(seed)): string[] {
  const pool = PLACE_NAME_POOLS[style].slice();
  const rng = new Mulberry32((seed ^ 0x5a17c0de) >>> 0);
  // Fisher–Yates (정수 나머지 — 편향은 표시용이라 무시)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.nextU32() % (i + 1);
    const x = pool[i];
    pool[i] = pool[j];
    pool[j] = x;
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const k = Math.floor(i / pool.length);
    out.push(k === 0 ? pool[i % pool.length] : `${pool[i % pool.length]} ${k + 1}`);
  }
  return out;
}

// ───────────────────────── 세력 이름 (봇) — 사용자 2026-10-18 항목 8, 프로토콜 §23 ─────────────────────────
/*
 * 봇 이름 = "{핵심어} {꼴}" (예: 레이븐홀트 공국, 북부 변경백령). 지명과 같은 양식 안에서만 뽑는다.
 * - 핵심어 풀 = 세력 전용 핵심어(지명 풀과 겹치지 않음) ∪ 같은 양식의 지명 풀. 매치 지명과 겹치는 핵심어는 뺀다(exclude).
 * - (seed) 결정론 셔플 → 핵심어 하나당 이름 하나라 매치 안 고유. 꼴은 같은 rng 로 고른다.
 * - 길이 ≤ NICKNAME_MAX_LEN(16) — 넘는 조합은 버린다(현재 데이터 최장 11자).
 */

/** 서양식 세력 전용 핵심어 — 지명 풀(WESTERN)과 겹치지 않는다 (테스트 고정). 방위어 포함 */
const WESTERN_FACTION_CORES: readonly string[] = [
  '북부', '남부', '동부', '서부', '고지', '해안', '내륙', '변방',
  '아르델', '발로리아', '카르센', '에스테르', '몬트레일', '세렌디아', '그리펜', '로웬', '타리스', '벨모르',
  '엘드라스', '크라운월', '하이가든', '아스테리온', '브레논', '카렌도르', '드라우펠', '에델란트', '피오렐', '가르덴',
  '헬름가드', '이스트릴', '케일번', '로텐마르', '메르시아', '노르덴', '오르빌', '펠라도르', '레겐보르', '살렌',
  '토렌가드', '울펜마르', '발데린', '빈터펠스', '이리스몬트', '잘츠마르',
];
const WESTERN_FACTION_FORMS: readonly string[] = [
  '공국', '왕국', '동맹', '연합', '변경백령', '자유도시', '기사단', '백작령', '대공국', '후국', '공화국', '연방', '상업동맹', '제국',
];

/** 동양식 세력 전용 핵심어 — 보관용(현재 미사용). 지명 풀(EASTERN)과 겹치지 않는다 */
const EASTERN_FACTION_CORES: readonly string[] = [
  '북방', '남방', '동방', '서방', '해동', '청구', '진하', '적운', '현해', '백랑',
  '흑운', '청람', '금오', '은하수', '천마', '만월', '설한', '풍림', '화산', '청성',
  '오악', '사해', '천하', '비룡', '맹호', '독수', '흑룡', '금룡', '해룡', '혈월',
];
const EASTERN_FACTION_FORMS: readonly string[] = [
  '왕조', '왕국', '연맹', '도호부', '후국', '부족연합', '상단', '군벌', '대국', '맹', '문파', '성국',
];

export const FACTION_CORE_POOLS: Readonly<Record<PlaceNameStyle, readonly string[]>> = { western: WESTERN_FACTION_CORES, eastern: EASTERN_FACTION_CORES };
export const FACTION_FORMS: Readonly<Record<PlaceNameStyle, readonly string[]>> = { western: WESTERN_FACTION_FORMS, eastern: EASTERN_FACTION_FORMS };
/** NICKNAME_MAX_LEN 과 같은 값 (shared 상수 — placeNames 는 shared 의존이 없어 숫자로 둔다, 테스트가 같음을 확인) */
export const FACTION_NAME_MAX_LEN = 16;

/** 세력 이름의 핵심어 (마지막 공백 앞) */
export function factionCore(name: string): string {
  const i = name.lastIndexOf(' ');
  return i < 0 ? name : name.slice(0, i);
}

/**
 * count 개 세력 이름 (seed 결정론, 매치 안 고유, 한 양식만). style 생략 = pickPlaceNameStyle(seed).
 * exclude = 쓰면 안 되는 이름들(매치 지명·사람 닉네임) — 핵심어나 전체 이름이 여기 있으면 건너뛴다.
 * 핵심어가 모자라면(실제로는 안 생긴다 — 서양식 ≈180개 ≫ 최대 인원 12) "이름 2" 꼴로 고유성을 지킨다.
 */
export function assignFactionNames(
  seed: number,
  count: number,
  opts: { style?: PlaceNameStyle; exclude?: Iterable<string> } = {},
): string[] {
  const style = opts.style ?? pickPlaceNameStyle(seed);
  const ex = new Set(opts.exclude ?? []);
  const seen = new Set<string>();
  const cores: string[] = [];
  for (const c of [...FACTION_CORE_POOLS[style], ...PLACE_NAME_POOLS[style]]) {
    if (seen.has(c) || ex.has(c)) continue;
    seen.add(c);
    cores.push(c);
  }
  const rng = new Mulberry32((seed ^ 0x3c6ef372) >>> 0);
  for (let i = cores.length - 1; i > 0; i--) {
    const j = rng.nextU32() % (i + 1);
    const x = cores[i];
    cores[i] = cores[j];
    cores[j] = x;
  }
  const forms = FACTION_FORMS[style];
  const base: string[] = [];
  for (const c of cores) {
    const name = `${c} ${forms[rng.nextU32() % forms.length]}`;
    if (name.length > FACTION_NAME_MAX_LEN || ex.has(name)) continue;
    base.push(name);
  }
  const out: string[] = [];
  for (let i = 0; i < count && base.length > 0; i++) {
    const k = Math.floor(i / base.length);
    out.push(k === 0 ? base[i] : `${base[i % base.length]} ${k + 1}`);
  }
  return out;
}
