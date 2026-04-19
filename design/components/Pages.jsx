function ProjectsPage({ t, lang }) {
  const zh = lang === 'zh';
  const [wizOpen, setWizOpen] = useState(false);
  return (
    <div className="page-scroll"><div className="page-inner">
      <h1 className="page-title"><span className="ser">{t('projectsTitle')}</span></h1>
      <p className="page-sub">{t('projectsSub')}</p>
      <div className="proj-grid">
        {PROJECTS.map(p=>(
          <div key={p.id} className="proj-card">
            <h4>
              <span className={`proj-dot ${p.state==='live'?'live':p.state==='conn'?'conn':''}`}/>
              {p.name}
              <span className="chip" style={{marginLeft:'auto', fontSize:10}}>{p.env}</span>
            </h4>
            <div className="sublabel">erp.sundry.cn:8081 · {p.version}</div>
            <div className="stats">
              <div className="stat"><div className="lbl">{zh?'对话':'Chats'}</div><div className="val">{p.conv}</div></div>
              <div className="stat"><div className="lbl">{zh?'产物':'Files'}</div><div className="val">{p.art}</div></div>
              <div className="stat"><div className="lbl">{zh?'Skills':'Skills'}</div><div className="val">{p.deploys + 3}</div></div>
            </div>
            <div className="cfoot">
              <span className="mono dim">↳ projects/{p.name}/</span>
              <span style={{marginLeft:'auto'}}><button className="btn sm ghost">{zh?'打开':'Open'} →</button></span>
            </div>
          </div>
        ))}
        <button className="proj-card new" onClick={()=>setWizOpen(true)}>
          <div className="plus">{Icons.plus}</div>
          <div style={{fontSize:13, fontWeight:500}}>{zh?'新建客户项目':'New client'}</div>
          <div className="muted small" style={{marginTop:4}}>{zh?'选产品 · 连数据库 · 选账套':'Pick product · connect DB · pick book'}</div>
        </button>
      </div>
      {wizOpen && <NewClientDialog lang={lang} onClose={()=>setWizOpen(false)}/>}
    </div></div>
  );
}


/* ───────────────────── New Client Dialog ─────────────────────
   Flow: basics → product → DB creds + test → pick accounting book → confirm
──────────────────────────────────────────────────────────────── */
function NewClientDialog({ lang, onClose }) {
  const zh = lang === 'zh';
  const [step, setStep] = useState(0); // 0: basics+product, 1: DB, 2: confirm
  const [name, setName] = useState('');
  const [product, setProduct] = useState(null); // 'standard' | 'enterprise'
  const [db, setDb] = useState({ server:'', user:'sa', pwd:'' });
  const [connState, setConnState] = useState('idle'); // idle | testing | ok | fail
  const [books, setBooks] = useState([]);
  const [book, setBook] = useState(null);
  const dir = name ? `%USERPROFILE%\\.opendeploy\\projects\\${name}\\` : '—';

  const testConn = () => {
    setConnState('testing');
    setBook(null);
    setBooks([]);
    setTimeout(()=>{
      // Mock: return 3 accounting books
      setConnState('ok');
      setBooks([
        { id:'AIS20240311', name:'川沙诚信商贸（生产账套）', code:'AIS20240311', period:'2026-04', users:12 },
        { id:'AIS20230101', name:'川沙诚信商贸（历史账套）', code:'AIS20230101', period:'2023-12', users:3,  archived:true },
        { id:'AIS20240905', name:'川沙分公司（测试）',         code:'AIS20240905', period:'2026-04', users:5 },
      ]);
    }, 1200);
  };

  const canNext0 = name.trim() && product;
  const canNext1 = connState==='ok' && book;

  return (
    <div className="nc-overlay" onMouseDown={onClose}>
      <div className="nc-dialog" onMouseDown={e=>e.stopPropagation()}>
        <div className="nc-head">
          <div>
            <div className="nc-title">{zh?'新建客户项目':'New client project'}</div>
            <div className="nc-sub">{zh?'每个客户一个工作空间 · 本地隔离':'One workspace per client · local-isolated'}</div>
          </div>
          <button className="nc-x" onClick={onClose}>×</button>
        </div>

        {/* Stepper */}
        <div className="nc-steps">
          {[
            zh?'基本信息 & 产品':'Basics & product',
            zh?'数据库连接':'Database',
            zh?'确认创建':'Confirm',
          ].map((label,i)=>(
            <React.Fragment key={i}>
              <div className={`nc-step ${i<step?'done':i===step?'cur':''}`}>
                <span className="nc-step-n">{i<step?'✓':i+1}</span>
                <span>{label}</span>
              </div>
              {i<2 && <span className="nc-step-dash"/>}
            </React.Fragment>
          ))}
        </div>

        <div className="nc-body">
          {step===0 && <>
            <label className="nc-field">
              <span className="nc-lbl">{zh?'客户名':'Customer name'}</span>
              <input autoFocus placeholder={zh?'例如：川沙诚信商贸':'e.g. Sundry Trading Co.'} value={name} onChange={e=>setName(e.target.value)} />
              <span className="nc-hint mono">↳ {dir}</span>
            </label>

            <div className="nc-field">
              <span className="nc-lbl">{zh?'产品':'Product'}</span>
              <div className="nc-prod-grid">
                {[
                  { id:'standard',   zh:'云星空标准版',   en:'K/3 Cloud Standard',   sub:'金蝶 K/3 Cloud · Standard Edition',     desc: zh?'中小企业通用功能包':'SMB core functionality' },
                  { id:'enterprise', zh:'云星空企业版',   en:'K/3 Cloud Enterprise', sub:'金蝶 K/3 Cloud · Enterprise Edition',   desc: zh?'支持多组织、多法人、高级工作流':'Multi-org · multi-legal-entity · advanced workflow' },
                ].map(p=>(
                  <button key={p.id} className={`nc-prod ${product===p.id?'on':''}`} onClick={()=>setProduct(p.id)}>
                    <div className="nc-prod-top">
                      <span className="nc-prod-logo">K</span>
                      <div style={{display:'flex', flexDirection:'column', alignItems:'flex-start', minWidth:0, flex:1}}>
                        <span className="nc-prod-name">{zh?p.zh:p.en}</span>
                        <span className="nc-prod-sub">{p.sub}</span>
                      </div>
                      {product===p.id && <span className="nc-prod-tick">✓</span>}
                    </div>
                    <div className="nc-prod-desc">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </>}

          {step===1 && <>
            <div className="nc-row2">
              <label className="nc-field">
                <span className="nc-lbl">{zh?'数据库服务器':'SQL Server'}</span>
                <input placeholder="erp.sundry.cn,1433" value={db.server} onChange={e=>{ setDb({...db, server:e.target.value}); setConnState('idle'); }}/>
              </label>
              <label className="nc-field">
                <span className="nc-lbl">{zh?'用户名':'Username'}</span>
                <input value={db.user} onChange={e=>{ setDb({...db, user:e.target.value}); setConnState('idle'); }}/>
              </label>
            </div>
            <div className="nc-row2">
              <label className="nc-field">
                <span className="nc-lbl">{zh?'密码':'Password'}</span>
                <input type="password" placeholder="••••••••" value={db.pwd} onChange={e=>{ setDb({...db, pwd:e.target.value}); setConnState('idle'); }}/>
              </label>
              <div className="nc-field">
                <span className="nc-lbl">&nbsp;</span>
                <button className="btn accent" onClick={testConn} disabled={!db.server||!db.pwd||connState==='testing'}>
                  {connState==='testing' ? (zh?'连接中…':'Testing…') : (zh?'连接测试':'Test connection')}
                </button>
              </div>
            </div>

            {connState==='ok' && <div className="nc-conn-ok">
              <span className="nc-dot good"/>
              <span>{zh?'已连接 ✓ · 发现 ':'Connected · found '}</span>
              <strong>{books.length}</strong>
              <span>{zh?' 个账套':' accounting books'}</span>
              <span className="dim mono" style={{marginLeft:'auto', fontSize:11}}>SQL Server 2019 · 194ms</span>
            </div>}

            {connState==='ok' && <div className="nc-field">
              <span className="nc-lbl">{zh?'选择账套':'Pick accounting book'}</span>
              <div className="nc-book-list">
                {books.map(b=>(
                  <button key={b.id} className={`nc-book ${book===b.id?'on':''} ${b.archived?'archived':''}`} onClick={()=>setBook(b.id)}>
                    <div className="nc-book-main">
                      <span className="nc-book-name">{b.name}</span>
                      {b.archived && <span className="chip dim" style={{fontSize:9.5, padding:'1px 6px'}}>{zh?'已归档':'archived'}</span>}
                    </div>
                    <div className="nc-book-meta">
                      <span className="mono">{b.code}</span>
                      <span className="dim">·</span>
                      <span>{zh?'当前期间 ':'Period '}{b.period}</span>
                      <span className="dim">·</span>
                      <span>{b.users} {zh?'用户':'users'}</span>
                    </div>
                    {book===b.id && <span className="nc-book-tick">✓</span>}
                  </button>
                ))}
              </div>
            </div>}

            {connState==='idle' && <div className="nc-empty">
              {zh?'填入数据库凭据后点「连接测试」，账套列表会自动从数据库读取。':'Enter credentials and click Test — books are read from the database.'}
            </div>}
          </>}

          {step===2 && <>
            <div className="nc-summary">
              <div className="nc-sum-row"><span className="nc-sum-lbl">{zh?'客户名':'Customer'}</span><span className="nc-sum-val">{name}</span></div>
              <div className="nc-sum-row"><span className="nc-sum-lbl">{zh?'产品':'Product'}</span><span className="nc-sum-val"><span className="nc-prod-logo" style={{display:'inline-grid', marginRight:6, verticalAlign:'middle'}}>K</span>{product==='standard'?(zh?'云星空标准版':'K/3 Cloud Standard'):(zh?'云星空企业版':'K/3 Cloud Enterprise')}</span></div>
              <div className="nc-sum-row"><span className="nc-sum-lbl">{zh?'数据库':'Database'}</span><span className="nc-sum-val mono">{db.user}@{db.server}</span></div>
              <div className="nc-sum-row"><span className="nc-sum-lbl">{zh?'账套':'Book'}</span><span className="nc-sum-val mono">{book} <span className="dim">· {books.find(b=>b.id===book)?.name}</span></span></div>
              <div className="nc-sum-row"><span className="nc-sum-lbl">{zh?'本地目录':'Local dir'}</span><span className="nc-sum-val mono small">{dir}</span></div>
              <div className="nc-sum-row"><span className="nc-sum-lbl">{zh?'凭据存储':'Credentials'}</span><span className="nc-sum-val"><span className="pill good">{zh?'本地钥匙串加密':'OS keychain encrypted'}</span></span></div>
            </div>
            <div className="nc-note">
              {zh?<>点「创建」后，OpenDeploy 会在本地建立工作空间、初始化 git、加密保存凭据，并尝试读取一次元数据快照（仅元数据、只读）。</>:<>On create: local workspace, git init, encrypted credentials, and a one-shot metadata snapshot (metadata-only, read-only).</>}
            </div>
          </>}
        </div>

        <div className="nc-foot">
          <button className="btn" onClick={step===0 ? onClose : ()=>setStep(s=>s-1)}>
            {step===0 ? (zh?'取消':'Cancel') : (zh?'← 上一步':'← Back')}
          </button>
          <div className="dim small mono">{step+1} / 3</div>
          {step<2
            ? <button className="btn accent" disabled={step===0 ? !canNext0 : !canNext1} onClick={()=>setStep(s=>s+1)}>{zh?'下一步 →':'Next →'}</button>
            : <button className="btn accent" onClick={onClose}>{zh?'创建客户项目':'Create client'}</button>}
        </div>
      </div>
    </div>
  );
}


/* ────────────────────────── Skills ──────────────────────────
   Skills = 顾问的业务域能力包。每个 skill 封装：
   · 涉及的业务对象 / 字段 / 事件（元数据上下文）
   · 常见诉求的 prompt 模板
   · 生成代码时会参考的示例片段 & 踩坑经验
   顾问可以启用/停用、编辑、从 github 拉取社区 skill、把自己客户处打磨过的对话沉淀为 skill。
─────────────────────────────────────────────────────────────── */

const SKILLS = [
  // SALES ───────────────────
  { id:'sk-credit', domain:'sales', name:'信用额度控制', sub:'Credit limit',
    desc:'销售订单/出库审核时校验客户信用额度，支持账期、担保、覆盖审批。',
    products:['standard','enterprise'],
    objects:['SAL_SaleOrder','SAL_OUTSTOCK','BD_Customer','AR_Receivable'],
    events:['BeforeExecuteOperationTransaction (Audit)'],
    enabled:true, source:'built-in', author:'OpenDeploy', usage:47, prompts:[
      '客户想让销售订单审核时校验信用额度',
      '出库单审核时客户超信用应拒绝，财务审批可放行',
      '加上信用担保人逻辑',
    ],
  },
  { id:'sk-price', domain:'sales', name:'价格策略重算', sub:'Pricing rules',
    desc:'下单/改单时按客户等级、合同、阶梯价自动重算销售单价。',
    products:['standard','enterprise'],
    objects:['SAL_SaleOrder','BD_Customer','BD_MATERIALSalePrice'],
    events:['AfterF7Select (FMaterialId)','AfterRowChange'],
    enabled:true, source:'built-in', author:'OpenDeploy', usage:31, prompts:[
      '按客户等级自动带出折扣价',
      '合同价优先，合同外走阶梯价',
    ],
  },
  { id:'sk-available', domain:'sales', name:'可用量预占 / 在途', sub:'Stock availability',
    desc:'接单时校验可用量（现存 − 预占 + 在途），超量提示或拒绝。',
    products:['standard','enterprise'],
    objects:['SAL_SaleOrder','STK_Inventory','PUR_PurchaseOrder'],
    events:['BeforeExecuteOperationTransaction (Save/Audit)'],
    enabled:false, source:'built-in', author:'OpenDeploy', usage:19,
  },
  { id:'sk-approval', domain:'sales', name:'多级审批与状态机', sub:'Approval workflow',
    desc:'按金额/客户/物料分级走不同审批流，与工作流平台协同。',
    products:['enterprise'],
    objects:['SAL_SaleOrder'],
    events:['BeforeExecuteOperationTransaction (Submit/Audit)'],
    enabled:false, source:'community', author:'@kd_tangyun', usage:8,
  },

  // PURCHASE ─────────────────
  { id:'sk-pur-price', domain:'purchase', name:'供应商询价/比价', sub:'Vendor quote',
    desc:'下单前按历史采购价+有效报价单比价，带出推荐价。',
    products:['standard','enterprise'],
    objects:['PUR_PurchaseOrder','BD_Supplier','PUR_Quotation'],
    events:['AfterF7Select (FMaterialId)'],
    enabled:false, source:'built-in', author:'OpenDeploy', usage:12,
  },
  { id:'sk-pur-recv', domain:'purchase', name:'采购入库生成应付', sub:'Receipt→AP',
    desc:'入库单审核后自动生成应付单，按暂估/正式价规则。',
    products:['standard','enterprise'],
    objects:['PUR_ReceiveBill','AP_Payable'],
    events:['AfterExecuteOperationTransaction (Audit)'],
    enabled:true, source:'custom', author:'乔磊 · 川沙诚信商贸', usage:5,
  },

  // STOCK ────────────────────
  { id:'sk-stk-transfer', domain:'stock', name:'调拨自动生成应收内转', sub:'Transfer→AR',
    desc:'跨组织/跨法人调拨审核后生成内部应收，支持税率拆分。',
    products:['enterprise'],
    objects:['STK_TransferOut','STK_TransferIn','AR_Internal'],
    enabled:false, source:'community', author:'@feiniao', usage:4,
  },
  { id:'sk-stk-count', domain:'stock', name:'盘点差异处理', sub:'Count variance',
    desc:'盘盈盘亏按金额阈值分级审批，超阈值需财务 + 仓库双签。',
    products:['standard','enterprise'],
    objects:['STK_Count','STK_Adjust'],
    enabled:false, source:'built-in', author:'OpenDeploy', usage:6,
  },

  // FINANCE ──────────────────
  { id:'sk-ar-aging', domain:'finance', name:'应收账龄分析', sub:'AR aging',
    desc:'按客户/业务员分组产出账龄明细和汇总，支持自定义区间。',
    products:['standard','enterprise'],
    objects:['AR_Receivable','BD_Customer'],
    enabled:true, source:'built-in', author:'OpenDeploy', usage:22,
  },
  { id:'sk-close', domain:'finance', name:'期末结账检查', sub:'Period close',
    desc:'结账前扫描欠票、未过账凭证、暂估余额，生成待办清单。',
    products:['standard','enterprise'],
    objects:['AP_Payable','GL_Voucher','STK_StkEstimate'],
    enabled:false, source:'built-in', author:'OpenDeploy', usage:9,
  },

  // BASE ──────────────────
  { id:'sk-cust-import', domain:'base', name:'客户档案批量导入', sub:'Customer import',
    desc:'Excel 模板导入客户档案，自动编码、重复校验、分组归属。',
    products:['standard','enterprise'],
    objects:['BD_Customer'],
    enabled:true, source:'custom', author:'乔磊', usage:3,
  },
  { id:'sk-mat-code', domain:'base', name:'物料编码生成规则', sub:'Material coding',
    desc:'按类别-规格-颜色-版次拼接，支持流水号回退和占位校验。',
    products:['standard','enterprise'],
    objects:['BD_MATERIAL','BD_MATERIALCATE'],
    enabled:false, source:'built-in', author:'OpenDeploy', usage:14,
  },
];

const PRODUCTS = [
  { id:'all',         zh:'全部产品',       en:'All products',  logo:'K' },
  { id:'standard',    zh:'云星空标准版',    en:'K/3 Cloud · Std',  logo:'K', sub:'金蝶 K/3 Cloud Standard' },
  { id:'enterprise',  zh:'云星空企业版',    en:'K/3 Cloud · Ent',  logo:'K', sub:'金蝶 K/3 Cloud Enterprise' },
];

const DOMAINS = [
  { id:'all',       zh:'全部',       en:'All' },
  { id:'sales',     zh:'销售',       en:'Sales',     color:'accent' },
  { id:'purchase',  zh:'采购',       en:'Purchase',  color:'info' },
  { id:'stock',     zh:'库存',       en:'Stock',     color:'warn' },
  { id:'finance',   zh:'财务',       en:'Finance',   color:'good' },
  { id:'base',      zh:'基础资料',   en:'Base data', color:'' },
];

function SkillsPage({ t, lang }) {
  const zh = lang === 'zh';
  const [skills, setSkills] = useState(SKILLS);
  const [product, setProduct] = useState('all'); // 'all' | 'standard' | 'enterprise'
  const [group, setGroup] = useState('built-in');
  const [active, setActive] = useState(null); // null = list view; id = detail view
  const [q, setQ] = useState('');
  const [tagFilter, setTagFilter] = useState(null);
  const [userGroups, setUserGroups] = useState([
    { id:'ug-cc', name: zh?'川沙诚信 · 常用':'Sundry · favorites', skillIds:['sk-credit','sk-pur-recv'] },
  ]);

  const toggle = (id) => setSkills(prev => prev.map(s => s.id===id ? {...s, enabled:!s.enabled} : s));

  // Source groups — fixed
  const SOURCES = [
    { id:'built-in',  zh:'内建',   en:'Built-in',  icon:Icons.shield },
    { id:'community', zh:'社区',   en:'Community', icon:Icons.git },
    { id:'custom',    zh:'自定义', en:'Custom',    icon:Icons.file },
  ];
  const enabledCount = skills.filter(s=>s.enabled).length;

  // Product filter helper — skill without explicit products field considered universal
  const matchesProduct = (s) => product==='all' || !s.products || s.products.includes(product);

  // Derive the list for current group
  let list;
  if (group === 'all-enabled') {
    list = skills.filter(s => s.enabled);
  } else if (group.startsWith('ug-')) {
    const ug = userGroups.find(x => x.id === group);
    list = ug ? skills.filter(s => ug.skillIds.includes(s.id)) : [];
  } else {
    list = skills.filter(s => s.source === group);
  }
  // Apply product + tag + search
  list = list.filter(s =>
    matchesProduct(s) &&
    (!tagFilter || s.domain === tagFilter) &&
    (!q || s.name.includes(q) || (s.sub||'').toLowerCase().includes(q.toLowerCase()))
  );

  const sk = active ? skills.find(s => s.id === active) : null;

  const domainLabel = (id) => {
    const d = DOMAINS.find(x=>x.id===id);
    return d ? (zh?d.zh:d.en) : id;
  };

  const groupLabel = () => {
    if (group === 'all-enabled') return zh?'已启用':'Enabled';
    const src = SOURCES.find(s=>s.id===group);
    if (src) return zh?src.zh:src.en;
    const ug = userGroups.find(x=>x.id===group);
    return ug ? ug.name : group;
  };

  const addUserGroup = () => {
    const name = prompt(zh?'新分组名称：':'Group name:');
    if (!name) return;
    const id = 'ug-' + Date.now();
    setUserGroups([...userGroups, { id, name, skillIds:[] }]);
    setGroup(id);
  };

  const counts = {
    'built-in': skills.filter(s=>s.source==='built-in' && matchesProduct(s)).length,
    'community': skills.filter(s=>s.source==='community' && matchesProduct(s)).length,
    'custom': skills.filter(s=>s.source==='custom' && matchesProduct(s)).length,
  };
  const productCounts = {
    'all': skills.length,
    'standard': skills.filter(s=>!s.products || s.products.includes('standard')).length,
    'enterprise': skills.filter(s=>!s.products || s.products.includes('enterprise')).length,
  };

  // Count skills per domain (within current group) for tag chip counts
  const allTags = Array.from(new Set(list.map(s=>s.domain).concat(skills.filter(s=>(group==='all-enabled'?s.enabled:group.startsWith('ug-')?(userGroups.find(x=>x.id===group)?.skillIds.includes(s.id)):s.source===group)).map(s=>s.domain))));

  return (
    <div className="skills-layout-v2">

      {/* ── LEFT: groups ────────────────────────────────────────── */}
      <div className="sk-groups">
        <div className="sk-groups-head">
          <h2 style={{margin:0, fontSize:14, fontWeight:600, letterSpacing:'-0.01em'}}>{zh?'技能库':'Skill library'}</h2>
          <div className="dim mono" style={{fontSize:10.5, marginTop:3}}>{enabledCount} / {skills.length} {zh?'启用':'enabled'}</div>
        </div>

        {/* Product selector — skills are filtered by ERP product */}
        <div className="sk-prod">
          <div className="sk-prod-lbl">{zh?'产品':'Product'}</div>
          <div className="sk-prod-row">
            {PRODUCTS.map(p=>(
              <button
                key={p.id}
                className={`sk-prod-chip ${product===p.id?'on':''}`}
                onClick={()=>{ setProduct(p.id); setActive(null); }}
                title={p.sub||''}>
                {p.id!=='all' && <span className="sk-prod-logo">{p.logo}</span>}
                <span className="sk-prod-name">{zh?p.zh:p.en}</span>
                <span className="sk-prod-count">{productCounts[p.id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sk-grouplist">
          <div className="sk-grouplabel">{zh?'概览':'Overview'}</div>
          <button
            className={`sk-group ${group==='all-enabled'?'on':''}`}
            onClick={()=>{ setGroup('all-enabled'); setActive(null); setTagFilter(null); }}>
            <span className="sk-group-icon">{Icons.zap}</span>
            <span className="sk-group-name">{zh?'已启用':'Enabled'}</span>
            <span className="sk-group-count">{enabledCount}</span>
          </button>

          <div className="sk-grouplabel">{zh?'来源':'Source'}</div>
          {SOURCES.map(s=>(
            <button
              key={s.id}
              className={`sk-group ${group===s.id?'on':''}`}
              onClick={()=>{ setGroup(s.id); setActive(null); setTagFilter(null); }}>
              <span className="sk-group-icon">{s.icon}</span>
              <span className="sk-group-name">{zh?s.zh:s.en}</span>
              <span className="sk-group-count">{counts[s.id]}</span>
            </button>
          ))}

          <div className="sk-grouplabel">
            <span>{zh?'我的分组':'My groups'}</span>
            <button className="sk-group-add" onClick={addUserGroup} title={zh?'新建分组':'New group'}>+</button>
          </div>
          {userGroups.map(ug=>(
            <button
              key={ug.id}
              className={`sk-group ${group===ug.id?'on':''}`}
              onClick={()=>{ setGroup(ug.id); setActive(null); setTagFilter(null); }}>
              <span className="sk-group-icon">{Icons.folder}</span>
              <span className="sk-group-name">{ug.name}</span>
              <span className="sk-group-count">{ug.skillIds.length}</span>
            </button>
          ))}
          {userGroups.length === 0 && (
            <div className="sk-grouphint">
              {zh?'把常用 skill 打包起来，按客户或场景组织。':'Organize skills by client or scenario.'}
            </div>
          )}
        </div>

        <div className="sk-groups-foot">
          <button className="btn sm ghost" style={{width:'100%'}}>{Icons.refresh}<span>{zh?'从社区同步':'Sync community'}</span></button>
        </div>
      </div>

      {/* ── RIGHT: list or detail ───────────────────────────────── */}
      <div className="sk-main">

        {active == null ? (
          // ─── LIST MODE ───
          <>
            <div className="sk-main-head">
              <div className="sk-main-title">
                <h1 className="sk-h1" style={{margin:0}}>{groupLabel()}</h1>
                <div className="dim small mono" style={{marginTop:4}}>
                  {list.length} {zh?'个 skill':'skills'} · {list.filter(s=>s.enabled).length} {zh?'启用':'on'}
                </div>
              </div>
              <div className="sk-main-actions">
                <div className="sk-search" style={{width:240}}>
                  <span className="sk-search-icon">{Icons.search}</span>
                  <input placeholder={zh?'搜索 skill…':'Search skills…'} value={q} onChange={e=>setQ(e.target.value)}/>
                </div>
                <button className="btn sm accent">{Icons.plus}<span>{zh?'新建 skill':'New skill'}</span></button>
              </div>
            </div>

            {/* tag chips */}
            <div className="sk-tagbar">
              <button className={`sk-tag ${!tagFilter?'on':''}`} onClick={()=>setTagFilter(null)}>
                {zh?'全部':'All'}
              </button>
              {DOMAINS.filter(d=>d.id!=='all').filter(d=>allTags.includes(d.id)).map(d=>(
                <button key={d.id} className={`sk-tag ${tagFilter===d.id?'on':''}`} onClick={()=>setTagFilter(d.id)}>
                  {zh?d.zh:d.en}
                </button>
              ))}
            </div>

            <div className="sk-cards">
              {list.map(s=>(
                <div key={s.id} className="sk-card" onClick={()=>setActive(s.id)}>
                  <div className="sk-card-head">
                    <div className="sk-card-title">{s.name}</div>
                    <label className="sk-toggle" onClick={e=>e.stopPropagation()}>
                      <input type="checkbox" checked={s.enabled} onChange={()=>toggle(s.id)}/>
                      <span className="sk-toggle-track"/>
                    </label>
                  </div>
                  <div className="sk-card-sub">{s.sub}</div>
                  <p className="sk-card-desc">{s.desc}</p>
                  <div className="sk-card-foot">
                    <span className="sk-tag-pill">{domainLabel(s.domain)}</span>
                    <span className="dim mono" style={{fontSize:10.5}}>·</span>
                    <span className="dim mono" style={{fontSize:10.5}}>{s.usage} {zh?'次使用':'uses'}</span>
                    <span style={{marginLeft:'auto'}} className="dim small">{s.author}</span>
                  </div>
                </div>
              ))}
              {list.length === 0 && (
                <div className="sk-empty">
                  <div className="sk-empty-icon">{Icons.sparkles}</div>
                  <div className="sk-empty-title">{zh?'这个分组暂无 skill':'No skills in this group'}</div>
                  <div className="muted small" style={{marginTop:6}}>
                    {q ? (zh?'换个关键词试试':'Try a different search')
                       : group.startsWith('ug-') ? (zh?'从其他分组拖拽或右键添加 skill 到这里':'Drag skills here or right-click "Add to group"')
                       : (zh?'稍后可以从社区同步或自建':'Sync from community or create your own')}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          // ─── DETAIL MODE ───
          <div className="sk-detail-inner">

            <button className="sk-back" onClick={()=>setActive(null)}>
              ← <span>{zh?'返回':'Back to'} {groupLabel()}</span>
            </button>

            <div className="sk-title-row">
              <div style={{minWidth:0}}>
                <h1 className="sk-h1">{sk.name}</h1>
                <div className="sk-sub">{sk.sub} · <span className="sk-tag-pill" style={{marginLeft:4}}>{domainLabel(sk.domain)}</span></div>
              </div>
              <div style={{display:'flex', gap:8, alignItems:'center', flexShrink:0}}>
                {sk.enabled
                  ? <span className="chip good" style={{padding:'4px 10px'}}>✓ {zh?'已启用':'enabled'}</span>
                  : <span className="chip" style={{padding:'4px 10px'}}>{zh?'未启用':'disabled'}</span>}
                <button className={`btn sm ${sk.enabled?'':'accent'}`} onClick={()=>toggle(sk.id)}>
                  {sk.enabled?(zh?'停用':'Disable'):(zh?'启用到本项目':'Enable')}
                </button>
              </div>
            </div>

            <p className="sk-desc">{sk.desc}</p>

            <div className="sk-meta-grid">
              <div className="sk-meta-item">
                <div className="sk-meta-lbl">{zh?'来源':'Source'}</div>
                <div className="sk-meta-val">{sk.source} <span className="dim">· {sk.author}</span></div>
              </div>
              <div className="sk-meta-item">
                <div className="sk-meta-lbl">{zh?'使用次数':'Usage'}</div>
                <div className="sk-meta-val mono">{sk.usage} {zh?'次对话':'calls'}</div>
              </div>
              <div className="sk-meta-item">
                <div className="sk-meta-lbl">{zh?'版本':'Version'}</div>
                <div className="sk-meta-val mono">v1.2.0 · 4a7f1b2</div>
              </div>
            </div>

            <h3 className="sk-h3">{zh?'涉及的业务对象':'Business objects'}</h3>
            <div className="sk-chips">
              {sk.objects?.map(o=>(
                <span key={o} className="sk-chip">{Icons.database}<span className="mono" style={{fontSize:11.5}}>{o}</span></span>
              ))}
            </div>

            {sk.events && sk.events.length>0 && <>
              <h3 className="sk-h3">{zh?'插入点':'Plugin points'}</h3>
              <div className="sk-chips">
                {sk.events.map(e=>(
                  <span key={e} className="sk-chip accent">{Icons.zap}<span className="mono" style={{fontSize:11.5}}>{e}</span></span>
                ))}
              </div>
            </>}

            {sk.prompts && <>
              <h3 className="sk-h3">{zh?'顾问常用 prompt':'Example prompts'}</h3>
              <div className="sk-prompts">
                {sk.prompts.map((p,i)=>(
                  <div key={i} className="sk-prompt">
                    <span className="dim mono" style={{fontSize:11, width:20}}>{i+1}</span>
                    <span>"{p}"</span>
                    <button className="btn sm ghost" style={{marginLeft:'auto'}}>{zh?'试试':'Try'} →</button>
                  </div>
                ))}
              </div>
            </>}

            <h3 className="sk-h3">{zh?'踩坑 & 经验':'Notes & gotchas'}</h3>
            <div className="sk-notes">
              {sk.id==='sk-credit' ? (zh?<>
                <p>· 信用额度字段常见为客户档案的 <code>F_JN_CreditLimit</code>（金额）或自定义下划线字段，约 30% 客户定制。</p>
                <p>· 应收余额应取 "未核销" 金额，不是累计发生额。对应字段 <code>AR_Receivable.FIsSettled = false</code>。</p>
                <p>· 审核操作码通常是 <code>Audit</code>，但 V8.2 少数客户改成 <code>Approval</code>，下发前需要先确认。</p>
                <p>· <strong>硬红线</strong>：插件只能做校验或消息，不能直接修改主表字段 —— 会绕过审批流。</p>
              </>:<>
                <p>· Credit limit lives on the customer master — commonly <code>F_JN_CreditLimit</code>. ~30% of clients customize the field name.</p>
                <p>· A/R balance must use <strong>unsettled</strong> amount, not total posted.</p>
                <p>· Audit op code is usually <code>Audit</code> but V8.2 clients sometimes use <code>Approval</code>.</p>
                <p>· <strong>Hard line</strong>: plugin may validate / message only — never mutate header fields (bypasses workflow).</p>
              </>) : (zh?<>
                <p>· 对应的 skill 笔记由首次在客户项目使用时自动沉淀，再经过人工审阅可晋升为"内建"。</p>
                <p>· 你可以直接在这里编辑 markdown。保存时自动同步到 <code>.opendeploy/skills/</code>。</p>
              </>:<>
                <p>· Skill notes are collected from real client sessions and curated before being marked built-in.</p>
                <p>· You can edit markdown here directly — saves to <code>.opendeploy/skills/</code>.</p>
              </>)}
            </div>

            <div className="sk-footer">
              <button className="btn sm ghost">{Icons.file}<span>{zh?'编辑 markdown':'Edit markdown'}</span></button>
              <button className="btn sm ghost">{Icons.copy}<span>{zh?'复制链接分享':'Copy share link'}</span></button>
              <button className="btn sm ghost">{Icons.git}<span>{zh?'发布到社区':'Publish'}</span></button>
              <span style={{marginLeft:'auto'}} className="dim small mono">.opendeploy/skills/{sk.source}/{sk.id}.md</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsPage({ t, lang, llm, setLlm }) {
  const zh = lang === 'zh';
  const [tab, setTab] = useState('llm');
  return (
    <div className="page-scroll"><div className="page-inner">
      <h1 className="page-title"><span className="ser">{t('settingsTitle')}</span></h1>
      <p className="page-sub">{t('settingsSub')}</p>
      <div className="settings-grid">
        <nav className="settings-nav">
          <a className={tab==='llm'?'active':''} onClick={()=>setTab('llm')}>LLM & API Key</a>
          <a className={tab==='bos'?'active':''} onClick={()=>setTab('bos')}>{zh?'金蝶 BOS 连接':'Kingdee BOS'}</a>
          <a className={tab==='skills'?'active':''} onClick={()=>setTab('skills')}>{zh?'Skills 源':'Skill sources'}</a>
          <a className={tab==='lang'?'active':''} onClick={()=>setTab('lang')}>{zh?'语言与区域':'Language & Locale'}</a>
          <a className={tab==='audit'?'active':''} onClick={()=>setTab('audit')}>{zh?'审计日志':'Audit log'}</a>
          <a className={tab==='about'?'active':''} onClick={()=>setTab('about')}>{zh?'关于与更新':'About & update'}</a>
        </nav>
        <div>
          {tab==='llm' && <>
            <h3 style={{margin:'0 0 4px', fontSize:16}}>LLM Provider</h3>
            <p className="muted" style={{marginTop:0, fontSize:13}}>
              {zh?'你自备 API Key，OpenDeploy 仅作调用方；密钥使用操作系统钥匙串本地加密存储。':'Your API key. OpenDeploy is only the caller; keys are OS-keychain encrypted locally.'}
            </p>
            <div className="prov-grid">
              {PROVIDERS.map(p=>(
                <div key={p.id} className={`prov-card ${llm===p.id?'on':''}`} onClick={()=>setLlm(p.id)}>
                  <div className="prov-title">
                    <span className={`prov-dot ${p.dot}`}>{p.letter}</span>
                    {p.label}
                    {p.recommended && llm!==p.id && <span className="chip" style={{marginLeft:'auto', fontSize:10}}>{zh?'推荐':'pick'}</span>}
                    {llm===p.id && <span className="chip accent" style={{marginLeft:'auto'}}>active</span>}
                  </div>
                  <div className="prov-sub">{p.sub}</div>
                  <div className="prov-row">
                    <span>↳ {p.lat}</span><span>·</span><span>{p.cost}</span>
                    {llm===p.id ? <span className="ok" style={{marginLeft:'auto'}}>✓ key saved</span> : <span style={{marginLeft:'auto'}}>add key →</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="setting-row" style={{marginTop:20}}>
              <div>
                <div className="lbl">API Key ({llm})</div>
                <div className="hint">{zh?'加密存储在 %USERPROFILE%\\.opendeploy\\keychain':'Stored encrypted at %USERPROFILE%\\.opendeploy\\keychain'}</div>
              </div>
              <div className="ctl"><input type="password" defaultValue="sk-ant-api03-•••••••••••••••••••••••••••"/></div>
            </div>
            <div className="setting-row">
              <div>
                <div className="lbl">{zh?'代码注释语言':'Code comment language'}</div>
                <div className="hint">{zh?'生成代码时注释使用的语言':'Language used for generated code comments'}</div>
              </div>
              <div className="ctl"><select defaultValue="zh"><option value="zh">中文</option><option value="en">English</option></select></div>
            </div>
          </>}
          {tab==='skills' && <>
            <h3 style={{margin:'0 0 4px', fontSize:16}}>{zh?'Skill 源':'Skill sources'}</h3>
            <p className="muted" style={{marginTop:0, fontSize:13}}>
              {zh?'从哪里拉取和同步 skill 能力包。':'Where to pull and sync skill packs from.'}
            </p>
            <div className="setting-row">
              <div>
                <div className="lbl">{zh?'内建 Skills':'Built-in'}</div>
                <div className="hint">github.com/opendeploy-cn/skills · {zh?'官方维护':'curated'}</div>
              </div>
              <div className="ctl"><span className="pill good">synced @ 4a7f1b2</span></div>
            </div>
            <div className="setting-row">
              <div>
                <div className="lbl">{zh?'社区 Skills':'Community'}</div>
                <div className="hint">{zh?'实施同行分享的 skill。默认关闭，需要手动启用。':'Peer-shared. Disabled by default — enable per pack.'}</div>
              </div>
              <div className="ctl"><label className="sk-toggle"><input type="checkbox" defaultChecked /><span className="sk-toggle-track"/></label></div>
            </div>
            <div className="setting-row" style={{border:'none'}}>
              <div>
                <div className="lbl">{zh?'私有 Skill 目录':'Private skill dir'}</div>
                <div className="hint">{zh?'你自己沉淀的 skill。':'Your own skill packs.'}</div>
              </div>
              <div className="ctl"><span className="mono small">%USERPROFILE%\.opendeploy\skills\</span></div>
            </div>
          </>}
          {tab!=='llm' && tab!=='skills' && <div className="card" style={{margin:0, padding:20, color:'var(--muted)'}}>
            {zh?'该设置分组的具体项可在此继续实现。':'This section is scaffolded — more settings here.'}
          </div>}
        </div>
      </div>
    </div></div>
  );
}

window.ProjectsPage = ProjectsPage;
window.SkillsPage = SkillsPage;
window.SettingsPage = SettingsPage;
window.SKILLS = SKILLS;
window.DOMAINS = DOMAINS;
