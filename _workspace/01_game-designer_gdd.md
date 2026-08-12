# civwar.io 게임 디자인 문서 (GDD)

- 버전: **v3.1** (v3.0 「미결정 [A]」 5건 사용자 확정 반영)
- 작성일: 2026-08-12 (v3.0: 2026-08-11, v2.1/v2.0: 2026-08-05, v1.0: 2026-08-04)
- 전제 입력: `_workspace/00_input/design-decisions.md` — 「GDD v3.0 개정 결정」 A~F 항 + 「미결정 [A] 5건 사용자 확정」
- 다음 소비자: `multiplayer-backend-engineer` (7장이 프로토콜 설계 1차 입력)

---

## v3.0 → v3.1 변경 요약

v3.0의 「미결정 [A]」 5건에 사용자 판정이 내려졌다. **A-2 / A-3 / A-4는 v3.0 현행 유지**로 확정되어 문서 변경이 없다.

### A-5 — "자세" 개념을 플레이어 표면에서 제거 (반영 완료)

| 위치 | 변경 |
|---|---|
| 4.3 | 절 제목 "자세 결정 추가" → "앵커 소유자에 따른 동작 분기". 자세를 고르는 것이 아니라 **어디로 보내느냐**로 서술 |
| 4.3 | 클라이언트에 **모드 표시·토글을 두지 않는다**. 커서 툴팁에서 "공격/방어"라는 이름을 빼고 **결과**(게이지가 어느 방향으로 움직이는지)만 예고 |
| 4.3 | **내 땅 깃발의 이동(재배치) 겸용**을 명시적 규칙 4항으로 신설 — 위협 없는 내 땅 앵커도 정상 명령, 이후 적이 들어오면 재발령 없이 되돌리기 시작, 무손실 재배치 수단 |
| 4.2 / 7.2 | `posture` / `ATTACK` / `DEFEND`는 **서버 내부 파생값**임을 명시. 필드는 유지하되 플레이어 대상 1급 개념이 아님 |

**메커니즘은 바뀌지 않았다.** 서버 분기·게이지·상수 모두 v3.0 그대로이며, 바뀐 것은 **표현과 클라이언트 요구사항**이다. 따라서 5장 페이싱·부록 A 상수표는 영향받지 않는다.

### A-1 — 주둔 유지비를 병력 → 골드로 교체 (✅ 반영 완료)

사용자 확정: **골드로 소모하되, 골드 순증가량이 체감될 만큼 둔해지고 적자로는 떨어지지 않는다.**

| 절 | 변경 |
|---|---|
| 4.4 | `FLAG_GARRISON_UPKEEP_BP`(병력 bp) **폐기**. 주둔 유지비는 **그로스 골드 수입의 permille 차감**으로 교체. 신규 상수 `GARRISON_UPKEEP_PERMILLE = 90` / `GARRISON_UPKEEP_FREE_PERMILLE = 1000` / `GARRISON_UPKEEP_MAX_PERMILLE = 700` |
| 4.4 | **주둔 깃발은 더 이상 병력이 줄지 않는다.** "무전투 주둔 수명"(창 13.9분 / 검 8.3분 / 기 5.2분)이라는 개념 자체가 소멸 |
| 4.4 | 부과 시점 확정 — **앵커 도착 후 `ENGAGED` 상태부터**. 행군 중(`MARCHING`)·`IDLE`·`RETURNING`은 무과금 |
| 4.4 | 방어의 기회비용이 **병력 소모 → 테크 진행 지연**으로 이동. `FLAG_RECALL_REFUND`(0.85)와의 관계 재정리 |
| 4.4 | **원래 목적(무한 웅크리기 차단)이 골드 단독으로는 성립하지 않음을 명시**하고, 3중 차단(기하학 + 골드 템포 + 임계 승리 불가) 논증과 보완 규칙(무위협 누진)을 제안했으나 **2026-08-12 사용자 기각 → `GARRISON_ESCALATE_MAX = 1`로 비활성.** 소규모 농성 구멍은 알고 남긴 채 B-10에서 관측 |
| 3.3 | tick당 골드 정산식에 유지비 차감항 추가. `upkeepMilli ≤ goldMilliPerTick`이 상수만으로 보증되어 **순증 ≥ 0이 구조적 불변식**이 됨 |
| 4.11 | `UNIT_GARRISON` 값(0.60 / 1.00 / 1.60)은 **유지**하되 단위를 "병력 소모 배율" → "골드 유지비 가중치"로 재해석. 창병 40% 할인의 근거를 "수명"에서 "단가"로 교체 |
| 5.7 | 유지비 차감 후 테크 노드 수 재검산 — **선두 5개 / 중위권 4개 유지**, 5번째 노드 시점 35.6분 → 36.8분(+1.2분) |
| 7장 | player 페이로드에 `upkeepPm`(0~700 permille) 신설 — HUD가 "골드 −45%"를 표시할 근거. 전원 공개 |
| 7.4 | tick 순서 2단계에 유지비 차감, 9단계에 `calmTicks` 갱신 추가. 4단계에서 유지비 제거 |
| 부록 A | `FLAG_GARRISON_UPKEEP_BP` 제거, 골드 유지비 상수 5종 추가 |

**5장 페이싱(표준 종료 39.2분 / 실질 하한 34.5분 / 하드 타임아웃 42분)은 유지된다.** 유지비는 병력 흐름에 손대지 않으므로 5.1~5.4의 실효계수·`ENEMY_BASE` 역산·수렴 곡선의 입력이 하나도 바뀌지 않는다. 바뀐 것은 5.7절(테크 검산)뿐이다.

> **v2.1 → v3.0 델타 절(아래)의 "주둔 유지비 = 병력 소모" 서술은 역사 기록이므로 갱신하지 않는다.** v3.0 시점의 설계를 그대로 보존한다. 현행 규칙은 4.4절과 부록 A가 유일한 출처다.

---

## v2.1 → v3.0 변경 요약 (델타)

### 삭제된 조항

| 조항 | 위치(v2.1) | 왜 사라지는가 |
|---|---|---|
| **본국 자동 방어(밀도 방어) 전체** | 4.7절 통째 | design-decisions v3.0-A. 병력 풀은 방어에 일절 관여하지 않는다 |
| `defDensity(p)` | 4.7 / 4.6 / 8장 | 개념 자체가 소멸 |
| `tileCost`의 밀도항 `ENEMY_DENSITY_COEF × d` | 4.6 | A항 명시 |
| `HOME_FLAG_DEF_RATIO` / `HOME_FLAG_DEF_CAP` | 4.7 | 깃발 출전 페널티 없음(A항) |
| `UNIT_DEF_MULT` | 4.7 / 4.9 / 4.11 | "본국 방어 기여" 축이 사라짐 → `UNIT_DEF_PUSH`로 교체 |
| **입찰 경매(Phase B의 `power` argmax)** | 4.8 / 4.9 | 진척도 경주로 대체. 동시 공격은 "게이지 레이스"로 해석 |
| `UNIT_POWER` | 4.9 / 4.11 | 경매 소멸 |
| `LOSER_ATTRITION_RATIO` | 4.8 / 4.9 | 낙심자 개념 소멸. 병력은 이미 AP로 지출됨 (F.6) |
| `LOSER_TO_DEFENDER_RATIO` | 4.8 / 4.9 | 다자 협공 압박은 "방어자가 N개 전선에 반격 깃발을 대야 함"으로 대체 (F.6) |
| `DEFENDER_LOSS_RATIO` | 4.7 / 4.8 | 방어자 손실이 이미 반격 깃발 AP로 명시적으로 지출됨 → 이중 계상 (F.6) |
| `maxTiles`(정수 타일 상한) | 4.8 | 진척도가 연속량이 되어 `FLAG_MAX_PROGRESS`(milli/tick)로 대체 |
| 발령 거절 사유 `SELF` | 4.3 | 내 타일 앵커 = **방어 발령**이 되었으므로 정상 명령 |

### 신설된 조항

| 조항 | 위치(v3.0) | 내용 |
|---|---|---|
| **앵커 소유자에 따른 동작 분기** | 4.3 / 4.7 | 내 땅으로 보내면 이동 겸 방어, 적·중립이면 공격. **명령 종류는 늘지 않는다.** 내부 파생값 이름이 `posture`이며 v3.1에서 플레이어 표면 개념에서 제외됨(A-5) |
| **진척도 게이지 `progressMilli` (깃발 단위)** | 4.6 | 0..999. 1000 도달 시 타일 소유권 이전. **타일에는 저장하지 않는다**(C항) |
| **반격 되돌리기(defense push)** | 4.7 | DEFEND 깃발이 자기 디스크 안의 적 게이지를 역방향으로 밀어낸다 |
| `DEFENSE_LEVERAGE` + `UNIT_DEF_PUSH` | 4.7 / 4.11 | 방어 AP의 되돌리기 효율. 창병 정체성의 새 근거 (F.2) |
| **정체(STALLED) 판정** | 4.7 / 4.10 | 게이지 0에서 순증감 ≤ 0이 25 tick 지속 → 알림. 규칙 변화 없음, UI 신호만 |
| **기지 체력 `hpMilli`** | 2.7 / 4.12 | 0..15000. 0 도달 시 소유권 이전 + **만피의 50%(7500)에서 재시작** (D항) |
| **주둔 유지비(garrison upkeep)** | 4.4 / 4.7 | 정지 상태 DEFEND 깃발의 병력 소모. 무한 웅크리기 차단 |
| **보급선 항 `supplyMult`** | 4.6 | 내 기지에서 먼 타일일수록 점령비용 상승. `tileCost` 분산 회복 (F.5) |
| `FLAG_MAX_PROGRESS` (milli/tick) | 4.6 | `maxTiles` 대체. 값 = `1000 × FLAG_TILE_RATE_BASE × UNIT_ASSAULT` |
| 프로토콜 `flagProgress` / `baseHp` | 7.3 / 7.5 | 깃발당 1바이트급 진척도, 기지 24개 체력 |
| 봇 AI 방어 판단 | 8장 | `threatMilli(p)` 기반 반격 깃발 발령 |

### 수치가 바뀐 상수

| 상수 | v2.1 | **v3.0** | 이유 |
|---|---|---|---|
| `ENEMY_BASE` | 25 | **16** | 밀도항(최대 +36)이 사라진 자리를 **반격 AP 소모**가 대신한다. 5.3절에서 표준 종료 39.2분이 되도록 역산 |
| `ENEMY_DENSITY_COEF` | 3.0 | **삭제** | A항 |
| `DEFENDER_LOSS_RATIO` | 0.35 | **삭제** | F.6 |
| `LOSER_ATTRITION_RATIO` | 0.50 | **삭제** | F.6 |
| `LOSER_TO_DEFENDER_RATIO` | 0.25 | **삭제** | F.6 |
| `HOME_FLAG_DEF_RATIO` / `_CAP` | 0.50 / 0.35 | **삭제** | A항 |
| `UNIT_DEF_MULT` | 1.50/1.00/0.60 | **삭제** → `UNIT_DEF_PUSH` 1.30/1.00/0.55 | F.2 |
| `UNIT_POWER` | 900/1000/1150 | **삭제** | 경매 소멸 |
| `FLAG_TILE_RATE_BASE` | 2 (타일) | **2 (타일 상당, milli 환산)** | 의미 재정의. 값 유지 |
| `BOT_NEUTRAL_BIAS_TICK` | 2610 | **2442** (8.14분) | 1단계 재계산 |
| `BOT_PANIC_DENSITY` | 2.0 | **삭제** → `BOT_THREAT_TRIGGER` 3000 | 밀도 소멸 |
| 1단계 실효계수 | 1.4166 | **1.3629** | 방어 예비 병력을 쟁여둘 이유가 사라져 로지스틱 스로틀 완화 (5.2) |
| 중·종반 실효계수 | 1.33 | **1.30** | 위와 동일 |
| 표준 종료 | 39.3분 | **39.2분** | 5.3절 |
| 실질 하한 | 33.8분 | **34.5분** (구조적 고정) | 5.4(d) |
| 클라이언트 대역폭 | 4.9 KB/s | **5.7 KB/s** | 진척도·기지 체력 추가 (7.5) |

**바꾸지 않은 것**: `REGEN_SQRT_COEF`(0.50), `NEUTRAL_BASE`(9), `NEUTRAL_SQRT_COEF`(1.0), `GOLD_RATE_PERMILLE`(1550), `TROOP_CAP_PER_TILE`(12), `FLAG_SPEND_RATE`(0.015), `FLAG_CAP_*`, `FRONT_RADIUS`(6), `ENDGAME_RUSH_TICK`(37분), `HARD_TIMEOUT_TICK`(42분), 임계값 곡선, 동맹 규칙 전체, 지형 5종 전체, 기지 배치 알고리즘, 맵 크기표.

> **읽는 법**: 모든 수치는 초안 값이며 상수 이름을 함께 명시했다. 백엔드는 이 상수들을 단일 상수 파일(`shared/constants.ts`)로 뽑아 서버·클라이언트가 공유한다. 부록 A에 v3.0 기준 전체 상수 표가 있다.
>
> **결정론 원칙 (v1.0 이래 불변)**: 모든 공식은 `Math.sqrt`, 정수 연산, `floor/ceil`만 사용한다. `Math.pow` / `**` 의 분수 지수는 **금지**한다. 모든 배율은 **permille 정수**(1.15 → `1150`)로 보관하고, `sqrt`는 `floor(Math.sqrt(x) * 1000)` 형태의 milli-정수로 받는다. 누적 자원(병력·골드·진척도·기지 체력)은 1/1000 고정소수점 정수로 보관하고 클라이언트에는 축약값만 노출한다.
>
> **아키텍처 원칙 (v1.0 이래 불변, v3.0에서 예외 1개 추가)**: 타일의 가변 상태는 `owner` 하나뿐이다. **유일한 예외는 기지 타일의 체력**이며, 기지는 맵 전체에 최대 24개이므로 대역폭·결정론 비용이 상한선 안에 묶인다(2.7절). 진척도는 **타일이 아니라 깃발**에 산다(C항).

---

## 1. 핵심 루프

> **영토를 점령한다 → 영토 수에 비례해 병력과 골드가 자동 생산된다 → 병종과 병력을 실은 깃발을 국경 면으로 보낸다 → 깃발이 행군해 도착하면 그 구간의 게이지를 민다 → 반복.**

v2.1 대비 루프의 **문장은 그대로이고 "민다"의 의미만 바뀌었다.** v2.1에서 밀기는 "내 병력으로 상대 밀도를 사는 것"이었다. v3.0에서 밀기는 **양방향 게이지 줄다리기**다 — 내가 밀면 게이지가 차오르고, 상대가 반격 깃발을 보내면 게이지가 되돌아간다.

플레이어가 직접 내리는 결정은 다섯 가지다 (v2.1의 네 가지 + 1).

1. **어느 구간을** 밀 것인가 — 타일 클릭 (앵커 지정)
2. **밀 것인가 막을 것인가** — 앵커가 **적/중립 타일이면 공격**, **내 타일이면 방어**. ⟵ **v3.0 신규. 명령 종류는 늘지 않는다**
3. **어떤 병종으로** 갈 것인가 — 창병 / 검병 / 기병
4. **얼마나** 실을 것인가 — 병력 수 (프리셋 25/50/75% 또는 슬라이더)
5. **어느 축에** 골드를 쓸 것인가 — 테크 4축

**v2.1에서 사라진 문장**: "방어에는 별도 명령이 없다. 깃발에 싣지 않고 남겨둔 병력 풀 자체가 방어력이다."
**v3.0의 대체 문장**: **방어에는 별도 "명령 종류"가 없다. 같은 깃발을 내 땅에 꽂으면 그것이 방어다.** 남겨둔 병력 풀은 방어력이 아니라 **다음 깃발을 채울 탄약**이다.

이 교체가 게임에 주는 것:

- **모든 전선이 보인다.** v2.1의 방어는 화면에 숫자 하나(밀도)로만 존재했다. v3.0의 방어는 지도 위의 깃발과 그라데이션으로 보인다.
- **방어가 결정이 된다.** "어느 전선을 포기하고 어느 전선을 지킬 것인가"가 매 순간의 질문이 된다. 슬롯이 유한하므로 이것은 실제 트레이드오프다(5.5절).
- **공격과 방어가 같은 자원을 쓴다.** 그래서 "지금 밀 것인가 버틸 것인가"가 병력 배분 문제로 통일된다.

골드는 여전히 옆가지다. 전투에 직접 쓰이지 않고 테크 4축 중 하나를 강화해 다음 루프 반복의 계수를 바꾼다.

---

## 2. 맵 / 영토 시스템

### 2.1 구조

| 항목 | 값 | 비고 |
|---|---|---|
| 최소 단위 | 정사각 타일 | 토폴로지 추상화 뒤에 숨긴다(구현 제약 참조) |
| 타일 ID | `row * width + col` | 사각 구현체 내부에만 존재 |
| 인접 | 상하좌우 4방향 | `neighbors(tileId)` |
| 거리 | `distance(a,b)` = 맨해튼 | 사각 구현체 내부에만 존재 |
| 기본 맵 (10인) | `width 100 × height 60` = **6000 타일** | v1.0 이래 동일 |
| 목표 육지 비율 | **0.65** (±0.05) → 약 **3900 육지 타일** | 물은 영구 통행/점령 불가 |
| 1인당 육지 배분 | **약 390 타일** | 세션 페이싱 기준값 (5장) |
| 지형 종류 | 평원 / 비옥지 / 언덕 / 사막 / 산 / 물 | v2.0 이래 동일 |
| 기지 (10인) | 수도 10개 + 중립 10개 = **20개** | v2.1 이래 동일. **v3.0에서 체력을 갖는다**(2.7절) |

**2.3 / 2.4 / 2.6절은 v2.1에서 한 글자도 바뀌지 않으므로 이 문서에 재게재하지 않는다.** 인원별 맵 크기표(`총 타일 ≈ 600 × N`), 맵 생성 알고리즘(`caBlob` + 쿼터 절단), 스폰 배치, 기지 배치 알고리즘(`placeBases`)과 공정성 보장 근거 6개 — **v2.1 문서의 해당 절을 그대로 구현한다.** 백엔드는 이 셋에 대해서는 v2.1 GDD를 참조하라.

아래 2.2절은 v3.0의 재해석 때문에 참조용으로 재게재하고, 2.5·2.7절이 v3.0에서 실제로 달라진 부분이다.

### 2.2 지형 5종 (v2.0 이래 불변, 참조용 재게재)

| 지형 | enum | 육지 비중 | 점령비용 배율 | 골드 가중치 | 이동 배율 | 역할 |
|---|---|---|---|---|---|---|
| 평원 Plain | 1 | 39% | `1.00` | `1000` | `1.00` | 기준 |
| 비옥지 Fertile | 2 | 15% | `1.15` | `2300` | `1.00` | 경제 노른자 = 격전지 |
| 언덕 Hills | 3 | 16% | `1.30` | `900` | `1.25` | 방어 거점 |
| 사막 Desert | 4 | 22% | `0.80` | `300` | `1.10` | 넓은 완충지대 |
| 산 Mountain | 5 | 8% | `1.70` | `250` | `1.80` | 천연 방벽 |
| 물 Water | 0 | — | 통행/점령 불가 | — | — | v1.0과 동일 |

```
점령비용 가중평균 = 1.0825   (산 우회 반영 실효 = 1.0514)
골드 가중평균     = 0.965    (GOLD_RATE 1550 으로 상쇄)
```

> **v3.0 재해석 — 언덕의 가치가 올라갔다.** v2.1에서 언덕(비용 1.30)의 방어 가치는 밀도항에 묻혀 있었다(밀도 8 기준 전체 비용의 20%만 지형이 결정). v3.0에서는 밀도항이 사라져 **지형이 `tileCost` 변동의 주역**이 된다. 산 1.70 / 사막 0.80의 비율이 2.1배 → 같은 비율이지만 전체에서 차지하는 비중이 커졌다. `defRefCost`(4.7절)에도 지형이 그대로 들어가므로 **언덕에서 방어하면 되돌리기도 싸진다.** "방어 거점"이라는 언덕의 설계 의도가 v3.0에서 처음으로 실제 규칙이 됐다.

### 2.5 영토 상태 (v3.0 개정)

```
tile.terrain : 0=WATER,1=PLAIN,2=FERTILE,3=HILLS,4=DESERT,5=MOUNTAIN   // 불변
tile.isBase  : 0 | 1                                                    // 불변
tile.owner   : 0=NEUTRAL, 1..N=playerId                                 // 가변 (모든 타일)
```

일반 타일의 가변 상태는 **여전히 `owner` 하나뿐이다.** 진척도는 타일이 아니라 **깃발**에 저장된다(4.6절, design-decisions C항).

기지 타일만 추가 가변 상태를 갖는다 — 별도 배열로 분리해서 보관한다(2.7절).

```
bases : [ { tileId: uint32, hpMilli: int, lastDamageTick: uint32, lockUntilTick: uint32 } ]
        // 길이 = 2N ≤ 24. tileId 오름차순 고정.
baseIndexOf : Map<tileId, uint8>    // 불변 역인덱스
```

플레이어별 파생 상태(모두 O(1) 증분 갱신, v2.1과 동일):

```
p.tiles       : 소유 타일 개수 (병력 재생·점유율 판정은 이것만 쓴다)
p.goldWeight  : Σ TERRAIN_GOLD_MILLI[tile.terrain] over p 소유 타일
p.baseTiles   : 소유한 기지 타일 ID 의 정렬 배열
```

```
onTileOwnerChange(tileId, from, to):
   w = TERRAIN_GOLD_MILLI[tile[tileId].terrain]
   if from != NEUTRAL: players[from].tiles -= 1;  players[from].goldWeight -= w
   if to   != NEUTRAL: players[to].tiles   += 1;  players[to].goldWeight   += w
   if isBase[tileId]:
        if from != NEUTRAL: players[from].baseTiles.remove(tileId)
        if to   != NEUTRAL: players[to].baseTiles.insert(tileId)     // tileId 오름차순 유지
```

### 2.7 기지 체력 (v3.0 신규 — design-decisions D항)

기지는 v2.1까지 "일반 타일과 동일하게 점령되는, 위치만 특별한 타일"이었다. v3.0에서 기지는 **진척도 게이지 대신 지속 상태인 체력**을 갖는다.

```
BASE_HP_MAX_MILLI      = 15000       // 만피. 단위는 진척도와 동일(milli-타일 상당) = 15 타일분 작업
BASE_HP_INIT_MILLI     = 15000       // 매치 시작 시 수도·중립 기지 모두 만피
BASE_HP_CAPTURE_MILLI  =  7500       // 점령 직후 새 주인 기준 = 만피의 50%   ⟵ 사용자 확정 "50"
BASE_HP_REGEN_MILLI    =    17       // tick당 회복량
BASE_REGEN_DELAY_TICK  =    50       // 마지막 피해로부터 10초 지나야 회복 시작
BASE_CAPTURE_LOCK_TICK =    25       // 점령 직후 5초간 피해 무효 (핑퐁 방지)
표시 체력(%) = floor(hpMilli * 100 / BASE_HP_MAX_MILLI)
```

**왜 "체력"이 진척도와 같은 단위인가**: 백엔드가 함수를 하나만 구현하면 되기 때문이다. 일반 타일은 `progressMilli`가 1000에 닿으면 넘어가고, 기지는 `hpMilli`가 0에 닿으면 넘어간다. 둘 다 **같은 `AP × 1000 / tileCost` 식으로 증감**한다(4.6/4.12절). 기지는 "1000짜리 게이지 15개를 역방향으로 쌓아둔 타일"일 뿐이다.

**수치 근거 — 만피 15000 (= 15 타일 상당)**

| 상황 | 필요 AP | 중반 깃발(1,200) 대비 |
|---|---|---|
| 만피 기지, 방어 없음 (`c_raw ≈ 21.0`) | 315 | 26% |
| 만피 기지, 표준 방어(ρ=0.55, 창병) | 약 985 | **82%** — 거의 깃발 하나 |
| 갓 점령된 기지(7500), 방어 없음 | 158 | 13% |
| 갓 점령된 기지(7500), 표준 방어 | 약 493 | 41% |

> **읽는 법: 지켜진 만피 기지를 뺏으려면 깃발 하나를 통째로 써야 한다.** 이 값이 기지를 "지도 위에서 가장 비싼 목표"로 만든다. 동시에 방어 없는 기지는 26%면 넘어가므로 **비워두면 잃는다** — 기지를 가진 쪽에 상시 방어 부담을 지운다.

**회복 곡선 검산**: `17/tick × 300 tick/분 = 5,100 milli/분`. 만피까지 15000/5100 = **2.94분**. 갓 점령(7500) → 만피 = **1.47분 + 10초 대기**.

**"체력 50에서 시작"이 연속 함락(체인 스틸)에 주는 영향 (F.7 필수 검산)**

| 회차 | 시작 체력 | 필요 AP(방어 없음) | 누적 |
|---|---|---|---|
| 1차 함락 (만피에서) | 15000 | 315 | 315 |
| 즉시 탈환 | 7500 | 158 | 473 |
| 즉시 재함락 | 7500 | 158 | 631 |

즉 기지는 **첫 함락 이후 절반 가격의 회전문이 된다.** 이것을 버그로 보지 않고 **의도된 설계**로 확정한다.

1. **핫존을 만든다.** 갓 뺏은 기지는 "지켜야 하는 부채"다. 90초를 버텨야 비로소 내 것이 된다(회복 곡선). 지도 위에 **시한이 붙은 목표**가 생긴다.
2. **눈덩이를 막는다.** 만약 점령 즉시 만피였다면 기지를 먼저 잡은 쪽이 그 지점을 영구히 독점한다 — 2.6절 배치 알고리즘이 여섯 가지 장치로 봉인한 "선점 독점"이 체력 시스템으로 되살아난다. 50% 시작이 그 구멍을 막는다.
3. **폭주는 두 장치로 묶인다.**
   - `BASE_CAPTURE_LOCK_TICK = 25` — 같은 tick / 다음 tick 즉시 되뺏기 불가. 5초는 최소 한 번의 판단 프레임이다.
   - 탈환하려면 **반격 깃발이 아니라 공격 깃발**이 필요하다. 기지는 이미 상대 소유이므로 DEFEND 자세로는 건드릴 수 없다(4.7절). 즉 회전문에 참여하려면 슬롯 하나를 계속 태워야 한다.
4. **검산 — 회전문이 게임을 지배하는가**: 158 AP는 중반 깃발의 13%지만, 그 깃발을 그 자리까지 **행군시키는 데 12.6~20.7초**가 걸린다(5.1절). 회전 주기의 병목은 AP가 아니라 행군이다. 5초 락과 합쳐 실측 최소 회전 주기는 약 **18초**이며, 그 사이 방어자는 7500 → 8925로 회복한다(방어자가 붙어 있으면 훨씬 더). **회전문은 성립하지만 자기 슬롯을 계속 먹는 비싼 전술이다.** → 허용.

**소유권 이전 규칙**

```
hpMilli <= 0 이 된 tick 에:
   winner = 이번 tick 에 이 기지에 피해를 가장 많이 넣은 깃발 (동률 flagId ASC)
   onTileOwnerChange(tileId, prevOwner, winner.ownerId)
   tile[tileId].owner = winner.ownerId
   hpMilli        = BASE_HP_CAPTURE_MILLI
   lockUntilTick  = t + BASE_CAPTURE_LOCK_TICK
   lastDamageTick = t
   emit base_captured(tileId, from, to, tick)
```

**기지가 없는 플레이어**: v2.1의 폴백(수도 상실 시 `p.homeTileId`에 가장 가까운 내 타일)을 그대로 쓴다(4.3/4.5절). 다만 v3.0에서는 **보급선 항**(4.6절)이 걸리므로 기지가 하나도 없는 플레이어는 점령비용 상한 배율 `SUPPLY_MAX_MULT = 1.60`을 그대로 맞는다 — 기지를 전부 잃는 것이 정말로 아프다.

**대역폭 비용**: 기지 ≤ 24개 × (tileId, hp%) = 변경분만 전송하면 tick당 평균 2~3개, 약 0.1 KB/s (7.5절). "타일마다 상태를 늘리지 않는다"는 원칙을 깨는 값이 아니다.

---

## 3. 자원·성장 모델

### 3.1 tick

| 상수 | 값 |
|---|---|
| `TICK_MS` | **200** (초당 5 tick) |
| 1분 | 300 tick |
| 종반 러시 발동 | 11,100 tick = **37분** |
| 하드 타임아웃 | 12,600 tick = **42분** |

### 3.2 병력 (Troops) — 공식 불변, **의미 재정의** (design-decisions E항)

```
troopCap(p)      = floor( (100 + 12 * p.tiles) * capMult(p) )

regenPerTick(p)  = ( 0.8 + 0.50 * sqrt(p.tiles) )
                 * regenMult(p)
                 * ( 1 - p.troops / troopCap(p) )           // 로지스틱 감쇠, 0 미만이면 0

p.troopsMilli   += round( regenPerTick(p) * 1000 )
p.troopsMilli    = min(p.troopsMilli, troopCap(p) * 1000)
```

**공식은 한 글자도 바뀌지 않는다.** 바뀐 것은 `troopCap`이 무엇을 제한하는가이다.

| | v2.1 | **v3.0** |
|---|---|---|
| `troopCap` 의 의미 | 방어 밀도 상한 (타일당 12) | **동시 투사 가능 총량 상한** |
| 풀에 병력을 쌓아두면 | 방어력이 된다 | **아무 일도 하지 않는다.** 상한에 닿으면 재생만 멈춘다 |
| 압력의 방향 | 적당히 남겨야 안전 | **계속 내보내야 한다** |

**`TROOP_CAP_PER_TILE = 12`를 유지하는 새 근거 — 슬롯과의 공역 설계**

v2.1의 근거("타일당 방어 밀도 12로 고정")는 소멸했다. 대신 v3.0에서 이 값은 **깃발 슬롯 수와 짝을 이룬다.**

| 타일 T | `troopCap` | `flagCap`(무테크) | **슬롯당 병력** |
|---|---|---|---|
| 100 | 1,300 | 3 | 433 |
| 390 | 4,780 | 4 | **1,195** |
| 600 | 7,300 | 5 | 1,460 |
| 900 | 10,900 | 6 | 1,817 |
| 1,200 | 14,500 | 7 | 2,071 |

> **`troopCap`은 "슬롯을 가득 채울 만큼만 쌓인다"는 값이다.** 5.1절이 쓰는 중반 표준 깃발 병력 1,200이 T=390의 슬롯당 병력 1,195와 일치하는 것은 우연이 아니라 이 공역 설계의 결과다. 상한이 이보다 높으면 "몰빵 한 방" 빌드가 최적해가 되고, 낮으면 슬롯이 남아돈다.

- **`sqrt(tiles)` 유지**: 선형이면 선두가 눈덩이처럼 굴러 20분에 끝난다. v3.0에서 이 감쇠는 더 중요해졌다 — 5.5절의 **전선당 방어 예산 불변 정리**가 정확히 이 sqrt에서 나온다.
- 로지스틱 항 때문에 풀을 비우고 회복하는 데 약 2분이 걸린다. **깃발에 전량을 싣는 것은 v3.0에서 더 위험하다** — 풀이 비면 반격 깃발을 낼 수 없고, 반격 깃발이 없으면 땅을 그냥 내준다.

**시작값**: `troops = 150`, `tiles = 9`, `troopCap = 208`.

### 3.3 골드 (Gold / 생산력) — v2.0 이래 불변

```
goldMilliPerTick(p) = floor( p.goldWeight * GOLD_RATE_PERMILLE * goldMult_permille / 1_000_000_000 )
GOLD_RATE_PERMILLE = 1550

// ⟵ v3.1 (A-1). 주둔 유지비는 병력이 아니라 이 그로스 수입에서 차감된다. 산식은 4.4절
net = goldMilliPerTick(p) - garrisonUpkeepMilli(p)          // 항상 >= 0 (4.4절 불변식)
p.goldMilli      += net
p.goldEarnedMilli += net        // 6.1 타이브레이커 "누적 획득 골드" = 순증분 누계
```

`p.goldWeight`는 2.5절에서 점령/상실 시에만 증분 갱신된다. 매 tick 하는 일은 곱셈 두 번과 나눗셈 한 번이며 타일 순회가 없다.

**검산**: 평균 지형 혼합(가중치 965/타일)으로 390타일 → `goldWeight = 376,350` → `floor(376350 × 1550 × 1000 / 1e9) = 583` milli-gold/tick. v1.0의 `390 × 1.5 = 585`와 동일. ✓

**시작 골드**: 200.

> **v3.1 주석 — 유지비는 수입에서 떼지, 잔고에서 떼지 않는다.** 잔고 차감식(`p.goldMilli -= cost`)으로 만들면 수입이 0인 순간(전멸 직전) 잔고가 음수로 내려가고, 테크 구매 판정에 음수 분기가 생긴다. 수입 비율 차감은 **차감액이 그 tick 수입을 절대 초과하지 않으므로**(4.4절 `GARRISON_UPKEEP_MAX_PERMILLE = 700 < 1000`) 음수 잔고가 원리적으로 발생하지 않는다. 이것이 사용자 확정 조건 "적자로는 떨어지지 않는다"를 **튜닝이 아니라 구조로** 만족시키는 방법이다.

> **명시**: 병력 재생(`√tiles`)과 점유율 승리 판정(`p.tiles / totalLandTiles`)은 **순수 타일 개수**를 쓴다. 가중치는 **골드에만** 적용한다.

### 3.4 테크 트리 (4축 × 3단계)

- 각 축은 T1 → T2 → T3 순차 해금. 축을 건너뛸 수 없다. 구매는 즉시 발효, 되돌릴 수 없다.

```
cost(tier, purchasedCount) = floor( BASE[tier] * (1000 + 250 * purchasedCount) / 1000 )
BASE = { T1: 450, T2: 1100, T3: 2600 }
purchasedCount = 해당 플레이어가 이미 구매한 총 노드 수(축 무관)
```

| 축 | 효과 (T1 / T2 / T3, 누적값) | 상수명 |
|---|---|---|
| **군사** (Military) | 적 타일 점령비용 ×`0.93` / `0.86` / `0.78`<br>내 타일 피점령비용 ×`1.07` / `1.15` / `1.22` | `atkCostMult`, `defCostMult` |
| **경제** (Economy) | 골드 생산 ×`1.25` / `1.55` / `1.90`<br>병력 재생 ×`1.06` / `1.13` / `1.20` | `goldMult`, `regenMult` |
| **영토** (Territory) | 중립 타일 점령비용 ×`0.88` / `0.76` / `0.62`<br>병력 상한 ×`1.10` / `1.22` / `1.35` | `neutralCostMult`, `capMult` |
| **기동** (Mobility) | 깃발 이동속도 ×`1.45` / `1.72` / `2.00`<br>깃발 슬롯 `+0` / `+1` / `+2`<br>병종 전환 효율 ×`1.08` / `1.15` / `1.22` | `flagSpeedMult`, `flagSlotBonus`, `convertEffMult` |

미구매 시 모든 배율 = `1.00`, 슬롯 보너스 = `0`.

**v3.0 재해석 — 각 축이 어떻게 살아남았는가**

| 축 | v2.1의 근거 | **v3.0의 근거** |
|---|---|---|
| 군사 `atkCostMult` | 공격 비용 −7% | 그대로. **다만 이제 방어 되돌리기 대비 우위로도 환산된다** — `defRefCost`에는 `atkCostMult`가 들어가지 않으므로(4.7절) 군사 축은 게이지 줄다리기에서 **순수 이득**이다 |
| 군사 `defCostMult` | 내 타일이 비싸짐 | **v3.0에서 가치가 올랐다.** `defRefCost`에 그대로 들어가므로 내 반격 AP의 되돌리기 효율까지 같이 올린다. 즉 군사 축은 유일하게 **공/방 양쪽에 붙는 축** |
| 경제 | 골드·재생 | 변화 없음. 재생 +6%는 v3.0에서 "반격 탄약 +6%"로 읽힌다 |
| 영토 `neutralCostMult` | 중립 확장 | 변화 없음 (1단계는 v3.0에서 규칙이 안 바뀐다) |
| 영토 `capMult` | "웅크리기 상한 +10%" | **문구 폐기.** 새 의미 = **동시 투사 총량 +10%** = 슬롯당 병력 +10% |
| 기동 `flagSpeedMult` | 행군 단축 | **v3.0에서 가치가 올랐다** — 공격 도달만이 아니라 **반격 도달 시간**을 줄인다. F.1의 선공 우위를 막는 1차 수단 |
| 기동 `flagSlotBonus` | 동시 작전 수 | **v3.0에서 가장 크게 올랐다** — 슬롯이 이제 "동시에 지킬 수 있는 전선 수"이기도 하다(5.5절 동맹 근거) |
| 기동 `convertEffMult` | 병종 편성비 | 변화 없음 |

**T1 효과 크기 비교 (v3.0)**:

| 축 T1 | 즉시 체감 이득 | 환산 |
|---|---|---|
| 군사 | 적 타일 7% 저렴 + 내 타일 7% 비쌈 | 게이지 줄다리기 순증감 **+15%** (4.7절 손익분기표) |
| 경제 | 골드 +25%, 재생 +6% | 반격 탄약 **+6%** 즉시 + 테크 속도 +25%(복리) |
| 영토 | 중립 12% 저렴, 투사 상한 +10% | 중립 확장 **+13.6%**, 슬롯당 병력 +10% |
| 기동 | 이동속도 +45%, 전환 효율 +8% | 작전 회전율 **+9.3~19.3%** + **반격 도달 −31%** + 기병 편성비 −7.4% |

> **기동 축이 v3.0에서 대역 상단으로 올라왔다.** 반격 도달 시간 단축은 v2.1에 없던 새 가치다. 지금 수치를 낮추지 않는 이유는 (a) 실측 없이 조정하면 v2.1의 5.1.2절 검산 전체를 무효화하고, (b) 기동 축은 **기지를 못 가진 쪽일수록 이득이 큰** 유일한 축이라 상향 편향이 약자 보정으로 작동하기 때문이다. **관측 항목으로 미결정 사항 5번에 남긴다.** 지정 레버는 `flagSpeedMult` 1.45/1.72/2.00 → 1.35/1.60/1.85.

중립이 남아있는 8.1분 전까지는 영토·경제가 강하고, 그 이후엔 군사·기동이 강하다. **축 선택이 곧 "언제 승부를 볼 것인가"의 선언**이다. 세션당 구매 가능 수는 5.7절에서 검산한다.

---

## 4. 전투 해석 규칙 — 깃발(Flag) + 양방향 진척도

> **v2.1의 4.7절(본국 자동 방어)은 전면 폐기했다.** 4.1~4.5절(국경 면 정의, 깃발 상태, 발령, 이동, 목표 고정)은 v2.1에서 **거의 그대로 계승**하고 자세(posture) 관련 조항만 덧붙인다. 4.6~4.13절이 v3.0의 새 전투 규칙이다.
>
> **Phase A는 읽기 전용, Phase B만 쓰기라는 v1.0 이래의 구조는 그대로 유지된다**(4.9절). 이것이 결정론의 유일한 보증 장치다.

### 4.1 국경 면(Front)의 정의 — 앵커 + 반경 디스크 (v2.1 계승 + 방어 확장)

**정의**: 작전 구간은 `(앵커 타일 anchorTileId, 자세 posture)` 쌍으로 지정되고, 매 tick **파생 계산**된다. 저장되지 않는다.

```
// 공격 자세 — 밀어붙일 대상 집합
front(f) = { t :  tile[t].owner == f.targetOwnerId
                  AND terrain[t] != WATER
                  AND distance(t, f.anchorTileId) <= FRONT_RADIUS      // = 6
                  AND ∃ n ∈ neighbors(t) : tile[n].owner == f.ownerId }

정렬: ( distance(t, anchor) ASC, tileCost(f, t) ASC, t ASC )           // 3중 → 동률 없음

// 방어 자세 — 지켜낼 대상 집합                                        ⟵ v3.0 신규
guard(f) = { t :  tile[t].owner == f.ownerId
                  AND terrain[t] != WATER
                  AND distance(t, f.anchorTileId) <= FRONT_RADIUS }
```

세 가지 요구조건은 v2.1과 동일하게 충족된다.

- **(a) 결정론·저비용** — 반경 6 디스크는 사각 격자에서 85타일(맨해튼 원). 깃발당 최대 85회 조회, 룸 전체 20~30개 깃발이면 tick당 2,500회 미만. 5Hz에서 문제되지 않는다.
- **(b) 안정성** — 앵커는 좌표일 뿐 상태가 아니다. `front`/`guard`는 저장되지 않고 매 tick 다시 만들어진다.
- **(c) UI 직관성** — 화면에 **반경 6의 원 하나**. 공격이면 붉은 테두리, 방어면 푸른 테두리. 원 안에서 진척 중인 게이지가 그라데이션으로 보인다.

#### `FRONT_RADIUS = 6`의 새 근거 — 방어 디스크의 기하학 (미결정 1번 재검토)

v2.1에서 이 값은 "한 작전이 몇 타일을 먹는가"만 결정했다. v3.0에서는 **한 깃발이 몇 타일을 지킬 수 있는가**도 결정한다. 이쪽이 훨씬 민감하다.

```
반경 r 디스크가 커버하는 국경 전면(frontage) ≈ 2r + 1 타일
T 타일 제국의 둘레 ≈ 4·sqrt(T)                       // 사각 격자, 정사각 근사
필요 방어 구간 수 = 4·sqrt(T) / (2r+1)
```

| T | 둘레 | r=4 (전면 9) | **r=6 (전면 13)** | r=8 (전면 17) | `flagCap`(무테크) |
|---|---|---|---|---|---|
| 390 | 79 | 8.8 | **6.1** | 4.6 | 4 |
| 600 | 98 | 10.9 | **7.5** | 5.8 | 5 |
| 900 | 120 | 13.3 | **9.2** | 7.1 | 6 |
| 1,200 | 139 | 15.4 | **10.7** | 8.2 | 7 |

- **r=4면 방어가 성립하지 않는다** — 390타일에서도 8.8구간이 필요한데 슬롯은 4개다. 전 구간 방어가 구조적으로 불가능하면 "방어 = 반격"이라는 B항 자체가 죽는다.
- **r=8이면 웅크리기가 성립한다** — 900타일에서 7.1구간을 슬롯 6개로 거의 다 덮는다. 5.5절의 동맹 근거(슬롯 부족)가 무너진다.
- **r=6은 "실제 적대 전선은 둘레의 30~50%"라는 관측과 맞물려, 항상 슬롯의 절반쯤을 방어에 써야 하는 대역**을 만든다. 390타일 → 적대 구간 2~3개 / 슬롯 4개. 900타일 → 적대 구간 3~5개 / 슬롯 6개.

> **판정: `FRONT_RADIUS = 6` 유지.** v2.1에서 "최우선 검증 항목"이었던 이 값은 v3.0에서 **기하학적 근거를 얻었다.** 관측 지표는 교체한다 — v2.1의 `flag_idle(front_cleared)` 비율 대신 **"방어 자세 슬롯 비중이 30~55% 대역에 있는가"**를 본다(미결정 6번).

**앵커 사거리 제한**: 발령 시 `min over p 소유 타일 t of distance(t, anchor) <= FRONT_MAX_RANGE (=40)`.

### 4.2 깃발의 상태 (v3.0)

```
flag {
  id            : uint32     // 전역 단조증가. 결정론 정렬 키이자 프로토콜 식별자
  ownerId       : uint8
  slotIndex     : uint8      // 0..flagCap-1. UI 단축키(F1..F7) 대응
  unit          : 0=SPEAR | 1=SWORD | 2=CAVALRY     // 발령 시 고정, 변경 불가
  posture       : 0=ATTACK | 1=DEFEND               // ⟵ 내부 파생값. 앵커 소유자로 자동 결정 (A-5)
  troopsMilli   : int
  initialTroops : int        // 발령 시점 값. AP 산출의 분모
  state         : MARCHING | ENGAGED | RETURNING | IDLE
  stalled       : bool       // ⟵ v3.0 신규
  stallSinceTick: uint32|null
  posTileId     : uint32
  moveProgMilli : 0..999     // 이동 진행도 (v2.1의 progressMilli 를 개명)
  progressMilli : 0..999     // ⟵ v3.0 신규. 점령 진척도. 적·중립 앵커일 때만 유효
  targetTileId  : uint32|null// ⟵ v3.0 신규. 지금 밀고 있는 타일. sticky
  nextTileId    : uint32
  anchorTileId  : uint32
  targetOwnerId : uint8      // 적·중립 앵커일 때만 유효. 0 = NEUTRAL
  lockUntilTick : uint32
  idleSinceTick : uint32|null
  originTileId  : uint32
  returnTileId  : uint32|null
  spendBudgetMilli : int     // ENGAGED 중 누적되는 AP 예산
}
```

> **개명 주의**: v2.1의 `progressMilli`(이동 진행도)는 v3.0에서 `moveProgMilli`로 이름이 바뀌었고, `progressMilli`는 **점령 진척도**를 뜻한다. 백엔드는 이 두 값을 절대 혼동하면 안 된다.

**v3.0에서 늘어난 네 필드(`posture`, `progressMilli`, `targetTileId`, `stalled`)는 전부 깃발 상태다.** 일반 타일의 가변 상태는 여전히 `owner` 하나다(design-decisions C항).

**`progressMilli`가 깃발에 사는 것의 세 가지 결과** — 이것이 C항의 실질적 의미다.

1. **깃발이 죽거나 재지정되면 진척도가 통째로 사라진다.** 게이지는 부대의 기세이지 땅의 성질이 아니다. 이것이 F.1(선공 절대 우위 방지)의 핵심 장치 중 하나다 — 공격자가 90%까지 밀어놓고 격퇴당하면 그 작업은 0이 된다.
2. **같은 타일에 여러 공격자가 붙으면 각자의 게이지가 따로 찬다.** 먼저 1000에 닿는 쪽이 가져가고 나머지 게이지는 리셋된다(4.10절). "여럿이 같은 곳을 치면 낭비"라는 v2.1의 성질이 상수 없이 재현된다.
3. **대역폭이 깃발 수에 비례한다.** 타일 수(3,900)가 아니라 깃발 수(≤84)에 비례하므로 매 tick 전송이 가능하다(7.5절).

### 4.3 깃발 발령 (v3.1 개정 — 앵커 소유자에 따른 동작 분기)

```
function issueFlag(p, unit, troopsReq, anchorTileId, originBaseTileId|null, clientSeq):
  if p.eliminated                              -> reject "ELIMINATED"
  if p.flags.length >= flagCap(p)              -> reject "NO_SLOT"
  if unit not in {0,1,2}                       -> reject "BAD_UNIT"
  if terrain[anchorTileId] == WATER            -> reject "WATER"
  if minDistFromTerritory(p, anchorTileId) > FRONT_MAX_RANGE  -> reject "OUT_OF_RANGE"
  if troopsReq < FLAG_MIN_TROOPS (=40)         -> reject "TOO_SMALL"

  // ── 앵커 소유자로 동작 분기 (내부 파생값). 플레이어 입력은 하나뿐이다 ──
  anchorOwner = tile[anchorTileId].owner
  if anchorOwner == p.id:
       posture = DEFEND ; targetOwnerId = 0                 // targetOwnerId 미사용
  else:
       if isAllyOrBreaking(p.id, anchorOwner) -> reject "ALLIED"
       posture = ATTACK ; targetOwnerId = anchorOwner

  // ── 출발 기지 결정 (v2.1 계승) ──
  if originBaseTileId != null:
     if isBase[originBaseTileId] == 0                 -> reject "NOT_BASE"
     if tile[originBaseTileId].owner != p.id          -> reject "NOT_OWNED_BASE"
     origin = originBaseTileId
  else if p.baseTiles is not empty:
     origin = argmin over t ∈ p.baseTiles of ( distance(t, anchorTileId), t )
  else:
     origin = argmin over t ∈ p 소유 타일 of ( distance(t, p.homeTileId), t )

  poolCost = ceil( troopsReq * UNIT_CONVERT_PERMILLE[unit] / convertEffMult_permille(p) )
  if poolCost > p.troops                       -> reject "INSUFFICIENT"

  p.troops -= poolCost
  f = { id: ++globalFlagSeq, ownerId: p.id, slotIndex: 최소 미사용 슬롯,
        unit, posture, troopsMilli: troopsReq*1000, initialTroops: troopsReq,
        state: MARCHING, posTileId: origin, moveProgMilli: 0,
        progressMilli: 0, targetTileId: null, stalled: false,
        anchorTileId, targetOwnerId, lockUntilTick: 0,
        originTileId: origin, returnTileId: null, spendBudgetMilli: 0 }
  buildDistanceField(f, f.anchorTileId)
  emit flag_issued(...)
```

**`SELF` 거절이 사라진 것이 이 절의 전부다.** v2.1에서 "내 타일을 앵커로 지정"은 오류였다. v3.1에서는 그것이 정상 명령이다.

> **A-5 (사용자 확정, 2026-08-12) — "자세"는 플레이어에게 노출되는 개념이 아니다.**
> 규칙은 **"깃발을 어디로 보내느냐"** 하나뿐이다. **내 땅으로 보내면 이동하며 지키고, 적·중립 땅으로 보내면 밀고 들어간다.** 그뿐이다.
> `posture` / `ATTACK` / `DEFEND`는 **서버 내부 파생값의 이름**이며, UI·튜토리얼·플레이어 대상 설명에서 1급 개념으로 등장시키지 않는다. 모드도, 토글도, 고를 것도 없다. 이 문서에서도 규칙을 서술할 때는 "자세를 고른다"가 아니라 **"어디로 보내느냐에 따라 결과가 다르다"**로 읽는다.

클라이언트는 **모드 표시나 토글을 두지 않는다.** 커서가 예고하는 것은 자세라는 이름이 아니라 **결과** — 게이지가 어느 방향으로 움직일지 — 뿐이다.

| 커서 위치 | 원 색 | 툴팁 (자세 이름을 쓰지 않는다) | 실제 동작 |
|---|---|---|---|
| 적/중립 타일 | 붉은 테두리 | `이 방향으로 밀어붙임 · 대상 12타일 · 예상 진척 4.3타일/초` | 게이지를 올림 |
| 내 타일 | 푸른 테두리 | `여기로 이동해 지킴 · 보호 34타일 · 적 진척 2건 진행 중` | 적 게이지를 되돌림 |
| 동맹 타일 | 회색(불가) | `동맹 영토` | 거절 |

**조작 단계는 늘지 않는다.** 병종 키 → 맵 클릭 = 2액션. 클릭 지점이 곧 결과이므로 별도 입력이 없다. 5.6절 APM 검산은 이 전제 위에 있다.

**내 땅으로 보낸 깃발은 이동(재배치)도 겸한다 — 방어 전용 명령이 아니다.** 다음을 명시적 규칙으로 둔다.

1. **교전이 없는 내 땅 안쪽으로 보내도 정상 명령이다.** 깃발은 앵커까지 행군하고, 도착 후 디스크 안에 되돌릴 적 게이지가 없으면 `IDLE`이 된다(4.10절 `guard_lost` 아님 — 처음부터 위협이 없었던 경우다).
2. 그 상태에서 적 깃발이 디스크 안으로 들어오면 **재발령 없이 곧바로 되돌리기가 시작된다.** 이것이 "미리 배치해 두는" 플레이를 성립시킨다.
3. 따라서 병력을 전선 A에서 전선 B로 옮기는 수단은 **회수 후 재발령**(15% 손실)과 **내 땅 앵커로 재지정**(무손실, 단 행군 시간)의 둘이다. 후자가 기본 수단이 되도록 의도한다.
4. **주둔 유지비는 앵커에 도착해 `ENGAGED`가 된 tick부터 붙는다** (A-1 확정, v3.1). 행군 중(`MARCHING`)·`IDLE`·`RETURNING`에는 한 푼도 붙지 않는다. **따라서 위 3항의 "내 땅 앵커로 재지정 = 무손실 재배치"는 골드 관점에서도 무료다** — 이동하는 동안은 과금이 멈추고, 새 앵커에 도착해 실제로 지키기 시작할 때 다시 붙는다. 행군 중에도 과금하면 먼 전선의 방어가 행군 시간과 골드로 이중 과금되어, 재배치를 기본 수단으로 두려는 3항의 의도와 정면으로 충돌한다.

**깃발 슬롯 수** (v2.1 그대로):

```
flagCap(p) = min( FLAG_CAP_HARD_MAX,
                  FLAG_CAP_BASE + floor(p.tiles / FLAG_TILES_PER_SLOT) + flagSlotBonus(p) )
FLAG_CAP_BASE = 3,  FLAG_TILES_PER_SLOT = 300,  FLAG_CAP_HARD_MAX = 7
```

| 타일 | 테크 없음 | 기동 T2 | 기동 T3 |
|---|---|---|---|
| 9 (시작) | **3** | 4 | 5 |
| 300 | 4 | 5 | 6 |
| 600 | 5 | 6 | 7 |
| 900 | 6 | 7 | 7 |
| 1200+ | 7 | 7 | 7 |

> **v3.0에서 이 표의 의미가 근본적으로 바뀌었다.** v2.1에서 슬롯은 "동시 공격 수"였다. v3.0에서는 **"동시 공격 수 + 동시 방어 수"의 합**이다. 슬롯 4개는 "2곳 공격 + 2곳 방어" 또는 "4곳 공격 + 0곳 방어(도박)"를 의미한다. 이 유한성이 5.5절 동맹 근거의 전부이며, `FLAG_CAP_HARD_MAX`를 올리는 변경은 **v3.0에서 더욱 금지**된다.

### 4.4 이동 (v2.1 계승 + 주둔 유지비)

**경로 결정 — 거리장(distance field)**: 발령/재지정 시 앵커에서 출발하는 역방향 BFS를 한 번 돌려 거리장을 만들고, 이후 매 tick O(1)로 내리막을 따라간다. 도착 시 즉시 해제. 같은 목적지를 가진 깃발끼리 refcount 공유. (v2.1과 동일)

```
speedMilli(f) = max( 1,
   floor( FLAG_SPEED_BASE_MILLI * UNIT_SPEED_PERMILLE[f.unit] * flagSpeedMult_permille(p)
          / (TERRAIN_MOVE_PERMILLE[terrain[f.posTileId]] * 1000) ) )
FLAG_SPEED_BASE_MILLI = 120       // 검병·평원·무테크 = 0.6 타일/초
```

| 병종 | 속도 배율 | 평원 타일/초 | 11타일 행군 |
|---|---|---|---|
| 창병 | `0.75` | 0.45 | **27초** |
| 검병 | `1.00` | 0.60 | **20초** |
| 기병 | `1.45` | 0.87 | **14초** |

**매 tick 이동 처리** (tick 순서 4단계, `flag.id` 오름차순):

```
for f in flags sorted by f.id ASC:
   if t < f.lockUntilTick: continue
   if f.state == ENGAGED or f.state == IDLE:
        applyExposureAttrition(f); continue        // ⟵ v3.1: 주둔 유지비는 여기서 빠졌다(골드 단계로 이동)
   f.moveProgMilli += speedMilli(f)
   while f.moveProgMilli >= 1000:
        f.moveProgMilli -= 1000
        f.posTileId = f.nextTileId
        f.nextTileId = stepTarget(f)
        if f.state == MARCHING and f.posTileId == f.anchorTileId: break
   applyExposureAttrition(f)

   // 도착 판정 — 자세별로 조건이 다르다                        ⟵ v3.0
   if f.state == MARCHING and f.posture == ATTACK
      and front(f) is not empty
      and ∃ tile in front(f) : distance(tile, f.posTileId) <= FLAG_ENGAGE_RANGE (=1):
         f.state = ENGAGED; f.field = null; emit flag_engaged(...)
   else if f.state == MARCHING and f.posture == DEFEND and f.posTileId == f.anchorTileId:
         f.state = ENGAGED; f.field = null; emit flag_engaged(...)     // 주둔 개시
   else if f.state == MARCHING and f.posTileId == f.anchorTileId:
         f.state = IDLE; f.idleSinceTick = t; emit flag_idle(...)
   if f.state == RETURNING: (v2.1과 동일 — recallTarget 재평가 + 도착 시 85% 환불)

applyExposureAttrition(f):                          // v2.1과 동일
   o = tile[f.posTileId].owner
   if o != f.ownerId and not isAlly(f.ownerId, o):
        f.troopsMilli -= max(1000, floor(f.troopsMilli * FLAG_EXPOSED_ATTRITION_BP / 10000))
        if f.troopsMilli <= 0: destroy(f); emit flag_ended(reason="attrited")

// v3.1(A-1): applyGarrisonUpkeep(f) 폐기. 주둔 유지비는 병력을 건드리지 않는다.
//            골드 정산(tick 2단계)에서 플레이어 단위로 처리한다 — 아래 참조.
```

#### 주둔 유지비 — 골드 소모 (v3.1, A-1 사용자 확정)

**문제(v3.0에서 그대로)**: 내 땅에 세운 깃발은 적의 진척이 없으면 AP를 한 톨도 쓰지 않는다(4.7절 (c)). 그대로 두면 **전 국경에 깃발을 세워두고 영원히 버티는 것이 최적해**가 되고, 게임이 42분 하드 타임아웃으로 굳는다. design-decisions E항의 "쟁여두면 손해 → 계속 내보내는 압력"이 방어 쪽으로 새는 구멍이다.

**v3.1의 답**: 그 압력을 **병력이 아니라 골드**에 건다. 주둔 깃발은 병력이 1도 줄지 않고, 대신 **그 플레이어의 그로스 골드 수입에서 정률로 떼어 간다.**

##### (a) 산식

```
// ── Phase A (읽기 전용, tick 9단계에서 갱신된 값을 tick 2단계가 읽는다)
isGarrison(f)  =  f.state == ENGAGED  AND  tile[f.anchorTileId].owner == f.ownerId
                                                    // "내 땅 앵커에 도착해 서 있는 깃발"
                                                    // MARCHING / IDLE / RETURNING = 무과금

garrisonWeight(p) = Σ over f in flags(p) where isGarrison(f), sorted by f.id ASC:
                       UNIT_GARRISON_PERMILLE[f.unit] * escalate(f)      // permille 정수 누산

// ── Phase B (골드 정산 — 3.3절 goldMilliPerTick 직후, 같은 tick 2단계)
billable(p)  = max( 0, garrisonWeight(p) - GARRISON_UPKEEP_FREE_PERMILLE )
drainPm(p)   = min( GARRISON_UPKEEP_MAX_PERMILLE,
                    floor( billable(p) * GARRISON_UPKEEP_PERMILLE / 1000 ) )
garrisonUpkeepMilli(p) = floor( goldMilliPerTick(p) * drainPm(p) / 1000 )
```

```
GARRISON_UPKEEP_PERMILLE      = 90     // 과금 가중치 1.000당 그로스 골드 수입의 9.0% / tick
GARRISON_UPKEEP_FREE_PERMILLE = 1000   // 가중치 1.000(= 검병 주둔 1개분)까지 면제
GARRISON_UPKEEP_MAX_PERMILLE  = 700    // 총 유지비 상한 = 그로스의 70%. 순증 ≥ 0 보증 레일
UNIT_GARRISON_PERMILLE        = { SPEAR: 600, SWORD: 1000, CAVALRY: 1600 }   // 값 유지, 의미 변경
GARRISON_ESCALATE_TICK        = 900    // 3분. 무위협 누진 단계 간격 ((c) 보완 규칙)
GARRISON_ESCALATE_MAX         = 1      // ⟵ 2026-08-12 사용자 기각. escalate(f) ≡ 1 (누진 비활성)
```

**결정론**: 전 구간 permille 정수 + `floor`. 제곱근·분수 지수·부동소수 누산 없음. 순회는 `f.id ASC`. 타일 가변 상태는 건드리지 않는다(읽기만). 유지비 계산은 깃발 수(≤7)에 대한 합산이므로 플레이어당 tick 7회 이하 — tick 비용에 영향 없다.

**한 문장 요약**: **한 전선을 지키는 것은 공짜다. 전 국경을 지키는 것이 비싸다.** `GARRISON_UPKEEP_FREE_PERMILLE = 1000`이 그 문장을 그대로 구현한다 — 검병 1개(또는 창병 1.67개)까지는 과금이 0이고, 그 위부터 슬롯 하나마다 수입의 9%씩 떨어져 나간다.

##### (b) 튜닝 검산 — 순증 ≥ 0 이면서 얼마나 둔해지는가

**순증 ≥ 0은 튜닝이 아니라 구조다.** `drainPm ≤ 700 < 1000`이므로 `garrisonUpkeepMilli(p) ≤ floor(goldMilliPerTick(p) × 0.7) < goldMilliPerTick(p)`. 어떤 편성으로도 tick당 순증은 **그로스의 최소 30%**가 남는다. 적자는 원리적으로 불가능하다.

**최악 케이스 = `FLAG_CAP` 슬롯을 전부 방어로 채웠을 때** (`billable = 슬롯수 × 병종가중치 − 1.000`):

| 슬롯(`flagCap`) | 전부 창병 | **전부 검병** | 전부 기병 |
|---|---|---|---|
| 3 | 72‰ (7.2%) | 180‰ (18.0%) | 342‰ (34.2%) |
| 4 | 126‰ (12.6%) | 270‰ (27.0%) | 486‰ (48.6%) |
| 5 | 180‰ (18.0%) | **360‰ (36.0%)** | 630‰ (63.0%) |
| 6 | 234‰ (23.4%) | **450‰ (45.0%)** | 700‰ (레일, 70.0%) |
| 7 | 288‰ (28.8%) | **540‰ (54.0%)** | 700‰ (레일, 70.0%) |

> **목표 대역 30~50% 둔화에 정확히 들어간다.** 표준 병종(검병)으로 슬롯 5·6·7을 전부 방어에 쓰면 **36% / 45% / 54%** 둔화다. 슬롯 3·4(타일 300 미만 = 개전 8분 이내)에서 18~27%로 낮은 것은 의도다 — 그 구간은 전원이 중립 확장 중이라 전면 방어 배치 자체가 비현실적이고, 여기에 세금을 걸면 1단계 페이싱(5.2절 8.14분)이 흔들린다. **유지비는 중반 이후에만 실질적으로 작동하도록 설계했다.**

**절대량으로 보면** (중반 표준, 500타일, 무테크. 그로스 = `500 × 1.4957 = 748 milli/tick` = **224 골드/분**):

| 주둔 편성 | 가중치 | 과금 | 둔화 | 분당 손실 | 10분 누적 |
|---|---|---|---|---|---|
| 없음 | 0 | 0 | 0% | 0 | 0 |
| 창 1 | 600 | 0 | **0%** | 0 | 0 |
| 검 1 | 1000 | 0 | **0%** | 0 | 0 |
| 창 2 | 1200 | 200 | 1.8% | 4.0 | 40 |
| 창1+검1 | 1600 | 600 | 5.4% | 12.1 | 121 |
| 검 2 | 2000 | 1000 | 9.0% | 20.2 | 202 |
| 창2+검1 | 2200 | 1200 | 10.8% | 24.2 | 242 |
| 검 3 | 3000 | 2000 | 18.0% | 40.3 | 403 |
| 검 5 (최악, cap 5) | 5000 | 4000 | 36.0% | 80.6 | **806** |

T1 노드 1개가 450골드다(3.4절). 즉 **5슬롯 전면 방어를 10분 유지하면 T1 하나를 통째로 못 산다.** 체감 기준으로 충분하다.

**싸우는 방어는 여전히 거의 공짜인가**: 중반 표준 교전 지속은 13~17초(5.1절)다. 검병 2개 주둔으로 15초 교전하면 손실은 `20.2 × 0.25분 = 5.0골드`. T1 값의 1.1%다. **v3.0 병력 유지비가 갖던 "싸우는 방어에는 무료, 방치 방어에는 시간당 비용"이라는 비대칭이 골드 축에서 그대로 재현된다** — 유지비가 시간 적분이고, 교전은 짧고, 웅크리기는 길기 때문이다.

##### (c) 원래 목적 재증명 — 골드 압박만으로 웅크리기가 막히는가

**결론부터: 골드 단독으로는 막히지 않는다. 이것은 A-1의 실질 손실이며 숨기지 않는다.**

v3.0의 병력 유지비는 **하드 감쇠**였다. 주둔 깃발이 8.3분 뒤 `exhausted`로 소멸하고 환불도 0이었으므로, 상시 벽은 병력 풀을 태워 없앴다. 물리적으로 유지 불가능했다. 골드 유지비에는 그 성질이 없다 — **주둔은 이제 무한히 지속 가능하고, 대가는 템포뿐이다.** "느려질 뿐 죽지는 않는다"는 하드 스톱이 아니다.

그래서 차단은 **한 겹이 아니라 세 겹의 합**으로 다시 세운다. 골드는 그중 하나다.

**① 기하학 — 전 국경 커버는 애초에 슬롯이 모자란다 (하드 제약).**
`guard(f)`는 반경 6 디스크다(4.1절). 디스크 하나가 감당하는 국경 정면 길이는 지름 13타일이다. 900타일 블롭의 둘레는 `4 × √900 ≈ 120`타일이므로 **필요 디스크 ≈ 120 / 13 ≈ 9.2개**다. `FLAG_CAP_HARD_MAX = 7`이므로 **전 국경 커버는 슬롯 수로 원천 불가능**하고, 최대치를 쏟아부어도 커버율은 76%다. 나머지 24%는 상시 개방된다. 영토가 커질수록(둘레 ∝ √tiles, 슬롯은 300타일당 +1) 이 격차는 벌어진다.

**② 골드 템포 — 웅크릴수록 상대에게 테크로 추월당한다 (소프트 압박, A-1이 담당).**
900타일에서 6슬롯 전면 방어는 45% 둔화다. 그로스 404골드/분 중 182를 잃는다. 19분→39분의 20분을 그렇게 버티면 누적 손실 **3,634골드 = T3 노드 하나 + T1 하나**다. 같은 시간 동안 공격자는 수입의 100%를 유지하면서 **타일까지 늘리므로 수입 자체가 복리로 벌어진다.** 웅크린 쪽의 수입은 평평하고 미는 쪽의 수입은 우상향한다.

**③ 승리 조건 — 웅크려서는 이길 수 없다 (구조).**
점유율 승리는 임계 45~60%다(6.1절). 900/3900 = 23%인 웅크린 플레이어는 **임계에 영원히 닿지 못한다.** 웅크리기가 노릴 수 있는 결과는 42분 타임아웃 + 타일 수 1위뿐인데, ①에 의해 국경의 24%가 열려 있고 ②에 의해 상대의 테크가 앞서므로 그 20분을 무손실로 버틸 수 없다. 덤으로 6.1의 3순위 타이브레이커 "누적 획득 골드"가 **순증 누계**로 정의되므로(3.3절) 웅크리기는 타이브레이커에서도 손해다.

**남는 구멍**: ①②③은 **큰 영토를 가진 선두**에게만 잘 작동한다. **좁은 영토를 가진 소수(200~400타일, 슬롯 4)** 는 둘레가 짧아 3~4개 디스크로 국경을 거의 다 덮을 수 있고, 유지비도 12.6~27%로 가볍다. 즉 **"작게 웅크리는 농성"은 v3.1에서 실제로 더 쉬워졌다.** v3.0에서는 병력 감쇠가 이것도 같이 막았다.

##### (d) 보완 규칙 — 무위협 누진 (설계자 제안, 기본 활성)

(c)의 남는 구멍을 메우기 위해, **위협이 없는데도 계속 서 있는 깃발만** 골드 축에서 비싸지게 한다. 병력 유지비가 갖던 "방치에 대한 벌"을 골드로 복원하는 최소 장치다.

```
// tick 9단계(파생 상태)에서 갱신. Phase B 이후이므로 이번 tick의 진척도 결과를 본다
threatened(f) = ∃ t ∈ guard(f) : tile[t].progressMilli > 0        // 되돌릴 적 진척이 있는가
if threatened(f) or f.state != ENGAGED:  f.calmTicks = 0
else:                                    f.calmTicks += 1

escalate(f) = min( GARRISON_ESCALATE_MAX,
                   1 + floor(f.calmTicks / GARRISON_ESCALATE_TICK) )    // 1 → 2 → 3
```

| 무위협 연속 시간 | `escalate` | 검병 1개 가중치 | 6슬롯 전면 방어(검) |
|---|---|---|---|
| 0~3분 | 1 | 1000 | 450‰ |
| 3~6분 | 2 | 2000 | 700‰ (레일) |
| 6분~ | 3 | 3000 | 700‰ (레일) |

- **싸우고 있는 방어는 영향이 전혀 없다.** 디스크 안에 적 진척이 1이라도 있으면 `calmTicks`가 0으로 리셋된다.
- **위협에 대비해 미리 세우는 배치(4.3절 2항)도 3분까지는 무료다.** 반격 도달 시간(4.7절)과 봇의 `BOT_GARRISON_PATIENCE = 900`(3분)과 같은 눈금이라 규칙이 하나로 읽힌다.
- 작은 영토의 농성도 3분 뒤 실효 유지비가 뛴다. 4슬롯 검병 농성은 `4000 → 8000` 가중치가 되어 **27% → 63% 둔화**다(면제 1000이 상대적으로 작아지므로 둔화는 2배보다 더 커진다). (c)의 구멍이 실질적으로 닫힌다.
- **순증 ≥ 0 불변식은 유지된다** — `GARRISON_UPKEEP_MAX_PERMILLE = 700` 레일이 누진 뒤에도 상한을 잡는다.

> **⛔ 2026-08-12 사용자 기각 — 이 (d)항은 비활성 상태로 문서에만 남긴다.** `GARRISON_ESCALATE_MAX = 1`이므로 `escalate(f) ≡ 1`이고, (a)의 정률 유지비만 작동한다. **백엔드는 누진 로직을 구현하지 않아도 된다**(상수만 노출하면 나중에 되살릴 수 있다).
>
> 기각 사유는 "구멍을 알고 남긴다"이다. 즉 **좁은 영토 4슬롯 소규모 농성이 27% 둔화만 물고 성립한다는 것을 알면서 수용**한 것이며, 규칙 하나를 더 얹는 것보다 플레이테스트로 실제 문제가 되는지 보는 쪽을 택했다. 관측은 B-10에서 계속한다.
>
> (원래 맥락) A-1은 "자원을 골드로 바꾼다"까지가 사용자 확정이었고, 누진은 그 결과 생긴 구멍에 대한 설계자 보완 제안이었다.
>
> **채택하지 않은 대안**: (ㄱ) 내 땅 깃발에도 `FLAG_IDLE_TIMEOUT`을 걸어 강제 회수 — 5분마다 방어를 재발령해야 해서 5.6절 APM 검산이 깨진다. (ㄴ) `FLAG_CAP_HARD_MAX` 인하 — 공격 슬롯까지 줄어 5.5절 동맹 근거가 무너진다. (ㄷ) 유지비를 병력·골드 동시 부과 — A-1 사용자 확정("병력이 아니라 골드")을 정면으로 위반한다.

##### (e) 방어의 기회비용이 어디로 갔는가 — `FLAG_RECALL_REFUND`와의 관계

**v3.0에서 방어의 대가는 병력이었다. v3.1에서 방어의 대가는 테크 진행 속도다.**

주둔 깃발의 병력은 이제 시간이 지나도 1도 줄지 않는다. 즉 **원금이 100% 보존된다.** 회수하면 `FLAG_RECALL_REFUND = 0.85`가 그대로 적용되어 85%가 풀로 돌아온다. 여기서 두 비용의 축이 완전히 분리된다.

| 축 | 무엇에 비례하는가 | 값 |
|---|---|---|
| **병력** | 주둔 시간과 **무관**. 회수 행위 1회당 고정 | 15% (`FLAG_RECALL_REFUND`) |
| **골드** | 주둔 **시간에 비례**. 회수하면 즉시 멈춤 | 슬롯당 수입의 9% / tick |

v3.0에서는 이 둘이 뒤섞여 있었다. 오래 주둔할수록 병력이 녹아 **환불받을 원금 자체가 줄었으므로**, "언제 회수하는가"가 병력 손실과 얽힌 결정이었다. v3.1에서는 **"언제 회수해도 병력 손실은 똑같이 15%"** 이고, 주둔 시간이 만드는 차이는 오직 골드(=테크)에만 나타난다. 플레이어가 계산해야 할 것이 하나 줄었고, 그 하나가 정확히 우리가 값을 매기고 싶은 것(시간)으로 옮겨갔다.

그리고 이 분리가 4.3절 3항을 강화한다. **회수 후 재발령(병력 15% 손실)** 과 **내 땅 앵커로 재지정(무손실 + 행군 중 유지비 정지)** 의 대비가 v3.1에서 더 선명해졌다 — 재지정은 두 축 모두에서 싸다. 의도한 대로 재배치가 기본 수단이 된다.

**이동 중 재지정** (`cmd_flag_retarget`) — **자세도 함께 바뀐다**:

```
if f.state == RETURNING                        -> reject "RETURNING"
newOwner = tile[new].owner
if isAllyOrBreaking(f.ownerId, newOwner)        -> reject "ALLIED"
if out of FRONT_MAX_RANGE                       -> reject "OUT_OF_RANGE"
f.anchorTileId     = new
f.posture          = (newOwner == f.ownerId) ? DEFEND : ATTACK      // ⟵ v3.0
f.targetOwnerId    = (f.posture == ATTACK) ? newOwner : 0
f.state            = MARCHING
f.lockUntilTick    = t + FLAG_RETARGET_LOCK_TICK    // 15 tick = 3초
f.progressMilli    = 0                              // ⟵ v3.0. 진척도는 이월되지 않는다
f.targetTileId     = null
f.stalled          = false ; f.stallSinceTick = null
f.spendBudgetMilli = 0
f.returnTileId     = null
buildDistanceField(f, f.anchorTileId)
```

**병종은 절대 바꿀 수 없다**(사용자 확정). **자세는 바꿀 수 있다** — 방어하던 깃발을 그 자리에서 반격으로 돌리는 것이 "게이지를 0으로 밀어낸 다음 무엇을 하는가"의 답이다(4.7절 (b)). 단 3초 경직 + 진척도 리셋 + 거리장 재생성이 붙으므로 공짜가 아니다.

**회수와 기지** (v2.1 그대로): `FLAG_RECALL_REFUND = 0.85`. `recallTarget(f)`는 ① 출발 기지 → ② 남은 내 기지 중 최근접 → ③ 수도 폴백 순. 매 tick 재평가하고 값이 바뀔 때만 거리장 재생성. **기지를 빼앗겨도 교전 중인 깃발은 아무 영향 없이 계속 싸운다**(사용자 확정, v2.1).

### 4.5 목표 소유자 고정과 중립 자동 전환 (v2.1 계승)

`targetOwnerId`는 ATTACK 자세에서 발령 시 고정된다. **단 하나의 예외**:

```
if f.posture == ATTACK and f.targetOwnerId == NEUTRAL and front(f) is empty:
     cands = { o : o ≠ f.ownerId, o ≠ NEUTRAL, o 가 디스크 안에 타일 보유,
                   not isAllyOrBreaking(f.ownerId, o) }
     if cands is not empty:
          f.targetOwnerId = argmin over cands of ( 그 소유자 타일의 최소 tileCost, o )
          f.targetTileId = null; f.progressMilli = 0
          emit flag_retargeted(auto=true, ...)
     else: f.state = IDLE
```

DEFEND 자세에는 자동 전환이 없다 — 방어 대상은 소유자가 아니라 내 땅이므로 전환할 것이 없다. `guard(f)`가 비면 곧장 IDLE이다.

### 4.6 AP·점령비용·진척도 — v3.0 핵심 공식

#### (a) AP(작전 포인트) 산출 — v2.1 누적 예산 구조 계승

```
// tick 순서 5단계 — Phase A 이전에 동결된다. 깃발별 독립 함수라 순서 의존성이 없다
for f in flags where f.state == ENGAGED sorted by f.id ASC:
   f.spendBudgetMilli = min( f.spendBudgetMilli + f.initialTroops * FLAG_SPEND_RATE_PERMILLE,
                             f.initialTroops * FLAG_SPEND_RATE_PERMILLE
                                             * FLAG_SPEND_BUDGET_CAP_TICKS )
availAP(f) = floor( min(f.spendBudgetMilli, f.troopsMilli) / 1000 )
```

`FLAG_SPEND_RATE = 0.015` → 깃발 하나가 전 병력을 태우는 데 **66.7 tick(13.3초)**. 예산 상한 25 tick분이 (a) 비싼 전선에서 대기하며 예산을 쌓아 터뜨리는 버스트와 (b) 행군 중 누적을 막는다. 재지정 시 0으로 리셋(4.4절).

#### (b) 점령비용 `tileCost` — 밀도항 제거, 보급선 항 추가

```
function tileCost(f, tile):                      // 공격자 f 기준
  p = players[f.ownerId]
  if tile.owner == NEUTRAL:
     base = ( NEUTRAL_BASE + NEUTRAL_SQRT_COEF * sqrt(p.tiles) ) * neutralCostMult(p)
     adj  = 1.0                                                    // 중립엔 응집 보너스 없음
  else:
     base = ENEMY_BASE * defCostMult(tile.owner) * atkCostMult(p)  // ⟵ 밀도항 삭제
     n    = |{ x ∈ neighbors(tile) : tile[x].owner == tile.owner }|   // 0..3
     adj  = 1 + ADJACENCY_COEF * n                                 // 1.00 ~ 1.45

  return max( MIN_TILE_COST,
              ceil( base * adj
                    * TERRAIN_COST_MULT[tile.terrain]
                    * UNIT_ATK_MULT[f.unit]
                    * supplyMult(p, tile)                          // ⟵ v3.0 신규
                    * endgameRushMult(t) ) )

supplyMult(p, tile) =                                              // ⟵ v3.0 신규
     min( SUPPLY_MAX_MULT,
          1 + SUPPLY_COEF * max(0, minDistToOwnBase(p, tile) - SUPPLY_FREE_RADIUS) )
     minDistToOwnBase(p, tile) = p.baseTiles 가 비었으면 SUPPLY_NO_BASE_DIST(=40),
                                 아니면 min over b ∈ p.baseTiles of distance(b, tile)

SUPPLY_FREE_RADIUS = 10,  SUPPLY_COEF = 0.02,  SUPPLY_MAX_MULT = 1.60,  SUPPLY_NO_BASE_DIST = 40
endgameRushMult(t) = (t >= ENDGAME_RUSH_TICK) ? ENDGAME_RUSH_COST_MULT : 1.0   // 37분 이후 0.75
```

v1.0 이래 유지되는 설계 의도:

- **중립 비용에 `sqrt(공격자 타일수)`** — 큰 제국일수록 빈 땅 먹기가 비싸진다. 병력 sqrt 감쇠에 이은 두 번째 브레이크. **v3.0에서 변경 없음.**
- **적 타일 기본값 > 중립** — 사람을 치는 것이 빈 땅 먹기보다 비싸야 초반 전면전이 안 터진다. v3.0에서 **명목 비율은 16 vs 9 = 1.78배로 줄었지만, 방어 응답을 포함한 실효 비율은 4.3배로 오히려 커졌다**(아래 (e)).
- **응집 보너스** — 뾰족한 돌출부는 싸고 뭉친 본토는 비싸다. 영토를 둥글게 유지하려는 압력. **v3.0에서 상대적 비중이 커졌다** — 밀도항이 사라져 `adj`가 정적 분산의 주역 중 하나가 됐다.

**`ENEMY_BASE` 25 → 16의 역산 근거**는 5.3절에 있다. 요약: v2.1에서 밀도항(밀도 8 기준 +24, 상한 +36)이 담당하던 "적을 치는 것은 비싸다"를, v3.0에서는 **방어자가 실제로 지출하는 반격 AP**가 담당한다. 둘을 다 넣으면 이중 계상이 되어 표준 게임이 42분 하드 타임아웃으로 굳는다(5.3절 검산에서 실제로 확인했다).

#### (c) 보급선 항 — `tileCost` 분산 검산과 신설 근거 (F.5)

**문제 제기**: 밀도항이 사라지면 `tileCost`에 남는 것은 지형·응집·병종·테크뿐이다. 비용 분산이 충분한가?

**정적 분산 검산** (보급선 항 없이):

```
최저: 16 × 0.80(사막) × 0.85(기병) × 1.00(응집 0) × 0.78(내 군사T3) = 8.5   → MIN_TILE_COST 4 위
최고: 16 × 1.70(산)   × 1.15(창병) × 1.45(응집 3) × 1.22(적 군사T3) = 55.3
정적 분산 폭 = 6.5배     (v2.1: 정적 6.5배 × 밀도 2.4배 = 15.6배)
```

**판정 1 — 정적 분산 6.5배는 부족하지 않다.** 문제는 크기가 아니라 **성격**이다. 지형·응집·테크는 전부 느리게 변하거나 안 변한다. v2.1의 밀도항은 유일하게 **전투 중 실시간으로 움직이는** 항이었고, 그것이 "여기가 지금 약하다"를 만들었다.

**판정 2 — 그 동적 역할은 방어 응답률 ρ가 이미 대체한다.** ρ는 0(무방비)에서 1 이상(과잉 방어)까지 실시간으로 움직이며 실효비용을 **1배~10배**로 바꾼다(아래 (e)). v2.1의 밀도항(2.4배)보다 넓고, 무엇보다 **플레이어가 직접 조종한다.** → **새 동적 항은 필요 없다.**

**그럼에도 보급선 항을 하나 넣는 이유는 다른 축이다.**

| 분산 축 | v2.1 | v3.0 (보급선 없이) |
|---|---|---|
| 지형 | ✓ 2.1배 | ✓ 2.1배 |
| 응집(모양) | ✓ 1.45배 | ✓ 1.45배 |
| 상대의 상태 | ✓ 밀도 2.4배 | ✓ **방어 응답 ρ (1~10배)** |
| **내 위치 / 전선 깊이** | ✗ 없음 | ✗ **없음** |

"멀리 뻗어나가는 것이 비싸다"가 v1.0 이래 이 게임에 한 번도 없었다. v2.1까지는 행군 시간이 그 역할을 하는 듯 보였지만, 5.1절이 이미 증명했듯 **행군은 병력을 파괴하지 않고 지연시킬 뿐**이라 비용이 아니다. 보급선 항은 이 빈칸을 채우고, 동시에 **기지 시스템을 비용 공식에 직접 연결**한다 — v2.1까지 기지의 가치는 "행군 단축" 하나뿐이었는데, v3.0에서 기지는 **보급 반경의 중심**이 된다.

| 내 최근접 기지까지 거리 | `supplyMult` | 의미 |
|---|---|---|
| 0~10 | `1.00` | 기지 반경 안 — 무료 |
| 15 | `1.10` | 약간 뻗음 |
| 20 | `1.20` | 표준 전선 최대 |
| 30 | `1.40` | 깊은 침투 |
| 40+ | `1.60` (상한) | 보급 한계 |
| **기지 0개** | `1.60` (고정) | 기지를 전부 잃음 |

**페이싱 영향 검산 — 표준 플레이는 건드리지 않는다**: 중반 제국 반경은 약 11이고 표준 보유 기지는 2개(수도 + 전진 1)이므로, 전선 타일까지의 최근접 기지 거리는 평균 **8~12**다 → `supplyMult ≈ 1.00~1.04`. **5.3절 페이싱 계산에 유효자릿수 변화를 주지 않는다.** 이 항은 오직 (a) 정상 범위를 벗어난 원거리 침투, (b) 기지를 다 잃은 상태에서만 물린다. 즉 **평균이 아니라 꼬리만 자르는 항**이다.

**계산 비용**: `p.baseTiles ≤ 12`이므로 타일당 최대 12회 `distance()`. Phase A에서 깃발당 타깃 타일 1개에 대해서만 계산하므로 tick당 최대 84회. `Math.pow` 없음, 전부 정수.

#### (d) 진척도 전진량과 타깃 타일

```
// ATTACK 자세, 타깃 타일 X
advanceMilli(f, X, ap) = floor( ap * 1000 / tileCost(f, X) )

// v2.1의 maxTiles(정수 타일 상한) 를 연속량으로 옮긴 것
FLAG_MAX_PROGRESS(f) = 1000 * FLAG_TILE_RATE_BASE * UNIT_ASSAULT[f.unit]
                     = 창 1400 / 검 2000 / 기 2800   milli/tick

실제 전진   = min( advanceMilli(f, X, availAP(f)), FLAG_MAX_PROGRESS(f) )
실제 소비AP = ceil( 실제 전진 * tileCost(f, X) / 1000 )   // 상한에 걸린 만큼은 예산에 남는다
```

**타깃 타일 `targetTileId`는 sticky다.** 매 tick 재선택하면 이웃 타일 비용이 미세하게 바뀔 때마다 게이지가 리셋되어 아무것도 못 먹는다.

```
selectTarget(f):
  if f.targetTileId != null
     AND tile[f.targetTileId].owner == f.targetOwnerId
     AND distance(f.targetTileId, f.anchorTileId) <= FRONT_RADIUS
     AND ∃ n ∈ neighbors(f.targetTileId) : tile[n].owner == f.ownerId:
        return f.targetTileId                        // 유지
  newTarget = front(f)[0]                            // 4.1절 3중 정렬의 첫 원소
  if newTarget != f.targetTileId: f.progressMilli = 0
  return newTarget
```

**소비 예시 (중반 표준, 방어 없음)**: 검병 1,200 병력, 적 타일 `c = 16 × 1.25(응집) × 1.0514(지형) = 21.0`.
`availAP = 18/tick` → `advance = floor(18000/21) = 857 milli/tick` → **1.17 tick(0.23초)마다 1타일**, 상한 2000에 안 걸림. 전 병력 소진 시 **총 57타일**, 소요 66.7 tick(13.3초).

| 병종 | `c` | milli/tick | 상한 | **총 획득 타일** |
|---|---|---|---|---|
| 창병 | 24.2 | 743 | 1400 | 49 |
| 검병 | 21.0 | 857 | 2000 | **57** |
| 기병 | 17.9 | 1005 | 2800 | **67** |

**기병이 같은 병력으로 18% 더 먹는다** — v2.0 이래의 결론이 그대로 유지된다.

#### (e) 실효비용 — 방어 응답률 ρ (5장이 쓰는 정의)

```
ρ (방어 응답률) = 그 구간에 방어자가 투입하는 AP / 공격자가 투입하는 AP
λ (되돌리기 계수) = DEFENSE_LEVERAGE × UNIT_DEF_PUSH[방어병종] × UNIT_ATK_MULT[공격병종]
                     (4.7(d) 손익분기표의 값)

순 전진율 = (A − D·λ) / c_raw
공격자가 순 1타일당 실제로 태우는 병력 = c_eff = c_raw / (1 − ρ·λ)
```

| ρ (방어 응답) | λ=0.900 (검 방어) | λ=1.170 (창 방어) | 상태 |
|---|---|---|---|
| 0.00 | `1.00 × c` | `1.00 × c` | 무방비 — 자유 낙하 |
| 0.25 | `1.29 × c` | `1.41 × c` | 형식적 방어 |
| 0.50 | `1.82 × c` | `2.41 × c` | 표준 대치 |
| 0.75 | `3.08 × c` | `8.16 × c` | 총력 방어 |
| 0.85 | `4.08 × c` | **∞ (돌파 불가)** | 창병 벽 |
| 1.00 | `10.0 × c` | ∞ | — |

> **이 표가 v2.1의 밀도표를 대체한다.** v2.1의 밀도 0~12는 실효비용을 32.9~64.4(**1.96배**)로 움직였다. v3.0의 ρ는 같은 값을 **1배~∞**로 움직인다. 붕괴 캐스케이드의 대체 장치가 무엇인지에 대한 답이 이 표다(4.13절에서 정리).

### 4.7 방어 = 반격 깃발로 진척도 되돌리기 (v3.0 핵심 — design-decisions B항)

> **v2.1의 4.7절(본국 자동 방어)은 여기서 완전히 대체된다.**
> **병력 풀은 방어에 일절 관여하지 않는다. 적 깃발이 들어오고 아무도 막지 않으면 땅을 뺏긴다.**
> **깃발을 내보내도 방어력이 깎이지 않는다** — 애초에 "방어력"이라는 상태가 없기 때문이다.

#### (a) 되돌리기 공식

DEFEND 자세 깃발은 자기 `guard(f)` 안의 **적 게이지**를 역방향으로 민다.

```
// 방어 기준 비용 — 공격자의 병종/공격테크/보급선/종반러시를 뺀 값
defRefCost(X) = max( MIN_TILE_COST,
                     ceil( ENEMY_BASE * defCostMult(owner(X)) * adj(X) * TERRAIN_COST_MULT[X] ) )

// 방어 AP 1점이 되돌리는 진척도 (milli)
undoPerAP(d, X) = floor( 1000 * DEFENSE_LEVERAGE_PERMILLE * UNIT_DEF_PUSH_PERMILLE[d.unit]
                         / (1000 * defRefCost(X)) )

DEFENSE_LEVERAGE_PERMILLE = 900
UNIT_DEF_PUSH_PERMILLE    = { SPEAR: 1300, SWORD: 1000, CAVALRY: 550 }
```

**왜 공격자의 `tileCost`가 아니라 별도 `defRefCost`를 쓰는가 (설계상 가장 중요한 판단)**

같은 분모를 쓰면 병종·공격테크의 효과가 **완전히 상쇄된다.** 기병이 15% 싸게 밀면 방어자도 15% 싸게 되돌리게 되어, `UNIT_ATK_MULT`와 `atkCostMult`가 **대치 전선에서 아무 의미가 없어진다.** 그러면 군사 축의 절반과 병종 차별화가 통째로 죽는다. 실제로 초안 계산에서 이 상쇄를 확인했고 그래서 분모를 분리했다.

`defRefCost`는 **"이 타일을 지키는 일의 고유 난이도"**만 담는다 — 지형, 응집(모양), 방어자의 군사 테크. 공격자가 무엇을 들고 오든 방어자의 되돌리기 효율은 같다. 결과:

- **공격 측 선택(병종·군사 T)이 게이지 줄다리기에 그대로 반영된다.** ✓
- **방어 측은 "무엇이 오는가"를 읽을 필요가 없다.** 창병을 세우면 상대가 뭘 보내든 똑같이 잘 막는다. → **상성이 아니라 역할 분화**라는 v2.0 이래의 원칙이 보존된다. ✓
- `endgameRushMult`는 `defRefCost`에 **넣지 않는다.** 넣으면 러시가 공수 양쪽을 똑같이 싸게 만들어 효과가 0이 된다. 빼면 러시가 순수하게 공격을 ×1.333 가속한다(5.4절). ✓
- 언덕(1.30)·산(1.70)이 `defRefCost`에 들어가므로 **지형 방어 보너스가 v3.0에서 처음으로 실제 규칙이 된다**(2.2절 주석).

#### (b) 순증감 해석 — Phase A/B 결정론 구조 안에서

```
// ═══════ Phase A : 산출 (쓰기 절대 금지) ═══════
pushes = []          // 게이지는 (공격 깃발 × 타깃 타일) 쌍마다 하나
for f in ENGAGED flags where posture == ATTACK sorted by f.id ASC:
     X = selectTargetReadOnly(f)                       // 확정은 Phase B
     if X == null: continue
     c   = tileCost(f, X)
     adv = min( floor(availAP(f) * 1000 / c), FLAG_MAX_PROGRESS(f) )
     pushes.push({ flagId: f.id, ownerId: f.ownerId, tileId: X, cost: c,
                   adv, cur: f.progressMilli, undo: 0 })

baseHits = []        // 기지 체력 피해 (4.12절)
for f in ENGAGED ATTACK flags targeting a base tile B:
     baseHits.push({ flagId, tileId: B, dmg: min(advanceMilli(...), FLAG_MAX_PROGRESS(f)) })

// 방어 되돌리기 배분 — 결정론적 그리디
for d in ENGAGED flags where posture == DEFEND sorted by d.id ASC:
     remainAP = availAP(d)
     targets = [ b ∈ baseHits : b.tileId ∈ guard(d) ]    정렬 ( b.dmg DESC, b.tileId ASC )
            ++ [ p ∈ pushes   : p.tileId ∈ guard(d) ]    정렬 ( p.cur + p.adv DESC, p.flagId ASC )
     for tgt in targets:
        if remainAP == 0: break
        u = undoPerAP(d, tgt.tileId)
        if u == 0: continue
        pending = (tgt 가 baseHit 이면 남은 dmg, 아니면 tgt.adv - tgt.undo)
        if pending <= 0: continue
        need = ceil(pending / u)
        use  = min(remainAP, need)
        tgt.undo += use * u
        remainAP -= use
     defSpend[d.id] = availAP(d) - remainAP              // 쓴 만큼만 지출한다

// ═══════ Phase B : 적용 (쓰기) ═══════
for p in pushes sorted by ( tileId ASC, flagId ASC ):
     f = flag(p.flagId)
     f.targetTileId = p.tileId
     net  = p.adv - p.undo
     used = ceil( p.adv * p.cost / 1000 )                // 밀어붙인 만큼 전액 지출
     f.spendBudgetMilli = max(0, f.spendBudgetMilli - used*1000)
     f.troopsMilli      = max(0, f.troopsMilli      - used*1000)
     f.progressMilli    = f.progressMilli + net
     if f.progressMilli >= 1000: → 4.10절 소유권 이전
     else: f.progressMilli = max(0, f.progressMilli)     // 0 미만 클램프
     updateStall(f, net)
for d in DEFEND flags:
     d.spendBudgetMilli = max(0, d.spendBudgetMilli - defSpend[d.id]*1000)
     d.troopsMilli      = max(0, d.troopsMilli      - defSpend[d.id]*1000)
baseHits → 4.12절에서 hpMilli 에 적용
```

**Phase A가 읽기 전용이라는 v1.0 이래의 절대 규칙이 지켜지는 방식**: `pushes`/`baseHits`/`defSpend`는 전부 **로컬 배열**이다. `tgt.undo += ...`는 로컬 객체의 필드이지 게임 상태가 아니다. 게임 상태(`f.progressMilli`, `f.troopsMilli`, `tile.owner`, `base.hpMilli`)는 Phase B에서만 쓴다. 방어 배분이 `d.id` 오름차순 그리디이므로 **순서가 결과를 바꾸지 않는다** — 같은 입력이면 같은 배분이다.

**design-decisions B항이 명시적으로 요구한 세 가지의 답**:

| 질문 | v3.0의 답 |
|---|---|
| **순증감 해석** | 게이지 하나에 대해 `Δ = 밀기 − 되돌리기`. 게이지는 **(공격 깃발 × 타깃 타일) 쌍마다 하나**이며 타일에 저장되지 않는다(C항) |
| **같은 구간에 공/방 깃발이 여럿** | 공격은 **합산하지 않는다** — 각자 자기 게이지를 미는 레이스. 방어는 **합산한다** — 여러 방어 깃발의 되돌리기가 같은 게이지에 누적된다. 근거는 아래 (c) |
| **게이지가 0으로 되돌아갔을 때** | `max(0, ...)`로 클램프. **음수가 되지 않는다.** 공격 깃발은 ENGAGED를 유지하되 `stalled = true`가 되어 UI 경고가 뜬다. **자동 후퇴도 없고, 방어자의 자동 반격 전환도 없다.** 방어를 반격으로 바꾸려면 플레이어가 재지정해야 한다(3초 경직 + 게이지 리셋). 근거는 아래 (e) |

#### (c) 공격은 왜 비합산이고 방어는 합산인가

**공격 비합산(레이스)**: 두 플레이어가 같은 타일을 치면 각자의 게이지가 따로 찬다. 먼저 1000에 닿는 쪽이 가져가고 **나머지 게이지는 0으로 리셋된다**(4.10절). 이것이 v2.1의 "여럿이 같은 곳을 치면 낭비가 크다"(`LOSER_ATTRITION_RATIO`)를 **상수 하나 없이** 재현한다. 합산했다면 적대 관계인 두 나라가 자동으로 협력해 한 타일을 미는 셈이 되어 게임 논리에 어긋난다.

**방어 합산**: 내 땅을 지키는 내 깃발들은 당연히 협력한다. 두 개의 방어 깃발 디스크가 겹치면 그 구간의 λ가 사실상 두 배가 된다 — "핵심 구간에 이중 방어를 두껍게 깐다"는 정당한 전술이며, 슬롯 두 개를 소모하므로 대가가 명확하다.

**방어 배분 순서 = (기지 체력 → 진척도 임박순 → flagId)**: "가장 임박한 위협부터 끈다"는 직관과 일치하고, 3중 키라 동률이 없다. 비례 배분을 쓰지 않는 이유는 (a) 나눗셈 라운딩이 결정론 위험을 만들고, (b) 게임적으로도 "모든 불을 조금씩 끄기"는 나쁜 답이기 때문이다.

**비대칭 지출 규칙 — F.1의 핵심 장치**

| | 지출 규칙 | 결과 |
|---|---|---|
| 공격자 | **밀어붙인 만큼 전액 지출.** 0 진척으로 상쇄당해도 병력은 나간다 | 실패한 공격은 병력을 통째로 태운다 |
| 방어자 | **딱 상쇄하는 데 필요한 만큼만 지출**(`need = ceil(pending/u)`). 초과분은 예산에 남아 이월 | 과잉 방어에 낭비가 없다 |

> **"먼저 보낸 쪽이 무조건 이긴다"를 막는 것은 이 비대칭이다.** 방어자는 공격이 없으면 0을 쓰고, 공격이 오면 정확히 필요한 만큼만 쓴다. 공격자는 벽에 부딪혀도 전액을 쓴다. 즉 **선공은 정보 없이 지불하는 도박이고 방어는 정보를 보고 지불하는 응답**이다. 대신 방어에는 주둔 유지비(4.4절)와 슬롯 점유라는 상시 비용이 붙어 있어 "방어만 하면 이긴다"가 되지 않는다.

#### (d) 손익분기표 — 선공 절대 우위 방지 (F.1 필수 검산)

같은 구간에서 공격 AP `A`와 방어 AP `D`가 맞붙을 때 게이지가 전진하려면:

```
A / tileCost(공격자, X)  >  D × DEFENSE_LEVERAGE × UNIT_DEF_PUSH[방어] / defRefCost(X)
⟺  A/D  >  DEFENSE_LEVERAGE × UNIT_DEF_PUSH[방어병종] × UNIT_ATK_MULT[공격병종]
                            × atkCostMult(공격자) × supplyMult × endgameRushMult
```

**지형·응집·방어자 군사테크가 양변에서 소거된다.** 남는 것은 병종과 공격자 측 계수뿐이다 — 규칙이 아주 깔끔해진다.

**손익분기 AP 비율 (테크 없음, 보급 1.00, 러시 전)**:

| 공격 \ 방어 | 창병 방어 | 검병 방어 | 기병 방어 |
|---|---|---|---|
| 창병 공격 (1.15) | **1.345** | 1.035 | 0.569 |
| 검병 공격 (1.00) | **1.170** | 0.900 | 0.495 |
| 기병 공격 (0.85) | **0.995** | 0.765 | 0.421 |

**편성비(`UNIT_CONVERT`: 창 1.00 / 검 1.00 / 기 1.15)까지 반영한 "풀 병력 기준" 손익분기**:

| 공격 \ 방어 | 창병 방어 | 검병 방어 | 기병 방어 |
|---|---|---|---|
| 창병 공격 | 1.345 | 1.035 | 0.569 |
| 검병 공격 | **1.170** | **0.900** | 0.495 |
| 기병 공격 | **1.144** | **0.880** | 0.484 |

**이 표에서 읽히는 여섯 가지**:

1. **방어가 기본적으로 유리하다** — 검 vs 검이 0.900이므로 공격자는 방어자보다 **11% 더 많은 AP를 그 구간에 쏟아야 전진한다.** "먼저 보낸 쪽이 이긴다"를 막는 1차 방벽.
2. **창병 방어는 30% 더 강하다** — 검 공격 기준 0.900 → 1.170. 창병을 세운 구간을 뚫으려면 병력을 1.3배 더 부어야 한다.
3. **기병은 어느 방어 상대에게도 최선의 공격 병종이다**(1.144 / 0.880 / 0.484). 편성비 15%를 물고도 검병보다 2.2% 유리 — v2.0 이래의 순 효율 계산(`1.15 × 0.85 = 0.978`)과 정확히 일치한다.
4. **기병 방어는 성립하지 않는다**(0.484 = 공격자가 절반 AP로 뚫는다). 창병 방어와 2.4배 격차. **역할 분화가 숫자로 강제된다.**
5. **창병 공격도 성립하지 않는다**(1.345 = 검병보다 15% 나쁨). 창병은 방어 전문이다.
6. **어떤 칸도 "상대가 무엇을 보냈는지"를 보고 바꿔야 유리해지지 않는다.** 방어는 항상 창병이 최선, 공격은 항상 기병이 최선. → **가위바위보 상성이 아니다**(design-decisions v2 A항 원칙 보존).

**군사 테크가 이 표를 어떻게 움직이는가**: `atkCostMult`(0.93/0.86/0.78)는 손익분기를 그대로 곱한다. 군사 T1이면 검 vs 창 방어가 `1.170 × 0.93 = 1.088`, T3면 `0.913`. **즉 군사 T3는 창병 벽을 검병으로 대등하게 뚫는 테크**다. 반대로 방어자의 `defCostMult`는 손익분기에서 소거되지만 `defRefCost`를 올려 **되돌리기 AP 효율 자체를 높인다** — 같은 AP로 더 많이 되돌린다. 즉 군사 축은 공/방 양쪽에 붙는 유일한 축이다(3.4절).

#### (e) 선공 우위의 정량 상한 — 무엇이 기습의 크기를 묶는가

방어자의 반응 지연 τ = (깃발을 본다 → 판단 3초 → 발령 → 자기 영토 안 행군).

```
중반 방어 행군: 전선까지 6~11타일 / 창병 0.45타일/초 = 13~24초  →  τ ≈ 16~27초
그동안 공격자가 얻는 무상 진척 = A × τ
중반 A = 18 AP/tick × 5 tick/초 = 90 AP/초  →  τ=20초면 1,800 AP = c 21.0 기준 85타일 상당
```

**85타일은 너무 크다.** 그대로 두면 선공이 곧 승리다. **세 가지가 이것을 묶는다.**

| 장치 | 상한 | 근거 |
|---|---|---|
| **`FRONT_RADIUS = 6` 디스크** | 디스크 안 육지 평균 60타일, 그중 국경 조건(`∃ 내 이웃`)을 만족하는 **초기 전면은 13~20타일** | 4.1절 |
| **`FLAG_MAX_PROGRESS`** | 검병 2,000 milli/tick = 2타일/tick. 20초면 200타일이므로 **여기서는 안 물린다** | 4.6(d) |
| **깃발 병력 총량** | 중반 깃발 1,200 병력 = 총 57타일이 최대 획득량 | 4.6(d) |

실제 상한은 셋 중 가장 작은 **디스크 안 국경 전면 13~20타일**이다.

> **결론: 완벽한 기습이 성공했을 때 얻는 것은 "구간 하나(13~20타일, 390타일 제국의 3~5%)"이며, 그 대가로 깃발 하나(슬롯당 병력 전액 1,200)를 태운다.** 선공은 "구간 하나를 살 수 있는 값비싼 이니셔티브"이지 승리가 아니다.
>
> 그리고 방어자가 τ 안에 도착하면 (d)의 손익분기(0.900~1.170)가 즉시 발효되어 공격자가 불리해진다. 방어자가 **미리 주둔**해 두었다면 τ = 0이고 공격은 처음부터 손익분기 아래에서 시작한다. 주둔의 대가는 주둔 유지비(4.4절)다. **기습·상시 주둔·사후 반격 셋 다 각자의 비용을 갖는다.**
>
> **역방향 검증 — 방어가 과하지 않은가**: 손익분기 1.170(창병 방어)을 넘기려면 공격자가 그 구간에 방어자보다 17% 많은 AP를 쏟으면 된다. 슬롯이 유한하므로 방어자는 모든 구간에 창병을 세울 수 없고(4.1절 기하학: 390타일이면 6.1구간 vs 슬롯 4), 공격자는 **비어 있는 구간을 고를 수 있다.** 공격자의 진짜 무기는 화력이 아니라 **선택권**이다. 5.5절이 이것을 동맹 근거로 정량화한다.

#### (f) 정체(STALLED) 판정

```
FLAG_STALL_TICKS = 25        // 5초
updateStall(f, net):
   if net <= 0:
        if f.stallSinceTick == null: f.stallSinceTick = t
        if t - f.stallSinceTick >= FLAG_STALL_TICKS and not f.stalled:
             f.stalled = true; emit flag_stalled(flagId, tileId)
   else:
        f.stallSinceTick = null; f.stalled = false
```

**정체는 규칙을 바꾸지 않는다.** 병력은 계속 나가고 게이지는 0에 붙어 있다. 이것은 순수하게 **UI 알림 트리거**다 — "이 깃발은 벽에 부딪혔다. 물릴 것인가, 더 부을 것인가, 다른 데를 칠 것인가"를 묻는 신호다.

자동 후퇴시키지 않는 이유: 자동화하면 **고정 공격(pinning)** 이라는 정당한 전술이 불가능해진다. 진척은 0이어도 상대 방어 깃발의 AP를 계속 태우게 만드는 것은 다자전에서 유효한 수다.

**무한 교착이 구조적으로 불가능한 이유**: 깃발은 `f.troops < FLAG_MIN_TROOPS(40)`가 되면 소진 종료된다(4.11절). 중반 표준 깃발이 정체 상태로 전 병력을 태우는 데 **13.3초**다. 벽에 부딪힌 공격은 13초 안에 스스로 끝난다.

### 4.8 병력 회계 불변식

깃발이 자기 병력보다 많이 쓰지 않는다는 것을 v3.0에서 다시 증명한다. v2.1의 증명은 경매(낙찰/낙심 이중 지출) 때문에 복잡했지만, v3.0은 지출 경로가 하나뿐이라 자명해진다.

```
ATTACK 깃발의 tick당 지출 = ceil( adv × cost / 1000 )
                          ≤ ceil( availAP(f) × 1000 / cost × cost / 1000 )
                          = availAP(f)
                          ≤ floor( min(spendBudgetMilli, troopsMilli) / 1000 )
                          ≤ f.troops                                        ∎

DEFEND 깃발의 tick당 지출 = defSpend[d.id] ≤ availAP(d) ≤ d.troops         ∎
```

**한 깃발은 tick당 정확히 한 번만 지출한다** (ATTACK은 자기 타깃 타일 하나에, DEFEND는 배분 합계로). v2.1에 있던 "낙찰 비용 + 격퇴 마모"의 이중 경로가 사라졌으므로 음수 클램프는 방어적 코드로만 남긴다.

**방어자 풀은 전투로 감소하지 않는다.** `DEFENDER_LOSS_RATIO`가 폐기됐으므로(F.6), 땅을 잃어도 병력 풀에서 직접 빠지는 값은 없다. 방어자의 손실은 오직 **자기가 발령한 반격 깃발이 태운 AP**뿐이다. 이것이 A항("병력 풀은 방어에 일절 관여하지 않는다")의 회계적 귀결이다.

### 4.9 Phase A / Phase B 결정론 구조 (v1.0 이래 불변)

**절대 규칙 3개** — 백엔드 필수 준수:

1. **Phase A에서는 어떤 게임 상태도 쓰지 않는다.** `pushes` / `baseHits` / `defSpend`는 전부 tick 로컬 배열이며, 그 안의 `tgt.undo += ...`는 로컬 객체 필드다. 게임 상태(`f.progressMilli`, `f.troopsMilli`, `f.targetTileId`, `tile.owner`, `base.hpMilli`)는 **Phase B에서만** 쓴다.
2. **Phase A가 읽는 값은 tick 시작 시점의 스냅샷이다.** `availAP`는 5단계(예산 누적)에서 확정된 뒤 6·7단계 내내 동결된다. v2.1의 "밀도 캐시 동결" 규칙이 v3.0에서는 **"AP 예산 동결"** 로 바뀌었을 뿐 성격이 같다 — 같은 tick 안에서 먼저 처리된 깃발이 유리해지는 순서 의존성을 제거한다.
3. **4단계(이동)는 6단계(Phase A) 앞에 온다.** 그래야 "이번 tick에 도착한 깃발이 이번 tick부터 싸운다"가 성립하고, 클라이언트가 보는 도착 프레임과 전투 시작 프레임이 일치한다.

**정렬 키 목록** (전부 3중 이상이라 동률이 없다):

| 순회 | 정렬 |
|---|---|
| 깃발 이동 / 예산 누적 / Phase A 밀기 산출 | `flagId ASC` |
| `front(f)` | `(distance ASC, tileCost ASC, tileId ASC)` |
| 방어 배분 대상 | `(기지 우선, progress+adv DESC, flagId ASC)` |
| Phase B 적용 | `(tileId ASC, flagId ASC)` |
| 자원 생산 / 파생 갱신 | `playerId ASC` |
| 봇 결정 | `botIndex ASC` |

**연산량 상한 (12인 룸, 최악)**: 깃발 84개 × 디스크 85타일 = 7,140회 조회 + 방어 배분 84 × 84 = 7,056회 비교. tick당 2만 정수 연산 미만. 5Hz에서 여유롭다. v2.1의 경매(입찰 맵 구축 + tileId 정렬)보다 **오히려 가볍다** — 타일당 리스트를 만들지 않고 깃발당 타깃 하나만 다루기 때문이다.

### 4.10 소유권 이전과 동시 다발 상황 — 게이지 레이스

```
// Phase B, tileId ASC → flagId ASC 순회 중
if f.progressMilli >= 1000:
     prevOwner = tile[X].owner
     onTileOwnerChange(X, prevOwner, f.ownerId)        // tiles / goldWeight / baseTiles 증분
     tile[X].owner = f.ownerId
     markTileDirty(X)
     f.progressMilli = 0
     f.targetTileId  = null                            // 다음 tick 에 selectTarget 재실행
     // 같은 타일을 노리던 다른 모든 게이지를 무효화
     for g in pushes where g.tileId == X and g.flagId != f.flagId:
          flag(g.flagId).progressMilli = 0
          flag(g.flagId).targetTileId  = null
          emit flag_progress_lost(g.flagId, X)
```

| 규칙 | 내용 |
|---|---|
| **낙찰자** | **먼저 1000에 닿은 깃발.** 동률(같은 tick에 둘 이상이 1000 돌파)이면 `flagId ASC` — 즉 **먼저 발령된 깃발**이 이긴다 |
| **패자 비용** | 별도 마모 없음. **이미 태운 AP가 곧 비용이다.** 게이지가 0이 되어 그 작업이 통째로 증발한다 |
| **원 소유자** | 별도 추가 손실 없음(`DEFENDER_LOSS_RATIO` 폐기). 방어에 쓴 AP가 곧 손실이다 |
| **같은 플레이어의 깃발끼리** | `selectTarget`이 깃발별로 독립이므로 같은 타일을 동시에 노릴 수 있다. 이 경우에도 레이스가 적용되어 하나만 먹고 다른 하나의 게이지가 날아간다 → **자기 깃발끼리 겹치지 않게 배치하는 것이 플레이어의 책임**이며 UI가 디스크 겹침을 경고한다 |
| **동맹** | 동맹/파기 쿨다운 중인 상대 타일은 `front()` 정의에서 제외되므로 게이지 자체가 생기지 않는다 |

> **v2.1의 경매 규칙이 만들던 성질이 전부 보존된다.** "약한 셋이 강자의 같은 지점을 동시에 때리면 타일은 하나만 가져가고 나머지는 낭비"는 게이지 레이스로 그대로 재현된다. 달라진 것은 **강자가 추가로 병력을 잃지 않는다**는 점인데, 그 자리는 "강자가 그 세 구간에 각각 반격 깃발을 대야 한다"는 슬롯 압박이 대신한다(5.5절). 상수 3개(`LOSER_ATTRITION_RATIO`, `LOSER_TO_DEFENDER_RATIO`, `DEFENDER_LOSS_RATIO`)가 사라지고 규칙이 하나도 줄지 않았다.

**동시 도착의 조율 가치는 v2.1보다 커졌다.** 시야가 전체 공개이므로 상대 깃발의 ETA가 보이고, **방어 깃발의 도착 시각도 보인다.** "상대 창병이 도착하기 3초 전에 내 기병이 닿게 한다"가 실제 계산 가능한 수가 된다.

### 4.11 병종 3종 종합과 깃발 종료 판정

#### (a) 병종 3종 (v3.0 — 창병 정체성 재정의, F.2)

**상성이 아니라 역할 분화다.** 어떤 병종도 다른 병종을 카운터하지 않는다(4.7(d) 6번 참조). 선택 기준은 "상대가 뭘 보냈나"가 아니라 **"내가 지금 뭘 하려는가"** 이다.

| | 창병 SPEAR | 검병 SWORD | 기병 CAVALRY |
|---|---|---|---|
| 이동속도 `UNIT_SPEED` | `0.75` | `1.00` | `1.45` |
| 점령비용 배율 `UNIT_ATK_MULT` | `1.15` (약함) | `1.00` | `0.85` (강함) |
| **되돌리기 효율 `UNIT_DEF_PUSH`** ⟵ v3.0 | **`1.30`** | `1.00` | `0.55` |
| **주둔 유지비 가중치 `UNIT_GARRISON`** ⟵ v3.1 골드 기준 | **`0.60`** | `1.00` | `1.60` |
| tick당 진척 상한 `UNIT_ASSAULT` | `0.70` → 1400 | `1.00` → 2000 | `1.40` → 2800 |
| 편성 비용 `UNIT_CONVERT` | `1.00` | `1.00` | `1.15` |
| 무료 주둔 정원 (면제 1.000 기준) | **1.67개** | 1.00개 | 0.63개 |
| 과금 시작 후 슬롯당 수입 둔화 | **5.4%** | 9.0% | 14.4% |
| **한 줄 정체성** | **전선을 세운다. 그리고 오래 서 있는다** | **기준. 고민 없을 때의 답** | **빨리 가서 많이 먹는다.** 지키는 데는 못 쓴다 |
| **쓰는 순간** | 뚫릴 것 같은 구간에 벽을 세울 때 / 오래 비워둘 국경 / 고정 공격(pinning) | 대부분의 상황 / 공수 겸용이 필요한 구간 | 빈 땅 선점 / 먼 전선 / 무너진 적 흡수 / 기지 탈취 / 상대 방어보다 먼저 도착해야 할 때 |

**창병 정체성이 왜 붕괴했고 무엇으로 대체했는가 (F.2 필수 처리)**

v2.1 창병의 정체성은 *"느리게 가면서 본토를 지킨다"*였고, 그 근거는 `UNIT_DEF_MULT = 1.50`(본국 자동 방어 기여 75%)이었다. **A항이 본국 자동 방어를 폐기했으므로 이 근거는 소멸했다.** 남은 것은 "느리고 공격이 약한 병종"뿐이라 존재 이유가 없어진다.

**v3.0의 대체 — 창병은 "방어라는 새 직무의 전문가"가 된다.** 두 개의 새 계수가 이를 만든다.

| 계수 | 값 | 무엇을 사는가 |
|---|---|---|
| `UNIT_DEF_PUSH = 1.30` | 되돌리기 30% 효율 | **같은 병력으로 30% 더 오래 버틴다.** 손익분기 0.900 → 1.170 (4.7(d)) |
| `UNIT_GARRISON = 0.60` | 주둔 유지비 40% 할인 | **같은 골드로 1.67배 더 많은 전선을 세운다** (v3.1 재해석) |

**v3.1 — 창병 40% 할인이 골드 기준에서도 유효한가 (A-1 검증).** 유효하다. 다만 **근거가 "수명"에서 "단가"로 바뀌었다.**

- v3.0에서 이 할인이 산 것은 **13.9분이라는 주둔 수명**이었다. 골드 유지비로 바뀌면서 주둔 수명은 병종과 무관하게 **무한**이 되었으므로 그 문구는 폐기한다.
- v3.1에서 이 할인이 사는 것은 **전선 단가**다. `GARRISON_UPKEEP_FREE_PERMILLE = 1000` 안에 창병은 **1.67개**가 들어가고 검병은 1개다. 즉 **창병 1개 주둔은 언제나 완전 무료이고, 창병 2개째도 과금이 1.8%에 그친다**(4.4(b)). 검병 2개는 9.0%다.
- 과금 구간에서도 창병 3개 = 검병 1.8개 값이다. 같은 골드 예산으로 창병은 검병보다 **1.67배 넓은 국경을 상시 커버**한다.
- **수치 조정은 하지 않는다.** 0.60이 만드는 체감 차이가 병력 기준(13.9분 vs 8.3분 = 1.67배)일 때와 골드 기준(전선 1.67배)일 때 **정확히 같은 배율**이기 때문이다. 값을 그대로 두는 것이 v3.0 검산과의 연속성을 가장 잘 지킨다. 기병 1.60도 같은 이유로 유지한다 — 기병 주둔은 무료 정원조차 못 채우고(0.63개) 슬롯당 14.4%를 물어, "기병으로 지키는 것은 명백히 나쁜 선택"이라는 판정이 골드 축에서도 그대로다.

두 계수의 방향이 같다 — **둘 다 "그 자리에 오래 있는 것"에 값을 매긴다.** 느린 속도(0.75)는 이제 페널티가 아니라 정합적인 성격이다. 방어 깃발은 **내 영토 안**을 행군하므로 노출 소모가 없고, 어차피 한 번 자리를 잡으면 오래 머문다. 즉 **v2.1에서 창병의 약점이던 이동속도가 v3.0에서는 거의 비용이 아니게 됐다.**

**역할 분화 원칙 검증 (상성이 아님)**:

- 창병을 선택하는 이유는 "상대가 기병을 보내서"가 아니라 **"내가 이 구간을 오래 지키기로 결정해서"** 다.
- 창병 방어는 기병 공격에도 검병 공격에도 창병 공격에도 **똑같이 30% 강하다**(4.7(d)의 창병 방어 열 전체가 검병 방어 열의 정확히 1.30배). 상대의 선택이 창병의 가치를 바꾸지 않는다.
- 기병으로 방어하는 선택지는 존재하지만 **명백히 나쁘다**(0.484). 이것은 상성이 아니라 **잘못된 직무 배치**다.

**밸런스 검산 — 기병 독주 방지 (v2.1 미결정 4번 재검토)**: 기병 순 효율은 `1.15(편성) × 0.85(점령) = 0.978` → 병력 대비 **+2.2%**로 v2.0 이래 변함없다. 그런데 **v3.0에서 기병의 상대적 지위가 오히려 내려갔다.**

| | v2.1 | **v3.0** |
|---|---|---|
| 기병의 방어 기여 | 본국 방어 0.60 (있긴 있었다) | 되돌리기 0.55 + 주둔비 1.60 → **사실상 방어 불가** |
| 슬롯 중 방어에 쓰는 비중 | 0% | **30~55%** (4.1절 기하학) |
| → 기병으로 채울 수 있는 슬롯 | 100% | **45~70%** |

기병 일변도 빌드는 v3.0에서 **자기 국경을 통째로 비우는 선택**이 된다. v2.1 미결정 4번의 위험도를 **하향**한다. 관측 지표는 유지: 세션당 병종별 발령 비율이 **(창 25~40% / 검 30~45% / 기 25~40%)** 대역 안인가. (v2.1의 목표 대역 15/40/45에서 창병 쪽으로 이동시켰다 — 방어 직무가 생겼기 때문이다.)

#### (b) 깃발 종료 판정 (tick 순서 10단계)

```
for f in flags sorted by f.id ASC:
   if f.state == ENGAGED and f.posture == ATTACK:
        if front(f) is empty:
             if f.targetOwnerId == NEUTRAL: 4.5절 자동 전환 시도
             if 전환 실패: f.state = IDLE; f.progressMilli = 0; f.idleSinceTick = t; emit flag_idle
        else if f.troops < FLAG_MIN_TROOPS (=40):
             destroy(f); emit flag_ended(reason="exhausted", refunded=0)
             // 소진된 깃발은 환불이 없다. 전선에서 소모된 병력이다
   if f.state == ENGAGED and f.posture == DEFEND:
        if guard(f) is empty:                                   // 지킬 땅이 다 넘어갔다
             f.state = IDLE; f.idleSinceTick = t; emit flag_idle(reason="guard_lost")
        else if f.troops < FLAG_MIN_TROOPS:
             destroy(f); emit flag_ended(reason="exhausted", refunded=0)
   if f.state == IDLE and t - f.idleSinceTick >= FLAG_IDLE_TIMEOUT (=600, 2분):
        f.state = RETURNING; f.returnTileId = recallTarget(f); buildDistanceField(...)
   if players[f.ownerId].eliminated:
        destroy(f); emit flag_ended(reason="eliminated")
```

**IDLE 깃발은 사라지지 않고 병력을 유지한다.** v2.1에서 IDLE 깃발은 본국 방어에 기여했지만 v3.0에는 그런 기여가 없다 — 대신 **주둔 유지비도 물지 않는다**(4.4절 `isGarrison(f)`는 `state == ENGAGED`만 센다). 2분 후 자동 회수되어 85%가 풀로 돌아온다. 플레이어가 방치해도 병력이 증발하지 않으므로 초보자에게 관대하다는 v2.1의 성질이 유지된다.

### 4.12 기지 체력 전투 (v3.0 신규 — design-decisions D항)

기지 타일은 **진척도 게이지를 쓰지 않는다.** 대신 2.7절의 `hpMilli`를 깎는다. 산술은 진척도와 완전히 동일하고 방향과 임계값만 반대다.

```
// Phase A — 피해 산출 (읽기 전용)
for f in ENGAGED ATTACK flags where selectTarget(f) == B and isBase[B]:
     if t < base(B).lockUntilTick: continue                     // 점령 직후 5초 무적
     dmg = min( floor(availAP(f) * 1000 / tileCost(f, B)), FLAG_MAX_PROGRESS(f) )
     baseHits.push({ flagId: f.id, tileId: B, dmg, undo: 0 })
// 방어 배분은 4.7(b) 와 동일. 기지 피해가 진척도보다 우선 배분된다

// Phase B — 적용 (tileId ASC, flagId ASC)
for h in baseHits:
     net = h.dmg - h.undo
     used = ceil( h.dmg * tileCost(flag(h.flagId), h.tileId) / 1000 )
     flag(h.flagId).troopsMilli      -= used*1000
     flag(h.flagId).spendBudgetMilli -= used*1000
     if net <= 0: continue
     base(h.tileId).hpMilli      -= net
     base(h.tileId).lastDamageTick = t
     if base(h.tileId).hpMilli <= 0:
          winner = 이번 tick 이 기지에 net 피해가 가장 큰 깃발 (동률 flagId ASC)
          onTileOwnerChange(h.tileId, prevOwner, winner.ownerId)
          tile[h.tileId].owner        = winner.ownerId
          base(h.tileId).hpMilli      = BASE_HP_CAPTURE_MILLI          // 7500 = 만피의 50%
          base(h.tileId).lockUntilTick= t + BASE_CAPTURE_LOCK_TICK     // 25 tick
          emit base_captured(tileId, prevOwner, winner.ownerId, tick)

// tick 순서 8단계 — 회복
for b in bases sorted by tileId ASC:
     if t - b.lastDamageTick >= BASE_REGEN_DELAY_TICK and b.hpMilli < BASE_HP_MAX_MILLI:
          b.hpMilli = min(BASE_HP_MAX_MILLI, b.hpMilli + BASE_HP_REGEN_MILLI)
```

**깃발 병력 → 체력 감소 환산식은 진척도와 같은 식이다**: `dmg = AP × 1000 / tileCost(f, B)`. 즉 **기지는 "1000짜리 게이지 15개가 역방향으로 쌓인 타일"**이다. 백엔드는 `advanceMilli`를 그대로 재사용한다.

**중립 기지는 어떻게 되는가**: 중립 기지(`owner == NEUTRAL`)도 만피 15000에서 시작한다. `tileCost`는 중립 공식(`NEUTRAL_BASE + √T`)을 쓰므로 중반 기준 `c ≈ 33` → 만피 함락에 **495 AP**가 든다. 중립 일반 타일 1개(33 AP)의 15배이며, 아무도 방어하지 않으므로 중반 깃발의 41%면 확보된다. **"1단계가 끝날 무렵 손이 닿는 첫 목표"**라는 2.6절 설계와 정합적이다.

**방어 상호작용**: 기지를 지키는 DEFEND 깃발은 진척도와 똑같이 피해를 상쇄한다. **기지 피해가 방어 배분에서 최우선**이므로(4.7(b)), 기지와 일반 타일이 동시에 공격받으면 방어 깃발은 기지부터 막는다. 이는 "가장 비싼 것부터 지킨다"는 직관과 일치하고 결정론적이다.

**기지 방어 손익분기**: `defRefCost(B)`에도 지형이 들어가므로 언덕 위 기지(1.30)는 되돌리기가 30% 싸다. 2.6절이 산에는 기지를 놓지 않고 **언덕은 허용**한 판단이 v3.0에서 "방어하기 좋은 기지"라는 실질적 변주를 만든다.

**tick당 연산량**: 기지 ≤ 24개, 회복 순회 24회, 피해 산출은 깃발 수에 비례. 무시할 수준.

#### 기지 체력 수치 재검산 (F.7)

2.7절의 표를 전투 규칙과 함께 다시 확인한다.

| 상황 | `c` | 필요 AP | 중반 깃발(1,200) 대비 | 소요 시간 |
|---|---|---|---|---|
| 중립 만피 기지 | 33.0 | 495 | 41% | 27.5 tick = 5.5초 |
| 적 만피 기지, 방어 없음 | 21.0 | 315 | 26% | 17.5 tick = 3.5초 |
| 적 만피 기지, 창병 방어 ρ=0.55 | 21.0 → `c_eff` 62.9 | 943 | **79%** | 52 tick = 10.5초 |
| 갓 점령된 기지(7500), 창병 방어 | 21.0 → 62.9 | 472 | 39% | 26 tick = 5.2초 |

> **판정: `BASE_HP_MAX_MILLI = 15000`은 적정하다.** 지켜진 기지 하나 = 깃발 하나(슬롯당 병력 전액). 지키지 않은 기지 = 깃발의 4분의 1. **"기지를 가졌으면 지켜야 한다"가 규칙으로 강제된다.**
>
> **체인 스틸 재검산**: 2.7절의 결론(회전문은 성립하나 슬롯을 계속 먹는 비싼 전술)이 전투 규칙과 합쳐지면 더 강해진다. 탈환하려면 (a) ATTACK 자세 깃발을 새로 발령하거나 재지정(3초 경직 + 거리장 재생성)해야 하고, (b) 5초 무적을 기다려야 하고, (c) 그 사이 상대가 방어 깃발을 붙이면 `c_eff`가 3배가 된다. **실측 최소 회전 주기 약 18초**, 그 사이 방어자는 7500 → 8925(+19%)로 회복한다. → 허용.

### 4.13 붕괴 캐스케이드의 대체 장치 (F.3 필수 처리)

**폐기된 명제**: *"밀도 2.4배 차이가 제국이 한 번 금 가면 급속히 무너지는 붕괴 캐스케이드를 만든다"* (v2.1 4.6/5.3절).

**판정: 대체 장치를 새로 발명할 필요가 없다. 방어 응답률 ρ가 밀도보다 강하고 넓은 캐스케이드를 이미 만든다.** 근거는 세 가지다.

**(1) 정량 비교 — 캐스케이드 배율이 오히려 커졌다**

| | v2.1 (밀도) | **v3.0 (ρ)** |
|---|---|---|
| 건강한 방어자 타일 | 64.4 (밀도 8) | `c_eff` 62.9 (ρ=0.55, 창병 방어) |
| 무너진 방어자 타일 | 32.9 (밀도 0) | `c_raw` 21.0 (ρ=0) |
| **캐스케이드 배율** | **1.96배** | **3.00배** |

같은 공격 예산으로 무너진 상대에게서 **3배 빠르게** 땅을 뺏는다. v1.0의 원래 배율(2.34)보다도 크다.

**(2) 되먹임 고리가 더 짧고 더 명시적이다**

```
v2.1:  땅 상실 → (DEFENDER_LOSS_RATIO 로 풀 감소) → 밀도 하락 → tileCost 하락 → 땅 상실
       ※ 플레이어에게 보이는 것은 밀도 숫자 하나

v3.0:  땅 상실 → tiles 감소 → regen(√tiles) 감소 → 반격 깃발을 채울 병력 부족
                            → 슬롯을 방어에 돌리면 공격 불가 / 공격하면 방어 불가
                            → ρ 하락 → c_eff 하락 → 땅 상실
       ※ 플레이어에게 보이는 것은 "막을 깃발이 없다"는 상태 그 자체
```

**v3.0의 고리에는 인공 상수가 하나도 없다.** `DEFENDER_LOSS_RATIO` 같은 "패배 가속 상수"를 넣지 않아도 `√tiles` 재생 감쇠와 유한한 슬롯만으로 캐스케이드가 발생한다. 이것이 F.6에서 그 상수들을 폐기해도 되는 이유이기도 하다.

**(3) 급사 방지 장치가 v2.1보다 하나 더 많다**

v2.1은 붕괴가 너무 빠른 것을 본국 깃발 방어 기여(밀도가 완전한 0까지 안 떨어짐)로 완화했다. 그 장치가 사라진 자리에 **기지 체력**이 들어온다.

| 장치 | 효과 |
|---|---|
| **기지 체력 15000** | 무너지는 플레이어의 영토를 통째로 흡수하려 해도 기지마다 깃발 하나가 통째로 든다. **캐스케이드의 과속 방지턱** |
| **기지 회복 (2.94분)** | 공세가 잠깐 끊기면 기지가 회복되어 다시 처음부터 |
| **보급선 항** | 붕괴한 상대의 영토 깊숙이 들어갈수록 `supplyMult`가 1.60까지 오른다. **추격 비용이 거리에 따라 증가** |
| **`√tiles` 중립 브레이크** | 승자가 커질수록 중립·확장 비용 상승 (v1.0 이래 유지) |

> **결론: 붕괴 캐스케이드는 강화됐고(1.96배 → 3.00배), 그 과속을 막는 장치가 새로 생겼다(기지 체력 + 보급선).** 3단계가 짧아지는 v2.1의 페이싱 성질이 유지되며, 5.4절의 실질 하한 검증이 이를 수치로 확인한다.

### 4.14 탈락

```
if p.alive and p.tiles == 0:
   p.alive = false
   p.troops = 0; p.gold = 0; p.goldWeight = 0
   모든 깃발 즉시 소멸 (환불 없음)
   모든 동맹 즉시 해제 (쿨다운 없이)
   emit player_eliminated(p.id, byPlayerId = 마지막 타일을 뺏은 플레이어)
```

부활 없음. 탈락자는 관전 모드로 전환되며 같은 소켓으로 다른 룸에 재입장할 수 있다.

**탈락자가 소유하던 기지**: `tile.owner`가 이미 정복자에게 넘어가 있으므로 별도 처리가 없다. 체력은 마지막 함락 시점의 `BASE_HP_CAPTURE_MILLI`(7500)에서 회복을 시작한다 — 즉 **막 정복한 제국의 기지들은 한동안 절반 체력**이며, 이것이 "잡아먹은 직후가 가장 취약하다"는 자연스러운 리스크를 만든다.

---

## 5. 세션 페이싱

목표: **평균 세션 38~40분, 실질 하한 34.5분, 상한 42분(하드 타임아웃)**. 목표 대역 30~60분.

> **v3.0에서 페이싱을 처음부터 다시 계산해야 하는 이유**: 방어가 "자동·무료"에서 "명시적·유료"로 바뀌면서 **양쪽이 같은 자원을 태우게 됐다.** 방어가 사라져 확장이 빨라질 것이라는 F항의 우려는 절반만 맞다 — 무방비 상대에 대해서는 빨라지고(3.00배 캐스케이드), 방어하는 상대에 대해서는 **오히려 느려진다**(반격 AP가 공격자의 실효비용을 2~3배로 올린다). 이 두 방향이 어디서 만나는지가 5.3절의 전부다.
>
> **1단계는 v3.0에서 규칙이 바뀌지 않는다.** 중립 타일에는 소유자가 없으므로 반격 깃발을 세울 수 없다. `NEUTRAL_BASE`·`NEUTRAL_SQRT_COEF`·`neutralCostMult`가 전부 그대로이므로 **v2.1의 1단계 계산이 거의 그대로 살아남는다.** 이것이 v3.0 페이싱의 가장 큰 안정판이다.

### 계산 근거

#### 5.1 깃발 사이클과 실효계수

**깃발 사이클** 하나는 `T_cycle = T_행군 + T_교전 + T_공백`이다. `FLAG_SPEND_RATE = 0.015`이므로 교전은 **전 병력 소진 기준 66.7 tick(13.3초)**이고, 정체·부분 소진을 포함한 실측 기대값은 13~20초다.

**기지 보유 수에 따른 행군 단축** (v2.1 5.1.1절 그대로 계승 — 기지의 이 효과는 v3.0에서 변하지 않는다):

| B (보유 기지) | `MARCH_COVERAGE` | 중반 T_행군 |
|---|---|---|
| 1 (수도만) | `1.00` | 20.7초 |
| 2 (수도 + 전진 1) | `0.61` | 12.6초 |
| 3 | `0.43` | 8.9초 |
| 4+ | `0.35` | 7.2초 |

**국면별 사이클 (v3.0)**:

| 국면 | 제국 반경 | B | T_행군 | T_교전 | T_공백 | **T_cycle** | 슬롯 |
|---|---|---|---|---|---|---|---|
| 초반 (T≈50) | 4타일 | 1 | 7.5초 | 13.3초 | 3초 | **23.8초** | 3 |
| 중반 (T≈390) | 11타일 | 2 | 12.6초 | 16초 | 3초 | **31.6초** | 4~5 |
| 종반 (T≈900) | 17타일 | 3 | 8.9초 | 20초 | 3초 | **31.9초** | 5~6 |

**핵심 관찰은 v2.0 이래 그대로다**: 행군은 병력을 파괴하지 않고 지연시킬 뿐이다. 깃발을 엇갈려 발령하면 파이프라인이 채워져 정상상태 처리량은 재생률 `R`에 수렴한다. 중반 기준 처리량 상한 `4 × 1200 / 0.527분 = 9,108 병력/분`은 재생률 `R ≈ 2,241 병력/분`의 4.1배다. → **깃발 메커니즘 자체는 여전히 병목이 아니다.**

**실효계수 재분해 (v3.0)**

| 손실 요인 | v2.1 (1단계) | **v3.0 (1단계)** | 변경 사유 |
|---|---|---|---|
| 국경 중복·비효율 확장 경로 | `×1.12` | `×1.12` | 변화 없음 |
| 인간 반응 공백 | `×1.109` | `×1.109` | `T_cycle` 23.8초 동일 |
| 로지스틱 스로틀 | `×1.086` | **`×1.045`** | **방어 예비 병력을 쟁여둘 이유가 사라졌다** |
| 도달 불가 포켓 / 산 우회 | `×1.05` | `×1.05` | 변화 없음 |
| **1단계 종합** | `×1.4166` | **`×1.3629`** | 효율 0.706 → **0.734** |
| **중·종반 종합** | `×1.33` | **`×1.30`** | 위와 같은 이유 |

**로지스틱 스로틀을 1.086 → 1.045로 내린 근거**: v2.1에서 플레이어는 `defDensity`를 유지하려고 풀에 병력을 남겼다. 그만큼 `troops/troopCap`이 높게 유지되어 재생이 눌렸다(`1 − troops/cap` 항). v3.0에서는 **풀에 남긴 병력이 아무 일도 하지 않으므로**(3.2절), 남길 이유가 반격 깃발용 탄약 확보로 축소된다. 그 결과 평균 `troops/cap`이 내려가고 로지스틱 이용률이 올라간다. 정량화하면 v2.1 평균 점유율 약 0.42 → v3.0 약 0.35로 추정되며, 스로틀 항이 `1.10 → 1.05` 수준으로 완화된다.

> 이 변경은 **1단계를 8.46분 → 8.14분으로 3.8% 앞당긴다.** 페이싱 전체에 −0.3분의 영향이며 5.4절에서 합산한다.

#### 5.2 1단계 — 초기 확장 (중립 점령)

**규칙이 바뀌지 않았으므로 v2.1 표를 그대로 쓴다.**

```
분당 병력 수입 = ( 0.8 + 0.50·√T ) × 300 tick/분 × u ,   u = 0.7
중립 타일 비용 C(T) = ( 9 + 1.0·√T ) × 1.0514          // 1.0514 = 지형 실효 가중평균 (2.2절)
```

| T (보유 타일) | 분당 수입 | 타일당 비용 | **분당 확장(gross)** |
|---|---|---|---|
| 9 | 483 | 12.62 | 38.3 |
| 50 | 911 | 16.90 | 53.9 |
| 100 | 1,218 | 19.98 | 61.0 |
| 200 | 1,653 | 24.33 | 67.9 |
| 300 | 1,987 | 27.68 | 71.8 |
| 390 | 2,241 | 30.23 | 74.1 |

| 구간 | Δ타일 | 평균 속도 | 소요 |
|---|---|---|---|
| 9 → 50 | 41 | 46.1 | 0.889분 |
| 50 → 100 | 50 | 57.5 | 0.870분 |
| 100 → 200 | 100 | 64.5 | 1.550분 |
| 200 → 300 | 100 | 69.9 | 1.431분 |
| 300 → 390 | 90 | 73.0 | 1.233분 |
| **합계** | **381** | | **5.973분** |

> **1단계 = 5.973 × 1.3629 = 8.14분.** (v2.1: 8.46분, v2.0: 8.72분, v1.0: 8.5분)
> 이 시점에 육지 3,900타일 중 산악 벽을 뺀 대부분이 소진되고 10인 전원이 서로 국경을 맞댄다. 중립 기지 10개도 이 무렵(대략 7~10분) 전부 임자가 정해진다.
> → `BOT_NEUTRAL_BIAS_TICK = 2442` (8.14분)

**`supplyMult`가 1단계에 미치는 영향**: 1단계 종료 시점 제국 반경 약 11이고 보유 기지는 수도 1개(중립 기지는 최소 거리 12에 배치되므로 1단계 후반에야 손이 닿는다). 전선 타일까지의 거리 = 반경 ≈ 4~11 → `supplyMult = 1.00`(거리 10 이하) ~ `1.02`(거리 11). **가중평균 1.004, 무시 가능.** ✓

**중립 기지 확보 시점**: `BASE_MIN_CAPITAL_DIST = 12`이므로 제국 반경이 12에 닿는 시점 — 위 표에서 T ≈ 450 전후, 즉 **8.5~10분**이다. v2.1의 설계 의도("기지 쟁탈을 2단계의 콘텐츠로 배치")가 유지된다. 중립 기지 함락에 495 AP(4.12절)가 추가로 들지만 이는 깃발 0.4개분이며 1단계 총 예산(약 13,000 병력)의 3.8%다. → **1단계 계산에 반영하지 않는다.**

#### 5.3 2단계 — 중반 교전과 `ENEMY_BASE` 역산

##### (a) 모델 — 방어 응답률 ρ와 예산 배분

v2.1은 "수입 ÷ tileCost × 실효계수"로 계산했다. v3.0에서는 **양쪽이 같은 전선에 AP를 붓기 때문에 배분 가정을 명시해야 한다.**

```
α = 공격자가 결전 전선 하나에 붓는 수입 비율
δ = 방어자가 방어에 붓는 수입 비율 (전 전선 합계)
n = 방어자가 동시에 막아야 하는 활성 전선 수
D = δ · R_def / n                      // 그 전선의 방어 AP
A = α · R_atk                          // 그 전선의 공격 AP
순 전진 = (A − D·λ) / c_raw            // λ = 4.7(d) 손익분기 계수
실효 타일/분 = 순 전진 × 0.769         // 중·종반 실효계수 1.30 의 역수
```

**표준 자세(standard posture) 가정** — 아래 값을 5장 전체의 기준으로 고정한다.

| 파라미터 | 값 | 근거 |
|---|---|---|
| `α` (공격 배분) | **0.45** | 슬롯 4~5개 중 2개를 결전 전선에 투입. 4.1절 기하학상 나머지는 방어·예비 |
| `δ` (방어 배분) | **0.65** | 압박받는 쪽은 방어에 더 쓴다 |
| `n` (활성 전선 수) | **2** | 5.5절 측정: 10인 보드 평균 인접 국경 2.4개 중 실제 교전 중인 것 |
| `λ` (되돌리기 계수) | **1.17** | 방어자는 창병을 쓴다(4.11절 역할 분화의 귀결) |
| 실효계수 | **0.769** | 5.1절 |

##### (b) `ENEMY_BASE` 역산

v2.1의 `ENEMY_BASE = 25`를 그대로 두면 어떻게 되는지 먼저 확인한다.

```
c_raw(적, 검병, 응집 1.25, 지형 1.0514) = ENEMY_BASE × 1.3143
ENEMY_BASE = 25  →  c_raw = 32.9
표준 대치 (600타일 vs 300타일):
   R(600) = 2,740,  R(300) = 1,987
   A = 0.45 × 2740 = 1,233
   D = 0.65 × 1987 / 2 = 646  →  D·λ = 756
   순 = 477 AP/분  →  gross 14.5 타일/분  →  실효 11.1 타일/분
```

여기까지는 v2.1(+8.8)과 비슷해 보인다. **문제는 종반이다.** 선두 곡선을 끝까지 적분하면(아래 (c)) 37분 시점 선두 타일이 약 1,090(28.0%)에 그쳐 **42분 하드 타임아웃으로 끝난다.** 원인은 명확하다 — v2.1은 "밀도항"과 "방어자 자동 방어"라는 하나의 장치로 친 값을, v3.0은 "명목 비용"과 "반격 AP 소모"라는 **두 장치로 이중 계상**하고 있기 때문이다.

**해법: 명목 비용을 낮추고 동적 부분(ρ)에 맡긴다.** 선두 곡선의 적 정복 구간 전체가 `1/c_raw`에 비례하므로 배율 `k = 25/ENEMY_BASE`로 스케일된다.

```
k = 25 / ENEMY_BASE
T(37분)        = 506.5 + 619·k                         // 5.4(c) 구간별 적분에서 유도
37분 이후 실효 = 80.1·k 타일/분                        // 러시 ×1.333 반영
표준 종료      = 37 + (1755 − T(37분)) / (80.1·k)      // 1755 = 3900 × 45%
```

| `ENEMY_BASE` | `k` | `c_raw` | T(37분) | 점유율 | 러시 후 속도 | **표준 종료** | 판정 |
|---|---|---|---|---|---|---|---|
| 25 | 1.000 | 32.9 | 1,126 | 28.9% | 80.1 | **44.9분 → 타임아웃** | ✗ |
| 20 | 1.250 | 26.3 | 1,280 | 32.8% | 100.1 | 41.7분 | ✗ 여유 0.3분 |
| 18 | 1.389 | 23.7 | 1,366 | 35.0% | 111.3 | 40.5분 | △ 여유 1.5분 |
| **16** | **1.5625** | **21.0** | **1,474** | **37.8%** | **125.2** | **39.2분** | **✓ 여유 2.8분** |
| 14 | 1.786 | 18.4 | 1,612 | 41.3% | 143.1 | 38.0분 | △ 여유 4.0분, 2단계가 얕아짐 |
| 12 | 2.083 | 15.8 | 1,796 | 46.1% | 166.8 | 36.3분 (37분 이전 도달) | ✗ 2단계가 고착되지 않음 |

> **결정: `ENEMY_BASE = 16.`** 표준 종료 39.2분으로 v2.1(39.3분)과 사실상 동일하고 하드 타임아웃까지 2.8분 여유가 남는다.
>
> **이 값은 상한 쪽 안전마진으로 골랐다.** 하한(34.5분)은 threshold 곡선이 구조적으로 고정하므로(5.4(d)) 아무리 낮춰도 위험하지 않지만, **높이면 곧장 타임아웃 게임이 된다.** 표에서 25 → 20 → 18 → 16으로 갈수록 여유가 0 → 0.3 → 1.5 → 2.8분으로 벌어지는 것이 그 증거다. 14도 안전하지만 2단계 대치가 얕아져(대등 대치 실효 5.7 → 6.5타일/분) v3.0의 정체성인 "게이지 줄다리기"를 느낄 시간이 줄어든다.

##### (c) `ENEMY_BASE = 16` 기준 실효 속도표

`c_raw = 16 × 1.25 × 1.0514 = 21.0`

| 상황 | A (AP/분) | D·λ | 순 AP | gross | **실효 타일/분** |
|---|---|---|---|---|---|
| 대등 대치 (390 vs 390) | 1,008 | 852 | 156 | 7.4 | **5.7** |
| 600 vs 300 | 1,233 | 756 | 477 | 22.7 | **17.5** |
| 600 vs 300, 상대 방어 포기(ρ=0) | 1,233 | 0 | 1,233 | 58.7 | **45.1** |
| 900 vs 붕괴 상대 (α=0.80) | 2,654 | 531 | 2,123 | 101.1 | **77.7** |
| 1,400 vs 붕괴 상대 (α=0.85, 러시 후) | 3,482 | 696 | 2,786 | 176.9 | **136.0** |

**세 가지 관찰**:

1. **대등한 두 플레이어는 분당 5.7타일밖에 못 뺏는다.** 390타일 제국을 통째로 먹으려면 68분이 걸린다 → **2단계는 여전히 고착 구간**이다. v2.1이 설계한 이 성질이 유지된다.
2. **크기 격차가 v2.1보다 가파르게 반영된다** (600 vs 300에서 +8.8 → +17.5). 밀도 방어가 사라졌으므로 "큰 쪽이 1:1에서 이긴다"가 더 직접적이다. 이를 억제하는 것은 `√tiles` 재생 감쇠와 5.5절의 슬롯 한계다.
3. **방어를 포기하는 순간 2.6배가 된다** (17.5 → 45.1). 4.13절의 캐스케이드가 실효 속도로 확인된다.

##### (d) 2단계에서 우위가 나오는 곳 (v3.0 갱신)

동등한 실력이면 전선이 고착된다. 우위는 **다섯 곳**에서 나온다.

1. **크기** — 600 vs 300에서 실효 **+17.5타일/분**. v2.1(+8.8)의 2배.
2. **테크** — 군사 T3는 손익분기를 `1.170 → 0.913`으로 내려 **창병 벽을 검병으로 대등하게 뚫는다**(4.7(d)). 기동 T2는 슬롯 +1 = 방어 구간 +1.
3. **동맹** — 5.5절. v3.0에서 **가장 결정적인 우위**가 됐다.
4. **기지** — 작전 회전율 +26~52%(v2.1 5.1.1절 유지) + **보급 반경 확보**(4.6(c)) + **기지 자체가 체력 15000짜리 방벽**(4.12절). v2.1보다 세 배로 가치가 커졌다.
5. **자세 배분의 정확성 (v3.0 신규)** — 슬롯을 공격 2/방어 2로 나눌지 3/1로 나눌지가 매 순간의 판단이다. 방어를 하나 덜 두고 그 슬롯으로 공격하면 실효 속도가 +50% 오르지만, 그 구간이 뚫리면 3.00배 캐스케이드가 시작된다. **이것이 v3.0이 2단계에 더한 새 결정이다.**

> **2단계 = 8.14분 ~ 약 25분 (약 17분).** 이 구간에서 통상 3~5명이 탈락하고, 상위 2~3명이 각 750~1,050타일로 성장한다.

#### 5.4 3단계 — 종반 정리와 수렴 검증

**(a) 임계값 하강** (v1.0 이래 불변):

```
threshold(t) = clamp( 60 - 1.2 * max(0, (t - 6600) / 300), 45, 60 )   // t = tick

  22분(6600 tick)까지  : 60%
  22분 → 34.5분        : 분당 -1.2%p
  34.5분(10350 tick)   : 45% 하한 고정
  42분(12600 tick)     : 하드 타임아웃
```

**(b) 종반 러시** (v2.0 이래 유지 — design-decisions C항):

```
t >= ENDGAME_RUSH_TICK (11100, 37분)  →  모든 tileCost × 0.75
```

**v3.0에서 이 장치의 효과가 커졌다.** `endgameRushMult`가 `tileCost`에만 붙고 `defRefCost`에는 붙지 않으므로(4.7(a)), 러시는 **공격 진척을 ×1.333 하면서 방어 되돌리기는 그대로 둔다.** 즉 러시는 손익분기 자체를 `1.170 → 0.878`로 내려 **창병 벽을 무력화한다.** v2.1에서는 공수 양쪽 비용에 동일하게 걸렸으므로 이런 비대칭이 없었다.

신규 동맹 마감(`ALLIANCE_CUTOFF_TICK`)도 같은 37분이므로 **마지막 5분은 외교 없는 순수 난전**으로 선언된다.

**(c) 선두 플레이어의 타일 곡선 (v3.0 재계산)**

구간별 계산은 5.3(a)의 표준 자세 모델을 쓰되, 국면에 따라 `α`(공격 배분)와 상대의 `ρ`를 조정한다. `k = 25 / ENEMY_BASE = 1.5625`.

| 구간 | `α` | 상대 `ρ` | `R` (분당 수입) | 순 AP/분 | gross(k=1) | **실효(k=1.5625)** |
|---|---|---|---|---|---|---|
| 8.14~15분 | 0.45 | — (중립 확장 위주) | 2,380 | — | — | **13.1** (중립) |
| 15~20분 | 0.45 | 0.55 | 2,568 | 231(적) + 231(중립) | 5.3 + 5.4 | **13.8** |
| 20~25분 | 0.55 | 0.29 | 2,740 | 1,070 | 25.0 | **39.1** |
| 25~30분 | 0.60 | 0.20 | 3,017 | 1,448 | 33.8 | **52.8** |
| 30~34.5분 | 0.70 | 0.25 | 3,288 | 1,726 | 40.4 | **63.2** |
| 34.5~37분 | 0.80 | 0.30 | 3,543 | 1,984 | 46.4 | **72.5** |
| 37분~ (러시) | 0.85 | 0.30 | 4,322 | 2,572 | 80.1 | **125.2** |

| 시각 | 생존자 | 선두 타일 | 점유율 | threshold | 구간 순증 | 근거 |
|---|---|---|---|---|---|---|
| **8.14분** | 10 | 390 | 10.0% | 60% | — | 1단계 종료 |
| 15분 | 10 | 480 | 12.3% | 60% | +13.1/분 | 잔여 중립·산악 포켓 소진, 중립 기지 1개 확보 |
| 20분 | 9 | 549 | 14.1% | 60% | +13.8/분 | **대치 고착.** 첫 탈락자 발생, 기지 2개 |
| 25분 | 7 | 744 | 19.1% | 56.4% | +39.1/분 | 2명 추가 탈락. 붕괴 캐스케이드 진입 |
| 30분 | 5 | 1,008 | 25.8% | 50.4% | +52.8/분 | 3번째 기지 확보. ρ 하락 가속 |
| 34.5분 | 4 | 1,292 | 33.1% | **45%** | +63.2/분 | 4번째 기지. 남은 상대는 강자 → ρ 부분 회복 |
| 37분 | 3 | 1,473 | 37.8% | 45% | +72.5/분 | **러시 발동 직전** |
| **39.2분** | 2~3 | **1,755** | **45.0%** | 45% | **+125.2/분** | 러시가 손익분기를 0.878로 내림 → **threshold 도달, 승리** |

> **표준 게임 종료 = 약 39.2분** (v2.1: 39.3분, v2.0: 40.0분). 하드 타임아웃까지 **2.8분 여유** (v2.1: 2.66분).

**v2.1과 곡선의 모양이 달라진 점**: v3.0의 15~20분 구간이 눈에 띄게 평평하다(+13.8/분 vs v2.1 +28.9/분). **대등한 상대끼리는 실효 5.7타일/분밖에 못 뺏기 때문**이며(5.3(c)), 이것이 v3.0이 만든 진짜 "대치 구간"이다. 그 대신 25분 이후가 v2.1보다 가파르다 — 캐스케이드 배율이 1.96 → 3.00으로 커졌기 때문이다(4.13절). **총 소요 시간은 거의 같지만 곡선의 곡률이 커졌다** = 초중반이 더 팽팽하고 종반이 더 극적이다.

**(d) 실질 하한 검증**

선두가 모든 적 정복 구간에서 정상보다 빠른 최상 시나리오를 두 가지 강도로 검증한다. (중립 확장 구간은 규칙이 안 바뀌었으므로 배속하지 않는다.)

| 시각 | 표준 | **1.4배 폭주** | **1.6배 폭주 (극단)** | threshold |
|---|---|---|---|---|
| 15분 | 480 | 480 | 480 | 60% |
| 20분 | 549 | 566 | 574 | 60% |
| 25분 | 744 | 839 | 886 | 56.4% |
| 30분 | 1,008 | 1,209 (31.0%) | 1,308 (33.5%) | **50.4%** ← 미달 |
| 34.5분 | 1,292 | 1,607 (41.2%) | **1,762 (45.2%)** | **45%** ← 도달 |
| **종료** | **39.2분** | **36.0분** | **34.5분** | — |

```
1.6배 시나리오 정밀 계산 (30분 → 34.5분 구간 속도 100.9타일/분):
   34.4분: 선두 1,747 (44.8%)  vs  threshold 45.10%  → 미달
   34.5분: 선두 1,757 (45.1%)  vs  threshold 45.00%  → 도달
```

> **실질 하한 = 34.5분.** 그리고 이 값은 **구조적으로 고정되어 있다** — `threshold(t)`가 45% 하한에 닿는 시각이 정확히 34.5분이기 때문이다. 그 이전에 끝나려면 30분 시점에 50.4%(1,966타일)를 넘어야 하는데, 5.3(c)의 최대 실효속도(붕괴 상대 상대 77.7타일/분)로도 도달 불가능하다. **어떤 폭주 시나리오도 34.5분 아래로 내려갈 수 없다.** 목표 하한 30분까지 4.5분 여유.

**(e) 상한 검증**: 3~4명이 균형을 이루면 아무도 45%를 못 찍고 42분 하드 타임아웃 → 점유율 1위 승리. 무승부 없음. **v3.0에서 이 시나리오의 확률이 v2.1보다 높아졌다** — 대치 구간이 더 팽팽하기 때문이다. 5.3(b) 표에서 `ENEMY_BASE`를 16보다 크게 잡으면 이것이 표준이 되어버리므로, 16이 하한 쪽 안전마진이 아니라 **상한 쪽 안전마진**으로 선택된 값임을 명시한다.

**(f) `ENDGAME_RUSH_TICK = 37분` 재검토 (미결정 8번, F.11)**

design-decisions C항이 확정한 값이므로 바꾸지 않되, v3.0 모델에서 다시 검산한다.

| | 러시 없음 | **러시 37분/0.75** |
|---|---|---|
| 37분 이후 실효 속도 | 93.9타일/분 | **125.2타일/분** |
| 표준 종료 | 40.0분 | **39.2분** |
| 하드 타임아웃까지 여유 | 2.0분 | **2.8분** |

> **판정: 유지. 위험도를 v2.1의 "중"에서 "하"로 낮춘다.** v2.1에서는 러시가 없으면 타임아웃이었지만(여유 0), v3.0에서는 러시가 없어도 40.0분에 끝난다 — 캐스케이드 강화(4.13절) 덕분이다. 러시는 이제 **필수 장치가 아니라 마진 확보 장치**다.
>
> **v2.1과 반대 방향의 조정 가능성**: v2.1은 "실측이 나오면 35분으로 **앞당기는** 것을 1순위 검토"라고 썼다. v3.0에서는 반대로 **39분으로 늦추는** 쪽이 후보가 된다 — 러시가 손익분기를 0.878로 내려 창병 벽을 무력화하므로, 너무 이르면 마지막 5분이 "방어가 의미 없는 구간"이 되어 v3.0의 정체성을 스스로 지운다. 플레이테스트 관측 지표: **37~42분 구간의 방어 자세 슬롯 비중이 20% 아래로 떨어지는가.** 떨어지면 `ENDGAME_RUSH_COST_MULT`를 0.85로 완화한다(미결정 4번).

> ### 결론: 예상 세션 분포 = **34.5분(구조적 최단) ~ 42분(하드 캡), 중앙값 38~40분.**
> 목표 30~60분 안에 안전하게 수렴한다. v2.1(33.8~42분, 중앙값 38.5~40.5분) 대비 **하한이 0.7분 올라가고 분포가 좁아졌다.** "방어가 사라지면 확장이 빨라져 세션이 짧아진다"는 F.8의 우려는 **기각된다** — 방어가 사라진 것이 아니라 **비용을 지불하는 방어로 바뀌었기** 때문이며, 그 비용이 정확히 v2.1의 밀도항이 하던 일을 대신한다.

#### 5.5 동맹의 근거 재정립 (F.4 필수 처리)

**폐기된 명제**: *"`troopCap`이 타일당 12로 고정이므로 큰 제국은 타일당 방어력을 늘릴 수 없다. 큰 쪽은 1:1에서는 이기지만 여럿에게 둘러싸이면 진다."* (v2.1 3.2절)

이 명제는 밀도 방어에 100% 의존했다. **v3.0에서 무엇이 이 자리를 대신하는가.**

##### (a) 전선당 방어 예산 불변 정리

제국 크기 `T`가 커질 때, **한 전선을 지키는 데 쓸 수 있는 병력은 거의 늘지 않는다.**

```
분당 수입           R(T) = (0.8 + 0.5·√T) × 210
방어 구간 수        S(T) = 4·√T / (2·FRONT_RADIUS + 1) = 4·√T / 13
전선당 방어 예산    B(T) = δ · R(T) / S(T)        (δ = 0.65)
```

| T | `R(T)` | `S(T)` 구간 | **전선당 예산 B(T)** | `flagCap` | 커버율 `flagCap/S` |
|---|---|---|---|---|---|
| 100 | 1,218 | 3.08 | **257** | 3 | 0.97 |
| 390 | 2,241 | 6.08 | **240** | 4 | 0.66 |
| 600 | 2,740 | 7.54 | **236** | 5 | 0.66 |
| 900 | 3,318 | 9.23 | **234** | 6 | 0.65 |
| 1,200 | 3,836 | 10.66 | **234** | 7 | 0.66 |
| 1,800 | 4,619 | 13.06 | **230** | 7 | **0.54** |

> **정리: `B(T)`가 T에 대해 사실상 상수다 (257 → 230, −10%).**
>
> 증명 스케치: `R ∝ √T` (재생 감쇠), `S ∝ √T` (둘레). 둘이 같은 차수이므로 비율이 상수로 수렴한다. **이것이 v2.1의 "타일당 방어 밀도 12 고정"과 정확히 같은 역할을 하는 v3.0의 정리다** — 표현만 "밀도"에서 "전선당 예산"으로 바뀌었을 뿐 수학적 구조가 동일하다.
>
> 그리고 **커버율은 오히려 떨어진다** (0.97 → 0.54). 큰 제국은 전 구간을 동시에 지킬 슬롯이 없다. `FLAG_CAP_HARD_MAX = 7`이 이 성질을 만드는 유일한 상수이며, 이것이 v3.0에서 그 값을 올리는 변경을 금지하는 근거다.

##### (b) 왜 여럿에게 둘러싸이면 지는가 — 정량

공격자는 **자기 수입 전부를 한 전선에 몰 수 있다.** 방어자는 **모든 전선에 나눠야 한다.** 이 비대칭이 동맹의 전부다.

**시나리오: 1,200타일 선두 vs 각 400타일 공격자 N명 (동맹)**

```
선두:      R = 3,836,  δ=0.65 → 방어 예산 2,493,  활성 전선 N개 → 전선당 2,493/N
공격자 각: R(400) = 2,268,  α=0.60 → 전선당 1,361
손익분기(창병 방어): 공격자가 방어자보다 1.170배 많이 부어야 전진
```

| N (공격자 수) | 선두 전선당 방어 | 필요 공격 AP | 실제 공격 AP | **돌파 여부** | 각 전선 실효 타일/분 |
|---|---|---|---|---|---|
| 1 | 2,493 | 2,917 | 1,361 | ✗ 정체 | 0 |
| 2 | 1,247 | 1,459 | 1,361 | ✗ 아슬 (93%) | 0 |
| **3** | **831** | **972** | **1,361** | **✓ 돌파** | **+14.3** |
| 4 | 623 | 729 | 1,361 | ✓ 압도 | +22.9 |

> **3인 동맹이 임계점이다.** 2인으로는 1,200타일 선두를 못 뚫고, 3인이면 전선마다 +14.3타일/분씩 총 **+42.9타일/분**으로 무너뜨린다. `MAX_ALLIES_PER_PLAYER = 2`이므로 3인이 서로 다 동맹일 수는 없고(A–B, B–C만 가능, A–C는 불가), **"공식 동맹 2인 + 비공식 편승 1인"** 이라는 정치적 구도가 자연스럽게 만들어진다. 이것이 6.2절의 상한 2를 v3.0에서 유지하는 근거다.

##### (c) v2.1과 무엇이 같고 무엇이 다른가

| | v2.1 | **v3.0** |
|---|---|---|
| 동맹의 근거 | 방어 밀도 상한(타일당 12) | **전선당 예산 불변 정리 + 슬롯 커버율 하락** |
| 수학적 구조 | `R ∝ √T` vs `수비 필요량 ∝ T` | `R ∝ √T` vs `전선 수 ∝ √T`, **슬롯은 상수 상한 7** |
| 임계 동맹 인원 | 2인 (v2.1 5.3절: "실효 52 vs 26") | **3인** (2인은 93%로 아슬하게 부족) |
| 플레이어가 이걸 아는 방법 | 밀도 숫자를 읽어야 함 | **지도에서 방어 깃발이 몇 개인지 세면 됨** |
| 협공 시 추가 압박 | `LOSER_TO_DEFENDER_RATIO`(인공 상수) | **슬롯 고갈**(구조적) |

> **결론: 동맹의 근거는 "밀도 상한"에서 "슬롯 상한"으로 이전됐고, 임계 인원이 2인에서 3인으로 올라갔다.** 동맹이 조금 더 어려워지고 조금 더 결정적이 됐다. 6.2절 동맹 규칙 조문은 하나도 바꾸지 않는다.
>
> **위험 신호**: 임계 인원 3인은 `MAX_ALLIES_PER_PLAYER = 2`와 정확히 맞물려 "동맹 사슬(A–B–C)"을 강제한다. Alliance Lockout(6.2절)의 발동 빈도가 v2.1보다 올라갈 수 있다. 관측 지표를 미결정 9번에 남긴다.

#### 5.6 조작량(APM) 추정 — 방어 명령이 늘었는데 왜 안 늘어나는가

**우려**: v3.0은 방어라는 새 활동을 추가했다. 조작량이 늘어나 v2.1이 확보한 15~18 액션/분 대역이 깨지지 않는가?

**답: 늘지 않는다. 오히려 줄어든다.** 이유는 **슬롯이 총량을 묶기 때문**이다.

```
분당 액션 = Σ over 슬롯 ( 60초 / T_cycle(그 슬롯) ) × 2액션
```

슬롯 수는 v2.1과 같다. 방어는 **새 슬롯을 만드는 것이 아니라 기존 슬롯을 나눠 쓰는 것**이므로 분모는 그대로다. 그리고 **방어 슬롯의 사이클이 공격 슬롯보다 길다.**

| | 공격 슬롯 | **방어 슬롯** |
|---|---|---|
| 소진 조건 | AP를 전액 태움 (66.7 tick = 13.3초) | 상대가 밀 때만 AP를 쓴다(4.7(c)) + 주둔 유지비 |
| 실측 수명 | 13~20초 교전 후 종료 | **평균 2배 이상.** 상대 공세가 간헐적이므로 |
| 재발령 빈도 | 사이클마다 | 사이클의 절반 이하 |

**국면별 재계산** (방어 슬롯 비중 40% 가정 — 4.1절 기하학에서 도출):

| 국면 | 슬롯 F | B | 공격 T_cycle | 방어 T_cycle | 분당 발령 | **분당 액션** | v2.1 |
|---|---|---|---|---|---|---|---|
| 초반 (0~8.1분) | 3 | 1 | 23.8초 | — (방어 거의 없음) | 7.56회 | **15.1** | 15.1 |
| 중반 (8.1~25분) | 4.5 | 2 | 31.6초 | 65초 | 7.46회 | **14.9** | 17.1 |
| 종반 (25~42분) | 5.5 | 3 | 31.9초 | 64초 | 8.27회 | **16.5** | 17.9 |

```
중반 계산: 공격 슬롯 0.6×4.5 = 2.70 → 2.70 × 60/31.6 = 5.13회/분
           방어 슬롯 0.4×4.5 = 1.80 → 1.80 × 60/65   = 1.66회/분
           합계 6.79회/분 → 13.6 액션/분
           + 자세 판단 재지정(사이클당 0.1회) + 회수 → 약 14.9
```

> **평균 14.9~16.5 액션/분 = 3.6~4.0초에 한 번.** v2.1(15.1~17.9)보다 **낮아졌다.**
> - territorial.io: 약 10~20 액션/분 · generals.io: 30~60 APM
> - 조정 트리거(20)와 초보 학살선(25)을 여전히 넘지 않는다.

**출발 기지 수동 변경분** (v2.1과 동일): 자동 선택이 기본이고 슬롯에 sticky하므로 추가 비용은 5~15% 발생률. 최악(15%)에도 종반 **19.0 액션/분**으로 트리거 20 아래.

**극단 케이스 (v2.1에서 이월)**: 종반 선두가 `기동 T3(×2.00)` + `기지 4개` + `슬롯 7` + **전 슬롯 공격**을 갖추면 `T_cycle = 5.6 + 20 + 3 = 28.6초` → `7 × 60/28.6 × 2 = 29.4 액션/분`. **v3.0에서는 이 빌드가 자기 국경을 통째로 비우는 선택**이 되어 4.13절의 3.00배 캐스케이드에 노출된다 — 즉 v2.1보다 훨씬 위험한 빌드다. 위험도를 **하향**하되 지정 레버(`FLAG_TILES_PER_SLOT` 300 → 400)는 유지한다.

**병종·자세가 조작량을 늘리지 않는 이유**: 둘 다 **한 액션 안의 선택지**다. 병종은 단축키(1/2/3), 자세는 클릭 지점이 결정한다. `N개 깃발 × M개 전선 × 3병종 × 2자세`의 곱셈 폭발은 발생하지 않는다.

**브레이크와 조정 순서** (분당 액션이 20을 넘으면 이 순서로):

1. **출발 기지 수동 변경 UI를 sticky로 강제** — 코드 수정 없이 클라이언트만 고치는 가장 싼 레버.
2. `FLAG_SPEND_RATE` 0.015 → 0.012 — 교전이 13.3초 → 16.7초로 길어진다. 하한은 0.012(더 낮추면 한 작전이 너무 오래 끈다).
3. `FLAG_TILES_PER_SLOT` 300 → 400 — 슬롯 증가를 늦춘다. 극단 케이스의 지정 레버.
4. **`FLAG_CAP_BASE = 3`과 `FLAG_CAP_HARD_MAX = 7`은 건드리지 않는다.** v3.0에서는 이 두 값이 5.5절 동맹 근거의 유일한 원천이므로 **올리는 방향은 물론 내리는 방향도 페이싱 전체를 재계산해야 한다.**

#### 5.7 테크 구매 횟수 검산

골드 산출은 `0.965(지형 가중평균) × 1.55 × 300 tick/분 / 1000 = 0.4487 골드/타일/분` — v1.0 이래 동일.

5.4(c) 곡선을 적분한 "타일·분":

| 구간 | 평균 타일 | 길이(분) | 적분 |
|---|---|---|---|
| 0~8.14 | 180 | 8.14 | 1,465 |
| 8.14~15 | 435 | 6.86 | 2,984 |
| 15~20 | 515 | 5.00 | 2,575 |
| 20~25 | 647 | 5.00 | 3,235 |
| 25~30 | 876 | 5.00 | 4,380 |
| 30~34.5 | 1,150 | 4.50 | 5,175 |
| 34.5~37 | 1,383 | 2.50 | 3,458 |
| 37~39.2 | 1,614 | 2.20 | 3,551 |
| **합계** | | | **26,823** |

| 플레이어 | 타일·분 | 누적 골드 (+시작 200) | 살 수 있는 노드 |
|---|---|---|---|
| **선두** (39.2분 승리) | 26,823 | **12,235** | 450+562+1650+1925+5200 = 9,787 → **5개**<br>(+T1 1,012 = 10,799까지 가능, 6번째 T2 2,750은 초과) |
| **중위권** (42분 생존, 평균 320타일) | 10,560 | 4,938 | 450+562+1650+1925 = 4,587 → **4개** |
| **조기 탈락** (20분 탈락) | 3,300 | 1,681 | 450+562 = 1,012 → **2~3개** |

##### v3.1 재검산 — 주둔 유지비(골드) 차감 후 (A-1)

위 표는 **그로스** 골드다. v3.1부터 주둔 중인 슬롯이 수입을 갉으므로(4.4절) 다시 계산한다.

**가정**: 방어 슬롯 비중 40%(4.11절 관측 대역 30~55%의 중앙), 주둔 병종 혼합 창 50 / 검 40 / 기 10 → 평균 가중치 `0.5×0.60 + 0.4×1.00 + 0.1×1.60 = 0.86`. 1단계(0~8.14분)는 전원 중립 확장 중이므로 주둔 0으로 둔다. `escalate = 1`(교전이 도는 표준 플레이 가정).

| 구간 | 슬롯 | 주둔 수 | 가중치 합 | 과금(−1000) | 둔화 | 그로스 골드 | 손실 |
|---|---|---|---|---|---|---|---|
| 0~8.14 | 3 | 0 | 0 | 0 | 0% | 657 | 0 |
| 8.14~15 | 4 | 1.6 | 1,376 | 376 | 3.4% | 1,339 | 46 |
| 15~20 | 4 | 1.6 | 1,376 | 376 | 3.4% | 1,155 | 39 |
| 20~25 | 5 | 2.0 | 1,720 | 720 | 6.5% | 1,452 | 94 |
| 25~30 | 5 | 2.0 | 1,720 | 720 | 6.5% | 1,965 | 128 |
| 30~34.5 | 6 | 2.4 | 2,064 | 1,064 | 9.6% | 2,322 | 223 |
| 34.5~37 | 7 | 2.8 | 2,408 | 1,408 | 12.7% | 1,552 | 197 |
| 37~39.2 | 7 | 2.8 | 2,408 | 1,408 | 12.7% | 1,594 | 202 |
| **합계** | | | | | **평균 7.7%** | **12,035** | **929** |

| 플레이어 | 그로스 | 유지비 | **순 누적** | 살 수 있는 노드 | v3.0 대비 |
|---|---|---|---|---|---|
| **선두** (39.2분 승리) | 12,235 | −929 | **11,306** | 9,787 ≤ 11,306 → **5개** (6번째 12,537은 여전히 초과) | **동일** |
| **중위권** (42분 생존, 320타일, 방어 비중 50%) | 4,938 | −308 | **4,630** | 4,587 ≤ 4,630 → **4개** | **동일** (여유 351 → 43) |
| **조기 탈락** (20분 탈락) | 1,681 | −40 | **1,641** | 1,012 → **2~3개** | **동일** |

**노드 획득 시점 이동**:

| 노드 | 누적 필요 | v3.0 시점 | **v3.1 시점** | 지연 |
|---|---|---|---|---|
| 1 (T1 450) | 450 | 3.1분 | 3.1분 | 0 |
| 2 (누적 1,012) | 1,012 | 8.9분 | 9.0분 | +0.1분 |
| 3 (누적 2,662) | 2,662 | 17.0분 | 17.3분 | +0.3분 |
| 4 (누적 4,587) | 4,587 | 24.3분 | 24.9분 | +0.6분 |
| 5 (누적 9,787) | 9,787 | 35.6분 | **36.8분** | **+1.2분** |

> **5장 페이싱은 유지된다.** 표준 종료 39.2분 / 실질 하한 34.5분 / 하드 타임아웃 42분은 **하나도 움직이지 않는다** — 유지비는 병력·타일 흐름에 손대지 않으므로 5.1~5.4의 실효계수·`ENEMY_BASE = 16` 역산·수렴 곡선의 입력이 전부 그대로다. 바뀐 것은 **골드 → 테크 변환 효율뿐**이며, 그 결과도 노드 수 3~5개 목표 대역을 벗어나지 않는다.
>
> **상수 조정 제안 없음.** `GOLD_RATE_PERMILLE`, `BASE[tier]`, `ENEMY_BASE`, `THRESHOLD_*` 모두 현행값을 유지할 근거가 나왔다.
>
> **다만 여유가 두 군데서 얇아졌다 — 관측 대상이다.**
> **(1) 중위권 4번째 노드 여유가 351 → 43골드로 줄었다.** 방어 비중이 50%를 조금만 넘겨도 중위권은 4개 → 3개가 된다. 3개도 목표 대역(3~5) 안이지만, 선두 5 vs 중위권 3은 v3.0의 5 vs 4보다 스노볼이 크다. → **B-11**.
> **(2) 선두의 5번째 노드가 36.8분에 들어와 `ENDGAME_RUSH_TICK`(37분)과 0.2분 차다.** 유지비가 조금만 무거워지면 마지막 노드가 종반 러시 **이후**로 밀려 사실상 무용지물이 된다. → **B-11**.

> **v2.1 대비 선두가 6개 → 5개로 줄었다.** 5.4(c) 곡선의 15~25분 구간이 평평해졌기 때문이다(대치 고착). **이는 목표(3~5개)에 오히려 더 정확히 들어맞으며 `GOLD_RATE_PERMILLE`를 조정하지 않는다.** 4축 × 3단계 = 12노드 중 최대 5개 → **반드시 축을 골라야 한다.**
>
> **v3.0에서 축 선택의 성격이 바뀌었다**: v2.1에서는 "공격 강화 vs 경제"였다. v3.0에서는 **군사 축이 유일하게 공/방 양쪽에 붙는 축**이고(3.4절), 기동 축이 **방어 반응 속도와 방어 슬롯 수**를 산다(5.5절). 즉 5개의 노드로 "얼마나 세게 미느냐"와 "얼마나 잘 버티느냐"를 동시에 배분해야 한다. 선택의 밀도가 올라갔다.

#### 5.8 조정 레버 (다음 반복에서 이 순서로 건드릴 것)

| 우선순위 | 레버 | v3.0 값 | 효과 |
|---|---|---|---|
| **1** | **`ENEMY_BASE`** | **16** | **v3.0의 1순위 레버.** 5.3(b) 표가 전체 곡선을 직접 통제한다. +2면 종료 +1.3분 |
| 2 | `DEFENSE_LEVERAGE_PERMILLE` | 900 | 공수 균형의 근원. 1000이면 대치가 완전 교착, 800이면 방어가 무의미해진다. **±50 이상 움직이지 말 것** |
| 3 | `REGEN_SQRT_COEF` | 0.50 | 모든 단계에 비례. 0.55면 전체 약 −9%, 0.45면 +11% |
| 4 | `LAND_TILES_PER_PLAYER` | 390 | 1단계 길이에 거의 선형. 320이면 1단계 −1.7분, 전체 −4분 |
| 5 | `ENDGAME_RUSH_TICK` / `_COST_MULT` | 37분 / 0.75 | 종료 시점 직접 통제. **v3.0에서는 늦추는 방향(39분)이 후보**(5.4(f)) |
| 6 | `UNIT_DEF_PUSH[SPEAR]` | 1.30 | 대치 고착도. 1.15면 대치가 풀리고 1.45면 창병 벽이 뚫리지 않는다 |
| 7 | `FRONT_RADIUS` | 6 | **방어 커버 기하학 전체를 바꾼다**(4.1절). 5, 7 이외 값은 재검산 필수 |
| 8 | `BASE_HP_MAX_MILLI` | 15000 | 기지 쟁탈 빈도. 낮추면 회전문이 잦아지고 높이면 선점 독점 위험 |
| 9 | `THRESHOLD_DECAY_START` / `_PER_MIN` | 22분 / 1.2 | 3단계 종료 시점 미세조정. **하한 34.5분을 직접 결정**(5.4(d)) |
| 10 | `FLAG_SPEED_BASE_MILLI` | 120 | 행군 지연 = 실효계수 + 반격 반응 시간 |
| 11 | `FLAG_SPEND_RATE` | 0.015 | 페이싱보다 **조작량** 레버. 하한 0.012 |
| 12 | `GARRISON_UPKEEP_PERMILLE` / `_FREE_PERMILLE` | 90 / 1000 | 웅크리기 억제 강도(골드). **페이싱이 아니라 테크 획득 시점 레버**다. 90→70이면 선두 5번째 노드 −0.4분, 중위권 여유 +90골드. `_FREE`를 0으로 두면 방어 1개조차 과금되어 정상 방어가 죽는다 |
| 13 | `SUPPLY_COEF` / `_FREE_RADIUS` | 0.02 / 10 | 원거리 침투 억제. 표준 플레이에는 영향 없음 |
| 14 | `NEUTRAL_BASE_COUNT` (= 인원 수) | N | 기지 희소성. 1.5N이면 쟁탈이 평탄해지고 0.5N이면 승자독식 위험 |
| 15 | `HARD_TIMEOUT_TICK` | 42분 | 최후의 안전장치. 페이싱이 아니라 상한 보증용 |

---

## 6. 승리조건

> **v1.0에서 규칙이 하나도 바뀌지 않았다.** v3.0에서도 조문은 그대로이고 **근거만 재정립**했다(5.5절). 아래는 완전한 보존이며 v3.0 주석만 덧붙였다.

### 6.1 판정 순서 (매 tick, 이 순서 고정)

```
1) 생존자 수 == 1                      -> game_over(reason="last_standing")
2) 생존자 중 개인 점유율 >= threshold(t) -> game_over(reason="threshold")
      동시 도달 시: 타일 수 → 병력 → 누적 획득 골드 → playerId 오름차순
3) t >= HARD_TIMEOUT_TICK              -> game_over(reason="timeout")
      순위: 타일 수 → 병력 → 누적 획득 골드 → playerId 오름차순
4) 생존자 수 == 0 (동시 전멸, 이론상)   -> game_over(winnerId=null, reason="timeout")
```

```
개인 점유율 = p.tiles / totalLandTiles × 100        // 순수 타일 개수. 지형 가중치 미적용
threshold(t) = clamp( 60 - 1.2 * max(0, (t - 6600)/300), 45, 60 )
```

**점유율은 언제나 개인 기준이다. 동맹 합산은 어떤 경우에도 승리를 만들지 않는다.**

> **v3.0 주석 — 진척도 중인 타일은 점유율에 포함되지 않는다.** 게이지가 999까지 차 있어도 그 타일은 여전히 방어자 것이다. 소유권은 1000에 닿는 순간 이산적으로 넘어간다(4.10절). **분수 점유율이라는 개념은 존재하지 않으며**, 이는 승리 판정을 정수 비교로 유지해 결정론 위험을 만들지 않기 위한 결정이다.
>
> **v3.0 주석 — 기지도 일반 타일 1개로 센다.** 체력 15000짜리 기지가 점유율에서 15타일로 세어지지는 않는다. 기지의 가치는 점유율이 아니라 보급·행군·방벽으로 표현된다.
>
> **v2.0 주석(유지) — 분모에 산이 포함된다.** `totalLandTiles`(3,900)는 산 8%(312타일)를 포함하고 상당수가 세션 내내 중립으로 남는다. 실제 도달 가능한 최대 점유율은 약 95%이며 45% 임계값은 "도달 가능한 땅의 약 47.4%"다. 5.4절 곡선은 이 드래그를 반영해 계산했다. 미결정 사항 10번으로 남긴다.

### 6.2 동맹 규칙 (v1.0 전문 보존 — 조문 변경 없음)

| 항목 | 상수 / 규칙 |
|---|---|
| 동맹 인원 상한 | `MAX_ALLIES_PER_PLAYER = 2` — 전체가 한 덩어리로 뭉치는 것을 구조적으로 어렵게 한다 |
| 제안 유효시간 | `PROPOSAL_TTL = 150 tick (30초)`. 만료 시 자동 거절 |
| 상호 제안 | 양측이 서로에게 제안한 상태가 되면 즉시 성립 |
| 성립 효과 | 상호 공격 불가. 상대 소유 타일은 `front()` 정의에서 제외되어 **게이지 자체가 생기지 않는다.** 이미 그 상대를 향해 행군/교전 중인 깃발은 즉시 `IDLE` 전환 + `progressMilli = 0` |
| 최소 유지시간 | `ALLIANCE_MIN_DURATION = 300 tick (60초)`. 이 전에는 파기 요청 자체가 거절된다 |
| **백스탭 쿨다운** | 파기 요청 → 상태 `BREAKING` → `BACKSTAB_COOLDOWN = 150 tick (30초)` 경과 후 `BROKEN`. **쿨다운 동안 양측 모두 서로 공격 불가**, 파기 사실이 즉시 전원에게 브로드캐스트된다 |
| 파기 취소 | 불가. `BREAKING`은 되돌릴 수 없다 |
| 신규 체결 마감 | `ALLIANCE_CUTOFF_TICK = 11100 tick (37분)` — 종반 킹메이킹 차단. **`ENDGAME_RUSH_TICK`과 같은 값** |
| 탈락 시 | 탈락자의 모든 동맹은 쿨다운 없이 즉시 소멸 |

> **v3.0 주석 — 백스탭 쿨다운 30초의 의미가 더 정확해졌다.** v2.1에서 30초는 "깃발 재배치 한 번"이었다. v3.0에서는 **"방어 깃발을 세울 수 있는 시간"** 이다. 중반 방어 행군은 자기 영토 안이라 12.6초(기지 2개 기준), 판단 3초를 더해 약 16초. **30초면 두 구간에 방어 깃발을 세울 수 있다.** 배신당한 쪽이 최소한의 방어선을 구축할 시간이 규칙으로 보장된다 — v2.1보다 유의미하게 관대해졌고, 이는 v3.0에서 무방비 상태의 캐스케이드가 3.00배로 강해진 것에 대한 균형추다.
>
> **v3.0 주석 — 동맹 방어 지원은 없다.** `guard(f)`는 자기 소유 타일만 포함하므로(4.1절), 동맹의 땅에 내 방어 깃발을 세울 수 없다. 이는 (a) 소유권 판정을 단순하게 유지하고, (b) 동맹을 "서로 안 때린다"는 소극적 관계로 묶어 6.2절의 lockout 위험을 억제하기 위한 결정이다. 미결정 8번으로 남긴다.

**동맹 봉쇄 규칙 (Alliance Lockout)** — "막판에 전원이 동맹이라 게임이 멈추는" 교착 방지:

```
매 tick:
  생존 플레이어들을 정점, 동맹(ACTIVE 또는 BREAKING)을 간선으로 하는 그래프 G 구성
  if 생존자 >= 2 AND G 가 단일 연결 컴포넌트로 생존자 전원을 포함:
       if lockoutCountdown == null:
            lockoutCountdown = 150 tick (30초)
            emit alliance_lockout(reason="all_allied", forceDissolveTick=t+150)
       else:
            lockoutCountdown -= 1
            if lockoutCountdown == 0:
                 모든 동맹 강제 해제 (BREAKING 포함, 쿨다운 없이 즉시)
                 allianceFreezeUntilTick = t + 300 tick (60초)   // 재체결 금지
                 lockoutCountdown = null
                 emit alliance_broken(...) × N, alliance_lockout(freezeUntil=...)
  else:
       lockoutCountdown = null      // 조건 해소 시 취소
```

**"마지막 2인이 동맹인 채로 임계값에 도달하면?"** 에 대한 최종 답 (v1.0 이래 불변):

1. 점유율은 개인 기준이므로 **동맹 합산으로는 절대 승리하지 않는다.** 두 명이 각각 40%씩 가져도 threshold(45%)에 미달이면 게임은 안 끝난다.
2. 생존자가 2인이고 둘이 동맹이면 lockout 조건이 즉시 성립 → 30초 뒤 강제 해제 + 60초 재체결 금지. **반드시 서로 싸우게 된다.**
3. 그래도 42분 하드 타임아웃에 걸리면 개인 점유율 1위가 승리한다. 무승부는 없다.
4. 한쪽이 동맹 중에 혼자 45%를 넘겼다면 그 즉시 승리한다 — 규칙상 정상 승리다. 이것이 "동맹을 언제 깰 것인가"를 게임의 마지막 결정으로 만든다.

### 6.3 무승부 처리

없다. 6.1의 4중 타이브레이커(타일 → 병력 → 누적 골드 → playerId)가 항상 유일한 승자를 만든다.

---

## 7. 클라이언트-서버 이벤트 초안

> **시야 전체 공개 (Fog of War 없음).** 서버는 **단일 스냅샷을 전원에게 그대로 브로드캐스트**한다. **깃발도, 진척도 게이지도, 기지 체력도 예외가 아니다** — 모든 플레이어의 모든 상태가 전원에게 공개된다. 플레이어별 가시성 필터링, 플레이어별 상태 직렬화 분기는 **존재하지 않는다.**
>
> **v3.0에서 이 원칙이 더 중요해졌다.** 진척도 게이지가 공개되지 않으면 방어자는 "지금 어디가 얼마나 밀리고 있는지"를 알 수 없고, 그러면 B항의 반격 모델이 성립하지 않는다. **게이지를 숨기면 이 설계는 그냥 랜덤 기습 게임이 된다.**
>
> 개인화가 필요한 메시지는 `개인`으로 표시한 5종(`welcome`, `cmd_ack`, `error`, `pong`, 접속 시 1회 `snapshot_full`)뿐이며 모두 게임 상태가 아니라 **연결 상태**에 관한 것이다.

### 7.1 연결·룸 생명주기 (v2.1 불변)

```
CONNECTING → CONNECTED → IN_LOBBY → COUNTDOWN → IN_GAME → GAME_OVER → (IN_LOBBY 재입장 | SPECTATING)
```

플레이어 상태: `LOBBY_WAITING` / `PLAYING` / `ELIMINATED_SPECTATING` / `DISCONNECTED`.

접속이 끊긴 플레이어는 **게임에서 제거하지 않는다.** 영토·병력·깃발·기지 체력은 그대로 두고 신규 발령만 중단된다. **행군 중이던 깃발은 계속 행군하고 도착하면 교전한다.** `DISCONNECT_GRACE = 90초` 내 재접속하면 그대로 복귀하고, 초과하면 봇 AI가 조종을 인계받는다(`bot_takeover`).

> **v3.0 주의**: 접속이 끊긴 플레이어는 **반격 깃발을 낼 수 없으므로 ρ = 0이 되어 3.00배 캐스케이드에 노출된다.** v2.1에서는 밀도 방어가 자동으로 작동해 접속 끊김의 대가가 작았다. 봇 인계(90초)의 중요성이 v3.0에서 크게 올라갔으므로, 봇은 **방어 판단을 최우선으로** 수행한다(8장).

### 7.2 클라이언트 → 서버

| 이벤트 | 페이로드 | 서버가 해야 할 일 |
|---|---|---|
| `hello` | `{ nickname, clientVersion }` | 프로토콜 버전 검증, `playerToken` 발급 |
| `lobby_join_public` | `{}` | 공개 대기열 배치. 빈 룸 없으면 생성 |
| `lobby_create_private` | `{ targetPlayers(8~12), timeLimitMin? }` | 6자리 룸 코드 생성, 호스트 지정 |
| `lobby_join_private` | `{ roomCode }` | 코드 검증, 정원/진행상태 확인 |
| `lobby_leave` | `{}` | 룸에서 제거, 호스트면 승계 |
| `lobby_set_ready` | `{ ready: bool }` | 준비 상태 갱신 → `room_state` 브로드캐스트 |
| `lobby_start_now` | `{}` | 호스트 전용. 남은 자리를 봇으로 채우고 즉시 카운트다운 |
| **`cmd_flag_issue`** | `{ clientSeq, unit: 0..2, troops: int, anchorTileId, originBaseTileId?: uint32\|null }` | 4.3절 전체 검증 → **앵커 소유자로 자세 결정**, 출발 기지 결정, 슬롯 배정, 풀 차감, 거리장 생성. **반드시 `cmd_ack`**<br>**v3.0: 스키마는 v2.1과 동일하다.** 자세는 서버가 `tile[anchorTileId].owner == p.id`로 파생하므로 필드를 추가하지 않는다 |
| **`cmd_flag_retarget`** | `{ clientSeq, flagId, anchorTileId }` | 4.4절 검증 → 앵커·목표·**자세** 교체, `lockUntilTick` 설정, `progressMilli = 0`, 거리장 재생성 |
| `cmd_flag_recall` | `{ clientSeq, flagId }` | `state = RETURNING`. 도착 시 85% 환불 |
| `cmd_buy_tech` | `{ clientSeq, axis: 0..3, tier: 1..3 }` | 선행 단계·골드·누진비용 검증 → 즉시 적용. **기동 축 구매 시 `flagCap` 즉시 재계산** |
| `cmd_ally_propose` | `{ clientSeq, targetPlayerId }` | 동맹 수 상한, cutoff/freeze 검증 → 제안 생성 |
| `cmd_ally_respond` | `{ clientSeq, proposalId, accept }` | 성립/거절 처리. **성립 시 상대를 향한 양측 깃발을 IDLE 전환 + 게이지 0** |
| `cmd_ally_break` | `{ clientSeq, allyPlayerId }` | 최소 유지시간 검증 → `BREAKING` 전환 |
| `emote` | `{ code }` | 프리셋 코드만 허용. 전원 브로드캐스트 |
| `ping` | `{ clientTime }` | `pong` 즉시 회신 |

> **v3.0에서 클라이언트 → 서버 스키마는 한 글자도 바뀌지 않았다.** 방어라는 새 기능을 추가하면서 새 메시지도 새 필드도 만들지 않았다 — design-decisions B항의 "명령 종류를 늘리지 않는다"가 프로토콜 수준에서 지켜졌다는 뜻이다. 백엔드가 v2.1에서 이어서 구현할 때 **입력 경로는 그대로 재사용**하면 된다.

`clientSeq`는 클라이언트가 붙이는 단조증가 정수다. 모든 `cmd_*`는 **반드시** `cmd_ack`로 수락/거절이 회신되어야 한다. 클라이언트는 낙관적 예측을 하지 않고 `cmd_ack` + 다음 스냅샷으로만 UI를 갱신한다.

**거절 사유 코드**: `ELIMINATED` `NO_SLOT` `BAD_UNIT` `WATER` `ALLIED` `OUT_OF_RANGE` `TOO_SMALL` `INSUFFICIENT` `NO_FLAG` `RETURNING` `LOCKED` `NOT_BASE` `NOT_OWNED_BASE`.
**v3.0에서 제거**: `SELF` (내 타일 앵커 = 방어 발령이므로 더 이상 오류가 아니다).

### 7.3 서버 → 클라이언트

| 이벤트 | 대상 | 페이로드 / 동기화하는 것 |
|---|---|---|
| `welcome` | 개인 | `{ playerId, playerToken, serverTick, protocolVersion, tickMs }` |
| `room_state` | 룸 | `{ roomId, roomCode, phase, hostId, targetPlayers, players:[...], countdownMs }` |
| `match_config` | 룸 | 매치 시작 시 1회. `{ seed, width, height, totalLandTiles, tickMs, hardTimeoutTick, thresholdCurve, techTable, costConstants, terrainTable, flagConstants, unitTable, endgameRush:{tick,costMult}, `**`defenseConstants`**`, `**`baseHpConstants`**`, `**`supplyConstants`**` }` — **밸런스 상수 전체를 내려보내 클라이언트가 예상 진척률·손익분기·행군 ETA를 서버와 동일하게 계산**하게 한다. v3.0에서 이것이 **필수**가 된 이유는 아래 7.6절 |
| `map_init` | 룸 | `{ terrain: RLE(uint8[]), spawns:[{playerId, tileId, homeTileId}], bases:[tileId,...] }` — 지형·기지 위치는 불변이므로 1회 |
| `snapshot_full` | 룸/개인 | `{ tick, owners: RLE(uint8[]), players:[{id,tiles,troops,gold,goldWeight,upkeepPm,tech:[4],flagCap,alive,connected}], flags:[{id,ownerId,slotIndex,unit,`**`posture`**`,troops,posTileId,anchorTileId,targetOwnerId,state,`**`targetTileId`**`,`**`progressPct`**`,`**`stalled`**`}], `**`bases:[{tileId,ownerId,hpPct}]`**`, alliances:[...], thresholdPct, ticksRemaining, endgameRushActive }` — 접속·재접속 시 개인 전송, 그 외 **25 tick(5초)마다 전원 브로드캐스트** |
| `snapshot_delta` | 룸 | `{ tick, tileChanges:[[tileId,ownerId],...], playerDeltas:[...], flagMoves:[[flagId,posTileId],...], flagStats:[[flagId,troops,state]...], `**`flagProgress:[[flagId,progressPct]...]`**`, `**`flagTargets:[[flagId,targetTileId]...]`**`, `**`baseHp:[[tileId,hpPct]...]`**`, flagsGone:[flagId,...], thresholdPct? }` — **매 tick(200ms)**. 상세는 7.5절 |
| `cmd_ack` | 개인 | `{ clientSeq, accepted, reason?, flagId?, `**`posture?`**` }` — 발령 성공 시 배정된 `flagId`와 **서버가 파생한 동작 분기값**을 회신. 클라이언트는 이 값을 렌더 분기에만 쓰고 **플레이어에게 "자세"라는 이름으로 표시하지 않는다**(A-5) |
| `flag_issued` | 룸 | `{ tick, flagId, playerId, slotIndex, unit, `**`posture`**`, troops, originTileId, anchorTileId, targetOwnerId, etaTick }` |
| `flag_retargeted` | 룸 | `{ tick, flagId, anchorTileId, targetOwnerId, `**`posture`**`, resumeTick, etaTick, auto: bool }` |
| `flag_engaged` | 룸 | `{ tick, flagId, `**`posture`**`, frontTileCount \| guardTileCount }` — 교전/주둔 개시 |
| **`flag_stalled`** ⟵ v3.0 | 룸 | `{ tick, flagId, tileId }` — **게이지가 0에서 5초 이상 정체.** "이 깃발은 벽에 부딪혔다"는 알림 트리거 (4.7(f)) |
| **`flag_progress_lost`** ⟵ v3.0 | 룸 | `{ tick, flagId, tileId, cause: "captured_by_other"\|"target_lost" }` — 게이지 무효화 연출 |
| `flag_idle` | 룸 | `{ tick, flagId, reason: "front_cleared"\|"guard_lost"\|"unreachable"\|"allied", autoRecallTick }` |
| `flag_ended` | 룸 | `{ tick, flagId, reason: "exhausted"\|"recalled"\|"attrited"\|"eliminated", refunded }` |
| **`base_captured`** ⟵ v3.0 | 룸 | `{ tick, tileId, fromPlayerId, toPlayerId, newHpPct: 50 }` — 화면 연출 + 사운드 트리거. **세션당 10~25회 발생하는 주요 이벤트** |
| `tech_purchased` | 룸 | `{ tick, playerId, axis, tier, cost, newFlagCap }` |
| `ally_proposed` / `ally_formed` / `ally_break_started` / `ally_broken` / `alliance_lockout` | 룸 | v2.1과 동일 |
| `threshold_update` | 룸 | `{ tick, thresholdPct }` — 22분 이후 분당 1회만 |
| `endgame_rush` | 룸 | `{ tick, costMult }` — 37분 1회. 화면 전체 연출 트리거 |
| `player_eliminated` | 룸 | `{ tick, playerId, byPlayerId\|null }` |
| `bot_takeover` / `player_reconnected` | 룸 | `{ tick, playerId }` |
| `emote_broadcast` | 룸 | `{ tick, playerId, code }` |
| `game_over` | 룸 | `{ finalTick, winnerId\|null, reason, standings:[...] }` |
| `error` / `pong` | 개인 | `{ code, message }` / `{ clientTime, serverTime, tick }` |

**v3.0 프로토콜 델타 요약 (백엔드가 v2.1 구현에서 이어갈 때 손댈 곳)**

| 방향 | 변경 |
|---|---|
| C→S | **없음** |
| S→C 신규 이벤트 | `flag_stalled`, `flag_progress_lost`, `base_captured` |
| S→C 신규 필드 | flag에 `posture` / `targetTileId` / `progressPct` / `stalled`, snapshot에 `bases[]`, delta에 `flagProgress` / `flagTargets` / `baseHp`, **player에 `upkeepPm`(v3.1)** |
| S→C 제거 | 없음 (v2.1 필드 전부 유지) |
| `match_config` | `defenseConstants`, `baseHpConstants`, `supplyConstants`, **`upkeepConstants`(v3.1: `GARRISON_UPKEEP_PERMILLE` / `_FREE_PERMILLE` / `_MAX_PERMILLE` / `UNIT_GARRISON_PERMILLE` / `GARRISON_ESCALATE_TICK`)** 추가 |

### 7.4 tick 처리 순서 (결정론 보증 — 백엔드 필수 준수)

```
onTick(t):
  1. 입력 큐 드레인
       tick 경계 이전 도착분만 처리. (수신 시각, connectionId, clientSeq) 3중 정렬.
  2. 자원 생산   — playerId 오름차순. 병력(√tiles) / 골드(goldWeight)          (3.2 / 3.3)
                   골드는 **그로스 산출 → 주둔 유지비 차감 → 순증 반영** 순.  (4.4)
                   유지비는 9단계에서 갱신된 f.calmTicks / isGarrison 을 읽는다
                   (= 직전 tick 종료 시점의 주둔 상태. 1 tick 지연은 의도된 고정 규칙)
  3. 외교 타이머 — 제안 만료, BREAKING→BROKEN, freeze 해제, lockout 카운트다운  (6.2)
  4. 깃발 이동   — flagId 오름차순. 전진, 노출 소모,
                   MARCHING→ENGAGED 도착 판정, RETURNING 완료 처리              (4.4)
                   ※ v3.1: 주둔 유지비는 이 단계에서 빠졌다(2단계 골드로 이동)
  5. AP 예산 누적 — flagId 오름차순. ENGAGED 깃발만. **이후 6·7단계 내내 동결**  (4.6a)
  6. 전투 Phase A — 밀기 산출 + 방어 배분. **게임 상태 쓰기 절대 금지**          (4.7b)
  7. 전투 Phase B — 진척도/기지 체력 적용, 소유권 이전, 병력 차감. tileId 오름차순 (4.7b / 4.10 / 4.12)
  8. 기지 체력 회복 — tileId 오름차순. 이번 tick 피해가 없고 지연 경과한 기지만   (4.12)
  9. 파생 상태   — tiles / goldWeight 는 7에서 증분 갱신 완료. 점유율 재계산
                   flagId 오름차순으로 f.calmTicks 갱신(무위협 누진)             (4.4d)
 10. 깃발 종료 판정 — 소진/전선 소멸/guard 소멸/중립 자동 전환/IDLE 타임아웃      (4.11b)
 11. 봇 AI      — t % 15 == 0 인 tick에만, botIndex 오름차순                     (8장)
 12. 탈락 판정                                                                    (4.14)
 13. 승리 판정                                                                    (6.1)
 14. 브로드캐스트 — snapshot_delta (+ t % 25 == 0 이면 snapshot_full)
```

**v2.1과 달라진 두 곳**:
- **5단계**가 v2.1의 "방어 밀도 캐시"에서 **"AP 예산 누적"** 으로 교체됐다. 역할은 같다 — *Phase A/B가 읽을 값을 미리 동결한다*.
- **8단계(기지 체력 회복)** 가 신설됐다. Phase B 다음에 오는 이유는 "이번 tick에 맞았으면 회복하지 않는다"를 판정하려면 피해 적용이 끝나야 하기 때문이다.

**절대 규칙 3개는 4.9절에 있다.** 백엔드는 그 절을 tick 루프 구현 전에 반드시 읽는다.

### 7.5 대역폭 설계 (v3.0 재검산)

**(1) `snapshot_full` — 5초마다 전체.**

| 항목 | 크기 | 비고 |
|---|---|---|
| `owners` RLE | 1~4 KB | 변화 없음 |
| `players` (12명) | 0.6 KB | 변화 없음 |
| `flags` (84개 × 약 100 B) | **8.4 KB** | v2.1 7.6 KB + `posture`/`targetTileId`/`progressPct`/`stalled` |
| **`bases` (24개 × 약 22 B)** ⟵ v3.0 | **0.5 KB** | `{tileId, ownerId, hpPct}` |
| **소계** | **약 13 KB / 5초** | = **2.6 KB/s** (v2.1: 2.4) |

**(2) `snapshot_delta` — 매 tick, 변한 것만.**

```
flagMoves    : [[flagId, posTileId], ...]        // posTileId 가 바뀐 깃발만 (평균 3.6개)
flagStats    : [[flagId, troops, state], ...]    // 병력·상태 변화 (5 tick 주기로 스로틀)
flagProgress : [[flagId, progressPct], ...]      // ⟵ v3.0. ATTACK 자세 ENGAGED 깃발만
flagTargets  : [[flagId, targetTileId], ...]     // ⟵ v3.0. 타깃이 바뀐 깃발만 (드묾)
baseHp       : [[tileId, hpPct], ...]            // ⟵ v3.0. hpPct 가 바뀐 기지만
flagsGone    : [flagId, ...]
tileChanges  : [[tileId, ownerId], ...]
playerDeltas : [{id, tiles, troops, gold, goldWeight, upkeepPm}, ...]
               // upkeepPm = 4.4절 drainPm(p). HUD가 "골드 −45%" 를 표시하는 근거.  ⟵ v3.1
               // 전원 공개 필드다(7장 시야 전체 공개 원칙). 값은 0~700 정수 permille
```

**`progressPct`를 0..100 정수로 양자화한다.** 서버 내부는 `progressMilli`(0..999)이지만 전송은 백분율이면 충분하다 — 클라이언트는 그라데이션을 그리는 데만 쓰고, **판정 권위는 100% 서버에 있다.** 이것이 대역폭을 3분의 1로 줄인다(`[123,857]` → `[123,86]`).

**빈도 검산**:
- **ATTACK 자세 ENGAGED 깃발**: 룸 전체 깃발 평균 30개 중 교전 중 약 20개, 그중 ATTACK 자세 약 14개(방어 40% 가정). → `flagProgress` **평균 14개/tick**.
- **`flagTargets`**: 타깃 타일이 바뀌는 것은 타일을 하나 먹을 때뿐. 중반 룸 전체 점령률 약 2.5타일/tick → **평균 2.5개/tick**.
- **`baseHp`**: 기지 24개 중 공격받거나 회복 중인 것 평균 3~5개. **5 tick 주기로 스로틀** → 평균 0.8개/tick.

| 항목 | 개수/tick | tick당 크기 | 초당 |
|---|---|---|---|
| `tileChanges` (평균 2.5) | 2.5 | 40 B | 0.20 KB/s |
| `flagMoves` (평균 3.6) | 3.6 | 55 B | 0.28 KB/s |
| `flagStats` (5 tick 스로틀) | 4 | 52 B | 0.26 KB/s |
| **`flagProgress`** ⟵ v3.0 | 14 | **140 B** | **0.70 KB/s** |
| **`flagTargets`** ⟵ v3.0 | 2.5 | **30 B** | **0.15 KB/s** |
| **`baseHp`** ⟵ v3.0 | 0.8 | **12 B** | **0.06 KB/s** |
| `playerDeltas` (5 tick 스로틀) | 12 | 96 B | 0.48 KB/s |
| **`snapshot_delta` 소계** | | **약 425 B** | **약 2.13 KB/s** |

**최종 대역폭 추정**:

| 메시지 | 초당 | v2.1 |
|---|---|---|
| `map_init` (RLE) | 1회 2~4 KB | 동일 |
| `snapshot_full` | **2.6 KB/s** | 2.4 |
| `snapshot_delta` | **2.1 KB/s** | 2.3 |
| 이벤트 메시지 (`flag_*`, `base_captured`, `ally_*`) | **0.3 KB/s** | 0.2 |
| **합계 / 클라이언트** | **약 5.0 KB/s** | **4.9** |
| **12인 룸 총 송신** | **약 60 KB/s** | 59 |

> **결론: v3.0의 대역폭 증가는 사실상 0이다 (4.9 → 5.0 KB/s, +2%).**
>
> 이유는 두 가지다. **(a) design-decisions C항의 "진척도는 깃발 단위 상태"라는 결정이 정확히 이 결과를 만들었다** — 타일별 진척도였다면 최악의 경우 tick당 수백 개 타일의 게이지를 보내야 해서 대역폭이 몇 배가 됐을 것이다. **(b) `flagStats`/`playerDeltas`를 5 tick으로 스로틀한 v2.1의 최적화가 새 필드를 흡수할 여유를 남겨두었다.** 기지 체력은 최대 24개라는 상한 덕에 애초에 비용이 없다.

전송은 JSON으로 시작하고, 프로파일링 후 `owners` / `tileChanges` / `flagMoves` / `flagProgress`만 바이너리(ArrayBuffer)로 교체하는 것을 권장한다. 바이너리 전환 시 `flagProgress` 항목은 `uint16 flagId + uint8 pct = 3 B`가 되어 140 B → 42 B로 줄어든다.

### 7.6 클라이언트가 서버 상수를 알아야 하는 이유 (v3.0에서 필수가 됨)

v2.1에서 `match_config`로 상수 전체를 내려보내는 것은 **편의**였다(예상 점령비용·ETA 표시). v3.0에서는 **UX의 전제조건**이다.

| 클라이언트가 보여줘야 하는 것 | 필요한 상수 |
|---|---|
| 방어 원 안에서 "지금 밀리고 있는가 버티고 있는가" | `DEFENSE_LEVERAGE`, `UNIT_DEF_PUSH`, `defRefCost` 계산에 필요한 `ENEMY_BASE`/`TERRAIN_COST_MULT`/`ADJACENCY_COEF` |
| 발령 전 "이 병력이면 뚫리는가" 미리보기 | 4.7(d) 손익분기표 전체 |
| 게이지 그라데이션 보간 | `FLAG_SPEND_RATE`, `FLAG_MAX_PROGRESS`, `UNIT_ASSAULT` |
| 기지 체력 바 + 회복 예상 | `BASE_HP_*` 전체 |
| 원거리 침투 경고 | `SUPPLY_*` 전체 |

**서버 권위는 그대로다.** 클라이언트는 이 상수로 **예측만** 하고, 실제 값은 언제나 `snapshot_delta`의 `progressPct` / `baseHp`로 덮어쓴다. 낙관적 예측 후 롤백하는 코드는 여전히 존재하지 않는다.

**보간 규칙 (프론트엔드 협의 필수)**: `progressPct`는 매 tick 오므로 보간이 거의 필요 없다(200ms 간격). 다만 **게이지가 뒤로 가는 경우(되돌리기)를 시각적으로 구분**해야 한다 — 전진은 부드럽게 차오르고, 후퇴는 짧은 플래시와 함께 줄어드는 식으로 다르게 그린다. 그렇지 않으면 플레이어가 "내 반격이 먹히고 있다"를 읽지 못한다.

---

## 8. 봇 AI (v3.0 재작성 — 방어 판단 도입)

RNG를 쓰지 않는다. 모든 분기가 게임 상태의 결정론적 함수다(리플레이·디버깅 가능). v1.0의 "가장 약한 인접 영토를 공격" 철학은 유지하되, **v3.0에서 봇은 반드시 방어를 판단해야 한다** — 그러지 않으면 ρ = 0이 되어 3.00배 캐스케이드로 즉사하고, 인간 플레이어에게 봇은 그냥 공짜 영토가 된다.

### 8.1 위협 신호 — `defDensity`의 대체

v2.1 봇의 방어 판단은 `defDensity(p) < BOT_PANIC_DENSITY(2.0)` 하나였다. 밀도가 사라졌으므로 **실제 게이지를 읽는 신호**로 교체한다.

```
// 매 결정 tick, 읽기 전용. Phase A 산출물이 아니라 확정된 깃발 상태에서 읽는다
threatMilli(p) = Σ over 적 ATTACK 깃발 f where tile[f.targetTileId].owner == p.id
                 of ( f.progressMilli + advanceRateOf(f) * BOT_THREAT_LOOKAHEAD )
               + Σ over 내 기지 b where (t - b.lastDamageTick) < 25
                 of ( (BASE_HP_MAX_MILLI - b.hpMilli) * BOT_BASE_THREAT_W / 1000 )

threatAt(p, tileId) = 위 합을 tileId 중심 반경 FRONT_RADIUS 디스크로 제한한 값

BOT_THREAT_LOOKAHEAD = 25       // 5초 앞을 본다
BOT_BASE_THREAT_W    = 3        // 기지 손상은 일반 진척도의 3배 가중
BOT_THREAT_TRIGGER   = 3000     // 이 값을 넘으면 방어 깃발을 낸다 (= 게이지 3칸 상당)
```

**이 신호가 밀도보다 나은 점**: 밀도는 "지금 내가 약한가"였고 위치 정보가 없었다. `threatAt`은 **"어디가 뚫리고 있는가"**를 직접 준다 — 봇이 방어 앵커를 고를 수 있다. 그리고 `BOT_THREAT_LOOKAHEAD`가 있어 **게이지가 다 차기 전에 반응**한다.

### 8.2 결정 루프

```
BOT_DECISION_INTERVAL = 15 tick (3초)

onBotTick(bot):                             // botIndex 오름차순으로 순회
  p = bot
  reserve = floor(troopCap(p) * BOT_RESERVE_RATIO)      // 0.30 — 반격 탄약으로 남길 병력

  // ═══ 1) 방어 우선 정비 (v3.0 최우선. 공격보다 먼저) ═══
  hotspots = 내 영토를 threatAt 내림차순으로 스캔한 상위 구간
             (같은 구간 중복 방지: 이미 내 DEFEND 깃발 디스크가 덮는 곳 제외)
  for h in hotspots where h.threat >= BOT_THREAT_TRIGGER:
     if 빈 슬롯 있음:
          q = clamp( floor(p.troops * BOT_DEFEND_COMMIT), FLAG_MIN_TROOPS, p.troops )
          issueFlag(p, SPEAR, q, h.tileId)              // 방어는 항상 창병 (4.11절)
     else:
          // 슬롯이 꽉 찼다 → 가장 가치 낮은 공격 깃발을 방어로 돌린다
          victim = argmin over p.flags where posture == ATTACK
                     of ( expectedGain(f), f.id )
          if victim != null and h.threat >= BOT_THREAT_TRIGGER * BOT_PREEMPT_FACTOR:
               retarget(victim, h.tileId)               // 자동으로 posture = DEFEND
     break                                              // 결정 tick 당 방어 전환은 1회만

  // ═══ 2) 기존 깃발 정비 ═══
  for f in p.flags sorted by f.id ASC:
     if f.state == IDLE:
          a = bestAnchor(p)
          if a != null: retarget(f, a.tileId) else: recall(f)
     if f.posture == ATTACK and f.stalled:               // ⟵ v3.0. 벽에 부딪혔다
          a = bestAnchor(p)
          if a != null and a.score > currentScore(f) * BOT_STALL_SWITCH: retarget(f, a.tileId)
          else: recall(f)                                // 물릴 곳도 없으면 회수(85% 환불)
     if f.posture == ATTACK and f.state == ENGAGED and |front(f)| < 2:
          a = bestAnchor(p)
          if a != null: retarget(f, a.tileId)
     if f.posture == DEFEND and threatAt(p, f.anchorTileId) == 0
        and (t - f.engagedSinceTick) > BOT_GARRISON_PATIENCE (=900, 3분):
          recall(f)                                      // 주둔 유지비 낭비 방지

  // ═══ 3) 빈 슬롯 채우기 (공격) ═══
  while p.flags.length < flagCap(p):
     if p.troops - reserve < FLAG_MIN_TROOPS: break
     if 방어 슬롯 비중 < BOT_MIN_DEFENSE_RATIO(0.25) and 내 국경에 적이 있음:
          // 최소 방어선 확보 — 위협이 없어도 창병 하나는 세운다
          h = argmax over 내 국경 구간 of ( 인접 적 수, tileId )
          issueFlag(p, SPEAR, clamp(...), h.tileId); continue
     a = bestAnchor(p)
     if a == null: break
     unit = chooseUnit(p, a)
     q    = clamp( floor(p.troops * BOT_COMMIT_RATIO[a.kind]), FLAG_MIN_TROOPS, p.troops - reserve )
     issueFlag(p, unit, q, a.tileId)
```

### 8.3 앵커 선택 (공격) — 밀도 항 교체

```
function bestAnchor(p):
   candidates = { o : o 가 p 의 국경에 닿아 있음 }   // NEUTRAL 포함
   candidates -= { 동맹, BREAKING 쿨다운 중인 상대 }
   candidates -= { 이미 p 의 깃발 2개 이상이 목표로 삼은 소유자 }
   best = null
   for o in candidates sorted by ownerId ASC:
      border   = { t : tile[t].owner == o, ∃ neighbor 가 p 소유 }
      anchor_o = argmin over border of ( tileCost(p, t) , t )
      mass     = |{ t : distance(t, anchor_o) <= FRONT_RADIUS, tile[t].owner == o }|
      cost     = tileCost(p, anchor_o)
      march    = distance(originFor(p, anchor_o), anchor_o)
      guardN   = |{ 적 DEFEND 깃발 d : d.ownerId == o, anchor_o ∈ guard(d) }|   // ⟵ v3.0

      score = mass * 1000 / ( cost * (10 + march) * (1 + BOT_GUARD_PENALTY * guardN) )
      if o == NEUTRAL:
           score = score * (t < BOT_NEUTRAL_BIAS_TICK ? 160 : 100) / 100
      else:
           if o == 인접 플레이어 중 타일 수 최소:   score = score * 130 / 100
           if players[o].tiles > p.tiles * 3 / 2:   score = score *  60 / 100
           if players[o].flags 중 DEFEND 자세가 0개: score = score * 170 / 100   // ⟵ v3.0
                                                     // 무방비 상대 집중 = 캐스케이드 진입
           if isBase[anchor_o] and base(anchor_o).hpMilli < BASE_HP_MAX_MILLI / 2:
                                                     score = score * 140 / 100   // ⟵ v3.0
                                                     // 반쯤 깎인 기지는 싸다
      if score > best.score or (score == best.score and o < best.owner):
           best = { tileId: anchor_o, owner: o, kind: (o==NEUTRAL ? 0 : 1), score }
   return best

BOT_GUARD_PENALTY = 2          // 적 방어 깃발 1개당 점수 1/3
```

**v2.1에서 바뀐 세 줄**: `defDensity(o) < 3.0 → ×1.50`이 **`players[o]의 DEFEND 깃발이 0개 → ×1.70`** 으로 교체됐다. 의미가 같다(무너진 상대에게 집중) 하지만 v3.0에서는 **관측 가능한 상태**를 읽는다. 그리고 `guardN`(적 방어 깃발이 이 구간을 덮는가)과 기지 체력 항이 새로 들어갔다.

### 8.4 병종 선택 — 자세별로 분기

```
function chooseUnit(p, a):
   // 방어 발령은 8.2절에서 이미 SPEAR 고정. 여기는 공격 전용
   if a.kind == NEUTRAL:                             return CAVALRY   // 빈 땅 선점은 속도 싸움
   if isBase[a.tileId]:                              return CAVALRY   // 기지 탈취는 속도가 전부
   if distance(originFor(p, a.tileId), a.tileId) > 12: return CAVALRY // 먼 전선
   if guardCountAt(a.tileId) >= 1:                   return SWORD     // 방어선 돌파는 지구력
   if players[a.owner] 의 DEFEND 깃발이 0개:          return CAVALRY   // 무방비 흡수
   return SWORD

BOT_RESERVE_RATIO      = 0.30
BOT_DEFEND_COMMIT      = 0.40      // 방어 깃발에 싣는 풀 비율
BOT_COMMIT_RATIO       = { NEUTRAL: 0.45, ENEMY: 0.35 }
BOT_MIN_DEFENSE_RATIO  = 0.25      // 슬롯의 최소 25%는 방어에
BOT_PREEMPT_FACTOR     = 1.6       // 공격 깃발을 방어로 뺏어오는 임계 배수
BOT_STALL_SWITCH       = 1.30      // 정체 시 갈아탈 최소 점수 비율
BOT_GARRISON_PATIENCE  = 900       // 3분간 위협 없으면 주둔 해제
```

**창병을 공격에 쓰지 않는다.** 4.7(d)에서 창병 공격 손익분기가 1.345로 최악이므로 봇은 창병을 방어 전용으로만 편성한다. 이것이 봇 플레이를 통해 인간 플레이어에게 **역할 분화를 시연**하는 효과도 낸다.

### 8.5 v2.1 대비 변경 요약

| | v2.1 | **v3.0** |
|---|---|---|
| 방어 개념 | `defDensity < 2.0`이면 행군 중 깃발 회수 | **`threatAt` 기반으로 방어 깃발을 발령/전환.** 결정 루프의 1순위 |
| 방어 병종 | 없음(밀도가 자동) | **항상 창병** |
| 최소 방어선 | 없음 | 슬롯의 25% 이상을 방어에 (`BOT_MIN_DEFENSE_RATIO`) |
| 정체 대응 | 없음 | `f.stalled`를 읽고 갈아타거나 회수 |
| 앵커 점수 | 밀도 항 | 적 DEFEND 깃발 유무 + `guardN` 페널티 + 기지 체력 |
| 기지 인식 | 출발지로만 | **목표로도.** 반쯤 깎인 기지 우선 |
| 주둔 관리 | 없음 | 3분간 위협 없으면 회수 (유지비 절약) |

**테크 우선순위** (매 결정 tick, 첫 미구매 항목을 살 수 있으면 즉시 구매):

```
priority = TECH_PRIORITY[bot.botIndex % 4]
  0 (확장형): [영토T1, 경제T1, 기동T1, 영토T2, 군사T1, 군사T2]
  1 (경제형): [경제T1, 경제T2, 영토T1, 기동T1, 경제T3, 군사T1]
  2 (수비형): [군사T1, 기동T2, 영토T1, 군사T2, 경제T1, 군사T3]     // ⟵ v3.0 재배열
  3 (기동형): [기동T1, 기동T2, 군사T1, 경제T1, 기동T3, 군사T2]
```

**수비형(2번)을 재배열한 이유**: v2.1의 수비형은 `영토T1 → 영토T2`(중립 비용·`troopCap`)로 시작했는데, v3.0에서 방어에 실제로 기여하는 것은 **군사 축(`defCostMult`로 `defRefCost`를 올려 되돌리기 효율 증가)** 과 **기동 T2(슬롯 +1 = 방어 구간 +1)** 다. 3.4절의 축 재해석을 봇 빌드에 반영했다.

**기동형 봇(3번)** 은 T2에서 슬롯이 +1 되므로 초반부터 4개를 굴린다. 사람 플레이어에게 "기동 축이 뭘 하는 축인지"를 보여주는 시연 역할을 겸한다.

**외교** (v1.0 유지):

```
제안 수신 시: 제안자 타일 수 >= 내 타일 수 * 1.2  AND  내 동맹 < 2  → 수락, 아니면 거절
봇은 먼저 제안하지 않는다.
파기: (내 타일 >= 동맹 타일 * 2.0) AND (t > 7500 tick, 25분) AND (최소 유지시간 경과) → 파기
```

**난이도 조절**: `BOT_DECISION_INTERVAL`(15 → 30이면 약해짐), `BOT_RESERVE_RATIO`(높을수록 소극적), `BOT_MIN_DEFENSE_RATIO`(0이면 방어를 안 해서 매우 약해짐), `chooseUnit`을 항상 `SWORD` 반환으로 고정(초보 난이도) — 네 레버만 쓴다.

**인원 충원 규칙**: 공개 로비는 카운트다운 종료 시점에 `targetPlayers`(기본 10)까지 봇으로 채운다. 비공개 룸은 호스트가 `lobby_start_now`를 누른 시점에 채우며, 최소 인간 1명이면 시작 가능하다.

---

## 부록 A. 밸런스 상수 전체 표 (백엔드 단일 소스 — v3.0 전면 갱신)

> 백엔드는 이 표를 `shared/constants.ts` 로 뽑고 `match_config` 로 클라이언트에 내려보낸다.
> **모든 배율은 permille 정수로 구현한다** (`1.15` → `1150`). 아래는 가독성을 위한 십진 표기다.
> `⟵ v3.0` 표시는 v2.1에서 값이 바뀌었거나 신설된 것, `✗ v3.0 삭제` 는 폐기된 것이다.

```ts
// ══ 시간 ══
TICK_MS                  = 200          // 초당 5 tick
TICKS_PER_MIN            = 300
ENDGAME_RUSH_TICK        = 11100        // 37분
ENDGAME_RUSH_COST_MULT   = 0.75         // 이후 tileCost × 0.75 (defRefCost 에는 적용 안 함)
HARD_TIMEOUT_TICK        = 12600        // 42분
SNAPSHOT_FULL_INTERVAL   = 25           // 5초
PLAYER_DELTA_INTERVAL    = 5            // 1초. troops/gold/flagStats 는 이 주기로만 델타
BASE_HP_DELTA_INTERVAL   = 5            // 1초                                     ⟵ v3.0
DISCONNECT_GRACE_TICK    = 450          // 90초

// ══ 맵 ══ (v2.1 불변)
LAND_TILES_PER_PLAYER    = 390
TARGET_LAND_RATIO        = 0.65         // 허용 0.60~0.70
CA_INIT_LAND_P           = 0.55
CA_SMOOTH_STEPS          = 4
CA_LAND_NEIGHBOR_MIN     = 5            // 8방향 기준
SPAWN_BLOCK              = 3            // 3×3
MAP_SIZE                 = { 8:[90,54], 9:[95,57], 10:[100,60], 11:[104,63], 12:[108,66] }

// ══ 지형 5종 ══ (v2.0 불변)
TERRAIN = { WATER:0, PLAIN:1, FERTILE:2, HILLS:3, DESERT:4, MOUNTAIN:5 }
TERRAIN_SHARE      = { PLAIN:0.39, FERTILE:0.15, HILLS:0.16, DESERT:0.22, MOUNTAIN:0.08 }
TERRAIN_COST_MULT  = { PLAIN:1.00, FERTILE:1.15, HILLS:1.30, DESERT:0.80, MOUNTAIN:1.70 }
TERRAIN_GOLD_MILLI = { PLAIN:1000, FERTILE:2300, HILLS: 900, DESERT: 300, MOUNTAIN: 250 }
TERRAIN_MOVE_MULT  = { PLAIN:1.00, FERTILE:1.00, HILLS:1.25, DESERT:1.10, MOUNTAIN:1.80 }
//  검산: 비용 가중평균 1.0825 (산 우회 반영 실효 1.0514) / 골드 가중평균 0.965
TERRAIN_GEN = {
  MOUNTAIN_BLOB_P: 0.42, MOUNTAIN_BLOB_STEPS: 3,
  FERTILE_BLOB_P:  0.45, FERTILE_BLOB_STEPS:  2, FERTILE_WATER_DIST: [1,2],
  DESERT_BLOB_P:   0.46, DESERT_BLOB_STEPS:   3,
}

// ══ 기지 배치 ══ (v2.1 불변)
NEUTRAL_BASE_COUNT       = N            // = 플레이어 수. 총 기지 = 2N ≤ 24
BASE_MIN_WATER_DIST      = 2
BASE_MIN_CAPITAL_DIST    = 12
BASE_MAX_CAPITAL_DIST    = 24
BASE_MIN_SEP             = 12
BASE_CONTEST_W           = 3

// ══ 기지 체력 ══                                                          ⟵ v3.0 전면 신규
BASE_HP_MAX_MILLI        = 15000        // 만피 = 15 타일 상당의 작업량
BASE_HP_INIT_MILLI       = 15000        // 매치 시작 시 수도·중립 기지 모두 만피
BASE_HP_CAPTURE_MILLI    = 7500         // 점령 직후 = 만피의 50%  (사용자 확정 "50")
BASE_HP_REGEN_MILLI      = 17           // tick당 회복 (만피까지 2.94분)
BASE_REGEN_DELAY_TICK    = 50           // 마지막 피해로부터 10초 뒤 회복 시작
BASE_CAPTURE_LOCK_TICK   = 25           // 점령 직후 5초 피해 무효 (핑퐁 방지)
// 표시 체력(%) = floor(hpMilli * 100 / BASE_HP_MAX_MILLI)
// 피해/회복은 진척도와 같은 milli 단위. Δhp = -floor(AP * 1000 / tileCost)

// ══ 시작값 ══
START_TROOPS             = 150
START_GOLD               = 200

// ══ 병력 ══ (공식 불변, 의미 재정의 — 3.2절)
TROOP_CAP_BASE           = 100
TROOP_CAP_PER_TILE       = 12           // 의미: 방어 밀도 상한 → 동시 투사 총량 상한 ⟵ v3.0
REGEN_BASE               = 0.8
REGEN_SQRT_COEF          = 0.50

// ══ 골드 ══
GOLD_RATE_PERMILLE       = 1550
// goldMilliPerTick(p) = floor( p.goldWeight * 1550 * goldMult_permille / 1e9 )

// ══ 점령 비용 ══
NEUTRAL_BASE             = 9
NEUTRAL_SQRT_COEF        = 1.0          // × sqrt(공격자 타일 수)
ENEMY_BASE               = 16           // v2.1: 25 — 밀도항 제거 상쇄 (5.3b 역산)  ⟵ v3.0
ENEMY_DENSITY_COEF       = ✗ v3.0 삭제  // (v2.1: 3.0)
ADJACENCY_COEF           = 0.15         // 적 타일에만, 이웃 0~3 → 1.00~1.45
MIN_TILE_COST            = 4

// ══ 보급선 ══                                                            ⟵ v3.0 신규
SUPPLY_FREE_RADIUS       = 10           // 내 기지에서 이 거리까지는 무료
SUPPLY_COEF              = 0.02         // 초과 1타일당 +2%
SUPPLY_MAX_MULT          = 1.60         // 상한
SUPPLY_NO_BASE_DIST      = 40           // 기지가 0개면 이 거리로 간주 → 상한 고정

// ══ 깃발 ══
FLAG_CAP_BASE            = 3
FLAG_TILES_PER_SLOT      = 300
FLAG_CAP_HARD_MAX        = 7            // ★ 올리는 변경 금지. v3.0에서는 내리는 것도 재검산 필요
FLAG_MIN_TROOPS          = 40           // 발령 하한 + 소진 종료 임계
FLAG_SPEED_BASE_MILLI    = 120          // milli-타일/tick. 검병·평원·무테크 = 0.6 타일/초
FLAG_SPEND_RATE          = 0.015        // initialTroops 대비 AP/tick → 전 병력 소진 66.7 tick
FLAG_SPEND_BUDGET_CAP_TICKS = 25        // 예산 누적 상한 (5초분)
FLAG_TILE_RATE_BASE      = 2            // FLAG_MAX_PROGRESS = 1000 × 2 × UNIT_ASSAULT ⟵ 의미 재정의
FRONT_RADIUS             = 6            // 공격 front / 방어 guard 공통 디스크 반경
FRONT_MAX_RANGE          = 40           // 발령 시 내 영토에서 앵커까지 최대 거리
FLAG_ENGAGE_RANGE        = 1            // ATTACK 도착 판정
FLAG_RETARGET_LOCK_TICK  = 15           // 3초. 재지정 시 이동 정지 + 진척도 리셋
FLAG_RECALL_REFUND       = 0.85         // 회수 시 병력 환불률
FLAG_IDLE_TIMEOUT        = 600          // 2분 후 자동 회수
FLAG_EXPOSED_ATTRITION_BP = 5           // 비우호 영토 위 깃발, tick당 0.05% (≈3%/분)
FLAG_STALL_TICKS         = 25           // 5초 정체 → flag_stalled 알림           ⟵ v3.0
FLAG_GARRISON_UPKEEP_BP  = ✗ v3.1 삭제  // (v3.0: 4 — 병력 기준 주둔 유지비. A-1로 골드 교체)

// ══ 주둔 유지비 (골드) ══                                                     ⟵ v3.1 (A-1)
GARRISON_UPKEEP_PERMILLE      = 90      // 과금 가중치 1.000당 그로스 골드 수입의 9.0%/tick
GARRISON_UPKEEP_FREE_PERMILLE = 1000    // 가중치 1.000(검병 주둔 1개분)까지 면제
GARRISON_UPKEEP_MAX_PERMILLE  = 700     // 총 유지비 상한. < 1000 이므로 순증 ≥ 0 구조 보증
GARRISON_ESCALATE_TICK        = 900     // 3분 무위협마다 누진 1단계 (4.4d) — 현재 비활성
GARRISON_ESCALATE_MAX         = 1       // ⟵ 2026-08-12 사용자 기각. escalate(f) ≡ 1. 되살리려면 3

// ══ 병종 3종 ══
UNIT = { SPEAR:0, SWORD:1, CAVALRY:2 }
UNIT_SPEED        = { SPEAR:0.75, SWORD:1.00, CAVALRY:1.45 }   // 이동속도 배율
UNIT_ATK_MULT     = { SPEAR:1.15, SWORD:1.00, CAVALRY:0.85 }   // tileCost 배율 (낮을수록 강함)
UNIT_DEF_PUSH     = { SPEAR:1.30, SWORD:1.00, CAVALRY:0.55 }   // 되돌리기 효율          ⟵ v3.0
UNIT_GARRISON     = { SPEAR:0.60, SWORD:1.00, CAVALRY:1.60 }   // 골드 유지비 가중치      ⟵ v3.1 의미변경
                    // permille 표기: { SPEAR:600, SWORD:1000, CAVALRY:1600 }
UNIT_ASSAULT      = { SPEAR:0.70, SWORD:1.00, CAVALRY:1.40 }   // FLAG_MAX_PROGRESS 배율
UNIT_CONVERT      = { SPEAR:1.00, SWORD:1.00, CAVALRY:1.15 }   // 편성 시 풀 차감 배율
UNIT_DEF_MULT     = ✗ v3.0 삭제        // (v2.1: 1.50/1.00/0.60 — 본국 방어 기여)
UNIT_POWER        = ✗ v3.0 삭제        // (v2.1: 900/1000/1150 — 경매 낙찰 우선순위)
// 순 효율 검산: 기병 1.15(편성) × 0.85(점령) = 0.978 → 병력 대비 +2.2%.
//               나머지는 속도(+45%) / 되돌리기(−45%) / 주둔비(+60%) 의 트레이드로 정산된다.

// ══ 방어 (양방향 진척도) ══                                              ⟵ v3.0 전면 신규
DEFENSE_LEVERAGE_PERMILLE = 900         // 방어 AP 1점의 기본 되돌리기 효율
// undoPerAP(d,X) = floor(1000 × 900 × UNIT_DEF_PUSH[d.unit] / (1000 × defRefCost(X)))
// defRefCost(X)  = ceil(ENEMY_BASE × defCostMult(owner) × adj(X) × TERRAIN_COST_MULT[X])
//                  ※ 공격자의 UNIT_ATK_MULT / atkCostMult / supplyMult / endgameRush 는 제외
// 손익분기 A/D = DEFENSE_LEVERAGE × UNIT_DEF_PUSH[방어] × UNIT_ATK_MULT[공격] × atkCostMult
//                → 검vs검 0.900 / 검vs창 1.170 / 기vs창 0.995 (4.7d)

// ══ 전투 (폐기 상수) ══
DEFENDER_LOSS_RATIO      = ✗ v3.0 삭제  // (v2.1: 0.35) 반격 AP 로 이중 계상되므로
LOSER_ATTRITION_RATIO    = ✗ v3.0 삭제  // (v2.1: 0.50) 경매 소멸
LOSER_TO_DEFENDER_RATIO  = ✗ v3.0 삭제  // (v2.1: 0.25) 협공 압박은 슬롯 고갈이 대체
HOME_FLAG_DEF_RATIO      = ✗ v3.0 삭제  // (v2.1: 0.50) A항
HOME_FLAG_DEF_CAP        = ✗ v3.0 삭제  // (v2.1: 0.35) A항

// ══ 테크 ══
TECH_BASE_COST           = [450, 1100, 2600]
TECH_PROGRESSIVE_COEF    = 0.25         // × 이미 구매한 총 노드 수
MILITARY  = { atkCostMult:[0.93,0.86,0.78], defCostMult:[1.07,1.15,1.22] }
ECONOMY   = { goldMult:[1.25,1.55,1.90],    regenMult:[1.06,1.13,1.20] }
TERRITORY = { neutralCostMult:[0.88,0.76,0.62], capMult:[1.10,1.22,1.35] }
MOBILITY  = { flagSpeedMult:[1.45,1.72,2.00],
              flagSlotBonus:[0,1,2],
              convertEffMult:[1.08,1.15,1.22] }

// ══ 승리 ══
THRESHOLD_START_PCT      = 60
THRESHOLD_DECAY_START    = 6600         // 22분
THRESHOLD_DECAY_PER_MIN  = 1.2          // %p
THRESHOLD_FLOOR_PCT      = 45           // 34.5분에 도달 = 실질 하한을 구조적으로 고정

// ══ 동맹 ══ (v1.0 이래 불변)
MAX_ALLIES_PER_PLAYER    = 2
PROPOSAL_TTL_TICK        = 150          // 30초
ALLIANCE_MIN_DURATION    = 300          // 60초
BACKSTAB_COOLDOWN_TICK   = 150          // 30초 = 방어 깃발 2개를 세울 수 있는 시간
ALLIANCE_CUTOFF_TICK     = 11100        // 37분 = ENDGAME_RUSH_TICK
LOCKOUT_COUNTDOWN_TICK   = 150          // 30초
LOCKOUT_FREEZE_TICK      = 300          // 60초

// ══ 봇 ══                                                                ⟵ v3.0 갱신
BOT_DECISION_INTERVAL    = 15           // 3초
BOT_RESERVE_RATIO        = 0.30         // troopCap 대비 항상 남기는 반격 탄약
BOT_COMMIT_RATIO         = { NEUTRAL: 0.45, ENEMY: 0.35 }
BOT_DEFEND_COMMIT        = 0.40                                          // ⟵ v3.0
BOT_NEUTRAL_BIAS_TICK    = 2442         // 8.14분 (5.2절)                 // ⟵ v3.0
BOT_PANIC_DENSITY        = ✗ v3.0 삭제  // (v2.1: 2.0) 밀도 소멸
BOT_THREAT_TRIGGER       = 3000         // 방어 깃발 발령 임계 (게이지 3칸)  ⟵ v3.0
BOT_THREAT_LOOKAHEAD     = 25           // 5초 앞을 본다                    ⟵ v3.0
BOT_BASE_THREAT_W        = 3            // 기지 손상 가중                   ⟵ v3.0
BOT_MIN_DEFENSE_RATIO    = 0.25         // 슬롯의 최소 25%는 방어           ⟵ v3.0
BOT_PREEMPT_FACTOR       = 1.6          // 공격 깃발을 방어로 뺏는 임계 배수 ⟵ v3.0
BOT_STALL_SWITCH         = 1.30         // 정체 시 갈아탈 최소 점수 비율     ⟵ v3.0
BOT_GARRISON_PATIENCE    = 900          // 3분 무위협 시 주둔 해제           ⟵ v3.0
BOT_GUARD_PENALTY        = 2            // 적 방어 깃발 1개당 앵커 점수 1/3  ⟵ v3.0
```

### A.1 백엔드 구현 체크리스트 (v2.1 코드에서 이어갈 때)

| # | 작업 | 절 |
|---|---|---|
| 1 | `flag`에 `posture` / `progressMilli` / `targetTileId` / `stalled` / `stallSinceTick` 추가. v2.1의 `progressMilli`(이동)를 `moveProgMilli`로 개명 | 4.2 |
| 2 | `bases[]` 배열과 `baseIndexOf` 역인덱스 신설 | 2.7 |
| 3 | `issueFlag`에서 `SELF` 거절 제거 → 자세 결정 분기 추가 | 4.3 |
| 4 | `guard(f)` 함수 신설 | 4.1 |
| 5 | `tileCost`에서 밀도항 제거, `supplyMult` 추가 | 4.6b |
| 6 | `defRefCost` 신설 (`tileCost`와 **별도 함수**로 둘 것 — 인자 소거 실수 방지) | 4.7a |
| 7 | Phase A를 경매에서 **밀기 산출 + 방어 그리디 배분**으로 교체 | 4.7b |
| 8 | Phase B를 낙찰 처리에서 **게이지 증감 + 1000 돌파 판정**으로 교체 | 4.7b / 4.10 |
| 9 | tick 5단계를 밀도 캐시 → AP 예산 누적으로 교체, 8단계(기지 회복) 신설 | 7.4 |
| 10 | 주둔 유지비를 **골드 정산(tick 2단계)** 안에 구현. 병력 차감 함수(`applyGarrisonUpkeep`)를 만들지 말 것. `flag`에 `calmTicks` 추가, `player`에 `goldEarnedMilli` 추가 | 3.3 / 4.4 |
| 11 | `snapshot_delta`에 `flagProgress` / `flagTargets` / `baseHp` 추가 | 7.5 |
| 12 | 이벤트 3종(`flag_stalled`, `flag_progress_lost`, `base_captured`) 추가 | 7.3 |
| 13 | 봇 결정 루프에 방어 단계를 **1순위로** 삽입 | 8.2 |
| 14 | 폐기 상수 **8개** 제거 (`ENEMY_DENSITY_COEF`, `DEFENDER_LOSS_RATIO`, `LOSER_ATTRITION_RATIO`, `LOSER_TO_DEFENDER_RATIO`, `HOME_FLAG_DEF_RATIO`, `HOME_FLAG_DEF_CAP`, `UNIT_DEF_MULT`, `UNIT_POWER`) + 봇 `BOT_PANIC_DENSITY` | 부록 A |

---

## 미결정 사항 (Open Questions) — v3.0 기준 재작성

> **두 종류를 명확히 나눈다.**
> **[A] 구현 착수 전 사용자 확정 필요** — 내가 사용자 확정 결정(A~E)의 빈칸을 메우면서 **새로 발명한 것**들이다. 사용자가 "그건 아니다"라고 하면 4·5장을 다시 써야 하므로, 백엔드가 코드를 쓰기 전에 승인받아야 한다.
> **[B] 플레이테스트로 사후 조정 가능** — 값만 바꾸면 되고 구조는 그대로인 것들이다. 관측 지표와 지정 레버를 함께 적었다.
>
> v2.1의 12건 중 **1번(FRONT_RADIUS)은 기하학적 근거를 얻어 해결**(4.1절), **3번(HOME_FLAG_DEF 침식)은 조항 자체가 폐기되어 소멸**, **8번(ENDGAME_RUSH)은 위험도 하향**, **10번(경매 낙찰 기준)은 경매가 폐기되어 소멸**했다.

### [A] 구현 착수 전 사용자 확정이 필요한 것 (5건) — **2026-08-12 전건 확정됨**

| # | 사용자 판정 | 상태 |
|---|---|---|
| A-1 | 주둔 유지비를 **병력이 아니라 골드로** 소모. 골드 순증가량이 체감될 만큼 둔해지되 **적자로는 떨어지지 않게** | ✅ 반영 완료 (3.3 / 4.3 / 4.4 / 4.11 / 5.7 / 부록 A). 보완 규칙(무위협 누진)은 **B-10**, 얇아진 여유는 **B-11**로 이월 |
| A-2 | **분리 유지** | ✅ v3.0 현행 그대로 |
| A-3 | **만피의 50%** (`BASE_HP_MAX_MILLI` 15000 / `BASE_HP_CAPTURE_MILLI` 7500) | ✅ v3.0 현행 그대로 |
| A-4 | **채택** | ✅ v3.0 현행 그대로 |
| A-5 | **"자세"를 플레이어 표면 개념에서 제거.** 규칙은 "내 땅으로 보내면 이동 겸 방어, 적·중립이면 공격" 하나뿐 | ✅ v3.1 반영 완료 (4.3 / 7.2) |

아래 원문은 판정 근거를 남기기 위해 보존한다.

**A-1 (판정 후 주석, v3.1)**: 사용자는 메커니즘 자체를 채택하되 **자원을 병력 → 골드로 교체**했다. 그 결과 아래 원문이 근거로 삼은 "하드 감쇠"(주둔 깃발이 병력을 태우다 소멸)가 사라졌고, 웅크리기 차단은 **기하학 + 골드 템포 + 임계 승리 불가의 3중 합**으로 재구성되었다(4.4(c)). 원문의 대안 (a)·(b)는 4.4(d)에서 각각 (ㄱ)·(ㄴ)으로 재평가해 기각했다.

**A-1. 주둔 유지비(`FLAG_GARRISON_UPKEEP_BP = 4`)는 사용자 결정에 없던 신규 메커니즘이다.**
design-decisions A~E 어디에도 "방어 깃발에 유지비를 물린다"는 말은 없다. 내가 추가한 이유는 E항("쟁여두면 손해가 되어 계속 내보내는 압력이 유지된다")이 방어 쪽으로 새는 구멍을 발견했기 때문이다 — 유지비가 없으면 **전 국경에 방어 깃발을 세우고 버티는 것이 최적해**가 되어 게임이 42분 타임아웃으로 굳는다(4.4절).
**대안**: (a) 유지비 대신 DEFEND 깃발에도 `FLAG_IDLE_TIMEOUT`(2분)을 적용해 강제 회수, (b) 유지비 없이 `FLAG_CAP`을 낮춰 슬롯으로만 억제. (a)는 "2분마다 방어를 재발령"이라 APM이 뛰고, (b)는 공격 슬롯까지 줄어든다. **현행(유지비)을 권장하되 사용자 확인 필요.**

**A-2. `defRefCost`를 `tileCost`와 분리한 것.**
"방어자의 되돌리기 효율은 공격자가 무엇을 들고 왔는지와 무관하다"는 규칙이다(4.7a). 이것이 없으면 병종·군사테크가 대치 전선에서 완전히 소거되어 4축 중 하나와 병종 차별화가 죽는다. 다만 **직관적으로는 "산에서는 방어도 어렵다" 같은 반대 감각도 가능**하므로, 규칙의 방향성을 확인받는다.
**영향 범위**: 이걸 바꾸면 4.7(d) 손익분기표 전체와 5.3~5.4 페이싱이 다시 계산된다.

**A-3. 기지 체력 스케일 — "체력 50"의 해석.**
사용자 확정 문구는 *"소유권이 공격자에게 이전되고, 새 주인 기준 체력 50에서 시작한다(만피 아님)"* 였다. 나는 이를 **"표시 만피 100 중 50, 즉 절반"** 으로 해석했다(`BASE_HP_CAPTURE_MILLI = 7500 / BASE_HP_MAX_MILLI = 15000`). 만약 사용자 의도가 "만피가 200이고 50에서 시작(=25%)" 이었다면 체인 스틸 계산(2.7절)이 전부 달라진다.
**확인할 것**: 만피 표시값과 점령 시작값의 비율이 **50%가 맞는가.**

**A-4. 보급선 항(`supplyMult`)은 신규 메커니즘이다.**
F.5가 요구한 것은 "비용 분산이 충분한지 검산하고, 부족하면 새 항을 제안하라"였다. 내 검산 결론은 **"동적 분산은 ρ가 이미 충분히 대체하므로 새 항이 필요 없다"** 였고(4.6c), 그럼에도 **공간 축(전선 깊이) 분산이 v1.0 이래 한 번도 없었다**는 별개 이유로 이 항을 제안했다. 즉 **F.5의 필수 요구사항이 아니라 내 추가 제안**이다.
**빼도 게임은 성립한다.** 빼면 (a) 5장 페이싱은 유효자릿수 변화 없음(1.00~1.04 구간이므로), (b) 기지의 가치가 v2.1 수준으로 돌아가고, (c) 원거리 침투 억제 장치가 없어진다. **채택/기각을 결정받는다.**

**A-5. 자세(posture)가 앵커 클릭 지점으로 결정되는 UX.**
"명령 종류를 늘리지 않는다"는 원칙은 지켰지만, **"내 땅을 클릭하면 방어"라는 것을 플레이어가 배워야 한다.** 잘못 클릭하면 공격하려다 방어 깃발이 나가고 슬롯과 병력을 낭비한다(회수 시 15% 손실).
**대안**: (a) 현행 — 클릭 지점으로 자동 판정 + 커서 색으로 예고, (b) 방어는 별도 단축키(예: `Shift+클릭`)로 명시, (c) 발령 확인 UI에서 자세를 표시하고 한 번 더 확인. **(a)를 권장**(액션 수 2 유지)하지만 초보 이탈 위험이 있으므로 확인받는다. (b)는 액션 수를 늘리지 않으면서 실수를 막지만 "숨은 조작"이 된다.

### [B] 플레이테스트로 사후 조정 가능한 것 (11건 — v3.1에서 2건 추가)

**B-1. `DEFENSE_LEVERAGE = 0.900`의 공수 균형.**
v3.0 전체가 이 한 값 위에 서 있다. 크면 대치가 완전 교착되어 42분 타임아웃이 표준이 되고, 작으면 방어가 무의미해져 A항의 취지가 죽는다.
**관측 지표**: **(1) 42분 하드 타임아웃으로 끝나는 게임 비율이 25%를 넘는가** → 넘으면 0.850으로 인하. **(2) 게임당 `flag_stalled` 발생이 깃발 종료의 40%를 넘는가** → 넘으면 공격이 과도하게 막히는 것. **지정 레버는 `DEFENSE_LEVERAGE` 단독이며 ±50permille 이상 움직이지 말 것** — 5.3~5.4 전체를 재계산해야 한다.

**B-2. `ENEMY_BASE = 16`의 적정성 (v3.0 1순위 레버).**
5.3(b)에서 표준 종료 39.2분이 되도록 역산한 값이며, 모델 오차에 가장 민감하다. 표에서 보듯 18이면 40.5분, 20이면 41.7분(사실상 타임아웃)이다.
**관측 지표**: **표준 게임 종료 시각의 중앙값이 38~41분 대역에 있는가.** 42분 타임아웃이 잦으면 14로, 36분 이전 종료가 잦으면 18로.

**B-3. 병종 3종의 실사용 분포 (v2.1 4번 이월, 위험도 하향).**
v3.0에서 방어 직무가 생겨 창병에 확실한 자리가 났고(4.11a), 기병 일변도는 자기 국경을 비우는 선택이 됐다.
**관측 지표**: 세션당 발령 비율이 **(창 25~40% / 검 30~45% / 기 25~40%)** 대역 안인가. 창병이 20% 미만이면 `UNIT_DEF_PUSH[SPEAR]`를 1.45로, 기병이 50%를 넘으면 `UNIT_CONVERT[CAVALRY]`를 1.25로.

**B-4. `ENDGAME_RUSH_TICK = 37분` — v3.0에서는 늦추는 쪽이 후보다.**
러시가 `defRefCost`에 걸리지 않으므로 손익분기를 1.170 → 0.878로 내려 **창병 벽을 무력화한다**(5.4b). 너무 이르면 마지막 5분이 "방어가 의미 없는 구간"이 되어 v3.0의 정체성을 스스로 지운다.
**관측 지표**: **37~42분 구간의 방어 자세 슬롯 비중이 20% 아래로 떨어지는가.** 떨어지면 `ENDGAME_RUSH_COST_MULT`를 0.85로 완화하거나 `ENDGAME_RUSH_TICK`을 39분(11700)으로 늦춘다. **design-decisions C항이 37분/−25%를 확정했으므로 변경 시 사용자 재확인 필요.**

**B-5. 기동 축이 v3.0에서 과도하게 강해졌는가.**
`flagSpeedMult`가 이제 공격 도달 + **반격 도달**을 동시에 줄이고, `flagSlotBonus`는 "동시에 지킬 수 있는 전선 수"까지 늘린다(3.4절). 수치를 안 낮춘 이유는 (a) 실측 없이 조정하면 v2.1의 5.1.2절 검산 전체가 무효가 되고, (b) 기동 축은 "지고 있을수록 강해지는" 유일한 축이라 상향 편향이 약자 보정으로 작동하기 때문이다.
**관측 지표**: 승자의 첫 구매 테크가 기동인 비율이 45%를 넘는가. 넘으면 `flagSpeedMult`를 1.35/1.60/1.85로.

**B-6. `FRONT_RADIUS = 6`의 방어 커버 적정성 (v2.1 1번을 지표만 교체해 이월).**
4.1절에서 기하학적 근거를 얻었지만 "적대 전선은 둘레의 30~50%"라는 관측 가정 위에 있다.
**관측 지표**: **방어 자세 슬롯 비중이 30~55% 대역에 있는가.** 55%를 넘으면 반경을 7로 올려 커버를 넓히고, 30% 아래면 5로 줄여 방어를 더 어렵게 만든다. **반경 변경은 5.5절 동맹 임계 인원(현재 3인)까지 재계산해야 한다.**

**B-7. 기지 회전문(체인 스틸)의 실제 빈도.**
2.7/4.12절 검산상 실측 최소 회전 주기 18초이며 슬롯 하나를 계속 태워야 하므로 허용했다. 그러나 이는 "합리적 플레이어" 가정이다.
**관측 지표**: **게임당 `base_captured` 발생 횟수.** 기지 20개 기준 **10~25회**를 정상 대역으로 본다. 40회를 넘으면 `BASE_CAPTURE_LOCK_TICK`을 50(10초)으로, 또는 `BASE_HP_CAPTURE_MILLI`를 9000(60%)으로 올린다.

**B-8. Alliance Lockout 발동 빈도 (v2.1 12번 이월, 위험도 상향).**
5.5절에서 **동맹 임계 인원이 2인 → 3인으로 올라갔다.** `MAX_ALLIES_PER_PLAYER = 2`와 맞물려 "동맹 사슬(A–B–C)"이 강제되므로 전원 연결 그래프가 만들어질 확률이 v2.1보다 높다.
**관측 지표**: Lockout 발동이 게임당 1회를 넘는가. 넘으면 (a) 상한을 1로 낮추거나, (b) "동맹은 인접 플레이어와만 가능" 제약을 추가한다. **관련 미결 항목**: 동맹 방어 지원(내 방어 깃발이 동맹 땅을 덮게 할 것인가)은 v3.0 범위 밖으로 두었다 — 허용하면 동맹의 가치가 다시 크게 올라 이 위험이 커진다.

**B-9. 점유율 분모의 산 오염 (v2.1 7번 이월, 변경 없음).**
산 8%가 끝까지 중립으로 남으면 도달 가능 최대 점유율이 약 95%가 되어 45% 임계값이 실질 47.4%가 된다.
**관측 지표**: 게임 종료 시점의 중립 타일 비율. 8%를 크게 넘으면 `THRESHOLD_FLOOR_PCT`를 43으로 낮춘다(`totalLandTiles`에서 산을 빼는 대안은 UI 설명 부담이 커서 채택하지 않는다).

**B-10. 소규모 농성이 실제로 문제가 되는가 — v3.1 신규 (A-1 파생). ⛔ 누진은 사용자가 기각했다.**
골드 유지비는 v3.0 병력 유지비가 갖던 **하드 감쇠**(주둔 깃발이 소멸)를 잃었다(4.4c). "좁은 영토를 4슬롯으로 완전히 덮고 42분까지 버티는" 소규모 농성은 **27% 둔화만 물고 성립한다.** 설계자는 보완으로 무위협 누진을 제안했으나 **2026-08-12 사용자가 기각**했다 — 규칙을 더 얹는 대신 **구멍을 알고 남긴 채 플레이테스트로 확인**하는 쪽을 택했다. 따라서 이 항목은 "누진이 필요한가"가 아니라 **"기각 판단이 옳았는가"**를 관측한다.
**관측 지표**: **(1) 42분 하드 타임아웃 종료 비율** — B-1과 같은 지표지만 원인 분리가 필요하다. 타임아웃 게임에서 **패자 측 주둔 슬롯 비중이 60%를 넘고 3분 이상 무위협 상태였던 비율**이 30%를 넘으면 농성이 원인이며, 기각 판단을 재검토한다. **(2) 4슬롯 이하 소국(200타일 미만)이 30분 이상 생존하는 비율** — 이것이 농성 전략의 직접 지표다.
**지정 레버**: 1순위 — 누진 되살리기(`GARRISON_ESCALATE_MAX` 1 → 3). **사용자 기각 사항이므로 되살리려면 재승인이 필요하다.** 2순위 — 누진 없이 `GARRISON_UPKEEP_PERMILLE`를 90 → 110으로 올려 전 구간 압박(단, 대국의 골드 수지도 같이 조여서 5.7절 테크 페이싱 재검산이 따라온다).

**B-11. 유지비 차감 후 테크 여유가 얇아진 두 지점 — v3.1 신규 (A-1 파생).**
5.7절 재검산에서 (1) 중위권 4번째 노드 여유가 351 → **43골드**로 줄었고, (2) 선두 5번째 노드가 36.8분에 들어와 `ENDGAME_RUSH_TICK`(37분)과 **0.2분** 차다. 둘 다 목표 대역 안이지만 모델 오차 여유가 거의 없다.
**관측 지표**: **(1) 중위권(최종 순위 3~6위) 플레이어의 테크 노드 수 중앙값이 4인가** — 3으로 내려가면 선두 5 vs 중위 3이 되어 스노볼이 v3.0보다 커진다. **(2) 선두의 마지막 노드 구매 시각이 37분 이전인가** — 37분 이후 구매 비율이 40%를 넘으면 마지막 노드가 종반 러시에 못 쓰이고 사표가 된다.
**지정 레버**: 1순위 `GARRISON_UPKEEP_PERMILLE` 90 → 70 (중위권 여유 +90골드, 선두 5번째 노드 −0.4분). 2순위 `GARRISON_UPKEEP_FREE_PERMILLE` 1000 → 1600(창병 2.67개 / 검병 1.6개 면제 — 중위권을 우선 구제하되 대형 웅크리기 압박은 유지). **`GOLD_RATE_PERMILLE`와 `BASE[tier]`는 건드리지 말 것** — 5.7절 전체와 3.4절 축 선택 밀도를 동시에 재계산해야 한다.

### 이월된 저위험 항목 (2건)

**C-1. 깃발 속도 `120 milli/tick`의 체감** (v2.1 2번). v3.0에서 위험이 줄었다 — 행군 중에도 **방어 게이지가 화면에서 움직이므로** "20초 동안 아무 일도 안 일어난다"는 느낌이 약해진다. 초반 이탈이 크면 150으로.

**C-2. 재접속 유예 90초 후 봇 인계 시 승리 자격** (v1.0 9번). 현행(원 플레이어 승리로 기록) 유지. 다만 v3.0에서는 접속 끊김의 대가가 커졌으므로(7.1절 주석) 봇 인계 지연 자체를 60초로 줄이는 것을 검토 대상으로 남긴다.

