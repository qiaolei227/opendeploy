function Workspace({ t, lang, stage, setStage, insp, setInsp, llm }) {
  return <WorkspaceEditorial t={t} lang={lang} stage={stage} setStage={setStage} insp={insp} setInsp={setInsp} llm={llm} />;
}

function VariantSwitch() { return null; }

function WorkspaceEditorial({ t, lang, stage, setStage, insp, setInsp, llm }) {
  const zh = lang === 'zh';
  const scrollRef = useRef(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [stage]);

  return (
    <>
      <div className="main-head">
        <div className="mh-title">
          <span className={`ser`}>{zh ? '销售订单信用额度预警' : 'Sales Order Credit Limit Warning'}</span>
          <span className="mh-crumb mono">· SAL_SaleOrder</span>
        </div>
        <div className="mh-spacer" />
        <span className="pill good">BOS · live</span>
        <span className="pill mono">python · operation</span>
        <button className="icon-btn">{Icons.link}</button>
        <button className="icon-btn">{Icons.refresh}</button>
      </div>
      <div className="ws">
        <div className="chat-col">
          <div className="chat-scroll" ref={scrollRef}>
            <div className="chat-inner">
              {stage === 0 ? <EmptyState t={t} lang={lang} onPick={() => setStage(1)} /> : <Convo stage={stage} zh={zh} />}
            </div>
          </div>
          <Composer zh={zh} stage={stage} onAdvance={() => setStage(s => Math.min(3, s+1))} llm={llm} />
        </div>

      </div>
    </>
  );
}

function EmptyState({ t, lang, onPick }) {
  const zh = lang === 'zh';
  const prompts = zh ? [
    { tag:'SAL', title:'信用额度预警', desc:'客户应收超限时阻止审核' },
    { tag:'BD',  title:'物料编码规则', desc:'按分类自动生成物料编号' },
    { tag:'STK', title:'入库自动应付', desc:'采购入库同步生成应付单' },
    { tag:'AP',  title:'欠票检查',    desc:'结账前扫描未到票应付' },
  ] : [
    { tag:'SAL', title:'Credit limit guard', desc:'Block approval when A/R exceeds limit' },
    { tag:'BD',  title:'Material code rule', desc:'Auto-generate codes by category' },
    { tag:'STK', title:'Auto A/P on inbound', desc:'Create A/P from PO receipts' },
    { tag:'AP',  title:'Missing invoice check', desc:'Scan unmatched A/P at period-end' },
  ];
  return (
    <div style={{padding:'40px 0'}}>
      <h1 style={{fontSize:28, letterSpacing:'-0.02em', margin:'0 0 6px'}}>
        <span style={{fontFamily:'var(--font-serif)', fontWeight:500}}>{zh?'描述一个需求':'Describe a requirement'}</span>
      </h1>
      <p className="muted" style={{margin:'0 0 24px'}}>
        {zh
          ? <>用日常语言说清楚客户想要什么。OpenDeploy 会先问澄清问题，再读取 BOS 元数据，最后给你可直接粘贴到客户环境的 Python 插件。</>
          : <>Describe what the client wants. OpenDeploy clarifies, reads BOS metadata, and hands you a paste-ready Python plugin.</>}
      </p>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:24}}>
        {prompts.map((p,i)=>(
          <button key={i} className="card" style={{textAlign:'left', padding:'14px 16px', margin:0, cursor:'pointer'}} onClick={onPick}>
            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
              <span className="chip accent">{p.tag}</span>
              <span style={{fontWeight:600, fontSize:13}}>{p.title}</span>
            </div>
            <div className="muted" style={{fontSize:12}}>{p.desc}</div>
          </button>
        ))}
      </div>
      <div className="card" style={{display:'flex', gap:10, alignItems:'flex-start', margin:0, padding:12}}>
        <span style={{color:'var(--accent-deep)', marginTop:2}}>{Icons.shield}</span>
        <div style={{fontSize:12, color:'var(--muted)', lineHeight:1.5}}>
          {zh
            ? <>本次会话不会访问你客户的业务数据。SQL 白名单硬拦截 <code>T_SAL_*</code> / <code>T_AR_*</code> 等业务表，仅允许 <code>T_META_*</code> 结构信息。</>
            : <>This session does not read business data. SQL whitelist hard-blocks <code>T_SAL_*</code>/<code>T_AR_*</code>; only <code>T_META_*</code> structure is allowed.</>}
        </div>
      </div>
    </div>
  );
}

function Turn({ who, time, children }) {
  return (
    <div className="turn">
      <div className="turn-head">
        <div className={`turn-av ${who}`}>{who==='user'?'乔':'AI'}</div>
        <span className="turn-name">{who==='user'?'乔磊':'OpenDeploy'}</span>
        <span className="turn-time">{time}</span>
      </div>
      <div className="turn-body">{children}</div>
    </div>
  );
}

function Tool({ name, args, status, icon, children }) {
  return (
    <div className="tool">
      <div className="tool-head">
        <span className="tool-ic">{icon || Icons.zap}</span>
        <span className="tool-name">{name}</span>
        <span className="tool-args">{args}</span>
        <span className={`tool-status ${status}`}>{status==='running'?'running':status==='ok'?'ok ✓':'idle'}</span>
      </div>
      {children && <div className="tool-body">{children}</div>}
    </div>
  );
}

function Convo({ stage, zh }) {
  return (
    <>
      <Turn who="user" time="14:32:08">
        <p>{zh
          ? <>客户"川沙诚信商贸"要求：<strong>销售订单审核时，如果客户应收账款超 50 万，红色警告并阻止审核</strong>。超限时需要财务经理在后台放行。</>
          : <>Chuansha Chengxin wants: <strong>on sales order approval, if customer A/R &gt; ¥500k, show a red warning and block approval</strong>. Override needs the finance manager.</>}</p>
      </Turn>

      <Turn who="ai" time="14:32:11">
        <p>{zh ? <>需求明确。在生成代码前有 <strong>3 处关键细节</strong> 需要你先确认 — 默认选项已标注"推荐"，直接回车即可继续：</>
               : <>Understood. <strong>3 details</strong> to confirm before I write code — recommended defaults are pre-selected:</>}</p>

        <Clarify n={1} total={3} tag="A/R" q={zh?'应收账款的口径：':'A/R calculation:'}
          opts={[
            { k:'A', sel:true, title: zh?'当前期末余额（推荐）':'Current period-end balance (recommended)', desc: zh?'从 T_AR_Receivable.FAmount 聚合未核销金额':'Aggregate unsettled T_AR_Receivable.FAmount' },
            { k:'B', title: zh?'近 3 个月滚动余额':'Rolling 3-month balance' },
            { k:'C', title: zh?'含在途订单（未发货未收款）':'Include in-transit orders' },
          ]} />

        <Clarify n={2} total={3} tag="Threshold" q={zh?'50 万是所有客户统一，还是按客户分级？':'Flat ¥500k, or tiered per customer?'}
          opts={[
            { k:'A', sel:true, title: zh?'按客户档案自定义字段 F_JN_CreditLimit（推荐）':'Use customer field F_JN_CreditLimit (recommended)', desc: zh?'已在你们 BOS 元数据中检测到该字段':'Detected in your BOS metadata' },
            { k:'B', title: zh?'硬编码 500000':'Hardcode 500000' },
          ]} />

        <Clarify n={3} total={3} tag="Override" q={zh?'超限时的放行机制：':'Override flow when exceeded:'}
          opts={[
            { k:'A', title: zh?'硬阻断，线下处理':'Hard block, handle offline' },
            { k:'B', sel:true, title: zh?'升级到财务经理审批（推荐）':'Escalate to finance manager (recommended)', desc: zh?'走 BOS 工作流引擎节点分支':'Uses BOS workflow branch' },
          ]} />
      </Turn>

      {stage >= 2 && (
        <>
          <Turn who="user" time="14:33:02"><p>{zh?'按推荐：A / A / B。':'Recommended: A / A / B.'}</p></Turn>
          <Turn who="ai" time="14:33:04">
            <p>{zh
              ? <>好。先读取客户 BOS 的元数据，确认 <code>SAL_SaleOrder</code>、<code>BD_Customer</code> 当前结构：</>
              : <>Good. Reading BOS metadata for <code>SAL_SaleOrder</code>, <code>BD_Customer</code>:</>}</p>
            <Tool name="read_bos_metadata" args="object=SAL_SaleOrder,BD_Customer" status="ok" icon={Icons.database}>
              <div className="kv"><span className="k">endpoint</span><span className="v">erp.sundry.cn:8081/K3Cloud/metadata</span></div>
              <div className="kv"><span className="k">objects</span><span className="v">2 resolved · 184 fields · 12 events</span></div>
              <div className="kv"><span className="k">custom</span><span className="v good">F_JN_CreditLimit (amount, BD_Customer) ✓</span></div>
              <div className="kv"><span className="k">cache</span><span className="v">projects/川沙诚信商贸/metadata.json</span></div>
            </Tool>
            <Tool name="search_knowledge" args='q="销售订单审核事件 Python 插件"' status="ok" icon={Icons.book}>
              <div className="kv"><span className="k">source</span><span className="v">opendeploy-knowledge @ 4a7f1b2</span></div>
              <div className="kv"><span className="k">hits</span><span className="v">3 structured · 2 RAG</span></div>
              <details>
                <summary>{zh?'引用源 (5)':'Citations (5)'}</summary>
                <div style={{paddingTop:4}}>
                  <div>§ SAL_SaleOrder.事件.OnBeforeExecuteOperationTransaction</div>
                  <div>§ plugin-templates/python/sales-order-validate.py</div>
                  <div>§ api-specs/business-object-operation.json</div>
                  <div>§ skills/sales/信用额度控制.md</div>
                  <div>§ skills/ar/应收余额计算.md</div>
                </div>
              </details>
            </Tool>
            <Tool name="sql_inspector" args="guard=whitelist" status="ok" icon={Icons.shield}>
              <div className="kv"><span className="k">allowed</span><span className="v good">T_META_OBJECTTYPE, T_META_FORM, T_META_FIELD</span></div>
              <div className="kv"><span className="k">blocked</span><span className="v danger">T_AR_Receivable, T_BD_Customer</span></div>
              <div className="kv"><span className="k">note</span><span className="v">{zh?'业务数据只在客户 ERP 内部被插件访问，OpenDeploy 不持有':'Business data only accessed by plugin inside client ERP; OpenDeploy never holds it'}</span></div>
            </Tool>
            <p>{zh
              ? <>元数据到位。方案：<strong>Python 操作插件</strong> 挂到 <code>SAL_SaleOrder.BeforeExecuteOperationTransaction</code>，操作码 <code>Audit</code>。<span className="cite">skills/sales</span></>
              : <>Plan: <strong>Python operation plugin</strong> on <code>SAL_SaleOrder.BeforeExecuteOperationTransaction</code>, op <code>Audit</code>. <span className="cite">skills/sales</span></>}</p>
          </Turn>
        </>
      )}

      {stage >= 3 && (
        <Turn who="ai" time="14:33:21">
          <p>{zh?'代码已生成，可直接贴到 BOS：':'Code generated — paste directly into BOS:'}</p>
          <Code />
          <div style={{display:'flex', gap:6, flexWrap:'wrap', marginTop:12}}>
            <span className="chip good">{Icons.check} {zh?'静态检查通过':'Static checks passed'}</span>
            <span className="chip good">{Icons.shield} {zh?'无业务表硬引用':'No hardcoded business tables'}</span>
            <span className="chip">{zh?'预计部署耗时 ~2 分钟':'Est. deploy ~2 min'}</span>
          </div>
          <p style={{marginTop:14}}>
            {zh?<>下一步：在 BOS 打开 <code>销售订单 → 操作 → 审核</code>，粘贴上面的脚本保存即生效。或者点击 <strong>"部署"</strong>，我帮你走一遍自动化流程（需要 MVP-0.2）。</>
                :<>Next: open BOS → SaleOrder → Operations → Audit, paste, save. Or click <strong>Deploy</strong> for automated flow (MVP-0.2).</>}
          </p>
        </Turn>
      )}
    </>
  );
}

function Clarify({ n, total, tag, q, opts }) {
  return (
    <div className="clarify">
      <h4>
        <span className="qnum">{n}</span>
        <span className="qlabel">{q}</span>
        <span className="qtag">{tag} · {n}/{total}</span>
      </h4>
      <div className="opts">
        {opts.map(o=>(
          <button key={o.k} className={`opt ${o.sel?'selected':''}`}>
            <span className="klabel">{o.k}</span>
            <div>
              <div>{o.title}</div>
              {o.desc && <div className="odesc">{o.desc}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Code() {
  return (
    <div className="code">
      <div className="code-head">
        <span className="code-lang">python</span>
        <span className="code-file">plugins/sale_order_credit_check.py</span>
        <span className="code-spacer" />
        <button className="btn sm">{Icons.copy} 复制</button>
        <button className="btn sm">保存</button>
        <button className="btn sm accent">{Icons.zap} 部署</button>
      </div>
      <div className="code-body"><pre dangerouslySetInnerHTML={{__html:
`<span class="cm"># -*- coding: utf-8 -*-</span>
<span class="cm"># SaleOrder credit-limit guard · 川沙诚信商贸 · V9.1</span>
<span class="cm"># Generated by OpenDeploy · 2026-04-19 14:33</span>

<span class="kw">import</span> <span class="nb">clr</span>
<span class="nb">clr</span>.AddReference(<span class="st">'Kingdee.BOS'</span>)
<span class="nb">clr</span>.AddReference(<span class="st">'Kingdee.BOS.Core'</span>)
<span class="kw">from</span> <span class="nb">Kingdee.BOS.Core.DynamicForm.PlugIn</span> <span class="kw">import</span> AbstractOperationServicePlugIn

FALLBACK = <span class="nm">500000</span>   <span class="cm"># used only when customer has no F_JN_CreditLimit</span>

<span class="kw">class</span> <span class="fn">CreditLimitGuard</span>(AbstractOperationServicePlugIn):
    <span class="kw">def</span> <span class="fn">OnPreparePropertys</span>(<span class="nb">self</span>, e):
        e.FieldKeys.Add(<span class="st">"FCustomerId"</span>)

    <span class="kw">def</span> <span class="fn">BeforeExecuteOperationTransaction</span>(<span class="nb">self</span>, e):
        <span class="kw">for</span> row <span class="kw">in</span> e.SelectedRows:
            cust = row.DataEntity[<span class="st">"CustomerId"</span>]
            <span class="kw">if</span> <span class="nb">not</span> cust: <span class="kw">continue</span>
            limit = cust[<span class="st">"F_JN_CreditLimit"</span>] <span class="kw">or</span> FALLBACK
            ar    = <span class="nb">self</span>._ar(cust[<span class="st">"Id"</span>])
            <span class="kw">if</span> ar &gt; limit:
                e.Cancel = <span class="nb">True</span>
                <span class="nb">self</span>.View.ShowErrMessage(
                    <span class="st">f"客户【{cust['Name']}】应收 {ar:,.2f} 已超信用额度 {limit:,.2f}，请财务放行。"</span>)
                <span class="nb">self</span>._escalate(row.DataEntity, cust, ar, limit)

    <span class="kw">def</span> <span class="fn">_ar</span>(<span class="nb">self</span>, cust_id):
        sql = <span class="st">"SELECT ISNULL(SUM(FAmount),0) FROM T_AR_Receivable "</span> \\
              <span class="st">"WHERE FCustomerId=? AND FIsSettled='0'"</span>
        <span class="kw">return</span> <span class="nb">self</span>.Context.DBService.ExecuteScalar(sql, cust_id) <span class="kw">or</span> <span class="nm">0</span></pre>`}}/></div>
    </div>
  );
}

function Composer({ zh, stage, onAdvance, llm = 'deepseek' }) {
  const [val, setVal] = useState('');
  const submit = () => { onAdvance(); setVal(''); };
  const prov = (window.PROVIDER_BY_ID && window.PROVIDER_BY_ID[llm]) || { dot:'deepseek', letter:'D', short:'DeepSeek V4' };
  const ph = stage === 0 ? (zh?'用日常语言描述一个需求…':'Describe a requirement in plain language…')
          : stage === 1 ? (zh?'回车接受推荐，或继续补充…':'Press Enter to accept, or refine…')
          : (zh?'追问代码、要求修改、或开启新任务…':'Refine the code, request changes…');
  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="cbox">
          <textarea rows={2} value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}}} placeholder={ph}/>
          <div className="ctools">
            <button className="comp-chip on">{Icons.database} SAL_SaleOrder</button>
            <button className="comp-chip on">{Icons.book} {zh?'销售 Skills':'Sales skills'}</button>
            <button className="comp-chip">{Icons.attach} {zh?'附加元数据':'Attach'}</button>
            <span className="spacer" />
            <button className="comp-chip">
              <span className={`prov-dot ${prov.dot}`}>{prov.letter}</span> {prov.short} {Icons.down}
            </button>
            <button className="btn accent" onClick={submit}>
              {stage === 0 ? (zh?'开始':'Start') : stage < 3 ? (zh?'继续':'Continue') : (zh?'发送':'Send')} {Icons.send}
            </button>
          </div>
        </div>
        <div className="chint">
          <span><span className="kbd">⌘K</span> {zh?'命令面板':'palette'} · <span className="kbd">⌘/</span> {zh?'切换知识':'toggle skills'}</span>
          <span>{zh?'流式 · 审计开启':'streaming · audit on'}</span>
        </div>
      </div>
    </div>
  );
}

function InspMeta({ t, zh }) {
  const [exp, setExp] = useState({SAL_SaleOrder:true, BD_Customer:true});
  return (
    <>
      <div className="panel-title"><h3>{t('connection')}</h3><span className="pill good">CONNECTED</span></div>
      <div className="card" style={{fontFamily:'var(--font-mono)', fontSize:11.5}}>
        <div className="kv"><span className="k">server</span><span className="v">erp.sundry.cn:8081</span></div>
        <div className="kv"><span className="k">database</span><span className="v">AIS20240311</span></div>
        <div className="kv"><span className="k">version</span><span className="v">V9.1.0.2</span></div>
        <div className="kv"><span className="k">mode</span><span className="v good">metadata-readonly</span></div>
        <div className="kv"><span className="k">last sync</span><span className="v">2m ago</span></div>
      </div>
      <div className="panel-title"><h3>{t('businessObjects')}</h3><span className="right">{METADATA.length} objects</span></div>
      <div className="meta-tree">
        {METADATA.map(o=>(
          <div key={o.key}>
            <div className="row" onClick={()=>setExp(s=>({...s,[o.key]:!s[o.key]}))}>
              <span className="meta-caret">{exp[o.key]?'▾':'▸'}</span>
              <span className="mtype">obj</span>
              <span className="mname">{o.key}</span>
              <span className="dim" style={{marginLeft:'auto', fontSize:10.5}}>{o.label}</span>
            </div>
            {exp[o.key] && o.fields && o.fields.map(f=>(
              <div key={f.key} style={{paddingLeft:20}}>
                <div className="row">
                  <span className="meta-caret"> </span>
                  <span className="mtype">{f.type}</span>
                  <span className={f.custom?'mcustom':'mname'}>{f.key}</span>
                  {f.primary && <span className="mpk">pk</span>}
                  {f.custom && <span className="mcustom" style={{marginLeft:'auto', fontSize:9.5}}>custom</span>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function InspSec({ t, zh }) {
  return (
    <>
      <div className="panel-title"><h3>{zh?'数据库访问白名单':'DB Access Whitelist'}</h3><span className="right">hardcoded</span></div>
      <div className="card" style={{fontSize:11.5, color:'var(--muted)', lineHeight:1.5}}>
        {t('whitelistHelp')}
      </div>
      <div className="panel-title"><h3>{t('recentAccess')}</h3><span className="right">session</span></div>
      <div className="wl-list">
        {WHITELIST.map((w,i)=>(
          <div key={i} className={`wl-item ${w.type}`}>
            <span className="t">{w.time}</span>
            <span className="tbl">{w.table}</span>
            <span className="v">{w.type.toUpperCase()}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function InspArt({ t, zh }) {
  return (
    <>
      <div className="panel-title"><h3>{t('generatedFiles')}</h3><span className="right mono">川沙诚信商贸/generated</span></div>
      {ARTIFACTS.map((a,i)=>(
        <div key={i} className={`art-item ${a.status}`}>
          <div className="art-ic">{a.ext}</div>
          <div style={{flex:1, minWidth:0}}>
            <div className="art-title">{a.name}</div>
            <div className="art-meta"><span>{a.size}</span><span>·</span><span>{a.when}</span></div>
            <span className={`art-status ${a.status}`}>{a.status}</span>
          </div>
        </div>
      ))}
    </>
  );
}

window.Workspace = Workspace;
