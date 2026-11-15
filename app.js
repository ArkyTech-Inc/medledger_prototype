const CONFIG = window.MEDLEDGER_CONFIG || {};
const app = document.getElementById('app');
const state = {
  view: 'dashboard',
  demo: true,
  session: null,
  user: null,
  facility: { id: 'demo-facility', name: 'Harmony Primary Health Centre', notification_email: '' },
  member: { role: 'facility_admin', full_name: 'Demo Administrator' },
  patients: [], encounters: [], referrals: [], followups: [],
  selectedPatientId: null,
  careTab: 'encounters',
  query: '',
  modal: null,
  busy: false
};

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
let idleTimer = null;
let adminGatePassed = false;
function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}
function resetIdleTimer() {
  clearIdleTimer();
  if (!state.demo && state.session) {
    idleTimer = setTimeout(() => {
      toast('Your session was signed out after 15 minutes of inactivity.', 'error');
      signOut();
    }, IDLE_TIMEOUT_MS);
  }
}
function clearLiveSession() {
  clearIdleTimer();
  state.session = null;
  state.user = null;
  state.patients = [];
  state.encounters = [];
  state.referrals = [];
  state.followups = [];
  state.demo = false;
  state.view = 'dashboard';
  state.selectedPatientId = null;
  adminGatePassed = false;
  renderAdminGate();
}

const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M17 3.13a4 4 0 0 1 0 7.75"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9L6.1 12l1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 1.9Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'
};
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.info}</svg>`;
const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = (a = '', b = '') => `${a.trim().charAt(0)}${b.trim().charAt(0)}`.toUpperCase() || 'ML';
const fullName = (p) => `${p.first_name || ''} ${p.last_name || ''}`.trim();
const fmtDate = (value) => value ? new Date(value).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}) : 'Not recorded';
const fmtTime = (value) => value ? new Date(value).toLocaleString('en-GB', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
const relativeTime = (value) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr ago`;
  return `${Math.round(minutes / 1440)} day(s) ago`;
};
const badge = (value) => `<span class="status ${esc(String(value || '').toLowerCase().replaceAll(' ','-'))}">${esc(value || 'pending')}</span>`;
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

function seedDemoData() {
  const now = Date.now();
  state.patients = [
    {id:'demo-p1', mrn:'ML-2026-0018', first_name:'Amina', last_name:'Yusuf', date_of_birth:'1998-04-12', sex:'Female', phone:'0803 555 0142', address:'Garki, Abuja', record_status:'active', created_at:new Date(now-86400000*2).toISOString()},
    {id:'demo-p2', mrn:'ML-2026-0017', first_name:'Daniel', last_name:'Okafor', date_of_birth:'1985-11-23', sex:'Male', phone:'0806 555 0187', address:'Kubwa, Abuja', record_status:'active', created_at:new Date(now-86400000*3).toISOString()},
    {id:'demo-p3', mrn:'ML-2026-0016', first_name:'Zainab', last_name:'Bello', date_of_birth:'2002-06-05', sex:'Female', phone:'0703 555 0135', address:'Wuse, Abuja', record_status:'active', created_at:new Date(now-86400000*5).toISOString()},
    {id:'demo-p4', mrn:'ML-2026-0015', first_name:'Peter', last_name:'Eze', date_of_birth:'1974-02-18', sex:'Male', phone:'0812 555 0168', address:'Nyanya, Abuja', record_status:'active', created_at:new Date(now-86400000*7).toISOString()},
    {id:'demo-p5', mrn:'ML-2026-0014', first_name:'Hauwa', last_name:'Abubakar', date_of_birth:'1991-09-30', sex:'Female', phone:'0809 555 0111', address:'Jikwoyi, Abuja', record_status:'active', created_at:new Date(now-86400000*9).toISOString()}
  ];
  state.encounters = [
    {id:'demo-e1', patient_id:'demo-p1', facility_id:state.facility.id, encounter_date:new Date(now-3600000*2).toISOString(), visit_type:'Follow-up', chief_complaint:'Routine review', assessment:'Review completed', plan:'Continue routine follow-up', created_by:'demo'},
    {id:'demo-e2', patient_id:'demo-p2', facility_id:state.facility.id, encounter_date:new Date(now-3600000*7).toISOString(), visit_type:'Walk-in', chief_complaint:'General consultation', assessment:'Initial assessment recorded', plan:'Review in one week', created_by:'demo'},
    {id:'demo-e3', patient_id:'demo-p3', facility_id:state.facility.id, encounter_date:new Date(now-86400000).toISOString(), visit_type:'Walk-in', chief_complaint:'Routine consultation', assessment:'Assessment documented', plan:'Routine care', created_by:'demo'}
  ];
  state.referrals = [
    {id:'demo-r1', patient_id:'demo-p2', facility_id:state.facility.id, destination_name:'Maitama District Hospital', reason:'Further clinical assessment', urgency:'routine', referral_status:'pending', created_at:new Date(now-3600000*6).toISOString()},
    {id:'demo-r2', patient_id:'demo-p4', facility_id:state.facility.id, destination_name:'National Hospital Abuja', reason:'Specialist review', urgency:'urgent', referral_status:'in-progress', created_at:new Date(now-86400000).toISOString()}
  ];
  state.followups = [
    {id:'demo-f1', patient_id:'demo-p1', facility_id:state.facility.id, due_date:todayISO(), followup_status:'pending', outcome:'', created_at:new Date(now-86400000).toISOString()},
    {id:'demo-f2', patient_id:'demo-p3', facility_id:state.facility.id, due_date:new Date(now+86400000*2).toISOString().slice(0,10), followup_status:'scheduled', outcome:'', created_at:new Date(now-3600000*9).toISOString()},
    {id:'demo-f3', patient_id:'demo-p5', facility_id:state.facility.id, due_date:new Date(now-86400000*2).toISOString().slice(0,10), followup_status:'completed', outcome:'Patient attended review', created_at:new Date(now-86400000*4).toISOString()}
  ];
}

function toast(message, type = '') {
  let stack = document.querySelector('.toast-stack');
  if (!stack) { stack = document.createElement('div'); stack.className = 'toast-stack'; document.body.appendChild(stack); }
  const item = document.createElement('div'); item.className = `toast ${type}`; item.textContent = message; stack.appendChild(item);
  setTimeout(() => item.remove(), 3400);
}

function isConfigured() { return Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY); }
function canDocumentClinicalCare() { return state.demo || ['facility_admin','clinician'].includes(state.member?.role); }
function canManagePatientDemographics() { return state.demo || ['facility_admin','clinician','records_officer'].includes(state.member?.role); }
function supaHeaders(extra = {}) {
  return { apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${state.session?.access_token || CONFIG.SUPABASE_PUBLISHABLE_KEY}`, ...extra };
}
async function refreshAuthSession() {
  const refreshToken = state.session?.refresh_token;
  if (!refreshToken) return false;
  const response = await fetch(`${CONFIG.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!response.ok) { clearLiveSession(); return false; }
  state.session = await response.json(); state.user = state.session.user;
  return true;
}
async function supa(path, options = {}) {
  if (!isConfigured()) throw new Error('Supabase has not been configured yet.');
  const url = `${CONFIG.SUPABASE_URL.replace(/\/$/, '')}${path}`;
  const request = () => fetch(url, {
    cache: 'no-store',
    ...options,
    headers: supaHeaders({ ...(options.body ? {'Content-Type':'application/json','Prefer':'return=representation'} : {}), ...(options.headers || {}) })
  });
  let response = await request();
  if (response.status === 401 && state.session?.refresh_token && await refreshAuthSession()) response = await request();
  const text = await response.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || data?.msg || data?.error_description || `Request failed (${response.status})`);
  return data;
}
async function signIn(email, password) {
  const response = await fetch(`${CONFIG.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
    method:'POST', cache:'no-store', headers:{ apikey:CONFIG.SUPABASE_PUBLISHABLE_KEY, 'Content-Type':'application/json' }, body:JSON.stringify({email,password})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.msg || data.message || 'Sign-in failed. Check your email and password.');
  state.session = data; state.user = data.user;
  // Auth tokens intentionally remain in memory only. Refreshing the tab requires signing in again.
  const memberships = await supa(`/rest/v1/facility_members?select=facility_id,role,full_name&user_id=eq.${encodeURIComponent(data.user.id)}&is_active=eq.true&limit=2`);
  if (!memberships?.length) { state.session = null; state.user = null; throw new Error('This account is not assigned to an active MedLedger facility. Ask your facility administrator.'); }
  if (memberships.length > 1) { state.session = null; state.user = null; throw new Error('This pilot currently supports one facility per staff account. Ask your administrator to use a facility-specific account.'); }
  state.member = memberships[0];
  const facilities = await supa(`/rest/v1/facilities?select=id,name,notification_email&id=eq.${encodeURIComponent(state.member.facility_id)}&limit=1`);
  if (!facilities?.length) throw new Error('Your facility record could not be loaded.');
  state.facility = facilities[0];
  state.demo = false;
  adminGatePassed = true;
  await loadRealData();
  state.view = 'dashboard';
  render();
  resetIdleTimer();
}
async function loadRealData() {
  const f = encodeURIComponent(state.facility.id);
  const patientRequest = supa(`/rest/v1/patients?select=id,mrn,first_name,last_name,date_of_birth,sex,phone,address,record_status,created_at&facility_id=eq.${f}&record_status=eq.active&order=created_at.desc&limit=100`);
  if (!canDocumentClinicalCare()) {
    state.patients = await patientRequest;
    state.encounters = []; state.referrals = []; state.followups = [];
    return;
  }
  const [patients, encounters, referrals, followups] = await Promise.all([
    patientRequest,
    supa(`/rest/v1/encounters?select=id,patient_id,facility_id,encounter_date,visit_type,chief_complaint,assessment,plan,created_by&facility_id=eq.${f}&order=encounter_date.desc&limit=100`),
    supa(`/rest/v1/referrals?select=id,patient_id,facility_id,destination_name,reason,urgency,referral_status,created_at&facility_id=eq.${f}&order=created_at.desc&limit=100`),
    supa(`/rest/v1/follow_ups?select=id,patient_id,facility_id,due_date,followup_status,outcome,created_at&facility_id=eq.${f}&order=due_date.asc&limit=100`)
  ]);
  state.patients = patients || []; state.encounters = encounters || []; state.referrals = referrals || []; state.followups = followups || [];
}
async function sendClinicalAlert(eventType, recordId) {
  if (state.demo || !isConfigured()) return;
  try {
    await supa('/functions/v1/send-clinical-alert', { method:'POST', body:JSON.stringify({event_type:eventType, facility_id:state.facility.id, record_id:recordId}) });
  } catch (error) {
    console.warn('Clinical alert was not sent:', error.message);
    toast('Record saved. Email alert could not be sent.', 'error');
  }
}

const navItems = [
  {id:'dashboard', label:'Worklist', icon:'grid'},
  {id:'patients', label:'Patients', icon:'users'},
  {id:'care', label:'Care records', icon:'file'},
  {id:'sync', label:'Offline & sync', icon:'refresh'},
  {id:'settings', label:'Settings', icon:'settings'}
];
function visibleNavItems() {
  return canDocumentClinicalCare() ? navItems : navItems.filter((item) => item.id !== 'care');
}
function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <aside class="login-aside">
        <div class="brand"><img class="brand-logo" src="/assets/medledger-logo.svg" alt="" /><div><div class="brand-name">MedLedger</div><span class="brand-tag">Care, connected</span></div></div>
        <div class="login-copy">
          <p class="eyebrow login-eyebrow">A clearer view of care</p>
          <h1>Better records.<br>More connected care.</h1>
          <p>One practical workspace for patient records, clinical encounters, referrals and follow-up — designed for the realities of primary healthcare.</p>
          <div class="login-points">
            <div class="login-point"><span class="point-check">✓</span> Organised patient information</div>
            <div class="login-point"><span class="point-check">✓</span> More visible referral pathways</div>
            <div class="login-point"><span class="point-check">✓</span> Follow-up that is easier to track</div>
          </div>
        </div>
        <div class="login-bottom">MedLedger · Digital health coordination</div>
      </aside>
      <main class="login-panel"><div class="login-form-wrap">
        <div class="mobile-brand"><img class="brand-logo" src="/assets/medledger-logo.svg" alt="" /> MedLedger</div>
        <p class="eyebrow login-eyebrow login-eyebrow-offset">Secure workspace</p>
        <h2>Welcome back</h2><p>Sign in with your facility account to continue.</p>
        ${isConfigured() ? `
          <form id="login-form">
            <div class="form-field"><label for="login-email">Work email</label><input id="login-email" name="email" type="email" autocomplete="username" placeholder="name@facility.org" required /></div>
            <div class="form-field"><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required /></div>
            <button class="btn btn-primary" type="submit" id="login-submit">Sign in ${icon('arrow')}</button>
          </form>
        ` : `<div class="access-card"><strong>Live facility access is not connected yet</strong><p>Connect your Supabase project in <code>config.js</code> and apply the supplied database migration to enable sign-in.</p></div>`}
          <button class="btn btn-secondary construction-back" id="construction-back">Back to MedLedger</button>
          <div class="login-note">Facility sign-in is required for live records. Do not enter real patient information in an unapproved environment.</div>
      </div></main>
    </div>`;
  document.getElementById('construction-back')?.addEventListener('click', renderAdminGate);
  document.getElementById('login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const button = document.getElementById('login-submit'); button.disabled = true; button.textContent = 'Signing in…';
    try { const form = new FormData(event.currentTarget); await signIn(form.get('email'), form.get('password')); toast('Signed in successfully.'); }
    catch (error) { state.session = null; state.user = null; state.patients = []; state.encounters = []; state.referrals = []; state.followups = []; state.demo = false; toast(error.message, 'error'); button.disabled = false; button.innerHTML = `Sign in ${icon('arrow')}`; }
  });
}

function renderAdminGate() {
  app.innerHTML = `
    <main class="login-wrap construction-wrap">
      <aside class="login-aside construction-aside">
        <img class="construction-logo" src="/logo2.png" alt="MedLedger" />
        <div class="login-copy construction-copy">
          <p class="eyebrow login-eyebrow">Under construction</p>
          <h1>Medledger is under construction at the moment, we will be back soon.</h1>
          <p>Thanks for your patience while we get things ready.</p>
        </div>
        <div class="login-bottom">MedLedger · Care, connected</div>
      </aside>
      <section class="login-panel construction-panel" aria-labelledby="admin-gate-title">
        <div class="login-form-wrap">
          <img class="construction-mobile-logo" src="/logo2.png" alt="MedLedger" />
          <p class="eyebrow login-eyebrow login-eyebrow-offset">Administrator access</p>
          <h2 id="admin-gate-title">Enter as admin</h2>
          <p>Enter your access details to preview the workspace.</p>
          <form id="admin-gate-form">
            <div class="form-field"><label for="admin-username">Username</label><input id="admin-username" name="username" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" required /></div>
            <div class="form-field"><label for="admin-password">Password</label><input id="admin-password" name="password" type="password" autocomplete="off" required /></div>
            <p class="admin-gate-error" id="admin-gate-error" role="alert" hidden>That username or password wasn’t recognised. Please try again.</p>
            <button class="btn btn-primary" type="submit">Enter workspace ${icon('arrow')}</button>
          </form>
          <div class="login-note">Temporary prototype gate only — demo records are fictional. This does not secure live patient data.</div>
          <button class="btn btn-secondary construction-staff-link" id="staff-sign-in" type="button">Facility staff? Sign in with your account</button>
        </div>
      </section>
    </main>`;

  document.getElementById('admin-gate-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const errorMessage = document.getElementById('admin-gate-error');
    button.disabled = true;
    button.textContent = 'Checking access…';
    errorMessage.hidden = true;

    (async () => {
      try {
        const response = await fetch('/.netlify/functions/admin-gate', {
          method: 'POST',
          cache: 'no-store',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.authenticated !== true) {
          throw new Error(result?.error || 'Access could not be verified. Please try again.');
        }

        adminGatePassed = true;
        state.demo = true;
        state.session = null;
        state.user = null;
        state.facility = {id:'demo-facility',name:'Harmony Primary Health Centre',notification_email:''};
        state.member = {role:'facility_admin',full_name:'Demo Administrator'};
        state.view = 'dashboard';
        seedDemoData();
        render();
      } catch (error) {
        errorMessage.textContent = error.message || 'Access could not be verified. Please try again.';
        errorMessage.hidden = false;
        document.getElementById('admin-password').value = '';
        document.getElementById('admin-password').focus();
        button.disabled = false;
        button.innerHTML = `Enter workspace ${icon('arrow')}`;
      }
    })();
  });
  document.getElementById('staff-sign-in')?.addEventListener('click', renderLogin);
}

function renderSidebar() {
  return `<aside class="sidebar">
    <div class="brand"><img class="brand-logo" src="/assets/medledger-logo.svg" alt="" /><div><div class="brand-name">MedLedger</div><span class="brand-tag">Care, connected</span></div></div>
    <div class="nav-label">Workspace</div>
    <nav class="nav-list">${visibleNavItems().map(item => `<button class="nav-item ${state.view===item.id?'active':''}" data-view="${item.id}">${icon(item.icon)}<span>${item.label}</span></button>`).join('')}</nav>
    <div class="nav-spacer"></div>
    <div class="side-foot">
      <div class="facility-mini"><div class="facility-avatar">${esc(initials(state.facility.name.split(' ')[0],state.facility.name.split(' ')[1]||''))}</div><div><strong>${esc(state.facility.name)}</strong><span>${esc(state.member.role.replaceAll('_',' '))}</span></div></div>
      <div class="privacy-mini">${icon('shield')} Access is limited to your facility role.</div>
    </div>
  </aside>`;
}
function renderTopbar() {
  const current = visibleNavItems().find(i=>i.id===state.view)?.label || 'Patient profile';
  return `<header class="topbar">
    <div class="breadcrumb"><span class="mobile-brand"><img class="brand-logo" src="/assets/medledger-logo.svg" alt="" /> MedLedger</span><span class="desktop-crumb">Workspace&nbsp; / &nbsp;<strong>${esc(current)}</strong></span></div>
    <div class="top-actions">
      <button class="connection-pill ${navigator.onLine?'online':'offline'}" data-view="sync" aria-label="View offline and sync status">
        <span class="connection-dot"></span><span>${navigator.onLine?(state.demo?'Demo workspace':'Connected'):'Offline'}</span>
      </button>
      <button class="icon-button" data-view="settings" aria-label="Settings">${icon('settings')}</button><button class="icon-button" id="refresh-button" aria-label="Refresh records">${icon('refresh')}</button>
      <div class="user-chip"><div class="avatar">${esc(initials(state.member.full_name.split(' ')[0],state.member.full_name.split(' ')[1]||''))}</div><div><strong>${esc(state.member.full_name)}</strong><small>${esc(state.member.role.replaceAll('_',' '))}</small></div></div>
      <button class="icon-button" id="logout-button" aria-label="Sign out">${icon('logout')}</button>
    </div>
  </header>`;
}
function statCard(label,value,sub,ico) {
  return `<div class="stat-card"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon">${icon(ico)}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${sub}</div></div>`;
}
function patientById(id) { return state.patients.find(p=>p.id===id) || {first_name:'Unknown',last_name:'patient',mrn:'—'}; }
function recentActivity() {
  const items = [
    ...state.encounters.map(e=>({type:'encounter',date:e.encounter_date,title:`Encounter recorded for ${fullName(patientById(e.patient_id))}`,sub:e.visit_type || 'Clinical encounter',dateValue:e.encounter_date})),
    ...state.referrals.map(r=>({type:'referral',date:r.created_at,title:`Referral to ${r.destination_name}`,sub:`${fullName(patientById(r.patient_id))} · ${r.urgency} priority`,dateValue:r.created_at})),
    ...state.followups.map(f=>({type:'followup',date:f.created_at,title:`Follow-up ${f.followup_status}`,sub:`${fullName(patientById(f.patient_id))} · Due ${fmtDate(f.due_date)}`,dateValue:f.created_at}))
  ].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5);
  if (!items.length) return `<div class="empty-state"><div class="empty-icon">${icon('activity')}</div><strong>No recent activity</strong><p>New encounters, referrals and follow-ups will appear here.</p></div>`;
  return `<div class="activity-list">${items.map(i=>`<div class="activity-row"><div class="activity-dot">${icon(i.type==='encounter'?'file':i.type==='referral'?'send':'calendar')}</div><div class="activity-copy"><strong>${esc(i.title)}</strong><span>${esc(i.sub)}</span></div><div class="activity-time">${esc(relativeTime(i.dateValue))}</div></div>`).join('')}</div>`;
}
function renderDashboard() {
  const pending = state.referrals.filter(r=>['pending','in-progress'].includes(r.referral_status)).length;
  const followups = canDocumentClinicalCare()
    ? state.followups.filter(f=>['pending','scheduled'].includes(f.followup_status) && f.due_date<=todayISO()).sort((a,b)=>a.due_date.localeCompare(b.due_date))
    : [];
  const dueToday = followups.filter(f=>f.due_date===todayISO()).length;
  const overdue = followups.filter(f=>f.due_date<todayISO()).length;
  const greeting = new Date().getHours()<12?'Good morning':new Date().getHours()<17?'Good afternoon':'Good evening';
  const statusMessage = state.demo
    ? 'Demo records are fictional and available for this session, including offline. Changes are not synced.'
    : navigator.onLine
      ? 'Connected to your facility. Live records are not stored for offline access in this prototype.'
      : 'You are offline. Live facility records are unavailable and changes cannot be saved.';
  const followupMarkup = followups.length
    ? `<div class="task-list">${followups.slice(0,6).map(f=>`<button class="task-row" data-patient="${esc(f.patient_id)}"><span class="task-date ${f.due_date<todayISO()?'overdue':''}">${f.due_date<todayISO()?'Overdue':f.due_date===todayISO()?'Today':fmtDate(f.due_date)}</span><span class="task-patient"><strong>${esc(fullName(patientById(f.patient_id)))}</strong><small>${esc(patientById(f.patient_id).mrn)}</small></span>${badge(f.followup_status)}${icon('chevron')}</button>`).join('')}</div>`
    : '<div class="empty-state compact-empty"><div class="empty-icon">' + icon('check') + '</div><strong>No follow-ups need attention</strong><p>Scheduled and pending follow-ups will appear here.</p></div>';
  const quickActions = canDocumentClinicalCare()
    ? `<button class="quick-action" data-action="new-encounter"><span class="quick-icon">${icon('file')}</span><span><strong>Record encounter</strong><small>Document a visit</small></span></button><button class="quick-action" data-action="new-referral"><span class="quick-icon">${icon('send')}</span><span><strong>Create referral</strong><small>Coordinate next steps</small></span></button><button class="quick-action" data-action="new-followup"><span class="quick-icon">${icon('calendar')}</span><span><strong>Schedule follow-up</strong><small>Set a due date</small></span></button>`
    : '';
  const workContent = canDocumentClinicalCare()
    ? `<div class="worklist-summary" aria-label="Care workload">
        <div class="worklist-count"><span>Due today</span><strong>${dueToday}</strong></div>
        <div class="worklist-count ${overdue?'attention':''}"><span>Overdue follow-ups</span><strong>${overdue}</strong></div>
        <div class="worklist-count"><span>Open referrals</span><strong>${pending}</strong></div>
      </div>
      <div class="grid worklist-grid">
        <section class="panel worklist-panel"><div class="panel-head"><div><div class="panel-title">Follow-ups needing attention</div><div class="panel-subtitle">Overdue and due today, shown first</div></div><button class="text-link" data-view="care" data-care-tab="followups">All follow-ups ${icon('chevron')}</button></div>${followupMarkup}</section>
        <aside class="grid worklist-side">
          <section class="panel"><div class="panel-head"><div><div class="panel-title">Quick actions</div><div class="panel-subtitle">Start a common task</div></div></div><div class="quick-grid">
            <button class="quick-action" data-action="new-patient"><span class="quick-icon">${icon('users')}</span><span><strong>Register patient</strong><small>Create a patient profile</small></span></button>${quickActions}
          </div></section>
          <section class="panel recent-panel"><div class="panel-head"><div><div class="panel-title">Recent activity</div><div class="panel-subtitle">Latest updates in this workspace</div></div></div>${recentActivity()}</section>
        </aside>
      </div>`
    : `<section class="panel records-worklist"><div class="panel-head"><div><div class="panel-title">Patient records</div><div class="panel-subtitle">Search the facility directory or register a new patient.</div></div><strong class="records-total">${state.patients.length}</strong></div><button class="btn btn-secondary" data-view="patients">Open patient directory ${icon('arrow')}</button></section>`;
  return `<div class="page-head worklist-heading"><div><p class="eyebrow">${esc(state.facility.name)}</p><h1>${greeting}, ${esc(state.member.full_name.split(' ')[0])}</h1><p>Here are the care tasks that need attention.</p></div><div class="head-actions">${canDocumentClinicalCare()?`<button class="btn btn-secondary" data-action="new-encounter">${icon('file')} Record encounter</button>`:''}<button class="btn btn-primary" data-action="new-patient">${icon('plus')} Register patient</button></div></div>
    <div class="notice-card workspace-notice ${navigator.onLine?'':'is-offline'}"><div class="notice-icon">${icon(navigator.onLine?'info':'refresh')}</div><div><strong>${state.demo?'Demonstration workspace':navigator.onLine?'Facility connection':'Offline mode'}</strong><p>${statusMessage}</p></div><button class="text-link" data-view="sync">View status</button></div>${workContent}`;
}
function renderPatients() {
  const filtered = state.patients.filter(p=>`${fullName(p)} ${p.mrn} ${p.phone||''}`.toLowerCase().includes(state.query.toLowerCase()));
  return `<div class="page-head"><div><p class="eyebrow">Patient directory</p><h1>Patients</h1><p>Find and manage patient profiles registered at this facility.</p></div><div class="head-actions"><button class="btn btn-primary" data-action="new-patient">${icon('plus')} Register patient</button></div></div>
    <section class="panel patient-list-panel"><div class="table-toolbar"><div><div class="panel-title">Patient records <span class="muted table-count">(${filtered.length})</span></div><div class="panel-subtitle">Search by name, patient ID, or phone</div></div><div class="search-wrap">${icon('search')}<input class="search-input" id="patient-search" value="${esc(state.query)}" placeholder="Search patients" /></div></div>
      <div class="patient-list">${filtered.map(p=>`<button type="button" class="patient-row" data-patient="${esc(p.id)}"><span class="patient-avatar">${esc(initials(p.first_name,p.last_name))}</span><span class="patient-row-main"><strong>${esc(fullName(p))}</strong><small>${esc(p.mrn)} · ${esc(p.sex||'Sex not recorded')}</small></span><span class="patient-row-contact">${esc(p.phone||'No phone recorded')}</span><span class="patient-row-date">Added ${fmtDate(p.created_at)}</span><span class="patient-row-status">${badge(p.record_status||'active')}</span>${icon('chevron')}</button>`).join('')}${filtered.length?'':`<div class="empty-state"><div class="empty-icon">${icon('users')}</div><strong>No matching patients</strong><p>Try another search or register a new patient.</p><button class="btn btn-primary" data-action="new-patient">Register patient</button></div>`}</div>
    </section>`;
}
function renderPatientDetail() {
  const patient = state.patients.find(p=>p.id===state.selectedPatientId);
  if (!patient) { state.view='patients'; return renderPatients(); }
  const enc = state.encounters.filter(e=>e.patient_id===patient.id).sort((a,b)=>new Date(b.encounter_date)-new Date(a.encounter_date));
  const refs = state.referrals.filter(r=>r.patient_id===patient.id);
  const fups = state.followups.filter(f=>f.patient_id===patient.id);
  return `<div class="page-head"><div><p class="eyebrow"><button class="text-link" data-view="patients">← Patients</button> / Patient profile</p><h1>${esc(fullName(patient))}</h1><p>Patient ID ${esc(patient.mrn)} · Registered ${fmtDate(patient.created_at)}</p></div><div class="head-actions">${canManagePatientDemographics()?`<button class="btn btn-secondary" data-action="edit-patient" data-patient-id="${esc(patient.id)}">Edit demographics</button>`:''}${canDocumentClinicalCare()?`<button class="btn btn-secondary" data-action="new-encounter" data-patient-id="${esc(patient.id)}">${icon('file')} Record encounter</button><button class="btn btn-primary" data-action="new-referral" data-patient-id="${esc(patient.id)}">${icon('send')} Create referral</button>`:''}</div></div>
    <div class="grid two-col"><section class="panel detail-card"><div class="detail-hero"><div class="patient-avatar">${esc(initials(patient.first_name,patient.last_name))}</div><div><h2>${esc(fullName(patient))}</h2><p>${esc(patient.mrn)} · ${esc(patient.sex||'Not specified')}</p></div><div class="detail-status">${badge(patient.record_status||'active')}</div></div>
      <div class="panel-title detail-section-title">Personal information</div><div class="detail-grid"><div class="detail-field"><span>Date of birth</span><strong>${fmtDate(patient.date_of_birth)}</strong></div><div class="detail-field"><span>Phone number</span><strong>${esc(patient.phone||'Not recorded')}</strong></div><div class="detail-field"><span>Sex</span><strong>${esc(patient.sex||'Not recorded')}</strong></div><div class="detail-field"><span>Address</span><strong>${esc(patient.address||'Not recorded')}</strong></div></div>
      ${canDocumentClinicalCare()?`<div class="section-divider"></div><div class="panel-head"><div class="panel-title">Recent encounters</div><button class="text-link" data-action="new-encounter" data-patient-id="${esc(patient.id)}">+ Add visit</button></div>
      ${enc.length?enc.slice(0,5).map(e=>`<div class="activity-row"><div class="activity-dot">${icon('file')}</div><div class="activity-copy"><strong>${esc(e.visit_type||'Clinical encounter')}</strong><span>${esc(e.chief_complaint||'No presenting complaint recorded')} · ${fmtDate(e.encounter_date)}</span></div></div>`).join(''):'<div class="small muted">No encounters have been recorded for this patient.</div>'}`:''}
    </section>${canDocumentClinicalCare()?`<div class="grid stack-tight"><section class="panel"><div class="panel-title">Referral history</div><div class="panel-subtitle">Recorded referrals for this patient</div>${refs.length?refs.map(r=>`<div class="activity-row"><div class="activity-dot">${icon('send')}</div><div class="activity-copy"><strong>${esc(r.destination_name)}</strong><span>${fmtDate(r.created_at)} · ${esc(r.urgency)}</span></div>${badge(r.referral_status)}</div>`).join(''):'<div class="small muted detail-empty">No referrals recorded.</div>'}</section><section class="panel"><div class="panel-title">Follow-up history</div><div class="panel-subtitle">Upcoming and completed follow-ups</div>${fups.length?fups.map(f=>`<div class="activity-row"><div class="activity-dot">${icon('calendar')}</div><div class="activity-copy"><strong>${fmtDate(f.due_date)}</strong><span>${esc(f.outcome||'No outcome recorded')}</span></div>${badge(f.followup_status)}</div>`).join(''):'<div class="small muted detail-empty">No follow-ups recorded.</div>'}</section></div>`:`<div class="panel"><div class="panel-title">Clinical information access</div><p class="panel-subtitle">This account can manage patient demographics. Clinical encounters, referrals and follow-up information are restricted to clinical staff.</p></div>`}</div>`;
}
function genericTablePage(type, title, description, rows, headers, createAction, rowRenderer) {
  return `<section class="panel table-panel"><div class="table-toolbar"><div><div class="panel-title">${title} <span class="muted table-count">(${rows.length})</span></div><div class="panel-subtitle">${description}</div></div><div class="search-wrap">${icon('search')}<input class="search-input" id="care-search" value="${esc(state.query)}" placeholder="Search ${title.toLowerCase()}" /></div></div><div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(rowRenderer).join('')}</tbody></table>${rows.length?'':`<div class="empty-state"><div class="empty-icon">${icon(type==='followup'?'calendar':type==='referral'?'send':'file')}</div><strong>No ${title.toLowerCase()} yet</strong><p>New records will appear here once your team begins documenting care.</p>${canDocumentClinicalCare()?`<button class="btn btn-primary" data-action="${createAction}">${icon('plus')} ${type==='followup'?'Schedule follow-up':type==='referral'?'Create referral':'Record encounter'}</button>`:''}</div>`}</div></section>`;
}
function renderCare() {
  const tabs = [
    {id:'encounters',label:'Encounters',icon:'file'},
    {id:'referrals',label:'Referrals',icon:'send'},
    {id:'followups',label:'Follow-ups',icon:'calendar'}
  ];
  const current = tabs.find(tab=>tab.id===state.careTab) || tabs[0];
  const createAction = current.id==='encounters'?'new-encounter':current.id==='referrals'?'new-referral':'new-followup';
  const createLabel = current.id==='encounters'?'Record encounter':current.id==='referrals'?'Create referral':'Schedule follow-up';
  const content = current.id==='encounters'?renderEncounters():current.id==='referrals'?renderReferrals():renderFollowups();
  return `<div class="page-head"><div><p class="eyebrow">Care coordination</p><h1>Care records</h1><p>Encounters, referrals, and follow-ups for this facility.</p></div>${canDocumentClinicalCare()?`<div class="head-actions"><button class="btn btn-primary" data-action="${createAction}">${icon('plus')} ${createLabel}</button></div>`:''}</div>
    <div class="care-tabs" role="tablist" aria-label="Care record type">${tabs.map(tab=>`<button class="care-tab ${state.careTab===tab.id?'active':''}" role="tab" aria-selected="${state.careTab===tab.id}" data-care-tab="${tab.id}">${icon(tab.icon)}<span>${tab.label}</span></button>`).join('')}</div>${content}`;
}
function renderEncounters() {
  const rows = state.encounters.filter(e=>`${fullName(patientById(e.patient_id))} ${e.visit_type} ${e.chief_complaint}`.toLowerCase().includes(state.query.toLowerCase()));
  return genericTablePage('encounter','Encounters','Document visits and keep clinical activity organised.',rows,['Patient','Visit type','Presenting complaint','Date','Recorded by'],'new-encounter',e=>`<tr data-patient="${esc(e.patient_id)}"><td><span class="patient-name">${esc(fullName(patientById(e.patient_id)))}</span><span class="patient-meta">${esc(patientById(e.patient_id).mrn)}</span></td><td>${esc(e.visit_type||'—')}</td><td>${esc(e.chief_complaint||'—')}</td><td>${fmtDate(e.encounter_date)}</td><td>${esc(state.demo?'Demo team':e.created_by||'Facility user')}</td></tr>`);
}
function renderReferrals() {
  const rows = state.referrals.filter(r=>`${fullName(patientById(r.patient_id))} ${r.destination_name} ${r.reason}`.toLowerCase().includes(state.query.toLowerCase()));
  return genericTablePage('referral','Referrals','Record where a patient is being referred and track the next step.',rows,['Patient','Destination','Reason','Priority','Status','Date','Update'],'new-referral',r=>`<tr><td><span class="patient-name">${esc(fullName(patientById(r.patient_id)))}</span><span class="patient-meta">${esc(patientById(r.patient_id).mrn)}</span></td><td>${esc(r.destination_name)}</td><td>${esc(r.reason)}</td><td>${badge(r.urgency)}</td><td>${badge(r.referral_status)}</td><td>${fmtDate(r.created_at)}</td><td>${canDocumentClinicalCare()?`<select class="inline-status" data-referral-status="${esc(r.id)}" aria-label="Update referral status"><option value="pending" ${r.referral_status==='pending'?'selected':''}>Pending</option><option value="in-progress" ${r.referral_status==='in-progress'?'selected':''}>In progress</option><option value="completed" ${r.referral_status==='completed'?'selected':''}>Completed</option><option value="cancelled" ${r.referral_status==='cancelled'?'selected':''}>Cancelled</option></select>`:esc(r.referral_status)}</td></tr>`);
}
function renderFollowups() {
  const rows = state.followups.filter(f=>`${fullName(patientById(f.patient_id))} ${f.followup_status} ${f.outcome}`.toLowerCase().includes(state.query.toLowerCase()));
  return genericTablePage('followup','Follow-ups','Keep upcoming reviews visible and document completed follow-up.',rows,['Patient','Due date','Status','Outcome','Created','Update'],'new-followup',f=>`<tr><td><span class="patient-name">${esc(fullName(patientById(f.patient_id)))}</span><span class="patient-meta">${esc(patientById(f.patient_id).mrn)}</span></td><td>${fmtDate(f.due_date)}</td><td>${badge(f.followup_status)}</td><td>${esc(f.outcome||'—')}</td><td>${fmtDate(f.created_at)}</td><td>${canDocumentClinicalCare()?`<select class="inline-status" data-followup-status="${esc(f.id)}" aria-label="Update follow-up status"><option value="scheduled" ${f.followup_status==='scheduled'?'selected':''}>Scheduled</option><option value="pending" ${f.followup_status==='pending'?'selected':''}>Pending</option><option value="completed" ${f.followup_status==='completed'?'selected':''}>Completed</option><option value="missed" ${f.followup_status==='missed'?'selected':''}>Missed</option><option value="cancelled" ${f.followup_status==='cancelled'?'selected':''}>Cancelled</option></select>`:esc(f.followup_status)}</td></tr>`);
}
function renderSettings() {
  return `<div class="page-head"><div><p class="eyebrow">Workspace preferences</p><h1>Settings</h1><p>Facility information, access and privacy controls.</p></div></div>
    <div class="grid two-col"><section class="panel"><div class="panel-title">Facility workspace</div><div class="panel-subtitle">Current facility context</div><div class="section-divider"></div><div class="detail-grid"><div class="detail-field"><span>Facility name</span><strong>${esc(state.facility.name)}</strong></div><div class="detail-field"><span>Account role</span><strong>${esc(state.member.role.replaceAll('_',' '))}</strong></div><div class="detail-field"><span>Workspace mode</span><strong>${state.demo?'Demonstration':'Connected facility'}</strong></div><div class="detail-field"><span>Notification email</span><strong>${esc(state.facility.notification_email||'Not configured')}</strong></div></div><div class="section-divider"></div><div class="access-card"><strong>Need a new staff account?</strong><p>For the initial pilot, facility administrators create staff accounts through the approved Supabase Auth process and assign them to the facility. Self-registration is disabled.</p></div></section>
    <div class="grid stack-tight"><section class="panel"><div class="panel-title">Privacy and data handling</div><div class="panel-subtitle">Important safeguards for this testing build</div><div class="activity-row"><div class="activity-dot">${icon('shield')}</div><div class="activity-copy"><strong>Facility-scoped access</strong><span>Records are protected by database access policies.</span></div></div><div class="activity-row"><div class="activity-dot">${icon('lock')}</div><div class="activity-copy"><strong>No clinical data in app cache</strong><span>The PWA caches only its static application shell.</span></div></div><div class="activity-row"><div class="activity-dot">${icon('info')}</div><div class="activity-copy"><strong>Testing with synthetic data first</strong><span>Do not enter real patient data before facility approval and a privacy/security review.</span></div></div></section>
    <section class="panel"><div class="panel-title">Email notifications</div><div class="panel-subtitle">Resend integration status</div><div class="section-divider"></div><div class="small muted">${state.demo?'Not active in demo mode.':'Configured through the MedLedger server-side notification function.'}</div><p class="helper-text">Email notifications should contain only a generic alert and a secure link. Patient names, diagnoses and other health details must not be included in email subjects or message bodies.</p></section></div></div>`;
}
function renderSyncStatus() {
  const connection = navigator.onLine ? 'Online' : 'Offline';
  const recordAvailability = state.demo
    ? 'Fictional sample records are available in this session.'
    : 'Live patient and clinical records are not stored on this device.';
  const writeAvailability = state.demo
    ? 'Demo changes stay in memory and are not sent to a server.'
    : 'Offline writes and automatic sync are not implemented in this prototype.';
  return `<div class="page-head"><div><p class="eyebrow">Connection and data availability</p><h1>Offline & sync</h1><p>See what this installation can safely do with and without a connection.</p></div></div>
    <section class="panel sync-overview"><div class="sync-overview-icon">${icon(navigator.onLine?'check':'info')}</div><div><span class="sync-label">Current connection</span><h2>${connection}</h2><p>${state.demo?'You are using the demonstration workspace.':'You are signed in to a facility workspace.'}</p></div><span class="connection-badge ${navigator.onLine?'online':'offline'}"><span class="connection-dot"></span>${connection}</span></section>
    <div class="grid sync-detail-grid">
      <section class="panel sync-detail"><span class="sync-label">Records available offline</span><strong>${state.demo?'Demo records only':'None'}</strong><p>${recordAvailability}</p></section>
      <section class="panel sync-detail"><span class="sync-label">Changes waiting to sync</span><strong>${state.demo?'Session only':'Not available'}</strong><p>${writeAvailability}</p></section>
    </div>
    <section class="notice-card sync-safety"><div class="notice-icon">${icon('shield')}</div><div><strong>Offline clinical records are not enabled yet</strong><p>This build caches only the application shell. Secure offline use needs encrypted local storage, device protection, expiry and revocation, conflict handling, and an auditable sync process before real records can be stored on a device.</p></div></section>`;
}
function renderContent() {
  if (!canDocumentClinicalCare() && state.view==='care') { state.view = 'patients'; state.selectedPatientId = null; }
  if (state.selectedPatientId && state.view==='patient-detail') return renderPatientDetail();
  switch (state.view) {
    case 'patients': return renderPatients();
    case 'care': return renderCare();
    case 'sync': return renderSyncStatus();
    case 'settings': return renderSettings();
    case 'dashboard': default: return renderDashboard();
  }
}
function render() {
  if (!adminGatePassed) return renderAdminGate();
  if (!state.session && !state.demo) return renderLogin();
  if (state.demo && !state.patients.length) seedDemoData();
  app.innerHTML = `<div class="app-shell">${renderSidebar()}<div class="main-column">${renderTopbar()}<div class="offline-bar" id="offline-bar">${icon('info')} <span>${state.demo?'Offline demo is available. Sample changes will not sync.':'Offline. Live facility records are unavailable in this prototype.'}</span></div><main class="content">${renderContent()}</main></div></div>
    <nav class="mobile-nav">${visibleNavItems().slice(0,5).map(item=>`<button class="${state.view===item.id?'active':''}" data-view="${item.id}">${icon(item.icon)}<span>${item.id==='dashboard'?'Home':item.label}</span></button>`).join('')}</nav>`;
  updateConnectivity();
}
function updateConnectivity() {
  const bar = document.getElementById('offline-bar');
  if (bar) bar.classList.toggle('visible', !navigator.onLine);
}
async function handleOffline() {
  // Do not leave live patient/clinical data available in an offline session in this pilot build.
  if (!state.demo) { state.patients=[]; state.encounters=[]; state.referrals=[]; state.followups=[]; render(); }
  else render();
}
async function handleOnline() {
  updateConnectivity();
  if (!state.demo && state.session) { try { await loadRealData(); render(); toast('Connection restored. Facility records refreshed.'); } catch (error) { toast('Connection restored, but records could not be refreshed.', 'error'); } }
}
async function signOut() {
  clearIdleTimer();
  const token=state.session?.access_token;
  if (token && isConfigured() && navigator.onLine) {
    try { await fetch(`${CONFIG.SUPABASE_URL.replace(/\/$/,'')}/auth/v1/logout?scope=local`, {method:'POST',cache:'no-store',signal:AbortSignal.timeout(3000),headers:{apikey:CONFIG.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`}}); } catch { /* Clear the local in-memory session even if the network is unavailable. */ }
  }
  clearLiveSession();
}

function modalShell(title, description, body, submitLabel = 'Save record') {
  return `<div class="modal-backdrop" id="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><div class="modal-head"><div><h2>${title}</h2><p>${description}</p></div><button class="close-button" data-close-modal aria-label="Close">×</button></div><form id="record-form"><div class="modal-body">${body}</div><div class="modal-foot"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit" id="record-submit">${submitLabel}</button></div></form></section></div>`;
}
function patientOptions(selected = '') {
  return `<option value="">Select patient</option>${state.patients.map(p=>`<option value="${esc(p.id)}" ${selected===p.id?'selected':''}>${esc(fullName(p))} · ${esc(p.mrn)}</option>`).join('')}`;
}
function openModal(type, patientId = '') {
  if (!state.demo && !navigator.onLine) { toast('Live records cannot be changed offline in this prototype.', 'error'); return; }
  if (type === 'edit-patient' && !canManagePatientDemographics()) { toast('Your facility role does not allow patient demographic updates.', 'error'); return; }
  if (!['new-patient','edit-patient'].includes(type) && !canDocumentClinicalCare()) { toast('Your facility role does not allow clinical record creation.', 'error'); return; }
  if (type==='new-patient') {
    state.modal = modalShell('Register a patient','Create a patient profile for this facility.',`
      <div class="form-grid"><div class="form-field"><label>First name *</label><input name="first_name" required maxlength="80" autocomplete="off" /></div><div class="form-field"><label>Last name *</label><input name="last_name" required maxlength="80" autocomplete="off" /></div><div class="form-field"><label>Date of birth</label><input name="date_of_birth" type="date" max="${todayISO()}" /></div><div class="form-field"><label>Sex</label><select name="sex"><option value="">Not specified</option><option>Female</option><option>Male</option><option>Other</option><option>Prefer not to say</option></select></div><div class="form-field"><label>Phone number</label><input name="phone" type="tel" maxlength="30" placeholder="080…" /></div><div class="form-field"><label>Address / community</label><input name="address" maxlength="180" /></div><div class="form-field full"><label class="consent-label"><input type="checkbox" name="privacy_notice_acknowledged" value="true" required class="consent-checkbox" /> I confirm that the facility privacy information has been explained to the patient or appropriate representative.</label><span class="helper-text">This records that information was provided; it is not a substitute for identifying and documenting the appropriate lawful basis for processing. Collect only information needed for the care workflow.</span></div></div>`,'Save patient');
  } else if (type==='edit-patient') {
    const patient = state.patients.find((item) => item.id === patientId);
    if (!patient) { toast('Patient record not found. Refresh the list and try again.', 'error'); return; }
    state.modal = modalShell('Edit patient demographics','Update the minimum demographic information needed by your facility.',`
      <input type="hidden" name="record_id" value="${esc(patient.id)}" />
      <div class="form-grid"><div class="form-field"><label>First name *</label><input name="first_name" required maxlength="80" autocomplete="off" value="${esc(patient.first_name)}" /></div><div class="form-field"><label>Last name *</label><input name="last_name" required maxlength="80" autocomplete="off" value="${esc(patient.last_name)}" /></div><div class="form-field"><label>Date of birth</label><input name="date_of_birth" type="date" max="${todayISO()}" value="${esc(patient.date_of_birth||'')}" /></div><div class="form-field"><label>Sex</label><select name="sex"><option value="">Not specified</option><option value="Female" ${patient.sex==='Female'?'selected':''}>Female</option><option value="Male" ${patient.sex==='Male'?'selected':''}>Male</option><option value="Other" ${patient.sex==='Other'?'selected':''}>Other</option><option value="Prefer not to say" ${patient.sex==='Prefer not to say'?'selected':''}>Prefer not to say</option></select></div><div class="form-field"><label>Phone number</label><input name="phone" type="tel" maxlength="30" value="${esc(patient.phone||'')}" /></div><div class="form-field full"><label>Address / community</label><input name="address" maxlength="180" value="${esc(patient.address||'')}" /></div><div class="form-field full"><span class="helper-text">The patient identifier and original author information cannot be changed here. Changes are recorded in the facility audit trail.</span></div></div>`,'Update patient');
  } else if (type==='new-encounter') {
    state.modal = modalShell('Record an encounter','Document a healthcare visit for an existing patient.',`
      <div class="form-grid"><div class="form-field full"><label>Patient *</label><select name="patient_id" required>${patientOptions(patientId)}</select></div><div class="form-field"><label>Visit type *</label><select name="visit_type" required><option value="">Select type</option><option>Walk-in</option><option>Follow-up</option><option>Referral review</option><option>Routine check</option></select></div><div class="form-field"><label>Encounter date *</label><input name="encounter_date" type="datetime-local" value="${new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)}" required /></div><div class="form-field full"><label>Presenting complaint</label><textarea name="chief_complaint" maxlength="1000" placeholder="Briefly record the reason for the visit"></textarea></div><div class="form-field full"><label>Assessment / observations</label><textarea name="assessment" maxlength="2000" placeholder="Enter relevant observations or assessment"></textarea></div><div class="form-field full"><label>Plan / next steps</label><textarea name="plan" maxlength="2000" placeholder="Document the agreed next steps"></textarea></div><div class="form-field full"><span class="helper-text">This tool supports record documentation; it does not provide clinical decision support or replace professional judgement.</span></div></div>`,'Save encounter');
  } else if (type==='new-referral') {
    state.modal = modalShell('Create a referral','Record the destination and reason for further care.',`
      <div class="form-grid"><div class="form-field full"><label>Patient *</label><select name="patient_id" required>${patientOptions(patientId)}</select></div><div class="form-field"><label>Destination facility *</label><input name="destination_name" required maxlength="160" placeholder="Facility or service name" /></div><div class="form-field"><label>Priority *</label><select name="urgency" required><option value="routine">Routine</option><option value="urgent">Urgent</option></select></div><div class="form-field full"><label>Reason for referral *</label><textarea name="reason" required maxlength="2000" placeholder="Summarise the reason for referral"></textarea></div><div class="form-field full"><span class="helper-text">This first build records referrals within the facility workspace. Secure cross-facility record sharing requires a separate consent and access workflow.</span></div></div>`,'Save referral');
  } else if (type==='new-followup') {
    state.modal = modalShell('Schedule a follow-up','Create a reminder for the next care interaction.',`
      <div class="form-grid"><div class="form-field full"><label>Patient *</label><select name="patient_id" required>${patientOptions(patientId)}</select></div><div class="form-field"><label>Due date *</label><input name="due_date" type="date" min="${todayISO()}" required value="${todayISO()}" /></div><div class="form-field"><label>Status</label><select name="followup_status"><option value="scheduled">Scheduled</option><option value="pending">Pending</option></select></div><div class="form-field full"><label>Notes / intended action</label><textarea name="outcome" maxlength="1000" placeholder="Add a brief non-clinical reminder or follow-up plan"></textarea></div></div>`,'Save follow-up');
  }
  const old = document.getElementById('modal-backdrop'); if (old) old.remove();
  document.body.insertAdjacentHTML('beforeend', state.modal);
  document.getElementById('modal-backdrop')?.addEventListener('click', (e)=>{ if(e.target.id==='modal-backdrop') closeModal(); });
  document.getElementById('record-form')?.addEventListener('submit', submitRecord);
}
function closeModal() { document.getElementById('modal-backdrop')?.remove(); state.modal = null; }
async function submitRecord(event) {
  event.preventDefault(); if (state.busy) return;
  const form = event.currentTarget; const button = document.getElementById('record-submit');
  const data = Object.fromEntries(new FormData(form).entries()); button.disabled = true; button.textContent = 'Saving…'; state.busy = true;
  try {
    if (form.querySelector('[name="record_id"]')) await updatePatient(data);
    else if (form.querySelector('[name="first_name"]')) await savePatient(data);
    else if (form.querySelector('[name="visit_type"]')) await saveEncounter(data);
    else if (form.querySelector('[name="destination_name"]')) await saveReferral(data);
    else await saveFollowup(data);
    closeModal(); render();
  } catch (error) { toast(error.message, 'error'); button.disabled = false; button.textContent = 'Try again'; }
  finally { state.busy = false; }
}
function genMRN() { return `ML-${new Date().getFullYear()}-${crypto.randomUUID().slice(0,8).toUpperCase()}`; }
async function savePatient(data) {
  const record = { facility_id:state.facility.id, mrn:genMRN(), first_name:data.first_name.trim(), last_name:data.last_name.trim(), date_of_birth:data.date_of_birth||null, sex:data.sex||null, phone:data.phone.trim()||null, address:data.address.trim()||null, record_status:'active', privacy_notice_acknowledged:data.privacy_notice_acknowledged==='true', privacy_notice_version:'medledger-privacy-notice-v1', privacy_notice_recorded_at:new Date().toISOString() };
  if (state.demo) { record.id=crypto.randomUUID(); record.created_at=new Date().toISOString(); state.patients.unshift(record); toast('Patient profile added to the demo.'); }
  else { const [saved] = await supa('/rest/v1/patients', {method:'POST',body:JSON.stringify({...record,created_by:state.user.id})}); state.patients.unshift(saved); toast('Patient profile saved.'); }
  state.query='';
}
async function updatePatient(data) {
  const recordId = String(data.record_id || '');
  const patient = state.patients.find((item) => item.id === recordId);
  if (!patient) throw new Error('Patient record not found. Refresh the page and try again.');
  const changes = {
    first_name: data.first_name.trim(),
    last_name: data.last_name.trim(),
    date_of_birth: data.date_of_birth || null,
    sex: data.sex || null,
    phone: data.phone.trim() || null,
    address: data.address.trim() || null
  };
  if (state.demo) {
    Object.assign(patient, changes);
    toast('Patient demographics updated in the demo.');
  } else {
    const updated = await supa(`/rest/v1/patients?id=eq.${encodeURIComponent(recordId)}&facility_id=eq.${encodeURIComponent(state.facility.id)}&select=id`, {
      method: 'PATCH', body: JSON.stringify(changes)
    });
    if (!Array.isArray(updated) || updated.length !== 1) throw new Error('The patient was not updated. Check facility permissions and refresh the page.');
    Object.assign(patient, changes);
    toast('Patient demographics updated.');
  }
}

async function saveEncounter(data) {
  const record = {facility_id:state.facility.id,patient_id:data.patient_id,encounter_date:new Date(data.encounter_date).toISOString(),visit_type:data.visit_type,chief_complaint:data.chief_complaint.trim()||null,assessment:data.assessment.trim()||null,plan:data.plan.trim()||null};
  if (state.demo) {record.id=crypto.randomUUID();record.created_at=new Date().toISOString();state.encounters.unshift(record);toast('Encounter added to the demo.');}
  else {const [saved]=await supa('/rest/v1/encounters',{method:'POST',body:JSON.stringify({...record,created_by:state.user.id})});state.encounters.unshift(saved);toast('Encounter saved.');}
  state.query='';
}
async function saveReferral(data) {
  const record={facility_id:state.facility.id,patient_id:data.patient_id,destination_name:data.destination_name.trim(),reason:data.reason.trim(),urgency:data.urgency,referral_status:'pending'};
  if(state.demo){record.id=crypto.randomUUID();record.created_at=new Date().toISOString();state.referrals.unshift(record);toast('Referral added to the demo.');}
  else {const [saved]=await supa('/rest/v1/referrals',{method:'POST',body:JSON.stringify({...record,created_by:state.user.id})});state.referrals.unshift(saved);toast('Referral saved.');await sendClinicalAlert('referral_created',saved.id);}
  state.query='';
}
async function saveFollowup(data) {
  const record={facility_id:state.facility.id,patient_id:data.patient_id,due_date:data.due_date,followup_status:data.followup_status||'scheduled',outcome:data.outcome.trim()||null};
  if(state.demo){record.id=crypto.randomUUID();record.created_at=new Date().toISOString();state.followups.unshift(record);toast('Follow-up added to the demo.');}
  else {const [saved]=await supa('/rest/v1/follow_ups',{method:'POST',body:JSON.stringify({...record,created_by:state.user.id})});state.followups.unshift(saved);toast('Follow-up saved.');await sendClinicalAlert('followup_scheduled',saved.id);}
  state.query='';
}

async function updateStatus(type, id, value) {
  if (!canDocumentClinicalCare()) { toast('Your facility role does not allow this update.', 'error'); return; }
  if (!state.demo && !navigator.onLine) { toast('Live records cannot be changed offline in this prototype.', 'error'); render(); return; }
  const list = type==='referral' ? state.referrals : state.followups;
  const item = list.find(row=>row.id===id); if(!item) return;
  const field = type==='referral' ? 'referral_status' : 'followup_status';
  const previous = item[field]; item[field]=value;
  try {
    if(!state.demo) { const table=type==='referral'?'referrals':'follow_ups'; const updated=await supa(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&facility_id=eq.${encodeURIComponent(state.facility.id)}&select=id`,{method:'PATCH',body:JSON.stringify({[field]:value})}); if(!Array.isArray(updated)||updated.length!==1) throw new Error('The record was not updated. Check your facility permissions and refresh the page.'); }
    toast(`${type==='referral'?'Referral':'Follow-up'} status updated.`); render();
  } catch(error) { item[field]=previous; render(); toast(error.message,'error'); }
}
function handleChange(event) {
  const referral=event.target.closest('[data-referral-status]');
  if(referral) { updateStatus('referral',referral.dataset.referralStatus,referral.value); return; }
  const followup=event.target.closest('[data-followup-status]');
  if(followup) updateStatus('followup',followup.dataset.followupStatus,followup.value);
}

function handleClick(event) {
  const close = event.target.closest('[data-close-modal]'); if (close) return closeModal();
  const careTab = event.target.closest('[data-care-tab]');
  if (careTab) { state.careTab=careTab.dataset.careTab;state.query='';render();return; }
  const view = event.target.closest('[data-view]');
  if (view) {state.view=view.dataset.view;if(view.dataset.careTab)state.careTab=view.dataset.careTab;state.query='';state.selectedPatientId=null;render();return;}
  const action = event.target.closest('[data-action]');
  if(action){ const patientId=action.dataset.patientId||''; openModal(action.dataset.action,patientId); return; }
  const patientRow = event.target.closest('[data-patient]');
  if(patientRow){state.selectedPatientId=patientRow.dataset.patient;state.view='patient-detail';state.query='';render();return;}
  if(event.target.closest('#logout-button')) { signOut();return; }
  if(event.target.closest('#refresh-button')) { refreshData();return; }
}
async function refreshData() {
  if(state.demo){seedDemoData();render();toast('Demo records refreshed.');return;}
  try{await loadRealData();render();toast('Records refreshed.');}catch(error){toast(error.message,'error');}
}
function handleInput(event) {
  if(event.target.id==='patient-search'||event.target.id==='care-search'){
    const cursor=event.target.selectionStart;state.query=event.target.value;
    const el=event.target.id;
    const start=window.scrollY;
    const content=document.querySelector('.content');
    if(el==='patient-search') { const wrap=event.target.closest('.patient-list-panel'); const html=renderPatients(); const temp=document.createElement('div');temp.innerHTML=html;wrap.replaceWith(temp.firstElementChild); }
    else { const page=renderCare(); const old=document.querySelector('.content');old.innerHTML=page; }
    const next=document.getElementById(el);if(next){next.focus();next.setSelectionRange(cursor,cursor);}window.scrollTo(0,start);
  }
}
function registerSW() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch((error)=>console.warn('PWA worker registration failed',error));
}
window.addEventListener('online',handleOnline);
window.addEventListener('offline',handleOffline);
document.addEventListener('click',handleClick);
document.addEventListener('input',handleInput);
document.addEventListener('change',handleChange);
document.addEventListener('pointerdown', resetIdleTimer, { passive: true });
document.addEventListener('keydown', resetIdleTimer);
document.addEventListener('touchstart', resetIdleTimer, { passive: true });
registerSW();
seedDemoData();
renderAdminGate();
