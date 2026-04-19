const PROJECTS = [
  { id:'p1', name:'川沙诚信商贸', env:'prod', state:'live', version:'V9.1.0.2', conv:12, art:8, deploys:5 },
  { id:'p2', name:'宁波东兴五金', env:'uat', state:'idle', version:'V9.1', conv:7, art:3, deploys:2 },
  { id:'p3', name:'江阴合力精密', env:'dev', state:'conn', version:'V8.2', conv:3, art:1, deploys:0 },
  { id:'p4', name:'泉州鸿运食品', env:'prod', state:'idle', version:'V9.1', conv:9, art:4, deploys:3 },
  { id:'p5', name:'南通翔宇机械', env:'prod', state:'live', version:'V9.1', conv:18, art:11, deploys:9 },
];
const CONVS = [
  { id:'c1', title:'销售订单信用额度预警', date:'今天 14:32', tag:'SAL', tagColor:'accent' },
  { id:'c2', title:'客户档案批量导入校验', date:'昨天', tag:'BD', tagColor:'info' },
  { id:'c3', title:'采购入库自动生成应付', date:'4月15日', tag:'STK→AP', tagColor:'good' },
  { id:'c4', title:'销售出库红字返现逻辑', date:'4月12日', tag:'SAL', tagColor:'accent' },
  { id:'c5', title:'物料编码生成规则', date:'4月10日', tag:'BD', tagColor:'info' },
  { id:'c6', title:'期末结账欠票检查', date:'4月8日', tag:'AP', tagColor:'warn' },
];
const METADATA = [
  { key:'SAL_SaleOrder', label:'销售订单', fields:[
    { key:'FBillNo', type:'str', primary:true },
    { key:'FCustomerId', type:'ref' },
    { key:'FBillTypeId', type:'ref' },
    { key:'FDate', type:'date' },
    { key:'FDocumentStatus', type:'enum' },
    { key:'FAmount', type:'amt' },
    { key:'F_JN_UrgentFlag', type:'bool', custom:true },
  ]},
  { key:'BD_Customer', label:'客户', fields:[
    { key:'FNumber', type:'str', primary:true },
    { key:'FName', type:'str' },
    { key:'F_JN_CreditLimit', type:'amt', custom:true },
    { key:'F_JN_Grade', type:'enum', custom:true },
  ]},
  { key:'AR_Receivable', label:'应收单', fields:[
    { key:'FBillNo', type:'str' },
    { key:'FAmount', type:'amt' },
    { key:'FIsSettled', type:'bool' },
  ]},
  { key:'STK_InStock', label:'采购入库', fields:[] },
  { key:'PUR_PurchaseOrder', label:'采购订单', fields:[] },
];
const WHITELIST = [
  { time:'14:32:11', table:'T_META_OBJECTTYPE', type:'allow' },
  { time:'14:32:11', table:'T_META_FORM', type:'allow' },
  { time:'14:32:12', table:'T_META_FIELD', type:'allow' },
  { time:'14:32:12', table:'T_META_OBJECTEVENTS', type:'allow' },
  { time:'14:32:14', table:'T_AR_Receivable', type:'block' },
  { time:'14:32:14', table:'T_BD_Customer', type:'block' },
  { time:'14:32:15', table:'T_SAL_OrderEntry', type:'block' },
  { time:'14:32:19', table:'T_META_OPERATION', type:'allow' },
];
const ARTIFACTS = [
  { ext:'PY', name:'sale_order_credit_check.py', size:'1.4 KB', when:'刚刚', status:'ready' },
  { ext:'MD', name:'deployment-guide.md', size:'3.2 KB', when:'刚刚', status:'draft' },
  { ext:'JSON', name:'metadata-snapshot.json', size:'127 KB', when:'2m ago', status:'deployed' },
  { ext:'MD', name:'CONTEXT.md', size:'2.1 KB', when:'今早', status:'deployed' },
];

function SecondarySide({ t, page, activeProject, setActiveProject, activeConv, setActiveConv }) {
  if (page === 'settings') {
    return (
      <aside className="side">
        <div className="side-head"><h2>{t('settings')}</h2></div>
        <div className="side-sec">
          <div className="side-label">{t('customers')}</div>
          {PROJECTS.slice(0,3).map(p => (
            <div key={p.id} className={`proj-item ${p.id===activeProject?'active':''}`} onClick={()=>setActiveProject(p.id)}>
              <span className={`proj-dot ${p.state==='live'?'live':p.state==='conn'?'conn':''}`} />
              <span>{p.name}</span>
              <span className="proj-meta">{p.env}</span>
            </div>
          ))}
        </div>
      </aside>
    );
  }
  if (page === 'skills') {
    // Skills page has its own built-in group rail, so the outer side rail is hidden by mode-skills class
    return null;
  }
  if (page === 'settings') {
    // Settings has its own inner nav; no outer side rail needed
    return null;
  }
  if (page === 'projects') {
    return (
      <aside className="side">
        <div className="side-head"><h2>{t('projects')}</h2><span className="sub">{PROJECTS.length}</span></div>
        <div className="side-sec" style={{flex:1, overflow:'auto', minHeight:0}}>
          <div className="side-label">{t('customers')}</div>
          {PROJECTS.map(p=>(
            <div key={p.id} className={`proj-item ${p.id===activeProject?'active':''}`} onClick={()=>setActiveProject(p.id)}>
              <span className={`proj-dot ${p.state==='live'?'live':p.state==='conn'?'conn':''}`} />
              <span>{p.name}</span>
              <span className="proj-meta">{p.env}</span>
            </div>
          ))}
        </div>
      </aside>
    );
  }
  // workspace
  return (
    <aside className="side">
      <div className="side-head"><h2>{t('workspace')}</h2><span className="sub">⌘N</span></div>
      <div className="side-sec">
        <div className="side-label"><span>{t('customers')}</span><span className="count">{PROJECTS.length}</span></div>
        {PROJECTS.slice(0,4).map(p=>(
          <div key={p.id} className={`proj-item ${p.id===activeProject?'active':''}`} onClick={()=>setActiveProject(p.id)}>
            <span className={`proj-dot ${p.state==='live'?'live':p.state==='conn'?'conn':''}`} />
            <span>{p.name}</span>
            <span className="proj-meta">{p.env}</span>
          </div>
        ))}
      </div>
      <div className="side-sec" style={{flex:1, overflow:'auto', minHeight:0}}>
        <div className="side-label"><span>{t('conversations')}</span><span className="count">{CONVS.length}</span></div>
        {CONVS.map(c=>(
          <div key={c.id} className={`conv-item ${c.id===activeConv?'active':''}`} onClick={()=>setActiveConv(c.id)}>
            <div className="conv-title">{c.title}</div>
            <div className="conv-meta"><span>{c.date}</span>{c.tag && <span className={`chip ${c.tagColor}`}>{c.tag}</span>}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}

window.SecondarySide = SecondarySide;
window.PROJECTS = PROJECTS;
window.CONVS = CONVS;
window.METADATA = METADATA;
window.WHITELIST = WHITELIST;
window.ARTIFACTS = ARTIFACTS;
