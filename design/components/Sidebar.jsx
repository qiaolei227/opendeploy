function Sidebar({ t, activeProjectId, onSelectProject, activeConvId, onSelectConv, projects, conversations }) {
  return (
    <aside className="sidebar">
      <div className="sb-section">
        <div className="sb-section-head">
          <span>{t('customers')}</span>
          <div style={{display:'flex',gap:2}}>
            <button title={t('search')}>{Icons.search}</button>
            <button title={t('addProject')}>{Icons.plus}</button>
          </div>
        </div>
        {projects.map(p => (
          <div
            key={p.id}
            className={`project-item ${p.id === activeProjectId ? 'active' : ''} ${p.state === 'connecting' ? 'connecting' : ''}`}
            onClick={() => onSelectProject(p.id)}
          >
            <span className="pdot"/>
            <span className="pname">{p.name}</span>
            <span className="pmeta">{p.env}</span>
          </div>
        ))}
      </div>

      <div className="sb-section" style={{flex:1, overflow:'auto', minHeight:0}}>
        <div className="sb-section-head">
          <span>{t('conversations')}</span>
          <span className="count">{conversations.length}</span>
        </div>
        {conversations.map(c => (
          <div
            key={c.id}
            className={`conv-item ${c.id === activeConvId ? 'active' : ''}`}
            onClick={() => onSelectConv(c.id)}
          >
            <div className="ctitle">{c.title}</div>
            <div className="cmeta">
              <span>{c.date}</span>
              {c.tag && <span className="tag">{c.tag}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="sb-foot">
        <div className="avatar">QL</div>
        <div style={{flex:1, minWidth:0}}>
          <div className="uname">乔磊</div>
          <div className="urole">consultant · senior</div>
        </div>
        <button className="icon-btn" title={t('settings')}>{Icons.gear}</button>
      </div>
    </aside>
  );
}

window.Sidebar = Sidebar;
