export interface Property {
  source: 'SUUMO' | 'HOMES';
  name: string;
  address: string;
  stations: string[];
  layout: string;
  area: number;           // m²
  rent: number;           // 円
  management: number;     // 円
  deposit: string;
  keyMoney: string;
  builtYear: string;      // "2020年3月" 等
  builtYearNum: number;   // 2020 等 (ソート用)
  structure: string;      // RC, SRC 等
  floor: string;
  effectiveCost: number;      // 0.6×rent + management
  effectiveCostPerSqm: number; // effectiveCost / area
  url: string;
  // 募集状況（詳細ページ検証で付与）
  available?: boolean;        // 募集中か（ページ生存＆未終了＆更新日が有効）
  infoUpdated?: string;       // 情報更新日 "2026/06/13"
  nextUpdate?: string;        // 次回更新予定日 "2026/06/21"
  verifyNote?: string;        // 判定理由
}

export const CURRENT_PROPERTY = {
  name: 'フジマンションイーストファイブ 206号室',
  rent: 97000,
  management: 0,
  area: 30.03,
  builtYear: '2007年2月',
  effectiveCost: 58200,
  effectiveCostPerSqm: 2123,
};

export function calcEffectiveCost(rent: number, management: number): number {
  // 補助：賃料の50%、上限5万、課税20%
  // 賃料10万以下: 実質 = 0.6 × 賃料 + 管理費
  const subsidy = Math.min(rent * 0.5, 50000);
  const afterTaxSubsidy = subsidy * 0.8;
  return Math.round(rent - afterTaxSubsidy + management);
}

export function parseRent(text: string): number {
  const wan = text.match(/([\d.]+)\s*万/);
  if (wan) return Math.round(parseFloat(wan[1]) * 10000);
  const yen = text.match(/([\d,]+)\s*円/);
  if (yen) return parseInt(yen[1].replace(/,/g, ''), 10);
  return 0;
}

export function parseArea(text: string): number {
  const m = text.match(/([\d.]+)\s*m/);
  return m ? parseFloat(m[1]) : 0;
}

export function parseBuiltYear(text: string): number {
  const m = text.match(/(\d{4})\s*年/);
  return m ? parseInt(m[1], 10) : 0;
}
