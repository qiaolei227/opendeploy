// Onboarding wizard (BossPage removed — community edition has no boss view)

function Wizard({ t, lang, onFinish }) {
  const zh = lang === 'zh';
  const [step, setStep] = useState(0);
  const steps = zh
    ? ['欢迎', 'LLM provider', '完成']
    : ['Welcome', 'LLM provider', 'Done'];

  return (
    <div className="wizard">
      <div className="wiz-card">
        <div className="wiz-logo">
          <svg width="40" height="40" viewBox="0 0 48 48" fill="none">
            <rect x="2" y="2" width="44" height="44" rx="10" fill="#3d7a5a"/>
            <rect x="14" y="11" width="20" height="12" rx="2" fill="#fafaf7"/>
            <path d="M20 27 L24 31 L28 27" stroke="#fafaf7" strokeWidth="2.5" fill="none" strokeLinecap="square" strokeLinejoin="miter"/>
            <line x1="10" y1="37" x2="38" y2="37" stroke="#fafaf7" strokeWidth="2.5" strokeLinecap="square"/>
          </svg>
        </div>
        <h1>
          <span className="wiz-brand-cn ser">开达</span>
          <span className="wiz-brand-en">OpenDeploy</span>
        </h1>
        <div className="wsub">{t('wizWelcomeSub')}</div>

        <div className="wiz-stepper">
          {steps.map((s,i)=>(
            <React.Fragment key={i}>
              <span className={`s ${i<step?'done':i===step?'cur':''}`}>
                <span className="n">{i<step?'✓':i+1}</span>{s}
              </span>
              {i<steps.length-1 && <span className="dash"/>}
            </React.Fragment>
          ))}
        </div>

        <div className="wiz-body">
          {step===0 && <>
            <h3>{zh?'你的工具箱，不是 SaaS':'Your toolbox, not a SaaS'}</h3>
            <div className="hint">{zh
              ? <>开达完全在你本机运行。你带自己的 LLM API Key，客户业务数据永不离开客户 ERP 环境。<strong>没有我们的服务器。</strong></>
              : <>OpenDeploy runs on your laptop. Your LLM key, your client's data — we never see either. <strong>No servers of ours.</strong></>}
            </div>
            <div className="card" style={{margin:0, padding:16}}>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
                {[
                  { icon:Icons.shield, t: zh?'零服务器':'Zero server', d: zh?'一切本地，审计可回溯':'local-only, audit on' },
                  { icon:Icons.brain, t: zh?'自备 LLM':'BYO-LLM', d: zh?'DeepSeek · Qwen · GLM · Kimi · 豆包 · Claude …':'DeepSeek · Qwen · GLM · Kimi · Doubao · Claude …' },
                  { icon:Icons.book, t: zh?'ERP 实施专用':'ERP-native', d: zh?'元数据驱动·从云星空开始':'metadata-driven · Kingdee first' },
                ].map((c,i)=>(
                  <div key={i} style={{display:'flex', flexDirection:'column', gap:6}}>
                    <span style={{color:'var(--accent-deep)'}}>{c.icon}</span>
                    <div style={{fontWeight:600, fontSize:12.5}}>{c.t}</div>
                    <div className="muted small">{c.d}</div>
                  </div>
                ))}
              </div>
            </div>
          </>}
          {step===1 && <>
            <h3>{zh?'选择一个 LLM provider':'Pick an LLM provider'}</h3>
            <div className="hint">{zh?'API Key 加密存储在本地钥匙串。任何时候都可以更换或增加 provider。':'Key stored in OS keychain. Switch or add more anytime.'}</div>
            <div className="prov-grid" style={{gridTemplateColumns:'repeat(2, 1fr)'}}>
              {PROVIDERS.map((p,i)=>(
                <div key={p.id} className={`prov-card ${p.recommended?'on':''}`}>
                  <div className="prov-title">
                    <span className={`prov-dot ${p.dot}`}>{p.letter}</span>{p.label}
                    {p.recommended && <span className="chip accent" style={{marginLeft:'auto'}}>{zh?'推荐 · 国内直连':'recommended'}</span>}
                  </div>
                  <div className="prov-sub">{p.sub}</div>
                </div>
              ))}
            </div>
          </>}
          {step===2 && <>
            <h3>{zh?'一切准备就绪':'All set'}</h3>
            <div className="hint">{zh?<>进入工作台后，在「项目」页点 <span className="mono" style={{color:'var(--ink)'}}>+ 新建客户</span>：选产品（云星空标准版 / 企业版）→ 填数据库连接 → 从账套下拉里选一个。</>:<>After entering, go to Projects and click <span className="mono" style={{color:'var(--ink)'}}>+ New client</span>: pick a product, enter DB credentials, then choose an accounting database from the dropdown.</>}</div>
            <div className="card" style={{margin:0, padding:14}}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:8}}><span className="muted small">LLM</span><span className="mono small">DeepSeek V4 · 国内直连</span></div>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:8}}><span className="muted small">{zh?'技能库':'Skill library'}</span><span className="mono small">@4a7f1b2 · 2026-04-19</span></div>
              <div style={{display:'flex', justifyContent:'space-between'}}><span className="muted small">{zh?'下一步':'Next'}</span><span className="mono small" style={{color:'var(--accent-deep)'}}>{zh?'新建客户项目 →':'Create first client →'}</span></div>
            </div>
          </>}
        </div>

        <div className="wiz-foot">
          <button className="btn" disabled={step===0} onClick={()=>setStep(s=>Math.max(0,s-1))}>{t('back')}</button>
          <span className="wiz-progress">{step+1} / {steps.length}</span>
          {step < steps.length-1
            ? <button className="btn primary lg" onClick={()=>setStep(s=>Math.min(steps.length-1, s+1))}>{t('continue')}</button>
            : <button className="btn accent lg" onClick={onFinish}>{t('finish')} →</button>}
        </div>
      </div>
    </div>
  );
}

window.Wizard = Wizard;
