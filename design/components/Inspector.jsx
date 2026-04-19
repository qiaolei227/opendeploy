function Inspector({ t, tab, onTab, metadata, whitelist, artifacts, connection }) {
  return (
    <aside className="inspector">
      <div className="insp-tabs">
        <button className={`insp-tab ${tab==='metadata'?'active':''}`} onClick={()=>onTab('metadata')}>
          {Icons.database} {t('metadata')}
        </button>
        <button className={`insp-tab ${tab==='security'?'active':''}`} onClick={()=>onTab('security')}>
          {Icons.shield} {t('security')} <span className="badge">{whitelist.filter(w=>w.type==='block').length}</span>
        </button>
        <button className={`insp-tab ${tab==='artifacts'?'active':''}`} onClick={()=>onTab('artifacts')}>
          {Icons.file} {t('artifacts')} <span className="badge">{artifacts.length}</span>
        </button>
      </div>

      <div className="insp-body">
        {tab === 'metadata' && <MetadataPanel t={t} connection={connection} metadata={metadata} />}
        {tab === 'security' && <SecurityPanel t={t} whitelist={whitelist} />}
        {tab === 'artifacts' && <ArtifactsPanel t={t} artifacts={artifacts} />}
      </div>
    </aside>
  );
}

function MetadataPanel({ t, connection, metadata }) {
  const [expanded, setExpanded] = React.useState({ 'SAL_SaleOrder': true, 'SAL_SaleOrder.FEntity': true });
  const toggle = (k) => setExpanded(e => ({...e, [k]: !e[k]}));

  return (
    <>
      <div className="panel-title">
        <h3>{t('connection')}</h3>
        <span className="conn-badge ok">CONNECTED</span>
      </div>
      <div className="conn-card">
        <div className="conn-row"><span className="k">server</span><span className="v">erp.sundry.cn:8081</span></div>
        <div className="conn-row"><span className="k">database</span><span className="v">AIS20240311</span></div>
        <div className="conn-row"><span className="k">version</span><span className="v">V9.1.0.2</span></div>
        <div className="conn-row"><span className="k">mode</span><span className="v" style={{color:'var(--accent)'}}>metadata-readonly</span></div>
        <div className="conn-row"><span className="k">last sync</span><span className="v">2m ago</span></div>
      </div>

      <div className="panel-title">
        <h3>{t('businessObjects')}</h3>
        <span className="right">{metadata.length} objects</span>
      </div>
      <div className="meta-tree">
        {metadata.map(obj => (
          <div key={obj.key} className="meta-node accessible">
            <div className="row" onClick={()=>toggle(obj.key)}>
              <span className="caret">{expanded[obj.key] ? '▾' : '▸'}</span>
              <span className="mtype">obj</span>
              <span className="mname">{obj.key}</span>
              <span style={{marginLeft:'auto', color:'var(--fg-dim)', fontSize:'10.5px'}}>{obj.label}</span>
            </div>
            {expanded[obj.key] && obj.fields && (
              <div style={{paddingLeft:18}}>
                {obj.fields.map(f => (
                  <div key={f.key} className={`meta-node ${f.blocked ? 'blocked' : 'accessible'}`}>
                    <div className="row">
                      <span className="caret"> </span>
                      <span className="mtype">{f.type}</span>
                      <span className={f.custom ? 'mcustom' : 'mname'}>{f.key}</span>
                      {f.primary && <span className="mkey">pk</span>}
                      {f.custom && <span style={{color:'var(--warn)', fontSize:'10px'}}>custom</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function SecurityPanel({ t, whitelist }) {
  return (
    <>
      <div className="panel-title">
        <h3>{t('dbWhitelist')}</h3>
        <span className="right">hardcoded</span>
      </div>
      <div style={{padding:'10px 12px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:6, fontSize:11.5, color:'var(--fg-muted)', marginBottom:14, lineHeight:1.5}}>
        {t('whitelistHelp')}
      </div>

      <div className="panel-title" style={{marginTop:8}}>
        <h3>{t('recentAccess')}</h3>
        <span className="right">session</span>
      </div>
      <div className="wl-list">
        {whitelist.map((w, i) => (
          <div key={i} className={`wl-item ${w.type}`}>
            <span className="t">{w.time}</span>
            <span className="tbl">{w.table}</span>
            <span className="v">{w.type === 'allow' ? 'ALLOW' : 'BLOCK'}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function ArtifactsPanel({ t, artifacts }) {
  return (
    <>
      <div className="panel-title">
        <h3>{t('generatedFiles')}</h3>
        <span className="right">projects/川沙诚信商贸/generated</span>
      </div>
      {artifacts.map((a, i) => (
        <div className="art-item" key={i}>
          <div className="aicon">{a.ext}</div>
          <div style={{flex:1, minWidth:0}}>
            <div className="atitle">{a.name}</div>
            <div className="ameta">
              <span>{a.size}</span>
              <span>·</span>
              <span>{a.when}</span>
            </div>
            <span className={`astatus ${a.status}`}>{a.status}</span>
          </div>
        </div>
      ))}
      <div style={{marginTop:16, padding:'10px 12px', background:'var(--surface)', border:'1px dashed var(--border)', borderRadius:6, fontSize:11.5, color:'var(--fg-muted)', textAlign:'center'}}>
        {t('artifactsHint')}
      </div>
    </>
  );
}

window.Inspector = Inspector;
