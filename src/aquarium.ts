import type {
  AquariumRecord,
  CheckValues,
  Level,
  Tank,
  TankType,
} from "./types";

export const TANK_TYPE_LABEL: Record<TankType, string> = {
  planted: "草缸",
  marine: "海缸",
  breeding: "繁殖缸",
};

export const LEVEL_LABEL: Record<Level, string> = {
  stable: "稳定",
  watch: "关注",
  danger: "异常",
};

export const LEVEL_RANK: Record<Level, number> = {
  stable: 0,
  watch: 1,
  danger: 2,
};

interface MetricRange {
  /** 稳定区间（闭区间），pH / 温度使用 */
  stable?: [number, number];
  /** 关注上限（<= 为关注），超过即异常；氨氮 / 硝酸盐使用 */
  watchMax?: number;
  /** 关注下限（pH / 温度双向使用），低于稳定下限到关注下限之间为关注 */
  watchMin?: number;
}

interface ThresholdSet {
  ph: MetricRange;
  ammonia: MetricRange;
  nitrate: MetricRange;
  temperature: MetricRange;
}

/**
 * 各缸型的水质阈值：
 * - 落在稳定区间 -> 稳定；
 * - 进入关注带（含关注端点）-> 关注；
 * - 超出关注带 -> 异常。
 */
export const THRESHOLDS: Record<TankType, ThresholdSet> = {
  // 草缸：弱酸、低氨、硝酸盐容忍度中等
  planted: {
    ph: { stable: [6.5, 7.2], watchMin: 6.0, watchMax: 7.6 },
    ammonia: { watchMax: 0.25 },
    nitrate: { stable: [0, 30], watchMax: 50 },
    temperature: { stable: [22, 26], watchMin: 20, watchMax: 28 },
  },
  // 海缸：偏碱稳定 pH、低温升要求、硝酸盐要求更低
  marine: {
    ph: { stable: [8.0, 8.4], watchMin: 7.8, watchMax: 8.6 },
    ammonia: { watchMax: 0.1 },
    nitrate: { stable: [0, 10], watchMax: 20 },
    temperature: { stable: [24, 27], watchMin: 23, watchMax: 28 },
  },
  // 繁殖缸：幼体对氨和温度更敏感
  breeding: {
    ph: { stable: [6.8, 7.4], watchMin: 6.5, watchMax: 7.8 },
    ammonia: { watchMax: 0.1 },
    nitrate: { stable: [0, 20], watchMax: 40 },
    temperature: { stable: [25, 28], watchMin: 24, watchMax: 30 },
  },
};

export type MetricKey = keyof CheckValues;

export const METRICS: { key: MetricKey; label: string; unit: string; step: number }[] = [
  { key: "ph", label: "pH", unit: "", step: 0.1 },
  { key: "ammonia", label: "氨氮", unit: "ppm", step: 0.01 },
  { key: "nitrate", label: "硝酸盐", unit: "ppm", step: 1 },
  { key: "temperature", label: "温度", unit: "°C", step: 0.1 },
];

export function metricLevel(type: TankType, metric: MetricKey, value: number): Level {
  const rule = THRESHOLDS[type][metric];

  if (rule.stable) {
    const [lo, hi] = rule.stable;
    if (value >= lo && value <= hi) return "stable";
    const floor = rule.watchMin ?? -Infinity;
    const ceil = rule.watchMax ?? Infinity;
    if (value >= floor && value <= ceil) return "watch";
    return "danger";
  }

  const watchMax = rule.watchMax ?? Infinity;
  if (value <= watchMax / 2) return "stable";
  if (value <= watchMax) return "watch";
  return "danger";
}

/** 一次监测四项指标中最差的一级，即该次记录状态；不允许人工指定 */
export function evaluateCheck(type: TankType, values: CheckValues) {
  const levels = {
    ph: metricLevel(type, "ph", values.ph),
    ammonia: metricLevel(type, "ammonia", values.ammonia),
    nitrate: metricLevel(type, "nitrate", values.nitrate),
    temperature: metricLevel(type, "temperature", values.temperature),
  };
  const overall = (Object.keys(levels) as MetricKey[]).reduce(
    (worst, key) => (LEVEL_RANK[levels[key]] > LEVEL_RANK[worst] ? levels[key] : worst),
    "stable" as Level
  );
  return { levels, overall };
}

/** 阈值的人类可读说明，用于表单提示 */
export function rangeHint(type: TankType, metric: MetricKey): string {
  const rule = THRESHOLDS[type][metric];
  if (metric === "ph" || metric === "temperature") {
    const s = rule.stable!;
    return `稳定 ${s[0]}~${s[1]}${metric === "temperature" ? "°C" : ""}，关注 ${rule.watchMin}~${rule.watchMax}`;
  }
  if (metric === "ammonia") {
    return `≤${(rule.watchMax! / 2).toFixed(2)} 稳定，≤${rule.watchMax} 关注`;
  }
  return `≤${rule.stable![1]} 稳定，≤${rule.watchMax} 关注（ppm）`;
}

export interface TankStatus {
  tank: Tank;
  checks: (Extract<AquariumRecord, { kind: "check" }> & { level: Level })[];
  latest: (CheckValues & { level: Level; time: number }) | null;
  consecutiveDanger: number;
  /** 连续两次及以上异常：提醒先停投喂、换水 */
  dangerAlert: boolean;
  lastWaterChange: { time: number; intervalDays: number; amount: number } | null;
  /** 距下次换水天数，可负（已逾期）；无换水记录时为 null */
  daysUntilChange: number | null;
  dueToday: boolean;
  overdue: boolean;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeTankStatus(tank: Tank, records: AquariumRecord[], now: number): TankStatus {
  const own = records
    .filter((r) => r.tankId === tank.id)
    .sort((a, b) => a.time - b.time);

  const checks = own
    .filter((r): r is Extract<AquariumRecord, { kind: "check" }> => r.kind === "check")
    .map((r) => ({ ...r, level: evaluateCheck(tank.type, r).overall }));

  const latestCheck = checks.length ? checks[checks.length - 1] : null;

  // 从最新一次监测向前数连续异常的次数（普通监测不重置换水，换水也不打断异常连击）
  let consecutiveDanger = 0;
  for (let i = checks.length - 1; i >= 0; i--) {
    if (checks[i].level === "danger") consecutiveDanger += 1;
    else break;
  }

  const waterChanges = own.filter(
    (r): r is Extract<AquariumRecord, { kind: "waterchange" }> => r.kind === "waterchange"
  );
  const lastWaterChange = waterChanges.length
    ? (() => {
        const w = waterChanges[waterChanges.length - 1];
        return { time: w.time, intervalDays: w.intervalDays, amount: w.amount };
      })()
    : null;

  let daysUntilChange: number | null = null;
  if (lastWaterChange) {
    const dueDay = startOfDay(lastWaterChange.time) + lastWaterChange.intervalDays * DAY_MS;
    daysUntilChange = Math.round((dueDay - startOfDay(now)) / DAY_MS);
  }

  return {
    tank,
    checks,
    latest: latestCheck
      ? {
          ph: latestCheck.ph,
          ammonia: latestCheck.ammonia,
          nitrate: latestCheck.nitrate,
          temperature: latestCheck.temperature,
          level: latestCheck.level,
          time: latestCheck.time,
        }
      : null,
    consecutiveDanger,
    dangerAlert: consecutiveDanger >= 2,
    lastWaterChange,
    daysUntilChange,
    dueToday: daysUntilChange === 0,
    overdue: daysUntilChange !== null && daysUntilChange < 0,
  };
}
