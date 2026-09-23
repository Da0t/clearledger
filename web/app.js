const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(cents / 100);
const number = n => new Intl.NumberFormat('en-US').format(n);
const uid = prefix => `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
const time = stamp => new Date(stamp).toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
const page = 'ledger';
let ledger, inspection = null, busy = false, toastTimer;
let publicDemo = false;
const sandboxSessions = {};

function sandbox(project) {
  if (!sandboxSessions[project]) {
    try { sandboxSessions[project] = JSON.parse(sessionStorage.getItem('fintech-demo-v1-'+project)); } catch (_) { /* Storage is optional. */ }
    if (!sandboxSessions[project]) sandboxSessions[project] = {version:1,started_at:new Date().toISOString(),history:[]};
  }
  return sandboxSessions[project];
}

async function api(path, body) {
  const project = 'ledger';
  const target = publicDemo ? '/api/demo' : path;
  const requestBody = publicDemo ? {path,body:body ?? null,session:sandbox(project)} : body;
  const response = await fetch(target, {method: requestBody === undefined ? 'GET' : 'POST', headers:{'Content-Type':'application/json'}, ...(requestBody === undefined ? {} : {body:JSON.stringify(requestBody)})});
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Invalid input. Check the amounts and identifiers.');
  if (publicDemo) {
    sandboxSessions[project] = result.session;
    try { sessionStorage.setItem('fintech-demo-v1-'+project, JSON.stringify(result.session)); } catch (_) { /* In-memory sandbox still works. */ }
    return result.value;
  }
  return result;
}
function toast(message, error=false) {
  clearTimeout(toastTimer);
  const element = $('#toast'); element.textContent = message; element.hidden = false; element.classList.toggle('error', error);
  toastTimer = setTimeout(() => element.hidden = true, error ? 9000 : 6500);
}
function dollars(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('Enter a positive dollar amount with at most two decimal places.');
  const [whole, fraction=''] = String(value).split('.');
  const cents = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Amount must be positive.');
  return cents;
}
async function action(work) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await work(); }
  catch (error) { toast(error.message, true); }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
async function load() { ledger = await api('/api/ledger/state'); render(); }
function render() {
 document.title = 'ClearLedger';
 $('#main').innerHTML = renderLedger();
}
function stat(label, value, foot, featured=false) {
  return `<div class="stat ${featured?'featured':''}"><div class="label">${label}<span>↗</span></div><div class="value">${value}</div><div class="stat-foot">${foot}</div></div>`;
}
function badge(label, tone='') { return `<span class="badge ${tone}">${esc(label)}</span>`; }
function checks(data, descriptions) {
  return `<div class="health-list">${Object.entries(descriptions).map(([key, [label, sub]]) => `<div class="health-row"><span class="check ${data[key]?'':'fail'}">${data[key]?'✓':'!'}</span><div><strong>${label}</strong><small>${sub}</small></div><span class="mono ${data[key]?'green':'red'}">${data[key]?'PASS':'FAIL'}</span></div>`).join('')}</div>`;
}
function timeline(rows) {
  return rows.length ? `<div class="timeline">${rows.map(r => `<div class="timeline-item"><span class="timeline-marker"></span><div><strong>${esc(r.action || r.type)}</strong><p>${esc(r.detail)}</p><small>${r.created_at ? time(r.created_at) : 'TICK '+r.tick}${r.reference?' · '+esc(r.reference):''}</small></div></div>`).join('')}</div>` : '<div class="empty">Your next action starts the story.</div>';
}

function renderLedger() {
  const mismatch = ledger.reconciliation.filter(r => r.status !== 'matched');
  const pending = ledger.inbox.filter(e => e.status !== 'completed');
  const allGood = Object.values(ledger.checks).every(Boolean);
  return `<div class="page-header"><div><div class="tag">TRANSACTION INFRASTRUCTURE</div><h1>Every dollar. <span>Accounted for.</span></h1><p class="subtitle">A working ledger with a paper trail. Trace transactions, recover failures, and reconcile the difference.</p></div><div class="header-actions"><button data-action="deposit-form">＋ Simulate deposit</button><button class="primary" data-action="refund-form">Issue refund ↗</button></div></div>
  <div class="intro-strip"><div><strong>Start with a failure.</strong> <span>Send a payment three times, interrupt the worker, then recover it without double-crediting.</span></div><button data-action="incident">Run failure scenario →</button></div>
  <section class="stats" aria-label="Ledger metrics">
    ${stat('Available balance',money(ledger.balances.wallet),'USD · spendable funds',true)}
    ${stat('Reserved funds',money(ledger.balances.reserved),`${ledger.holds.filter(h=>h.state==='reserved').length} active holds`)}
    ${stat('Reconciliation breaks',String(mismatch.length),mismatch.length?'Requires investigation':'All provider records matched')}
    ${stat('Ledger integrity',allGood?'Balanced':'Check failed',`${Object.values(ledger.checks).filter(Boolean).length} / 4 invariants passing`)}
  </section>
  ${inspection ? `<section class="panel inspector"><div class="panel-header"><h2>Inspecting <span class="mono">${esc(inspection)}</span></h2><button class="compact" data-action="close-inspection">Close ×</button></div><div class="panel-body">${timeline(ledger.audit.filter(r=>r.reference===inspection))}</div></section>`:''}
  <div class="section-grid"><section class="panel"><div class="panel-header"><div><h2 id="reconciliation">Provider reconciliation</h2><small>Internal postings compared with the simulated provider statement</small></div>${badge(mismatch.length ? mismatch.length+' breaks' : 'All matched',mismatch.length?'warn':'good')}</div><div class="table-wrap"><table><thead><tr><th>PAYMENT / TYPE</th><th class="right">INTERNAL</th><th class="right">PROVIDER</th><th>STATUS</th></tr></thead><tbody>${ledger.reconciliation.map(r=>`<tr class="inspectable" data-inspect="${esc(r.payment_id)}"><td><button class="compact ghost" data-action="inspect" data-id="${esc(r.payment_id)}">${esc(r.payment_id)}</button><br><small class="muted">${esc(r.kind)}</small></td><td class="right amount">${money(r.internal)}</td><td class="right amount">${money(r.provider)}</td><td>${badge(r.status,r.status==='matched'?'good':'warn')}${r.kind==='refund' && r.internal>r.provider?`<br><button class="compact ghost" style="margin-top:5px" data-action="provider-refund" data-id="${esc(r.payment_id)}" data-amount="${r.internal-r.provider}">Simulate provider acknowledgment</button>`:''}</td></tr>`).join('')}</tbody></table></div><div class="panel-footer">Compared on payment ID + type · Click a payment to inspect its audit trail</div></section>
  <section class="panel"><div class="panel-header"><h2>Correctness, continuously checked</h2><span class="code-pill">INVARIANTS</span></div><div class="panel-body">${checks(ledger.checks, {balanced:['Balanced journal','Every debit has an equal credit'],nonnegative_wallet:['Protected balances','Available funds cannot go negative'],holds_reconciled:['Holds reconciled','Reserved balance equals active holds'],refunds_bounded:['Refund limits','Refunds never exceed a payment']})}<div class="mini-label">POSTING MODEL</div><div class="flow"><span>Provider clearing</span><span>→</span><span>Paired journal entry</span><span>→</span><span>Wallet</span></div></div></section></div>
  <div class="section-grid"><section class="panel"><div class="panel-header"><div><h2 id="journal">Journal</h2><small>Append-only money movement. Original entries are never rewritten.</small></div><span class="metric-inline">${ledger.journal.length} postings shown</span></div><div class="table-wrap"><table><thead><tr><th>REFERENCE</th><th>FLOW</th><th class="right">AMOUNT</th><th>TYPE</th></tr></thead><tbody>${ledger.journal.map(r=>`<tr class="inspectable" data-inspect="${esc(r.reference)}"><td class="mono">${esc(r.reference)}<br><small class="muted">${time(r.created_at)}</small></td><td><span class="muted">${esc(r.debit)}</span> → ${esc(r.credit)}</td><td class="right amount">${money(r.amount)}</td><td>${badge(r.kind)}</td></tr>`).join('')}</tbody></table></div></section>
  <section class="panel"><div class="panel-header"><h2>Event trail</h2><span class="metric-inline">LATEST ACTIVITY</span></div><div class="panel-body">${timeline(ledger.audit.slice(0,12))}</div></section></div>
  <div class="section-grid"><section class="panel"><div class="panel-header"><div><h2>Recovery inbox</h2><small>Durable events survive a worker interruption</small></div>${badge(pending.length+' pending / failed',pending.length?'warn':'good')}</div>${pending.length?pending.map(e=>`<div class="pending-row"><div class="row"><strong>${esc(e.payment_id)}</strong><span class="amount">${money(e.amount)}</span></div><p>${esc(e.error || 'Waiting for the worker')} · ${e.attempts} attempt${e.attempts===1?'':'s'}</p><button class="compact primary" data-action="retry" data-id="${esc(e.id)}">Retry event →</button></div>`).join(''):'<div class="empty">No events waiting for recovery.<span>Run the failure scenario above to create one.</span></div>'}</section>
  <section class="panel"><div class="panel-header"><h2>Funds reservations</h2><button class="compact" data-action="hold-form">＋ Reserve</button></div><div class="panel-body">${ledger.holds.length?ledger.holds.map(h=>`<div class="hold-row"><div class="row"><span class="mono">${esc(h.id)}</span><span class="amount">${money(h.amount)}</span></div><div class="row" style="margin-top:8px">${badge(h.state,h.state==='reserved'?'warn':'good')}${h.state==='reserved'?`<div class="controls"><button class="compact" data-action="resolve-hold" data-id="${esc(h.id)}" data-resolve="release">Release</button><button class="compact" data-action="resolve-hold" data-id="${esc(h.id)}" data-resolve="settle">Settle</button></div>`:''}</div></div>`).join(''):'<div class="empty">No reservations yet.</div>'}</div></section></div>`;
}

function openForm(kind) {
  const refund=kind==='refund', hold=kind==='hold';
  const title=refund?'Issue a partial refund':hold?'Reserve funds':'Simulate a deposit';
  const choices=ledger.payments.filter(p=>p.refunded<p.amount);
  $('#dialog-content').innerHTML=`<h2 id="dialog-title">${title}</h2><p class="dialog-subtitle">${refund?'Posts a reversal without modifying the original deposit. Provider acknowledgment is simulated separately.':hold?'Moves available cash into a protected reservation until you settle or release it.':'Creates a provider statement record and processes a synthetic payment event.'}</p><form id="ledger-form" data-kind="${kind}" data-key="${uid(kind)}">${refund?`<div class="field"><label for="payment">Original payment</label><select id="payment" name="payment">${choices.map(p=>`<option value="${esc(p.id)}">${esc(p.id)} · ${money(p.amount-p.refunded)} refundable</option>`).join('')}</select></div>`:''}<div class="field"><label for="amount">Amount (USD)</label><input name="amount" id="amount" inputmode="decimal" required pattern="[0-9]+(\.[0-9]{1,2})?" placeholder="${refund?'25.00':hold?'50.00':'250.00'}"><small>USD only. Amounts are stored as integer cents.</small></div><div class="dialog-actions"><button type="button" data-action="close-dialog">Cancel</button><button class="primary" type="submit">${refund?'Post refund':hold?'Reserve funds':'Process deposit'} →</button></div></form>`;
  $('#form-dialog').showModal();
  $('#amount').focus();
}
document.addEventListener('click', async event => {
  const button=event.target.closest('[data-action]');
  if(!button) {
    const row=event.target.closest('[data-inspect]');
    if(row && !busy) { inspection=row.dataset.inspect; render(); }
    return;
  }
  const a=button.dataset.action, id=button.dataset.id;
  if(a==='close-dialog') { $('#form-dialog').close(); return; }
  if(a.endsWith('-form')) { openForm(a.replace('-form','')); return; }
  if(a==='inspect') { inspection=id; render(); return; }
  if(a==='close-inspection') { inspection=null; render(); return; }
  await action(async () => {
    if(a==='new-session') {
      sandboxSessions[page]={version:1,started_at:new Date().toISOString(),history:[]};
      try { sessionStorage.removeItem('fintech-demo-v1-'+page); } catch (_) {}
      inspection=null;
      await load(); toast('New sandbox ready. Only this tab’s session was reset.');
    }
    if(a==='incident') { const r=await api('/api/ledger/incident',{}); await load(); toast(r.message); }
    if(a==='retry') { await api(`/api/ledger/events/${encodeURIComponent(id)}/retry`,{}); await load(); toast('Recovered. Payment posted once; provider and ledger now reconcile.'); }
    if(a==='resolve-hold') { await api(`/api/ledger/holds/${encodeURIComponent(id)}/resolve`,{action:button.dataset.resolve,key:uid('resolve')}); await load(); toast('Reservation '+(button.dataset.resolve==='settle'?'settled.':'released.')); }
    if(a==='provider-refund') { await api('/api/ledger/provider-records',{record_id:uid('statement'),payment_id:id,kind:'refund',amount:Number(button.dataset.amount)}); await load(); toast('Simulated provider refund acknowledgment imported.'); }
  });
});
document.addEventListener('submit', event => {
  if(event.target.id==='ledger-form') {
    event.preventDefault(); const form=event.target;
    action(async () => {
      const fields=new FormData(form), amount=dollars(fields.get('amount')), kind=form.dataset.kind, key=form.dataset.key;
      if(kind==='refund') await api('/api/ledger/refunds',{payment_id:fields.get('payment'),amount,key});
      else if(kind==='hold') await api('/api/ledger/holds',{hold_id:key,amount});
      else {
        await api('/api/ledger/provider-records',{record_id:'statement_'+key,payment_id:key,kind:'deposit',amount});
        await api('/api/ledger/events',{event_id:'evt_'+key,payment_id:key,amount});
        await api('/api/ledger/events/evt_'+encodeURIComponent(key)+'/retry',{});
      }
      $('#form-dialog').close(); await load(); toast(kind==='refund'?'Refund posted. A reconciliation break remains until the simulated provider acknowledges it.':kind==='hold'?'Funds reserved.':'Deposit posted and reconciled.');
    });
  }
});
async function initialize() {
  const config=await fetch('/api/config').then(r=>r.json());
  publicDemo=config.public_demo;
  if (publicDemo) {
    $('#new-session').hidden=false;
    $('.sidebar-bottom').innerHTML='<span class="status-dot"></span>Your demo session<small>Synthetic funds · isolated to this tab</small>';
    $('.sandbox-label').textContent='PUBLIC SANDBOX';
    $('footer span').textContent='Synthetic USD · session saved in this tab';
  }
  await load();
}
initialize().catch(error => { $('#main').innerHTML='<div class="loading">Unable to load the demo. Please reload or start a new session.</div>'; toast(error.message,true); });
