import { useEffect, useMemo, useState } from "react";
import "./styles.css";

/* ---------- 类型与阈值 ---------- */

type TankType = "planted" | "marine" | "breeding" | "rift";
type Severity = "ok" | "watch" | "danger";
type RecordKind = "monitor" | "change";

interface Tank {
  id: string;
  name: string;
  type: TankType;
}

interface MonitorRecord {
  id: string;
  tankId: string;
  kind: "monitor";
  time: number;
  ph: number;
  nh3: number;
  no3: number;
  temp: number;
}

interface ChangeRecord {
  id: string;
  tankId: string;
  kind: "change";
  time: number;
  percent: number;
  note?: string;
}

type AquariumRecord = MonitorRecord | ChangeRecord;

interface RangeRule {
  ok: [number, number];
  danger: [number, number];
}
interface HighRule {
  ok: number; // <= ok 稳定
  danger: number; // > danger 异常，之间为关注
}

interface TypeRule {
  label: string;
  cycle: number; // 建议换水周期（天）
  ph: RangeRule;
  nh3: HighRule;
  no3: HighRule;
  temp: RangeRule;
}

const TYPE_RULES: Record<TankType, TypeRule> = {
  planted: {
    label: "草缸",
    cycle: 7,
    ph: { ok: [6.4, 7.2], danger: [6.0, 7.6] },
    nh3: { ok: 0.02, danger: 0.1 },
    no3: { ok: 25, danger: 40 },
    temp: { ok: [22, 26], danger: [20, 28] },
  },
  marine: {
    label: "海缸",
    cycle: 14,
    ph: { ok: [8.0, 8.4], danger: [7.8, 8.6] },
    nh3: { ok: 0.02, danger: 0.1 },
    no3: { ok: 5, danger: 15 },
    temp: { ok: [24, 26], danger: [23, 28] },
  },
  breeding: {
    label: "繁殖缸",
    cycle: 5,
    ph: { ok: [6.8, 7.4], danger: [6.5, 7.8] },
    nh3: { ok: 0.02, danger: 0.1 },
    no3: { ok: 10, danger: 20 },
    temp: { ok: [25, 28], danger: [24, 30] },
  },
  rift: {
    label: "三湖缸",
    cycle: 10,
    ph: { ok: [7.8, 8.6], danger: [7.5, 9.0] },
    nh3: { ok: 0.02, danger: 0.1 },
    no3: { ok: 15, danger: 30 },
    temp: { ok: [24, 27], danger: [23, 29] },
  },
};

const STATUS_TEXT: Record<Severity, string> = {
  ok: "稳定",
  watch: "关注",
  danger: "异常",
};

const METRIC_META = [
  { key: "ph", label: "pH" },
  { key: "nh3", label: "氨氮" },
  { key: "no3", label: "硝酸盐" },
  { key: "temp", label: "温度" },
] as const;

/* ---------- 纯计算：状态全部由历史记录推导，不可手选 ---------- */

function evalRange(value: number, rule: RangeRule): Severity {
  if (value < rule.danger[0] || value > rule.danger[1]) return "danger";
  if (value < rule.ok[0] || value > rule.ok[1]) return "watch";
  return "ok";
}

function evalHigh(value: number, rule: HighRule): Severity {
  if (value > rule.danger) return "danger";
  if (value > rule.ok) return "watch";
  return "ok";
}

function metricSeverity(key: "ph" | "nh3" | "no3" | "temp", value: number, type: TankType): Severity {
  const rule = TYPE_RULES[type];
  if (key === "ph") return evalRange(value, rule.ph);
  if (key === "temp") return evalRange(value, rule.temp);
  if (key === "nh3") return evalHigh(value, rule.nh3);
  return evalHigh(value, rule.no3);
}

function monitorSeverity(record: MonitorRecord, type: TankType): Severity {
  const levels: Severity[] = [
    metricSeverity("ph", record.ph, type),
    metricSeverity("nh3", record.nh3, type),
    metricSeverity("no3", record.no3, type),
    metricSeverity("temp", record.temp, type),
  ];
  if (levels.includes("danger")) return "danger";
  if (levels.includes("watch")) return "watch";
  return "ok";
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface TankSummary {
  tank: Tank;
  latest: MonitorRecord | null;
  status: Severity | null;
  consecutiveDanger: boolean;
  lastChange: ChangeRecord | null;
  daysSinceChange: number | null;
  daysToNextChange: number | null;
}

function summarize(tank: Tank, records: AquariumRecord[], now: number): TankSummary {
  const mine = records.filter((r) => r.tankId === tank.id);
  const monitors = mine
    .filter((r): r is MonitorRecord => r.kind === "monitor")
    .sort((a, b) => a.time - b.time);
  const changes = mine
    .filter((r): r is ChangeRecord => r.kind === "change")
    .sort((a, b) => b.time - a.time);

  const latest = monitors.length ? monitors[monitors.length - 1] : null;
  const status = latest ? monitorSeverity(latest, tank.type) : null;

  // 连续两次监测异常（按监测时间排序的最近两次）
  const lastTwo = monitors.slice(-2);
  const consecutiveDanger =
    lastTwo.length === 2 && lastTwo.every((r) => monitorSeverity(r, tank.type) === "danger");

  const lastChange = changes[0] ?? null;
  const daysSinceChange = lastChange ? Math.floor((now - lastChange.time) / DAY_MS) : null;
  const daysToNextChange =
    lastChange !== null ? TYPE_RULES[tank.type].cycle - (daysSinceChange ?? 0) : null;

  return { tank, latest, status, consecutiveDanger, lastChange, daysSinceChange, daysToNextChange };
}

/* ---------- 首次打开的示例数据（草缸A / 海缸B / 繁殖缸C） ---------- */

const STORAGE_KEY = "aquarium-logger-v1";

interface PersistShape {
  tanks: Tank[];
  records: AquariumRecord[];
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function seedData(): PersistShape {
  const now = Date.now();
  const tankA: Tank = { id: "tank-a", name: "草缸A", type: "planted" };
  const tankB: Tank = { id: "tank-b", name: "海缸B", type: "marine" };
  const tankC: Tank = { id: "tank-c", name: "繁殖缸C", type: "breeding" };

  const records: AquariumRecord[] = [
    // 草缸A：5 天前换水 30%，2 天前监测稳定
    {
      id: "seed-a-change",
      tankId: tankA.id,
      kind: "change",
      time: now - 5 * DAY_MS,
      percent: 30,
      note: "周末例行换水",
    },
    {
      id: "seed-a-m1",
      tankId: tankA.id,
      kind: "monitor",
      time: now - 2 * DAY_MS,
      ph: 6.8,
      nh3: 0.01,
      no3: 18,
      temp: 24.5,
    },
    // 海缸B：10 天前换水 20%，3 天前监测需关注
    {
      id: "seed-b-change",
      tankId: tankB.id,
      kind: "change",
      time: now - 10 * DAY_MS,
      percent: 20,
    },
    {
      id: "seed-b-m1",
      tankId: tankB.id,
      kind: "monitor",
      time: now - 3 * DAY_MS,
      ph: 8.1,
      nh3: 0.03,
      no3: 8,
      temp: 25.5,
    },
    // 繁殖缸C：9 天前换水 25%，最近连续两次监测异常
    {
      id: "seed-c-change",
      tankId: tankC.id,
      kind: "change",
      time: now - 9 * DAY_MS,
      percent: 25,
    },
    {
      id: "seed-c-m1",
      tankId: tankC.id,
      kind: "monitor",
      time: now - 4 * DAY_MS,
      ph: 7.2,
      nh3: 0.15,
      no3: 22,
      temp: 28.5,
    },
    {
      id: "seed-c-m2",
      tankId: tankC.id,
      kind: "monitor",
      time: now - 1 * DAY_MS,
      ph: 7.0,
      nh3: 0.2,
      no3: 26,
      temp: 29,
    },
  ];

  return { tanks: [tankA, tankB, tankC], records };
}

function loadData(): PersistShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistShape;
      if (Array.isArray(parsed.tanks) && Array.isArray(parsed.records)) return parsed;
    }
  } catch {
    // 存储损坏时回落到示例数据
  }
  return seedData();
}

/* ---------- 工具 ---------- */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function nowLocalInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

function severityClass(s: Severity | null): string {
  return s === "danger" ? "sev-danger" : s === "watch" ? "sev-watch" : "sev-ok";
}

/* ---------- 组件 ---------- */

function App() {
  const [data, setData] = useState<PersistShape>(loadData);
  const [typeFilter, setTypeFilter] = useState<TankType | "all">("all");
  const [now, setNow] = useState(() => Date.now());

  // 持久化：撤销 / 新增后刷新仍保留
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // 隐私模式等场景忽略写入失败
    }
  }, [data]);

  // 每分钟刷新一次“距下次换水天数”
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const summaries = useMemo(
    () => data.tanks.map((tank) => summarize(tank, data.records, now)),
    [data, now],
  );

  const visibleTanks = summaries.filter((s) => typeFilter === "all" || s.tank.type === typeFilter);

  const counts = {
    ok: summaries.filter((s) => s.status === "ok").length,
    watch: summaries.filter((s) => s.status === "watch").length,
    danger: summaries.filter((s) => s.status === "danger").length,
  };

  const addRecord = (record: AquariumRecord) => {
    setData((prev) => ({ ...prev, records: [...prev.records, record] }));
  };

  const undoRecord = (id: string) => {
    // 状态、提醒、换水天数全部由剩余历史立即回算
    setData((prev) => ({ ...prev, records: prev.records.filter((r) => r.id !== id) }));
  };

  const addTank = (name: string, type: TankType) => {
    const tank: Tank = { id: uid(), name: name.trim(), type };
    setData((prev) => ({ ...prev, tanks: [...prev.tanks, tank] }));
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-05 · 连续记录模式</p>
          <h1>水族箱水质记录器</h1>
          <p className="subtitle">
            pH、氨氮、硝酸盐、温度一次填齐，状态按缸型阈值自动判定；换水记录驱动换水周期，撤销后立即回算，数据本地持久保存。
          </p>
        </div>
        <div className="stack-card">
          <span>判定规则</span>
          <strong>稳定 / 关注 / 异常</strong>
          <span>状态由指标自动计算，不能手动选择</span>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="metric-card">
          <span>鱼缸总数</span>
          <strong>{summaries.length}</strong>
          <i className="status-ok" />
        </article>
        <article className="metric-card">
          <span>稳定</span>
          <strong>{counts.ok}</strong>
          <i className="status-ok" />
        </article>
        <article className="metric-card">
          <span>关注</span>
          <strong>{counts.watch}</strong>
          <i className="status-watch" />
        </article>
        <article className="metric-card">
          <span>异常</span>
          <strong>{counts.danger}</strong>
          <i className="status-danger" />
        </article>
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>按类型筛选</h2>
          <div className="chips">
            <button
              className={typeFilter === "all" ? "chip-active" : ""}
              onClick={() => setTypeFilter("all")}
            >
              全部
            </button>
            {(Object.keys(TYPE_RULES) as TankType[]).map((type) => (
              <button
                key={type}
                className={typeFilter === type ? "chip-active" : ""}
                onClick={() => setTypeFilter(type)}
              >
                {TYPE_RULES[type].label}
              </button>
            ))}
          </div>

          <h2>监测指标</h2>
          <div className="chips muted">
            {METRIC_META.map((m) => (
              <span key={m.key}>{m.label}</span>
            ))}
          </div>

          <AddTankForm onAdd={addTank} />
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>新增记录</p>
              <h2>录入监测或换水</h2>
            </div>
          </div>
          <RecordForm tanks={data.tanks} onSubmit={addRecord} />
        </section>
      </section>

      <section className="tank-grid">
        {visibleTanks.map((summary) => (
          <TankCard key={summary.tank.id} summary={summary} />
        ))}
        {visibleTanks.length === 0 && (
          <p className="empty-hint">该类型下暂无鱼缸，可在左侧新增鱼缸。</p>
        )}
      </section>

      <RecordsPanel
        tanks={data.tanks}
        records={data.records}
        filter={typeFilter}
        onUndo={undoRecord}
      />
    </main>
  );
}

/* ---------- 鱼缸卡片 ---------- */

function TankCard({ summary }: { summary: TankSummary }) {
  const { tank, latest, status, consecutiveDanger, lastChange, daysToNextChange } = summary;
  const rule = TYPE_RULES[tank.type];

  return (
    <article className="tank-card panel">
      <div className="tank-head">
        <div>
          <h3>{tank.name}</h3>
          <p className="tank-type">
            {rule.label} · 换水周期 {rule.cycle} 天
          </p>
        </div>
        <span className={`badge ${severityClass(status)}`}>
          {status ? STATUS_TEXT[status] : "暂无监测"}
        </span>
      </div>

      {consecutiveDanger && (
        <div className="alert-banner">
          连续两次监测异常：请先停止投喂，并尽快换水后复测。
        </div>
      )}

      <dl className="metric-readouts">
        {latest ? (
          METRIC_META.map((m) => {
            const value = latest[m.key];
            const sev = metricSeverity(m.key, value, tank.type);
            return (
              <div key={m.key} className={`readout ${severityClass(sev)}`}>
                <dt>{m.label}</dt>
                <dd>
                  {value}
                  {m.key === "nh3" || m.key === "no3" ? " ppm" : m.key === "temp" ? " ℃" : ""}
                </dd>
              </div>
            );
          })
        ) : (
          <p className="empty-hint">还没有监测记录</p>
        )}
      </dl>

      <div className="change-line">
        {lastChange ? (
          <>
            <span>
              上次换水：{fmtTime(lastChange.time)}（{lastChange.percent}%）
            </span>
            {daysToNextChange !== null && daysToNextChange > 0 ? (
              <strong className="days-ok">距下次换水还有 {daysToNextChange} 天</strong>
            ) : daysToNextChange === 0 ? (
              <strong className="days-overdue">今天就该换水了</strong>
            ) : (
              <strong className="days-overdue">
                已超过建议换水时间 {Math.abs(daysToNextChange ?? 0)} 天，请尽快换水
              </strong>
            )}
          </>
        ) : (
          <span className="empty-hint">暂无换水记录，换水天数无法计算</span>
        )}
      </div>
    </article>
  );
}

/* ---------- 新增记录表单 ---------- */

function RecordForm({
  tanks,
  onSubmit,
}: {
  tanks: Tank[];
  onSubmit: (record: AquariumRecord) => void;
}) {
  const [kind, setKind] = useState<RecordKind>("monitor");
  const [tankId, setTankId] = useState(tanks[0]?.id ?? "");
  const [time, setTime] = useState(nowLocalInput());
  const [ph, setPh] = useState("");
  const [nh3, setNh3] = useState("");
  const [no3, setNo3] = useState("");
  const [temp, setTemp] = useState("");
  const [percent, setPercent] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  // 鱼缸列表变化（新增鱼缸）时，自动选中新缸
  useEffect(() => {
    if (!tanks.some((t) => t.id === tankId) && tanks.length > 0) {
      setTankId(tanks[tanks.length - 1].id);
    }
  }, [tanks, tankId]);

  const switchKind = (next: RecordKind) => {
    setKind(next);
    setError("");
  };

  const handleSubmit = () => {
    if (!tankId) {
      setError("请先选择鱼缸");
      return;
    }
    const ts = new Date(time).getTime();
    const recordTime = Number.isNaN(ts) ? Date.now() : ts;

    if (kind === "monitor") {
      // 四项必须一次填齐，缺一不可
      if (ph.trim() === "" || nh3.trim() === "" || no3.trim() === "" || temp.trim() === "") {
        setError("pH、氨氮、硝酸盐、温度必须一次全部填写");
        return;
      }
      const values = { ph: Number(ph), nh3: Number(nh3), no3: Number(no3), temp: Number(temp) };
      if (Object.values(values).some((v) => Number.isNaN(v))) {
        setError("所有指标都必须是数字");
        return;
      }
      if (values.ph < 0 || values.ph > 14) {
        setError("pH 应在 0–14 之间");
        return;
      }
      onSubmit({ id: uid(), tankId, kind: "monitor", time: recordTime, ...values });
      setPh("");
      setNh3("");
      setNo3("");
      setTemp("");
    } else {
      if (percent.trim() === "") {
        setError("请填写本次换水量（%）");
        return;
      }
      const pct = Number(percent);
      if (Number.isNaN(pct) || pct <= 0 || pct > 100) {
        setError("换水量应为 1–100 之间的数字（%）");
        return;
      }
      onSubmit({
        id: uid(),
        tankId,
        kind: "change",
        time: recordTime,
        percent: pct,
        note: note.trim() || undefined,
      });
      setPercent("");
      setNote("");
    }
    setError("");
    setTime(nowLocalInput());
  };

  return (
    <div className="record-form">
      <div className="form-row">
        <label className="form-field">
          <span>鱼缸</span>
          <select value={tankId} onChange={(e) => setTankId(e.target.value)}>
            {tanks.map((tank) => (
              <option key={tank.id} value={tank.id}>
                {tank.name}（{TYPE_RULES[tank.type].label}）
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>记录时间</span>
          <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <div className="form-field">
          <span>记录类型</span>
          <div className="kind-toggle">
            <button
              type="button"
              className={kind === "monitor" ? "chip-active" : ""}
              onClick={() => switchKind("monitor")}
            >
              水质监测
            </button>
            <button
              type="button"
              className={kind === "change" ? "chip-active" : ""}
              onClick={() => switchKind("change")}
            >
              换水记录
            </button>
          </div>
        </div>
      </div>

      {kind === "monitor" ? (
        <div className="form-row">
          <label className="form-field">
            <span>pH（必填）</span>
            <input
              inputMode="decimal"
              placeholder="如 7.2"
              value={ph}
              onChange={(e) => setPh(e.target.value)}
            />
          </label>
          <label className="form-field">
            <span>氨氮 ppm（必填）</span>
            <input
              inputMode="decimal"
              placeholder="如 0.02"
              value={nh3}
              onChange={(e) => setNh3(e.target.value)}
            />
          </label>
          <label className="form-field">
            <span>硝酸盐 ppm（必填）</span>
            <input
              inputMode="decimal"
              placeholder="如 18"
              value={no3}
              onChange={(e) => setNo3(e.target.value)}
            />
          </label>
          <label className="form-field">
            <span>温度 ℃（必填）</span>
            <input
              inputMode="decimal"
              placeholder="如 25.5"
              value={temp}
              onChange={(e) => setTemp(e.target.value)}
            />
          </label>
        </div>
      ) : (
        <div className="form-row">
          <label className="form-field">
            <span>换水量 %（必填）</span>
            <input
              inputMode="decimal"
              placeholder="如 30"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </label>
          <label className="form-field form-field-wide">
            <span>备注（选填）</span>
            <input
              placeholder="如 周末例行换水"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="primary-action" onClick={handleSubmit}>
          保存记录
        </button>
        <span className="form-hint">保存后状态与换水天数自动计算，普通监测不会重置换水周期</span>
      </div>
    </div>
  );
}

/* ---------- 新增鱼缸 ---------- */

function AddTankForm({ onAdd }: { onAdd: (name: string, type: TankType) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<TankType>("planted");
  const [error, setError] = useState("");

  const submit = () => {
    if (!name.trim()) {
      setError("请填写鱼缸名称");
      return;
    }
    onAdd(name, type);
    setName("");
    setError("");
  };

  return (
    <div className="add-tank">
      <h2>新增鱼缸</h2>
      <label className="form-field">
        <span>名称</span>
        <input
          placeholder="如 草缸D"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="form-field">
        <span>类型</span>
        <select value={type} onChange={(e) => setType(e.target.value as TankType)}>
          {(Object.keys(TYPE_RULES) as TankType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_RULES[t].label}（周期 {TYPE_RULES[t].cycle} 天）
            </option>
          ))}
        </select>
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="button" onClick={submit}>
        添加鱼缸
      </button>
    </div>
  );
}

/* ---------- 历史记录与撤销 ---------- */

function RecordsPanel({
  tanks,
  records,
  filter,
  onUndo,
}: {
  tanks: Tank[];
  records: AquariumRecord[];
  filter: TankType | "all";
  onUndo: (id: string) => void;
}) {
  const tankMap = new Map(tanks.map((t) => [t.id, t]));
  const visible = records
    .filter((r) => {
      const tank = tankMap.get(r.tankId);
      return tank && (filter === "all" || tank.type === filter);
    })
    .sort((a, b) => b.time - a.time);

  return (
    <section className="records panel">
      <div className="section-heading">
        <div>
          <p>历史记录</p>
          <h2>全部记录（最新在前）</h2>
        </div>
      </div>
      <div className="record-list">
        {visible.map((record) => {
          const tank = tankMap.get(record.tankId);
          if (!tank) return null;
          return (
            <article key={record.id} className="record-card">
              <div className={`record-index ${record.kind === "change" ? "record-index-change" : ""}`}>
                {record.kind === "monitor" ? "测" : "水"}
              </div>
              <div className="record-body">
                <div className="record-title">
                  <h3>{tank.name}</h3>
                  <span className="record-kind">
                    {record.kind === "monitor" ? "水质监测" : "换水记录"}
                  </span>
                  <span className="record-time">{fmtTime(record.time)}</span>
                  {record.kind === "monitor" && (
                    <span className={`badge ${severityClass(monitorSeverity(record, tank.type))}`}>
                      {STATUS_TEXT[monitorSeverity(record, tank.type)]}
                    </span>
                  )}
                </div>
                {record.kind === "monitor" ? (
                  <p>
                    {METRIC_META.map((m) => {
                      const value = record[m.key];
                      const sev = metricSeverity(m.key, value, tank.type);
                      const unit = m.key === "nh3" || m.key === "no3" ? "ppm" : m.key === "temp" ? "℃" : "";
                      return (
                        <span key={m.key} className={`value-chip ${severityClass(sev)}`}>
                          {m.label} {value}
                          {unit ? ` ${unit}` : ""}
                        </span>
                      );
                    })}
                  </p>
                ) : (
                  <p>
                    <span className="value-chip sev-ok">换水 {record.percent}%</span>
                    {record.note && <span className="record-note">{record.note}</span>}
                  </p>
                )}
              </div>
              <button className="undo-btn" onClick={() => onUndo(record.id)}>
                撤销
              </button>
            </article>
          );
        })}
        {visible.length === 0 && <p className="empty-hint">暂无记录，先新增一条水质监测或换水记录吧。</p>}
      </div>
    </section>
  );
}

export default App;
