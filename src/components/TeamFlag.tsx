/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface TeamFlagProps {
  flag: string;
  teamId?: number;
  className?: string;
}

const FLAG_SVG_BY_CODE: Record<string, React.ReactNode> = {
  AR: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#74ACDF" />
      <rect y="6.67" width="30" height="6.66" fill="#FFFFFF" />
      <circle cx="15" cy="10" r="2.2" fill="#F6B40E" />
    </svg>
  ),
  FR: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="10" height="20" fill="#002395" />
      <rect x="10" width="10" height="20" fill="#FFFFFF" />
      <rect x="20" width="10" height="20" fill="#ED2939" />
    </svg>
  ),
  ES: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#AA151B" />
      <rect y="5" width="30" height="10" fill="#F1BF00" />
    </svg>
  ),
  BR: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#009739" />
      <polygon points="15,2.5 27,10 15,17.5 3,10" fill="#FEDD00" />
      <circle cx="15" cy="10" r="4.2" fill="#012169" />
    </svg>
  ),
  GB: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#012169" />
      <path d="M0,0 L30,20 M30,0 L0,20" stroke="#FFFFFF" strokeWidth="4" />
      <path d="M0,0 L30,20 M30,0 L0,20" stroke="#C8102E" strokeWidth="2" />
      <path d="M15,0 V20 M0,10 H30" stroke="#FFFFFF" strokeWidth="6" />
      <path d="M15,0 V20 M0,10 H30" stroke="#C8102E" strokeWidth="3.6" />
    </svg>
  ),
  PT: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="12" height="20" fill="#006600" />
      <rect x="12" width="18" height="20" fill="#FF0000" />
      <circle cx="12" cy="10" r="3.5" fill="#FFCC00" />
    </svg>
  ),
  DE: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="6.67" fill="#000000" />
      <rect y="6.67" width="30" height="6.66" fill="#DD0000" />
      <rect y="13.33" width="30" height="6.67" fill="#FFCE00" />
    </svg>
  ),
  NL: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="6.67" fill="#AE1C28" />
      <rect y="6.67" width="30" height="6.66" fill="#FFFFFF" />
      <rect y="13.33" width="30" height="6.67" fill="#21468B" />
    </svg>
  ),
  IT: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="10" height="20" fill="#009246" />
      <rect x="10" width="10" height="20" fill="#FFFFFF" />
      <rect x="20" width="10" height="20" fill="#CE2B37" />
    </svg>
  ),
  HR: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="6.67" fill="#FF0000" />
      <rect y="6.67" width="30" height="6.66" fill="#FFFFFF" />
      <rect y="13.33" width="30" height="6.67" fill="#171796" />
      <rect x="12.5" y="5.5" width="5" height="6" fill="#FF0000" stroke="#FFFFFF" strokeWidth="0.8" />
    </svg>
  ),
  BE: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="10" height="20" fill="#000000" />
      <rect x="10" width="10" height="20" fill="#FDDA24" />
      <rect x="20" width="10" height="20" fill="#EF3340" />
    </svg>
  ),
  UY: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#FFFFFF" />
      <rect y="2.2" width="30" height="2.2" fill="#0038A8" />
      <rect y="6.6" width="30" height="2.2" fill="#0038A8" />
      <rect y="11" width="30" height="2.2" fill="#0038A8" />
      <rect y="15.4" width="30" height="2.2" fill="#0038A8" />
      <rect width="11" height="10" fill="#FFFFFF" />
      <circle cx="5.5" cy="5" r="2.6" fill="#FCD116" />
    </svg>
  ),
  CO: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="10" fill="#FCD116" />
      <rect y="10" width="30" height="5" fill="#003893" />
      <rect y="15" width="30" height="5" fill="#CE1126" />
    </svg>
  ),
  MA: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#C1272D" />
      <polygon points="15,5.5 16.3,9.5 20.5,9.5 17.1,11.9 18.4,15.8 15,13.4 11.6,15.8 12.9,11.9 9.5,9.5 13.7,9.5" fill="none" stroke="#006233" strokeWidth="1.3" />
    </svg>
  ),
  JP: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#FFFFFF" />
      <circle cx="15" cy="10" r="5.5" fill="#BC002D" />
    </svg>
  ),
  US: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#B22234" />
      <rect y="2.8" width="30" height="2.2" fill="#FFFFFF" />
      <rect y="7.2" width="30" height="2.2" fill="#FFFFFF" />
      <rect y="11.6" width="30" height="2.2" fill="#FFFFFF" />
      <rect y="16" width="30" height="2.2" fill="#FFFFFF" />
      <rect width="13" height="10.5" fill="#3C3B6E" />
    </svg>
  ),
  TR: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#E30A17" />
      <circle cx="11.5" cy="10" r="5" fill="#FFFFFF" />
      <circle cx="12.9" cy="10" r="4" fill="#E30A17" />
      <polygon points="17.5,10 20.5,11 19.3,8.5 21.2,10.2 18.7,11.5" fill="#FFFFFF" />
      <circle cx="18.8" cy="10" r="1.4" fill="#FFFFFF" />
    </svg>
  ),
  MX: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="10" height="20" fill="#006847" />
      <rect x="10" width="10" height="20" fill="#FFFFFF" />
      <rect x="20" width="10" height="20" fill="#CE1126" />
      <circle cx="15" cy="10" r="2.2" fill="#8B5A2B" />
    </svg>
  ),
  SN: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="10" height="20" fill="#00853F" />
      <rect x="10" width="10" height="20" fill="#FDEF42" />
      <rect x="20" width="10" height="20" fill="#E31B23" />
      <circle cx="15" cy="10" r="2.2" fill="#00853F" />
    </svg>
  ),
  CH: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#DA291C" />
      <rect x="13" y="4" width="4" height="12" fill="#FFFFFF" />
      <rect x="9" y="8" width="12" height="4" fill="#FFFFFF" />
    </svg>
  ),
  DK: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#C8102E" />
      <rect x="9" width="3.5" height="20" fill="#FFFFFF" />
      <rect y="8.25" width="30" height="3.5" fill="#FFFFFF" />
    </svg>
  ),
  KR: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#FFFFFF" />
      <circle cx="15" cy="10" r="4.8" fill="#CD2E3A" />
      <path d="M10.2,10 A4.8,4.8 0 0,0 19.8,10 Z" fill="#0047A0" />
    </svg>
  ),
  PL: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="10" fill="#FFFFFF" />
      <rect y="10" width="30" height="10" fill="#DC143C" />
    </svg>
  ),
  AU: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#00008B" />
      <rect width="14" height="10" fill="#012169" />
      <path d="M7,0 V10 M0,5 H14" stroke="#FFFFFF" strokeWidth="2.5" />
      <path d="M7,0 V10 M0,5 H14" stroke="#C8102E" strokeWidth="1.3" />
      <circle cx="22" cy="10" r="1.8" fill="#FFFFFF" />
      <circle cx="7" cy="15" r="2" fill="#FFFFFF" />
    </svg>
  ),
  EG: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="6.67" fill="#CE1126" />
      <rect y="6.67" width="30" height="6.66" fill="#FFFFFF" />
      <rect y="13.33" width="30" height="6.67" fill="#000000" />
      <circle cx="15" cy="10" r="1.8" fill="#C09300" />
    </svg>
  ),
  IR: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="6.67" fill="#239F40" />
      <rect y="6.67" width="30" height="6.66" fill="#FFFFFF" />
      <rect y="13.33" width="30" height="6.67" fill="#DA0000" />
      <circle cx="15" cy="10" r="2" fill="#DA0000" />
    </svg>
  ),
  CA: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="7.5" height="20" fill="#FF0000" />
      <rect x="7.5" width="15" height="20" fill="#FFFFFF" />
      <rect x="22.5" width="7.5" height="20" fill="#FF0000" />
      <polygon points="15,5 17.5,11 15,10 15,15 14,15 14,10 12.5,11" fill="#FF0000" />
      <circle cx="15" cy="10" r="3" fill="#FF0000" />
    </svg>
  ),
  NG: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="10" height="20" fill="#008751" />
      <rect x="10" width="10" height="20" fill="#FFFFFF" />
      <rect x="20" width="10" height="20" fill="#008751" />
    </svg>
  ),
  GH: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="6.67" fill="#CE1126" />
      <rect y="6.67" width="30" height="6.66" fill="#FCD116" />
      <rect y="13.33" width="30" height="6.67" fill="#006B3F" />
      <circle cx="15" cy="10" r="2" fill="#000000" />
    </svg>
  ),
  SA: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#006C35" />
      <rect x="7" y="8" width="16" height="2.5" rx="1" fill="#FFFFFF" />
      <rect x="9" y="12.5" width="12" height="1.4" rx="0.7" fill="#FFFFFF" />
    </svg>
  ),
  CR: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#002B7F" />
      <rect y="3.3" width="30" height="13.4" fill="#FFFFFF" />
      <rect y="6.6" width="30" height="6.8" fill="#CE1126" />
    </svg>
  ),
  QA: (
    <svg viewBox="0 0 30 20" className="w-full h-full">
      <rect width="30" height="20" fill="#8A1538" />
      <rect width="9" height="20" fill="#FFFFFF" />
    </svg>
  ),
};

function emojiToCountryCode(emoji: string): string {
  const chars = Array.from(emoji);
  if (chars.length === 2) {
    const c1 = chars[0].codePointAt(0) || 0;
    const c2 = chars[1].codePointAt(0) || 0;
    if (c1 >= 0x1f1e6 && c1 <= 0x1f1ff && c2 >= 0x1f1e6 && c2 <= 0x1f1ff) {
      return String.fromCharCode(c1 - 0x1f1e6 + 65) + String.fromCharCode(c2 - 0x1f1e6 + 65);
    }
  }
  return '';
}

export const TeamFlag: React.FC<TeamFlagProps> = ({ flag, className = 'w-6 h-4' }) => {
  const code = emojiToCountryCode(flag);
  const svg = code ? FLAG_SVG_BY_CODE[code] : null;

  if (svg) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-[3px] overflow-hidden border border-white/20 shadow-xs shrink-0 ${className}`}
        title={code}
      >
        {svg}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-stone-800 border border-stone-600 text-[11px] font-mono font-bold text-stone-200 shrink-0">
      {code || flag}
    </span>
  );
};
