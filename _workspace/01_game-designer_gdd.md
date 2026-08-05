# civwar.io 게임 디자인 문서 (GDD)

- 버전: **v2.1** (기지 시스템 추가 — v2.0의 부분 개정)
- 작성일: 2026-08-05 (v2.0: 2026-08-05, v1.0: 2026-08-04)
- 전제 입력: `_workspace/00_input/design-decisions.md` — 「GDD v2 개정 결정」 A/B/C/D 항 + 「GDD v2.1 개정 결정 — 기지(Base) 시스템」
- 다음 소비자: `multiplayer-backend-engineer` (7장이 프로토콜 설계 1차 입력)

## v2.0 → v2.1 변경 요약 (델타)

1. **기지(Base)를 도입했다.** 깃발의 출발점이 "수도 고정"에서 "내가 소유한 기지 중 선택"으로 바뀐다. 중립 기지는 **플레이어 수와 같은 개수**(8~12개)를 각 수도의 보로노이 셀에 정확히 1개씩 배치하고(2.6절), 각 플레이어의 수도가 최초 기지다. 기지는 `tile.isBase`(**불변** bool)이며 소유권은 `tile.owner`를 그대로 따른다 — **새 가변 타일 상태는 0개다.**
2. **`cmd_flag_issue`에 `originBaseTileId`(선택)가 추가된다.** 생략하면 서버가 "앵커에서 가장 가까운 내 기지"를 자동 선택하므로 **기본 조작량은 발령당 2액션 그대로**다(5.5절). 회수 목적지는 출발 기지 → 없으면 가장 가까운 내 기지 → 기지가 하나도 없으면 v2.0의 수도 상실 폴백을 그대로 재사용한다(4.3/4.4절). 기지를 빼앗겨도 교전 중인 깃발은 **아무 영향 없이 계속 싸운다.**
3. **`FLAG_SPEND_RATE` 0.020 → 0.015 + 지출 예산 누적 방식으로 수정했다.** 전자는 기지가 행군을 줄여 올라간 조작량(19.6~20.8 액션/분)을 되돌리기 위한 것이고, 후자는 **v2.0의 잠재 버그 수정**이다 — `maxSpend < 최저 tileCost`인 깃발(중반 이후 대부분)이 영원히 한 타일도 못 먹고 ENGAGED로 굳는다(4.8절).
4. **기동 축을 재조정했다.** `flagSpeedMult` 1.30/1.55/1.85 → **1.45/1.72/2.00**, `convertEffMult` 1.05/1.10/1.15 → **1.08/1.15/1.22**. 기지가 잠식하는 것은 셋 중 **속도 하나뿐**이므로(슬롯·전환효율은 기지와 완전 독립) 속도를 올려 중앙값을 맞추고 전환효율을 올려 하한(기지 4개)을 방어했다. 결과 T1 환산 이득 **+9.3%(기지4) ~ +19.3%(기지1)** — 다른 3축 T1(+6~15%)과 같은 자릿수(3.4/5.8절).
5. **페이싱 재검산: 표준 종료 40.0분 → 39.3분, 실질 하한 34.5분 → 33.8분, 하드캡 42분 유지.** 목표 30~60분 안. `REGEN_SQRT_COEF`(0.50)·`NEUTRAL_BASE`(9)는 **건드리지 않았다** — 기지의 순 처리량 이득이 최대 +3.8%로 v2.0이 이미 오차 범위로 인정한 폭 안이기 때문이다(5.8절). 미결정 8번(종반 러시 여유)은 2.0분 → **2.66분으로 완화**됐다.

## v1.0 → v2.0 변경 요약

1. **4장 전투 모델을 전면 교체했다.** "비율 슬라이더 + 자동 전선 확장"을 폐기하고 **깃발(Flag)** 모델로 대체했다. 깃발은 병종·병력을 싣고 수도에서 출발해 지정한 **국경 면(Front)** 까지 행군한 뒤 교전한다.
2. **국경 면을 "앵커 타일 + 반경 6 디스크"로 정의**했다. 클릭 한 번으로 지정되고, 매 tick 파생 계산되므로 영토가 변해도 정의가 흔들리지 않으며, 화면에 원으로 그릴 수 있어 직관적이다.
3. **지형을 5종(평원/비옥지/언덕/사막/산) + 물로 확장**했다. 점령비용과 골드 산출을 독립 축으로 분리했고, 골드는 타일별 가중치 합(`goldWeight`)의 O(1) 증분 갱신으로 계산한다. 병력 재생과 점유율 판정은 **순수 타일 개수**를 그대로 쓴다.
4. **기동 테크 축을 재정의**했다 — `tileRateMult`/`spendRateMult` 폐기, `flagSpeedMult`/`flagSlotBonus`/`convertEffMult`로 교체. 나머지 3축은 `tileCost` 공식이 유지되므로 그대로 살아남았다.
5. **5장 세션 페이싱을 처음부터 다시 계산**했다. 깃발 행군 지연·깃발 수 상한·지형 가중평균을 반영한 결과 `REGEN_SQRT_COEF` 0.45→0.50, `NEUTRAL_BASE` 10→9, `GOLD_RATE` 1.5→1.55로 상쇄했다. 예상 분포 **34.5~42분, 중앙값 39~41분**.
6. **`ENDGAME_RUSH`(37분 이후 점령비용 −25%)를 정식 도입**했다. v1.0 미결정 사항 7번은 해결 처리했다. 페이싱 검산상 이 장치가 중앙값을 42분 타임아웃에서 40분 승리로 끌어내린다.
7. **7장에 깃발 프로토콜을 추가**했다. 깃발 위치는 tile-discrete 델타(`flagMoves`)로만 보내고 렌더 보간은 클라이언트가 맡는다. 대역폭 약 4~5 KB/s. **단일 스냅샷 브로드캐스트 원칙은 그대로다.**
8. **유지된 것(design-decisions D항)**: 병력 단일 풀, `√타일` 성장 + 로지스틱 감쇠 + 타일당 상한 12, 밀도 방어, 승리조건 전체, 동맹 규칙 전체, Phase A/B 2단계 결정론, 시야 전체 공개.

> **읽는 법**: 모든 수치는 초안 값이며 상수 이름을 함께 명시했다. 백엔드는 이 상수들을 단일 상수 파일(`shared/constants.ts`)로 뽑아 서버·클라이언트가 공유한다. 부록 A에 전체 상수 표가 있다.
>
> **결정론 원칙**: 모든 공식은 `Math.sqrt`, 정수 연산, `floor/ceil`만 사용한다. `Math.pow` / `**` 의 분수 지수는 **금지**한다. 모든 배율은 **permille 정수**(1.15 → `1150`)로 보관하고, `sqrt`는 `floor(Math.sqrt(x) * 1000)` 형태의 milli-정수로 받는다. 누적 자원(병력·골드)은 1/1000 고정소수점 정수로 보관하고 클라이언트에는 `floor(x/1000)`만 노출한다.

---

## 1. 핵심 루프

> **영토를 점령한다 → 영토 수에 비례해 병력과 골드가 자동 생산된다 → 병종과 병력을 실은 깃발을 국경 면으로 보낸다 → 깃발이 행군해 도착하면 그 구간을 잠식한다 → 반복.**

v1.0 대비 루프에 **지연**이 하나 들어갔다. 명령과 효과 사이에 행군 시간이 있다. 이것이 이 게임의 정체성이다 — "지금 클릭한 것이 20초 뒤에 도착한다"가 예측·기만·타이밍을 만든다. 시야가 전체 공개이므로 상대의 깃발이 오는 것이 보이고, 그래서 **받아칠 시간이 있다.**

골드는 여전히 옆가지다. 전투에 직접 쓰이지 않고 테크 4축 중 하나를 강화해 다음 루프 반복의 계수를 바꾼다.

플레이어가 직접 내리는 결정은 네 가지다.

1. **어느 국경 면을** 칠 것인가 — 타일 클릭 (앵커 지정)
2. **어떤 병종으로** 갈 것인가 — 창병 / 검병 / 기병
3. **얼마나** 실을 것인가 — 병력 수 (프리셋 25/50/75% 또는 슬라이더)
4. **어느 축에** 골드를 쓸 것인가 — 테크 4축

방어에는 별도 명령이 없다. **깃발에 싣지 않고 남겨둔 병력 풀 자체가 방어력**이다(4.7절 밀도 공식). 깃발로 병력을 내보내면 본국 밀도가 떨어진다 — v1.0의 가장 우아한 긴장이 그대로 보존된다.

---

## 2. 맵 / 영토 시스템

### 2.1 구조

| 항목 | 값 | 비고 |
|---|---|---|
| 최소 단위 | 정사각 타일 | 토폴로지 추상화 뒤에 숨긴다(구현 제약 참조) |
| 타일 ID | `row * width + col` | 사각 구현체 내부에만 존재 |
| 인접 | 상하좌우 4방향 | `neighbors(tileId)` |
| 거리 | `distance(a,b)` = 맨해튼 | 사각 구현체 내부에만 존재 |
| 기본 맵 (10인) | `width 100 × height 60` = **6000 타일** | v1.0과 동일 |
| 목표 육지 비율 | **0.65** (±0.05) → 약 **3900 육지 타일** | 물은 영구 통행/점령 불가 |
| 1인당 육지 배분 | **약 390 타일** | 세션 페이싱 기준값 (5장) |
| 지형 종류 | 평원 / 비옥지 / 언덕 / 사막 / 산 / 물 | **v2.0 신규** |
| 기지 (10인) | 수도 10개 + 중립 10개 = **20개** | **v2.1 신규** — 2.6절. 기지 1개당 육지 약 195타일 |

### 2.2 지형 5종 (v2.0 신규)

오브젝트(도시·건물·자원 노드)는 도입하지 않는다. 지형 자체가 **"뺏기 비싼가"(점령비용)** 와 **"가질 가치가 있는가"(골드)** 를 독립적으로 표현한다.

| 지형 | enum | 육지 비중 | 점령비용 배율 | 골드 가중치 | 이동 배율(느려짐) | 역할 |
|---|---|---|---|---|---|---|
| 평원 Plain | 1 | **39%** | `1.00` | `1000` | `1.00` | 기준 |
| 비옥지 Fertile | 2 | **15%** | `1.15` | `2300` | `1.00` | 경제 노른자 = 격전지 |
| 언덕 Hills | 3 | **16%** | `1.30` | `900` | `1.25` | 방어 거점 |
| 사막 Desert | 4 | **22%** | `0.80` | `300` | `1.10` | 넓은 완충지대 |
| 산 Mountain | 5 | **8%** | `1.70` | `250` | `1.80` | 천연 방벽 |
| 물 Water | 0 | — | 통행/점령 불가 | — | — | v1.0과 동일 |

**초안(design-decisions B항) 대비 변경과 근거** — 오케스트레이터 초안은 산 9% / 배율 1.85, 평원 38%, 언덕 17%, 사막 21%였다. 두 곳을 바꿨다.

- **산 1.85 → 1.70, 9% → 8%.** 1.85에서는 밀도 8인 적의 산악 타일 한 칸이 `(25+24)×1.25×1.85 ≈ 113` 병력이다. 초반 깃발 하나가 통째로 들어가는 값이라 "벽"이 아니라 "무한대"가 된다. 1.70이면 약 104 → 사막(약 49)의 2.1배로 여전히 압도적 방벽이면서 **후반 러시(−25%)와 성숙한 경제로는 뚫린다.** 8%는 v1.0의 `MOUNTAIN_RATIO`와 같은 값이라 맵 생성기 튜닝이 이어진다.
- **평원 38→39, 언덕 17→16, 사막 21→22.** 아래 가중평균을 맞추기 위한 미세 조정이다. 역할 구분(격전지/방어거점/완충지대/방벽)은 그대로다.

**가중평균 검산 — 무엇을 상쇄했고 무엇을 상쇄하지 않았는가.**

```
점령비용 가중평균 = .39×1.00 + .15×1.15 + .16×1.30 + .22×0.80 + .08×1.70 = 1.0825
골드 가중평균     = .39×1.00 + .15×2.30 + .16×0.90 + .22×0.30 + .08×0.25 = 0.965
```

- **점령비용**: 원시 가중평균은 v1.0(1.04) 대비 +4.1%다. 그런데 **산은 대부분 정복되지 않는다.** 벽 역할이므로 플레이어는 우회한다. 세션 종료 시점에 산 타일의 약 40%만 주인이 바뀐다고 보면, *실제로 교전이 일어나는 타일 풀*에 대한 가중평균은

  ```
  풀 = .39 + .15 + .16 + .22 + (.08 × 0.40) = 0.952
  실효 가중평균 = (.39 + .1725 + .208 + .176 + .032×1.70) / 0.952 = 1.0009 / 0.952 = 1.0514
  ```

  v1.0의 1.04 대비 **+1.1%**. 페이싱 모델의 오차 범위 안이다. → **지형 때문에 `NEUTRAL_BASE`나 `REGEN_SQRT_COEF`를 건드리지 않는다.** 이 문서에서 그 두 상수를 바꾸는 이유는 지형이 아니라 **깃발 행군 지연**이다(5.2절). 지형 도입의 설계 의도는 *평균 비용을 올리는 것이 아니라 비용의 분산을 만드는 것*이므로, 평균을 v1.0에 맞춰 고정한 것은 의도와 일치한다.
- **골드**: 0.965로 −3.5%다. 이건 정확히 상쇄한다. `GOLD_RATE` 1.500 → **1.550** (`1.550 × 0.965 = 1.4958 ≈ 1.50`). 상수 하나로 끝나고 부작용이 없다.

### 2.3 인원별 맵 크기

"1인당 육지 390타일"을 고정하고 격자를 역산한다. 백엔드는 아래 표를 lookup table로 하드코딩한다.

| 인원 | width × height | 총 타일 | 목표 육지(≈0.65) | 1인당 육지 |
|---|---|---|---|---|
| 8 | 90 × 54 | 4860 | 3159 | 395 |
| 9 | 95 × 57 | 5415 | 3520 | 391 |
| **10 (기본)** | **100 × 60** | **6000** | **3900** | **390** |
| 11 | 104 × 63 | 6552 | 4259 | 387 |
| 12 | 108 × 66 | 7128 | 4633 | 386 |

일반식: `총 타일 ≈ 600 × 플레이어 수`.

### 2.4 맵 생성 알고리즘 (시드 결정론)

룸 생성 시 `roomSeed: uint32`를 정하고 **mulberry32** PRNG만 사용한다. 같은 시드 → 같은 맵. 1단계(육지/물)는 v1.0과 동일하고, **2단계(지형 배분)가 v2.0 신규**다.

```
generateMap(seed, W, H):
  rng = mulberry32(seed)

  // ── 1단계: 육지/물 (v1.0과 동일) ──
  p = 0.55
  for attempt in 0..9:
     grid = W×H, 각 타일 land = (rng() < p)
     테두리 1칸은 강제 water
     repeat 4 times:
        newGrid[t] = (8방향 이웃 중 land 개수 >= 5) ? land : water
     largest = 4-연결 최대 육지 컴포넌트, 그 외는 전부 water
     ratio = |largest| / (W*H)
     if 0.60 <= ratio <= 0.70: break
     p += (ratio < 0.60) ? +0.02 : -0.02
  totalLandTiles = |largest|                // 점유율 분모로 고정 저장
  L = totalLandTiles

  // ── 2단계: 지형 배분 (v2.0 신규) ──
  // 모든 육지 타일은 일단 PLAIN.
  waterDist[t] = 물 타일 전체를 시드로 하는 다중출발 BFS 거리 (스폰 배치와 공유)

  // (a) 산맥 — 덩어리져야 벽 역할을 한다
  blobM = caBlob(rng, W, H, p0=0.42, steps=3)      // 아래 caBlob 정의
  scoreM[t] = blobM 이웃 밀도(8방향 blob 개수, 0..8) 를 상위 자릿수로,
              waterDist[t] 를 하위 자릿수로 합성한 정수   // 내륙 산맥 선호
  quotaM = floor(L * 0.08)
  산 = scoreM 내림차순(동률 tileId 오름차순) 상위 quotaM 개 육지 타일

  // (b) 언덕 — 산의 둘레 링부터 채운다
  ringDist[t] = 산 타일 전체를 시드로 하는 BFS 거리 (산 자신은 0)
  quotaH = floor(L * 0.16)
  언덕 = (아직 PLAIN 인 타일 중) ringDist 오름차순(동률 tileId 오름차순) 상위 quotaH 개
         // ringDist 1,2,3... 순으로 채워지므로 산맥 둘레가 자연스러운 완충 경사가 된다

  // (c) 비옥지 — 강가·해안 평야
  blobF = caBlob(rng, W, H, p0=0.45, steps=2)
  quotaF = floor(L * 0.15)
  후보F = 아직 PLAIN 인 타일 중 waterDist ∈ {1,2}
  비옥지 = 후보F 를 (blobF 이웃밀도 DESC, waterDist ASC, tileId ASC) 정렬해 상위 quotaF 개
           // 후보F 가 quotaF 에 못 미치면 waterDist 3 까지 확장 (희귀 케이스)

  // (d) 사막 — 넓은 내륙 완충지대
  blobD = caBlob(rng, W, H, p0=0.46, steps=3)
  quotaD = floor(L * 0.22)
  후보D = 아직 PLAIN 인 타일
  사막 = 후보D 를 (blobD 이웃밀도 DESC, waterDist DESC, tileId ASC) 정렬해 상위 quotaD 개

  // (e) 나머지 = 평원 (자동으로 약 39%)

caBlob(rng, W, H, p0, steps):
  b[t] = (rng() < p0)                        // tileId 오름차순으로 rng 호출 = 결정론
  repeat steps: b'[t] = (8방향 이웃 중 b 개수 >= 5)
  return b
```

**왜 "노이즈 임계값"이 아니라 "정렬 후 쿼터 절단"인가**: 임계값 방식은 맵마다 비중이 요동쳐 2.2절 가중평균이 무너진다. 쿼터 절단은 **모든 맵에서 비중이 정확히 39/15/16/22/8** 이 되므로 밸런스 상수가 맵에 무관하게 성립한다. 비용은 정렬 한 번(O(L log L), 3900개)뿐이며 맵 생성 시 1회다. `Math.pow`도 부동소수 노이즈 함수도 쓰지 않는다.

**스폰 배치** (v1.0과 동일, `waterDist` 재사용):

```
1. 첫 스폰 = waterDist 가 최대인 타일 (동률이면 tileId 최소)
2. 이후 N-1회: 이미 선택된 스폰들까지의 최소 distance() 가 최대인 육지 타일 (동률 tileId 최소)
3. 각 스폰의 3×3 블록 중 육지 타일을 해당 플레이어 소유로 지정 (최대 9타일)
4. 스폰 중심 타일을 p.homeTileId 로 저장 — 이 타일이 그 플레이어의 최초 기지 (2.6절)
5. 스폰 3×3 블록 안의 산 타일은 평원으로 강등 (시작부터 갇히는 것 방지)
6. placeBases(spawns, terrain, waterDist)   ⟵ v2.1 신규. 2.6절
```

**의도된 부작용**: 스폰은 물에서 가장 먼 내륙이므로 척박하고(사막·산 밀집), 부유한 땅(비옥지)은 해안이다. 웅크리기가 손해가 되고 초반 확장 동기가 강해진다.

### 2.5 영토 상태

각 타일이 갖는 가변 상태는 **소유자 ID 하나뿐**이다. 타일에 병력을 두지 않는다. **v2.1에서도 이 원칙은 그대로다** — 기지는 불변 플래그이므로 가변 상태를 늘리지 않는다.

```
tile.terrain : 0=WATER,1=PLAIN,2=FERTILE,3=HILLS,4=DESERT,5=MOUNTAIN   // 불변
tile.isBase  : 0 | 1                                                    // 불변 ⟵ v2.1
tile.owner   : 0=NEUTRAL, 1..N=playerId                                 // 유일한 가변 상태
```

구현상 `isBase`는 `Uint8Array(tileCount)` 별도 배열로 둔다. `terrain`의 상위 비트에 패킹하는 대안도 가능하지만, 지형 값 도메인(0..5)을 오염시키고 RLE 인코딩을 깨뜨리므로 채택하지 않는다.

병력은 **플레이어 단위 풀(pool)** 과 **깃발(flag)** 두 곳에만 존재한다. 깃발은 타일이 아니라 자기 자신의 위치를 갖는 별도 엔티티다(4.3절).

플레이어별 파생 상태(모두 O(1) 증분 갱신):

```
p.tiles       : 소유 타일 개수 (순수 개수 — 병력 재생과 점유율 판정은 이것만 쓴다)
p.goldWeight  : Σ TERRAIN_GOLD_MILLI[tile.terrain] over p 소유 타일   // 3.3절
p.baseTiles   : 소유한 기지 타일 ID 의 정렬 배열                     // ⟵ v2.1. 4.3절
```

점령/상실 시 세 값을 동시에 증감한다. 매 tick 전체 순회는 하지 않는다.

```
onTileOwnerChange(tileId, from, to):
   w = TERRAIN_GOLD_MILLI[tile[tileId].terrain]
   if from != NEUTRAL: players[from].tiles -= 1;  players[from].goldWeight -= w
   if to   != NEUTRAL: players[to].tiles   += 1;  players[to].goldWeight   += w
   if isBase[tileId]:                                                  // ⟵ v2.1
        if from != NEUTRAL: players[from].baseTiles.remove(tileId)
        if to   != NEUTRAL: players[to].baseTiles.insert(tileId)        // tileId 오름차순 유지
```

**`p.baseTiles`는 새 가변 상태가 아니라 파생 캐시다.** 진실의 원천은 언제나 `isBase[t] && tile[t].owner == p.id`이며, 위 갱신은 그것의 O(1) 증분 미러링이다. 맵 전체 기지가 최대 24개(12인)이므로 배열 삽입/삭제는 상수 시간이고, 캐시가 의심스러우면 24회 순회로 언제든 재구축할 수 있다.

### 2.6 기지(Base) 배치 — v2.1 신규

기지는 **깃발의 출발 위치만 제공한다.** 자원 생산·방어 보너스·깃발 슬롯 증가는 **일절 없다**(사용자 확정). 점령도 일반 타일과 동일하다. 즉 기지의 유일한 가치는 **행군 지연 단축 = 주도권**이며, 희소성(플레이어 1인당 중립 1개)이 이를 쟁탈 대상으로 만든다. 이것이 이 게임에 처음 생기는 **"지도 위의 반드시 차지해야 할 지점"**이다.

#### 인원별 기지 개수 (룩업 테이블)

```
NEUTRAL_BASE_COUNT[N] = N          // 중립 기지 = 플레이어 수
총 기지 = 수도 N 개 + 중립 N 개 = 2N
```

| 인원 | 육지 타일 | 수도 | 중립 기지 | 총 기지 | 기지당 육지 |
|---|---|---|---|---|---|
| 8 | 3,159 | 8 | **8** | 16 | 197 |
| 9 | 3,520 | 9 | **9** | 18 | 196 |
| **10 (기본)** | 3,900 | 10 | **10** | 20 | **195** |
| 11 | 4,259 | 11 | **11** | 22 | 194 |
| 12 | 4,633 | 12 | **12** | 24 | 193 |

맵 크기가 인원에 비례(`총 타일 ≈ 600 × N`)하므로 **`중립 기지 = N`으로 두면 기지 1개당 육지 면적이 193~197로 자동 고정**된다. 별도 튜닝 곡선이 필요 없고, design-decisions가 요구한 "8~12개" 범위와 정확히 일치한다.

#### 배치 알고리즘 (시드 결정론, 맵 생성 시 1회)

`waterDist`는 2.4절 것을 재사용한다. RNG를 추가로 호출하지 않는다 — 같은 시드면 같은 기지 배치다.

```
placeBases(spawns, terrain, waterDist):
  isBase = Uint8Array(tileCount)                       // 불변. 이후 절대 바뀌지 않는다
  for s in spawns sorted by playerId ASC:
     isBase[s.homeTileId] = 1                          // ① 수도 = 최초 기지

  // ② 수도 다중출발 BFS 한 번으로 셀 분할과 접전도를 동시에 얻는다
  capDist[t], cell[t] = 모든 수도를 시드로 하는 BFS (육지만, neighbors() 고정 순서)
                        동률이면 playerId 최소
  secondDist[t]       = 두 번째로 가까운 수도까지의 BFS 거리
  contest[t]          = secondDist[t] - capDist[t]     // 0 에 가까울수록 셀 경계 = 접전지

  // ③ 후보 필터
  cand = { t : terrain[t] ∉ { WATER, MOUNTAIN }
               AND waterDist[t] >= BASE_MIN_WATER_DIST (=2) }

  // ④ 셀당 정확히 1개. 배치 순서는 셀 크기 오름차순(동률 playerId 오름차순)
  for i in players sorted by ( |cell == i| ASC, playerId ASC ):
     pool = { t ∈ cand : cell[t] == i
                         AND distance(t, capital_i) >= BASE_MIN_CAPITAL_DIST (=12)
                         AND distance(t, capital_i) <= BASE_MAX_CAPITAL_DIST (=24)
                         AND minDistToBases(t)      >= BASE_MIN_SEP (=12) }
     if pool 이 비면 아래 완화 사다리를 한 단계씩 적용
     score(t) = minDistToBases(t) * 1000 / ( 10 + BASE_CONTEST_W * contest[t] )   // 정수, W=3
     b = argmax over pool of ( score(t) DESC, contest[t] ASC, t ASC )   // 3중 → 동률 없음
     isBase[b] = 1

  // ⑤ 접근성 보정 — 기지가 벽 뒤에 갇히는 것 방지
  for b in { t : isBase[t] }  sorted by t ASC:
     b 와 neighbors(b) 중 terrain == MOUNTAIN 인 타일 → HILLS 로 강등

  minDistToBases(t) = min over { b : isBase[b] } of distance(t, b)
                      // 기지 ≤ 24개이므로 O(24). 스폰 배치(2.4절)와 같은 방식

  완화 사다리 (pool 이 빌 때 이 순서로 한 단계씩만 풀고 재시도):
     ① BASE_MIN_SEP 12 → 8
     ② BASE_MIN_CAPITAL_DIST 12 → 9
     ③ BASE_MAX_CAPITAL_DIST 24 → 무제한
     ④ BASE_MIN_WATER_DIST 2 → 1
     ⑤ cell == i 인 육지 타일 중 capital_i 에서 가장 먼 타일 (동률 tileId 최소) — 항상 성공
```

**비용**: 다중출발 BFS 1회(3,900타일) + 플레이어당 후보 스캔 O(L × 24). 10인 기준 약 100만 정수 연산, 맵 생성 시 1회. `Math.pow`도 부동소수 노이즈도 쓰지 않는다.

#### 공정성 보장 근거 — 시작 위치 운이 승패를 가르지 않는 이유

"특정 플레이어 옆에만 기지가 몰린다"는 실패 모드는 아래 여섯 개로 **구조적으로** 봉인된다.

1. **셀당 정확히 1개.** 어떤 플레이어도 자기 셀에 2개를 가질 수 없고, 0개인 플레이어도 없다. greedy farthest-point sampling만 썼다면 "우연히 한 셀에 2개"가 가능한데, 셀 쿼터가 이 자유도 자체를 제거한다. **이것이 v2.0 스폰 배치보다 강한 보장이다** — 스폰은 서로 멀기만 하면 됐지만 기지는 균등 분배까지 필요하다.
2. **수도로부터 최소 12.** 1단계 종료 시점(8.5분)의 제국 반경이 약 11이므로(5.1절), **아무도 기지를 무료로 받지 않는다.** 모든 중립 기지는 최소한 확장 1단계를 끝내야 손이 닿는다.
3. **수도로부터 최대 24.** 하한 12와 함께 "내 두 번째 기지까지의 거리"를 12~24 대역으로 전 플레이어 공통 고정한다. 최대 편차 12타일 = 검병 행군 약 22초로, 기동 T1 한 단계(+19%)보다 작다.
4. **`contest` 가중 (경계 선호).** 점수 분모에 `contest`가 들어가므로 기지는 셀 경계 쪽으로 당겨진다. 즉 "내 셀의 기지"는 내 뒷마당이 아니라 **나와 이웃이 함께 노리는 지점**이다. 공정성과 쟁탈성이 같은 항에서 동시에 나온다.
5. **배치 순서 = 셀 크기 오름차순.** `playerId` 순서로 돌면 1번 플레이어가 항상 먼저 고르는 순서 편향이 생긴다. 가장 좁은(제약이 심한) 셀부터 고르게 하면 편향이 제거되고 완화 사다리 발동 빈도도 줄어든다. 동률은 `playerId`로 깨므로 결정론은 유지된다.
6. **산·물 제외 + 4이웃 산 강등.** 지형 운으로 "구조적으로 못 먹는 기지"가 생기지 않는다.

**산에 기지를 놓지 않는 이유**(판단 결과): 산 타일은 `TERRAIN_COST_MULT 1.70`이라 밀도 8 방어자 기준 한 칸에 약 104 병력이 든다(2.2절). 맵에서 가장 값진 목표가 동시에 가장 뺏기 어려운 타일이면 **먼저 잡은 사람이 영구 독점**한다 — 쟁탈 대상이라는 설계 의도와 정반대다. 게다가 `TERRAIN_MOVE_MULT 1.80` 때문에 산악 기지에서 출발한 깃발은 첫 칸부터 느려져 기지의 존재 이유(행군 단축)를 스스로 깎는다. **언덕은 허용한다** — 비용 1.30은 충분히 뚫리는 값이라 "방어하기 좋은 기지"라는 바람직한 변주만 남는다.

**지형 비중 영향 검산**: ④의 산 강등은 최대 `2N × 5타일 = 120타일`이고 그중 실제 산은 8%인 약 10타일이다. 육지 3,900 대비 **0.26%p 미만** — 2.2절 가중평균(비용 1.0514 / 골드 0.965)에 유효자릿수 변화를 주지 않는다.

---

## 3. 자원·성장 모델

### 3.1 tick

| 상수 | 값 |
|---|---|
| `TICK_MS` | **200** (초당 5 tick) |
| 1분 | 300 tick |
| 종반 러시 발동 | 11,100 tick = **37분** |
| 하드 타임아웃 | 12,600 tick = **42분** |

### 3.2 병력 (Troops) — v1.0 유지, 계수 하나만 변경

```
troopCap(p)      = floor( (100 + 12 * p.tiles) * capMult(p) )

regenPerTick(p)  = ( 0.8 + 0.50 * sqrt(p.tiles) )          // REGEN_SQRT_COEF: 0.45 → 0.50
                 * regenMult(p)
                 * ( 1 - p.troops / troopCap(p) )           // 로지스틱 감쇠, 0 미만이면 0

p.troopsMilli   += round( regenPerTick(p) * 1000 )
p.troopsMilli    = min(p.troopsMilli, troopCap(p) * 1000)
```

- **`sqrt(tiles)`**: 선형이면 선두가 눈덩이처럼 굴러 20분에 끝난다. 지수 0.5는 영토가 16배 늘 때 생산량이 4배만 느는 강한 감쇠다.
- **`troopCap` 타일당 12 선형**: 방어 밀도의 상한을 12로 고정한다. **큰 제국은 타일당 방어력을 늘릴 수 없고 생산량만 sqrt로 는다.** "큰 쪽이 1:1에서는 이기지만 여럿에게 둘러싸이면 진다" — 동맹이 의미를 갖는 근거.
- **`REGEN_SQRT_COEF` 0.45 → 0.50 변경 근거**: 깃발 모델은 v1.0의 연속 전선 확장보다 약 15% 비효율적이다(5.2절 실효계수 분해). 이 계수를 0.50으로 올리면 T=390 기준 수입이 +10.1%(9.69 → 10.67/tick) 늘어 그 손실을 거의 정확히 상쇄한다. **깃발 지연 때문에 올린 것이지 지형 때문이 아니다.**
- 로지스틱 항 때문에 풀을 비우고 회복하는 데 약 2분이 걸린다. 깃발에 전량을 싣는 것은 실제로 위험한 선택이 된다.

**시작값**: `troops = 150`, `tiles = 9`, `troopCap = 208`.

### 3.3 골드 (Gold / 생산력) — 타일별 가중치 합으로 변경

```
// 매 tick, playerId 오름차순
goldMilliPerTick(p) = floor( p.goldWeight * GOLD_RATE_PERMILLE * goldMult_permille / 1_000_000_000 )
p.goldMilli += goldMilliPerTick(p)

GOLD_RATE_PERMILLE = 1550
```

**O(1) 보장**: `p.goldWeight`는 2.5절에서 점령/상실 시에만 증분 갱신된다. 매 tick 하는 일은 **곱셈 두 번과 나눗셈 한 번**이며 타일 순회가 없다. v1.0의 `p.tiles × 1.5`와 계산 비용이 동일하다.

**오버플로 검산**: 최대 `goldWeight`(1200타일 전부 비옥지) = 2,760,000. × 1550 × 1900(경제 T3) = 8.1×10¹² — `Number.MAX_SAFE_INTEGER`(9.0×10¹⁵)의 1/1000. 안전하다.

**검산**: 평균 지형 혼합(가중치 965/타일)으로 390타일 → `goldWeight = 376,350` → `floor(376350 × 1550 × 1000 / 1e9) = 583` milli-gold/tick. v1.0은 `390 × 1.5 = 585`. 동일하다. ✓

**골드에는 감쇠를 넣지 않았다.** 병력은 sqrt 감쇠, 골드는 선형 — 이 비대칭이 의도한 설계다. 골드가 선형이면 확장할수록 테크가 빨라지므로 확장 동기가 유지된다. 여기에 v2.0은 **지형 편차**를 더했다: 비옥지 1타일 = 사막 7.7타일. "어디를 먹느냐"가 처음으로 의미를 갖는다.

**시작 골드**: 200.

> **명시**: 병력 재생(`√tiles`)과 점유율 승리 판정(`p.tiles / totalLandTiles`)은 **순수 타일 개수**를 쓴다. 여기까지 지형 가중치를 넣으면 플레이어가 "내 영토 400개, 그런데 실효 372개"를 머리로 계산해야 해서 자기 상태를 직관적으로 읽지 못한다. 가중치는 **골드에만** 적용한다.

### 3.4 테크 트리 (4축 × 3단계)

- 각 축은 T1 → T2 → T3 순차 해금. 축을 건너뛸 수 없다. 구매는 즉시 발효, 되돌릴 수 없다.
- **누진 비용**: 이미 산 노드가 많을수록 다음 노드가 비싸진다.

```
cost(tier, purchasedCount) = floor( BASE[tier] * (1000 + 250 * purchasedCount) / 1000 )
BASE = { T1: 450, T2: 1100, T3: 2600 }
purchasedCount = 해당 플레이어가 이미 구매한 총 노드 수(축 무관)
```

예: 첫 T1 = 450 → 두 번째 T1 = 562 → 세 번째가 T2면 1650 → 네 번째 T2 = 1925 → 다섯 번째 T3 = 5200.

| 축 | 효과 (T1 / T2 / T3, 누적값) | 상수명 |
|---|---|---|
| **군사** (Military) | 적 타일 점령비용 ×`0.93` / `0.86` / `0.78`<br>내 타일 피점령비용 ×`1.07` / `1.15` / `1.22` | `atkCostMult`, `defCostMult` |
| **경제** (Economy) | 골드 생산 ×`1.25` / `1.55` / `1.90`<br>병력 재생 ×`1.06` / `1.13` / `1.20` | `goldMult`, `regenMult` |
| **영토** (Territory) | 중립 타일 점령비용 ×`0.88` / `0.76` / `0.62`<br>병력 상한 ×`1.10` / `1.22` / `1.35` | `neutralCostMult`, `capMult` |
| **기동** (Mobility) **⟵ v2.1 재조정** | 깃발 이동속도 ×`1.45` / `1.72` / `2.00`<br>깃발 슬롯 `+0` / `+1` / `+2`<br>병종 전환 효율 ×`1.08` / `1.15` / `1.22` | `flagSpeedMult`, `flagSlotBonus`, `convertEffMult` |

미구매 시 모든 배율 = `1.00`, 슬롯 보너스 = `0`.

**기동 축 재정의 근거**: v1.0의 `tileRateMult`(tick당 점령 타일 상한)와 `spendRateMult`(예산 소비율)는 "자동 전선 확장"의 파라미터였고 깃발 모델에는 대응 개념이 없다. 깃발 모델에서 기동의 의미는 **템포**다 — 명령이 효과가 되기까지의 지연을 줄이고(속도), 동시에 굴릴 수 있는 작전 수를 늘리고(슬롯), 비싼 병종을 싸게 편성한다(전환 효율). 셋 다 "얼마나 세게 때리는가"가 아니라 "얼마나 빨리·여러 곳을 때리는가"이며 이는 v1.0 기동 축의 성격을 그대로 계승한 것이다.

**나머지 3축 유효성 검토**: 군사·경제·영토는 전부 `tileCost`·`regen`·`troopCap`에 걸리는데 이 셋은 v2.0에서 공식이 바뀌지 않았다(4.6절이 `tileCost`를 그대로 재활용한다). **무의미해진 배율은 기동 축 두 개뿐이며 교체 완료.** 다만 영토 축 `capMult`는 v2.0에서 의미가 하나 늘었다 — 본국 깃발 방어 기여 상한(`HOME_FLAG_DEF_CAP`)이 `troopCap` 비례이므로, 영토 축은 이제 "웅크리기 상한"도 같이 올린다.

**T1 효과 크기 비교**:

| 축 T1 | 즉시 체감 이득 | 환산 |
|---|---|---|
| 군사 | 적 타일 7% 저렴 + 내 타일 7% 비쌈 | 대인 교환비 **+15%** |
| 경제 | 골드 +25%, 재생 +6% | 병력 **+6%** 즉시 + 테크 속도 +25%(복리) |
| 영토 | 중립 12% 저렴, 상한 +10% | 중립 확장 **+13.6%**, 웅크리기 상한 +10% |
| 기동 **⟵ v2.1** | 이동속도 +45%, 전환 효율 +8% | 중반 행군 20.7초 → 14.3초. 깃발 사이클 39.7초 → 33.3초 = **작전 회전율 +19.3%**(기지 1개) ~ **+9.3%**(기지 4개), 기병 편성비 −7.4% |

기동 T1의 환산치가 **기지 보유 수에 따라 +9.3~19.3%** 범위에 있고, 다른 축의 T1(+6~15%)과 같은 자릿수를 유지한다. v1.0에서는 기동 T1이 "동시 공격이 자주 일어나야만 가치가 있는" 조건부 효과였는데(v1.0 미결정 사항 6번), v2.0에서 행군 지연이 항상 존재하게 되어 해소됐다. **v2.1에서 기지가 그 전제를 약화시켰으므로 수치를 재조정했다** — 전체 검산은 5.1.2절이며, 결론은 "기동 축의 세 효과 중 기지가 잠식하는 것은 속도 하나뿐이고, 슬롯과 전환 효율은 기지와 완전히 독립"이다.

중립이 남아있는 8.7분 전까지는 영토·경제가 강하고, 그 이후엔 군사·기동이 강하다. **축 선택이 곧 "언제 승부를 볼 것인가"의 선언**이다. 세션당 구매 가능 수는 5.6절에서 검산한다.

---

## 4. 전투 해석 규칙 — 깃발(Flag) 모델

> v1.0 4장(비율 슬라이더 + 자동 전선 확장)은 **전면 폐기**했다. 아래가 완전한 대체 규칙이다.
> 단, `tileCost` 공식(4.6절)과 Phase A/Phase B 2단계 결정론 구조(4.8절)는 **v1.0에서 그대로 계승**한다. 이 둘이 v1.0에서 가장 검증된 부분이고, 깃발 모델에 접목 가능하기 때문이다.

### 4.1 국경 면(Front)의 정의 — 앵커 + 반경 디스크

이 모델 전체가 여기에 걸려 있다. 요구조건은 세 가지였다: (a) 서버가 매 tick 결정론적으로 계산 가능할 것, (b) 영토가 매 tick 변해도 정의가 흔들리지 않을 것, (c) **플레이어가 화면에서 직관적으로 인지할 것**.

**정의**: 국경 면은 `(앵커 타일 anchorTileId, 목표 소유자 targetOwnerId)` 쌍으로 지정되고, 매 tick 다음과 같이 **파생 계산**된다.

```
front(f) = { t :  tile[t].owner == f.targetOwnerId
                  AND terrain[t] != WATER
                  AND distance(t, f.anchorTileId) <= FRONT_RADIUS      // = 6
                  AND ∃ n ∈ neighbors(t) : tile[n].owner == f.ownerId }

정렬: ( distance(t, anchor) ASC, tileCost(f, t) ASC, t ASC )           // 3중 → 동률 없음
```

세 가지 요구조건이 어떻게 충족되는가:

- **(a) 결정론·저비용** — 앵커 중심 반경 6 디스크는 사각 격자에서 85타일(맨해튼 원)이다. 매 tick 깃발당 최대 85회 조회, 교전 중 깃발이 룸 전체에 20~30개면 tick당 2,500회 미만. 5Hz에서 문제되지 않는다. 정렬은 3중 키라 동률이 없다.
- **(b) 안정성** — **앵커는 좌표일 뿐 상태가 아니다.** 타일 소유자가 바뀌어도 앵커는 그대로다. `front`는 저장되지 않고 매 tick 다시 만들어지므로 "저장한 집합이 낡는" 문제 자체가 생기지 않는다. v1.0의 `focus` 와 같은 철학이다.
- **(c) UI 직관성** — 화면에 **반경 6의 원 하나**를 그리면 끝이다. 커서를 맵 위에 올리면 원이 따라다니고, 원 안에서 공격 가능한 국경 타일이 하이라이트되며, 툴팁에 `vs 파랑 · 국경 타일 12 · 예상 점령비용 780`이 뜬다. 클릭하면 그 원이 고정되고 깃발이 출발한다. 진행 중에는 원이 계속 그려져 있고 잡아먹힌 타일이 자기 색으로 바뀐다. **"내가 지금 어디를 밀고 있는지"가 원 하나로 읽힌다.**

**디스크가 소진되면 작전이 끝난다.** 반경 6 디스크 안의 육지 타일은 평균 약 60개. 깃발 하나가 그 안을 다 먹으면 `front`가 비고 깃발은 IDLE이 된다(4.9절). 이것이 **의도된 페이싱 장치**다 — 깃발은 무한히 밀지 않고, 한 작전마다 플레이어가 다시 판단해 재지정한다. 조작량은 5.5절에서 추정한다.

**앵커 사거리 제한**: 발령 시 `min over p 소유 타일 t of distance(t, anchor) <= FRONT_MAX_RANGE (=40)`. 맵 반대편으로 깃발을 보내는 비현실적 명령을 막는다.

### 4.2 깃발의 상태

```
flag {
  id            : uint32     // 전역 단조증가. 결정론 정렬 키이자 프로토콜 식별자
  ownerId       : uint8
  slotIndex     : uint8      // 0..flagCap-1. UI 단축키(F1..F7) 대응
  unit          : 0=SPEAR | 1=SWORD | 2=CAVALRY     // 발령 시 고정, 변경 불가
  troopsMilli   : int        // 실린 병력 (풀에서 빠져나온 상태)
  initialTroops : int        // 발령 시점 값. 소비율 상한의 분모
  state         : MARCHING | ENGAGED | RETURNING | IDLE
  posTileId     : uint32     // 현재 점유 타일 (정수)
  progressMilli : 0..999     // 다음 타일로의 진행도
  nextTileId    : uint32     // 이번 스텝의 목적지 이웃
  anchorTileId  : uint32
  targetOwnerId : uint8      // 0 = NEUTRAL. 발령 시 고정 (예외: 4.5절 중립 자동 전환)
  lockUntilTick : uint32     // 재지정 경직. 이 tick 까지 이동 정지
  idleSinceTick : uint32|null
  originTileId    : uint32   // ⟵ v2.1. 출발한 기지 (기지 없이 발령됐으면 폴백 타일)
  returnTileId    : uint32|null  // ⟵ v2.1. RETURNING 중에만 유효. 4.4절
  spendBudgetMilli: int      // ⟵ v2.1. ENGAGED 중 누적되는 지출 예산. 4.8절
}
```

**v2.1에서 늘어난 세 필드는 전부 깃발 상태다.** 타일 상태는 여전히 `owner` 하나뿐이다(2.5절).

**깃발은 타일 위에 있지만 타일의 소유권과 무관하다.** 적 영토를 지나갈 수도 있다(4.4절 소모 규칙 적용).

### 4.3 깃발 발령

```
function issueFlag(p, unit, troopsReq, anchorTileId, originBaseTileId|null, clientSeq):
  if p.eliminated                              -> reject "ELIMINATED"
  if p.flags.length >= flagCap(p)              -> reject "NO_SLOT"
  if unit not in {0,1,2}                       -> reject "BAD_UNIT"
  if terrain[anchorTileId] == WATER            -> reject "WATER"
  targetOwner = tile[anchorTileId].owner
  if targetOwner == p.id                       -> reject "SELF"
  if isAllyOrBreaking(p.id, targetOwner)       -> reject "ALLIED"
  if minDistFromTerritory(p, anchorTileId) > FRONT_MAX_RANGE  -> reject "OUT_OF_RANGE"
  if troopsReq < FLAG_MIN_TROOPS (=40)         -> reject "TOO_SMALL"

  // ── 출발 기지 결정 (v2.1) ──
  if originBaseTileId != null:                          // 플레이어가 명시적으로 골랐다
     if isBase[originBaseTileId] == 0                 -> reject "NOT_BASE"
     if tile[originBaseTileId].owner != p.id          -> reject "NOT_OWNED_BASE"
     origin = originBaseTileId
  else if p.baseTiles is not empty:                     // 기본값 = 자동 선택
     origin = argmin over t ∈ p.baseTiles of ( distance(t, anchorTileId), t )
  else:                                                 // 기지를 하나도 갖지 못한 경우
     origin = argmin over t ∈ p 소유 타일 of ( distance(t, p.homeTileId), t )
              // ⟵ v2.0 의 수도 상실 폴백을 그대로 재사용

  // 병종 전환 비용 — 기병은 풀에서 더 많이 꺼내야 한다
  poolCost = ceil( troopsReq * UNIT_CONVERT_PERMILLE[unit] / convertEffMult_permille(p) )
  if poolCost > p.troops                       -> reject "INSUFFICIENT"

  p.troops -= poolCost
  f = { id: ++globalFlagSeq, ownerId: p.id, slotIndex: 최소 미사용 슬롯,
        unit, troopsMilli: troopsReq*1000, initialTroops: troopsReq,
        state: MARCHING, posTileId: origin, progressMilli: 0,
        anchorTileId, targetOwnerId: targetOwner, lockUntilTick: 0,
        originTileId: origin, returnTileId: null, spendBudgetMilli: 0 }
  buildDistanceField(f, f.anchorTileId)        // 4.4절
  emit flag_issued(...)
```

**전선 존재를 발령 시점에 검증하지 않는다.** 지금 국경이 아니어도 도착할 즈음엔 국경일 수 있다 — 그게 행군 지연이 만드는 예측 게임의 핵심이다. 대신 `FRONT_MAX_RANGE`로 상식선을 지킨다. **`FRONT_MAX_RANGE`는 여전히 "내 영토에서 앵커까지"로 측정한다** — 출발 기지 기준으로 바꾸지 않는다. 기지를 잡았다고 사거리가 늘어나면 기지가 "출발 위치만 제공한다"는 정의를 넘어선다.

#### 출발점이 "기지 중 선택"인 이유와 조작량 방어 (v2.1)

v2.0에서 출발점은 수도 고정이었다. 그 설계 의도("먼 전선일수록 지연이 커진다 → 눈덩이 억제")는 **그대로 살아 있다** — 기지가 있어도 기지 없는 방향의 전선은 여전히 수도에서 출발하고, 기지 자체가 희소하기 때문이다. 바뀐 것은 "제국이 커질수록 모든 방향이 균등하게 느려진다"가 "**한 방향만 골라 빠르게 만들 수 있다**"로 바뀐 것이며, 이것이 지도 위에 쟁탈 지점을 만든다.

**조작 단계는 늘리지 않는다.** `originBaseTileId`는 **선택 필드**이며 생략이 기본이다.

| | 조작 | 액션 수 |
|---|---|---|
| 기본 (v2.0과 동일) | 병종 키 → 맵 클릭 | **2** — 서버가 앵커에서 가장 가까운 내 기지를 자동 선택 |
| 출발 기지 변경 | 슬롯 헤더에서 기지 선택(또는 Shift+기지 클릭) 후 위와 동일 | 3 (1회) |
| 변경의 지속성 | **슬롯에 sticky** — 다음 발령부터 다시 2액션 | — |

즉 5.5절이 확보한 13~18 액션/분은 **기본 경로에서 그대로 유지된다.** 수동 변경까지 반영한 재검산은 5.5절에 있다.

**깃발 슬롯 수**:

```
flagCap(p) = min( FLAG_CAP_HARD_MAX,
                  FLAG_CAP_BASE + floor(p.tiles / FLAG_TILES_PER_SLOT) + flagSlotBonus(p) )

FLAG_CAP_BASE = 3,  FLAG_TILES_PER_SLOT = 300,  FLAG_CAP_HARD_MAX = 7
flagSlotBonus = 기동 테크 [T1:+0, T2:+1, T3:+2]
```

| 타일 | 테크 없음 | 기동 T2 | 기동 T3 |
|---|---|---|---|
| 9 (시작) | **3** | 4 | 5 |
| 300 | 4 | 5 | 6 |
| 600 | 5 | 6 | 7 |
| 900 | 6 | 7 | 7 |
| 1200+ | 7 | 7 | 7 |

**초기 3개가 조작량 브레이크다.** 5.5절에서 이 값이 분당 액션 수를 어떻게 묶는지 검산한다. 상한 7은 기동 T3를 끝까지 판 종반 선두만 도달하는 값이며, 타일만으로는 900타일(점유율 23%)에서 6개다. 실전에서 대부분의 시간 동안 플레이어는 **4~5개**를 굴린다.

### 4.4 이동

**경로 결정 — 거리장(distance field) 방식.** 직선 이동은 물·산 때문에 실패하고, 매 tick BFS는 비싸다. 발령/재지정 시점에 **앵커에서 출발하는 역방향 BFS를 한 번** 돌려 거리장을 만들고, 이후 매 tick은 O(1)로 내리막을 따라간다.

```
buildDistanceField(f, goalTileId):                  // ⟵ v2.1: 목적지를 인자로 받는다
  dist = Uint16Array(tileCount) 를 0xFFFF 로 채움
  BFS from goalTileId over { terrain != WATER },
      이웃 순회 순서는 neighbors() 가 반환하는 고정 순서
  f.field = dist
  // MARCHING/ENGAGED → goalTileId = f.anchorTileId
  // RETURNING         → goalTileId = f.returnTileId
  // 비용: 육지 3900타일 1회 BFS. 발령/재지정/회수목적지 변경 때만 발생.
  // 메모리: 깃발당 7.8 KB, 12인 × 7 = 84개 최대 655 KB / 룸. 도착(ENGAGED) 시 즉시 해제.
  // 최적화: 같은 goalTileId 를 가진 깃발끼리 거리장을 공유(refcount)

stepTarget(f):
  return argmin over n ∈ neighbors(f.posTileId) of ( f.field[n], n )   // 동률 tileId 최소
```

**속도**:

```
speedMilli(f) = max( 1,
   floor( FLAG_SPEED_BASE_MILLI
          * UNIT_SPEED_PERMILLE[f.unit]
          * flagSpeedMult_permille(p)
          / (TERRAIN_MOVE_PERMILLE[terrain[f.posTileId]] * 1000) ) )   // milli-타일 / tick

FLAG_SPEED_BASE_MILLI = 120       // 검병·평원·무테크 = 0.12 타일/tick = 0.6 타일/초
```

**매 tick 이동 처리** (tick 순서 4단계, `flag.id` 오름차순):

```
for f in flags sorted by f.id ASC:
   if t < f.lockUntilTick: continue                       // 재지정 경직
   if f.state == ENGAGED or f.state == IDLE: 
        applyExposureAttrition(f); continue               // 제자리
   f.progressMilli += speedMilli(f)
   while f.progressMilli >= 1000:
        f.progressMilli -= 1000
        f.posTileId = f.nextTileId
        f.nextTileId = stepTarget(f)
        if f.state == MARCHING and f.posTileId == f.anchorTileId: break
   applyExposureAttrition(f)
   // 도착 판정
   if f.state == MARCHING and front(f) is not empty and
      ∃ tile in front(f) : distance(tile, f.posTileId) <= FLAG_ENGAGE_RANGE (=1):
         f.state = ENGAGED; f.field = null; emit flag_engaged(...)
   if f.state == MARCHING and f.posTileId == f.anchorTileId and front(f) is empty:
         f.state = IDLE; f.idleSinceTick = t; emit flag_idle(...)
   if f.state == RETURNING:                                   // ⟵ v2.1
         want = recallTarget(f)
         if want != f.returnTileId:                            // 목적지 기지를 잃었다
              f.returnTileId = want; buildDistanceField(f, want)
              emit flag_return_retargeted(flagId, want)
         if f.posTileId == f.returnTileId:
              p.troops += floor(f.troopsMilli * FLAG_RECALL_REFUND / 1000)   // 0.85
              destroy(f); emit flag_ended(reason="recalled", refunded=...)

applyExposureAttrition(f):
   o = tile[f.posTileId].owner
   if o != f.ownerId and not isAlly(f.ownerId, o):
        f.troopsMilli -= max(1000, floor(f.troopsMilli * 5 / 10000))    // 0.05%/tick ≈ 3%/분
        if f.troopsMilli <= 0: destroy(f); emit flag_ended(reason="attrited")
```

**속도 초안 값과 체감**:

| 병종 | 속도 배율 | 평원 타일/초 | 11타일 행군(390타일 제국 반경) |
|---|---|---|---|
| 창병 | `0.75` | 0.45 | **27초** |
| 검병 | `1.00` | 0.60 | **20초** |
| 기병 | `1.45` | 0.87 | **14초** |

지형 이동 배율 가중평균은 `1.126`이므로 실전 행군은 위 값의 약 1.13배다. 기동 T3(×2.00)면 검병이 10.4초로 줄어든다. **위 표는 출발점이 수도인 경우다** — 전진 기지에서 출발하면 같은 전선까지의 행군이 중반 기준 20.7초 → 약 12.6초(기지 2개) / 8.9초(기지 3개)로 줄어든다(5.1.1절). 두 효과는 `행군시간 = 거리(기지) ÷ 속도(기동테크)`로 **곱해진다.**

**이동 중 재지정** (`cmd_flag_retarget`):

```
if f.state == RETURNING                        -> reject "RETURNING"
if newTargetOwner is ally/breaking              -> reject "ALLIED"
if out of FRONT_MAX_RANGE                       -> reject "OUT_OF_RANGE"
f.anchorTileId  = new
f.targetOwnerId = tile[new].owner
f.state         = MARCHING                       // ENGAGED 였어도 다시 행군
f.lockUntilTick = t + FLAG_RETARGET_LOCK_TICK    // 15 tick = 3초, 부대가 방향을 트는 시간
f.returnTileId  = null
f.spendBudgetMilli = 0                           // ⟵ v2.1. 예산 이월 금지 (4.8절)
buildDistanceField(f, f.anchorTileId)
```

**병종은 절대 바꿀 수 없다**(사용자 확정 결정). 병력 추가 적재도 불가 — 더 필요하면 새 깃발을 낸다. 3초 경직은 재지정 스팸으로 이동을 공짜로 최적화하는 것을 막는다. **출발 기지도 발령 후에는 바꿀 수 없다** — `originTileId`는 이미 떠난 부대의 출신지일 뿐이고, 바꿀 수 있게 하면 "회수 목적지 순간이동" 익스플로잇이 된다.

#### 회수와 기지 (v2.1)

**회수** (`cmd_flag_recall`): `state = RETURNING`, `f.returnTileId = recallTarget(f)`, `buildDistanceField(f, f.returnTileId)`. 도착 시 병력의 **85%** 만 풀에 복귀한다(`FLAG_RECALL_REFUND = 0.85`). 15% 손실이 "일단 내보내고 보자"를 억제한다.

```
recallTarget(f):
  p = players[f.ownerId]
  // ① 출발한 기지를 아직 갖고 있으면 그리로
  if isBase[f.originTileId] and tile[f.originTileId].owner == p.id:
       return f.originTileId
  // ② 잃었으면 남은 내 기지 중 현재 위치에서 가장 가까운 곳
  if p.baseTiles is not empty:
       return argmin over t ∈ p.baseTiles of ( distance(t, f.posTileId), t )
  // ③ 기지가 하나도 없으면 — v2.0 의 수도 상실 폴백을 그대로 재사용
  return argmin over t ∈ p 소유 타일 of ( distance(t, p.homeTileId), t )
  // p 의 타일이 0이면 이미 탈락 상태이므로 4.12절이 먼저 깃발을 소멸시킨다. ③은 항상 값을 낸다
```

`recallTarget`은 **매 tick 재평가**된다(4.4절 이동 루프). 값이 바뀔 때만 거리장을 다시 만들고 `flag_return_retargeted`를 emit한다. **비용 상한**: 기지 타일은 맵 전체에 최대 24개이므로 목적지 변경은 게임당 수 회 수준이고, 최악의 경우(한 기지가 넘어가는 tick에 7개 깃발이 그리로 회수 중)에도 BFS 7회 = 약 27,000 연산으로 5Hz tick 예산 안이다.

**기지를 빼앗겨도 교전 중인 깃발은 그대로 계속 싸운다**(사용자 확정 결정). 소멸도, 강제 회수도, 전투력 감소도 **없다.** 기지 상실이 깃발에 미치는 영향은 오직 두 가지다 — (a) 회수 목적지 재계산, (b) **앞으로의** 자동 출발지 선택에서 그 기지가 빠지는 것. 이미 발령된 명령을 소급해서 무효화하지 않는 것은 7.1절의 "접속이 끊겨도 행군 중인 깃발은 계속 간다"와 같은 원칙이다.

### 4.5 목표 소유자 고정과 중립 자동 전환

`targetOwnerId`는 발령 시 고정된다. 동맹 배제 판정과 `flag_engaged` 의미를 예측 가능하게 유지하기 위해서다. **단 하나의 예외**:

```
// tick 순서 8단계에서 판정
if f.targetOwnerId == NEUTRAL and front(f) is empty:
     cands = { o : o ≠ f.ownerId, o ≠ NEUTRAL, o 가 디스크 안에 타일 보유,
                   not isAllyOrBreaking(f.ownerId, o) }
     if cands is not empty:
          f.targetOwnerId = argmin over cands of ( 그 소유자 타일의 최소 tileCost, o )
          emit flag_retargeted(auto=true, ...)
     else: f.state = IDLE
```

**이유는 조작량이다.** "빈 땅 먹으러 보냈는데 도착 직전에 남이 먼저 먹었다"는 초반에 흔하고, 매번 수동 재지정을 강요하면 APM이 그대로 뛴다. 적→적 전환은 자동으로 하지 않는다(동맹·표적 선택은 플레이어의 판단 영역).

### 4.6 타일 점령 비용 — v1.0 공식 재활용 + 3개 항 추가

v1.0의 `tileCost`는 밀도 방어·응집 보너스·중립 sqrt 브레이크를 담고 있고 이 셋 전부가 D항(유지 대상)이다. **그대로 재활용하고 세 개의 곱셈 항만 덧붙인다.**

```
function tileCost(f, tile):
  p = players[f.ownerId]
  if tile.owner == NEUTRAL:
     base = ( NEUTRAL_BASE + NEUTRAL_SQRT_COEF * sqrt(p.tiles) ) * neutralCostMult(p)
     adj  = 1.0                                        // 중립엔 응집 보너스 없음
  else:
     d    = defDensity(tile.owner)                     // 4.7절 — tick 시작 시 1회 캐시
     base = ( ENEMY_BASE + ENEMY_DENSITY_COEF * d ) * defCostMult(tile.owner) * atkCostMult(p)
     n    = |{ x ∈ neighbors(tile) : tile[x].owner == tile.owner }|      // 0..3
     adj  = 1 + ADJACENCY_COEF * n                     // 1.00 ~ 1.45

  return max( MIN_TILE_COST,
              ceil( base * adj
                    * TERRAIN_COST_MULT[tile.terrain]      // ⟵ v2.0: 5종
                    * UNIT_ATK_MULT[f.unit]                // ⟵ v2.0: 병종
                    * endgameRushMult(t) ) )               // ⟵ v2.0: 종반 러시

endgameRushMult(t) = (t >= ENDGAME_RUSH_TICK) ? ENDGAME_RUSH_COST_MULT : 1.0   // 37분 이후 0.75
```

v1.0에서 계승한 설계 의도(그대로 유효):

- **중립 비용에 `sqrt(공격자 타일수)`** — 큰 제국일수록 빈 땅 먹기가 비싸진다. 병력 sqrt 감쇠에 이은 두 번째 브레이크.
- **적 타일 기본값 25 vs 중립 9** — 사람을 치는 것이 빈 땅 먹기보다 2.8배 비싸다. 이게 없으면 초반부터 전면전이 터져 세션이 15분에 끝난다.
- **밀도 계수 3.0** — 밀도 상한 12 → 최대 기여 36. 완충 방어자 타일 `(25+36)×1.25 ≈ 76`, 바닥난 방어자 타일 `25×1.25 ≈ 31`. **2.4배 차이**가 "제국이 한 번 금 가면 급속히 무너지는" 붕괴 캐스케이드를 만든다.
- **응집 보너스** — 뾰족한 돌출부는 싸고 뭉친 본토는 비싸다. 영토를 둥글게 유지하려는 압력.

v2.0 추가 항:

- **`TERRAIN_COST_MULT`** — 2.2절. 실효 가중평균 1.0514로 v1.0(1.04)과 사실상 동일. 평균이 아니라 **분산**을 만든다.
- **`UNIT_ATK_MULT`** — 기병 `0.85` / 검병 `1.00` / 창병 `1.15`. 같은 병력으로 기병이 35% 더 많은 타일을 먹는다.
- **`endgameRushMult`** — 37분 이후 전 타일 −25%. 5.4절이 이 장치에 의존한다.

### 4.7 본국 자동 방어

**방어용 깃발 배치는 없다**(사용자 확정 결정). 방어는 전적으로 밀도로 계산된다.

```
// tick 순서 7단계에서 playerId 오름차순으로 1회 계산하고 캐시한다.
// Phase A/B는 반드시 이 캐시된 값만 읽는다 (결정론 필수 조건).

homeFlagDef(p) = Σ over f ∈ flags(p) where
                    tile[f.posTileId].owner == p.id            // 내 영토 위에 있고
                    AND f.state ∈ { MARCHING, IDLE, RETURNING } // 교전 중이 아닌 깃발
                 of floor( f.troops * HOME_FLAG_DEF_RATIO * UNIT_DEF_MULT[f.unit] )

homeFlagDef(p) = min( homeFlagDef(p), floor(troopCap(p) * HOME_FLAG_DEF_CAP) )   // 0.35

defDensity(p)  = ( p.troops + homeFlagDef(p) ) / max(1, p.tiles)

HOME_FLAG_DEF_RATIO = 0.50
UNIT_DEF_MULT = { SPEAR: 1.50, SWORD: 1.00, CAVALRY: 0.60 }
HOME_FLAG_DEF_CAP   = 0.35        // troopCap 대비
```

**"공격에 쓴 병력은 방어력이 아니다"는 보존된다.**

| 병력의 위치 | 방어 기여 |
|---|---|
| 본국 풀 | **100%** |
| 내 영토를 행군 중인 창병 깃발 | 0.50 × 1.50 = **75%** |
| 내 영토를 행군 중인 검병 깃발 | 0.50 × 1.00 = **50%** |
| 내 영토를 행군 중인 기병 깃발 | 0.50 × 0.60 = **30%** |
| 교전 중(ENGAGED) 깃발 | **0%** |
| 적 영토 위의 깃발 | **0%** (+ 소모 진행) |

즉 **깃발을 내보내는 순간 방어력이 최소 25% 깎이고, 전선에 닿는 순간 100% 사라진다.** 창병의 정체성은 "느리지만 걸어가는 동안 본토를 지킨다"이며, 이는 새 명령을 하나도 추가하지 않고 얻은 역할 분화다.

**상한 0.35의 이유**: 상한이 없으면 깃발 6개를 전부 창병으로 편성해 본국을 배회시키는 "회전 웅크리기"가 최적해가 된다. `troopCap`의 35%로 묶으면 최대 밀도가 `12 + 4.2 = 16.2`, 적 타일 비용이 76 → 89로 **+17%**에 그친다. 완전한 공격 포기의 대가로는 적정하다.

**방어자 병력 손실**은 v1.0과 동일하게 **풀에서만** 빠진다(깃발에서는 빠지지 않는다):

```
타일을 빼앗길 때: players[prevOwner].troops -= floor(cost * DEFENDER_LOSS_RATIO)   // 0.35
```

풀이 0이 되어도 본국 깃발 기여가 남아 밀도가 완전히 0이 되지는 않는다. 병력을 다 쓴 나라가 마지막 창병 부대로 버티는 그림이 자연스럽게 나온다.

### 4.8 tick 단위 교전 해석 — Phase A / Phase B (v1.0 구조 계승)

**Phase A는 tick 시작 시점의 불변 스냅샷만 읽고 아무것도 쓰지 않는다.** 이것이 결정론의 유일한 보증 장치이며 v1.0에서 형태를 바꾸지 않고 그대로 가져왔다. 바뀐 것은 순회 대상이 `order`에서 `ENGAGED 깃발`로 바뀐 것뿐이다.

```
// ─────────── Phase A : 입찰 산출 (쓰기 금지) ───────────
bids : Map<tileId, list<Bid>> = {}
claimedByPlayer : Map<playerId, Set<tileId>> = {}          // 자기 깃발끼리 중복 입찰 방지

for f in flags where f.state == ENGAGED sorted by f.id ASC:
   p = players[f.ownerId]

   maxTiles = ceil( FLAG_TILE_RATE_BASE * UNIT_ASSAULT[f.unit] )    // 창2 검2 기3
   maxSpend = min( f.troops, floor(f.spendBudgetMilli / 1000) )     // ⟵ v2.1. 5b단계에서 동결된 값

   cand = front(f)                                          // 4.1절, 3중 정렬 완료
   if cand is empty: continue                               // 8단계에서 종료 판정

   power = floor( f.troops * UNIT_POWER_PERMILLE[f.unit] / 1000 )    // 주문 단위 1회 계산

   spent = 0; picked = 0
   for tile in cand:
      if picked >= maxTiles: break
      if tile.id ∈ claimedByPlayer[p.id]: continue          // 내 다른 깃발이 이미 찍음
      c = tileCost(f, tile)
      if spent + c > maxSpend: break
      bids[tile.id].push({ flagId: f.id, playerId: p.id, cost: c, power })
      claimedByPlayer[p.id].add(tile.id)
      spent += c ; picked += 1
   plannedSpend[f.id] = spent            // ⟵ v2.1. 로컬 맵에만 기록. 깃발에 쓰지 않는다

// ─────────── Phase B : 낙찰 및 상태 변경 (쓰기) ───────────
defenderExtraLoss : Map<playerId, int> = {}

for tileId in sortedKeys(bids) ASC:                          // tileId 오름차순 = 결정론
   list = bids[tileId]
   prevOwner = tile[tileId].owner

   if list.length == 1:
        winner = list[0]
   else:
        winner = argmax(list, key = (b.power DESC, b.playerId ASC, b.flagId ASC))
        for b in list where b != winner:
             // 격퇴당한 쪽 손실 — 병종 방어력이 여기서 갈린다
             attrition = floor( b.cost * LOSER_ATTRITION_RATIO / UNIT_DEF_MULT[flag(b).unit] )
             flag(b).troopsMilli = max(0, flag(b).troopsMilli - attrition*1000)
             if prevOwner != NEUTRAL:
                  defenderExtraLoss[prevOwner] += floor(b.cost * LOSER_TO_DEFENDER_RATIO)

   // 낙찰 처리
   wf = flag(winner.flagId)
   wf.troopsMilli = max(0, wf.troopsMilli - winner.cost * 1000)
   onTileOwnerChange(tileId, prevOwner, winner.playerId)     // tiles / goldWeight 증분 갱신
   tile[tileId].owner = winner.playerId
   markTileDirty(tileId)
   if prevOwner != NEUTRAL:
        players[prevOwner].troops = max(0, players[prevOwner].troops
                                           - floor(winner.cost * DEFENDER_LOSS_RATIO))

for (pid, extra) in defenderExtraLoss:
   players[pid].troops = max(0, players[pid].troops - extra)

for f in flags where f.state == ENGAGED sorted by f.id ASC:        // ⟵ v2.1
   f.spendBudgetMilli = max(0, f.spendBudgetMilli - plannedSpend[f.id] * 1000)
   // 미사용분은 이월된다. 낙찰 실패분도 예산에서는 차감된다 (병력은 격퇴 마모로 이미 지불)
```

**병력 초과 지출 불가 증명**: Phase A에서 `spent ≤ maxSpend ≤ f.troops`. Phase B에서 한 깃발이 지출하는 총액은 낙찰 비용(`spent`의 부분집합) + 격퇴 마모(`spent`의 부분집합 × `0.5/UNIT_DEF_MULT ≤ 0.834`)이므로 총 지출 ≤ `spent` ≤ `f.troops`. 음수 클램프는 방어적 코드로만 남긴다.

**두 상한이 각각 하는 일**:

- `maxSpend` = 초기 병력의 **1.5%/tick 누적** → 어떤 깃발이든 교전이 **최소 67 tick(13.4초)** 지속된다. "전선이 밀리는" 시각적 시간을 보장하고, 무엇보다 **재발령 주기를 늘려 조작량을 낮춘다**(5.5절).
- `maxTiles` = 병종별 2~3 → 밀도 0인 상대를 칠 때 한 tick에 수십 타일이 순간이동하는 것을 막는다.

#### v2.1 수정 — 지출 예산을 누적식으로 바꾼 이유 (v2.0 잠재 버그)

v2.0은 `maxSpend = ceil(initialTroops × 0.02)`를 **tick마다 버리는 상한**으로 썼다. 그런데 Phase A의 절단 조건이 `spent + c > maxSpend`이므로, **`maxSpend`가 가장 싼 전선 타일 하나보다 작으면 그 깃발은 영원히 한 타일도 못 먹는다.** 4.10절의 소진 판정(`f.troops < cheapest`)에도 걸리지 않으므로 `ENGAGED` 상태로 굳은 채 병력만 들고 서 있게 된다.

중반 표준 조건에서 이 조건이 **항상** 성립한다:

```
중반 깃발 병력 Q ≈ 1,200 → v2.0 maxSpend = 24
중반 적 타일 비용        = 64.4  (5.3절)
24 < 64.4  →  0 타일/tick  →  교착
```

즉 v2.0의 페이싱 표(중반 교전 12초)는 자신의 공식으로는 재현되지 않는다. v2.1은 예산을 **누적(carry-over)** 으로 바꿔 이를 고친다. 그러면 실제 소비 속도는 `0.015 × Q / c` 타일/tick이 되고, **교전 지속시간은 타일 비용과 무관하게 항상 `1 / 0.015 = 66.7 tick`** 으로 고정된다 — v2.0이 의도했던 성질("어떤 깃발이든 교전이 최소 N tick 지속된다")이 이제 실제로 성립한다.

예산 상한(`FLAG_SPEND_BUDGET_CAP_TICKS = 25`, 5초분)과 **`ENGAGED` 상태에서만 누적**한다는 제약이 두 가지 악용을 막는다 — (a) 전선이 비싼 곳에서 오래 대기해 예산을 쌓았다가 한 번에 터뜨리는 버스트, (b) 행군하는 20초 동안 예산을 쌓아 도착 즉시 몰아치는 것. 재지정 시 예산은 0으로 리셋된다(4.4절).

**수치 예시 (v2.1 기준)**: 검병 깃발에 1,500 병력, 중립 비용 30 → 예산 22.5/tick → 1.33 tick마다 1타일 → **67 tick(13.4초)에 50타일**. 같은 깃발이 적 타일(비용 64.4)을 칠 때 → 2.86 tick마다 1타일 → **67 tick에 23타일**. 기병 깃발 1,500, 중립 → 비용 25.5, 예산 22.5/tick → 67 tick에 **59타일**. **기병이 같은 병력으로 18% 더 먹는다** — v2.0의 결론은 그대로다.

### 4.9 동시 다발 상황 처리

같은 tick에 여러 깃발이 같은 타일에 입찰한 경우:

| 규칙 | 내용 |
|---|---|
| **낙찰자** | `power = floor(f.troops × UNIT_POWER_PERMILLE[unit] / 1000)` 최대. 즉 **그 순간 그 부대에 남은 병력이 가장 많은 쪽**(병종 보정) |
| **병종 계수** | 창병 `900` / 검병 `1000` / 기병 `1150`. 기병이 조우전에 강하다 |
| **동률** | `playerId` 오름차순 → `flagId` 오름차순. 둘 다 게임 중 불변이므로 최종 타이브레이커 |
| **낙찰자 비용** | 자기 `tileCost` 전액 지불, 타일 획득 |
| **낙심자 비용** | `tileCost × 0.50 / UNIT_DEF_MULT[unit]` 을 자기 깃발 병력에서 소모. 창병 `0.33×`, 검병 `0.50×`, 기병 `0.83×` — **격퇴당했을 때 창병은 버티고 기병은 갈린다** |
| **원 소유자** | 낙찰자로부터 `낙찰비용 × 0.35`, 낙심자 각각으로부터 `그 비용 × 0.25` 추가 손실. **여럿에게 동시에 찍히면 타일 하나를 잃으면서 병력은 더 크게 깎인다** |
| **같은 플레이어의 깃발끼리** | `claimedByPlayer` 로 애초에 중복 입찰이 발생하지 않는다. 자기 자신과 싸우지 않는다 |
| **동맹** | 동맹/파기 쿨다운 중인 상대 타일은 `front()` 정의에서 제외되므로 입찰 자체가 발생하지 않는다 |

`power`는 타일별이 아니라 **깃발 단위로 Phase A 시작 시 한 번** 계산한다. 그래야 Phase A 안에 순서 의존성이 생기지 않는다.

이 규칙은 "약한 셋이 강자의 같은 지점을 동시에 때리면, 타일은 셋 중 가장 강한 하나가 먹지만 강자의 병력은 세 배로 깎인다"를 만든다. 집중 공격이 영토보다 **소모전**으로 보상되며, 이는 선두 견제 수단이다. **v2.0에서는 여기에 행군 지연이 더해져 "언제 동시에 도착시킬 것인가"라는 조율 문제가 생긴다** — 시야가 전체 공개이므로 상대 깃발의 ETA를 보고 맞출 수 있다. 동맹의 실질 가치가 v1.0보다 올라간다.

### 4.10 깃발 종료 판정 (tick 순서 8단계)

```
for f in flags sorted by f.id ASC:
   cheapest = min tileCost over front(f)            // front 비었으면 null
   if f.state == ENGAGED:
        if front(f) is empty:
             if f.targetOwnerId == NEUTRAL: 4.5절 자동 전환 시도
             if 전환 실패: f.state = IDLE; f.idleSinceTick = t; emit flag_idle
        else if f.troops < cheapest:
             destroy(f); emit flag_ended(reason="exhausted", refunded=0)
             // 소진된 깃발은 환불이 없다. 전선에서 소모된 병력이다.
   if f.state == IDLE and t - f.idleSinceTick >= FLAG_IDLE_TIMEOUT (=600, 2분):
        f.state = RETURNING                          // 자동 회수 (85% 환불)
   if players[f.ownerId].eliminated:
        destroy(f); emit flag_ended(reason="eliminated")
```

**IDLE 깃발은 사라지지 않고 병력을 유지한다.** 내 영토 위에 있으면 방어에 기여하고(4.7절), 2분 후 자동 회수된다. 플레이어가 방치해도 병력이 증발하지 않으므로 초보자에게 관대하다.

### 4.11 병종 3종 종합 (초안 수치)

**상성이 아니라 역할 분화다.** 어떤 병종도 다른 병종을 카운터하지 않는다. 선택 기준은 "상대가 뭘 보냈나"가 아니라 **"내가 지금 뭘 하려는가"** 이다.

| | 창병 SPEAR | 검병 SWORD | 기병 CAVALRY |
|---|---|---|---|
| 이동속도 `UNIT_SPEED` | `0.75` | `1.00` | `1.45` |
| 점령비용 배율 `UNIT_ATK_MULT` | `1.15` (약함) | `1.00` | `0.85` (강함) |
| 본국 방어 기여 `UNIT_DEF_MULT` | `1.50` | `1.00` | `0.60` |
| tick당 점령 상한 `UNIT_ASSAULT` | `0.7` → 2타일 | `1.0` → 2타일 | `1.4` → 3타일 |
| 조우전 우선순위 `UNIT_POWER` | `900` | `1000` | `1150` |
| 편성 비용 `UNIT_CONVERT` | `1.00` | `1.00` | `1.15` |
| **한 줄 정체성** | **느리게 가면서 본토를 지킨다.** 격퇴당해도 살아 돌아온다 | **기준. 고민 없을 때의 답** | **빨리 가서 많이 먹는다.** 비싸고, 지고 나면 남는 게 없다 |
| **쓰는 순간** | 본토가 얇은데 반격은 해야 할 때 / 뺏길 것 같은 국경 쪽으로 | 대부분의 상황 | 빈 땅 선점 / 먼 전선 / 무너진 적 흡수 / 상대 깃발보다 먼저 도착해야 할 때 |

**밸런스 검산 — 기병 독주 방지**: 기병은 편성에 15% 더 들고(`convertCost`) 점령비용은 15% 싸다(`atkMult`). 순 효율은 `1.15 × 0.85 = 0.978` → **같은 풀 병력 대비 2.2%만 유리**하다. 나머지 차이는 전부 속도(+45%)와 방어(−40%)의 트레이드로 정산된다. 기동 T3(`convertEff 1.15`)를 찍으면 기병 편성비가 `1.15/1.15 = 1.00`이 되어 순 효율 `0.85` — **기병 특화 빌드가 성립한다.** 축 선택이 병종 선택으로 이어지는 구조다.

### 4.12 탈락

```
if p.alive and p.tiles == 0:
   p.alive = false
   p.troops = 0; p.gold = 0; p.goldWeight = 0
   모든 깃발 즉시 소멸 (환불 없음)
   모든 동맹 즉시 해제 (쿨다운 없이)
   emit player_eliminated(p.id, byPlayerId = 마지막 타일을 뺏은 플레이어)
```

부활 없음. 탈락자는 관전 모드로 전환되며 같은 소켓으로 다른 룸에 재입장할 수 있다.

---

## 5. 세션 페이싱

목표: **평균 세션 35~41분, 실질 하한 33.8분, 상한 42분(하드 타임아웃)**. 목표 대역 30~60분.

> **v1.0 5장의 계산표는 전부 무효다.** 전투 모델이 바뀌었으므로 아래는 처음부터 다시 계산한 것이다. 페이싱에 새로 개입하는 세 가지는 **깃발 행군 지연 / 깃발 개수 상한 / 지형 가중평균**이며, 여기에 **종반 러시**가 수렴 장치로 추가됐다.
>
> **v2.1 재검산 요약**: 기지가 행군 지연을 줄이고 `FLAG_SPEND_RATE`가 0.020 → 0.015로 바뀌면서 아래 표들이 갱신됐다. 결과는 **1단계 8.72 → 8.46분, 표준 종료 40.0 → 39.3분, 실질 하한 34.5 → 33.8분**이며 **`REGEN_SQRT_COEF`(0.50)와 `NEUTRAL_BASE`(9)는 바꾸지 않았다.** 근거는 5.1.1절.

### 계산 근거

#### 5.1 깃발 모델이 처리량에 미치는 영향 — 실효계수 분해

v1.0에서는 명령 하나가 병력 풀을 연속적으로 빨아들였다. v2.0에서는 병력이 **깃발에 커밋된 뒤 행군하는 동안 아무것도 하지 않는다.** 이게 얼마나 손해인지 먼저 정량화해야 나머지 계산이 의미를 갖는다.

**깃발 사이클** 하나는 `T_cycle = T_행군 + T_교전 + T_공백` 이다.

| 국면 | 제국 반경 | T_행군 (검병) | T_교전 | T_공백 | **T_cycle** | 깃발 수 |
|---|---|---|---|---|---|---|
| 초반 (T≈50) | 4타일 | 7.5초 | 10초 | 3초 | **20.5초** | 3 |
| 중반 (T≈390) | 11타일 | 20.7초 | 12초 | 3초 | **35.7초** | 4 |
| 종반 (T≈900) | 17타일 | 32.0초 | 15초 | 3초 | **50.0초** | 5~6 |

(행군 = 반경 ÷ 0.6타일/초 × 지형 이동 가중평균 1.126)

**핵심 관찰: 행군은 병력을 파괴하지 않고 지연시킬 뿐이다.** 깃발을 **엇갈려(staggered) 발령**하면 파이프라인이 채워져 정상상태 처리량은 재생률 `R`에 수렴한다. 실제 처리량 상한은 `F × Q / T_cycle` 인데(F=깃발 수, Q=깃발당 병력), 중반 기준 `4 × 1200 / 0.595분 = 8,067 병력/분` 으로 재생률 `R ≈ 2,242 병력/분`의 3.6배다. → **깃발 메커니즘 자체는 병목이 아니다.**

병목은 다른 데 있다. 실효계수를 항목별로 분해하면:

| 손실 요인 | 계수 | 설명 |
|---|---|---|
| 국경 중복·비효율 확장 경로 | `×1.12` | 이웃과 겹치는 경계, 디스크 밖 잔여 타일 |
| 인간 반응 공백 | `×1.13` | 깃발 재발령 3초 갭 ÷ T_cycle 20~36초 |
| 행군 중 풀 적체로 인한 로지스틱 스로틀 | `×1.10` | 엇갈림이 완벽하지 않으면 `troops/cap`이 올라 재생이 눌린다 |
| 도달 불가 포켓 / 산 우회 | `×1.05` | 산 8%의 벽 효과 |
| **1단계 종합 비효율** | **`×1.46`** | (v1.0은 `×1.30`이었고 지형까지 포함한 값이었다) |

v1.0의 `1.30`에서 지형분(약 4%)을 빼면 `1.25`. v2.0의 `1.46`은 여기에 **깃발 파이프라인 슬랙 약 +17%** 가 얹힌 값이다. 지형은 이제 비용 공식에 직접 들어가므로 계수에서 뺐다.

**중·종반 실효계수는 `×1.33`(효율 0.75)로 완화된다.** T_cycle이 36~50초로 길어지면서 고정 3초 공백의 비중이 8.4%→6%로 떨어지고, 깃발이 4~6개로 늘어 엇갈림이 자연스러워지기 때문이다. (`1.12 × 1.07 × 1.10 × 1.05 = 1.385` → 정상상태 엇갈림 개선분을 반영해 `1.33` 채택)

> **결론: `REGEN_SQRT_COEF` 0.45 → 0.50 (수입 +10.1%), `NEUTRAL_BASE` 10 → 9 (초기 확장 비용 −3.5%)로 이 손실을 상쇄한다.** 합계 약 +14%로 1단계 비효율 증가분(+17%)을 거의 정확히 덮는다. 아래 표가 그 결과다.

#### 5.1.1 기지 보유 수가 실효계수·템포에 미치는 영향 (v2.1 신규)

**먼저 확인할 것**: 5.1절의 핵심 관찰 — *"행군은 병력을 파괴하지 않고 지연시킬 뿐"* 이고 *"깃발 메커니즘 자체는 병목이 아니다(처리량 여유 3.6배)"* — 는 **기지가 생겨도 그대로다.** 처리량을 묶는 것은 여전히 재생률 `R`이다. 따라서 **기지가 처리량을 크게 올릴 수 없다**는 것이 출발점이며, 이것이 아래 검산의 결론을 미리 규정한다.

**행군 단축 모델**: 반경 `r`인 제국에서 기지 `B`개를 가졌을 때 평균 행군 거리 배율을 `MARCH_COVERAGE[B]`로 둔다. 기지 1개(수도)면 모든 전선까지 `r`이고, 전진 기지가 하나 생기면 그 방향의 전선은 거의 0이 된다. 합리적 플레이어는 기지가 있는 방향으로 작전을 60% 몰고 나머지 40%는 어쩔 수 없이 원거리 전선에 쓴다고 본다.

| B (보유 기지) | `MARCH_COVERAGE` | 근거 |
|---|---|---|
| 1 (수도만) | `1.00` | v2.0 기준선 |
| 2 (수도 + 전진 1) | `0.61` | 0.6×0.35 + 0.4×1.00 |
| 3 | `0.43` | 0.6×0.35 + 0.4×0.55 |
| 4+ | `0.35` | 0.6×0.30 + 0.4×0.42 |

**중반(T≈390) T_cycle** — `FLAG_SPEND_RATE` 0.015 반영(교전 12초 → 16초, 4.8절):

| B | T_행군 | T_교전 | T_공백 | **T_cycle** | 작전 회전율(슬롯당/분) |
|---|---|---|---|---|---|
| 1 | 20.7초 | 16초 | 3초 | **39.7초** | 1.51 |
| 2 | 12.6초 | 16초 | 3초 | **31.6초** | 1.90 (+26%) |
| 3 | 8.9초 | 16초 | 3초 | **27.9초** | 2.15 (+42%) |
| 4 | 7.2초 | 16초 | 3초 | **26.2초** | 2.29 (+52%) |

**실효계수 재분해.** 5.1절의 네 항 중 기지가 움직이는 것은 두 개다. 나머지 두 개(국경 중복 `1.12`, 산 우회 `1.05`)는 기지와 무관하다.

- **인간 반응 공백**: `1 + 0.07 × (32.7 / (T_cycle − 3))` — 사이클이 짧아지면 고정 3초 공백의 비중이 **커진다**(불리).
- **로지스틱 스로틀**: `1 + 0.10 × (행군비중 / 0.580)` — 행군이 짧아지면 슬롯이 빨리 비어 풀이 자주 배출되므로 적체가 **줄어든다**(유리).

| B | 공백 | 스로틀 | 곱(×1.12×1.05) | 엇갈림 보정 | **실효계수** | **효율** | vs B=1 |
|---|---|---|---|---|---|---|---|
| 1 | 1.062 | 1.090 | 1.362 | −4% | **1.307** | 0.765 | — |
| 2 | 1.080 | 1.069 | 1.358 | −5% | **1.290** | 0.775 | **+1.3%** |
| 3 | 1.092 | 1.055 | 1.355 | −6% | **1.274** | 0.785 | **+2.6%** |
| 4 | 1.099 | 1.047 | 1.354 | −7% | **1.259** | 0.794 | **+3.8%** |

> **핵심 결과: 두 항이 서로를 거의 정확히 상쇄한다.** 보정 전 곱은 1.362 → 1.354로 0.6%밖에 안 움직인다. 남는 차이는 대부분 "깃발이 자주 돌아오니 엇갈려 발령하기 쉬워진다"는 보정분이다. **기지를 4개 쥔 선두와 1개뿐인 하위권의 순수 처리량 격차는 +3.8%에 불과하다.**

**그럼 기지는 무엇을 사는가 — 격차의 실체.**

| 지표 | B=1 | B=2 | B=3 | B=4 | 성격 |
|---|---|---|---|---|---|
| 처리량 효율 | 0.765 | 0.775 | 0.785 | 0.794 | **+3.8%** — 미미 |
| 작전 회전율 (슬롯당/분) | 1.51 | 1.90 | 2.15 | 2.29 | **+52%** — 결정적 |
| 반격 도달 시간 | 20.7초 | 12.6초 | 8.9초 | 7.2초 | **−65%** — 결정적 |
| 본국 방어 기여 가중 | 0.336 | 0.294 | 0.268 | 0.252 | **−25%** — 대가 |

(본국 방어 기여 가중 = `행군비중 × 0.50 + 공백비중 × 1.00`. 4.7절 규칙상 ENGAGED 깃발의 기여는 0이므로, 사이클이 짧아질수록 군대가 "교전 중" 상태로 보내는 시간 비중이 커진다.)

> **기지는 처리량이 아니라 주도권을 산다. 그리고 그 대가로 본국 방어 밀도를 판다.** 기지 4개를 쥔 선두는 어디든 7초 안에 부대를 들이밀 수 있지만, 같은 순간 자기 병력의 61%가 전선에 묶여 방어에 0을 기여한다(B=1은 40%). **이것이 자동 견제 장치다** — 기지를 독식한 플레이어는 빠르지만 얇아지고, 5.3절의 붕괴 캐스케이드와 4.9절의 다자 협공에 더 취약해진다. 기지 쟁탈이 일방적 눈덩이가 되지 않는 구조적 이유다.

**상수를 바꾸지 않는 이유**: 최대 격차 +3.8%는 v2.0이 이미 오차 범위로 처리한 폭(2.2절 지형 실효 가중평균 +1.1%, 5.1절 상쇄 오차 ±3%)과 같은 자릿수다. `REGEN_SQRT_COEF`나 `NEUTRAL_BASE`를 건드리면 **검증된 v2.0 계산 전체를 다시 돌려야 하는데 얻는 정밀도가 그보다 작다.** → **유지.** 실제로 손대는 상수는 `FLAG_SPEND_RATE` 하나이며, 그 이유는 페이싱이 아니라 **조작량**과 **4.8절 버그 수정**이다.

#### 5.1.2 기동 테크 축 잠식 검토 (v2.1 필수 검증)

**문제 제기**: 전진 기지의 효과는 행군 시간 단축이고, 기동 축 `flagSpeedMult`의 효과도 같다. v2.0은 기동 축을 *"행군 지연은 조건 없이 항상 존재하므로 사장 위험이 없다"*는 근거로 정당화했는데, 기지가 그 전제를 약화시킨다.

**먼저 범위를 좁힌다.** 기동 축의 세 효과 중 기지와 경쟁하는 것은 **하나뿐**이다.

| 기동 축 효과 | 기지가 잠식하는가 | 이유 |
|---|---|---|
| `flagSpeedMult` (이동속도) | **예** | 둘 다 행군 시간을 줄인다 |
| `flagSlotBonus` (슬롯 +0/+1/+2) | 아니오 | 기지는 깃발 수를 늘리지 않는다(사용자 확정). 완전 독립 |
| `convertEffMult` (병종 전환 효율) | 아니오 | 편성 비용 축. 위치와 무관 |

**두 효과는 곱해진다**: `행군시간 = 거리(기지가 결정) ÷ 속도(기동이 결정)`. 곱셈 관계이므로 어느 쪽도 상대를 0으로 만들지 못한다. 그러나 **절대 절감량은 줄어든다** — 거리가 짧아지면 같은 배속이 아끼는 초가 줄기 때문이다. 실제로 얼마나 줄어드는지 검산한다.

**v2.0 수치(`1.30`)를 그대로 뒀을 때** — 중반, `T_교전+공백 = 19초`:

| B | T_cycle 무테크 | T_cycle 기동T1(×1.30) | 회전율 이득 |
|---|---|---|---|
| 1 | 39.7초 | 34.9초 | +13.8% |
| 2 | 31.6초 | 28.7초 | **+10.1%** |
| 3 | 27.9초 | 25.8초 | **+8.1%** |
| 4 | 26.2초 | 24.5초 | **+6.9%** |

다른 축의 T1 환산 이득은 군사 **+15%**, 영토 **+13.6%**, 경제 **+6% 즉시 + 복리 +25%** 다. 기지 2개 이상에서 기동 T1이 **+6.9~10.1%로 대역 최하위로 떨어진다.** 특히 기지를 잘 확보한 플레이어에게 최약체가 되는데, **이는 "잘 하고 있는 사람이 살 이유가 없는 축"이라는 최악의 형태의 사장**이다. → **재조정이 필요하다는 것이 검증됐다.**

**조정: `flagSpeedMult` 1.30/1.55/1.85 → `1.45/1.72/2.00`.** 단계 간 비율(×1.19)은 v2.0과 동일하게 유지하고 전체를 15.4% 위로 옮겼다.

| B | T_cycle 무테크 | T_cycle 기동T1(×1.45) | **회전율 이득** |
|---|---|---|---|
| 1 | 39.7초 | 33.3초 | **+19.3%** |
| 2 | 31.6초 | 27.7초 | **+14.1%** |
| 3 | 27.9초 | 25.1초 | **+11.0%** |
| 4 | 26.2초 | 24.0초 | **+9.3%** |

**추가 조정: `convertEffMult` 1.05/1.10/1.15 → `1.08/1.15/1.22`.** 기병 편성비 −4.5% → **−7.4%**. 이 효과는 기지와 완전히 독립이므로 **기지 4개 구간의 바닥을 받쳐주는 역할**을 한다. 기동 T1의 총 가치는 이제 `회전율 +9.3~19.3%` + `기병 작전 병력 효율 +7.4%`가 되어, 최악 구간(B=4)에서도 경제 T1의 즉시 이득(+6%)을 넘는다.

**4축 T1 최종 비교 (v2.1)**:

| 축 T1 | 환산 이득 | 대역 안인가 |
|---|---|---|
| 군사 | 대인 교환비 +15% | 기준 |
| 경제 | 병력 +6% 즉시, 테크 속도 +25% 복리 | ✓ |
| 영토 | 중립 확장 +13.6%, 웅크리기 상한 +10% | ✓ |
| **기동 (v2.1)** | **작전 회전율 +9.3~19.3%** + 기병 편성비 −7.4% | ✓ (중앙값 약 +14%) |

> **결론: 기동 축은 사장되지 않는다.** 그리고 조정 후 **역방향 성질**이 하나 생겼다 — 기지를 못 가진 쪽일수록 기동 축의 이득이 크다(B=1에서 +19.3%). 즉 **기동 축이 기지 쟁탈에서 밀린 플레이어의 만회 수단**이 된다. 이는 우연이 아니라 곱셈 관계에서 자연히 따라오는 성질이며, 4축 중 유일하게 "지고 있을수록 강해지는" 축이라는 고유 정체성을 준다.
>
> **부작용 확인**: `convertEffMult` T3가 1.22가 되면 기병 순 효율이 `1.15 / 1.22 × 0.85 = 0.801`이 되어 v2.0(0.85)보다 5.8% 강해진다. 기병 특화 빌드가 더 선명해지는 것은 4.11절의 의도된 방향이지만, 관측 항목으로 미결정 사항 4번에 추가했다.

#### 5.2 1단계 — 초기 확장 (중립 점령)

```
분당 병력 수입 = ( 0.8 + 0.50·√T ) × 300 tick/분 × u ,   u = 0.7 (확장 중 로지스틱 이용률)
                = ( 0.8 + 0.50·√T ) × 210
중립 타일 비용 C(T) = ( 9 + 1.0·√T ) × 1.0514          // 1.0514 = 지형 실효 가중평균 (2.2절)
```

| T (보유 타일) | 분당 수입 | 타일당 비용 | **분당 확장(gross)** |
|---|---|---|---|
| 9 | 483 | 12.62 | 38.3 |
| 50 | 911 | 16.90 | 53.9 |
| 100 | 1,218 | 19.98 | 61.0 |
| 200 | 1,653 | 24.33 | 67.9 |
| 300 | 1,987 | 27.68 | 71.8 |
| 390 | 2,242 | 30.23 | 74.1 |

구간별 소요 시간 (`Δ타일 ÷ 구간 평균속도`):

| 구간 | Δ타일 | 평균 속도 | 소요 |
|---|---|---|---|
| 9 → 50 | 41 | 46.1 | 0.889분 |
| 50 → 100 | 50 | 57.5 | 0.870분 |
| 100 → 200 | 100 | 64.5 | 1.550분 |
| 200 → 300 | 100 | 69.9 | 1.431분 |
| 300 → 390 | 90 | 73.0 | 1.233분 |
| **합계** | **381** | | **5.973분** |

**v2.1 재계산 — 1단계는 기지의 영향을 받지 않는다.** 중립 기지는 수도에서 최소 12타일 떨어져 있고(2.6절), 1단계 종료 시점의 제국 반경은 약 11이다. 즉 **기지는 1단계가 끝날 무렵에야 손이 닿는다** — 이는 우연이 아니라 `BASE_MIN_CAPITAL_DIST = 12`를 그렇게 고른 결과이며, **기지 쟁탈을 2단계(고착 구간)의 콘텐츠로 배치**하려는 의도다. 따라서 1단계에서 바뀌는 것은 `FLAG_SPEND_RATE` 하나뿐이다.

```
T_cycle(초반) = 7.5(행군) + 13.3(교전, 0.015) + 3(공백) = 23.8초   // v2.0: 20.5초
공백   = 1 + 0.13 × (20.5−3)/(23.8−3)        = 1.109              // v2.0: 1.13
스로틀 = 1 + 0.10 × (7.5/23.8)/(7.5/20.5)    = 1.086              // v2.0: 1.10
1단계 실효계수 = 1.12 × 1.109 × 1.086 × 1.05 = 1.4166             // v2.0: 1.46
```

> **1단계 = 5.973 × 1.4166 = 8.46분.** (v2.0: 8.72분, v1.0: 8.5분)
> 이 시점에 육지 3,900타일 중 산악 벽을 뺀 대부분이 소진되고 10인 전원이 서로 국경을 맞댄다. **중립 기지 10개도 이 무렵(대략 7~10분) 전부 임자가 정해진다.**
> → `BOT_NEUTRAL_BIAS_TICK = 2538` (8.46분) — v2.0의 2610에서 변경

#### 5.3 2단계 — 중반 교전

비용이 중립 30에서 적 타일로 급등한다. 평균 방어 밀도 `d = 8`(상한 12의 67%), 응집 `adj = 1.25`, 지형 `1.0514`, 검병 `1.00`:

```
건강한 방어자 타일 = (25 + 3.0×8) × 1.25 × 1.0514 = 64.4
무너진 방어자 타일 = (25 + 0)     × 1.25 × 1.0514 = 32.9
```

| 상황 | 분당 수입 | 타일당 비용 | gross | **실효(×0.75)** |
|---|---|---|---|---|
| T=390 vs 밀도 8 | 2,242 | 64.4 | 34.8 | **26.1** |
| T=600 vs 밀도 8 | 2,740 | 64.4 | 42.5 | **31.9** |
| T=600 vs 밀도 0 | 2,740 | 32.9 | 83.3 | **62.5** |
| T=900 vs 밀도 8 | 3,318 | 64.4 | 51.5 | **38.6** |
| T=900 vs 밀도 0 | 3,318 | 32.9 | 100.9 | **75.7** |

핵심 수치는 밀도 0 줄이다. **방어자 병력 풀이 바닥나면 정복 속도가 정확히 1.96배로 뛴다.** 그리고 4.7절 규칙상 타일을 빼앗길 때마다 방어자는 `비용×0.35`를 추가로 잃으므로 밀도가 떨어질수록 더 빨리 떨어지는 **양의 되먹임**이 걸린다. 이것이 붕괴 캐스케이드이며 3단계를 짧게 만든다.

(v1.0의 캐스케이드 배율은 2.34였다. v2.0에서 1.96으로 완화된 것은 본국 깃발 방어 기여(4.7절) 때문에 밀도가 완전한 0까지 떨어지지 않는 경우가 생기기 때문이며, 의도된 방향이다 — 급사가 줄고 역전 여지가 는다.)

**v2.0에서 새로 생긴 고착 요인 — 깃발 수 상한.** 10인 보드에서 각 플레이어의 평균 인접 국경 수는 약 2.4다. v1.0에서는 명령이 1개뿐이라 어차피 한 곳만 밀었지만, v2.0에서는 **깃발 4~5개 중 2~3개는 항상 행군 중**이므로 실제로 동시에 압력을 넣을 수 있는 전선은 **1~2곳**이다. 남은 국경은 방치된다.

> 이것은 버그가 아니라 설계다. "전 전선 동시 공세"가 구조적으로 불가능하므로 **동맹의 가치가 v1.0보다 올라가고**, 동시에 5.5절의 조작량이 묶인다.

동등한 실력이면 전선이 고착된다. 우위는 **네 곳**에서 나온다 (v2.1에서 4번이 추가됐다).

1. **크기** — 600타일이 300타일을 칠 때: 600측 gross 42.5, 300측 gross 30.8 → 순증 gross +11.7, 실효 **+8.8타일/분**.
2. **테크** — 군사 T3 + 기동 T2 조합이면 대인 효율 약 +22%, 작전 회전율 **+20~28%**(기지 수에 따라, 5.1.2절).
3. **동맹** — 2인이 한 명에게 공세를 몰면 실효 52타일/분 대 방어자 26타일/분. 무너뜨리는 유일한 확실한 수단.
4. **기지 (v2.1 신규)** — 처리량 자체는 +1.3~3.8%뿐이지만 **작전 회전율이 +26~52%** 다(5.1.1절). 고착된 전선에서 이것이 갖는 의미는 "같은 병력으로 더 많이 먹는다"가 아니라 **"상대보다 자주 먼저 도착한다"** 이다. 4.9절 동시 입찰에서 늦게 도착한 쪽은 이미 밀도가 회복된 타일을 상대해야 한다.

> **2단계가 v2.1에서 달라지는 점**: v2.0은 이 구간을 "구조적 고착"으로 설계했고 그 판단은 유효하다. 기지는 고착을 **깨지 않고**(처리량 격차가 4% 미만이므로) 그 위에 **명확한 국지 목표**를 얹는다. 17분짜리 교착 구간에 "어디를 밀어야 하는가"라는 질문이 생기는 것이 v2.1이 이 구간에 더한 전부이며, 그것으로 충분하다.

> **2단계 = 8.46분 ~ 약 26분 (약 17.5분).** 이 구간에서 통상 3~5명이 탈락하고, 상위 2~3명이 각 700~1,100타일로 성장한다. 선두는 대략 22분에 3번째 기지(무너진 이웃의 것)를, 30분에 4번째를 확보한다.

#### 5.4 3단계 — 종반 정리 + 강제 수렴 장치

**(a) 임계값 하강** (v1.0 유지):

```
threshold(t) = clamp( 60 - 1.2 * max(0, (t - 6600) / 300), 45, 60 )   // t = tick

  22분(6600 tick)까지  : 60%
  22분 → 34.5분        : 분당 -1.2%p
  34.5분(10350 tick)   : 45% 하한 고정
  42분(12600 tick)     : 하드 타임아웃
```

**(b) 종반 러시** (v2.0 신규 — design-decisions C항):

```
t >= ENDGAME_RUSH_TICK (11100, 37분)  →  모든 tileCost × 0.75
```

정복 속도가 그대로 **×1.333** 이 된다. 신규 동맹 마감(`ALLIANCE_CUTOFF_TICK`)도 같은 37분이므로, **마지막 5분은 외교 없는 순수 난전**으로 선언된다.

**(c) 붕괴 캐스케이드** — 5.3절.

**검산 — 선두 플레이어의 타일 곡선 (v2.1 재계산).** 순수 소모전만으로는 45%에 도달할 수 없다(5.3절 순증 +8.8/분으로는 60분이 넘는다). 실제 동력은 **탈락자 영토의 재분배**다. 아래는 생존자 수 감소 + **선두의 기지 확보 타임라인**을 반영한 곡선이다.

선두의 기지 보유 수와 그에 따른 효율 배율(5.1.1절, 기준 = v2.0의 0.752):

| 구간 | 보유 기지 B | 효율 | vs v2.0 |
|---|---|---|---|
| ~9.5분 | 1 (수도) | 0.765 | ×1.017 |
| 9.5~22분 | 2 (셀 내 중립 기지 확보) | 0.775 | ×1.031 |
| 22~30분 | 3 (첫 탈락자의 기지) | 0.785 | ×1.044 |
| 30분~ | 4 | 0.794 | ×1.056 |

| 시각 | 생존자 | 선두 타일 | 점유율 | threshold | 구간 순증 | 근거 |
|---|---|---|---|---|---|---|
| **8.46분** | 10 | 390 | 10.0% | 60% | — | 1단계 종료 (v2.0: 8.7분) |
| 15분 | 10 | 508 | 13.0% | 60% | +18.0/분 | 잔여 중립 소진 + 기지 1개 확보 |
| 20분 | 9 | 652 | 16.7% | 60% | +28.9/분 | 첫 탈락자 영토 일부 흡수 |
| 25분 | 7 | 870 | 22.3% | 56.4% | +43.5/분 | 2명 추가 탈락, 캐스케이드 진입, 3번째 기지 |
| 30분 | 5 | 1,152 | 29.5% | 50.4% | +56.4/분 | 실효 62.5(밀도 0 상대) − 피격 |
| 34.5분 | 4 | 1,374 | 35.2% | **45%** | +49.3/분 | 남은 상대는 강자 → 밀도 회복, 속도 저하 |
| 37분 | 3 | 1,500 | 38.5% | 45% | +50.7/분 | **러시 발동** |
| **39.3분** | 2~3 | **1,755** | **45.0%** | 45% | **+108.8/분** | 실효 75.7 × 1.333 × 1.056 → **threshold 도달, 승리** |

> **표준 게임 종료 = 약 39.3분** (v2.0: 40.0분). 기지가 −0.4분, `FLAG_SPEND_RATE` 인하에 따른 1단계 단축이 −0.3분 기여했다.

**미결정 8번 재검토 — 종반 러시 여유가 더 위태로워지는가**: **아니다. 오히려 넓어졌다.**

| | v2.0 | **v2.1** |
|---|---|---|
| 표준 종료 | 40.0분 | **39.3분** |
| 하드 타임아웃 | 42.0분 | 42.0분 |
| **여유** | 2.0분 | **2.66분** (+33%) |

이유는 구조적이다 — 기지는 **선두를 가속하는 장치**이고, `ENDGAME_RUSH`가 보정하려던 것이 정확히 "선두가 threshold에 못 닿고 타임아웃되는 것"이다. 두 장치가 같은 방향으로 작동한다. **단, 조건이 붙는다**: 위 곡선은 선두가 실제로 기지 3~4개를 확보한다고 가정한다. 기지가 끝까지 분산 소유되어 모두가 B=2에 머무르면 효율 배율이 ×1.031로 고정되고 여유는 약 2.2분으로 돌아간다. 그래도 v2.0보다는 낫다. **따라서 미결정 8번은 해결이 아니라 "위험도 하향"으로 유지한다.**

**하한 검증**: 선두가 모든 구간에서 40% 빠른 최상 시나리오(초반 2:1 조기 붕괴)에 v2.1의 효율 이득(최대 ×1.056)을 곱하면, threshold 곡선과 만나는 지점이 34.5분 → **약 33.8분**으로 앞당겨진다.

```
33.5분: 선두 ≈ 1,758 (45.1%)  vs  threshold 46.2%  → 미달
33.8분: 선두 ≈ 1,799 (46.1%)  vs  threshold 45.8%  → 도달
```

그 이전에 끝나려면 30분 시점에 50.4%(1,966타일)를 넘어야 하는데 5.3절 최대 실효속도(75.7/분 × 1.056 = 79.9/분)로도 불가능하다. → **실질 하한 33.8분. 목표 하한 30분까지 3.8분 여유.**

**상한 검증**: 3~4명이 균형을 이루면 아무도 45%를 못 찍고 42분 하드 타임아웃 → 점유율 1위 승리. 무승부 없음. (변경 없음)

> ### 결론: 예상 세션 분포 = **33.8분(실질 최단) ~ 42분(하드 캡), 중앙값 38.5~40.5분.**
> 목표 30~60분 안에 안전하게 수렴한다. v2.0(34.5~42분, 중앙값 39~41분) 대비 **전체가 약 0.7분 앞당겨졌을 뿐 분포 폭은 그대로**다. 기지가 "선두를 폭주시킨다"는 우려는 5.1.1절 검산으로 기각됐다 — 처리량 격차가 4% 미만이기 때문이다.

#### 5.5 조작량(APM) 추정 — 설계 리스크 대응

v1.0의 문제는 "1분에 한 번 조작"으로 할 일이 없다는 것이었다. 깃발 모델은 **반대로 넘어갈 위험**이 있으므로 반드시 수치로 확인한다.

```
분당 깃발 발령 횟수 = 깃발 수 F × 60초 / T_cycle
```

**v2.1 재검산 — 기지가 이 계산을 두 번 흔든다.** (a) 행군이 짧아져 `T_cycle`이 줄고 발령이 잦아진다 — **악화 요인**. (b) 출발 기지 선택이라는 조작 단계가 생긴다 — **악화 요인**. 그대로 두면 v2.0이 확보한 13~18 대역이 깨진다.

**(a) 조정 전 — 기지만 반영했을 때 (`FLAG_SPEND_RATE = 0.02` 유지 가정)**

| 국면 | F | B | T_cycle | 분당 발령 | **분당 액션** | 판정 |
|---|---|---|---|---|---|---|
| 초반 | 3 | 1 | 20.5초 | 8.8회 | 17.6 | 유지 |
| 중반 | 4~5 | 2 | 27.6초 | 9.8회 | **19.6** | ✗ 초과 |
| 종반 | 5~6 | 3 | 31.8초 | 10.4회 | **20.8** | ✗ 5.5절 조정 트리거(20) 돌파 |

**(b) 조정 후 — `FLAG_SPEND_RATE` 0.020 → 0.015 적용.** v2.0이 지정한 1순위 레버를 그대로 당겼다: *"교전이 길어져 T_cycle이 늘고 발령 빈도가 떨어진다. 게임의 다른 어떤 것도 건드리지 않는 가장 안전한 레버."*

| 국면 | F | B | T_행군 | T_교전 | T_공백 | T_cycle | 분당 발령 | **분당 액션** |
|---|---|---|---|---|---|---|---|---|
| 초반 (0~8.5분) | 3 | 1 | 7.5초 | 13.3초 | 3초 | 23.8초 | 7.56회 | **15.1** |
| 중반 (8.5~26분) | 4~5 | 2 | 12.6초 | 16초 | 3초 | 31.6초 | 8.54회 | **17.1** |
| 종반 (26~42분) | 5~6 | 3 | 13.8초 | 20초 | 3초 | 36.8초 | 8.97회 | **17.9** |

**(c) 출발 기지 수동 변경분.** 기본값(자동 선택)이 발령당 2액션을 유지하므로(4.3절), 추가 비용은 플레이어가 자동 선택을 뒤집을 때만 발생한다. 변경이 **슬롯에 sticky** 하게 남으므로 발령마다 다시 누를 필요가 없다 — 추정 발생률 5~15%.

| 시나리오 | 배율 | 초반 | 중반 | 종반 |
|---|---|---|---|---|
| 자동 선택만 | ×1.00 | 15.1 | 17.1 | 17.9 |
| 수동 변경 5% (sticky 정상 사용) | ×1.025 | 15.5 | 17.5 | 18.3 |
| 수동 변경 15% (sticky 미사용) | ×1.075 | 16.2 | 18.4 | **19.2** |

여기에 테크 구매(세션당 3~6회)와 동맹(세션당 2~5회)을 더해도 무시할 수준이다.

> **평균 15~18 액션/분(자동), 최악 19.2(수동 15%) = 3.1~4.0초에 한 번.**
> - v1.0: 1~2 액션/분 (너무 적음) / v2.0: 13~18
> - territorial.io: 약 10~20 액션/분 · generals.io: 30~60 APM
>
> **v2.0의 13~18 대역이 15~18로 상향·압축됐고, 조정 트리거(20)와 초보 학살선(25)은 여전히 넘지 않는다.** 하한이 13 → 15로 올라간 것은 오히려 개선이다 — v2.0에서 종반이 13.2로 가장 심심했는데, 기지 덕분에 종반이 가장 바쁜 구간이 됐다. 이는 "마지막 5분이 무의미하다"는 v1.0 미결정 7번의 잔여 증상까지 함께 줄인다.

**극단 케이스 (v2.1 신규 관측 항목)**: 종반 선두가 `기동 T3(×2.00)` + `기지 4개` + `슬롯 7`을 모두 갖추면 `T_cycle = 5.6 + 20 + 3 = 28.6초` → `7 × 60/28.6 × 2 = 29.4 액션/분`이다(v2.0의 같은 조건: 23.8). **25선을 넘는다.** 다만 이는 세션당 한 명, 마지막 몇 분에만 성립하는 최대 투자 빌드이며 그 시점에는 이미 승패가 기울어 있다. 지정 레버는 `FLAG_TILES_PER_SLOT` 300 → 400(슬롯 증가 지연)이며 미결정 사항 5번에 관측 지표와 함께 남겼다.

**병종 3종이 조작량을 늘리지 않는 이유**: 병종은 **발령 시 단축키 1회**(1/2/3)이며 발령 후에는 변경 자체가 금지되어 있다. 즉 병종은 액션 수를 늘리는 축이 아니라 **한 액션 안의 선택지를 늘리는 축**이다. `N개 깃발 × M개 전선 × 3 병종`의 곱셈 폭발은 발생하지 않는다.

**브레이크와 조정 순서**: 실측에서 분당 액션이 **20을 넘으면** 다음 순서로 낮춘다.

1. ~~`FLAG_SPEND_RATE` 0.02 → 0.015~~ — **v2.1에서 이미 소진했다.** 남은 여지는 0.015 → 0.012이며 교전이 13.3초 → 16.7초로 길어진다. 여전히 가장 안전한 레버지만, 더 낮추면 "한 작전이 너무 오래 끈다"는 반대쪽 문제가 생기므로 0.012를 하한으로 본다.
2. **출발 기지 수동 변경 UI를 sticky로 강제** — 5.5(c)의 15% 시나리오를 5%로 끌어내린다. 코드 수정 없이 클라이언트만 고치면 되는 가장 싼 레버이며, v2.1에서는 이것이 실질 1순위다.
3. `FLAG_IDLE_TIMEOUT` 활용 — IDLE 깃발이 병력을 유지하므로, 방치 페널티가 없다는 점을 튜토리얼에서 강조해 "쉬어도 된다"는 신호를 준다.
4. `FLAG_TILES_PER_SLOT` 300 → 400 — 깃발 증가를 늦춘다. **극단 케이스(29.4 액션/분)의 지정 레버이기도 하다.**
5. **`FLAG_CAP_BASE` 3은 마지막까지 건드리지 않는다.** 초기 3개가 이 설계의 브레이크 자체이고, 2로 낮추면 초반이 다시 심심해진다. 사용자가 v1 설계 단계에서 "타일→타일 명령"을 거부한 이유가 정확히 APM 폭발이었으므로, **상한을 낮추는 방향은 있어도 올리는 방향은 없다** — `FLAG_CAP_HARD_MAX`를 7 이상으로 올리는 변경은 금지한다.

#### 5.6 테크 구매 횟수 검산

골드 산출은 `0.965(지형 가중평균) × 1.55 × 300 tick/분 / 1000 = 0.4487 골드/타일/분` — v1.0(0.45)과 동일하다. 세션 누적 "타일·분"을 적분한다.

| 플레이어 | 타일·분 적분 | 누적 골드 (+시작 200) | 누진 비용으로 살 수 있는 노드 |
|---|---|---|---|
| **선두** (5.4절 곡선, 40분 승리) | ≈ 29,700 | 13,530 | 450+562+1650+1925+5200 = 9,787<br>+T1 1,012 = 10,799, +T2 2,750 = 13,549 → **6개** |
| **중위권** (42분까지 생존, 평균 320타일) | ≈ 10,560 | 4,938 | 450+562+1650+1925 = 4,587 → **4개** |
| **조기 탈락** (20분 탈락) | ≈ 3,600 | 1,815 | 450+562 = 1,012, +T2 1,650 초과 → **2~3개** |

> **v2.1 영향**: 세션이 40.0 → 39.3분으로 0.7분 짧아지지만 선두 타일 곡선이 그만큼 위로 이동했으므로 "타일·분" 적분은 29,700 → 약 29,900으로 오히려 미세하게 늘었다. **구매 가능 노드 수는 변하지 않는다.** `GOLD_RATE_PERMILLE`(1550)도 그대로다.

> **세션당 2~6개, 중앙값 4개**로 목표(3~5개)에 부합한다. 4축 × 3단계 = 12노드 중 최대 6개 → **반드시 축을 골라야 한다.** 누진 비용이 "한 축 T3까지 파기"(450+1650+5200 = 7,300, 3노드)와 "여러 축 T1~T2 넓게"(4,587, 4노드)의 트레이드오프를 만든다.

#### 5.7 조정 레버 (다음 반복에서 이 순서로 건드릴 것)

| 우선순위 | 레버 | 효과 |
|---|---|---|
| 1 | `REGEN_SQRT_COEF` (0.50) | 모든 단계에 비례. 0.55면 전체 약 −9%, 0.45면 +11% |
| 2 | `LAND_TILES_PER_PLAYER` (390) | 1단계 길이에 거의 선형. 320으로 줄이면 1단계 −1.8분, 전체 −4분 |
| 3 | `ENDGAME_RUSH_TICK` (37분) / `ENDGAME_RUSH_COST_MULT` (0.75) | **종료 시점 직접 통제.** 35분/0.70이면 중앙값 약 37.5분. 5.4절 표에서 가장 민감한 두 값 |
| 4 | `THRESHOLD_DECAY_START` (22분) / `THRESHOLD_DECAY_PER_MIN` (1.2) | 3단계 종료 시점 미세조정 |
| 5 | `FLAG_SPEED_BASE_MILLI` (120) | 행군 지연 = 실효계수. 150이면 1단계 비효율 1.42 → 1.38 |
| 6 | `FLAG_SPEND_RATE` (0.015) | 페이싱보다 **조작량** 레버. 5.5절 참조. 하한 0.012 |
| 6b | `NEUTRAL_BASE_COUNT` (= 인원 수) | **v2.1 신규.** 기지를 인원의 1.5배로 늘리면 희소성이 떨어져 5.1.1절 격차가 평탄해지고, 0.5배로 줄이면 승자독식 위험이 커진다. 페이싱보다 **분산** 레버 |
| 6c | `BASE_MIN_CAPITAL_DIST` (12) | **v2.1 신규.** 기지 쟁탈이 시작되는 시각을 직접 통제한다. 9로 낮추면 1단계 후반(약 6분)부터, 16으로 올리면 약 12분부터 |
| 7 | `ENEMY_BASE` (25) / `ENEMY_DENSITY_COEF` (3.0) | 2단계 고착도. 낮추면 전면전이 빨라지고 세션이 짧아짐 |
| 8 | `HARD_TIMEOUT_TICK` (42분) | 최후의 안전장치. 페이싱이 아니라 상한 보증용 |

---

## 6. 승리조건

> **v1.0에서 규칙이 하나도 바뀌지 않았다**(design-decisions D항). 아래는 v1.0 6장의 완전한 보존이며, v2.0 주석만 덧붙였다.

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

> **v2.0 주석 — 분모에 산이 포함된다.** `totalLandTiles`(3,900)는 산 8%(312타일)를 포함하고, 그중 상당수는 세션 내내 중립으로 남는다. 즉 실제 도달 가능한 최대 점유율은 100%가 아니라 약 95%이며, 45% 임계값은 "도달 가능한 땅의 약 47.4%"에 해당한다. 5.4절 곡선은 이 드래그를 반영해 계산했다. **분모에서 산을 빼는 대안은 채택하지 않았다** — "내 타일 / 전체 육지"가 화면에서 세기 쉬운 값이라는 점이 더 중요하고, 종반 러시(−25%)가 걸리면 산도 실제로 먹히기 시작하기 때문이다. 미결정 사항 7번으로 남긴다.

### 6.2 동맹 규칙 (v1.0 전문 보존)

| 항목 | 상수 / 규칙 |
|---|---|
| 동맹 인원 상한 | `MAX_ALLIES_PER_PLAYER = 2` — 전체가 한 덩어리로 뭉치는 것을 구조적으로 어렵게 한다 |
| 제안 유효시간 | `PROPOSAL_TTL = 150 tick (30초)`. 만료 시 자동 거절 |
| 상호 제안 | 양측이 서로에게 제안한 상태가 되면 즉시 성립 |
| 성립 효과 | 상호 공격 불가. 상대 소유 타일은 `front()` 정의에서 제외되어 **입찰조차 발생하지 않는다.** 이미 그 상대를 향해 행군 중인 깃발은 즉시 `IDLE` 전환 |
| 최소 유지시간 | `ALLIANCE_MIN_DURATION = 300 tick (60초)`. 이 전에는 파기 요청 자체가 거절된다 |
| **백스탭 쿨다운** | 파기 요청 → 상태 `BREAKING` → `BACKSTAB_COOLDOWN = 150 tick (30초)` 경과 후 `BROKEN`. **쿨다운 동안 양측 모두 서로 공격 불가**, 파기 사실이 즉시 전원에게 브로드캐스트된다 → 기습 백스탭 원천 차단, 배신당한 쪽에 30초의 재배치 시간 보장 |
| 파기 취소 | 불가. `BREAKING`은 되돌릴 수 없다 |
| 신규 체결 마감 | `ALLIANCE_CUTOFF_TICK = 11100 tick (37분)` — 종반 킹메이킹 차단. **`ENDGAME_RUSH_TICK`과 같은 값** |
| 탈락 시 | 탈락자의 모든 동맹은 쿨다운 없이 즉시 소멸 |

> **v2.0 주석 — 백스탭 쿨다운이 깃발 모델에서 더 강해졌다.** 30초 쿨다운 동안 배신당한 쪽은 깃발을 재배치할 수 있는데, 중반 행군 시간이 20초이므로 **정확히 한 번의 깃발 재배치가 가능한 시간**이다. 우연이 아니라 의도적으로 맞춘 값이다. 반대로 배신하는 쪽도 예고 즉시 깃발을 국경으로 보낼 수 있으므로 대칭이다.

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

**"마지막 2인이 동맹인 채로 임계값에 도달하면?"** 에 대한 최종 답:

1. 점유율은 개인 기준이므로 **동맹 합산으로는 절대 승리하지 않는다.** 두 명이 각각 40%씩 가져도 threshold(45%)에 미달이면 게임은 안 끝난다.
2. 생존자가 2인이고 둘이 동맹이면 lockout 조건이 즉시 성립 → 30초 뒤 강제 해제 + 60초 재체결 금지. **반드시 서로 싸우게 된다.**
3. 그래도 42분 하드 타임아웃에 걸리면 개인 점유율 1위가 승리한다. 무승부는 없다.
4. 한쪽이 동맹 중에 혼자 45%를 넘겼다면 그 즉시 승리한다 — 규칙상 정상 승리다. 이것이 "동맹을 언제 깰 것인가"를 게임의 마지막 결정으로 만든다.

### 6.3 무승부 처리

없다. 6.1의 4중 타이브레이커(타일 → 병력 → 누적 골드 → playerId)가 항상 유일한 승자를 만든다.

---

## 7. 클라이언트-서버 이벤트 초안

> **시야 전체 공개 (Fog of War 없음).** 서버는 **단일 스냅샷을 전원에게 그대로 브로드캐스트**한다. **깃발도 예외가 아니다** — 모든 플레이어의 모든 깃발 위치·병종·병력이 전원에게 공개된다. 플레이어별 가시성 필터링, 플레이어별 상태 직렬화 분기는 **존재하지 않는다.**
>
> **깃발이 위치를 가진 움직이는 엔티티가 되었지만 이 원칙은 바뀌지 않는다.** 오히려 깃발 모델은 전체 공개에 의존한다 — 상대 깃발의 ETA가 보여야 받아칠 수 있고, 그래야 행군 지연이 "예측 게임"이 되기 때문이다. 깃발을 숨기면 이 설계는 그냥 랜덤 기습 게임이 된다. **프로토콜을 플레이어별로 분기시키지 마라.**
>
> 개인화가 필요한 메시지는 `개인`으로 표시한 5종(`welcome`, `cmd_ack`, `error`, `pong`, 접속 시 1회 `snapshot_full`)뿐이며 모두 게임 상태가 아니라 **연결 상태**에 관한 것이다.

### 7.1 연결·룸 생명주기

```
CONNECTING → CONNECTED → IN_LOBBY → COUNTDOWN → IN_GAME → GAME_OVER → (IN_LOBBY 재입장 | SPECTATING)
```

플레이어 상태: `LOBBY_WAITING` / `PLAYING` / `ELIMINATED_SPECTATING` / `DISCONNECTED`.

접속이 끊긴 플레이어는 **게임에서 제거하지 않는다.** 영토·병력·깃발은 그대로 두고 신규 발령만 중단된다. **행군 중이던 깃발은 계속 행군하고 도착하면 교전한다** — 명령이 이미 내려진 것이므로 취소할 이유가 없다. `DISCONNECT_GRACE = 90초` 내 재접속하면 그대로 복귀하고, 초과하면 봇 AI가 조종을 인계받는다(`bot_takeover`).

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
| **`cmd_flag_issue`** ⟵ **v2.1 스키마 변경** | `{ clientSeq, unit: 0..2, troops: int, anchorTileId, originBaseTileId?: uint32\|null }` | 4.3절 전체 검증 → **출발 기지 결정**, 슬롯 배정, 풀 차감, 거리장 생성. **반드시 `cmd_ack`**<br>`originBaseTileId` **생략/`null` 이 기본**이며 이때 서버가 `argmin(distance(내 기지, anchorTileId), tileId)` 로 자동 선택한다. 클라이언트는 이 필드를 **보내지 않는 것을 기본 경로로 구현**한다 |
| **`cmd_flag_retarget`** ⟵ 신규 | `{ clientSeq, flagId, anchorTileId }` | 4.4절 검증 → 앵커·목표 교체, `lockUntilTick` 설정, 거리장 재생성 |
| **`cmd_flag_recall`** ⟵ 신규 | `{ clientSeq, flagId }` | `state = RETURNING`. 도착 시 85% 환불 |
| `cmd_buy_tech` | `{ clientSeq, axis: 0..3, tier: 1..3 }` | 선행 단계·골드·누진비용 검증 → 즉시 적용. **기동 축 구매 시 `flagCap` 즉시 재계산** |
| `cmd_ally_propose` | `{ clientSeq, targetPlayerId }` | 동맹 수 상한, cutoff/freeze 검증 → 제안 생성 |
| `cmd_ally_respond` | `{ clientSeq, proposalId, accept }` | 성립/거절 처리. **성립 시 상대를 향한 양측 깃발을 IDLE 전환** |
| `cmd_ally_break` | `{ clientSeq, allyPlayerId }` | 최소 유지시간 검증 → `BREAKING` 전환 |
| `emote` | `{ code }` | 프리셋 코드만 허용. 전원 브로드캐스트 |
| `ping` | `{ clientTime }` | `pong` 즉시 회신 |

**v1.0에서 제거된 메시지**: `cmd_attack`, `cmd_cancel_attack`. 대응 개념이 사라졌다.

`clientSeq`는 클라이언트가 붙이는 단조증가 정수다. 모든 `cmd_*`는 **반드시** `cmd_ack`로 수락/거절이 회신되어야 한다. 클라이언트는 낙관적 예측을 하지 않고 `cmd_ack` + 다음 스냅샷으로만 UI를 갱신한다(서버 권위 유지, 롤백 코드 불필요).

거절 사유 코드(4.3/4.4절): `ELIMINATED` `NO_SLOT` `BAD_UNIT` `WATER` `SELF` `ALLIED` `OUT_OF_RANGE` `TOO_SMALL` `INSUFFICIENT` `NO_FLAG` `RETURNING` `LOCKED` **`NOT_BASE`** **`NOT_OWNED_BASE`** (뒤 둘은 v2.1 신규 — `originBaseTileId`를 명시했을 때만 발생한다).

### 7.3 서버 → 클라이언트

| 이벤트 | 대상 | 페이로드 / 동기화하는 것 |
|---|---|---|
| `welcome` | 개인 | `{ playerId, playerToken, serverTick, protocolVersion, tickMs }` |
| `room_state` | 룸 | `{ roomId, roomCode, phase, hostId, targetPlayers, players:[{id,nickname,color,ready,isBot,connected}], countdownMs }` |
| `match_config` | 룸 | 매치 시작 시 1회. `{ seed, width, height, totalLandTiles, tickMs, hardTimeoutTick, thresholdCurve, techTable, costConstants, terrainTable, flagConstants, unitTable, endgameRush:{tick,costMult} }` — **밸런스 상수 전체를 내려보내 클라이언트가 예상 점령비용·행군 ETA를 서버와 동일하게 계산**할 수 있게 한다. 깃발 모델에서는 이게 필수다(ETA 표시가 UI의 핵심) |
| `map_init` | 룸 | `{ terrain: RLE(uint8[]), spawns:[{playerId, tileId, homeTileId}], bases:[tileId,...] }` — 지형은 불변이므로 1회. **v2.0: 값 도메인이 0..5로 확장. v2.1: `bases` 추가** — 수도를 포함한 전체 기지 타일 ID, `tileId` 오름차순. 위치가 불변이므로 **초기 1회로 충분하며, 소유권 변경은 기존 `tileChanges` 델타로 완전히 커버된다**(아래 참조) |
| `snapshot_full` | 룸/개인 | `{ tick, owners: RLE(uint8[]), players:[{id,tiles,troops,gold,goldWeight,tech:[4],flagCap,alive,connected}], flags:[{id,ownerId,slotIndex,unit,troops,posTileId,progressMilli,anchorTileId,targetOwnerId,state}], alliances:[...], thresholdPct, ticksRemaining, endgameRushActive }` — **접속·재접속 시 개인 전송, 그 외 25 tick(5초)마다 전원 브로드캐스트(리싱크)** |
| `snapshot_delta` | 룸 | `{ tick, tileChanges:[[tileId,ownerId],...], playerDeltas:[{id,tiles,troops,gold,goldWeight}], flagMoves:[[flagId,posTileId],...], flagStats:[[flagId,troops,state],...], flagsGone:[flagId,...], thresholdPct? }` — **매 tick(200ms)**. 상세는 7.5절 |
| `cmd_ack` | 개인 | `{ clientSeq, accepted, reason?, flagId? }` — 발령 성공 시 배정된 `flagId` 회신 |
| **`flag_issued`** | 룸 | `{ tick, flagId, playerId, slotIndex, unit, troops, originTileId, anchorTileId, targetOwnerId, etaTick }` — 출발 연출 + 경로선 렌더 |
| **`flag_retargeted`** | 룸 | `{ tick, flagId, anchorTileId, targetOwnerId, resumeTick, etaTick, auto: bool }` — `auto=true`면 4.5절 중립 자동 전환 |
| **`flag_engaged`** | 룸 | `{ tick, flagId, frontTileCount }` — 교전 시작. 디스크 하이라이트 전환 |
| **`flag_idle`** | 룸 | `{ tick, flagId, reason: "front_cleared"\|"unreachable"\|"allied", autoRecallTick }` — **플레이어에게 "이 깃발 놀고 있다"를 알리는 알림 트리거** |
| **`flag_ended`** | 룸 | `{ tick, flagId, reason: "exhausted"\|"recalled"\|"attrited"\|"eliminated", refunded }` |
| `tech_purchased` | 룸 | `{ tick, playerId, axis, tier, cost, newFlagCap }` |
| `ally_proposed` | 룸 | `{ tick, proposalId, fromId, toId, expiresTick }` |
| `ally_formed` | 룸 | `{ tick, a, b, canBreakAfterTick }` |
| `ally_break_started` | 룸 | `{ tick, a, b, effectiveTick }` — **백스탭 예고. 전원 공개가 이 규칙의 핵심** |
| `ally_broken` | 룸 | `{ tick, a, b, cause: "manual"\|"lockout"\|"elimination" }` |
| `alliance_lockout` | 룸 | `{ tick, stage: "countdown"\|"dissolved", forceDissolveTick?, freezeUntilTick? }` |
| `threshold_update` | 룸 | `{ tick, thresholdPct }` — 22분 이후 분당 1회만 |
| **`endgame_rush`** | 룸 | `{ tick, costMult }` — 37분 1회. 화면 전체 연출 트리거 |
| `player_eliminated` | 룸 | `{ tick, playerId, byPlayerId\|null }` |
| `bot_takeover` / `player_reconnected` | 룸 | `{ tick, playerId }` |
| `emote_broadcast` | 룸 | `{ tick, playerId, code }` |
| `game_over` | 룸 | `{ finalTick, winnerId\|null, reason:"threshold"\|"last_standing"\|"timeout", standings:[{playerId,tiles,sharePct,troops,goldEarned,eliminatedTick\|null}] }` |
| `error` / `pong` | 개인 | `{ code, message }` / `{ clientTime, serverTime, tick }` |

### 7.4 tick 처리 순서 (결정론 보증 — 백엔드 필수 준수)

```
onTick(t):
  1. 입력 큐 드레인
       tick 경계 이전 도착분만 처리. (수신 시각, connectionId, clientSeq) 3중 정렬.
  2. 자원 생산   — playerId 오름차순. 병력(√tiles) / 골드(goldWeight)          (3.2 / 3.3)
  3. 외교 타이머 — 제안 만료, BREAKING→BROKEN, freeze 해제, lockout 카운트다운  (6.2)
  4. 깃발 이동   — flagId 오름차순. 전진, 노출 소모, MARCHING→ENGAGED 도착 판정,
                   RETURNING 완료 처리                                          (4.4)
  5. 방어 밀도 캐시 — playerId 오름차순으로 defDensity(p) 를 1회 계산해 동결      (4.7)
  6. 전투 Phase A — 입찰 산출. ENGAGED 깃발만, flagId 오름차순. **쓰기 절대 금지** (4.8)
  7. 전투 Phase B — 낙찰·소유권 변경·병력 차감. tileId 오름차순                  (4.8 / 4.9)
  8. 파생 상태   — tiles / goldWeight 는 7에서 증분 갱신 완료. 점유율 재계산
  9. 깃발 종료 판정 — 소진/전선 소멸/중립 자동 전환/IDLE 타임아웃. flagId 오름차순 (4.10)
 10. 봇 AI      — t % 15 == 0 인 tick에만, botIndex 오름차순                    (8장)
 11. 탈락 판정                                                                   (4.12)
 12. 승리 판정                                                                   (6.1)
 13. 브로드캐스트 — snapshot_delta (+ t % 25 == 0 이면 snapshot_full)
```

**절대 규칙 3개**:

1. **6단계에서는 어떤 쓰기도 하지 않는다.** 7단계 이전에 상태를 건드리면 flagId 순서에 따라 결과가 달라져 결정론이 깨진다.
2. **5단계의 밀도 캐시는 6·7단계 내내 동결된다.** 7단계에서 방어자 병력이 깎여도 같은 tick 안의 후속 `tileCost`는 옛 값을 쓴다. 이것이 "같은 tick에 먼저 처리된 타일이 유리해지는" 순서 의존성을 제거한다.
3. **4단계(이동)는 6단계(입찰) 앞에 온다.** 그래야 "이번 tick에 도착한 깃발이 이번 tick부터 싸운다"가 성립하고, 클라이언트가 보는 도착 프레임과 전투 시작 프레임이 일치한다.

### 7.5 깃발 상태를 매 tick 어떻게 싣는가 — 대역폭 설계

**문제**: 최대 12인 × 7 = **84개** 깃발. 전 필드를 매 tick(5Hz) JSON으로 보내면 `84 × 약 90 B = 7.6 KB/tick = 38 KB/s`. 클라이언트당 38 KB/s는 **비현실적**이다.

**판단: 전체 전송은 매 tick에는 비현실적이고, 5초 주기 리싱크로는 현실적이다.** 그래서 두 층으로 나눈다.

**(1) `snapshot_full` — 5초마다 깃발 배열 전체.** `84 × 90 B = 7.6 KB / 5초 = 1.5 KB/s`. 재접속·리싱크·상태 정합 보증을 담당한다.

**(2) `snapshot_delta` — 매 tick, 변한 것만.** 세 필드로 쪼갠다.

```
flagMoves : [[flagId, posTileId], ...]      // posTileId 가 바뀐 깃발만
flagStats : [[flagId, troops, state], ...]  // ENGAGED 중이거나 state 가 전이한 깃발만
flagsGone : [flagId, ...]                   // 소멸
```

**`progressMilli`는 보내지 않는다.** 깃발 속도는 `match_config`의 상수 + 병종 + 지형 + 테크로 클라이언트가 **서버와 동일하게 계산 가능**하므로, 클라이언트는 `posTileId` A에서 B로의 이동을 자기 속도 계산으로 부드럽게 보간한다. 서버는 **타일 단위 이산 위치에 대해서만 권위를 갖는다.** 렌더 부드러움은 클라이언트 문제다.

**빈도 검산**: 검병이 평원에서 0.12타일/tick이므로 **약 8.3 tick마다 한 칸** 움직인다. 행군 중 깃발이 룸에 평균 30개면 tick당 `30 / 8.3 ≈ 3.6개`만 `flagMoves`에 실린다. 교전 중 깃발은 정지 상태이므로 `flagMoves`에 아예 안 나오고 `flagStats`에만 나온다(평균 20개).

| 항목 | tick당 크기 | 초당 |
|---|---|---|
| `tileChanges` (평균 2.5개, 피크 40개) | 40 B | 0.2 KB/s |
| `flagMoves` (평균 3.6개) | 55 B | 0.28 KB/s |
| `flagStats` (평균 20개) | 260 B | 1.3 KB/s |
| `playerDeltas` (12명) | 480 B | 2.4 KB/s |
| **`snapshot_delta` 소계** | **약 835 B** | **약 4.2 KB/s** |

`playerDeltas`가 가장 크다. **최적화**: `troops`/`gold`는 매 tick 미세하게 변하므로 **5 tick(1초)마다만** 싣고, `tiles`/`goldWeight`는 변했을 때만 싣는다. → `playerDeltas` 0.5 KB/s.

**최종 대역폭 추정**:

| 메시지 | 크기 | 초당 |
|---|---|---|
| `map_init` (RLE, 6000타일 × 6종) | 2~4 KB | 1회 |
| `snapshot_full` (owners RLE 1~4 KB + players 0.6 KB + flags 7.6 KB) | 약 12 KB / 5초 | **2.4 KB/s** |
| `snapshot_delta` (최적화 후) | 약 460 B / tick | **2.3 KB/s** |
| 이벤트 메시지 (flag_*, ally_* 등) | 산발 | 약 0.2 KB/s |
| **합계 / 클라이언트** | | **약 4.9 KB/s** |
| **12인 룸 총 송신** | | **약 59 KB/s** |

v1.0(약 2~3 KB/s)의 **약 1.8배**다. 깃발 엔티티가 추가된 대가로는 타당하며, 단일 Node 프로세스로 룸 수십 개를 여전히 수용한다(12인 룸 20개 = 1.2 MB/s).

전송은 JSON으로 시작하고, 프로파일링 후 `owners` / `tileChanges` / `flagMoves`만 바이너리(ArrayBuffer)로 교체하는 것을 권장한다. 스키마는 유지한다. 바이너리 전환 시 `flagMoves` 항목은 `uint16 flagId + uint32 tileId = 6 B`가 되어 55 B → 22 B로 줄어든다.

---

## 8. 봇 AI (깃발 모델용 재작성)

RNG를 쓰지 않는다. 모든 분기가 게임 상태의 결정론적 함수다(리플레이·디버깅 가능). v1.0의 "가장 약한 인접 영토를 공격" 철학은 유지하되, 깃발 모델에 맞춰 **"어떤 슬롯을, 어떤 병종으로, 어느 앵커에"** 를 판단하도록 다시 썼다.

```
BOT_DECISION_INTERVAL = 15 tick (3초)

onBotTick(bot):                             // botIndex 오름차순으로 순회
  p = bot
  reserve = floor(troopCap(p) * BOT_RESERVE_RATIO)      // 0.30 — 방어용으로 남길 병력

  // ═══ 1) 기존 깃발 정비 (신규 발령보다 먼저) ═══
  for f in p.flags sorted by f.id ASC:
     // (a) 본토 위기 → 회수
     if defDensity(p) < BOT_PANIC_DENSITY (=2.0) and f.state == MARCHING:
          recall(f); continue
     // (b) 놀고 있는 깃발 → 재지정
     if f.state == IDLE:
          a = bestAnchor(p)
          if a != null: retarget(f, a.tileId)
          else:         recall(f)
     // (c) 교전 중인데 전선이 2타일 미만 → 다음 목표로 미리 전환
     if f.state == ENGAGED and |front(f)| < 2:
          a = bestAnchor(p)
          if a != null: retarget(f, a.tileId)

  // ═══ 2) 빈 슬롯 채우기 ═══
  while p.flags.length < flagCap(p):
     if p.troops - reserve < FLAG_MIN_TROOPS: break      // 병력 부족 → 축적
     a = bestAnchor(p)
     if a == null: break                                 // 칠 곳이 없음
     unit = chooseUnit(p, a)
     q    = clamp( floor(p.troops * BOT_COMMIT_RATIO[a.kind]),
                   FLAG_MIN_TROOPS,
                   p.troops - reserve )
     issueFlag(p, unit, q, a.tileId)
     // 같은 앵커에 연속 발령하지 않도록 이번 결정 tick 동안 a.owner 를 1회만 허용

  // ═══ 3) 앵커 선택 ═══
  function bestAnchor(p):
     candidates = { o : o 가 p 의 국경에 닿아 있음 }   // NEUTRAL 포함
     candidates -= { 동맹, BREAKING 쿨다운 중인 상대 }
     candidates -= { 이미 p 의 깃발 2개 이상이 목표로 삼은 소유자 }   // 분산 강제
     best = null
     for o in candidates sorted by ownerId ASC:
        border   = { t : tile[t].owner == o, ∃ neighbor 가 p 소유 }
        anchor_o = argmin over border of ( tileCost(p, t) , t )       // 가장 싼 국경 타일
        // 앵커 주변 반경 6 디스크 안의 o 소유 타일 수 = 이 작전의 "먹을 거리"
        mass     = |{ t : distance(t, anchor_o) <= FRONT_RADIUS, tile[t].owner == o }|
        cost     = tileCost(p, anchor_o)
        march    = distance(origin(p), anchor_o)

        score = mass * 1000 / ( cost * (10 + march) )                 // 정수 연산
        if o == NEUTRAL:
             score = score * (t < BOT_NEUTRAL_BIAS_TICK ? 160 : 100) / 100
        else:
             if o == 인접 플레이어 중 타일 수 최소:   score = score * 130 / 100
             if players[o].tiles > p.tiles * 3 / 2:   score = score *  60 / 100
             if defDensity(o) < 3.0:                  score = score * 150 / 100   // 무너진 적 집중
        if score > best.score or (score == best.score and o < best.owner):
             best = { tileId: anchor_o, owner: o, kind: (o==NEUTRAL ? 0 : 1), score }
     return best

  // ═══ 4) 병종 선택 ═══
  function chooseUnit(p, a):
     if a.kind == NEUTRAL:                        return CAVALRY   // 빈 땅 선점은 속도 싸움
     if distance(origin(p), a.tileId) > 12:       return CAVALRY   // 먼 전선
     if defDensity(p) < 4.0:                      return SPEAR     // 본토가 얇다 → 걸어가며 방어
     if defDensity(a.owner) < 3.0:                return CAVALRY   // 무너진 적 흡수
     return SWORD

BOT_RESERVE_RATIO   = 0.30
BOT_PANIC_DENSITY   = 2.0
BOT_COMMIT_RATIO    = { NEUTRAL: 0.45, ENEMY: 0.35 }    // 남은 풀 대비
```

**v1.0 대비 무엇이 달라졌나**:

| | v1.0 | v2.0 |
|---|---|---|
| 판단 단위 | 주문 1개 (교체식) | 슬롯 3~7개 (병렬 관리) |
| 목표 선택 | 소유자 점수 → 최저비용 국경 타일 | 소유자 점수에 **"디스크 안 먹을 거리(mass)"와 "행군 거리(march)"** 를 곱셈 항으로 추가 |
| 병종 | 없음 | 4단계 규칙 (거리·자기 밀도·상대 밀도) |
| 회수/재지정 | 없음 | 본토 위기 회수, IDLE 재지정, 전선 소진 선제 전환 |
| 축적 판단 | `troops < 0.35 cap` 이면 대기 | `reserve = 0.30 cap` 을 항상 남기고 나머지로 발령 — **깃발 모델에서는 "전부 다 쓰기"가 즉사이므로 예비 병력 개념이 필수** |

**테크 우선순위** (매 결정 tick, 첫 미구매 항목을 살 수 있으면 즉시 구매):

```
priority = TECH_PRIORITY[bot.botIndex % 4]
  0 (확장형): [영토T1, 경제T1, 기동T1, 영토T2, 군사T1, 군사T2]
  1 (경제형): [경제T1, 경제T2, 영토T1, 기동T1, 경제T3, 군사T1]
  2 (수비형): [영토T1, 영토T2, 군사T1, 경제T1, 군사T2, 영토T3]
  3 (기동형): [기동T1, 기동T2, 군사T1, 경제T1, 기동T3, 군사T2]
```

기동형 봇(3번)은 T2에서 깃발 슬롯이 +1 되므로 **초반부터 4개를 굴린다.** 사람 플레이어에게 "기동 축이 뭘 하는 축인지"를 보여주는 시연 역할도 겸한다.

**외교** (v1.0 유지):

```
제안 수신 시: 제안자 타일 수 >= 내 타일 수 * 1.2  AND  내 동맹 < 2  → 수락, 아니면 거절
봇은 먼저 제안하지 않는다.
파기: (내 타일 >= 동맹 타일 * 2.0) AND (t > 7500 tick, 25분) AND (최소 유지시간 경과) → 파기
```

**난이도 조절**: `BOT_DECISION_INTERVAL`(15 → 30이면 약해짐), `BOT_RESERVE_RATIO`(높을수록 소극적), 그리고 `chooseUnit`을 항상 `SWORD` 반환으로 고정(초보 난이도)하는 세 레버만 쓴다.

**인원 충원 규칙**: 공개 로비는 카운트다운 종료 시점에 `targetPlayers`(기본 10)까지 봇으로 채운다. 비공개 룸은 호스트가 `lobby_start_now`를 누른 시점에 채우며, 최소 인간 1명이면 시작 가능하다.

---

## 부록 A. 밸런스 상수 전체 표 (백엔드 단일 소스 — v2.0 전면 갱신)

> 백엔드는 이 표를 `shared/constants.ts` 로 뽑고 `match_config` 로 클라이언트에 내려보낸다.
> **모든 배율은 permille 정수로 구현한다** (`1.15` → `1150`). 아래는 가독성을 위한 십진 표기다.

```ts
// ══ 시간 ══
TICK_MS                  = 200          // 초당 5 tick
TICKS_PER_MIN            = 300
ENDGAME_RUSH_TICK        = 11100        // 37분
ENDGAME_RUSH_COST_MULT   = 0.75         // 이후 모든 tileCost × 0.75          ⟵ v2.0
HARD_TIMEOUT_TICK        = 12600        // 42분
SNAPSHOT_FULL_INTERVAL   = 25           // 5초
PLAYER_DELTA_INTERVAL    = 5            // 1초. troops/gold 는 이 주기로만 델타 ⟵ v2.0
DISCONNECT_GRACE_TICK    = 450          // 90초

// ══ 맵 ══
LAND_TILES_PER_PLAYER    = 390
TARGET_LAND_RATIO        = 0.65         // 허용 0.60~0.70
CA_INIT_LAND_P           = 0.55
CA_SMOOTH_STEPS          = 4
CA_LAND_NEIGHBOR_MIN     = 5            // 8방향 기준
SPAWN_BLOCK              = 3            // 3×3
MAP_SIZE                 = { 8:[90,54], 9:[95,57], 10:[100,60], 11:[104,63], 12:[108,66] }

// ══ 지형 5종 ══                                                            ⟵ v2.0 전면 신규
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

// ══ 시작값 ══
START_TROOPS             = 150
START_GOLD               = 200

// ══ 병력 ══
TROOP_CAP_BASE           = 100
TROOP_CAP_PER_TILE       = 12
REGEN_BASE               = 0.8
REGEN_SQRT_COEF          = 0.50         // v1.0: 0.45 — 깃발 지연 상쇄        ⟵ v2.0

// ══ 골드 ══
GOLD_RATE_PERMILLE       = 1550         // v1.0: 1500 — 지형 골드 평균 0.965 상쇄 ⟵ v2.0
// goldMilliPerTick(p) = floor( p.goldWeight * 1550 * goldMult_permille / 1e9 )

// ══ 점령 비용 ══
NEUTRAL_BASE             = 9            // v1.0: 10 — 깃발 지연 상쇄           ⟵ v2.0
NEUTRAL_SQRT_COEF        = 1.0          // × sqrt(공격자 타일 수)
ENEMY_BASE               = 25
ENEMY_DENSITY_COEF       = 3.0
ADJACENCY_COEF           = 0.15         // 적 타일에만, 이웃 0~3 → 1.00~1.45
MIN_TILE_COST            = 4

// ══ 깃발 ══                                                                ⟵ v2.0 전면 신규
FLAG_CAP_BASE            = 3
FLAG_TILES_PER_SLOT      = 300
FLAG_CAP_HARD_MAX        = 7            // 이 값을 올리는 변경은 금지 (5.5절)
FLAG_MIN_TROOPS          = 40
FLAG_SPEED_BASE_MILLI    = 120          // milli-타일/tick. 검병·평원·무테크 = 0.6 타일/초
FLAG_SPEND_RATE          = 0.02         // initialTroops 대비 / tick → 교전 최소 50 tick
FLAG_TILE_RATE_BASE      = 2            // maxTiles = ceil(2 × UNIT_ASSAULT)
FRONT_RADIUS             = 6            // 국경 면 디스크 반경 (distance() 기준)
FRONT_MAX_RANGE          = 40           // 발령 시 내 영토에서 앵커까지 최대 거리
FLAG_ENGAGE_RANGE        = 1            // posTile 이 front 타일과 이 거리 이내면 ENGAGED
FLAG_RETARGET_LOCK_TICK  = 15           // 3초. 재지정 시 이동 정지
FLAG_RECALL_REFUND       = 0.85         // 회수 시 병력 환불률
FLAG_IDLE_TIMEOUT        = 600          // 2분 후 자동 회수
FLAG_EXPOSED_ATTRITION   = 0.0005       // 비우호 영토 위 깃발, tick당 병력 손실 (≈3%/분)

// ══ 병종 3종 ══                                                            ⟵ v2.0 전면 신규
UNIT = { SPEAR:0, SWORD:1, CAVALRY:2 }
UNIT_SPEED        = { SPEAR:0.75, SWORD:1.00, CAVALRY:1.45 }   // 이동속도 배율
UNIT_ATK_MULT     = { SPEAR:1.15, SWORD:1.00, CAVALRY:0.85 }   // tileCost 배율 (낮을수록 강함)
UNIT_DEF_MULT     = { SPEAR:1.50, SWORD:1.00, CAVALRY:0.60 }   // 본국 방어 기여 & 격퇴 생존
UNIT_ASSAULT      = { SPEAR:0.70, SWORD:1.00, CAVALRY:1.40 }   // maxTiles 배율 → 2 / 2 / 3
UNIT_POWER        = { SPEAR: 900, SWORD:1000, CAVALRY:1150 }   // 조우전 낙찰 우선순위(permille)
UNIT_CONVERT      = { SPEAR:1.00, SWORD:1.00, CAVALRY:1.15 }   // 편성 시 풀 차감 배율
// 순 효율 검산: 기병 1.15(편성) × 0.85(점령) = 0.978 → 병력 대비 +2.2% 뿐.
//               나머지는 전부 속도(+45%)와 방어(−40%)의 트레이드로 정산된다.

// ══ 본국 자동 방어 ══                                                      ⟵ v2.0 신규
HOME_FLAG_DEF_RATIO      = 0.50         // 내 영토 위 비교전 깃발의 방어 기여율
HOME_FLAG_DEF_CAP        = 0.35         // troopCap 대비 기여 상한 (회전 웅크리기 차단)

// ══ 전투 ══
DEFENDER_LOSS_RATIO      = 0.35         // 낙찰 비용 대비 방어자 풀 손실
LOSER_ATTRITION_RATIO    = 0.50         // 낙심 입찰자 자기 손실 (÷ UNIT_DEF_MULT)
LOSER_TO_DEFENDER_RATIO  = 0.25         // 낙심 입찰자가 방어자에게 입히는 추가 손실

// ══ 테크 ══
TECH_BASE_COST           = [450, 1100, 2600]
TECH_PROGRESSIVE_COEF    = 0.25         // × 이미 구매한 총 노드 수
MILITARY  = { atkCostMult:[0.93,0.86,0.78], defCostMult:[1.07,1.15,1.22] }
ECONOMY   = { goldMult:[1.25,1.55,1.90],    regenMult:[1.06,1.13,1.20] }
TERRITORY = { neutralCostMult:[0.88,0.76,0.62], capMult:[1.10,1.22,1.35] }
MOBILITY  = { flagSpeedMult:[1.30,1.55,1.85],                          // ⟵ v2.0 재정의
              flagSlotBonus:[0,1,2],
              convertEffMult:[1.05,1.10,1.15] }
// v1.0의 tileRateMult / spendRateMult 는 폐기됨 (대응 개념 소멸)

// ══ 승리 ══
THRESHOLD_START_PCT      = 60
THRESHOLD_DECAY_START    = 6600         // 22분
THRESHOLD_DECAY_PER_MIN  = 1.2          // %p
THRESHOLD_FLOOR_PCT      = 45           // 34.5분에 도달

// ══ 동맹 ══
MAX_ALLIES_PER_PLAYER    = 2
PROPOSAL_TTL_TICK        = 150          // 30초
ALLIANCE_MIN_DURATION    = 300          // 60초
BACKSTAB_COOLDOWN_TICK   = 150          // 30초
ALLIANCE_CUTOFF_TICK     = 11100        // 37분 = ENDGAME_RUSH_TICK
LOCKOUT_COUNTDOWN_TICK   = 150          // 30초
LOCKOUT_FREEZE_TICK      = 300          // 60초

// ══ 봇 ══                                                                  ⟵ v2.0 갱신
BOT_DECISION_INTERVAL    = 15           // 3초
BOT_RESERVE_RATIO        = 0.30         // troopCap 대비 항상 남기는 방어 예비
BOT_PANIC_DENSITY        = 2.0          // 이하로 떨어지면 행군 중 깃발 회수
BOT_COMMIT_RATIO         = { NEUTRAL: 0.45, ENEMY: 0.35 }
BOT_NEUTRAL_BIAS_TICK    = 2610         // 8.7분 (5.2절 재계산 결과)
```

---

## 미결정 사항 (Open Questions)

> v1.0의 10건 중 **7번(종반 러시)은 해결**되어 제거했다(`ENDGAME_RUSH` 정식 도입, 5.4절). **6번(기동 T1 사장 위험)도 해결**되어 제거했다(기동 축 재정의로 행군 지연이 항상 존재하므로 무조건 효과). 나머지는 새 모델 기준으로 다시 썼다.

1. **`FRONT_RADIUS = 6` 의 적정성 (최우선 검증 항목).**
   깃발 모델 전체가 이 하나의 값 위에 서 있다. 크면 작전 하나가 길어져 조작량이 줄지만 "어디를 미는지" 통제력이 떨어지고, 작으면 정밀하지만 재발령이 잦아 APM이 뛴다. 디스크 안 육지 타일이 평균 60개이므로 중반 깃발 하나(병력 1,500, 적 비용 64)가 약 23타일을 먹고 소진된다 — 즉 **디스크가 소진되기 전에 병력이 먼저 소진되는 것이 정상**이다. 관전 지표: **`flag_idle(reason="front_cleared")` 비율이 전체 깃발 종료의 20%를 넘는가.** 넘으면 반경을 4~5로 줄인다.

2. **깃발 속도 `120 milli/tick`(0.6타일/초)의 체감.**
   중반 행군 20초는 "명령이 늦게 도착한다"는 감각을 만들기 위한 값이지만, 20초 동안 아무것도 안 일어나면 지루함으로 읽힐 수 있다. 5.5절 계산상 깃발 3~5개가 엇갈려 돌기 때문에 화면에는 항상 뭔가 움직이지만, 이는 **플레이어가 엇갈려 발령하는 법을 배웠을 때만** 성립한다. 초보는 3개를 한꺼번에 보내고 20초를 멍하니 본다. 튜토리얼/UI에서 "슬롯이 비어 있음"을 강하게 시각화해야 한다. 실측에서 초반 이탈이 크면 150(0.75타일/초)으로 올린다.

3. **본국 깃발 방어 기여(`HOME_FLAG_DEF_RATIO = 0.50`)가 "방어 깃발 없음" 원칙을 침식하는가.**
   규칙상으로는 명령이 늘지 않지만, 숙련자는 "창병 깃발을 먼 앵커로 보내 본토를 오래 배회시키는" 준-방어 명령을 발견할 것이다. `HOME_FLAG_DEF_CAP = 0.35`가 상한이고 3초 재지정 경직이 있지만 완전히 막지는 못한다. 관전 지표: **`flag_retarget` 중 앵커가 크게 바뀌지 않은 (distance < 3) 호출의 비율.** 높으면 `FLAG_RETARGET_LOCK_TICK`을 30(6초)으로 올리거나 `HOME_FLAG_DEF_RATIO`를 0.35로 낮춘다.

4. **병종 3종의 실사용 분포 — 기병 독주 위험.**
   4.11절 산술상 순 효율은 +2.2%뿐이지만, 사람은 "빠른 것"을 과대평가한다. 특히 초반 중립 확장에서는 방어를 걱정할 이유가 없어 **기병 일변도**가 될 가능성이 높다(봇 AI도 그렇게 짰다). 이게 실제로 관측되면 `UNIT_CONVERT[CAVALRY]`를 1.15 → 1.25로 올린다. 반대로 창병 사용률이 5% 미만이면 `UNIT_DEF_MULT[SPEAR]`를 1.80으로 올린다. 관전 지표: **세션당 병종별 발령 비율이 (창 15% / 검 40% / 기 45%) 대역 안인가.**

5. **깃발 상한 3~7이 조작량 상한으로 충분한가.**
   5.5절 추정은 13~18 액션/분이지만 이는 "한 깃발당 2클릭, 사이클마다 1회"라는 이상적 가정이다. 실제로는 재지정·회수·확인 클릭이 붙어 1.5~2배가 될 수 있다. **분당 액션 25를 넘으면 8~12인 실시간에서 초보 학살이 시작된다.** 조정은 5.5절의 순서(SPEND_RATE → TILES_PER_SLOT)를 따르고, `FLAG_CAP_HARD_MAX`를 7 이상으로 올리는 변경은 하지 않는다.

6. **중립 깃발 자동 전환(4.5절)이 혼란스러운가.**
   "빈 땅 먹으러 보냈는데 서버가 알아서 옆 나라를 치기 시작했다"는 조작량을 줄이지만 의도치 않은 개전으로 읽힐 수 있다. 대안 두 가지: (a) 자동 전환을 끄고 IDLE로 두되 알림을 강하게 준다, (b) 자동 전환하되 클라이언트가 3초간 취소 버튼을 띄운다. 현재는 (기본) 자동 전환이며, 플레이테스트에서 "왜 전쟁이 났는지 모르겠다"는 피드백이 나오면 (b)로 간다.

7. **산 8%가 점유율 분모를 오염시키는 정도.**
   6.1절 주석 참조. 산이 끝까지 중립으로 남으면 도달 가능 최대 점유율이 약 95%로 내려가 45% 임계값이 실질 47.4%가 된다. 5.4절 곡선은 이를 반영했지만 추정이다. 관전 지표: **게임 종료 시점의 중립 타일 비율.** 8%를 크게 넘으면 (a) `THRESHOLD_FLOOR_PCT`를 43으로 낮추거나 (b) `totalLandTiles`에서 산을 제외한다. (b)는 UI 설명 부담이 커서 (a)를 선호한다.

8. **`ENDGAME_RUSH_TICK = 37분`이 충분히 이른가.**
   5.4절 검산상 러시가 없으면 표준 게임이 42분 타임아웃으로 끝나고, 러시가 있으면 40분에 threshold로 끝난다. **여유가 2분뿐이라 모델 오차에 취약하다.** 선두 성장이 내 추정보다 10%만 느려도 다시 타임아웃 게임이 된다. 실측 데이터가 나오면 35분(`10500`) / `0.70`으로 앞당기는 것을 1순위로 검토한다. 지금 앞당기지 않은 이유는 design-decisions C항이 37분/−25%를 명시한 사용자 확정값이기 때문이다.

9. **깃발 위치를 tile-discrete 델타로만 보내는 것의 렌더 품질(7.5절).**
   클라이언트가 속도를 재계산해 보간하는데, 지형 이동 배율·테크·재지정 경직까지 전부 맞춰야 서버와 어긋나지 않는다. 어긋나면 깃발이 순간이동하는 것처럼 보인다. **완화책**: 클라이언트는 보간을 "다음 `posTileId` 도착 예정 시각"을 향한 단조 이징으로 구현하고, 델타가 예상보다 빨리/늦게 오면 남은 거리를 재분배한다(스냅 금지). 프론트엔드와 반드시 협의할 항목이며, 품질이 안 나오면 `progressMilli`를 5 tick(1초)마다 싣는 절충안(+0.4 KB/s)으로 간다.

10. **동시 공격 낙찰 기준을 "남은 병력 × 병종 계수"로 한 것이 맞는가.**
    v1.0에서 이월된 질문이지만 깃발 모델에서 성격이 바뀌었다. 이제 낙찰은 **어느 부대가 더 큰가**의 문제이고, 큰 깃발을 하나 굴리는 쪽이 작은 깃발 여럿을 굴리는 쪽을 항상 이긴다. 이는 "깃발 슬롯을 늘리는 것"(기동 축)과 "한 깃발에 몰빵하는 것"의 트레이드오프를 만드는데, 전자가 사장될 위험이 있다. 관전 지표: **평균 깃발 병력 / troopCap 비율이 0.35를 넘는가**(넘으면 몰빵 일변도). 넘으면 `UNIT_POWER` 격차를 벌리거나 낙찰 기준에 "그 타일에 지불하는 `tileCost`가 큰 쪽" 항을 섞는다.

11. **재접속 유예 90초 후 봇 인계 시 그 플레이어의 승리 자격.**
    현재는 봇이 조종해도 원 플레이어 승리로 기록한다. 대안은 "봇 인계 시점에 탈락 처리"인데 순간적 네트워크 단절이 곧 패배가 되어 가혹하다. 현행 유지를 권장하되 명시적으로 남긴다. (v1.0 9번 이월, 변경 없음)

12. **`MAX_ALLIES_PER_PLAYER = 2`가 충분히 교착을 막는가.**
    v2.0에서 **동맹의 가치가 올라갔다**(5.3절 — 깃발 수 상한 때문에 혼자서는 여러 전선을 동시에 못 민다). 따라서 v1.0보다 교착 위험이 크다. Alliance Lockout 발동 빈도가 게임당 1회를 넘으면 상한을 1로 낮추거나 "동맹은 인접 플레이어와만 가능" 제약을 추가한다. (v1.0 5번 이월, 위험도 상향)
