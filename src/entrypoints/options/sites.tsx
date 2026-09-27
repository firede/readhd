import { useEffect, useRef, useState } from 'react';
import {
  allowRules,
  blockRules,
  siteMode,
} from '../../lib/settings';
import {
  isSiteEnabled,
  matchingRules,
  parseRule,
  type SiteMode,
} from '../../lib/site-rules';
import { IconClose } from '../../ui/icons';
import {
  HELP_SITE_RULES_READER,
  HELP_SITE_RULES_TAIL,
  SITE_RULE_EXAMPLES,
} from '../../ui/copy';

/** Rule-format explanation used on #sites and in the 帮助 page. */
export function SiteRuleHelp() {
  return (
    <>
      <ul className="rulehelp">
        {SITE_RULE_EXAMPLES.map(([rule, desc]) => (
          <li key={rule}>
            <code>{rule}</code> — {desc}
          </li>
        ))}
      </ul>
      <p>{HELP_SITE_RULES_TAIL}</p>
      <p className="rh-muted">{HELP_SITE_RULES_READER}</p>
    </>
  );
}

interface UndoState {
  mode: SiteMode;
  text: string;
  index: number;
}

export function SitesSection() {
  const [mode, setMode] = useState<SiteMode>('allowlist');
  const [allow, setAllow] = useState<string[]>([]);
  const [block, setBlock] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchMsg, setBatchMsg] = useState('');
  const [testUrl, setTestUrl] = useState('');
  const [undo, setUndo] = useState<UndoState | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void siteMode.getValue().then(setMode);
    void allowRules.getValue().then(setAllow);
    void blockRules.getValue().then(setBlock);
    const un1 = allowRules.watch(setAllow);
    const un2 = blockRules.watch(setBlock);
    const un3 = siteMode.watch(setMode);
    return () => {
      un1();
      un2();
      un3();
    };
  }, []);

  const rules = mode === 'allowlist' ? allow : block;
  const item = mode === 'allowlist' ? allowRules : blockRules;
  const setRules = mode === 'allowlist' ? setAllow : setBlock;

  async function saveRules(next: string[]) {
    setRules(next);
    await item.setValue(next);
  }

  const parsed = input.trim() ? parseRule(input) : null;
  const dup = parsed && 'rule' in parsed && rules.includes(parsed.text);

  async function addCurrent() {
    if (!parsed || 'error' in parsed || dup) return;
    setInput('');
    await saveRules([...rules, parsed.text]);
  }

  async function addBatch() {
    const lines = batchText.split('\n');
    const valid: string[] = [];
    const bad: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      const p = parseRule(t);
      if ('error' in p || valid.includes(p.text) || rules.includes(p.text)) {
        if ('error' in p) bad.push(t);
      } else {
        valid.push(p.text);
      }
    }
    if (valid.length) await saveRules([...rules, ...valid]);
    setBatchMsg(
      `已添加 ${valid.length} 条` +
        (bad.length
          ? `，${bad.length} 条无法识别：${bad.slice(0, 3).join('、')}${bad.length > 3 ? '…' : ''}`
          : ''),
    );
    setBatchText('');
  }

  async function removeAt(index: number) {
    const text = rules[index]!;
    const next = rules.filter((_, i) => i !== index);
    await saveRules(next);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ mode, text, index });
    undoTimer.current = setTimeout(() => setUndo(null), 5000);
  }

  async function undoRemove() {
    if (!undo) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const cur = (undo.mode === 'allowlist' ? allow : block).slice();
    if (!cur.includes(undo.text)) cur.splice(undo.index, 0, undo.text);
    const it = undo.mode === 'allowlist' ? allowRules : blockRules;
    const st = undo.mode === 'allowlist' ? setAllow : setBlock;
    st(cur);
    await it.setValue(cur);
    setUndo(null);
  }

  const testNorm = testUrl.trim()
    ? /^https?:\/\//i.test(testUrl.trim())
      ? testUrl.trim()
      : `https://${testUrl.trim()}`
    : '';
  const testMatched = testNorm ? matchingRules(rules, testNorm) : [];
  const testOn = testNorm ? isSiteEnabled(testNorm, mode, rules) : null;

  return (
    <div>
      <h2>网站规则</h2>
      <div className="pgrid">
        <button
          type="button"
          className={`pcard ${mode === 'allowlist' ? 'sel' : ''}`}
          onClick={() => void siteMode.setValue('allowlist')}
        >
          <span className="pname">只在列表里的网站启用（白名单）</span>
          <span className="pnote">推荐：只在你选择的网站上运行</span>
        </button>
        <button
          type="button"
          className={`pcard ${mode === 'blocklist' ? 'sel' : ''}`}
          onClick={() => void siteMode.setValue('blocklist')}
        >
          <span className="pname">在所有网站启用，跳过列表里的网站（黑名单）</span>
          <span className="pnote">默认全开，把不需要的网站加进列表</span>
        </button>
      </div>

      <h3>{mode === 'allowlist' ? '启用的网站' : '跳过的网站'}</h3>

      <div className="ffield">
        <div className="keyrow">
          <input
            id="rule-input"
            placeholder="例如 example.com 或 example.com/news"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addCurrent();
            }}
          />
          <button
            className="rh-btn"
            onClick={() => void addCurrent()}
            disabled={!parsed || 'error' in parsed || !!dup}
          >
            添加
          </button>
        </div>
        {parsed && (
          <div className={`rulehint ${'error' in parsed || dup ? 'err' : ''}`}>
            {'error' in parsed
              ? parsed.error
              : dup
                ? '已经在列表里了'
                : parsed.rule.path
                  ? `将匹配 ${parsed.rule.host} 及其子域名下 ${parsed.rule.path} 开头的页面`
                  : `将匹配 ${parsed.rule.host} 及其子域名，例如 www.${parsed.rule.host}`}
          </div>
        )}
      </div>

      <button
        className="linklike"
        onClick={() => setBatchOpen(!batchOpen)}
        aria-expanded={batchOpen}
      >
        批量添加
      </button>
      {batchOpen && (
        <div className="batchbox">
          <textarea
            placeholder={'每行一条规则\nexample.com\nexample.com/news'}
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
            rows={4}
          />
          <div className="btnrow">
            <button className="rh-btn" onClick={() => void addBatch()}>
              添加
            </button>
          </div>
          {batchMsg && <div className="rh-muted">{batchMsg}</div>}
        </div>
      )}

      {rules.length === 0 ? (
        <p className="rh-muted">
          {mode === 'allowlist'
            ? '还没有添加网站。打开想要辅助阅读的网站，点击 ReadHD 弹窗里的“在此网站启用”即可。'
            : '没有跳过的网站。'}
        </p>
      ) : (
        <ul className="rulelist">
          {rules.map((r, i) => (
            <li key={`${r}-${i}`} className="rrow">
              <span className="grow">{r}</span>
              <button
                type="button"
                className="iconbtn"
                aria-label={`删除 ${r}`}
                onClick={() => void removeAt(i)}
              >
                <IconClose />
              </button>
            </li>
          ))}
        </ul>
      )}

      {undo && (
        <div className="rtoast">
          已删除 ·{' '}
          <button className="linklike" onClick={() => void undoRemove()}>
            撤销
          </button>
        </div>
      )}

      <div className="ffield">
        <label htmlFor="rule-test">测试网址</label>
        <input
          id="rule-test"
          placeholder="粘贴一个网址试试看"
          value={testUrl}
          onChange={(e) => setTestUrl(e.target.value)}
        />
        {testOn !== null && (
          <div className="rulehint">
            {testOn ? '启用' : '不启用'}
            {testMatched.length > 0 && `（匹配：${testMatched.join('、')}）`}
          </div>
        )}
      </div>

      <div className="rh-card helpbox">
        <SiteRuleHelp />
      </div>
    </div>
  );
}
