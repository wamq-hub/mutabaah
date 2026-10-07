// صفحة «الفصول التدريبية»: قائمة الفصول + محرر الفصل مع معاينة الأسابيع.
// في نسخة المتصفح قد يُحمَّل هذا الملف قبل app.js وقبل جاهزية الخادم، لذلك لا يُستعمل أي شيء
// من app.js ($ و api و post و toast و STATE ...) إلا داخل المعالجات، ولا يُسجَّل عند التحميل إلا مستمعا الأحداث.
(() => {
  const S = { list: null, terms: ['الأول', 'الثاني', 'الصيفي'], maxWeeks: 25, active: null, ed: null, timer: null, seq: 0, busy: false };

  // ───────── التواريخ (ميلادي ISO ← هجري أم القرى)
  const D = iso => new Date(iso + 'T12:00:00Z');
  const isoOf = d => d.toISOString().slice(0, 10);
  const addDays = (iso, n) => { const d = D(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
  const validIso = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && !isNaN(D(iso));
  const dow = iso => D(iso).getUTCDay();
  let HF = null, HP = null;
  function hijri(iso) {
    if (!validIso(iso)) return '';
    try {
      HF = HF || new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
      return HF.format(D(iso));
    } catch (e) { return ''; }
  }
  function hParts(iso) {   // {d, m, y} هجرية بالأرقام
    HP = HP || new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const o = {}; HP.formatToParts(D(iso)).forEach(p => { if (p.type === 'day') o.d = +p.value; if (p.type === 'month') o.m = +p.value; if (p.type === 'year') o.y = parseInt(p.value, 10); });
    return o;
  }
  function nextHijriYear(iso) {   // التاريخ الميلادي لليوم الهجري نفسه في العام التالي (تقريبي عند نهاية الشهر)
    if (!validIso(iso)) return iso;
    try {
      const h = hParts(iso);
      for (const k of [354, 355, 353, 356]) { const c = addDays(iso, k), p = hParts(c); if (p.d === h.d && p.m === h.m && p.y === h.y + 1) return c; }
    } catch (e) { }
    return addDays(iso, 354);
  }
  const nearestSunday = iso => { const w = dow(iso); return addDays(iso, w <= 3 ? -w : 7 - w); };
  const n0 = n => n === 0 ? 'العودة' : String(n);

  // ───────── نافذة التأكيد
  function ask(title, html, okText, danger) {
    return new Promise(res => {
      const o = document.createElement('div'); o.className = 'sm-dlg';
      o.innerHTML = `<div class="sm-box" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3><div class="sm-dtx">${html}</div>
        <div class="row sm-dact"><button class="btn ${danger ? 'sm-dng' : 'p'}" data-a="1">${esc(okText)}</button><button class="btn" data-a="0">تراجع</button></div></div>`;
      const key = e => { if (e.key === 'Escape') done(false); };
      const done = v => { o.remove(); document.removeEventListener('keydown', key); res(v); };
      o.addEventListener('click', e => { if (e.target === o) return done(false); const b = e.target.closest('[data-a]'); if (b) done(b.dataset.a === '1'); });
      document.addEventListener('keydown', key);
      document.body.appendChild(o); o.querySelector('[data-a="1"]').focus();
    });
  }

  // ───────── هيكل الصفحة
  function shell() {
    const sec = $('#s-sems');
    sec.innerHTML = `
      <div id="smEdWrap"></div>
      <div class="sm-top">
        <div class="card">
          <h2>الفصول التدريبية <span class="sp"><button class="btn p" id="smNew">＋ إضافة فصل جديد</button></span></h2>
          <p class="hint">لكل فصل تقويمه: بداية الأسبوع الأول وعدد الأسابيع وفترات الإجازة والإجازات المفردة. الفصل النشط هو المعروض في اللوحة والتقارير، وتُصدر ملفات المدربين له.</p>
          <div id="smOut"></div>
          <div class="sm-list" id="smList"><div class="empty">جارٍ التحميل…</div></div>
        </div>
        <div class="card sm-guide">
          <h2>خطوات بدء فصل جديد</h2>
          <ol class="sm-steps">
            <li><b>أضف الفصل هنا</b> من التقويم التدريبي المعتمد: بداية الأسبوع الأول وعدد الأسابيع وإجازات الأعياد وما في تعميم الإجازات الإضافية.</li>
            <li><b>راجع المعاينة</b> وتأكد من أن عدد الأسابيع وأيام العمل مطابقان للتقويم، ثم احفظ.</li>
            <li><b>فعّل الفصل</b> ليصبح هو المعروض في اللوحة والتقارير.</li>
            <li><b>أصدر ملفات المدربين</b> للفصل الجديد من صفحة «<a href="#issue" data-goto="issue">الإصدار والقفل</a>».</li>
            <li><b>أرشف الفصل المنتهي</b> لتبقى نتائجه وتقاريره محفوظة في البرنامج ولو تغيّرت ملفات المدربين.</li>
          </ol>
          <p class="hint">المرجع في التواريخ: التقويم التدريبي المعتمد للمنشآت التدريبية، وتعميم الإجازات الإضافية للعام التدريبي.</p>
        </div>
      </div>`;
    $('#smNew').onclick = () => openNew();
    $('#smList').addEventListener('click', onListClick);
  }

  async function render() {
    if (!$('#smList')) shell();
    const r = await api('/api/semesters');
    if (!r || !r.semesters) { $('#smList').innerHTML = `<div class="empty err">${esc((r && r.error) || 'تعذّر قراءة الفصول')}</div>`; return; }
    S.list = r.semesters; S.active = r.active; S.terms = r.terms || S.terms; S.maxWeeks = r.max_weeks || S.maxWeeks;
    renderList();
  }

  function renderList() {
    const L = [...S.list].sort((a, b) => String(a.start || '9').localeCompare(String(b.start || '9')));
    if (!L.length) { $('#smList').innerHTML = '<div class="empty">لا توجد فصول بعد. ابدأ بـ«إضافة فصل جديد».</div>'; return; }
    const editing = S.ed && S.ed.id;
    $('#smList').innerHTML = L.map(s => {
      const files = s.trainer_files || 0;
      return `<article class="sm-card ${s.active ? 'on' : ''} ${editing === s.id ? 'ed' : ''}" data-id="${esc(s.id)}">
        <div class="sm-hd"><h3>${esc(s.title)}</h3>${s.active ? '<span class="badge ok sm-act">الفصل النشط</span>' : ''}</div>
        <div class="sm-tags"><span class="badge br">الفصل ${esc(s.term || '—')}</span><span class="badge na">${esc(s.year || '—')}هـ</span>${s.has_return ? '<span class="badge mid">أسبوع عودة</span>' : ''}</div>
        ${s.error ? `<p class="err sm-e">تعذّر حساب أسابيع الفصل: ${esc(s.error)}</p>` : `
        <dl class="sm-meta">
          <div class="w"><dt>من</dt><dd>${esc(s.from)}</dd></div>
          <div class="w"><dt>إلى</dt><dd>${esc(s.to)}</dd></div>
          <div><dt>الأسابيع</dt><dd>${s.weeks ?? '—'}</dd></div>
          <div><dt>ملفات المدربين</dt><dd>${files}</dd></div>
          <div><dt>المؤرشفة</dt><dd>${s.archived || 0}${files ? ' من ' + files : ''}</dd></div>
        </dl>`}
        <div class="sm-acts">
          ${s.active ? '' : '<button class="btn t sm" data-act="activate">تفعيل</button>'}
          <button class="btn sm" data-act="edit">تعديل</button>
          <button class="btn sm" data-act="copy">نسخة لفصل جديد</button>
          <button class="btn sm" data-act="archive" ${files ? '' : 'disabled title="لا توجد ملفات مدربين في هذا الفصل"'}>أرشفة الفصل</button>
          <button class="btn sm danger" data-act="delete" ${s.active ? 'disabled title="لا يُحذف الفصل النشط؛ فعّل فصلاً آخر أولاً"' : ''}>حذف</button>
        </div>
      </article>`;
    }).join('');
  }

  async function onListClick(e) {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const id = b.closest('[data-id]').dataset.id, s = S.list.find(x => x.id === id) || { id, title: id };
    const act = b.dataset.act;
    if (act === 'edit') return openEdit(id);
    if (act === 'copy') return openCopy(id);
    if (act === 'activate') {
      b.disabled = true;
      const ok = await activateSemester(id);
      if (!ok) b.disabled = false;
      await render();   // يتكرر أيضاً عبر حدث tasks:semester؛ لا ضرر
      return;
    }
    if (act === 'archive') {
      const yes = await ask('أرشفة ' + s.title,
        `<p>تحفظ الأرشفة داخل البرنامج <b>نسخة ثابتة من ملف كل مدرب</b> في هذا الفصل، ويقرأ البرنامج هذه النسخة بعد ذلك، فتبقى نتائج الفصل وتقاريره كما هي ولو عُدِّل الملف الأصلي أو نُقل أو حُذف.</p>
         <ul><li>لا يتغير شيء في ملفات المدربين نفسها.</li><li>المدرب المؤرشف سابقاً لا يُعاد نسخ ملفه.</li><li>رفع نسخة جديدة لمدرب لاحقاً يُلغي أرشفته ويعتمد النسخة الجديدة.</li></ul>
         <p class="muted">يُنصح بها عند انتهاء الفصل واعتماد نتائجه.</p>`, 'أرشفة الفصل');
      if (!yes) return;
      b.disabled = true;
      const r = await post('/api/semesters/' + encodeURIComponent(id) + '/archive', {});
      if (!r.ok) { toast(r.error || 'تعذّرت الأرشفة', 1); b.disabled = false; return; }
      const a = r.archived || [], k = r.skipped || [];
      $('#smOut').innerHTML = `<div class="result sm-res"><b>أرشفة ${esc(s.title)}:</b> ${a.length ? `أُرشف ${a.length} ملف` : 'لم يُؤرشف ملف جديد (الملفات مؤرشفة من قبل أو غير متاحة)'}.
        ${a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${k.length ? `<div class="err" style="margin-top:6px">لم يُؤرشف:</div><ul>${k.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <button class="btn sm" data-x style="margin-top:6px">إخفاء</button></div>`;
      $('#smOut [data-x]').onclick = () => { $('#smOut').innerHTML = ''; };
      toast(a.length ? `أُرشف ${a.length} ملف` : 'لا ملفات جديدة للأرشفة');
      await render(); await loadState();
      return;
    }
    if (act === 'delete') {
      const yes = await ask('حذف ' + s.title,
        `<p>سيُحذف تقويم هذا الفصل من البرنامج. لا يمكن التراجع عن ذلك، ويمكن إضافته من جديد عند الحاجة.</p>
         <p class="muted">لا يُحذف الفصل النشط، ولا الفصل الذي فيه ملفات للمدربين.</p>`, 'حذف الفصل', true);
      if (!yes) return;
      const r = await api('/api/semesters/' + encodeURIComponent(id), { method: 'DELETE' });
      if (!r.ok) { toast(r.error || 'تعذّر الحذف', 1); $('#smOut').innerHTML = `<p class="err sm-res">${esc(r.error || 'تعذّر الحذف')}</p>`; return; }
      if (S.ed && S.ed.id === id) closeEditor();
      $('#smOut').innerHTML = '';
      toast('حُذف الفصل: ' + s.title);
      await render(); await loadState();
    }
  }

  // ───────── المحرر
  const suggestTitle = (term, year) => `الفصل التدريبي ${term} ${year}هـ`;
  async function latestSpec() {
    const L = [...(S.list || [])].filter(s => !s.error).sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')));
    if (!L.length) return null;
    const r = await api('/api/semesters/' + encodeURIComponent(L[0].id));
    return r.ok ? r.spec : null;
  }
  const idOf = (term, year) => `${year}_${S.terms.indexOf(term) + 1}`;
  function nextFree(ti, y) {   // أول فصل غير موجود بدءاً من (ti, y)
    const ids = new Set((S.list || []).map(s => s.id));
    for (let k = 0; k < 9 && ids.has(`${y}_${ti + 1}`); k++) { ti++; if (ti >= S.terms.length) { ti = 0; y++; } }
    return { term: S.terms[ti], year: String(y) };
  }

  async function openNew() {
    if (!(await leaveEditor())) return;
    const base = await latestSpec();
    let t = { term: S.terms[0], year: '1448' };
    if (base) { let ti = S.terms.indexOf(base.term) + 1, y = +base.year; if (ti >= S.terms.length) { ti = 0; y++; } t = nextFree(ti, y); }
    openEditor({ id: null, spec: { term: t.term, year: t.year, title: '', week1_start: '', weeks_count: t.term === 'الصيفي' ? 8 : 19, return_start: null,
      apply_except_west: base ? base.apply_except_west : true, breaks: [], holidays: [], notes: {}, sources: base ? base.sources : [] } });
  }

  async function openEdit(id) {
    if (!(await leaveEditor())) return;
    const r = await api('/api/semesters/' + encodeURIComponent(id));
    if (!r.ok) { toast(r.error || 'تعذّر فتح الفصل', 1); return; }
    openEditor({ id, spec: r.spec, titleTouched: r.spec.title !== suggestTitle(r.spec.term, r.spec.year) });
  }

  async function openCopy(id) {
    if (!(await leaveEditor())) return;
    const r = await api('/api/semesters/' + encodeURIComponent(id));
    if (!r.ok) { toast(r.error || 'تعذّر فتح الفصل', 1); return; }
    const src = r.spec, t = nextFree(S.terms.indexOf(src.term), +src.year + 1), same = t.term === src.term;
    const years = +t.year - +src.year;
    const mv = iso => { if (!validIso(iso)) return iso; for (let i = 0; i < years; i++) iso = nextHijriYear(iso); return iso; };
    const spec = {
      term: t.term, year: t.year, title: '', weeks_count: src.weeks_count, apply_except_west: src.apply_except_west,
      notes: { ...(src.notes || {}) }, sources: [...(src.sources || [])],
      week1_start: same && src.week1_start ? nearestSunday(mv(src.week1_start)) : '',
      return_start: same && src.return_start ? nearestSunday(mv(src.return_start)) : null,
      breaks: same ? (src.breaks || []).map(b => ({ from: mv(b.from), to: mv(b.to), name: b.name })) : [],
      holidays: same ? (src.holidays || []).map(h => ({ date: mv(h.date), name: h.name, scope: h.scope })) : [],
    };
    const note = same
      ? `نُسخت بيانات «${esc(src.title)}» إلى العام ${esc(t.year)}هـ، ونُقلت التواريخ تقريبياً إلى اليوم الهجري نفسه في العام الجديد (وبداية الأسبوع إلى أقرب يوم أحد). <b>راجع كل التواريخ مع التقويم التدريبي المعتمد وتعميم الإجازات الإضافية قبل الحفظ</b>؛ فالإجازات ذات التاريخ الميلادي الثابت (مثل يوم التأسيس واليوم الوطني) تحتاج تصحيحاً يدوياً.`
      : `نُسخت إعدادات «${esc(src.title)}» (عدد الأسابيع والملاحظات والمصادر). الفصل المقابل في العام التالي موجود مسبقاً، فاقتُرح الفصل ${esc(t.term)} ${esc(t.year)}هـ؛ <b>أدخل تواريخه من التقويم التدريبي المعتمد</b>.`;
    openEditor({ id: null, spec, banner: note, dirty: true });
  }

  async function leaveEditor() {
    if (!S.ed || !S.ed.dirty) return true;
    return ask('تجاهل التعديلات؟', '<p>في المحرر تعديلات لم تُحفظ. هل تريد تركها؟</p>', 'تجاهل التعديلات', true);
  }
  function closeEditor() { clearTimeout(S.timer); S.seq++; S.ed = null; const w = $('#smEdWrap'); if (w) w.innerHTML = ''; if (S.list) renderList(); }

  const rowTpl = {
    brk: (b = {}) => `<div class="sm-rw" data-row="brk">
        <label class="f sm-d">من<input type="date" data-f="from" value="${esc(b.from || '')}"><small class="sm-hj"></small></label>
        <label class="f sm-d">إلى<input type="date" data-f="to" value="${esc(b.to || '')}"><small class="sm-hj"></small></label>
        <label class="f sm-n">اسم الإجازة<input data-f="name" value="${esc(b.name || '')}" placeholder="إجازة عيد الفطر"></label>
        <button class="btn sm danger sm-rm" data-rm title="حذف الفترة" aria-label="حذف الفترة">✕</button></div>`,
    hol: (h = {}) => `<div class="sm-rw" data-row="hol">
        <label class="f sm-d">التاريخ<input type="date" data-f="date" value="${esc(h.date || '')}"><small class="sm-hj"></small></label>
        <label class="f sm-n">اسم الإجازة<input data-f="name" value="${esc(h.name || '')}" placeholder="إجازة إضافية"></label>
        <label class="f sm-sc">تشمل<select data-f="scope"><option value="all" ${h.scope !== 'except_west' ? 'selected' : ''}>كل المناطق</option><option value="except_west" ${h.scope === 'except_west' ? 'selected' : ''}>عدا مكة والمدينة وجدة والطائف</option></select></label>
        <button class="btn sm danger sm-rm" data-rm title="حذف الإجازة" aria-label="حذف الإجازة">✕</button></div>`,
    note: (n = {}) => `<div class="sm-rw" data-row="note">
        <label class="f sm-wn">الأسبوع<input type="number" min="0" max="${S.maxWeeks}" data-f="n" value="${esc(n.n ?? '')}"></label>
        <label class="f sm-n">الملاحظة<input data-f="text" value="${esc(n.text || '')}" placeholder="بداية الاختبارات النهائية"></label>
        <button class="btn sm danger sm-rm" data-rm title="حذف الملاحظة" aria-label="حذف الملاحظة">✕</button></div>`,
  };

  function openEditor(ed) {
    S.ed = Object.assign({ dirty: false, titleTouched: false, banner: '' }, ed);
    const sp = ed.spec, isEdit = !!ed.id;
    const notes = Object.entries(sp.notes || {}).sort((a, b) => +a[0] - +b[0]).map(([n, text]) => ({ n, text }));
    $('#smEdWrap').innerHTML = `
    <div class="card sm-ed" id="smEd">
      <h2>${isEdit ? 'تعديل الفصل: ' + esc(sp.title) : 'فصل تدريبي جديد'} <span class="sp"><button class="btn p" data-ed="save">حفظ</button><button class="btn" data-ed="cancel">إلغاء</button></span></h2>
      ${ed.banner ? `<div class="sm-banner">${ed.banner}</div>` : ''}
      <div class="sm-edgrid">
        <div class="sm-form">
          <h3>البيانات الأساسية</h3>
          <div class="row">
            <label class="f">الفصل<select data-k="term" ${isEdit ? 'disabled' : ''}>${S.terms.map(t => `<option ${t === sp.term ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label class="f">العام التدريبي (هجري)<input data-k="year" inputmode="numeric" maxlength="4" value="${esc(sp.year || '')}" placeholder="1448" ${isEdit ? 'disabled' : ''}></label>
          </div>
          ${isEdit ? '<p class="hint">الفصل والعام ثابتان بعد الإنشاء؛ لفصل آخر استعمل «نسخة لفصل جديد».</p>' : ''}
          <div class="row" style="margin-top:8px"><label class="f">عنوان الفصل<input data-k="title" value="${esc(sp.title || '')}"></label></div>
          <div class="row" style="margin-top:8px;align-items:flex-start">
            <label class="f sm-d">بداية الأسبوع الأول (يوم أحد)<input type="date" data-k="week1" data-sun value="${esc(sp.week1_start || '')}"><small class="sm-hj"></small></label>
            <label class="f sm-wn">عدد الأسابيع<input type="number" data-k="count" min="1" max="${S.maxWeeks}" value="${esc(sp.weeks_count ?? '')}"></label>
            <label class="f sm-d">بداية أسبوع العودة (اختياري)<input type="date" data-k="ret" data-sun value="${esc(sp.return_start || '')}"><small class="sm-hj"></small></label>
          </div>
          <p class="hint">عدد الأسابيع لا يشمل أسبوع العودة ولا أسابيع الإجازات الكاملة؛ يتخطاها البرنامج تلقائياً.</p>
          <label class="chk sm-west"><input type="checkbox" data-k="west" ${sp.apply_except_west !== false ? 'checked' : ''}> المنشأة خارج مكة المكرمة والمدينة المنورة وجدة والطائف</label>
          <p class="hint">عند تحديده تُطبَّق الإجازات المحددة بـ«عدا مكة والمدينة وجدة والطائف».</p>

          <h3 class="sm-h3">فترات الإجازة <button class="btn sm" data-add="brk">＋ إضافة فترة</button></h3>
          <p class="hint">مثل إجازتي العيدين. الأسبوع الذي تقع أيامه الخمسة كلها في الإجازة لا يُحتسب، وما وقع منها داخل أسبوع دراسي يُخصم من أيام عمله.</p>
          <div class="sm-rows" data-rows="brk">${(sp.breaks || []).map(rowTpl.brk).join('')}</div>

          <h3 class="sm-h3">إجازات الأيام المفردة <button class="btn sm" data-add="hol">＋ إضافة إجازة</button></h3>
          <p class="hint">مثل يوم التأسيس والإجازات الإضافية في التعميم؛ يُخصم اليوم من أيام عمل أسبوعه.</p>
          <div class="sm-rows" data-rows="hol">${(sp.holidays || []).map(rowTpl.hol).join('')}</div>

          <h3 class="sm-h3">ملاحظات الأسابيع (اختياري) <button class="btn sm" data-add="note">＋ إضافة ملاحظة</button></h3>
          <p class="hint">تظهر بجانب الأسبوع في الملفات والتقارير. الأسبوع 0 هو أسبوع العودة.</p>
          <div class="sm-rows" data-rows="note">${notes.map(rowTpl.note).join('')}</div>

          <h3>المصادر</h3>
          <label class="f">مصدر في كل سطر<textarea data-k="src" rows="3" placeholder="التقويم التدريبي للمنشآت التدريبية…">${esc((sp.sources || []).join('\n'))}</textarea></label>
        </div>
        <div class="sm-prev">
          <h3>معاينة الأسابيع</h3>
          <div id="smPrev"><div class="empty">أدخل بداية الأسبوع الأول وعدد الأسابيع.</div></div>
        </div>
      </div>
      <div class="row sm-foot"><button class="btn p" data-ed="save">حفظ</button><button class="btn" data-ed="cancel">إلغاء</button><span class="muted" id="smMsg"></span></div>
    </div>`;
    const box = $('#smEd');
    box.addEventListener('input', onEdInput);
    box.addEventListener('change', onEdInput);
    box.addEventListener('click', onEdClick);
    if (!S.ed.titleTouched && !sp.title) box.querySelector('[data-k=title]').value = suggestTitle(sp.term, sp.year);
    box.querySelectorAll('input[type=date]').forEach(updHj);
    if (S.list) renderList();
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    preview();
  }

  function updHj(inp) {
    const sm = inp.parentElement.querySelector('.sm-hj'); if (!sm) return;
    const v = inp.value;
    if (!v) { sm.textContent = ''; sm.className = 'sm-hj'; return; }
    const notSun = inp.hasAttribute('data-sun') && validIso(v) && dow(v) !== 0;
    sm.textContent = (hijri(v) || '') + (notSun ? ' — ليس يوم أحد' : '');
    sm.className = 'sm-hj' + (notSun ? ' warn' : '');
    inp.classList.toggle('sm-bad', notSun);
  }

  function onEdInput(e) {
    const t = e.target; if (!S.ed) return;
    S.ed.dirty = true;
    if (t.type === 'date') updHj(t);
    const k = t.dataset.k;
    if (k === 'title') S.ed.titleTouched = !!t.value.trim();
    if ((k === 'term' || k === 'year') && !S.ed.titleTouched) {
      const ed = $('#smEd'); ed.querySelector('[data-k=title]').value = suggestTitle(ed.querySelector('[data-k=term]').value, ed.querySelector('[data-k=year]').value.trim());
    }
    if (e.type === 'input' || t.tagName === 'SELECT' || t.type === 'checkbox') schedulePreview();
  }

  async function onEdClick(e) {
    const add = e.target.closest('[data-add]');
    if (add) {
      const k = add.dataset.add, box = $(`#smEd [data-rows="${k}"]`);
      box.insertAdjacentHTML('beforeend', rowTpl[k]());
      const row = box.lastElementChild; row.querySelector('input').focus();
      S.ed.dirty = true; return;
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) { rm.closest('.sm-rw').remove(); S.ed.dirty = true; schedulePreview(); return; }
    const b = e.target.closest('[data-ed]'); if (!b) return;
    if (b.dataset.ed === 'cancel') { if (await leaveEditor()) closeEditor(); return; }
    if (b.dataset.ed === 'save') save();
  }

  function rows(kind) {
    return [...document.querySelectorAll(`#smEd [data-rows="${kind}"] .sm-rw`)].map(r => {
      const o = {}; r.querySelectorAll('[data-f]').forEach(i => { o[i.dataset.f] = i.value.trim(); }); return o;
    });
  }
  function collect() {
    const ed = $('#smEd'), v = k => (ed.querySelector(`[data-k="${k}"]`).value || '').trim();
    const notes = {};
    rows('note').forEach(r => { if (r.n !== '' && r.text) notes[String(parseInt(r.n, 10))] = r.text; });
    const spec = {
      term: v('term'), year: v('year'), title: v('title'),
      week1_start: v('week1'), weeks_count: v('count') === '' ? null : +v('count'), return_start: v('ret') || null,
      apply_except_west: ed.querySelector('[data-k=west]').checked,
      breaks: rows('brk').filter(b => b.from || b.to || b.name).map(b => ({ from: b.from, to: b.to || b.from, name: b.name })),
      holidays: rows('hol').filter(h => h.date).map(h => ({ date: h.date, name: h.name, scope: h.scope })),
      notes, sources: v('src').split('\n').map(x => x.trim()).filter(Boolean),
    };
    if (S.ed.id) spec.id = S.ed.id;
    return spec;
  }
  function localError(sp) {   // أخطاء واضحة قبل سؤال الخادم
    if (!sp.week1_start) return 'أدخل بداية الأسبوع الأول وعدد الأسابيع.';
    if (sp.breaks.some(b => !b.from)) return 'أكمل تاريخ بداية كل فترة إجازة أو احذف الفترة الفارغة.';
    return '';
  }

  function schedulePreview() { clearTimeout(S.timer); S.timer = setTimeout(preview, 500); }
  async function preview() {
    if (!S.ed || !$('#smPrev')) return;
    const seq = ++S.seq, sp = collect(), out = $('#smPrev');
    const le = localError(sp);
    if (le) { out.innerHTML = `<div class="empty">${esc(le)}</div>`; return; }
    out.classList.add('busy');
    const r = await post('/api/semesters/preview', sp);
    if (seq !== S.seq || !$('#smPrev')) return;
    out.classList.remove('busy');
    if (!r.ok) { out.innerHTML = `<div class="sm-err" role="alert"><b>تعذّر حساب الأسابيع:</b> ${esc(r.error || '')}</div>`; return; }
    out.innerHTML = weeksView(r.weeks, sp);
  }

  function weeksView(W, sp) {
    const reg = W.filter(w => w.n > 0), ret = W.find(w => w.n === 0);
    const work = W.reduce((s, w) => s + (w.workdays || 0), 0), offW = W.filter(w => (w.off || []).length).length;
    let skipped = 0;
    if (reg.length && validIso(reg[0].start)) skipped = Math.round((D(reg[reg.length - 1].start) - D(reg[0].start)) / 864e5 / 7) + 1 - reg.length;
    const first = W[0], last = W[W.length - 1];
    return `<div class="sm-sum">
        <div><b>${reg.length}</b><span>أسبوعاً${ret ? ' + أسبوع العودة' : ''}</span></div>
        <div><b>${work}</b><span>يوم عمل</span></div>
        <div><b>${offW}</b><span>أسبوعاً فيه إجازة</span></div>
        <div><b>${Math.max(0, skipped)}</b><span>أسبوع إجازة لم يُحتسب</span></div>
      </div>
      <p class="sm-span">أول يوم: <b>${esc(first ? first.from : '—')}</b> &nbsp;·&nbsp; آخر يوم: <b>${esc(last ? last.to : '—')}</b></p>
      <div class="wrap sm-tbl"><table class="t">
        <thead><tr><th>الأسبوع</th><th>من</th><th>إلى</th><th>أيام العمل</th><th class="r">أيام الإجازة</th><th class="r">ملاحظة</th></tr></thead>
        <tbody>${W.map(w => {
          const off = w.off || [];
          return `<tr class="${w.n === 0 ? 'ret' : ''} ${off.length ? 'off' : ''}">
            <td title="${esc(w.title)}"><span class="sm-no">${n0(w.n)}</span></td>
            <td class="nw">${esc(w.from)}</td><td class="nw">${esc(w.to)}</td>
            <td><span class="badge ${w.workdays < 5 ? 'mid' : 'ok'}">${w.workdays}</span></td>
            <td class="r sm-off">${off.length ? off.map(x => `<div>${esc(x)}</div>`).join('') : '<span class="muted">—</span>'}</td>
            <td class="r sm-note">${w.note ? esc(w.note) : ''}</td></tr>`;
        }).join('')}</tbody></table></div>`;
  }

  async function save() {
    if (S.busy || !S.ed) return;
    const sp = collect(), msg = $('#smMsg');
    S.busy = true; $$('#smEd [data-ed=save]').forEach(b => b.disabled = true); msg.textContent = 'جارٍ الحفظ…';
    const r = await post('/api/semesters', sp);
    S.busy = false; $$('#smEd [data-ed=save]').forEach(b => b.disabled = false); msg.textContent = '';
    if (!r.ok) {
      toast(r.error || 'تعذّر الحفظ', 1);
      $('#smPrev').innerHTML = `<div class="sm-err" role="alert"><b>لم يُحفظ:</b> ${esc(r.error || '')}</div>`;
      return;
    }
    const wasActive = r.spec.id === S.active;
    toast('حُفظ الفصل: ' + r.spec.title);
    S.ed.dirty = false; closeEditor();
    await render(); await loadState();
    if (wasActive && typeof loadDash === 'function') await loadDash();
  }

  // ───────── الأحداث (التسجيل الوحيد عند التحميل)
  document.addEventListener('tasks:tab', e => { if (e.detail === 'sems') render(); });
  document.addEventListener('tasks:semester', () => { if ($('#smList')) render(); });
})();
