import { useEffect, useState } from 'react';
import { lastError, usageDaily, usageLog } from '../../lib/settings';
import { providerById } from '../../lib/providers';
import {
  summarize,
  type UsageDaily,
  type UsageEntry,
  type UsageRange,
} from '../../lib/usage';
import { Segmented } from '../../ui/components';
import { NOTE_USAGE } from '../../ui/copy';

const RANGES: { value: UsageRange; label: string }[] = [
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
];

function fmtTs(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

export function UsageSection() {
  const [range, setRange] = useState<UsageRange>('today');
  const [daily, setDaily] = useState<UsageDaily>({});
  const [log, setLog] = useState<UsageEntry[]>([]);
  const [err, setErr] = useState<{
    ts: number;
    providerId: string;
    message: string;
  } | null>(null);

  const reload = async () => {
    const [d, l, le] = await Promise.all([
      usageDaily.getValue(),
      usageLog.getValue(),
      lastError.getValue(),
    ]);
    setDaily(d);
    setLog(l.slice(-50).reverse());
    setErr(le);
  };
  useEffect(() => {
    void reload();
  }, []);

  const s = summarize(daily, range, Date.now());
  return (
    <div>
      <h2>用量记录</h2>
      <Segmented<UsageRange>
        ariaLabel="统计范围"
        options={RANGES}
        value={range}
        onChange={setRange}
      />
      <div className="statgrid">
        <div className="stat">
          <div className="n">{s.requests}</div>
          <div className="l">分析次数</div>
        </div>
        <div className="stat">
          <div className="n">{s.inputTokens}</div>
          <div className="l">输入 tokens</div>
        </div>
        <div className="stat">
          <div className="n">{s.outputTokens}</div>
          <div className="l">输出 tokens</div>
        </div>
        <div className="stat">
          <div className="n">{s.failures}</div>
          <div className="l">失败次数</div>
        </div>
      </div>
      {err && (
        <div className="rh-badge danger" style={{ margin: '10px 0' }}>
          上次失败：{err.message}（{fmtTs(err.ts)}）
        </div>
      )}
      {s.models.length > 0 && (
        <table className="utable">
          <thead>
            <tr>
              <th>模型</th>
              <th>次数</th>
              <th>失败</th>
              <th>输入 tokens</th>
              <th>输出 tokens</th>
            </tr>
          </thead>
          <tbody>
            {s.models.map((m) => (
              <tr key={m.model}>
                <td>{m.model}</td>
                <td>{m.requests}</td>
                <td>{m.failures}</td>
                <td>{m.inputTokens}</td>
                <td>{m.outputTokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className="uh3">最近调用</h3>
      {log.length === 0 ? (
        <p className="rh-muted">还没有记录</p>
      ) : (
        <table className="utable">
          <thead>
            <tr>
              <th>时间</th>
              <th>服务商 / 模型</th>
              <th>输入/输出</th>
              <th>耗时</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {log.map((e, i) => (
              <tr key={i}>
                <td>{fmtTs(e.ts)}</td>
                <td>
                  {providerById(e.providerId)?.name ?? e.providerId} · {e.model}
                </td>
                <td>
                  {e.inputTokens}/{e.outputTokens}
                </td>
                <td>{e.ms}ms</td>
                <td className={e.ok ? 'okc' : 'badc'}>
                  {e.ok ? '成功' : e.error ?? `失败 ${e.status ?? ''}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="rh-muted">{NOTE_USAGE}</p>
      <button
        className="rh-btn danger"
        onClick={() => {
          if (!confirm('确定清除所有用量记录？')) return;
          void Promise.all([
            usageLog.setValue([]),
            usageDaily.setValue({}),
            lastError.setValue(null),
          ]).then(reload);
        }}
      >
        清除记录
      </button>
    </div>
  );
}
