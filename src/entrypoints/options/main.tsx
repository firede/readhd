import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { ModelsSection } from './models';
import { UsageSection } from './usage';
import { TtsSection } from './tts';
import {
  ABOUT_TEXT,
  HELP_TTS,
  SHORTCUT_UNBOUND,
  helpReader,
  TIP_CHUNK,
  TIP_FADE,
  TIP_GAP,
  TIP_RULER,
  TIP_WORD,
} from '../../ui/copy';
import {
  IconBook,
  IconChart,
  IconHelp,
  IconPlay,
  IconSettings,
} from '../../ui/icons';
import {
  readerShortcut,
  type FormattedShortcut,
} from '../../lib/shortcut';
import './options.css';

type Page = 'welcome' | 'models' | 'usage' | 'tts' | 'help' | 'about';

const NAV: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'models', label: '模型服务', icon: <IconSettings /> },
  { id: 'usage', label: '用量记录', icon: <IconChart /> },
  { id: 'tts', label: '朗读', icon: <IconPlay /> },
  { id: 'help', label: '帮助', icon: <IconHelp /> },
  { id: 'about', label: '关于', icon: <IconBook /> },
];

function currentPage(): Page {
  const h = location.hash.replace('#', '') as Page;
  return NAV.some((n) => n.id === h) || h === 'welcome' ? h : 'models';
}

function Help() {
  const [sc, setSc] = useState<FormattedShortcut | null>(null);
  useEffect(() => {
    void readerShortcut().then(setSc);
  }, []);
  const items: [string, string][] = [
    ['“词”和“意群”有什么区别？', `${TIP_WORD}\n\n${TIP_CHUNK}`],
    ['阅读模式', helpReader(sc?.full ?? null)],
    ['词间空隙', TIP_GAP],
    ['淡化虚词', TIP_FADE],
    ['阅读尺', TIP_RULER],
    ['朗读', HELP_TTS],
  ];
  return (
    <div>
      <h2>帮助</h2>
      {items.map(([t, body], i) => (
        <section key={t} id={i === 0 ? 'help-units' : undefined} className="help-item">
          <h3>{t}</h3>
          {body.split('\n\n').map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      ))}
      <section className="help-item">
        <h3>快捷键</h3>
        <table className="keys">
          <tbody>
            <tr>
              <td>{sc ? sc.full : SHORTCUT_UNBOUND}</td>
              <td>打开 / 退出阅读模式</td>
            </tr>
            <tr>
              <td>
                <kbd>Space</kbd>
              </td>
              <td>阅读模式内：朗读 / 暂停</td>
            </tr>
            <tr>
              <td>
                <kbd>Esc</kbd>
              </td>
              <td>阅读模式内：先关闭设置弹层，再退出阅读模式</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

function About() {
  return (
    <div>
      <h2>关于</h2>
      <p className="rh-muted">ReadHD v{browser.runtime.getManifest().version}</p>
      <p style={{ lineHeight: 1.8 }}>{ABOUT_TEXT}</p>
    </div>
  );
}

function Welcome({ go }: { go: (p: Page) => void }) {
  return (
    <div className="welcome rh-card">
      <h2>欢迎使用 ReadHD</h2>
      <p>三步上手：</p>
      <ol>
        <li>
          <a
            href="#models"
            onClick={(e) => {
              e.preventDefault();
              go('models');
            }}
          >
            选择模型服务
          </a>
          （可跳过）
        </li>
        <li>
          <a
            href="#help"
            onClick={(e) => {
              e.preventDefault();
              go('help');
              requestAnimationFrame(() =>
                document.getElementById('help-units')?.scrollIntoView(),
              );
            }}
          >
            了解“词”和“意群”
          </a>
        </li>
        <li className="rh-muted">打开任意中文网页试试</li>
      </ol>
      <div className="welcome-btns">
        <button className="rh-btn primary" onClick={() => go('models')}>
          设置模型服务
        </button>
        <button className="rh-btn ghost" onClick={() => go('models')}>
          稍后再说
        </button>
      </div>
    </div>
  );
}

function Options() {
  const [page, setPage] = useState<Page>(currentPage);
  useEffect(() => {
    const onHash = () => setPage(currentPage());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (p: Page) => {
    location.hash = p;
    setPage(p);
  };

  return (
    <div className="opt">
      <aside className="side">
        <div className="brand">
          <img src="/icon/32.png" alt="" width={24} height={24} />
          ReadHD
        </div>
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`navbtn ${page === n.id ? 'sel' : ''}`}
            onClick={() => go(n.id)}
          >
            {n.icon}
            {n.label}
          </button>
        ))}
      </aside>
      <main className="main">
        {page === 'welcome' && <Welcome go={go} />}
        {page === 'models' && <ModelsSection />}
        {page === 'usage' && <UsageSection />}
        {page === 'tts' && <TtsSection />}
        {page === 'help' && <Help />}
        {page === 'about' && <About />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Options />);
