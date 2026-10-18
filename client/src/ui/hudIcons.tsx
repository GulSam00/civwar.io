/**
 * HUD 아이콘 (2026-10-18 우상단 컨트롤 묶음·정보 카드). 24 격자 선 아이콘, currentColor — 톱니(GearIcon)와 같은 굵기.
 */
type P = { size?: number };

function Svg({ size = 16, children }: P & { children: React.ReactNode }) {
  return (
    <svg className="hud-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const HelpIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8" />
    <path d="M12 17.2h.01" />
  </Svg>
);

export const FullscreenIcon = ({ on, ...p }: P & { on: boolean }) => (
  <Svg {...p}>
    {on ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
  </Svg>
);

export const LeaveIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Svg>
);

export const EmoteIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
  </Svg>
);

export const FollowIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
  </Svg>
);

export const ClockIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

/** 원형 메뉴 (2026-10-18) — 정보 */
export const InfoIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5h.01" />
  </Svg>
);

/** 원형 메뉴 — 동맹 (맞잡은 두 고리) */
export const AllyIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="12" r="5" />
    <circle cx="15" cy="12" r="5" />
  </Svg>
);

/** 원형 메뉴 — 수비 배치 (기지 탑) */
export const BaseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 20V9l2-2 2 2V6h6v3l2-2 2 2v11z" />
    <path d="M10 20v-4a2 2 0 0 1 4 0v4" />
  </Svg>
);

/** 원형 메뉴 — 지정 불가 (금지) */
export const BlockedIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6 18L18 6" />
  </Svg>
);
