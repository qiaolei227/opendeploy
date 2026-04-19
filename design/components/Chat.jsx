// Conversation content - the credit limit warning demo
function ChatWorkspace({ t, lang, stage, onAction }) {
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [stage]);

  return (
    <section className="main">
      <div className="chat-head">
        <div className="chat-title">
          <span className="bull"/>
          <span>{lang === 'zh' ? '销售订单信用额度预警' : 'Sales Order Credit Limit Warning'}</span>
        </div>
        <div className="tag-row">
          <span className="tag">SAL_SaleOrder</span>
          <span className="tag accent">Python插件</span>
          <span className="tag info">审核事件</span>
        </div>
        <div className="spacer"/>
        <button className="icon-btn" title="Share">{Icons.link}</button>
        <button className="icon-btn" title="History">{Icons.refresh}</button>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-inner">
          <ConversationContent t={t} lang={lang} stage={stage} />
        </div>
      </div>

      <Composer t={t} lang={lang} onAction={onAction} stage={stage}/>
    </section>
  );
}

function Turn({ who, time, children }) {
  const isUser = who === 'user';
  return (
    <div className="turn">
      <div className="turn-head">
        <div className={`turn-avatar ${isUser ? 'user' : 'ai'}`}>{isUser ? '乔' : 'AI'}</div>
        <span className="turn-name">{isUser ? '乔磊' : 'OpenDeploy'}</span>
        <span className="turn-time">{time}</span>
      </div>
      <div className="turn-body">{children}</div>
    </div>
  );
}

function ToolBlock({ name, args, status, children, icon }) {
  return (
    <div className="tool-block">
      <div className="tool-head">
        <span className="ticon">{icon || Icons.zap}</span>
        <span className="tname">{name}</span>
        <span className="targs">{args}</span>
        <span className={`tstatus ${status}`}>
          {status === 'running' && 'running…'}
          {status === 'ok' && <><span style={{color:'var(--accent)'}}>✓</span> completed</>}
        </span>
      </div>
      {children && <div className="tool-body">{children}</div>}
    </div>
  );
}

function ConversationContent({ t, lang, stage }) {
  const zh = lang === 'zh';
  return (
    <>
      <Turn who="user" time="14:32:08">
        <p>{zh
          ? <>客户"川沙诚信商贸"那边要求：<strong>销售订单审核时，如果客户应收账款超过 50 万，要红色警告并阻止审核</strong>。超限时需要财务经理在后台放行，才能继续走审批。</>
          : <>Client "Chuansha Chengxin" wants: <strong>on sales order approval, if customer A/R exceeds ¥500k, show a red warning and block the approval</strong>. Override requires finance manager.</>
        }</p>
      </Turn>

      <Turn who="ai" time="14:32:11">
        <p>{zh
          ? <>明白了。在生成代码前，有 <strong>3 个关键细节</strong> 需要你先确认 — 这些会决定插件的核心逻辑，后续返工成本较高：</>
          : <>Got it. Before I generate code, <strong>3 details</strong> to confirm — they shape the plugin's core logic:</>
        }</p>

        <div className="clarify">
          <h4>{zh ? '澄清 1 / 3：应收账款的口径' : 'Clarification 1/3: A/R Scope'}</h4>
          <div className="q">{zh ? '应收账款怎么计算？' : 'How is A/R calculated?'}</div>
          <div className="opts">
            <button className="clar-opt selected">
              <span className="klabel">A</span>
              <div>
                <div>{zh ? '当前期末余额（推荐）' : 'Current period-end balance (recommended)'}</div>
                <div className="cdesc">{zh ? '从 T_AR_Receivable.FAmount 聚合，统计所有未核销金额' : 'Aggregate T_AR_Receivable.FAmount of unsettled items'}</div>
              </div>
            </button>
            <button className="clar-opt">
              <span className="klabel">B</span>
              <div>
                <div>{zh ? '近 3 个月滚动余额' : 'Rolling 3-month balance'}</div>
                <div className="cdesc">{zh ? '按 FCreateDate 过滤，排除已核销' : 'Filter by FCreateDate, exclude settled'}</div>
              </div>
            </button>
            <button className="clar-opt">
              <span className="klabel">C</span>
              <div>
                <div>{zh ? '含在途订单（未发货未收款的销售订单）' : 'Include in-transit orders'}</div>
              </div>
            </button>
          </div>
        </div>

        <div className="clarify">
          <h4>{zh ? '澄清 2 / 3：限额是否分级' : 'Clarification 2/3: Limit Tiers'}</h4>
          <div className="q">{zh ? '50 万是所有客户统一，还是按客户分级？' : '¥500k flat, or tiered by customer?'}</div>
          <div className="opts">
            <button className="clar-opt selected">
              <span className="klabel">A</span>
              <div>
                <div>{zh ? '按客户档案上的自定义字段 FCreditLimit 取值（推荐）' : 'Read from customer field F_JN_CreditLimit (recommended)'}</div>
                <div className="cdesc">{zh ? '你们 BOS 已经有这个字段，我已检测到' : 'Detected this custom field in your BOS metadata'}</div>
              </div>
            </button>
            <button className="clar-opt">
              <span className="klabel">B</span>
              <div>
                <div>{zh ? '硬编码 500000' : 'Hardcode 500000'}</div>
              </div>
            </button>
          </div>
        </div>

        <div className="clarify">
          <h4>{zh ? '澄清 3 / 3：放行机制' : 'Clarification 3/3: Override'}</h4>
          <div className="q">{zh ? '超限时是仅提示还是需人工放行？' : 'Override flow when exceeded?'}</div>
          <div className="opts">
            <button className="clar-opt">
              <span className="klabel">A</span>
              <div>{zh ? '硬阻断，必须线下处理' : 'Hard block, handle offline'}</div>
            </button>
            <button className="clar-opt selected">
              <span className="klabel">B</span>
              <div>
                <div>{zh ? '弹出审批流到财务经理（推荐）' : 'Escalate to finance manager approval (recommended)'}</div>
                <div className="cdesc">{zh ? '用 BOS 工作流引擎节点分支' : 'Use BOS workflow engine branch'}</div>
              </div>
            </button>
          </div>
        </div>

        <p style={{color:'var(--fg-muted)', fontSize:12.5}}>
          {zh ? '默认选项已勾选，直接回车继续即可。' : 'Defaults selected — press Enter to continue.'}
        </p>
      </Turn>

      {stage >= 1 && (
        <Turn who="user" time="14:33:02">
          <p>{zh ? '全部按推荐方案，走 A / A / B。' : 'Go with recommended: A / A / B.'}</p>
        </Turn>
      )}

      {stage >= 1 && (
        <Turn who="ai" time="14:33:04">
          <p>{zh ? <>好。开始为你准备上下文 — 先读取客户 BOS 的元数据，确认 <code>SAL_SaleOrder</code>、<code>BD_Customer</code> 和应收相关对象的当前结构：</>
                 : <>Good. Preparing context — reading metadata for <code>SAL_SaleOrder</code>, <code>BD_Customer</code>, and A/R objects:</>}</p>

          <ToolBlock name="read_bos_metadata" args="object=SAL_SaleOrder,BD_Customer" status="ok" icon={Icons.database}>
            <div className="kv"><span className="k">endpoint</span><span className="v">erp.sundry.cn:8081/K3Cloud/metadata</span></div>
            <div className="kv"><span className="k">objects</span><span className="v">2 resolved · 184 fields · 12 events</span></div>
            <div className="kv"><span className="k">custom</span><span className="v">F_JN_CreditLimit (amount, on BD_Customer) ✓ detected</span></div>
            <div className="kv"><span className="k">cache</span><span className="v">projects/川沙诚信商贸/metadata.json</span></div>
          </ToolBlock>

          <ToolBlock name="search_knowledge" args="q=&quot;销售订单审核事件 Python 插件&quot;" status="ok" icon={Icons.book}>
            <div className="kv"><span className="k">source</span><span className="v">opendeploy-knowledge @ commit 4a7f1b2</span></div>
            <div className="kv"><span className="k">hits</span><span className="v">3 structured entries · 2 RAG chunks</span></div>
            <details>
              <summary>{zh ? '展开引用源 (5)' : 'Show citations (5)'}</summary>
              <div style={{paddingTop:4}}>
                <div>§ SAL_SaleOrder.事件.OnBeforeExecuteOperationTransaction</div>
                <div>§ plugin-templates/python/sales-order-validate.py</div>
                <div>§ api-specs/business-object-operation.json</div>
                <div>§ skills/sales/信用额度控制.md</div>
                <div>§ skills/ar/应收余额计算.md</div>
              </div>
            </details>
          </ToolBlock>

          <ToolBlock name="query_ar_balance_method" args="object=AR_Receivable" status="ok" icon={Icons.shield}>
            <div className="kv"><span className="k">whitelist</span><span className="v" style={{color:'var(--accent)'}}>T_META_OBJECTTYPE ✓ allowed (metadata only)</span></div>
            <div className="kv"><span className="k">blocked</span><span className="v" style={{color:'var(--danger)'}}>T_AR_Receivable ✗ business data — read by plugin at runtime</span></div>
          </ToolBlock>

          <p>{zh ? <>元数据到位，路径已确定：写一个 <strong>Python 操作插件</strong> 挂到 <code>SAL_SaleOrder</code> 的 <code>BeforeExecuteOperationTransaction</code>，操作码 <code>Audit</code>。插件内部再通过 BOS ORM 读应收余额 — 业务数据只在客户 ERP 内部流转，OpenDeploy 永不持有。<span className="cite">Skills/sales</span></>
                : <>Metadata loaded. Plan: a <strong>Python operation plugin</strong> on <code>SAL_SaleOrder.BeforeExecuteOperationTransaction</code>, operation <code>Audit</code>. Plugin reads A/R via BOS ORM inside the customer's ERP — OpenDeploy never holds business data. <span className="cite">Skills/sales</span></>}</p>
        </Turn>
      )}

      {stage >= 2 && (
        <Turn who="ai" time="14:33:21">
          <p>{zh ? '代码已生成。下面是可以直接贴到 BOS 的 Python 操作插件：' : 'Code generated — paste directly into BOS:'}</p>
          <CodeBlock lang="zh"/>
          <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:10}}>
            <button className="comp-chip on" style={{fontSize:12, padding:'5px 10px'}}>{Icons.check} {zh ? '通过静态检查' : 'Static checks passed'}</button>
            <button className="comp-chip on" style={{fontSize:12, padding:'5px 10px'}}>{Icons.shield} {zh ? '无业务表硬引用' : 'No hardcoded business tables'}</button>
            <button className="comp-chip" style={{fontSize:12, padding:'5px 10px'}}>{Icons.book} {zh ? '查看部署指引' : 'Deployment guide'}</button>
          </div>
          <p style={{marginTop:14}}>{zh ? <>建议下一步：在 BOS 中打开 <code>销售订单 → 业务对象管理 → 操作 → 审核</code>，粘贴上面的 Python 脚本，保存后在演示环境跑一遍你们常见的"王总那笔 68 万的订单"验证阈值触发效果。要我把部署步骤展开吗？</>
                 : <>Next: open BOS → SaleOrder → Operations → Audit, paste the Python above, and test with a typical case. Want me to expand deployment steps?</>}</p>
        </Turn>
      )}
    </>
  );
}

function CodeBlock({ lang }) {
  const zh = lang === 'zh';
  return (
    <div className="code-block">
      <div className="code-head">
        <span className="lang">python</span>
        <span className="filename">plugins/sale_order_credit_check.py</span>
        <span className="spacer"/>
        <button className="cbtn">{Icons.copy} {zh ? '复制' : 'Copy'}</button>
        <button className="cbtn">{zh ? '保存到项目' : 'Save'}</button>
        <button className="cbtn primary">{Icons.zap} {zh ? '部署到 BOS' : 'Deploy'}</button>
      </div>
      <div className="code-body">
<pre dangerouslySetInnerHTML={{__html: `<span class="cm"># -*- coding: utf-8 -*-</span>
<span class="cm"># SaleOrder credit-limit guard · 川沙诚信商贸 · V9.1</span>
<span class="cm"># Generated by OpenDeploy · 2026-04-19 14:33</span>

<span class="kw">import</span> <span class="nb">clr</span>
<span class="nb">clr</span>.AddReference(<span class="st">'Kingdee.BOS'</span>)
<span class="nb">clr</span>.AddReference(<span class="st">'Kingdee.BOS.Core'</span>)
<span class="kw">from</span> <span class="nb">Kingdee.BOS.Core.DynamicForm.PlugIn</span> <span class="kw">import</span> AbstractOperationServicePlugIn
<span class="kw">from</span> <span class="nb">Kingdee.BOS.Orm.DataEntity</span>   <span class="kw">import</span> DynamicObject

THRESHOLD_FALLBACK = <span class="nm">500000</span>      <span class="cm"># fallback only; real value from F_JN_CreditLimit</span>

<span class="kw">class</span> <span class="fn">CreditLimitGuard</span>(AbstractOperationServicePlugIn):
    <span class="kw">def</span> <span class="fn">OnPreparePropertys</span>(<span class="nb">self</span>, e):
        e.FieldKeys.Add(<span class="st">"FCustomerId"</span>)
        e.FieldKeys.Add(<span class="st">"FBillTypeId"</span>)

    <span class="kw">def</span> <span class="fn">BeforeExecuteOperationTransaction</span>(<span class="nb">self</span>, e):
        <span class="kw">for</span> row <span class="kw">in</span> e.SelectedRows:
            obj = row.DataEntity
            cust = obj[<span class="st">"CustomerId"</span>]
            <span class="kw">if</span> <span class="nb">not</span> cust: <span class="kw">continue</span>

            limit = <span class="nb">self</span>._limit_of(cust) <span class="kw">or</span> THRESHOLD_FALLBACK
            ar    = <span class="nb">self</span>._ar_balance(cust[<span class="st">"Id"</span>])

            <span class="kw">if</span> ar &gt; limit:
                e.Cancel = <span class="nb">True</span>
                <span class="nb">self</span>.View.ShowErrMessage(
                    <span class="st">f"客户【{cust['Name']}】应收余额 {ar:,.2f} 已超出信用额度 {limit:,.2f}，"</span>
                    <span class="st">f"请财务经理在审批中心放行。"</span>
                )
                <span class="nb">self</span>._raise_to_finance(obj, cust, ar, limit)

    <span class="kw">def</span> <span class="fn">_limit_of</span>(<span class="nb">self</span>, cust):
        <span class="kw">return</span> cust[<span class="st">"F_JN_CreditLimit"</span>]   <span class="cm"># custom field detected in metadata</span>

    <span class="kw">def</span> <span class="fn">_ar_balance</span>(<span class="nb">self</span>, cust_id):
        sql = <span class="st">"SELECT ISNULL(SUM(FAmount),0) FROM T_AR_Receivable "</span> \\
              <span class="st">"WHERE FCustomerId=? AND FIsSettled='0'"</span>
        <span class="kw">return</span> <span class="nb">self</span>.Context.DBService.ExecuteScalar(sql, cust_id) <span class="kw">or</span> <span class="nm">0</span></pre>`}}/>
      </div>
    </div>
  );
}

function Composer({ t, lang, onAction, stage }) {
  const [value, setValue] = React.useState('');
  const zh = lang === 'zh';
  const placeholder = stage === 0
    ? (zh ? '回车确认推荐选项，或继续输入补充要求…' : 'Press Enter to accept recommended, or type to refine…')
    : (zh ? '追问代码、要求修改、或开启新任务…' : 'Refine the code, ask for changes, or start a new task…');

  const submit = () => { onAction('advance'); setValue(''); };
  const onKey = (e) => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); submit(); } };

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="composer-box">
          <textarea
            placeholder={placeholder}
            value={value}
            onChange={e=>setValue(e.target.value)}
            onKeyDown={onKey}
            rows={2}
          />
          <div className="composer-tools">
            <button className="comp-chip on">{Icons.database} SAL_SaleOrder</button>
            <button className="comp-chip on">{Icons.book} {zh ? '销售 Skills' : 'Sales skills'}</button>
            <button className="comp-chip">{Icons.attach} {zh ? '附加元数据' : 'Attach metadata'}</button>
            <span className="spacer"/>
            <button className="comp-chip">{zh ? 'DeepSeek V4' : 'DeepSeek V4'} {Icons.down}</button>
            <button className="send-btn" onClick={submit}>
              {stage === 0 ? (zh ? '继续' : 'Continue') : (zh ? '发送' : 'Send')} {Icons.send}
            </button>
          </div>
        </div>
        <div className="composer-hint">
          <span><span className="kbd">⌘K</span> {zh ? '命令面板' : 'Command palette'} · <span className="kbd">⌘/</span> {zh ? '切换知识' : 'Toggle skills'}</span>
          <span>{zh ? '流式模式 · 自动审计日志' : 'streaming · audit on'}</span>
        </div>
      </div>
    </div>
  );
}

window.ChatWorkspace = ChatWorkspace;
