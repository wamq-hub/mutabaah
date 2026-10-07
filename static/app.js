// واجهة متابعة مهام أعضاء هيئة التدريب
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => x == null ? '—' : Math.round(x * 100) + '%';
const lvl = x => x == null ? 'na' : x >= .8 ? 'ok' : x >= .5 ? 'mid' : 'bad';
const SPEEDS = ['سريع', 'متوسط', 'ضعيف', 'لا يوجد رد'];
const ST = { 'منجز': 'ok', 'معتمد': 'ok', 'سريع': 'ok', 'جزئي': 'mid', 'متوسط': 'mid', 'أدخل التاريخ': 'mid', 'بانتظار': 'na', '—': 'na',
  'لم ينجز': 'bad', 'ضعيف': 'bad', 'لا يوجد رد': 'bad', 'متأخر': 'bad', 'غير معتمد': 'bad', 'لم تُعبَّأ': 'bad' };
const badge = v => { v = v || '—'; return `<span class="badge ${ST[v] || 'na'}">${esc(v)}</span>`; };
const initials = n => { const w = String(n || '').replace(/^(م|أ|د)\.\s*/, '').trim().split(/\s+/); return (w[0] || '').slice(0, 1) + (w.length > 1 ? w[w.length - 1].slice(0, 1) : ''); };
let STATE = null, DASH = null, WEEK = null;
let UPLOAD_LABEL = 'نسخة مرفوعة';   // نسخة المتصفح تغيّرها (الملف مربوط من جهاز المستخدم)

function toast(t, err) { const e = $('#toast'); e.textContent = t; e.classList.toggle('err', !!err); e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), 2800); }
async function api(url, opt) { const r = await fetch(url, opt); try { return await r.json(); } catch (e) { return { ok: false, error: 'استجابة غير متوقعة من الخادم' }; } }
const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

// ═════════ التبويبات والوضع الليلي
function showTab(k) {
  const b = $(`#nav [data-s="${k}"]`); if (!b) return;
  $$('#nav button').forEach(x => x.classList.toggle('on', x === b));
  $$('section.view').forEach(s => s.classList.toggle('on', s.id === 's-' + k));
  if (k === 'reps') loadReports();
  if (k === 'issue') fillIssue();
  if (k === 'msgs' && !$('#msgOut').innerHTML) loadMsgs();
  // صفحتا «الفصول التدريبية» و«بنك المهام» في ملفين مستقلين تستمعان لهذا الحدث
  document.dispatchEvent(new CustomEvent('tasks:tab', { detail: k }));
  try { history.replaceState(null, '', '#' + k); } catch (e) { }
}
$('#nav').onclick = e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.s); };
function setThemeIcon() { $('#bTheme').textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'; }
$('#bTheme').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('tasks-theme', t); } catch (e) { } setThemeIcon(); };
setThemeIcon();

async function loadState() {
  STATE = await api('/api/state'); const c = STATE.config;
  $('#hSub').textContent = [c.dept && ('قسم ' + c.dept), c.college].filter(Boolean).join(' · ') || 'المهام الثابتة والطارئة والإبداعية — أسبوعاً بأسبوع';
  $('#hMeta').innerHTML = `تاريخ المتابعة<br><b>${esc(STATE.hijri_today)} هـ</b>${c.today ? ' (محدد يدوياً)' : ''}`;
  $('#cDept').value = c.dept; $('#cCollege').value = c.college; $('#cHead').value = c.head_name; $('#cToday').value = c.today || '';
  $('#cSem').innerHTML = STATE.semesters.map(s => `<option ${s === c.semester ? 'selected' : ''}>${s}</option>`).join('');
  $('#nTr').textContent = STATE.trainers.length;
  fillSemSel();
  renderTrainers();
}

// ═════════ الفصل التدريبي النشط (مُبدّل الرأس)
function fillSemSel() {
  const L = STATE.semester_list || [];
  $('#semSel').innerHTML = L.map(s => `<option value="${esc(s.id)}" ${s.id === STATE.active_semester ? 'selected' : ''}>${esc(s.title)}</option>`).join('');
}
async function activateSemester(id) {
  const r = await post('/api/semesters/' + encodeURIComponent(id) + '/activate', {});
  if (!r.ok) { toast(r.error, 1); return false; }
  WEEK = null; $('#msgOut').innerHTML = '';
  await loadState(); await loadDash(); renderTrainers(); if (typeof fillIssue === 'function') fillIssue();
  document.dispatchEvent(new CustomEvent('tasks:semester', { detail: id }));
  toast('الفصل المعروض: ' + ((STATE.semester_list || []).find(s => s.id === id) || {}).title);
  return true;
}
$('#semSel').onchange = e => activateSemester(e.target.value);

// ═════════ لوحة القسم
async function loadDash() {
  $('#tTr').innerHTML = '<tr><td class="empty">جارٍ قراءة ملفات المدربين…</td></tr>';
  DASH = await api('/api/dashboard');
  if (WEEK == null || !DASH.weeks.some(w => w.n === WEEK)) WEEK = DASH.current_week ?? (DASH.weeks[0] || {}).n;
  renderDash(); fillSelects();
}
const okTr = () => DASH.trainers.filter(t => !t.error);
const wOf = (t, n) => (t.weeks || []).find(w => w.n === n) || {};
function deptWeek(n) { let r = 0, a = 0; okTr().forEach(t => { const w = wOf(t, n); r += w.required || 0; a += w.approved || 0; }); return r ? a / r : null; }
function dist(k) { const tot = SPEEDS.reduce((s, x) => s + (k[x] || 0), 0); if (!tot) return '<span class="muted">—</span>';
  return `<div class="dist" title="${SPEEDS.map(s => s + ' ' + (k[s] || 0)).join('، ')}">${SPEEDS.map((s, i) => k[s] ? `<i class="s${i}" style="width:${k[s] / tot * 100}%"></i>` : '').join('')}</div>`; }
function prog(p, a, r) { return `<div class="prog"><b class="${lvl(p) === 'na' ? '' : lvl(p)}">${pct(p)}</b><div class="bar ${lvl(p) === 'bad' ? 'bad' : lvl(p) === 'mid' ? 'mid' : ''}"><i style="width:${(p || 0) * 100}%"></i></div><small>${a ?? 0} من ${r ?? 0}</small></div>`; }

function renderDash() {
  const D = DASH, T = D.trainers, ok = okTr(), cur = D.current_week;
  // شريط الأسابيع
  $('#weeks').innerHTML = D.weeks.map(w => {
    const p = w.started ? deptWeek(w.n) : null;
    return `<button class="wk ${w.n === WEEK ? 'on' : ''} ${w.n === cur ? 'cur' : ''} ${w.started ? '' : 'fut'}" data-w="${w.n}" title="${esc(w.note || '')}">
      ${w.note && /إجازة|لا دوام/.test(w.note) && w.n !== cur ? '<span class="off">إجازة</span>' : ''}
      <span class="no">${w.n === 0 ? 'ع' : w.n}</span><span class="t">${w.n === 0 ? 'أسبوع العودة' : 'الأسبوع ' + w.n}</span>
      <div class="d"><bdi>${esc((w.from || '').replace(/^\S+\s/, ''))}</bdi> – <bdi>${esc((w.to || '').replace(/^\S+\s/, ''))}</bdi></div>
      <div class="p">${w.started ? `<span>${pct(p)}</span><div class="bar ${lvl(p) === 'bad' ? 'bad' : lvl(p) === 'mid' ? 'mid' : ''}"><i style="width:${(p || 0) * 100}%"></i></div>` : '<span class="muted">لم يبدأ</span>'}</div></button>`;
  }).join('');
  const wsel = D.weeks.find(w => w.n === WEEK) || {};
  $('#wkInfo').innerHTML = wsel.title ? `<b>${esc(wsel.title)}</b> <span class="muted">${esc(wsel.from)} – ${esc(wsel.to)}</span>${wsel.note ? ` <span class="badge mid">${esc(wsel.note)}</span>` : ''}` : '';
  requestAnimationFrame(() => { const on = $('#weeks .wk.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' }); });

  // المؤشرات
  const sum = k => ok.reduce((a, t) => a + (wOf(t, WEEK)[k] || 0), 0);
  const semR = ok.reduce((a, t) => a + (t.total.required || 0), 0), semA = ok.reduce((a, t) => a + (t.total.approved || 0), 0);
  $('#dKpis').innerHTML = [
    [pct(wsel.started ? deptWeek(WEEK) : null), 'نسبة القسم في ' + (wsel.title || 'الأسبوع'), 'teal', `${sum('approved')} من ${sum('required')} مهمة`],
    [pct(semR ? semA / semR : null), 'نسبة القسم للفصل حتى الآن', 'ok', `${semA} من ${semR}`],
    [sum('pending'), 'بانتظار اعتمادك هذا الأسبوع', 'mid', ''],
    [ok.reduce((a, t) => a + t.overdue, 0), 'مهام متأخرة لم تُنجز', 'bad', 'في الفصل كله'],
    [ok.reduce((a, t) => a + t.no_evidence, 0), 'منجز بلا شاهد', 'steel', ''],
    [T.length, 'عدد المدربين', '', T.length - ok.length ? `تعذرت قراءة ${T.length - ok.length}` : 'كل الملفات مقروءة']
  ].map(([v, l, c, s]) => `<div class="kpi ${c}"><div class="v">${v}</div><div class="l">${esc(l)}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`).join('');

  if (!T.length) {
    $('#tTr').innerHTML = '<tr><td class="empty">لا يوجد مدربون بعد. أضفهم من تبويب «المدربون والملفات».</td></tr>';
    $('#tMap').innerHTML = ''; $('#dNeed').innerHTML = ''; return;
  }
  // المدربون في الأسبوع المختار
  $('#trTitle').textContent = 'المدربون في ' + (wsel.title || '');
  let h = '<thead><tr><th class="r">المدرب</th><th>الإنجاز المعتمد</th><th>بانتظار الاعتماد</th><th>سرعة الإنجاز</th><th>مرحّل مفتوح</th><th>متأخر الآن</th><th>نسبة الفصل</th><th>إبداعية</th><th></th></tr></thead><tbody>';
  for (const t of T) {
    const who = `<div class="who"><span class="av">${esc(initials(t.name))}</span><div><span class="nm" data-tr="${t.id}">${esc(t.short || t.name)}</span><div class="sm">${t.error ? `<span class="err">${esc(t.error)}</span>` : 'آخر تعديل ' + esc(t.mtime || '') + (t.mode === 'upload' ? ' · ' + UPLOAD_LABEL : '')}</div></div></div>`;
    if (t.error) { h += `<tr><td class="r">${who}</td><td colspan="7"></td><td><button class="btn sm" data-goto="files">إصلاح الربط</button></td></tr>`; continue; }
    const w = wOf(t, WEEK);
    h += `<tr><td class="r">${who}</td><td>${w.started ? prog(w.pct, w.approved, w.required) : '<span class="muted">لم يبدأ</span>'}</td>
      <td>${w.pending ? `<span class="badge mid">${w.pending}</span>` : (w.started ? 0 : '—')}</td><td>${w.started ? dist(w) : '—'}</td>
      <td>${w.carried ? `<span class="badge mid">${w.carried}</span>` : (w.started ? 0 : '—')}</td><td>${t.overdue ? `<span class="badge bad">${t.overdue}</span>` : 0}</td>
      <td><span class="cell ${lvl(t.total.pct)}">${pct(t.total.pct)}</span></td><td>${w.creative || 0}</td>
      <td><button class="btn sm" data-tr="${t.id}" data-wk="${WEEK}">التفاصيل</button></td></tr>`;
  }
  $('#tTr').innerHTML = h + '</tbody>';

  // خريطة الفصل
  const ws = D.weeks.filter(w => w.started);
  let m = '<thead><tr><th class="r">المدرب</th>' + ws.map(w => `<th class="${w.n === WEEK ? 'cur' : ''}" title="${esc(w.from + ' – ' + w.to)}">${w.n === 0 ? 'العودة' : w.n}</th>`).join('') + '<th>الفصل</th></tr></thead><tbody>';
  for (const t of ok) {
    m += `<tr><td class="r"><span class="who"><span class="nm" data-tr="${t.id}">${esc(t.short)}</span></span></td>` + ws.map(w => { const x = wOf(t, w.n);
      return `<td class="${w.n === WEEK ? 'cur' : ''}"><span class="cell ${lvl(x.pct)}" data-tr="${t.id}" data-wk="${w.n}" title="${x.approved ?? 0} من ${x.required ?? 0}">${pct(x.pct)}</span></td>`; }).join('')
      + `<td><b>${pct(t.total.pct)}</b></td></tr>`;
  }
  m += '<tr class="tot"><td class="r">القسم</td>' + ws.map(w => `<td class="${w.n === WEEK ? 'cur' : ''}">${pct(deptWeek(w.n))}</td>`).join('') + `<td>${pct(semR ? semA / semR : null)}</td></tr>`;
  $('#tMap').innerHTML = m + '</tbody>';

  // ما يلزم متابعته
  const need = T.filter(t => !t.error && (t.overdue || t.pending_approval || t.no_evidence || t.no_date));
  $('#dNeed').innerHTML = need.length ? '<div class="need">' + need.map(t => `<div class="it ${t.overdue ? 'bad' : ''}"><div class="who"><span class="av">${esc(initials(t.name))}</span><span class="nm" data-tr="${t.id}">${esc(t.short)}</span></div><div class="row">`
    + [t.overdue && `<span class="badge bad">متأخر ${t.overdue}</span>`, t.pending_approval && `<span class="badge mid">بانتظار اعتمادك ${t.pending_approval}</span>`,
      t.no_evidence && `<span class="badge br">بلا شاهد ${t.no_evidence}</span>`, t.no_date && `<span class="badge na">بلا تاريخ إنجاز ${t.no_date}</span>`].filter(Boolean).join('') + '</div></div>').join('') + '</div>'
    : '<div class="empty">لا يوجد ما يلزم متابعته.</div>';
}
$('#weeks').onclick = e => { const b = e.target.closest('.wk'); if (!b) return; WEEK = +b.dataset.w; renderDash(); };
document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto]'); if (g) { showTab(g.dataset.goto); return; }
  const a = e.target.closest('[data-tr]'); if (a && !a.closest('#panel')) openTrainer(a.dataset.tr, a.dataset.wk != null ? +a.dataset.wk : null);
});
$('#bRefresh').onclick = async () => { await loadDash(); toast('أُعيدت قراءة ملفات المدربين'); };

// ═════════ تفاصيل المدرب
let TR = null, TRW = null;
async function openTrainer(id, wk) {
  $('#panel').innerHTML = '<div class="mb empty">جارٍ القراءة…</div>'; $('#ov').classList.add('on'); document.body.style.overflow = 'hidden';
  TR = await api('/api/trainer/' + id); TRW = wk ?? TR.current_week ?? WEEK; renderTrainer();
}
function closeTrainer() { $('#ov').classList.remove('on'); document.body.style.overflow = ''; }
function evCell(t, who) {
  const txt = who === 'h' ? t.head_ev : t.evidence, url = who === 'h' ? t.head_ev_url : t.evidence_url, pics = who === 'h' ? t.head_pics : t.pics; let s = '';
  if (url) s += `<a href="${esc(url)}" target="_blank" title="${esc(url)}">🔗 ${esc(txt && txt !== url ? txt : 'رابط')}</a> `; else if (txt) s += esc(txt) + ' ';
  (pics || []).forEach(p => s += `<a href="/img/${p}" target="_blank"><img class="thumb" src="/img/${p}" alt="صورة الشاهد"></a>`);
  return s ? `<span class="ev">${s}</span>` : '<span class="muted">—</span>';
}
function taskRows(list, carried) {
  return list.map(t => `<tr><td class="r">${esc(t.title)}${carried ? `<div class="muted">من ${esc(t.week_title)}</div>` : ''}</td>
    <td>${esc(t.due || (t.kind === 'ongoing' ? 'مستمرة' : '—'))}</td><td>${badge(t.status || 'لم تُعبَّأ')}</td><td>${esc(t.done || '—')}</td>
    <td class="r">${evCell(t, 't')}</td><td>${badge(t.speed)}${t.override ? '<div class="muted">عدّلها رئيس القسم</div>' : ''}</td>
    <td>${t.approval ? badge(t.approval) : '<span class="muted">—</span>'}</td><td class="r">${evCell(t, 'h')}</td><td class="r muted">${esc(t.notes || '')}</td></tr>`).join('');
}
function renderTrainer() {
  const T = TR;
  let h = `<div class="mh"><span class="av">${esc(initials(T.name))}</span><div><h3>${esc(T.name)}</h3><div class="sm">${esc(T.path || '')}</div></div>
    <div class="sp"><button class="btn ghost sm local-only" data-open="file">فتح الملف</button><button class="btn ghost sm local-only" data-open="folder">فتح المجلد</button><button class="btn ghost sm" id="tClose">✕ إغلاق</button></div></div><div class="mb">`;
  if (T.error) { $('#panel').innerHTML = h + `<p class="err">${esc(T.error)}</p></div>`; bindPanel(); return; }
  const t = T.total, sh = t.speed_share || {};
  h += '<div class="kpis">' + [[pct(t.pct), 'نسبة الإنجاز للفصل', 'teal', `${t.approved} من ${t.required}`], [T.overdue, 'متأخر الآن', 'bad', ''], [t.carried || 0, 'مرحّل مفتوح', 'mid', ''],
    [T.pending_approval, 'بانتظار اعتمادك', 'mid', ''], [T.no_evidence, 'منجز بلا شاهد', 'steel', ''], [t.creative, 'مهام إبداعية', 'ok', `المعتمد ${t.creative_approved || 0}`]]
    .map(([v, l, c, s]) => `<div class="kpi ${c}"><div class="v">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`).join('') + '</div>';
  h += `<div class="card"><h2>سرعة الإنجاز في الفصل <span class="sp muted">مؤشر البند 20 «إنجاز المهام في الوقت المحدد» في نموذج تقييم الأداء</span></h2>
    <div class="row" style="gap:16px">${dist(t).replace('min-width:110px', '')}<span class="legend">${SPEEDS.map((s, i) => `<span class="s${i}">${s} ${t[s] || 0} (${pct(sh[s])})</span>`).join('')}</span></div></div>`;
  h += `<div class="card"><h2>مهام الأسبوع</h2><div class="weekstrip">` + T.detail_weeks.map(w => `<button class="wk ${w.n === TRW ? 'on' : ''} ${w.n === T.current_week ? 'cur' : ''} ${w.started ? '' : 'fut'}" data-w="${w.n}">
      <span class="no">${w.n === 0 ? 'ع' : w.n}</span><span class="t">${w.n === 0 ? 'العودة' : 'الأسبوع ' + w.n}</span>
      <div class="p">${w.started && w.kpi.pct != null ? `<span>${pct(w.kpi.pct)}</span><div class="bar ${lvl(w.kpi.pct) === 'bad' ? 'bad' : lvl(w.kpi.pct) === 'mid' ? 'mid' : ''}"><i style="width:${w.kpi.pct * 100}%"></i></div>` : '<span class="muted">—</span>'}</div></button>`).join('') + '</div>';
  const w = T.detail_weeks.find(x => x.n === TRW) || T.detail_weeks[0], k = w.kpi || {};
  h += `<p style="margin:8px 0"><b>${esc(w.title)}</b> <span class="muted">${esc(w.from)} – ${esc(w.to)}</span> ${w.note ? `<span class="badge mid">${esc(w.note)}</span>` : ''}</p>`;
  if (w.started) h += `<div class="row" style="margin-bottom:10px">${prog(k.pct, k.approved, k.required)}<span class="badge mid">بانتظار الاعتماد ${k.pending}</span><span class="badge bad">غير منجز ${k.not_done}</span>${dist(k)}</div>`;
  const sec = n => w.tasks.filter(x => x.section === n);
  let body = ''; [['ثابتة', 'المهام الثابتة'], ['طارئة', 'المهام الطارئة'], ['إبداعية', 'المهام الإبداعية']].forEach(([s, l]) => { const L = sec(s); if (L.length) body += `<tr class="sec"><td colspan="9">${l} (${L.length})</td></tr>` + taskRows(L); });
  if (w.carried.length) body += `<tr class="sec"><td colspan="9">مرحّلة من أسابيع سابقة (${w.carried.length})</td></tr>` + taskRows(w.carried, true);
  h += `<div class="wrap"><table class="t"><thead><tr><th class="r">المهمة</th><th>آخر موعد</th><th>الحالة</th><th>تاريخ الإنجاز</th><th class="r">شاهد المدرب</th><th>السرعة</th><th>الاعتماد</th><th class="r">شاهد رئيس القسم</th><th class="r">ملاحظات</th></tr></thead><tbody>${body || '<tr><td colspan="9" class="empty">لا توجد مهام.</td></tr>'}</tbody></table></div>`;
  h += `<div class="row" style="margin-top:12px"><button class="btn t" data-trep="trainer-week">تقرير هذا الأسبوع</button><button class="btn" data-trep="trainer-semester">تقرير الفصل</button><span id="tRepMsg" class="muted"></span></div></div>`;
  const L = T.lists;
  h += '<div class="grid2">' + [['overdue', 'مهام متأخرة لم تُنجز', 'bad'], ['pending_approval', 'بانتظار اعتمادك', 'mid'], ['no_evidence', 'منجز بلا شاهد', 'br'], ['no_date', 'منجز بلا تاريخ إنجاز', 'na']]
    .map(([kk, l, c]) => `<div class="card"><h2>${l} <span class="sp"><span class="badge ${c}">${L[kk].length}</span></span></h2>${L[kk].length ? '<ul style="margin:0;padding-inline-start:18px">' + L[kk].map(x => `<li>${esc(x.title)} <span class="muted">— ${esc(x.week_title)}</span></li>`).join('') + '</ul>' : '<div class="muted">لا يوجد.</div>'}</div>`).join('') + '</div></div>';
  $('#panel').innerHTML = h; bindPanel();
}
function bindPanel() {
  $('#tClose').onclick = closeTrainer;
  $$('#panel .wk').forEach(b => b.onclick = () => { TRW = +b.dataset.w; renderTrainer(); });
  $$('#panel [data-open]').forEach(b => b.onclick = async () => { const r = await post('/api/open', { id: TR.id, what: b.dataset.open }); if (!r.ok) toast(r.error, 1); });
  $$('#panel [data-trep]').forEach(b => b.onclick = async () => {
    $('#tRepMsg').textContent = 'جارٍ الإصدار…';
    const r = await post('/api/report', { kind: b.dataset.trep, trainer: TR.id, week: TRW, pdf: true });
    $('#tRepMsg').innerHTML = r.ok ? r.files.map(f => `<a href="/reports/${encodeURI(f.html)}" target="_blank">فتح التقرير</a>` + (f.pdf ? ` · <a href="/reports/${encodeURI(f.pdf)}" target="_blank">PDF</a>` : '')).join(' ') : `<span class="err">${esc(r.error)}</span>`;
  });
}
$('#ov').onclick = e => { if (e.target.id === 'ov') closeTrainer(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTrainer(); });

// ═════════ المدربون والملفات
function renderTrainers() {
  const ts = STATE.trainers;
  if (!ts.length) { $('#trList').innerHTML = '<div class="empty">لا يوجد مدربون بعد.</div>'; return; }
  const st = id => (DASH && DASH.trainers.find(x => x.id === id)) || {};
  $('#trList').innerHTML = ts.map(t => { const s = st(t.id);
    const state = !t.path && t.mode !== 'upload' ? '<span class="badge na">لم يُحدَّد الملف</span>' : s.error ? `<span class="badge bad">${esc(s.error)}</span>` : t.mode === 'upload' ? '<span class="badge mid">نسخة مرفوعة</span>' : '<span class="badge ok">مربوط بمسار الملف</span>';
    return `<div class="person" data-id="${t.id}">
    <div class="hd"><span class="av">${esc(initials(t.name))}</span>
      <input class="in tName" value="${esc(t.name)}" style="min-width:220px;font-weight:600"><input class="in tEmail ltr" value="${esc(t.email || '')}" placeholder="البريد الإلكتروني" style="min-width:210px">
      ${state}<div class="sp"><button class="btn sm p" data-a="save">حفظ</button><button class="btn sm" data-a="up" title="تقديم">▲</button><button class="btn sm" data-a="down" title="تأخير">▼</button><button class="btn sm danger" data-a="del">حذف</button></div></div>
    <div class="pathrow local-only"><select class="in tMode"><option value="path" ${t.mode !== 'upload' ? 'selected' : ''}>مسار الملف (قراءة مباشرة)</option><option value="upload" ${t.mode === 'upload' ? 'selected' : ''}>نسخة مرفوعة</option></select>
      <input class="in ltr tPath" value="${esc(t.path || '')}" placeholder="C:\\...\\متابعة مهام - اسم المدرب.xlsx">
      <button class="btn sm" data-a="browse">استعراض…</button><button class="btn sm" data-a="check">تحقق</button>
      <button class="btn sm t" data-a="create">إنشاء ملفه من القالب…</button><button class="btn sm" data-a="open">فتح الملف</button></div>
    <div class="info tInfo">${t.mode === 'upload' ? `نسخة مرفوعة: ${esc(t.upload_name || '')} — ${esc(t.uploaded || '')}` : ''}</div>
    <div class="drop slim" data-dropfor="${t.id}">أو أفلت ملف هذا المدرب هنا</div></div>`; }).join('');
}
$('#bAdd').onclick = async () => {
  const name = $('#nName').value.trim(); if (!name) return toast('اكتب اسم المدرب', 1);
  const r = await post('/api/trainers', { name, email: $('#nEmail').value }); if (!r.ok) return toast(r.error, 1);
  $('#nName').value = ''; $('#nEmail').value = ''; await loadState(); toast('أُضيف المدرب');
};
$('#trList').addEventListener('click', async e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const it = b.closest('.person'), id = it.dataset.id, a = b.dataset.a, info = it.querySelector('.tInfo');
  const val = () => ({ id, name: it.querySelector('.tName').value, email: it.querySelector('.tEmail').value, path: it.querySelector('.tPath').value, mode: it.querySelector('.tMode').value });
  const refresh = async () => { await loadState(); await loadDash(); renderTrainers(); };
  if (a === 'save') { const r = await post('/api/trainers', val()); toast(r.ok ? 'حُفظ' : r.error, !r.ok); await refresh(); }
  if (a === 'browse') { info.textContent = 'إن لم تظهر نافذة الاختيار أمامك فافتحها من شريط المهام…'; const r = await post('/api/browse', { kind: 'file', initial: it.querySelector('.tPath').value }); info.textContent = '';
    if (r.path) { it.querySelector('.tPath').value = r.path; it.querySelector('.tMode').value = 'path'; it.querySelector('[data-a=check]').click(); } else if (!r.ok) toast(r.error, 1); }
  if (a === 'check') { const r = await post('/api/check', { path: it.querySelector('.tPath').value }); info.className = 'info tInfo' + (r.ok ? '' : ' err');
    info.innerHTML = r.ok ? `✔ ملف صحيح — الاسم داخل الملف: <b>${esc(r.name || '(فارغ)')}</b>${r.dept ? ' — ' + esc(r.dept) : ''}. اضغط «حفظ».` : esc(r.error); }
  if (a === 'del') { if (!confirm('حذف المدرب من البرنامج؟ لا يُحذف ملفه.')) return; await api('/api/trainers/' + id, { method: 'DELETE' }); await refresh(); }
  if (a === 'open') { const r = await post('/api/open', { id, what: 'file' }); if (!r.ok) toast(r.error, 1); }
  if (a === 'up' || a === 'down') { const ids = STATE.trainers.map(t => t.id); const i = ids.indexOf(id), j = a === 'up' ? i - 1 : i + 1; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await post('/api/trainers/order', { ids }); await refresh(); }
  if (a === 'create') { info.textContent = 'اختر مجلد المدرب…'; const f = await post('/api/browse', { kind: 'folder' }); if (!f.path) { info.textContent = ''; return; }
    await post('/api/trainers', val()); const r = await post('/api/create-file', { id, folder: f.path });
    info.className = 'info tInfo' + (r.ok ? '' : ' err'); info.innerHTML = r.ok ? `✔ أُنشئ الملف: ${esc(r.path)}` : esc(r.error); if (r.ok) await refresh(); }
});
async function upload(files, tid) {
  for (const f of files) { const fd = new FormData(); fd.append('file', f); if (tid) fd.append('trainer', tid);
    const r = await api('/api/upload', { method: 'POST', body: fd }); toast(r.ok ? `${f.name}: رُبط بـ ${r.trainer.name}${r.created ? ' (مدرب جديد)' : ''}` : r.error, !r.ok); }
  await loadState(); await loadDash(); renderTrainers();
}
document.addEventListener('dragover', e => { e.preventDefault(); const d = e.target.closest('.drop'); $$('.drop').forEach(x => x.classList.toggle('over', x === d)); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) $$('.drop').forEach(x => x.classList.remove('over')); });
document.addEventListener('drop', e => { e.preventDefault(); $$('.drop').forEach(x => x.classList.remove('over'));
  const files = [...e.dataTransfer.files].filter(f => /\.xlsx$/i.test(f.name)); if (!files.length) return toast('أفلت ملفات Excel فقط (xlsx)', 1);
  const d = e.target.closest('[data-dropfor]'); upload(files, d ? d.dataset.dropfor : ''); });
$('#bScanBrowse').onclick = async () => { const r = await post('/api/browse', { kind: 'folder' }); if (r.path) $('#scanDir').value = r.path; };
$('#bScan').onclick = async () => {
  $('#scanOut').innerHTML = '<div class="muted">جارٍ البحث…</div>';
  const r = await post('/api/scan', { folder: $('#scanDir').value });
  if (!r.ok) { $('#scanOut').innerHTML = `<div class="err">${esc(r.error)}</div>`; return; }
  if (!r.found.length) { $('#scanOut').innerHTML = '<div class="muted">لم يُعثر على ملفات من القالب.</div>'; return; }
  $('#scanOut').innerHTML = '<div class="wrap"><table class="t"><thead><tr><th class="r">الاسم داخل الملف</th><th class="r">المسار</th><th></th></tr></thead><tbody>' + r.found.map((x, i) =>
    `<tr><td class="r"><b>${esc(x.name || '(فارغ)')}</b></td><td class="r" style="direction:ltr;font-size:.78rem">${esc(x.path)}</td><td>${x.linked ? '<span class="badge ok">مربوط</span>' : `<button class="btn sm t" data-link="${i}">ربط</button>`}</td></tr>`).join('') + '</tbody></table></div>';
  $$('#scanOut [data-link]').forEach(b => b.onclick = async () => { const x = r.found[+b.dataset.link];
    const ex = STATE.trainers.find(t => t.name.replace(/\s+/g, '') === (x.name || '').replace(/\s+/g, ''));
    const res = await post('/api/trainers', { id: ex ? ex.id : undefined, name: x.name || 'مدرب', path: x.path, mode: 'path' });
    if (res.ok) { b.outerHTML = '<span class="badge ok">رُبط</span>'; await loadState(); await loadDash(); renderTrainers(); } else toast(res.error, 1); });
};

// ═════════ المراسلات
function fillSelects() {
  if (!DASH) return;
  const o = DASH.weeks.map(w => `<option value="${w.n}" ${w.n === DASH.current_week ? 'selected' : ''}>${esc(w.title)}</option>`).join('');
  ['#mWeek', '#rWeek'].forEach(s => { const v = $(s).value; $(s).innerHTML = o; if (v) $(s).value = v; });
  const v = $('#rTr').value; $('#rTr').innerHTML = DASH.trainers.map(t => `<option value="${t.id}">${esc(t.short || t.name)}</option>`).join(''); if (v) $('#rTr').value = v;
}
let MSGS = [], MKIND = '';
const KL = { remind: 'تذكير', late: 'متأخر', summary: 'ملخص', all: 'عامة', agent: 'للوكيل' };
async function loadMsgs() { $('#msgOut').innerHTML = '<div class="card empty">جارٍ التجهيز…</div>'; const r = await api('/api/messages?week=' + $('#mWeek').value); MSGS = r.messages || []; renderMsgs(); }
function renderMsgs() {
  const L = MSGS.filter(m => !MKIND || m.kind === MKIND);
  $('#msgOut').innerHTML = L.length ? L.map((m, i) => `<div class="msg"><div class="h"><span class="av" style="width:28px;height:28px;font-size:.72rem">${esc(initials(m.label))}</span><b>${esc(m.label)}</b><span class="badge br">${KL[m.kind] || ''}</span>${m.to ? `<span class="muted ltr">${esc(m.to)}</span>` : ''}
    <span class="sp">${m.to ? `<button class="btn sm" data-cp="to" data-i="${i}">نسخ المستلم</button>` : ''}<button class="btn sm" data-cp="subject" data-i="${i}">نسخ الموضوع</button><button class="btn sm p" data-cp="body" data-i="${i}">نسخ النص</button></span></div>
    <div class="subj"><b>الموضوع:</b> ${esc(m.subject)}</div><pre>${esc(m.body)}</pre></div>`).join('') : '<div class="card empty">لا توجد رسائل لهذا الاختيار.</div>';
  $$('#msgOut [data-cp]').forEach(b => b.onclick = async () => { const m = L[+b.dataset.i]; try { await navigator.clipboard.writeText(m[b.dataset.cp]); toast('نُسخ'); } catch (e) { toast('تعذر النسخ', 1); } });
}
$('#mWeek').onchange = loadMsgs;
$('#mKinds').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; MKIND = c.dataset.k; $$('#mKinds .chip').forEach(x => x.classList.toggle('on', x === c)); renderMsgs(); };

// ═════════ التقارير
$$('[data-rep]').forEach(b => b.onclick = async () => {
  $('#repMsg').innerHTML = '<div class="muted">جارٍ الإصدار… (ملف PDF يأخذ ثوانيَ لكل تقرير)</div>';
  const r = await post('/api/report', { kind: b.dataset.rep, week: +$('#rWeek').value, trainer: $('#rTr').value, pdf: $('#rPdf').checked });
  $('#repMsg').innerHTML = r.ok ? '<ul style="margin:0">' + r.files.map(f => `<li><a href="/reports/${encodeURI(f.html)}" target="_blank">${esc(f.html.split('/').pop().replace('.html', ''))}</a>${f.pdf ? ` · <a href="/reports/${encodeURI(f.pdf)}" target="_blank">PDF</a>` : ($('#rPdf').checked ? ' <span class="err">(تعذر إنشاء PDF، اطبعه من صفحة التقرير)</span>' : '')}</li>`).join('') + '</ul>' : `<div class="err">${esc(r.error)}</div>`;
  loadReports();
});
async function loadReports() {
  const r = await api('/api/reports');
  $('#repList').innerHTML = r.files.length ? '<div class="wrap"><table class="t"><thead><tr><th class="r">التقرير</th><th>التاريخ</th><th>الوقت</th><th></th></tr></thead><tbody>' + r.files.map(f => `<tr><td class="r"><a href="/reports/${encodeURI(f.html)}" target="_blank">${esc(f.html.split('/').pop().replace('.html', ''))}</a></td><td class="muted">${esc(f.html.split('/')[0])}</td><td class="muted">${esc(f.time.split(' ')[1] || '')}</td><td>${f.pdf ? `<a class="btn sm" href="/reports/${encodeURI(f.pdf)}" target="_blank">PDF</a>` : ''}</td></tr>`).join('') + '</tbody></table></div>' : '<div class="empty">لم تُصدر تقارير بعد.</div>';
}

// ═════════ الإصدار والقفل
function fillIssue() {
  if (!STATE) return;
  const box = (sel, checked) => { const old = new Set($$(sel + ' input:checked').map(i => i.value)), first = !$(sel).children.length;
    $(sel).innerHTML = STATE.trainers.map(t => `<label><input type="checkbox" value="${t.id}" ${first ? (checked ? 'checked' : '') : (old.has(t.id) ? 'checked' : '')}> ${esc(t.name)}</label>`).join('') || '<span class="muted">لا يوجد مدربون مسجلون بعد.</span>'; };
  box('#isTr', true); box('#lkTr', true);
  if (DASH) { const on = new Set($$('#lkWeeks .chip.on').map(c => +c.dataset.w));
    $('#lkWeeks').innerHTML = DASH.weeks.map(w => `<span class="chip ${on.has(w.n) ? 'on' : ''} ${w.started ? '' : 'off'}" data-w="${w.n}">${w.n === 0 ? 'العودة' : w.n}</span>`).join(''); }
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-all]'); if (a) $$(a.dataset.all + ' input').forEach(i => i.checked = true);
  const n = e.target.closest('[data-none]'); if (n) { $$(n.dataset.none + ' input').forEach(i => i.checked = false); $$(n.dataset.none + ' .chip').forEach(c => c.classList.remove('on')); }
  const p = e.target.closest('[data-pick]'); if (p) post('/api/browse', { kind: 'folder' }).then(r => { if (r.path) $(p.dataset.pick).value = r.path; else if (!r.ok) toast(r.error, 1); });
});
$('#lkWeeks').onclick = e => { const c = e.target.closest('.chip'); if (c) c.classList.toggle('on'); };
$('#lkDone').onclick = () => { if (!DASH) return; $$('#lkWeeks .chip').forEach(c => { const w = DASH.weeks.find(x => x.n === +c.dataset.w); c.classList.toggle('on', !!(w && w.started && w.n !== DASH.current_week)); }); };
function pwOk(a, b) { const p = $(a).value, q = $(b).value; if (p !== q) { toast('الرقم السري وتأكيده غير متطابقين', 1); return null; } return p; }
function resultBox(r, title) {
  return `<div class="result"><b>${esc(title)}</b> — <a class="btn sm p" href="${encodeURI(r.zip)}">تنزيل الملفات (zip)</a>${r.folder ? ` <span class="muted">ونسخة في: <span class="ltr">${esc(r.folder)}</span></span>` : ''}
    <ul>${(r.files || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul>${(r.placed || []).length ? `<div class="muted">حُفظت ${r.placed.length} نسخة بجانب ملفات المدربين.</div>` : ''}
    ${(r.skipped || []).length ? `<div class="err">${r.skipped.map(esc).join('<br>')}</div>` : ''}</div>`;
}
$('#bIssue').onclick = async () => {
  const pw = pwOk('#isPw', '#isPw2'); if (pw == null) return;
  const ids = $$('#isTr input:checked').map(i => i.value), names = $('#isNames').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!ids.length && !names.length) return toast('اختر مدرباً أو اكتب الأسماء', 1);
  $('#isMsg').textContent = 'جارٍ إنشاء الملفات… (ثوانٍ لكل ملف)'; $('#bIssue').disabled = true;
  const r = await post('/api/issue', { ids, names, kind: $('input[name=isKind]:checked').value, password: pw, folder: $('#isFolder').value, link: $('#isLink').checked });
  $('#bIssue').disabled = false; $('#isMsg').textContent = '';
  $('#isOut').innerHTML = r.ok ? resultBox(r, `أُصدر ${r.count} ملف${pw ? ' محمي بالرقم السري' : ''}`) : `<div class="err">${esc(r.error)}</div>`;
  if (r.ok) { $('#isNames').value = ''; await loadState(); await loadDash(); renderTrainers(); fillIssue(); }
};
$('#bLock').onclick = async () => {
  const pw = pwOk('#lkPw', '#lkPw2'); if (pw == null) return; if (!pw) return toast('اكتب الرقم السري', 1);
  const ids = $$('#lkTr input:checked').map(i => i.value); if (!ids.length) return toast('اختر مدرباً واحداً على الأقل', 1);
  const weeks = $$('#lkWeeks .chip.on').map(c => +c.dataset.w);
  $('#lkMsg').textContent = 'جارٍ القفل…'; $('#bLock').disabled = true;
  const r = await post('/api/lock', { ids, weeks, password: pw, beside: $('#lkBeside').checked });
  $('#bLock').disabled = false; $('#lkMsg').textContent = '';
  $('#lkOut').innerHTML = r.ok ? resultBox(r, `أُنشئت ${r.files.length} نسخة مقفلة` + (weeks.length ? ` — الأسابيع المقفلة كاملة: ${weeks.map(w => w === 0 ? 'العودة' : w).join('، ')}` : '')) : `<div class="err">${esc(r.error)}</div>`;
};

// ═════════ الإعدادات
$('#bCfg').onclick = async () => {
  const r = await post('/api/config', { dept: $('#cDept').value, college: $('#cCollege').value, head_name: $('#cHead').value, semester: $('#cSem').value, today: $('#cToday').value });
  $('#cfgMsg').textContent = r.ok ? 'حُفظ' : 'تعذر الحفظ'; await loadState(); await loadDash();
};

loadState().then(loadDash).then(() => { renderTrainers(); const h = decodeURIComponent(location.hash.slice(1)); if (h.startsWith('tr=')) openTrainer(h.slice(3)); else if (h) showTab(h); });
