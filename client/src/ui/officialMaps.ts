/**
 * 공식 프리셋 맵 데이터 (미리보기 전용). 서버가 기동 시 읽는 server/maps/official/*.json 을 번들에 함께 넣는다.
 * 프로토콜(welcome.officialMaps)은 메타만 주므로, 썸네일·육지 수는 여기서 얻는다.
 * 서버 목록에 있지만 번들에 없는 id 는 미리보기 없이 표시한다 (프로토콜이 우선).
 */
import type { MapPreviewData } from '../render/mapPreview.js';

const files = import.meta.glob('../../../server/maps/official/*.json');

export interface OfficialMapFile extends MapPreviewData {
  id: string;
  checksum: string;
  players: { min: number; recommendedMin: number; recommendedMax: number; max: number };
}

const cache = new Map<string, Promise<OfficialMapFile | null>>();

/**
 * 번들 파일을 돌려준다. serverChecksum(welcome.officialMaps[].checksum, QA m-8)이 주어졌는데 번들 파일과 다르면
 * (서버가 다른 맵 세트·갱신된 파일로 배포됨) 옛 지형을 보여주지 않도록 null.
 */
export async function loadOfficialMapChecked(id: string, serverChecksum: string | undefined): Promise<{ map: OfficialMapFile | null; mismatch: boolean }> {
  const map = await loadOfficialMap(id);
  if (map && serverChecksum && map.checksum !== serverChecksum) return { map: null, mismatch: true };
  return { map, mismatch: false };
}

export function loadOfficialMap(id: string): Promise<OfficialMapFile | null> {
  let p = cache.get(id);
  if (!p) {
    const key = Object.keys(files).find((k) => k.endsWith(`/${id}.json`));
    p = key ? (files[key]() as Promise<{ default: OfficialMapFile }>).then((m) => m.default ?? (m as unknown as OfficialMapFile)) : Promise.resolve(null);
    cache.set(id, p);
  }
  return p;
}
