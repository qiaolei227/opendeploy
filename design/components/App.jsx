const { useState, useEffect, useRef } = React;

const I18N = {
  zh: {
    workspace: '工作台', projects: '项目', skills: '技能', settings: '设置',
    search: '全局搜索', customers: '项目', conversations: '本项目对话',
    metadata: '元数据', security: '白名单', artifacts: '生成物',
    connection: '连接', businessObjects: '业务对象',
    whitelistHelp: '产品从不访问客户业务数据。所有 SQL 发送前经语句审查器校验；T_META_* 允许，T_SAL_* / T_BD_* / T_AR_* 等业务表硬拦截。',
    recentAccess: '本次会话访问', generatedFiles: '已生成文件',
    projectsTitle: '项目', projectsSub: '每个客户一个工作空间，本地目录、独立元数据缓存、独立对话历史。',
    skillsTitle: 'Skills 能力包', skillsSub: '顾问的业务域技能包——封装业务知识、常用 prompt、代码经验。可启用到当前客户项目。',
    settingsTitle: '设置', settingsSub: 'LLM provider、API Key、Skills 源、语言与审计日志。',
    wizWelcome: '欢迎使用', wizWelcomeSub: '开达是本地运行的 ERP 实施交付智能体，首批支持金蝶云星空。安装完成 — 下面几步让它跑起来。',
    continue: '继续', back: '返回', finish: '开始工作',
  },
  en: {
    workspace: 'Workspace', projects: 'Projects', skills: 'Skills', settings: 'Settings',
    search: 'Search everything', customers: 'Projects', conversations: 'Project conversations',
    metadata: 'Metadata', security: 'Whitelist', artifacts: 'Artifacts',
    connection: 'Connection', businessObjects: 'Business Objects',
    whitelistHelp: 'OpenDeploy never touches business data. Every SQL passes an inspector before being sent; T_META_* allowed, T_SAL_*/T_BD_*/T_AR_* hard-blocked.',
    recentAccess: 'Session access', generatedFiles: 'Generated files',
    projectsTitle: 'Projects', projectsSub: 'One workspace per client: local directory, metadata cache, conversation history.',
    skillsTitle: 'Skill packs', skillsSub: 'Business-domain capability packs — bundled knowledge, prompts, code snippets, and notes. Enable per client.',
    settingsTitle: 'Settings', settingsSub: 'LLM provider, API key, skill sources, language, audit log.',
    wizWelcome: 'Welcome', wizWelcomeSub: 'OpenDeploy is a local-first ERP implementation agent, starting with Kingdee K/3 Cloud. Installed — a few steps and you\'re ready.',
    continue: 'Continue', back: 'Back', finish: 'Start',
  },
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "language": "zh",
  "stage": 2,
  "page": "workspace",
  "llm": "deepseek"
}/*EDITMODE-END*/;

function App() {
  const [theme, setTheme] = useState(TWEAK_DEFAULTS.theme);
  const [lang, setLang] = useState(TWEAK_DEFAULTS.language);
  const [stage, setStage] = useState(TWEAK_DEFAULTS.stage); // 0 empty, 1 clarify, 2 tools, 3 code
  const [page, setPage] = useState(TWEAK_DEFAULTS.page);
  const [llm, setLlm] = useState(TWEAK_DEFAULTS.llm);
  const [tweaksOn, setTweaksOn] = useState(false);
  const [insp, setInsp] = useState('metadata');
  const [activeProject, setActiveProject] = useState('p1');
  const [activeConv, setActiveConv] = useState('c1');

  const t = (k) => {
    const parts = k.split('.');
    let v = I18N[lang];
    for (const p of parts) v = v?.[p];
    return v || k;
  };

  useEffect(() => { document.body.className = theme === 'dark' ? 'theme-dark' : ''; }, [theme]);

  useEffect(() => {
    const handler = (e) => {
      if (!e.data) return;
      if (e.data.type === '__activate_edit_mode') setTweaksOn(true);
      if (e.data.type === '__deactivate_edit_mode') setTweaksOn(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const persist = (edits) => window.parent.postMessage({ type: '__edit_mode_set_keys', edits }, '*');

  const isWizard = page === 'wizard';
  const isBare = page === 'skills' || page === 'settings';
  const appClass = `app ${isWizard ? 'mode-wizard' : ''} ${isBare ? 'mode-skills' : ''}`;

  return (
    <div className={appClass} data-screen-label={`OpenDeploy · ${page}`}>
      {!isWizard && <TitleBar t={t} lang={lang} />}
      {!isWizard && <NavRail t={t} page={page} setPage={(v) => { setPage(v); persist({ page: v }); }} />}
      {!isWizard && <SecondarySide t={t} page={page} activeProject={activeProject} setActiveProject={setActiveProject} activeConv={activeConv} setActiveConv={setActiveConv} />}

      <main className="main">
        {page === 'workspace' && <Workspace t={t} lang={lang} stage={stage} setStage={setStage} insp={insp} setInsp={setInsp} llm={llm} />}
        {page === 'projects' && <ProjectsPage t={t} lang={lang} />}
        {page === 'skills' && <SkillsPage t={t} lang={lang} />}
        {page === 'settings' && <SettingsPage t={t} lang={lang} llm={llm} setLlm={setLlm} />}
        {page === 'wizard' && <Wizard t={t} lang={lang} onFinish={() => { setPage('workspace'); persist({ page: 'workspace' }); }} />}
      </main>

      {!isWizard && <StatusBar lang={lang} llm={llm} />}

      {tweaksOn && (
        <TweaksPanel
          theme={theme} setTheme={(v) => { setTheme(v); persist({ theme: v }); }}
          lang={lang} setLang={(v) => { setLang(v); persist({ language: v }); }}
          stage={stage} setStage={(v) => { setStage(v); persist({ stage: v }); }}
          page={page} setPage={(v) => { setPage(v); persist({ page: v }); }}
          llm={llm} setLlm={(v) => { setLlm(v); persist({ llm: v }); }}
        />
      )}
    </div>
  );
}

function TitleBar({ t, lang }) {
  return (
    <header className="titlebar win">
      <div className="brand">
        <div className="brand-mark" aria-label="开达 OpenDeploy">
          <svg width="22" height="22" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="10" fill="#3d7a5a"/>
            <rect x="14" y="11" width="20" height="12" rx="2" fill="#fafaf7"/>
            <path d="M20 27 L24 31 L28 27" stroke="#fafaf7" strokeWidth="2.5" fill="none" strokeLinecap="square" strokeLinejoin="miter"/>
            <line x1="10" y1="37" x2="38" y2="37" stroke="#fafaf7" strokeWidth="2.5" strokeLinecap="square"/>
          </svg>
        </div>
        <span className="brand-cn">开达</span>
        <span className="brand-en">OpenDeploy</span>
        <span className="brand-slash">—</span>
        <span className="brand-project">川沙诚信商贸 · V9.1</span>
        <span className="brand-edition">community</span>
      </div>
      <div className="tb-spacer" />
      <div className="tb-search">
        {Icons.search}<span>{t('search')}</span>
        <span className="kbd">Ctrl K</span>
      </div>
      <div className="tb-actions">
        <button className="tb-btn">{Icons.gear}</button>
        <div className="tb-user" title="乔磊">
          <div className="tb-avatar">乔</div>
          <div className="tb-uname">乔磊</div>
        </div>
      </div>
      <div className="wincaps">
        <button className="wincap" title="Minimize"><svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1"/></svg></button>
        <button className="wincap" title="Maximize"><svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1"/></svg></button>
        <button className="wincap close" title="Close"><svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1"/></svg></button>
      </div>
    </header>
  );
}

function NavRail({ t, page, setPage }) {
  const items = [
    { id: 'workspace', icon: Icons.chat, label: t('workspace') },
    { id: 'projects', icon: Icons.folder, label: t('projects') },
    { id: 'skills', icon: Icons.sparkles, label: t('skills') },
  ];
  return (
    <nav className="nav">
      {items.map(it => (
        <button key={it.id} className={`nav-item ${page === it.id ? 'active' : ''}`} onClick={() => setPage(it.id)}>
          {it.icon}
          <span className="lbl">{it.label}</span>
        </button>
      ))}
      <div className="nav-rule" />
      <div className="spacer" />
      <button className="nav-item" onClick={() => setPage('settings')}>
        {Icons.gear}
        <span className="lbl">{t('settings')}</span>
      </button>
    </nav>
  );
}

function StatusBar({ lang, llm }) {
  const zh = lang === 'zh';
  const provLabel = {
    deepseek: 'DeepSeek V4',
    qwen: 'Qwen3-Max',
    glm: 'GLM-4.6',
    kimi: 'Kimi K2',
    doubao: 'Doubao 1.5 Pro',
    minimax: 'MiniMax abab7',
    baichuan: 'Baichuan 4-Turbo',
    hunyuan: 'Hunyuan Turbo',
    claude: 'Claude Sonnet 4.7',
    gpt: 'GPT-5',
    ollama: 'Ollama · qwen2.5-coder',
  }[llm] || llm;
  return (
    <footer className="statusbar">
      <span className="sbseg good"><span className="sbdot" />BOS connected · V9.1.0.2</span>
      <span className="sbseg">{Icons.shield}<span>metadata-readonly</span></span>
      <span className="sbseg">{Icons.sparkles}<span>skills · 12 packs · @4a7f1b2</span></span>
      <span className="sbseg">{Icons.git}<span>v0.1.3 · {zh ? '有新版' : 'update available'}</span></span>
      <span className="spacer" />
      <span className="sbseg">{Icons.brain}<span>{provLabel} · user key</span></span>
      <span className="sbseg">{zh ? 'tokens' : 'tokens'} 18,342</span>
      <span className="sbseg">zh-CN · en-US</span>
    </footer>
  );
}

function TweaksPanel({ theme, setTheme, lang, setLang, stage, setStage, page, setPage, llm, setLlm }) {
  return (
    <div className="tweaks">
      <h3>Tweaks</h3>
      <div className="tweak-row">
        <div className="label">Theme</div>
        <div className="seg">
          <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>Light</button>
          <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </div>
      <div className="tweak-row">
        <div className="label">Language</div>
        <div className="seg">
          <button className={lang === 'zh' ? 'on' : ''} onClick={() => setLang('zh')}>中文</button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
        </div>
      </div>
      <div className="tweak-row">
        <div className="label">Page</div>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          <button className={page === 'wizard' ? 'on' : ''} onClick={() => setPage('wizard')}>Wizard</button>
          <button className={page === 'workspace' ? 'on' : ''} onClick={() => setPage('workspace')}>Chat</button>
          <button className={page === 'projects' ? 'on' : ''} onClick={() => setPage('projects')}>Projects</button>
          <button className={page === 'skills' ? 'on' : ''} onClick={() => setPage('skills')}>Skills</button>
          <button className={page === 'settings' ? 'on' : ''} onClick={() => setPage('settings')}>Settings</button>
        </div>
      </div>
      <div className="tweak-row">
        <div className="label">Chat stage</div>
        <div className="seg">
          <button className={stage === 0 ? 'on' : ''} onClick={() => setStage(0)}>Empty</button>
          <button className={stage === 1 ? 'on' : ''} onClick={() => setStage(1)}>Clarify</button>
          <button className={stage === 2 ? 'on' : ''} onClick={() => setStage(2)}>Tools</button>
          <button className={stage === 3 ? 'on' : ''} onClick={() => setStage(3)}>Code</button>
        </div>
      </div>
      <div className="tweak-row">
        <div className="label">LLM</div>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          <button className={llm === 'deepseek' ? 'on' : ''} onClick={() => setLlm('deepseek')}>DeepSeek</button>
          <button className={llm === 'qwen' ? 'on' : ''} onClick={() => setLlm('qwen')}>Qwen</button>
          <button className={llm === 'glm' ? 'on' : ''} onClick={() => setLlm('glm')}>GLM</button>
          <button className={llm === 'kimi' ? 'on' : ''} onClick={() => setLlm('kimi')}>Kimi</button>
          <button className={llm === 'doubao' ? 'on' : ''} onClick={() => setLlm('doubao')}>豆包</button>
          <button className={llm === 'claude' ? 'on' : ''} onClick={() => setLlm('claude')}>Claude</button>
          <button className={llm === 'gpt' ? 'on' : ''} onClick={() => setLlm('gpt')}>GPT</button>
          <button className={llm === 'ollama' ? 'on' : ''} onClick={() => setLlm('ollama')}>Ollama</button>
        </div>
      </div>
    </div>
  );
}

window.App = App;
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
