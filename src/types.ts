export interface Property {
  name: string;
  address: string;
  stations: string[];
  layout: string;
  area: number;         // m²
  rent: number;         // 円
  management: number;   // 円
  deposit: string;
  keyMoney: string;
  builtYear: string;    // 築年月
  structure: string;    // 構造
  floor: string;
  effectiveCost: number;     // 0.6 × rent + management
  effectiveCostPerSqm: number; // effectiveCost / area
  url: string;
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
