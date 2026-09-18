import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  LEVEL_LABEL,
  METRICS,
  TANK_TYPE_LABEL,
  computeTankStatus,
  evaluateCheck,
  metricLevel,
  rangeHint,
  type MetricKey,
  type TankStatus,
} from "./aquarium";
import { loadData, makeId, resetData, saveData } from "./storage";
import type {
  AquariumRecord,
  AppData,
  CheckValues,
  Level,
  TankType,
} from "./types";

type EntryMode = "check" | "waterchange";

const LEVEL_CLASS: Record<Level, string> = {
  stable: "badge-stable",
  watch: "badge-watch",
  danger: "badge-danger",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function dayLabel(ms: number, now: number): string {
  const diff = Math.round(
    (new Date(now).setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86400000
  );
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  return `${diff} 天前`;
}

function parseField(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const CHECK_BOUNDS: Record<MetricKey, [number, number]> = {
  ph: [0, 14],
  ammonia: [0, 10],
  nitrate: [0, 500],
  temperature: [0, 40],
};

interface EntryFormProps {
  status: TankStatus;
  now: number;
  onAddCheck: (values: CheckValues) => void;
  onAddWaterChange: (amount: number, intervalDays: number) => void;
}

function EntryForm({ status, onAddCheck, onAddWaterChange }: EntryFormProps) {
  const { tank } = status;
  const [mode, setMode] = useState<EntryMode>("check");
  const [fields, setFields] = useState<Record<MetricKey, string>>({
    ph: "",
    ammonia: "",
    nitrate: "",
    temperature: "",
  });
  const [amount, setAmount] = useState("30");
  const [intervalDays, setIntervalDays] = useState(String(tank.changeIntervalDays));
  const [error, setError] = useState("");

  // 切换缸或录入类型时重置表单，避免把上一个缸的数值误存进来
  useEffect(() => {
    setMode("check");
    setFields({ ph: "", ammonia: "", nitrate: "", temperature: "" });
    setAmount("30");
    setIntervalDays(String(tank.changeIntervalDays));
    setError("");
  }, [tank.id, tank.changeIntervalDays]);

  const parsed = useMemo(
    () => ({
      ph: parseField(fields.ph),
      ammonia: parseField(fields.ammonia),
      nitrate: parseField(fields.nitrate),
      temperature: parseField(fields.temperature),
    }),
    [fields]
  );

  const allFilled = METRICS.every((m) => parsed[m.key] !== null);
  const preview = allFilled
    ? evaluateCheck(tank.type, parsed as CheckValues)
    : null;

  function submitCheck() {
    for (const metric of METRICS) {
      const value = parsed[metric.key];
      if (value === null) {
        setError(`请填写 ${metric.label}，新增监测必须四项一次填齐。`);
        return;
      }
      const [lo, hi] = CHECK_BOUNDS[metric.key];
      if (value < lo || value > hi) {
        setError(`${metric.label} 需在 ${lo}~${hi} 之间。`);
        return;
      }
    }
    onAddCheck(parsed as CheckValues);
    setFields({ ph: "", ammonia: "", nitrate: "", temperature: "" });
    setError("");
  }

  function submitWaterChange() {
    const amountValue = parseField(amount);
    const intervalValue = parseField(intervalDays);
    if (amountValue === null || amountValue < 1 || amountValue > 100) {
      setError("请填写本次换水量（1~100，单位 %）。");
      return;
    }
    if (
      intervalValue === null ||
      !Number.isInteger(intervalValue) ||
      intervalValue < 1 ||
      intervalValue > 365
    ) {
      setError("请填写换水周期（1~365 的整数天）。");
      return;
    }
    onAddWaterChange(amountValue, intervalValue);
    setAmount("30");
    setError("");
  }

  return (
    <section className="panel entry-panel">
      <div className="section-heading">
        <div>
          <p>{TANK_TYPE_LABEL[tank.type]}</p>
          <h2>新增记录</h2>
        </div>
        <div className="mode-switch" role="tablist" aria-label="记录类型">
          <button
            className={mode === "check" ? "active" : ""}
            onClick={() => {
              setMode("check");
              setError("");
            }}
          >
            普通监测
          </button>
          <button
            className={mode === "waterchange" ? "active" : ""}
            onClick={() => {
              setMode("waterchange");
              setError("");
            }}
          >
            换水记录
          </button>
        </div>
      </div>

      {mode === "check" ? (
        <>
          <p className="form-note">
            pH、氨氮、硝酸盐、温度四项必须一次填写完整；状态按{TANK_TYPE_LABEL[tank.type]}
            阈值自动判定，无需也不能手动选择。
          </p>
          <div className="field-grid">
            {METRICS.map((metric) => {
              const value = parsed[metric.key];
              const level =
                value !== null ? metricLevel(tank.type, metric.key, value) : null;
              return (
                <label key={metric.key} className="check-field">
                  <span>
                    {metric.label}
                    {metric.unit ? `（${metric.unit}）` : ""} <i>*</i>
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step={metric.step}
                    placeholder={rangeHint(tank.type, metric.key)}
                    value={fields[metric.key]}
                    onChange={(e) =>
                      setFields((prev) => ({ ...prev, [metric.key]: e.target.value }))
                    }
                  />
                  {level && <em className={`mini-badge ${LEVEL_CLASS[level]}`}>{LEVEL_LABEL[level]}</em>}
                </label>
              );
            })}
          </div>
          <div className="form-footer">
            {preview ? (
              <span className="preview-line">
                判定预览
                <em className={`mini-badge ${LEVEL_CLASS[preview.overall]}`}>
                  {LEVEL_LABEL[preview.overall]}
                </em>
              </span>
            ) : (
              <span className="form-hint">四项填写完整后自动判定</span>
            )}
            <button className="primary-action" onClick={submitCheck}>
              保存监测
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="form-note">
            换水记录会以换水时间为起点、按换水周期重新计算“距下次换水天数”；普通监测不会重置该天数。
          </p>
          <div className="field-grid">
            <label className="check-field">
              <span>
                本次换水量（%） <i>*</i>
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                max={100}
                step={1}
                placeholder="例如 30"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="check-field">
              <span>
                换水周期（天） <i>*</i>
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                step={1}
                placeholder={`默认 ${tank.changeIntervalDays} 天`}
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
              />
            </label>
          </div>
          <div className="form-footer">
            <span className="form-hint">保存后下次换水倒计时立即重算</span>
            <button className="primary-action" onClick={submitWaterChange}>
              保存换水
            </button>
          </div>
        </>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}

function App() {
  const [data, setData] = useState<AppData>(() => loadData());
  const [selectedTankId, setSelectedTankId] = useState<string>(
    () => data.tanks[0]?.id ?? ""
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    saveData(data);
  }, [data]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const statuses = useMemo(
    () => data.tanks.map((tank) => computeTankStatus(tank, data.records, now)),
    [data, now]
  );

  const selected = statuses.find((s) => s.tank.id === selectedTankId) ?? statuses[0];

  const history = useMemo(() => {
    if (!selected) return [];
    return data.records
      .filter((r) => r.tankId === selected.tank.id)
      .sort((a, b) => b.time - a.time);
  }, [data.records, selected]);

  if (!selected) {
    return (
      <main className="app-shell">
        <section className="panel">暂无鱼缸数据，请点击“恢复示例数据”。</section>
      </main>
    );
  }

  function addCheck(values: CheckValues) {
    setData((prev) => ({
      ...prev,
      records: [
        ...prev.records,
        { id: makeId(), tankId: selected!.tank.id, kind: "check", time: Date.now(), ...values },
      ],
    }));
  }

  function addWaterChange(amountValue: number, interval: number) {
    setData((prev) => ({
      ...prev,
      records: [
        ...prev.records,
        {
          id: makeId(),
          tankId: selected!.tank.id,
          kind: "waterchange",
          time: Date.now(),
          amount: amountValue,
          intervalDays: interval,
        },
      ],
    }));
  }

  function undoRecord(record: AquariumRecord) {
    const label = record.kind === "check" ? "这条监测记录" : `这次换水（${record.amount}%）`;
    if (!window.confirm(`确定撤销${label}？撤销后状态、提醒和换水天数将按剩余历史立即回算。`)) {
      return;
    }
    setData((prev) => ({
      ...prev,
      records: prev.records.filter((r) => r.id !== record.id),
    }));
  }

  function handleReset() {
    if (!window.confirm("确定清空当前数据并恢复到自带的草缸A / 海缸B / 繁殖缸C示例？")) return;
    const seed = resetData();
    setData(seed);
    setSelectedTankId(seed.tanks[0].id);
  }

  const totalChecks = data.records.filter((r) => r.kind === "check").length;
  const dangerTanks = statuses.filter((s) => s.dangerAlert).length;
  const dueTanks = statuses.filter(
    (s) => s.daysUntilChange !== null && s.daysUntilChange <= 0
  ).length;

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-05 · port 5105</p>
          <h1>水族箱水质记录器</h1>
          <p className="subtitle">
            多鱼缸连续监测记录：四项指标一次录入，状态按缸型阈值自动判定；连续异常自动提醒停喂换水，
            换水记录独立管理换水周期，撤销后全部结论立即回算，刷新不丢失。
          </p>
        </div>
        <div className="stack-card">
          <span>数据保存</span>
          <strong>本地浏览器（localStorage）</strong>
          <button className="reset-button" onClick={handleReset}>
            恢复示例数据
          </button>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="metric-card">
          <span>在册鱼缸</span>
          <strong>{statuses.length}</strong>
          <i className="status-ok" />
        </article>
        <article className="metric-card">
          <span>监测记录总数</span>
          <strong>{totalChecks}</strong>
          <i className="status-ok" />
        </article>
        <article className="metric-card">
          <span>连续异常待处理</span>
          <strong className={dangerTanks > 0 ? "text-danger" : ""}>{dangerTanks}</strong>
          <i className={dangerTanks > 0 ? "status-danger" : "status-ok"} />
        </article>
        <article className="metric-card">
          <span>今日到期 / 已逾期换水</span>
          <strong className={dueTanks > 0 ? "text-warn" : ""}>{dueTanks}</strong>
          <i className={dueTanks > 0 ? "status-watch" : "status-ok"} />
        </article>
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>我的鱼缸</h2>
          <div className="tank-list">
            {statuses.map((s) => {
              const active = s.tank.id === selected.tank.id;
              return (
                <button
                  key={s.tank.id}
                  className={`tank-item ${active ? "active" : ""}`}
                  onClick={() => setSelectedTankId(s.tank.id)}
                >
                  <span className="tank-item-name">
                    {s.tank.name}
                    <em>{TANK_TYPE_LABEL[s.tank.type]}</em>
                  </span>
                  {s.latest ? (
                    <span className={`mini-badge ${LEVEL_CLASS[s.latest.level]}`}>
                      {LEVEL_LABEL[s.latest.level]}
                    </span>
                  ) : (
                    <span className="mini-badge badge-empty">无记录</span>
                  )}
                  <span
                    className={`tank-item-due ${
                      s.overdue ? "text-danger" : s.dueToday ? "text-warn" : ""
                    }`}
                  >
                    {s.daysUntilChange === null
                      ? "未登记换水"
                      : s.daysUntilChange > 0
                        ? `${s.daysUntilChange} 天后换水`
                        : s.daysUntilChange === 0
                          ? "今日换水"
                          : `逾期 ${Math.abs(s.daysUntilChange)} 天`}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="detail">
          <section className="panel tank-header-panel">
            <div className="tank-header">
              <div>
                <p className="eyebrow">
                  {TANK_TYPE_LABEL[selected.tank.type as TankType]} · 默认换水周期{" "}
                  {selected.tank.changeIntervalDays} 天
                </p>
                <h2>{selected.tank.name}</h2>
              </div>
              <div className="tank-header-status">
                {selected.latest ? (
                  <>
                    <span>最近监测状态</span>
                    <em className={`big-badge ${LEVEL_CLASS[selected.latest.level]}`}>
                      {LEVEL_LABEL[selected.latest.level]}
                    </em>
                    <small>{dayLabel(selected.latest.time, now)} · {formatTime(selected.latest.time)}</small>
                  </>
                ) : (
                  <span className="form-hint">还没有监测记录</span>
                )}
              </div>
            </div>

            {selected.dangerAlert && (
              <div className="alert-banner" role="alert">
                <strong>⚠ 连续 {selected.consecutiveDanger} 次监测异常</strong>
                <span>请先停止投喂，并尽快换水；换水后复测，连续异常消除时本提醒自动消失。</span>
              </div>
            )}

            <div className="water-strip">
              <div>
                <span>距下次换水</span>
                {selected.daysUntilChange === null ? (
                  <strong>尚无换水记录</strong>
                ) : selected.daysUntilChange > 0 ? (
                  <strong>{selected.daysUntilChange} 天</strong>
                ) : selected.daysUntilChange === 0 ? (
                  <strong className="text-warn">今天该换水</strong>
                ) : (
                  <strong className="text-danger">
                    已逾期 {Math.abs(selected.daysUntilChange)} 天
                  </strong>
                )}
              </div>
              <div>
                <span>上次换水</span>
                {selected.lastWaterChange ? (
                  <strong>
                    {dayLabel(selected.lastWaterChange.time, now)} · 换水{" "}
                    {selected.lastWaterChange.amount}% · 周期{" "}
                    {selected.lastWaterChange.intervalDays} 天
                  </strong>
                ) : (
                  <strong>—</strong>
                )}
              </div>
            </div>

            {selected.latest && (
              <div className="latest-metrics">
                {METRICS.map((metric) => {
                  const level = evaluateCheck(
                    selected.tank.type,
                    selected.latest as CheckValues
                  ).levels[metric.key];
                  return (
                    <div key={metric.key} className={`latest-metric ${LEVEL_CLASS[level]}`}>
                      <span>{metric.label}</span>
                      <strong>
                        {selected.latest![metric.key]}
                        {metric.unit}
                      </strong>
                      <em>{LEVEL_LABEL[level]}</em>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <EntryForm
            status={selected}
            now={now}
            onAddCheck={addCheck}
            onAddWaterChange={addWaterChange}
          />

          <section className="records panel">
            <div className="section-heading">
              <div>
                <p>本缸历史</p>
                <h2>记录时间线（最新在前）</h2>
              </div>
            </div>
            {history.length === 0 ? (
              <p className="form-hint">暂无记录，从上方新增第一条吧。</p>
            ) : (
              <div className="record-list">
                {history.map((record) => {
                  const isCheck = record.kind === "check";
                  const evaluation = isCheck
                    ? evaluateCheck(selected.tank.type, record)
                    : null;
                  return (
                    <article key={record.id} className="record-card">
                      <div
                        className={`record-index ${
                          isCheck ? LEVEL_CLASS[evaluation!.overall] : "index-water"
                        }`}
                      >
                        {isCheck ? "测" : "换"}
                      </div>
                      <div className="record-body">
                        <div className="record-title">
                          <h3>{isCheck ? "普通监测" : "换水记录"}</h3>
                          {isCheck ? (
                            <em className={`mini-badge ${LEVEL_CLASS[evaluation!.overall]}`}>
                              {LEVEL_LABEL[evaluation!.overall]}
                            </em>
                          ) : (
                            <em className="mini-badge badge-water">换水</em>
                          )}
                          <span className="record-time">
                            {dayLabel(record.time, now)} · {formatTime(record.time)}
                          </span>
                        </div>
                        {isCheck ? (
                          <div className="metric-chips">
                            {METRICS.map((metric) => (
                              <span
                                key={metric.key}
                                className={`metric-chip ${LEVEL_CLASS[evaluation!.levels[metric.key]]}`}
                              >
                                {metric.label} {record[metric.key]}
                                {metric.unit}
                                <i>{LEVEL_LABEL[evaluation!.levels[metric.key]]}</i>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="record-note">
                            本次换水 {record.amount}%，设定下次换水周期 {record.intervalDays} 天
                            （普通监测不会重置该倒计时）
                          </p>
                        )}
                      </div>
                      <button
                        className="undo-button"
                        onClick={() => undoRecord(record)}
                        aria-label="撤销该记录"
                      >
                        撤销
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </section>
      </section>

      <footer className="page-footer">
        数据仅保存在当前浏览器；撤销任意记录后，状态、连续异常提醒与换水天数均按剩余历史立即回算。
      </footer>
    </main>
  );
}

export default App;
