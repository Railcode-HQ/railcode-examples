// Small stroke icons (15px default), currentColor. Kept inline to avoid a dep.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

export const IconBoard = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="5" height="16" rx="1.2" />
    <rect x="9.5" y="4" width="5" height="11" rx="1.2" />
    <rect x="16" y="4" width="5" height="14" rx="1.2" />
  </svg>
);

export const IconList = (p: P) => (
  <svg {...base(p)}>
    <line x1="8" y1="6" x2="20" y2="6" />
    <line x1="8" y1="12" x2="20" y2="12" />
    <line x1="8" y1="18" x2="20" y2="18" />
    <circle cx="4" cy="6" r="1" />
    <circle cx="4" cy="12" r="1" />
    <circle cx="4" cy="18" r="1" />
  </svg>
);

export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.5" y2="16.5" />
  </svg>
);

export const IconTag = (p: P) => (
  <svg {...base(p)}>
    <path d="M20.6 13.4 12.6 21.4a2 2 0 0 1-2.8 0l-6.4-6.4a2 2 0 0 1 0-2.8l8-8A2 2 0 0 1 12.6 3.6l6.4.4.4 6.4a2 2 0 0 1-.8 3z" />
    <circle cx="15" cy="9" r="1.3" />
  </svg>
);

export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

export const IconCornerReturn = (p: P) => (
  <svg {...base(p)}>
    <polyline points="9 10 4 15 9 20" />
    <path d="M20 4v7a4 4 0 0 1-4 4H4" />
  </svg>
);

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const IconCalendar = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="16" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="8" y1="2.5" x2="8" y2="6.5" />
    <line x1="16" y1="2.5" x2="16" y2="6.5" />
  </svg>
);

export const IconMenu = (p: P) => (
  <svg {...base(p)}>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

export const IconGrip = (p: P) => (
  <svg {...base({ strokeWidth: 0, fill: "currentColor", ...p })}>
    <circle cx="9" cy="6" r="1.4" />
    <circle cx="15" cy="6" r="1.4" />
    <circle cx="9" cy="12" r="1.4" />
    <circle cx="15" cy="12" r="1.4" />
    <circle cx="9" cy="18" r="1.4" />
    <circle cx="15" cy="18" r="1.4" />
  </svg>
);

export const IconSort = (p: P) => (
  <svg {...base(p)}>
    <line x1="5" y1="6" x2="19" y2="6" />
    <line x1="5" y1="12" x2="14" y2="12" />
    <line x1="5" y1="18" x2="9" y2="18" />
  </svg>
);

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const IconChevronsLeft = (p: P) => (
  <svg {...base(p)}>
    <polyline points="11 7 6 12 11 17" />
    <polyline points="17 7 12 12 17 17" />
  </svg>
);

export const IconPaperclip = (p: P) => (
  <svg {...base(p)}>
    <path d="M20.5 12.2 12.2 20.5a5 5 0 0 1-7.1-7.1l8.9-8.9a3.3 3.3 0 0 1 4.7 4.7l-8.9 8.9a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
  </svg>
);
