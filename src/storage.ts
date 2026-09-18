import type { AppData, AquariumRecord, Tank } from "./types";

const STORAGE_KEY = "hxwl-05-aquarium-v1";

export function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function atTime(daysAgo: number, hour: number, minute = 0): number {
  const now = new Date();
  const base = new Date();
  base.setDate(base.getDate() - daysAgo);
  base.setHours(hour, minute, 0, 0);
  // 若锚点落在当前时刻之后（例如清晨打开而示例时点在 8:30），
  // 回落到当天零点，保证示例记录恒为历史，新记录一定排在最新。
  if (base.getTime() > now.getTime()) {
    base.setHours(0, 0, 0, 0);
  }
  return base.getTime();
}

/**
 * 首次打开自带的示例：
 * - 草缸A：监测稳定，换水周期 7 天
 * - 海缸B：最新一次关注（硝酸盐升高）
 * - 繁殖缸C：最近两次监测均异常，用于演示“停投喂、先换水”提醒
 */
export function buildSeedData(): AppData {
  const tanks: Tank[] = [
    {
      id: "tank-a",
      name: "草缸A",
      type: "planted",
      changeIntervalDays: 7,
      createdAt: atTime(30, 9),
    },
    {
      id: "tank-b",
      name: "海缸B",
      type: "marine",
      changeIntervalDays: 14,
      createdAt: atTime(30, 9),
    },
    {
      id: "tank-c",
      name: "繁殖缸C",
      type: "breeding",
      changeIntervalDays: 4,
      createdAt: atTime(30, 9),
    },
  ];

  const records: AquariumRecord[] = [
    // —— 草缸A：换水 3 天前，周期 7 -> 距下次换水 4 天；最新监测稳定 ——
    {
      id: "seed-a-w1",
      tankId: "tank-a",
      kind: "waterchange",
      time: atTime(3, 18),
      amount: 30,
      intervalDays: 7,
    },
    {
      id: "seed-a-c1",
      tankId: "tank-a",
      kind: "check",
      time: atTime(2, 9),
      ph: 6.9,
      ammonia: 0,
      nitrate: 18,
      temperature: 25,
    },
    {
      id: "seed-a-c2",
      tankId: "tank-a",
      kind: "check",
      time: atTime(1, 9),
      ph: 6.8,
      ammonia: 0.05,
      nitrate: 16,
      temperature: 24.8,
    },

    // —— 海缸B：换水 5 天前，周期 14 -> 9 天；最新监测关注（硝酸盐 15）——
    {
      id: "seed-b-w1",
      tankId: "tank-b",
      kind: "waterchange",
      time: atTime(5, 19),
      amount: 20,
      intervalDays: 14,
    },
    {
      id: "seed-b-c1",
      tankId: "tank-b",
      kind: "check",
      time: atTime(2, 10),
      ph: 8.2,
      ammonia: 0,
      nitrate: 8,
      temperature: 25.6,
    },
    {
      id: "seed-b-c2",
      tankId: "tank-b",
      kind: "check",
      time: atTime(0, 10),
      ph: 8.1,
      ammonia: 0.04,
      nitrate: 15,
      temperature: 26.2,
    },

    // —— 繁殖缸C：换水 6 天前，周期 4 -> 已逾期 2 天；最近两次均异常 ——
    {
      id: "seed-c-w1",
      tankId: "tank-c",
      kind: "waterchange",
      time: atTime(6, 17),
      amount: 25,
      intervalDays: 4,
    },
    {
      id: "seed-c-c1",
      tankId: "tank-c",
      kind: "check",
      time: atTime(3, 8, 30),
      ph: 7.1,
      ammonia: 0.08,
      nitrate: 15,
      temperature: 26.4,
    },
    {
      id: "seed-c-c2",
      tankId: "tank-c",
      kind: "check",
      time: atTime(1, 8, 30),
      ph: 6.6,
      ammonia: 0.3,
      nitrate: 45,
      temperature: 30.5,
    },
    {
      id: "seed-c-c3",
      tankId: "tank-c",
      kind: "check",
      time: atTime(0, 8, 30),
      ph: 6.4,
      ammonia: 0.4,
      nitrate: 55,
      temperature: 31,
    },
  ];

  return { version: 1, tanks, records };
}

function isValidData(data: unknown): data is AppData {
  if (!data || typeof data !== "object") return false;
  const d = data as AppData;
  return (
    d.version === 1 &&
    Array.isArray(d.tanks) &&
    Array.isArray(d.records) &&
    d.tanks.every(
      (t) =>
        typeof t.id === "string" &&
        typeof t.name === "string" &&
        typeof t.type === "string" &&
        typeof t.changeIntervalDays === "number"
    )
  );
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isValidData(parsed)) return parsed;
    }
  } catch {
    // 存储损坏时回落到示例数据
  }
  return buildSeedData();
}

export function saveData(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 隐私模式等场景下静默失败，当前会话仍可用
  }
}

export function resetData(): AppData {
  const seed = buildSeedData();
  saveData(seed);
  return seed;
}
