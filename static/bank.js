// بنك مهام القسم — يُعرَّف مرة واحدة وتُولَّد منه ملفات المدربين في كل فصل
// ملاحظة: في نسخة المتصفح قد يُحمَّل هذا الملف قبل app.js، لذا لا يُستعمل أي متغير عام منه إلا داخل المعالجات.
(() => {
  const BK = {
    loaded: false, bank: null, orig: '', open: new Set(), raw: {}, prevDue: {},
    meta: { terms: ['الأول', 'الثاني', 'الصيفي'], weekdays: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'] },
    psem: null, psemUser: false, pOpen: new Set(), pTimer: null, pSeq: 0, bound: false, onTab: false,
    // المهام المقترحة: المحدد للإضافة، والبحث، وتصفية الفصل، وإخفاء المضافة، والأسابيع المفتوحة
    sgSel: new Set(), sgQ: '', sgTerm: '', sgHide: false, sgOpen: new Set(), sgSig: '',
    // البطاقات المطوية (تُحفظ في المتصفح)، ومجموعات الطارئة المفتوحة (null = الفصل النشط فقط)
    fold: null, emOpen: null
  };
  const FOLD_KEY = 'tasks-bank-fold', FOLD_DEFAULT = ['set', 'em', 'prev'];
  function loadFold() {
    let v = null; try { v = JSON.parse(localStorage.getItem(FOLD_KEY)); } catch (e) { v = null; }
    BK.fold = new Set(Array.isArray(v) ? v : FOLD_DEFAULT);
  }
  function saveFold() { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...BK.fold])); } catch (e) { /* تخزين المتصفح غير متاح */ } }
  const foldBtn = k => `<button class="bk-fold" data-act="fold" data-fold="${k}" aria-label="طي أو فتح القسم"></button>`;
  function paintFold() {
    root().querySelectorAll('.card[data-card]').forEach(c => {
      const f = BK.fold.has(c.dataset.card); c.classList.toggle('folded', f);
      const b = c.querySelector('.bk-fold'); if (b) { b.setAttribute('aria-expanded', String(!f)); b.title = f ? 'فتح' : 'طي'; }
    });
  }
  function setFold(k, folded) { folded ? BK.fold.add(k) : BK.fold.delete(k); saveFold(); paintFold(); }
  const COUNTS = [
    ['emergency_rows', 'أسطر المهام الطارئة الظاهرة في كل أسبوع', 'أسطر فارغة يكتب فيها رئيس القسم ما يرد من مهام طارئة؛ وإن سُجّل للأسبوع عدد أكبر ظهرت كلها.'],
    ['emergency_spare_rows', 'أسطر طارئة احتياطية مخفية', 'أسطر مخفية تحت المهام الطارئة تُظهَر عند الحاجة إلى المزيد.'],
    ['fixed_spare_rows', 'أسطر احتياطية مخفية للمهام الثابتة', 'لإضافة مهمة ثابتة طارئة على أسبوع بعينه دون تعديل البنك.'],
    ['blank_fixed_rows', 'أسطر المهام الثابتة في القالب المفرغ', 'تظهر في القالب الفارغ (بلا مهام البنك) ليكتب فيها رئيس القسم مهامه يدوياً.'],
    ['creative_rows', 'أسطر المهام الإبداعية الظاهرة', 'يسجل فيها المدرب ما يقدمه من ندوات ودورات وورش عمل ومبادرات.'],
    ['creative_spare_rows', 'أسطر إبداعية احتياطية مخفية', 'أسطر مخفية تُظهَر عند الحاجة إلى المزيد من المهام الإبداعية.'],
    ['carried_rows', 'أسطر المهام المرحّلة في كل أسبوع', 'يظهر فيها أقدم المهام غير المنجزة من الأسابيع السابقة؛ وما زاد عليها يُنبَّه إليه في الملف.']
  ];
  const el = id => document.getElementById(id);
  const root = () => el('s-bank');
  const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x)
    ? Object.keys(x).sort().reduce((o, kk) => (o[kk] = x[kk], o), {}) : x);
  const dirty = () => !!BK.bank && canon(BK.bank) !== BK.orig;
  const isInt = x => Number.isInteger(x) && x >= 0;
  const digits = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const num = v => { v = digits(v).trim(); return /^\d+$/.test(v) ? +v : null; };
  const wl = n => n === 0 ? 'أسبوع العودة' : 'الأسبوع ' + n;
  // العدّ بالفصحى: مهمة واحدة، مهمتان، 3 مهام، 11 مهمة
  const cnt = (n, one, two, few, many) => n === 0 ? `لا ${one}` : n === 1 ? one + ' واحدة' : n === 2 ? two : n % 100 >= 3 && n % 100 <= 10 ? `${n} ${few}` : `${n} ${many}`;
  const nTasks = n => cnt(n, 'مهمة', 'مهمتان', 'مهام', 'مهمة');
  const nWeeks = n => n === 0 ? 'لا أسابيع' : n === 1 ? 'أسبوع واحد' : n === 2 ? 'أسبوعان' : n % 100 >= 3 && n % 100 <= 10 ? `${n} أسابيع` : `${n} أسبوعاً`;
  const termName = t => 'الفصل ' + t;
  const evalItems = () => (BK.bank && BK.bank.eval_items) || [];
  const evalName = n => (evalItems().find(x => x.n === n) || {}).name || '';
  const semList = () => (typeof STATE !== 'undefined' && STATE && STATE.semester_list) || [];
  const semTitle = id => (semList().find(s => s.id === id) || {}).title || id || 'فصل غير محدد';
  const activeSem = () => { const L = semList(); const a = typeof STATE !== 'undefined' && STATE && STATE.active_semester;
    return L.some(s => s.id === a) ? a : (L[0] || {}).id || null; };

  // ═════════ القراءة والملخصات
  function parseList(s) {
    const toks = digits(s).split(/[\s,،؛;]+/).filter(Boolean), bad = [], set = new Set();
    toks.forEach(x => /^\d+$/.test(x) ? set.add(+x) : bad.push(x));
    return { weeks: [...set].sort((a, b) => a - b), bad };
  }
  function weeksText(t) {
    const w = t.weeks || [];
    if (t.weeks_mode === 'list') {
      if (!w.length) return 'لم تُحدَّد أسابيع';
      const rest = w.filter(n => n !== 0), zero = w.includes(0);
      const r = rest.length === 1 ? 'الأسبوع ' + rest[0] : rest.length ? 'الأسابيع ' + rest.join('، ') : '';
      return zero ? (r ? 'أسبوع العودة و' + r : 'أسبوع العودة') : r;
    }
    const [a, b] = w;
    if (!isInt(a) || !isInt(b)) return 'مدى غير مكتمل';
    if (a === b) return wl(a);
    return a === 0 ? `من أسبوع العودة إلى الأسبوع ${b}` : `كل أسبوع ${a}–${b}`;
  }
  function dueText(d) {
    d = d || {};
    if (d.rule === 'ongoing') return 'مستمرة — بلا موعد تسليم';
    if (d.rule === 'weekday') return `يوم ${d.day || '—'} من الأسبوع نفسه`;
    if (d.rule === 'week_end_of') return isInt(d.week) ? 'نهاية ' + wl(d.week) : 'نهاية أسبوع لم يُحدَّد';
    const o = d.offset || 0;
    return o === 0 ? 'نهاية الأسبوع نفسه' : o === 1 ? 'نهاية الأسبوع التالي' : `نهاية الأسبوع بعد ${o} أسابيع`;
  }
  const dueSel = d => d.rule === 'week_end' ? ((d.offset || 0) === 0 ? 'same' : (d.offset === 1 ? 'next' : 'off' + d.offset)) : d.rule;
  const evBadges = list => (list || []).length
    ? (list || []).map(n => `<span class="bk-ev" title="${esc(n + ' - ' + evalName(n))}">${n}</span>`).join('')
    : '<span class="muted">لا يوجد</span>';
  const termsText = t => (t.terms || []).length ? (t.terms || []).map(termName).join('، ') + ((t.terms.length === 1) ? ' فقط' : '') : 'كل الفصول';

  function validate(t) {
    const e = [];
    if (!String(t.title || '').trim()) e.push('عنوان المهمة مطلوب.');
    if (t.weeks_mode === 'list') {
      const bad = BK.raw[t.id] != null ? parseList(BK.raw[t.id]).bad : [];
      if (bad.length) e.push('أرقام أسابيع غير صالحة: ' + bad.join('، '));
      if (!(t.weeks || []).length) e.push('حدّد أسبوعاً واحداً على الأقل.');
    } else {
      const [a, b] = t.weeks || [];
      if (!isInt(a) || !isInt(b)) e.push('اكتب بداية مدى الأسابيع ونهايته.');
      else if (a > b) e.push('بداية المدى يجب ألا تتجاوز نهايته.');
    }
    if (t.due && t.due.rule === 'week_end_of' && !isInt(t.due.week)) e.push('حدّد رقم الأسبوع الذي ينتهي عنده موعد التسليم.');
    if (t.due && t.due.rule === 'weekday' && !t.due.day) e.push('اختر يوم التسليم.');
    return e;
  }
  function settingsErrors() {
    const b = BK.bank, e = [];
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(b.deadline_time || ''))) e.push('وقت انتهاء التسليم غير صالح (مثال: 12:30).');
    if (!isInt((b.speed || {}).medium_max_delay)) e.push('أقصى تأخير لسرعة «متوسط» يجب أن يكون عدداً صحيحاً غير سالب.');
    COUNTS.forEach(([k, l]) => { if (!isInt(b[k])) e.push(`«${l}» يجب أن يكون عدداً صحيحاً غير سالب.`); });
    return e;
  }

  // ═════════ التحميل والرسم
  function setBank(b) {
    b.tasks = b.tasks || []; b.emergency = b.emergency || []; b.speed = b.speed || { medium_max_delay: 2 };
    if (!Array.isArray(b.suggested)) b.suggested = [];   // للقراءة فقط: تُعاد إلى الخادم كما وصلت
    b.tasks.forEach(t => { t.weeks = t.weeks || []; t.due = t.due || { rule: 'week_end' }; t.eval = t.eval || []; t.terms = t.terms || []; });
    BK.bank = b; BK.orig = canon(b); BK.raw = {}; BK.prevDue = {}; BK.loaded = true;
  }
  async function load() {
    let r; try { r = await api('/api/bank'); } catch (e) { r = null; }
    if (!r || !r.bank) throw new Error((r && r.error) || 'تعذرت قراءة بنك المهام من الخادم.');
    if (r.terms) BK.meta.terms = r.terms;
    if (r.weekdays) BK.meta.weekdays = r.weekdays;
    setBank(r.bank);
  }
  async function render() {
    const R = root(); if (!R || typeof api !== 'function') return;
    bind(R);
    if (!BK.loaded || !dirty()) {
      if (!BK.loaded) R.innerHTML = '<div class="card empty">جارٍ قراءة بنك المهام…</div>';
      try { await load(); } catch (e) {
        R.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><button class="btn sm" data-act="retry">إعادة المحاولة</button></div>`; return;
      }
    }
    if (!BK.psemUser || !semList().some(s => s.id === BK.psem)) { BK.psem = activeSem(); BK.psemUser = false; }
    if (!BK.fold) loadFold();
    R.innerHTML = layout(); paintAll(); paintFold(); preview();
  }
  function layout() {
    return `<div class="card bk-head">
      <h2>بنك مهام القسم <span class="sp"><span id="bkDirty" class="badge mid hidden">تغييرات غير محفوظة</span>
        <button class="btn p" id="bkSave" data-act="save" disabled>حفظ التغييرات</button>
        <button class="btn t" data-act="add">إضافة مهمة</button>
        <button class="btn" data-act="export">تصدير البنك</button>
        <button class="btn" data-act="import">استيراد بنك</button>
        <input type="file" id="bkFile" accept=".json,application/json" hidden></span></h2>
      <p class="hint">يُعرَّف هنا ما يتكرر من مهام القسم كل فصل، ومنه تُولَّد ملفات المدربين. يُطبَّق أي تعديل بعد الحفظ على الملفات التي تُصدَر لاحقاً من تبويب «الإصدار والقفل»، أما الملفات الموزعة سابقاً فلا تتغير. ويمكن تصدير البنك ملفاً ومشاركته مع الأقسام الأخرى لاستيراده لديهم.</p>
      <div id="bkStats" class="bk-stats"></div><div id="bkMsg"></div></div>
    <div class="bk-cols"><div class="bk-colmain">
      <div class="card" data-card="tasks"><h2>${foldBtn('tasks')}مهام البنك <span class="badge br" id="bkCount"></span>
        <span class="sp"><button class="btn sm" data-act="open-all">فتح الكل</button><button class="btn sm" data-act="close-all">إغلاق الكل</button></span></h2>
        <p class="hint">ترتيب المهام هنا هو ترتيبها في ورقة كل أسبوع. اضغط على المهمة لتعديلها، واستعمل ▲▼ لتغيير ترتيبها.</p>
        <div id="bkTasks"></div>
        <div class="row" style="margin-top:10px"><button class="btn sm t" data-act="add">+ إضافة مهمة</button></div></div>
      <div class="card" id="bkSugCard" data-card="sug"><h2>${foldBtn('sug')}مهام مقترحة من مهام الجودة <span class="badge br" id="bkSugCount"></span>
        <span class="sp"><button class="btn sm p" data-act="sg-addsel" id="bkSugAddSel" disabled>إضافة المحدد</button></span></h2>
        <p class="hint">مهام مأخوذة من «المفكرة الإشرافية» ومن «تقويم أعمال جودة التدريب»، وهي مقترحات فقط: لا تدخل ملفات المدربين حتى يضيفها رئيس القسم إلى مهام القسم. والإضافة تنسخ المهمة إلى قائمة «مهام البنك» أعلاه حيث يمكن تعديل أسابيعها وموعدها وسائر حقولها، ثم تُعتمد بزر «حفظ التغييرات».</p>
        <div class="bk-sgf">
          <input class="in bk-sgq" type="search" data-sg="q" value="${esc(BK.sgQ)}" placeholder="بحث في المهام المقترحة…" aria-label="بحث في المهام المقترحة">
          <div class="chips" id="bkSugTerms" role="group" aria-label="تصفية حسب الفصل"></div>
          <label class="chk"><input type="checkbox" data-sg="hide" ${BK.sgHide ? 'checked' : ''}> إخفاء المضافة</label></div>
        <div class="row bk-sgbar"><button class="btn sm" data-act="sg-all">تحديد الكل</button><button class="btn sm" data-act="sg-none">إلغاء التحديد</button>
          <button class="btn sm" data-act="sg-open">توسيع الكل</button><button class="btn sm" data-act="sg-close">طي الكل</button><span class="muted" id="bkSugInfo"></span></div>
        <div id="bkSug"></div></div>
      <div class="card" data-card="set"><h2>${foldBtn('set')}إعدادات ملفات المدربين</h2>
        <p class="hint">تُحفظ مع البنك بزر «حفظ التغييرات»، وتُطبَّق على الملفات التي تُصدَر بعد الحفظ.</p><div id="bkSet"></div></div>
      <div class="card" data-card="em"><h2>${foldBtn('em')}المهام الطارئة المسجلة <span class="badge br" id="bkEmCount"></span></h2>
        <p class="hint">المهام الطارئة تخص فصلاً تدريبياً بعينه وأسبوعاً منه، وتُعبَّأ مسبقاً في ملفات ذلك الفصل فقط عند إصدارها. يُحذف ما لم يعد مطلوباً، ويُطبَّق الحذف بعد الحفظ.</p>
        <div id="bkEm"></div></div>
    </div><div class="bk-colside">
      <div class="card bk-prevcard" data-card="prev"><h2>${foldBtn('prev')}معاينة الفصل <span class="sp"><button class="btn sm" data-act="prev">تحديث المعاينة</button></span></h2>
        <div class="row"><select class="in bk-sem" id="bkSem" aria-label="الفصل التدريبي"></select>
          <button class="btn sm" data-act="pv-open">توسيع الكل</button><button class="btn sm" data-act="pv-close">طي الكل</button></div>
        <p class="hint">مهام كل أسبوع في الفصل المختار كما ستظهر في ملفات المدربين، وتشمل التعديلات غير المحفوظة. المهام المفتوحة للتعديل مظللة.</p>
        <div id="bkPrev"></div></div>
    </div></div>`;
  }
  function paintAll() { paintStats(); paintTasks(); paintSug(); paintSettings(); paintEmerg(); paintSem(); markDirty(); }
  function paintStats() {
    const T = BK.bank.tasks, ong = T.filter(t => t.due.rule === 'ongoing').length;
    el('bkStats').innerHTML = [`<span class="badge br">مهام البنك: ${T.length}</span>`, `<span class="badge ok">بموعد تسليم: ${T.length - ong}</span>`,
      `<span class="badge na">مستمرة: ${ong}</span>`, `<span class="badge mid">طارئة مسجلة: ${BK.bank.emergency.length}</span>`,
      `<span class="muted">آخر موعد للتسليم الساعة ${esc(BK.bank.deadline_time || '—')}</span>`].join('');
    el('bkCount').textContent = T.length;
  }
  function paintSem() {
    const L = semList(), s = el('bkSem'); if (!s) return;
    s.innerHTML = L.length ? L.map(x => `<option value="${esc(x.id)}" ${x.id === BK.psem ? 'selected' : ''}>${esc(x.title)}${x.id === activeSem() ? ' (النشط)' : ''}</option>`).join('')
      : '<option value="">لا توجد فصول تدريبية</option>';
  }
  function markDirty() {
    const d = dirty(), b = el('bkSave'), x = el('bkDirty');
    if (b) b.disabled = !d; if (x) x.classList.toggle('hidden', !d);
  }

  // ═════════ قائمة المهام
  function paintTasks() {
    const T = BK.bank.tasks;
    el('bkTasks').innerHTML = T.length ? T.map(taskHTML).join('') : '<div class="empty">لا توجد مهام في البنك بعد. أضف أول مهمة.</div>';
    el('bkCount').textContent = T.length;
  }
  function taskHTML(t, i) {
    const open = BK.open.has(t.id), errs = validate(t);
    return `<div class="bk-task ${open ? 'open' : ''} ${errs.length ? 'bad' : ''} ${t.due.rule === 'ongoing' ? 'ong' : ''}" data-i="${i}">
      <div class="bk-hd" data-act="toggle" role="button" tabindex="0" aria-expanded="${open}">${headInner(t, i, errs)}</div>
      ${open ? `<div class="bk-ed">${editorHTML(t, errs)}</div>` : ''}</div>`;
  }
  function headInner(t, i, errs) {
    const n = BK.bank.tasks.length, ong = t.due.rule === 'ongoing';
    return `<span class="bk-no">${i + 1}</span>
      <div class="bk-body"><div class="bk-title">${t.title ? esc(t.title) : '<span class="muted">(مهمة بلا عنوان)</span>'}${t.from_suggested ? ` <span class="badge br bk-fromsg" title="${esc([t.source, t.ref].filter(Boolean).join(' — ') || 'من المهام المقترحة')}">من المقترحة</span>` : ''}${errs.length ? ' <span class="badge bad">تحتاج تصحيحاً</span>' : ''}</div>
        <div class="bk-meta">
          <span class="badge ${ong ? 'na' : 'ok'}">${ong ? 'مستمرة' : 'تسليم'}</span>
          <span><span class="k">الأسابيع:</span> ${esc(weeksText(t))}</span>
          ${ong ? '' : `<span><span class="k">الموعد:</span> ${esc(dueText(t.due))}</span>`}
          <span><span class="k">الترحيل:</span> ${t.carry ? 'تُرحَّل' : 'لا تُرحَّل'}</span>
          <span class="bk-evs"><span class="k">بنود التقييم:</span> ${evBadges(t.eval)}</span>
          <span><span class="k">الفصول:</span> ${esc(termsText(t))}</span>
        </div></div>
      <div class="bk-acts">
        <button class="btn sm" data-act="up" title="تقديم" aria-label="تقديم" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn sm" data-act="down" title="تأخير" aria-label="تأخير" ${i === n - 1 ? 'disabled' : ''}>▼</button>
        <button class="btn sm" data-act="copy">نسخ</button>
        <button class="btn sm danger" data-act="del">حذف</button></div>`;
  }
  function editorHTML(t, errs) {
    const id = esc(t.id), ong = t.due.rule === 'ongoing', list = t.weeks_mode === 'list', sel = dueSel(t.due), M = BK.meta;
    const rb = (name, f, v, on, txt) => `<label class="chk"><input type="radio" name="${name}-${id}" data-f="${f}" value="${v}" ${on ? 'checked' : ''}> ${txt}</label>`;
    const raw = BK.raw[t.id] != null ? BK.raw[t.id] : (t.weeks || []).join('، ');
    const [a, b] = list ? [null, null] : (t.weeks || []);
    const opts = [['same', 'نهاية الأسبوع نفسه'], ['next', 'نهاية الأسبوع التالي'], ['weekday', 'يوم محدد من الأسبوع'], ['week_end_of', 'نهاية أسبوع رقم…']];
    if (/^off/.test(sel)) opts.push([sel, dueText(t.due)]);
    let groups = '', last = null;
    evalItems().forEach(x => {
      if (x.group && x.group !== last) { groups += `<div class="bk-grp">${esc(x.group)}</div>`; last = x.group; }
      groups += `<label><input type="checkbox" data-f="eval" value="${x.n}" ${(t.eval || []).includes(x.n) ? 'checked' : ''}> ${x.n} - ${esc(x.name)}</label>`;
    });
    return `<div class="bk-grid">
      <label class="f bk-full">عنوان المهمة<input data-f="title" value="${esc(t.title)}" maxlength="250" placeholder="مثال: رفع خطة المقرر على المنصة"></label>
      <div class="bk-fld"><div class="bk-lb">نوع المهمة</div><div class="bk-seg">
        ${rb('k', 'kind', 'deliverable', !ong, 'تسليم بموعد محدد')}${rb('k', 'kind', 'ongoing', ong, 'مستمرة (بلا موعد تسليم)')}</div>
        <div class="bk-help">المهمة المستمرة مثل «الالتزام بأوقات المحاضرات» لا موعد لها ولا تُحسب لها سرعة إنجاز.</div></div>
      <div class="bk-fld"><div class="bk-lb">الأسابيع</div><div class="bk-seg">
        ${rb('wm', 'wm', 'range', !list, 'مدى (كل أسبوع من… إلى…)')}${rb('wm', 'wm', 'list', list, 'أسابيع محددة')}</div>
        ${list ? `<label class="f">أرقام الأسابيع<input data-f="wlist" value="${esc(raw)}" placeholder="مثال: 3، 5، 9" inputmode="numeric"></label>`
        : `<div class="row bk-range"><label class="f bk-n">من الأسبوع<input type="number" min="0" data-f="from" value="${isInt(a) ? a : ''}"></label>
           <label class="f bk-n">إلى الأسبوع<input type="number" min="0" data-f="to" value="${isInt(b) ? b : ''}"></label></div>`}
        <div class="bk-help">0 = أسبوع العودة (في الفصول التي فيها أسبوع عودة فقط)، والأسابيع التي تتجاوز طول الفصل تُتجاهل تلقائياً.</div></div>
      ${ong ? '' : `<div class="bk-fld"><div class="bk-lb">آخر موعد للتسليم</div><div class="row">
        <select class="in" data-f="duesel" aria-label="آخر موعد للتسليم">${opts.map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        ${sel === 'weekday' ? `<select class="in" data-f="day" aria-label="يوم التسليم">${M.weekdays.map(d => `<option ${d === t.due.day ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>` : ''}
        ${sel === 'week_end_of' ? `<input class="in bk-wk" type="number" min="0" data-f="dweek" value="${isInt(t.due.week) ? t.due.week : ''}" aria-label="رقم الأسبوع">` : ''}</div>
        <div class="bk-help">الساعة ${esc(BK.bank.deadline_time || '')} من يوم الموعد (يُعدَّل الوقت من الإعدادات أدناه).${sel === 'week_end_of' ? ' مناسب للمهمة التي تُطلب في أسبوع ويُسلَّم في أسبوع لاحق محدد.' : ''}</div></div>`}
      <div class="bk-fld"><div class="bk-lb">الترحيل</div>
        <label class="chk"><input type="checkbox" data-f="carry" ${t.carry ? 'checked' : ''}> تُرحَّل إلى الأسابيع التالية إن لم تُنجز</label>
        <div class="bk-help">تظهر المهمة غير المنجزة في قسم «المرحّلة» في الأسابيع التالية حتى تُنجز.</div></div>
      <div class="bk-fld"><div class="bk-lb">الفصول التي تنطبق عليها</div><div class="bk-seg">
        ${M.terms.map(x => `<label class="chk"><input type="checkbox" data-f="term" value="${esc(x)}" ${(t.terms || []).includes(x) ? 'checked' : ''}> ${esc(termName(x))}</label>`).join('')}</div>
        <div class="bk-help">${(t.terms || []).length ? 'تظهر المهمة في الفصول المحددة فقط.' : 'لم يُحدَّد فصل: تظهر المهمة في كل الفصول.'}</div></div>
      <div class="bk-fld bk-full"><div class="bk-lb">بنود نموذج تقييم الأداء التي تغذيها <span class="muted bk-evn">(${(t.eval || []).length} محدد)</span></div>
        <div class="checks bk-evc">${groups || '<span class="muted">لا توجد بنود تقييم.</span>'}</div></div>
      <label class="f bk-full">لماذا هي مطلوبة؟<textarea rows="2" data-f="why" placeholder="السند من دليل المدرب أو اللائحة، يظهر للمدرب في ملفه">${esc(t.why || '')}</textarea></label>
    </div>
    <div class="bk-errs err">${errs.map(x => `<div>${esc(x)}</div>`).join('')}</div>
    <div class="row bk-edf"><button class="btn sm" data-act="toggle">إغلاق المحرر</button><span class="muted">تُحفظ التعديلات بزر «حفظ التغييرات» أعلى الصفحة.</span></div>`;
  }
  const taskRow = i => root().querySelector(`.bk-task[data-i="${i}"]`);
  function refreshRow(i, full) {
    const t = BK.bank.tasks[i], row = taskRow(i); if (!row) return;
    if (full) { row.outerHTML = taskHTML(t, i); return; }
    const errs = validate(t);
    row.querySelector('.bk-hd').innerHTML = headInner(t, i, errs);
    row.classList.toggle('bad', errs.length > 0); row.classList.toggle('ong', t.due.rule === 'ongoing');
    const eb = row.querySelector('.bk-errs'); if (eb) eb.innerHTML = errs.map(x => `<div>${esc(x)}</div>`).join('');
  }
  function changed() { markDirty(); paintStats(); schedulePreview(); if (adoptedSig() !== BK.sgSig) paintSug(); }

  function setField(t, f, inp, row) {
    switch (f) {
      case 'title': t.title = inp.value; return;
      case 'why': t.why = inp.value; return;
      case 'from': case 'to': { const w = (t.weeks || []).slice(0, 2); w[f === 'from' ? 0 : 1] = num(inp.value); t.weeks = [w[0] ?? null, w[1] ?? null]; return; }
      case 'wlist': BK.raw[t.id] = inp.value; t.weeks = parseList(inp.value).weeks; return;
      case 'dweek': t.due = { rule: 'week_end_of', week: num(inp.value) }; return;
      case 'day': t.due = { rule: 'weekday', day: inp.value }; return;
      case 'carry': t.carry = inp.checked; return;
      case 'eval': t.eval = [...row.querySelectorAll('input[data-f=eval]:checked')].map(x => +x.value).sort((x, y) => x - y);
        row.querySelector('.bk-evn').textContent = `(${t.eval.length} محدد)`; return;
      case 'term': t.terms = [...row.querySelectorAll('input[data-f=term]:checked')].map(x => x.value); return 'full';
      case 'kind':
        if (inp.value === 'ongoing') { if (t.due.rule !== 'ongoing') BK.prevDue[t.id] = t.due; t.due = { rule: 'ongoing' }; }
        else t.due = BK.prevDue[t.id] || { rule: 'week_end' };
        return 'full';
      case 'wm': {
        const w = t.weeks || [];
        if (inp.value === 'list' && t.weeks_mode !== 'list') {
          const [a, b] = w; t.weeks = isInt(a) && isInt(b) && a <= b && b - a < 40 ? Array.from({ length: b - a + 1 }, (_, k) => a + k) : [];
          t.weeks_mode = 'list'; BK.raw[t.id] = t.weeks.join('، ');
        } else if (inp.value === 'range' && t.weeks_mode === 'list') {
          t.weeks = w.length ? [Math.min(...w), Math.max(...w)] : [1, 1]; t.weeks_mode = 'range'; delete BK.raw[t.id];
        }
        return 'full';
      }
      case 'duesel': {
        const v = inp.value, w = (t.weeks || []).filter(isInt);
        if (v === 'same') t.due = { rule: 'week_end' };
        else if (v === 'next') t.due = { rule: 'week_end', offset: 1 };
        else if (v === 'weekday') t.due = { rule: 'weekday', day: t.due.day || BK.meta.weekdays[BK.meta.weekdays.length - 1] };
        else if (v === 'week_end_of') t.due = { rule: 'week_end_of', week: isInt(t.due.week) ? t.due.week : (w.length ? Math.min(...w) + 1 : 1) };
        return 'full';
      }
    }
  }
  function onField(inp, isChange) {
    const f = inp.dataset.f, row = inp.closest('.bk-task'); if (!f || !row) return;
    const text = inp.tagName === 'TEXTAREA' || (inp.tagName === 'INPUT' && !['checkbox', 'radio'].includes(inp.type));
    if (text === isChange) return;   // النصوص عند الكتابة، والاختيارات عند التغيير
    const i = +row.dataset.i, t = BK.bank.tasks[i];
    const mode = setField(t, f, inp, row);
    if (mode === 'full') {
      refreshRow(i, true);
      const r2 = taskRow(i), pick = ['radio', 'checkbox'].includes(inp.type) ? `[data-f="${f}"][value="${CSS.escape(inp.value)}"]` : `[data-f="${f}"]`;
      const q = r2 && r2.querySelector(pick); if (q) q.focus({ preventScroll: true });
    }
    else refreshRow(i);
    changed();
  }

  function newId() {
    const ids = new Set(BK.bank.tasks.map(t => t.id)); let n = 1;
    BK.bank.tasks.forEach(t => { const m = /^T(\d+)$/.exec(t.id || ''); if (m) n = Math.max(n, +m[1] + 1); });
    while (ids.has('T' + n)) n++;
    return 'T' + n;
  }
  function openAndFocus(id) {
    BK.open.add(id); paintTasks(); if (BK.fold.has('tasks')) setFold('tasks', false);
    const i = BK.bank.tasks.findIndex(t => t.id === id), row = taskRow(i);
    if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); const inp = row.querySelector('[data-f=title]'); if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 250); }
  }
  function taskAction(act, row) {
    const T = BK.bank.tasks, i = +row.dataset.i, t = T[i];
    if (act === 'toggle') { BK.open.has(t.id) ? BK.open.delete(t.id) : BK.open.add(t.id); refreshRow(i, true); paintPrevHl(); return; }
    if (act === 'up' || act === 'down') {
      const j = act === 'up' ? i - 1 : i + 1; if (j < 0 || j >= T.length) return;
      [T[i], T[j]] = [T[j], T[i]]; paintTasks(); const b = taskRow(j) && taskRow(j).querySelector(`[data-act="${act}"]`); if (b && !b.disabled) b.focus();
    }
    if (act === 'copy') {
      const c = JSON.parse(JSON.stringify(t)); c.id = newId(); c.title = (t.title || '') + ' (نسخة)';
      if (BK.raw[t.id] != null) BK.raw[c.id] = BK.raw[t.id];
      T.splice(i + 1, 0, c); openAndFocus(c.id); toast('نُسخت المهمة أسفل الأصل');
    }
    if (act === 'del') {
      if (!confirm(`حذف المهمة «${t.title || 'بلا عنوان'}» من البنك؟\nلن تظهر في ملفات المدربين التي تُصدَر بعد الحفظ.${t.from_suggested ? '\nوتعود متاحة للإضافة في «مهام مقترحة من مهام الجودة».' : ''}`)) return;
      T.splice(i, 1); BK.open.delete(t.id); paintTasks();
    }
    changed();
  }
  function addTask() {
    const t = { id: newId(), title: '', weeks: [1, 19], weeks_mode: 'range', due: { rule: 'week_end' }, carry: true, eval: [], why: '', terms: [] };
    BK.bank.tasks.push(t); openAndFocus(t.id); changed();
  }

  // ═════════ المهام المقترحة (للقراءة فقط؛ الإضافة تنسخها إلى مهام القسم)
  const adoptedSet = () => new Set(BK.bank.tasks.map(t => t.from_suggested).filter(Boolean));
  const adoptedSig = () => BK.bank ? [...adoptedSet()].sort().join(',') : '';
  const sgWeek = s => { const w = (s.weeks || []).filter(isInt); return w.length ? Math.min(...w) : 0; };
  const norm = s => String(s ?? '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْـ]/g, '');
  const sgSingle = s => s.weeks_mode === 'list' && (s.weeks || []).length === 1;
  function sgVisible() {
    const q = norm(BK.sgQ).trim(), ad = adoptedSet();
    return BK.bank.suggested.filter(s => {
      if (BK.sgHide && ad.has(s.id)) return false;
      if (BK.sgTerm && (s.terms || []).length && !s.terms.includes(BK.sgTerm)) return false;
      return !q || norm([s.title, s.why, s.source, s.ref, s.where].join(' ')).includes(q);
    });
  }
  function paintSug() {
    const out = el('bkSug'); if (!out || !BK.bank) return;
    const S = BK.bank.suggested, ad = adoptedSet(); BK.sgSig = adoptedSig();
    [...BK.sgSel].forEach(id => { if (ad.has(id) || !S.some(s => s.id === id)) BK.sgSel.delete(id); });
    el('bkSugCount').textContent = S.length;
    el('bkSugCard').classList.toggle('bk-sgempty', !S.length);
    const termsUsed = BK.meta.terms.filter(x => x !== 'الصيفي' || S.some(s => (s.terms || []).includes(x)));
    el('bkSugTerms').innerHTML = [['', 'كل الفصول'], ...termsUsed.map(x => [x, termName(x)])]
      .map(([v, l]) => `<button type="button" class="chip ${BK.sgTerm === v ? 'on' : ''}" data-act="sg-term" data-term="${esc(v)}" aria-pressed="${BK.sgTerm === v}">${esc(l)}</button>`).join('');
    if (!S.length) { out.innerHTML = '<div class="empty">لا توجد مهام مقترحة في البنك.</div>'; sgBar([]); return; }
    const V = sgVisible(), groups = new Map();
    V.forEach(s => { const k = sgWeek(s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); });
    const filtering = !!BK.sgQ.trim();
    out.innerHTML = V.length ? [...groups.keys()].sort((a, b) => a - b).map(k => {
      const L = groups.get(k), nAd = L.filter(s => ad.has(s.id)).length;
      const tb = [...new Set(L.flatMap(s => s.terms || []))].map(x => `<span class="badge mid">${esc(termName(x))}</span>`).join('');
      return `<details class="bk-sgw" data-w="${k}" ${filtering || BK.sgOpen.has(k) ? 'open' : ''}><summary><span class="bk-no sm">${k === 0 ? 'ع' : k}</span><b>${esc(wl(k))}</b>${tb}
        <span class="bk-pc">مقترحة: ${L.length}${nAd ? ` · <span class="ok">مضافة: ${nAd}</span>` : ''}</span></summary>${L.map(s => sgItem(s, ad.has(s.id))).join('')}</details>`;
    }).join('') : '<div class="empty">لا توجد مهام مقترحة تطابق التصفية.</div>';
    sgBar(V);
  }
  function sgItem(s, added) {
    const ong = (s.due || {}).rule === 'ongoing', src = [s.source, s.ref].filter(Boolean).join(' — ');
    return `<div class="bk-sg ${added ? 'added' : ''}" data-sid="${esc(s.id)}">
      <label class="bk-sgck" title="${added ? 'مضافة إلى مهام القسم' : 'تحديد للإضافة'}"><input type="checkbox" data-sgpick="${esc(s.id)}" ${added ? 'disabled' : BK.sgSel.has(s.id) ? 'checked' : ''} aria-label="تحديد: ${esc(s.title)}"></label>
      <div class="bk-body"><div class="bk-title">${esc(s.title)}</div>
        <div class="bk-meta">
          ${sgSingle(s) ? '' : `<span><span class="k">الأسابيع:</span> ${esc(weeksText(s))}</span>`}
          <span><span class="k">الموعد:</span> ${esc(ong ? 'مستمرة — بلا موعد تسليم' : dueText(s.due))}</span>
          ${s.where ? `<span class="badge na bk-where" title="أين تُنفَّذ">أين: ${esc(s.where)}</span>` : ''}
          <span class="bk-evs"><span class="k">بنود التقييم:</span> ${evBadges(s.eval)}</span>
          ${(s.terms || []).length ? `<span class="badge mid">${esc(termsText(s))}</span>` : ''}</div>
        ${src ? `<div class="bk-src">${esc(src)}</div>` : ''}${s.why ? `<div class="bk-src">${esc(s.why)}</div>` : ''}</div>
      <div class="bk-acts">${added ? '<button class="btn sm" disabled>✓ مضافة</button>'
        : `<button class="btn sm t" data-act="sg-add" data-sid="${esc(s.id)}">إضافة إلى مهام القسم</button>`}</div></div>`;
  }
  function sgBar(V) {
    const ad = adoptedSet(), n = BK.sgSel.size, avail = V.filter(s => !ad.has(s.id)).length;
    const b = el('bkSugAddSel'); if (b) { b.disabled = !n; b.textContent = n ? `إضافة المحدد (${n})` : 'إضافة المحدد'; }
    const i = el('bkSugInfo'); if (i) i.textContent = `المعروض ${V.length} من ${BK.bank.suggested.length}، والمتاح للإضافة منه ${avail}، والمضاف إلى مهام القسم ${ad.size}.`;
  }
  function adopt(ids) {
    const ad = adoptedSet(), S = BK.bank.suggested, added = [];
    ids.forEach(sid => {
      const s = S.find(x => x.id === sid); if (!s || ad.has(sid)) return;
      const c = JSON.parse(JSON.stringify(s));
      const t = { id: newId(), title: c.title || '', weeks: c.weeks || [], weeks_mode: c.weeks_mode || 'list', due: c.due || { rule: 'week_end' },
        carry: !!c.carry, eval: c.eval || [], why: c.why || '', terms: c.terms || [], from_suggested: sid, source: c.source || '', ref: c.ref || '' };
      BK.bank.tasks.push(t); ad.add(sid); added.push(t); BK.sgSel.delete(sid);
    });
    if (!added.length) return;
    if (added.length <= 3) added.forEach(t => BK.open.add(t.id));
    paintTasks(); paintSug(); changed(); if (BK.fold.has('tasks')) setFold('tasks', false);
    const row = taskRow(BK.bank.tasks.indexOf(added[0]));
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    toast(added.length === 1 ? 'أُضيفت المهمة إلى مهام القسم؛ راجعها ثم اضغط «حفظ التغييرات»'
      : `أُضيفت إلى نهاية مهام القسم ${nTasks(added.length)}؛ راجعها ثم اضغط «حفظ التغييرات»`);
  }

  // ═════════ الإعدادات
  function paintSettings() {
    const b = BK.bank;
    const nf = (k, l, h, v) => `<label class="f">${esc(l)}<input type="number" min="0" step="1" data-s="${k}" value="${isInt(v) ? v : ''}"><span class="bk-help">${esc(h)}</span></label>`;
    el('bkSet').innerHTML = `<h3>المواعيد وسرعة الإنجاز</h3><div class="grid3">
      <label class="f">وقت انتهاء موعد التسليم<input type="time" data-s="deadline_time" value="${esc(b.deadline_time || '')}"><span class="bk-help">تُعدّ المهمة في موعدها إن أُنجزت قبل هذه الساعة من يوم الموعد.</span></label>
      ${nf('speed.medium_max_delay', 'أقصى تأخير لسرعة «متوسط» (أيام عمل)', 'الإنجاز في الموعد «سريع»، وبعده بهذا العدد من أيام العمل أو أقل «متوسط»، وما زاد «ضعيف».', (b.speed || {}).medium_max_delay)}</div>
      <h3>عدد الأسطر في ورقة كل أسبوع</h3><div class="grid3">${COUNTS.map(([k, l, h]) => nf(k, l, h, b[k])).join('')}</div>
      <div class="bk-errs err" id="bkSetErr"></div>`;
    paintSetErr();
  }
  function paintSetErr() { const e = el('bkSetErr'); if (e) e.innerHTML = settingsErrors().map(x => `<div>${esc(x)}</div>`).join(''); }
  function onSetting(inp) {
    const k = inp.dataset.s, b = BK.bank;
    if (k === 'deadline_time') b.deadline_time = inp.value;
    else if (k === 'speed.medium_max_delay') { b.speed = Object.assign({}, b.speed, { medium_max_delay: num(inp.value) }); }
    else b[k] = num(inp.value);
    paintSetErr(); changed();
  }

  // ═════════ المهام الطارئة
  function paintEmerg() {
    const E = BK.bank.emergency, groups = new Map();
    E.forEach((e, i) => { const k = e.semester || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push([e, i]); });
    el('bkEmCount').textContent = E.length;
    if (!E.length) { el('bkEm').innerHTML = '<div class="empty">لا توجد مهام طارئة مسجلة.</div>'; return; }
    const order = semList().map(s => s.id), keys = [...groups.keys()].sort((x, y) => (order.indexOf(x) + 1 || 99) - (order.indexOf(y) + 1 || 99));
    if (!BK.emOpen) BK.emOpen = new Set([activeSem()]);
    el('bkEm').innerHTML = keys.map(k => {
      const L = groups.get(k).sort((x, y) => (x[0].week ?? 0) - (y[0].week ?? 0));
      return `<details class="bk-emg" data-sem="${esc(k)}" ${BK.emOpen.has(k) ? 'open' : ''}><summary><b>${esc(semTitle(k))}</b> <span class="badge br">${L.length}</span></summary><div class="wrap"><table class="t"><thead><tr>
        <th class="r">المهمة</th><th>الأسبوع</th><th>آخر موعد</th><th>بنود التقييم</th><th></th></tr></thead><tbody>${L.map(([e, i]) =>
        `<tr><td class="r">${esc(e.title)}</td><td>${esc(isInt(e.week) ? wl(e.week) : '—')}</td><td>${esc(dueText(e.due))}</td><td class="bk-evs">${evBadges(e.eval)}</td>
         <td><button class="btn sm danger" data-act="edel" data-e="${i}">حذف</button></td></tr>`).join('')}</tbody></table></div></details>`;
    }).join('');
  }

  // ═════════ المعاينة
  function schedulePreview() { clearTimeout(BK.pTimer); BK.pTimer = setTimeout(preview, 700); }
  async function preview() {
    clearTimeout(BK.pTimer);
    const out = el('bkPrev'); if (!out || !BK.bank) return;
    if (!BK.psem) { out.innerHTML = '<div class="muted">لا توجد فصول تدريبية مسجلة بعد. أضفها من تبويب «الفصول التدريبية».</div>'; return; }
    if (BK.bank.tasks.some(t => validate(t).length)) { out.innerHTML = '<div class="muted">صحّح الأخطاء المظللة في المهام لتظهر المعاينة.</div>'; return; }
    const seq = ++BK.pSeq; out.classList.add('busy');
    let r; try { r = await post('/api/bank/preview', { semester: BK.psem, bank: BK.bank }); } catch (e) { r = { ok: false, error: 'تعذر الاتصال بالخادم.' }; }
    if (seq !== BK.pSeq || !el('bkPrev')) return;
    out.classList.remove('busy');
    if (!r || !r.ok) { out.innerHTML = `<div class="err">تعذرت المعاينة: ${esc((r && r.error) || 'خطأ غير معروف')}</div>`; return; }
    const W = r.weeks || [];
    const total = W.reduce((s, w) => s + (w.tasks || []).length, 0);
    out.innerHTML = `<div class="muted bk-pvsum">${esc(r.semester || '')} — ${nWeeks(W.length)}، ومجموع المهام ${total}</div><div class="bk-pv">` + W.map(w => {
      const L = w.tasks || [], em = L.filter(x => x.emergency).length;
      return `<details data-w="${w.n}" ${BK.pOpen.has(w.n) ? 'open' : ''}><summary><span class="bk-no sm">${w.n === 0 ? 'ع' : w.n}</span><b>${esc(w.title || wl(w.n))}</b>
        <span class="bk-pc">${nTasks(L.length)}${em ? ` · <span class="bad">طارئة: ${em}</span>` : ''}</span><span class="bk-dot" hidden></span></summary>
        ${L.length ? '<ul>' + L.map(x => `<li data-id="${esc(x.id)}"><span class="bk-pt">${esc(x.title)}</span>
          <span class="bk-pd">${x.due === 'مستمرة' ? '<span class="badge na">مستمرة</span>' : `<bdi>${esc(x.due || '—')}</bdi>`}</span>
          ${x.emergency ? '<span class="badge bad">طارئة</span>' : ''}${x.carry && !x.emergency ? '<span class="badge mid">تُرحَّل</span>' : ''}</li>`).join('') + '</ul>'
        : '<div class="muted bk-none">لا مهام في هذا الأسبوع.</div>'}</details>`;
    }).join('') + '</div>';
    paintPrevHl();
  }
  function paintPrevHl() {
    const out = el('bkPrev'); if (!out) return;
    out.querySelectorAll('details').forEach(d => {
      let any = false;
      d.querySelectorAll('li[data-id]').forEach(li => { const on = BK.open.has(li.dataset.id); li.classList.toggle('hl', on); any = any || on; });
      const dot = d.querySelector('.bk-dot'); if (dot) dot.hidden = !any;
    });
  }

  // ═════════ الحفظ والتصدير والاستيراد
  const setMsg = h => { const m = el('bkMsg'); if (m) m.innerHTML = h; };
  async function save() {
    const bad = BK.bank.tasks.filter(t => validate(t).length), se = settingsErrors();
    if (bad.length || se.length) {
      bad.forEach(t => BK.open.add(t.id)); paintTasks(); paintSetErr();
      if (bad.length) setFold('tasks', false); if (se.length) setFold('set', false);
      setMsg(`<div class="err bk-msg">لم يُحفظ البنك: ${bad.length ? `عدد المهام التي تحتاج تصحيحاً ${bad.length}` : ''}${bad.length && se.length ? '، و' : ''}${se.length ? 'في الإعدادات أخطاء' : ''}.</div>`);
      const f = root().querySelector('.bk-task.bad') || el('bkSetErr'); if (f) f.scrollIntoView({ block: 'center', behavior: 'smooth' });
      toast('صحّح الأخطاء قبل الحفظ', 1); return;
    }
    const btn = el('bkSave'); btn.disabled = true; btn.textContent = 'جارٍ الحفظ…';
    let r; try { r = await post('/api/bank', BK.bank); } catch (e) { r = { ok: false, error: 'تعذر الاتصال بالخادم.' }; }
    btn.textContent = 'حفظ التغييرات';
    if (!r || !r.ok || !r.bank) {
      const m = (r && r.error) || 'خطأ غير معروف';
      setMsg(`<div class="err bk-msg">تعذر الحفظ: ${esc(m)}</div>`); toast('تعذر الحفظ: ' + m, 1); markDirty(); return;
    }
    const open = BK.open; setBank(r.bank);
    BK.open = new Set([...open].filter(id => r.bank.tasks.some(t => t.id === id)));
    paintAll(); setMsg(''); preview();
    toast('حُفظ بنك المهام، ويُطبَّق على الملفات التي تُصدَر من الآن');
  }
  async function exportBank() {
    if (dirty() && !confirm('توجد تغييرات غير محفوظة لن يشملها الملف المصدَّر (يُصدَّر البنك المحفوظ).\nهل تريد المتابعة؟')) return;
    let r; try { r = await api('/api/bank/export'); } catch (e) { r = null; }
    if (!r || r.ok === false || !Array.isArray(r.tasks)) { toast((r && r.error) || 'تعذر تصدير البنك', 1); return; }
    const dept = (typeof STATE !== 'undefined' && STATE && STATE.config && STATE.config.dept) || '';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
    a.download = (dept ? `بنك مهام قسم ${dept}` : 'بنك مهام القسم') + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('صُدِّر البنك');
  }
  async function importBank(file) {
    if (!file) return;
    if (!confirm(`استيراد «${file.name}» يستبدل بنك المهام الحالي كاملاً بمهامه وإعداداته${dirty() ? '، وتضيع التغييرات غير المحفوظة' : ''}.\nهل تريد المتابعة؟`)) return;
    const fd = new FormData(); fd.append('file', file);
    let r; try { r = await api('/api/bank/import', { method: 'POST', body: fd }); } catch (e) { r = { ok: false, error: 'تعذر الاتصال بالخادم.' }; }
    if (!r || !r.ok) { const m = (r && r.error) || 'ملف غير صالح'; setMsg(`<div class="err bk-msg">تعذر الاستيراد: ${esc(m)}</div>`); toast('تعذر الاستيراد: ' + m, 1); return; }
    BK.open = new Set(); BK.loaded = false;
    try { await load(); } catch (e) { toast(e.message, 1); return; }
    paintAll(); setMsg(''); preview();
    const n = Array.isArray(r.tasks) ? r.tasks.length : r.tasks;
    toast('استُورد البنك' + (n != null ? `: ${nTasks(n)}` : ''));
  }

  // ═════════ الأحداث (تُربط مرة واحدة على القسم)
  function bind(R) {
    if (BK.bound) return; BK.bound = true;
    R.addEventListener('click', e => {
      // الضغط على عنوان بطاقة قابلة للطي (خارج أزرارها) يطويها أو يفتحها
      const h = e.target.closest('.card[data-card] > h2');
      if (h && !e.target.closest('button, input, select, label, a, .sp')) return setFold(h.parentElement.dataset.card, !BK.fold.has(h.parentElement.dataset.card));
      const b = e.target.closest('[data-act]'); if (!b || b.disabled || !R.contains(b)) return;
      const act = b.dataset.act, row = b.closest('.bk-task');
      if (row && ['toggle', 'up', 'down', 'copy', 'del'].includes(act)) return taskAction(act, row);
      if (act === 'fold') return setFold(b.dataset.fold, !BK.fold.has(b.dataset.fold));
      if (act === 'retry') return render();
      if (act === 'save') return save();
      if (act === 'add') return addTask();
      if (act === 'export') return exportBank();
      if (act === 'import') { const f = el('bkFile'); f.value = ''; return f.click(); }
      if (act === 'open-all' || act === 'close-all') { BK.open = act === 'open-all' ? new Set(BK.bank.tasks.map(t => t.id)) : new Set(); paintTasks(); paintPrevHl(); return; }
      if (act === 'prev') return preview();
      if (act === 'pv-open' || act === 'pv-close') { R.querySelectorAll('#bkPrev details').forEach(d => d.open = act === 'pv-open'); return; }
      if (act === 'sg-add') return adopt([b.dataset.sid]);
      if (act === 'sg-addsel') return adopt(BK.bank.suggested.map(s => s.id).filter(id => BK.sgSel.has(id)));
      if (act === 'sg-term') { BK.sgTerm = b.dataset.term || ''; return paintSug(); }
      if (act === 'sg-all' || act === 'sg-none') {
        const ad = adoptedSet();
        if (act === 'sg-all') sgVisible().forEach(s => { if (!ad.has(s.id)) BK.sgSel.add(s.id); }); else BK.sgSel.clear();
        return paintSug();
      }
      if (act === 'sg-open' || act === 'sg-close') {
        R.querySelectorAll('#bkSug details').forEach(d => { d.open = act === 'sg-open'; });
        BK.sgOpen = act === 'sg-open' ? new Set(BK.bank.suggested.map(sgWeek)) : new Set(); return;
      }
      if (act === 'edel') {
        const i = +b.dataset.e, x = BK.bank.emergency[i]; if (!x) return;
        if (!confirm(`حذف المهمة الطارئة «${x.title}» (${semTitle(x.semester)}، ${wl(x.week)})؟\nيُطبَّق الحذف بعد الحفظ، ولا يتغير ما وُزّع من ملفات.`)) return;
        BK.bank.emergency.splice(i, 1); paintEmerg(); changed();
      }
    });
    R.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('bk-hd')) { e.preventDefault(); taskAction('toggle', e.target.closest('.bk-task')); }
    });
    R.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.f) onField(t, false);
      else if (t.dataset.s) onSetting(t);
      else if (t.dataset.sg === 'q') { BK.sgQ = t.value; clearTimeout(BK.sgT); BK.sgT = setTimeout(paintSug, 200); }
    });
    R.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'bkFile') return importBank(t.files && t.files[0]);
      if (t.id === 'bkSem') { BK.psem = t.value; BK.psemUser = true; BK.pOpen = new Set(); return preview(); }
      if (t.dataset.sg === 'hide') { BK.sgHide = t.checked; return paintSug(); }
      if (t.dataset.sgpick) { t.checked ? BK.sgSel.add(t.dataset.sgpick) : BK.sgSel.delete(t.dataset.sgpick); return sgBar(sgVisible()); }
      if (t.dataset.f) onField(t, true);
    });
    R.addEventListener('toggle', e => {
      const d = e.target; if (d.tagName !== 'DETAILS') return;
      if (d.classList.contains('bk-emg')) { d.open ? BK.emOpen.add(d.dataset.sem) : BK.emOpen.delete(d.dataset.sem); return; }
      if (d.dataset.w == null) return;
      if (d.classList.contains('bk-sgw')) { if (!BK.sgQ.trim()) d.open ? BK.sgOpen.add(+d.dataset.w) : BK.sgOpen.delete(+d.dataset.w); return; }
      d.open ? BK.pOpen.add(+d.dataset.w) : BK.pOpen.delete(+d.dataset.w);
    }, true);
  }

  document.addEventListener('tasks:tab', e => {
    if (e.detail === 'bank') { BK.onTab = true; render(); return; }
    if (BK.onTab && dirty()) toast('تنبيه: في «بنك المهام» تغييرات غير محفوظة', 1);
    BK.onTab = false;
  });
  document.addEventListener('tasks:semester', e => {
    if (!BK.psemUser) BK.psem = e.detail;
    if (BK.loaded && el('bkSem')) { paintSem(); paintEmerg(); preview(); }
  });
  window.addEventListener('beforeunload', e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
  // احتياط: إن فُتحت الصفحة على #bank وأُطلق حدث التبويب قبل تحميل هذا الملف
  window.addEventListener('load', () => setTimeout(() => {
    const R = root(); if (R && R.classList.contains('on') && !BK.loaded && typeof api === 'function') { BK.onTab = true; render(); }
  }, 300));
})();
