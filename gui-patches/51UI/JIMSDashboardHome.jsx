import React from 'react'

// JIMS 50C: presentation and existing page navigation only.
// This component makes NO Supabase calls and creates NO new approval permissions.
const Icon=({name,size=20})=>{
  const paths={
    voucher:<><path d="M7 3h8l4 4v14H5V3h2Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/></>,
    wallet:<><rect x="3" y="6" width="18" height="15" rx="3"/><path d="M3 10h18M7 6V4h11"/><circle cx="17" cy="15" r="1"/></>,
    delegation:<><circle cx="8" cy="8" r="3"/><circle cx="18" cy="9" r="2"/><path d="M2.8 20v-2a5.2 5.2 0 0 1 10.4 0v2M15 16c2 0 4 1 4 4"/></>,
    shield:<><path d="M12 2 4 6v6c0 5 3.7 8.5 8 10 4.3-1.5 8-5 8-10V6l-8-4Z"/><path d="m9 12 2 2 4-4"/></>,
    users:<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5"/></>,
    activity:<><path d="M3 12h4l3-7 4 14 3-7h4"/></>,
    arrow:<><path d="M4 12h16m-7-7 7 7-7 7"/></>,
    chevron:<><path d="m9 6 6 6-6 6"/></>
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.activity}</svg>
}
const ActionCard=({icon,title,subtitle,onClick,tag})=>(
  <button type="button" className="jims-action-card" onClick={onClick}>
    <span className="jims-action-card-top"><span className="jims-action-icon"><Icon name={icon}/></span><Icon name="arrow" size={17}/></span>
    <strong className="jims-action-title">{title}</strong>
    <span className="jims-action-desc">{subtitle}</span>
    <span className="jims-action-tag">{tag}</span>
  </button>
)
const LinkRow=({icon,title,desc,onClick})=>(
  <button className="jims-link-row" type="button" onClick={onClick}>
    <span className="jims-link-icon"><Icon name={icon} size={19}/></span>
    <span className="jims-link-copy"><strong>{title}</strong><small>{desc}</small></span>
    <span className="jims-row-chevron"><Icon name="chevron" size={17}/></span>
  </button>
)
export default function JIMSDashboardHome({profile,stats,canManageDelegation=false,onNavigate}){
  const isAdmin=profile.role==='system_admin'
  const actions=[
    {icon:'voucher',title:'Payment Voucher',subtitle:'Drafts, submissions and approval decisions',page:'payment_voucher'},
    {icon:'wallet',title:'Payment Process',subtitle:'Initiate, verify and complete approved PV payments',page:'payment_process'},
    {icon:'wallet',title:'Cash Voucher',subtitle:'Open cash voucher records and approvals',page:'cash_voucher'},
    {icon:'delegation',title:'Delegation',subtitle:'Go to your delegation workspace',page:'delegation_workspace'},
    isAdmin
      ? {icon:'users',title:'User Management',subtitle:'Staff accounts and assignments',page:'users'}
      : canManageDelegation
        ? {icon:'shield',title:'Manage Delegation',subtitle:'Authorised delegation controls',page:'manage_delegation'}
        : {icon:'activity',title:'Finance Workspace',subtitle:'Open the financial approval area',page:'payment_voucher'}
  ]
  return <section className="jims-dashboard" aria-label="JIMS dashboard home">
    <div className="jims-dashboard-intro">
      <div><div className="jims-overline">WORKSPACE / OVERVIEW</div><h2>Overview</h2><p>Everything you need, without the clutter.</p></div>
      <div className="jims-role-pill"><span className="jims-pulse"/>{isAdmin?'System Administrator':String(profile.role||'Staff').replaceAll('_',' ')}</div>
    </div>
    {isAdmin&&stats&&<div className="jims-stats-grid">
      <div className="jims-stat"><span>Total users</span><strong>{stats.totalUsers}</strong><small>Registered staff accounts</small></div>
      <div className="jims-stat"><span>Active users</span><strong>{stats.activeUsers}</strong><small>Currently enabled accounts</small></div>
      <div className="jims-stat"><span>Disabled users</span><strong>{stats.disabledUsers}</strong><small>Access disabled</small></div>
      <div className="jims-stat jims-stat-info"><span>Access level</span><strong>View all</strong><small>No finance approval authority</small></div>
    </div>}
    <div className="jims-section-title">
      <div><h3>Action Required</h3><p>Shortcuts to live queues within each module</p></div>
      <span className="jims-section-note">QUEUES OPEN IN THEIR OWN MODULES</span>
    </div>
    <div className="jims-actions-grid">
      {actions.map((a,i)=><ActionCard key={i} icon={a.icon} title={a.title} subtitle={a.subtitle} tag={isAdmin?'VIEW WORKSPACE':'OPEN WORKSPACE'} onClick={()=>onNavigate(a.page)}/>)}
    </div>
    <div className="jims-home-columns">
      <div className="jims-home-panel">
        <div className="jims-home-panel-header"><div><span>MODULES</span><h3>Financial Workspace</h3></div><span className="jims-small-ornament"/></div>
        <LinkRow icon="voucher" title="Payment Voucher" desc="Draft, submitted and approval stages" onClick={()=>onNavigate('payment_voucher')}/>
        <LinkRow icon="wallet" title="Payment Process" desc="Pending, initiated and paid PVs" onClick={()=>onNavigate('payment_process')}/>
        <LinkRow icon="wallet" title="Cash Voucher" desc="Petty cash records and signed Excel" onClick={()=>onNavigate('cash_voucher')}/>
        <LinkRow icon="delegation" title="Delegation Workspace" desc="Delegation requests and reviews" onClick={()=>onNavigate('delegation_workspace')}/>
      </div>
      <div className="jims-home-panel">
        <div className="jims-home-panel-header"><div><span>QUICK ACCESS</span><h3>{isAdmin?'Administration':'My Workspace'}</h3></div><span className="jims-small-ornament"/></div>
        {isAdmin?<React.Fragment>
          <LinkRow icon="users" title="User Management" desc="Staff accounts, roles and organisation" onClick={()=>onNavigate('users')}/>
          <LinkRow icon="shield" title="Audit Trail" desc="Review system activity and changes" onClick={()=>onNavigate('audit')}/>
          <p className="jims-panel-footnote">System Admin can view finance modules but cannot approve requests.</p>
        </React.Fragment>:<React.Fragment>
          {canManageDelegation&&<LinkRow icon="shield" title="Manage Delegation" desc="Authorised financial delegation controls" onClick={()=>onNavigate('manage_delegation')}/>}
          <div className="jims-profile-row"><span>Department</span><strong>{profile.department||'Not Assigned'}</strong></div>
          <div className="jims-profile-row"><span>Branch</span><strong>{profile.branch||'Not Assigned'}</strong></div>
          <div className="jims-profile-row"><span>Role</span><strong>{String(profile.role||'Staff').replaceAll('_',' ')}</strong></div>
        </React.Fragment>}
      </div>
    </div>
  </section>
}
