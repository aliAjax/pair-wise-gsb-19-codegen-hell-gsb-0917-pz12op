export type TankType = "planted" | "marine" | "breeding";

export type RecordKind = "check" | "waterchange";

export type Level = "stable" | "watch" | "danger";

/** 一次普通监测必须同时具备的四项指标 */
export interface CheckValues {
  ph: number;
  ammonia: number; // 氨氮 ppm
  nitrate: number; // 硝酸盐 ppm
  temperature: number; // 温度 °C
}

export interface Tank {
  id: string;
  name: string;
  type: TankType;
  /** 默认换水周期（天），新增换水记录时预填，可按次调整 */
  changeIntervalDays: number;
  createdAt: number;
}

export interface CheckRecord extends CheckValues {
  id: string;
  tankId: string;
  kind: "check";
  time: number;
}

export interface WaterChangeRecord {
  id: string;
  tankId: string;
  kind: "waterchange";
  time: number;
  amount: number; // 本次换水量百分比 1-100
  intervalDays: number; // 本次换水后到下次换水的周期（天）
}

export type AquariumRecord = CheckRecord | WaterChangeRecord;

export interface AppData {
  version: 1;
  tanks: Tank[];
  records: AquariumRecord[];
}
