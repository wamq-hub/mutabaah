/* نسخة المتصفح: تعديلات فوق app.js. البرنامج كله يعمل داخل متصفح المستخدم، وملفات المدربين تُقرأ من جهازه ولا تُرسل لأي خادم.
   - ربط ملف كل مدرب من الجهاز (File System Access في Edge وChrome) وإعادة قراءته متى تغيّر.
   - البحث عن ملفات المدربين في مجلد يختاره المستخدم.
   - نسخة احتياطية واستعادة ومسح البيانات، وتنزيل ملف المدرب من القالب. */
(function () {
  const FS = typeof window.showOpenFilePicker === 'function';
  const DIRS = typeof window.showDirectoryPicker === 'function';
  const LINKED_LABEL = 'ملف مربوط من جهازك', COPY_LABEL = 'نسخة مرفوعة';
  const SUFFIX = ' — يعمل داخل متصفحك، وبياناتك لا تغادر جهازك';
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const LINKS = new Map();   // معرّف المدرب ← {id, handle, name, lastModified, readAt, perm, err}
  UPLOAD_LABEL = LINKED_LABEL;

  const nGen = n => n === 1 ? 'ملف واحد' : n === 2 ? 'ملفين' : n >= 3 && n <= 10 ? `${n} ملفات` : `${n} ملفاً`;
  const CHANGED = n => `أُعيدت قراءة الملفات التي تغيّرت (${n})`;
  const stamp = () => { const d = new Date(), p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  // ═════════ التخزين المحلي لمقابض الملفات (IndexedDB في هذا المتصفح)
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('tasks-web-links', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('files', { keyPath: 'id' }); r.result.createObjectStore('dirs', { keyPath: 'name' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function tx(store, mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), req = fn(t.objectStore(store));
      t.oncomplete = () => { db.close(); res(req ? req.result : undefined); };
      t.onerror = t.onabort = () => { db.close(); rej(t.error); };
    });
  }
  const plain = r => ({ id: r.id, handle: r.handle, name: r.name, lastModified: r.lastModified, readAt: r.readAt });
  async function saveLink(rec) { await tx('files', 'readwrite', s => s.put(plain(rec))); LINKS.set(rec.id, rec); }
  async function dropLink(id) { LINKS.delete(id); try { await tx('files', 'readwrite', s => s.delete(id)); } catch (e) { /* */ } }
  async function loadLinks() {
    const old = new Map(LINKS); LINKS.clear();
    try { for (const r of await tx('files', 'readonly', s => s.getAll())) LINKS.set(r.id, Object.assign(r, { perm: (old.get(r.id) || {}).perm, err: (old.get(r.id) || {}).err })); }
    catch (e) { /* متصفح بلا IndexedDB أو تصفح خاص */ }
  }
  async function clearLinks() { LINKS.clear(); try { await tx('files', 'readwrite', s => s.clear()); await tx('dirs', 'readwrite', s => s.clear()); } catch (e) { /* */ } }

  async function permission(h, ask) {
    try { const o = { mode: 'read' }; let p = await h.queryPermission(o); if (p !== 'granted' && ask) p = await h.requestPermission(o); return p; }
    catch (e) { return 'prompt'; }
  }
  async function send(file, tid) {
    const fd = new FormData(); fd.append('file', file, file.name); if (tid) fd.append('trainer', tid);
    return api('/api/upload', { method: 'POST', body: fd });
  }
  async function refreshAll() { await loadState(); await loadDash(); renderTrainers(); }

  // ═════════ التنزيلات: تُجلب ثم تُحفظ من المتصفح نفسه (أضمن من ترك التنزيل لعامل الخدمة في كل المتصفحات)
  const DL = /^\/(api\/web\/(backup|template)|api\/template|issued\/|locked\/)/;
  async function fetchDownload(href) {
    toast('جارٍ تجهيز الملف…');
    const r = await fetch(href);
    if (!r.ok) { let m = 'تعذر تنزيل الملف'; try { m = (await r.json()).error || m; } catch (e) { /* */ } return toast(m, 1); }
    const cd = r.headers.get('content-disposition') || '';
    const star = (cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1], simple = (cd.match(/filename="?([^";]+)"?/i) || [])[1];
    const name = star ? decodeURIComponent(star) : (simple || decodeURIComponent(new URL(href, location.href).pathname.split('/').pop()) || 'ملف');
    const u = URL.createObjectURL(await r.blob()), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
    toast('نُزّل الملف: ' + name);
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]'); if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || !DL.test(u.pathname) || /\.html?$/i.test(u.pathname)) return;
    e.preventDefault(); fetchDownload(u.pathname + u.search);
  }, true);

  // ═════════ إعادة قراءة الملفات المربوطة: يُرفع الملف فقط إذا تغيّر منذ آخر قراءة
  let syncing = null;
  function syncAll(opts) { if (!syncing) syncing = doSync(opts || {}).finally(() => { syncing = null; }); return syncing; }
  async function doSync({ ask }) {
    await loadLinks();
    const ids = STATE ? new Set(STATE.trainers.map(t => t.id)) : null;
    let changed = 0, waiting = 0, failed = 0;
    if (ask) { try { for (const d of await tx('dirs', 'readonly', s => s.getAll())) await permission(d.handle, true); } catch (e) { /* */ } }
    for (const rec of [...LINKS.values()]) {
      if (ids && !ids.has(rec.id)) { await dropLink(rec.id); continue; }
      rec.perm = await permission(rec.handle, ask);
      if (rec.perm !== 'granted') { waiting++; continue; }
      let f;
      try { f = await rec.handle.getFile(); rec.err = ''; }
      catch (e) { rec.err = 'تعذر الوصول إلى الملف؛ ربما نُقل أو حُذف أو تغيّر اسمه. اربطه من جديد.'; failed++; continue; }
      if (f.lastModified !== rec.lastModified) {
        const r = await send(f, rec.id);
        if (r.ok) { changed++; rec.lastModified = f.lastModified; rec.name = f.name; }
        else { rec.err = r.error || 'تعذرت قراءة الملف'; failed++; continue; }
      }
      rec.readAt = stamp();
      try { await saveLink(rec); } catch (e) { /* */ }
    }
    permBar(waiting);
    return { changed, waiting, failed };
  }

  // شريط طلب الإذن: المتصفح يطلب موافقة المستخدم لقراءة الملفات المربوطة في كل جلسة جديدة (ما لم يسمح دائماً)
  const bar = el('div', '', '<span></span><button class="btn sm t" type="button">السماح بقراءة ملفات المدربين المربوطة</button>');
  bar.id = 'web-perm';
  document.querySelector('main').prepend(bar);
  function permBar(n) {
    bar.classList.toggle('on', n > 0);
    bar.querySelector('span').textContent = n ? `يحتاج المتصفح إذنك في هذه الجلسة لقراءة الملفات المربوطة من جهازك (${n}).` : '';
  }
  bar.querySelector('button').onclick = async () => {
    const r = await syncAll({ ask: true });
    await refreshAll();
    toast(r.waiting ? `بقيت ملفات دون إذن (${r.waiting})` : (r.changed ? CHANGED(r.changed) : 'سُمح بالقراءة، ولا تغيير في الملفات'), !!r.waiting);
  };

  // ═════════ الرأس: العنوان الفرعي وأزرار البيانات
  function subtitle() { const s = $('#hSub'); if (s && !s.textContent.endsWith(SUFFIX)) s.textContent += SUFFIX; }
  const baseLS = loadState;
  loadState = async function () { const r = await baseLS.apply(this, arguments); subtitle(); return r; };

  const acts = document.querySelector('header.top .acts'), refresh = $('#bRefresh');
  const hbtn = (tag, txt, title) => { const b = el(tag, 'btn ghost sm', null); b.textContent = txt; b.title = title; if (tag === 'button') b.type = 'button'; acts.insertBefore(b, refresh); return b; };
  const bk = hbtn('a', 'نسخة احتياطية', 'تنزيل كل بيانات البرنامج في ملف واحد لحفظها أو نقلها إلى جهاز آخر');
  bk.href = '/api/web/backup'; bk.setAttribute('download', '');
  const pick = el('input'); pick.type = 'file'; pick.accept = '.zip'; pick.hidden = true; document.body.appendChild(pick);
  hbtn('button', 'استعادة', 'استعادة البيانات من ملف نسخة احتياطية (يستبدل ما في هذا المتصفح)').onclick = () => pick.click();
  pick.onchange = async () => {
    const f = pick.files[0]; pick.value = ''; if (!f) return;
    if (!confirm('ستُستبدل كل البيانات في هذا المتصفح بما في النسخة الاحتياطية. هل تريد المتابعة؟')) return;
    const fd = new FormData(); fd.append('file', f, f.name);
    const r = await api('/api/web/restore', { method: 'POST', body: fd });
    if (!r.ok) return toast(r.error || 'تعذرت الاستعادة', 1);
    // الملفات المربوطة تُقرأ من جديد بعد الاستعادة حتى لا تبقى نسخة أقدم من الملف الفعلي
    try { await loadLinks(); for (const rec of LINKS.values()) { rec.lastModified = 0; await saveLink(rec); } } catch (e) { /* */ }
    toast('استُعيدت البيانات'); setTimeout(() => location.reload(), 700);
  };
  const tpl = hbtn('a', 'قالب مفرغ', 'تنزيل القالب المفرغ (بلا مهام معبأة) — وقوالب أخرى وإصدار ملف لكل مدرب في تبويب «الإصدار والقفل»');
  tpl.href = '/api/template?kind=blank'; tpl.setAttribute('download', '');

  refresh.title = 'إعادة قراءة ملفات المدربين المربوطة من جهازك';
  refresh.onclick = async () => {
    const r = await syncAll();
    await refreshAll();
    if (r.waiting) toast(`يلزم السماح بقراءة ${nGen(r.waiting)} — اضغط زر السماح أعلى الصفحة`, 1);
    else if (r.failed) toast(`تعذرت قراءة ${nGen(r.failed)} — انظر بطاقات المدربين`, 1);
    else toast(r.changed ? CHANGED(r.changed) : (LINKS.size ? 'لا تغيير في الملفات المربوطة' : 'حُدّث العرض'));
  };

  // ═════════ لوحة القسم: «ملف مربوط» لمن له ربط، و«نسخة مرفوعة» لغيره
  const baseRD = renderDash;
  renderDash = function () {
    baseRD.apply(this, arguments);
    $$('#tTr .who').forEach(w => {
      const nm = w.querySelector('.nm[data-tr]'), sm = w.querySelector('.sm');
      if (nm && sm && !LINKS.has(nm.dataset.tr) && sm.textContent.includes(LINKED_LABEL)) sm.textContent = sm.textContent.replace(LINKED_LABEL, COPY_LABEL);
    });
  };

  // تفاصيل المدرب: اسم الملف بدل مسار التخزين الداخلي
  const baseRTr = renderTrainer;
  renderTrainer = function () {
    baseRTr.apply(this, arguments);
    const sm = $('#panel .mh .sm'); if (!sm || !TR) return;
    const L = LINKS.get(TR.id), t = (STATE && STATE.trainers.find(x => x.id === TR.id)) || {};
    if (L) sm.textContent = `${LINKED_LABEL}: ${L.name}${L.readAt ? ' — آخر قراءة ' + L.readAt : ''}`;
    else if (t.mode === 'upload') sm.textContent = `${COPY_LABEL}: ${t.upload_name || ''}${t.uploaded ? ' — ' + t.uploaded : ''}`;
    else sm.textContent = 'لم يُحدَّد ملف هذا المدرب';
  };

  // ═════════ بطاقات المدربين: ربط الملف من الجهاز وتنزيل ملفه من القالب
  const baseRT = renderTrainers;
  renderTrainers = function () { baseRT.apply(this, arguments); decorate(); };
  function cardStatus(t, L) {
    if (L && L.err) return ['err', `<b><bdi>${esc(L.name)}</bdi></b>: ${esc(L.err)}`];
    if (L && L.perm && L.perm !== 'granted') return ['warn', `مربوط بالملف <b><bdi>${esc(L.name)}</bdi></b> — يحتاج إذنك بالقراءة (الزر أعلى الصفحة)`];
    if (L) return ['ok', `مربوط بالملف <b><bdi>${esc(L.name)}</bdi></b>${L.readAt ? ' — آخر قراءة ' + esc(L.readAt) : ''}`];
    if (t.mode === 'upload') return ['', `${COPY_LABEL}: <b><bdi>${esc(t.upload_name || '')}</bdi></b>${t.uploaded ? ' — ' + esc(t.uploaded) : ''}`
      + (FS ? '. اربط الملف من جهازك لتُقرأ تعديلاته أولاً بأول.' : '. أعد اختيار الملف أو أفلته هنا بعد كل تحديث.')];
    return ['', 'لم يُحدَّد ملف هذا المدرب بعد.'];
  }
  function decorate() {
    if (!STATE) return;
    $$('#trList .person[data-id]').forEach(card => {
      const id = card.dataset.id, t = STATE.trainers.find(x => x.id === id) || {}, L = LINKS.get(id);
      const badge = card.querySelector('.hd .badge');
      if (badge && L && badge.textContent === COPY_LABEL) { badge.textContent = 'مربوط بملف من جهازك'; badge.className = 'badge ok'; }
      const info = card.querySelector('.tInfo'); if (info && t.mode === 'upload') info.textContent = '';
      const [cls, html] = cardStatus(t, L);
      const box = el('div', 'web-link',
        `<span class="st ${cls}">${html}</span><span class="sp">`
        + `<button class="btn sm t" type="button" data-w="link">${FS ? (L ? 'تغيير الملف المربوط' : 'ربط ملف من جهازك') : 'اختيار ملفه من جهازك'}</button>`
        + (L ? '<button class="btn sm" type="button" data-w="unlink">إلغاء الربط</button>' : '')
        + `<a class="btn sm" href="/api/web/template?id=${encodeURIComponent(id)}" download>تنزيل ملفه من القالب</a></span>`
        + '<input type="file" accept=".xlsx" hidden data-w="file">');
      const old = card.querySelector('.web-link'); if (old) old.remove();
      const drop = card.querySelector('.drop'); card.insertBefore(box, drop || null);
    });
  }
  $('#trList').addEventListener('click', async e => {
    const b = e.target.closest('[data-w]'); if (!b || b.tagName === 'INPUT') return;
    const card = b.closest('.person'), id = card.dataset.id;
    if (b.dataset.w === 'link') { if (FS) linkOne(id); else card.querySelector('input[data-w=file]').click(); }
    if (b.dataset.w === 'unlink') { await dropLink(id); renderTrainers(); renderDash(); toast('أُلغي الربط، وتبقى آخر نسخة مقروءة من الملف'); }
  });
  $('#trList').addEventListener('change', e => {
    const i = e.target.closest('input[data-w=file]'); if (!i || !i.files.length) return;
    const files = [...i.files]; i.value = ''; upload(files, i.closest('.person').dataset.id);
  });
  async function linkOne(id) {
    let h;
    try { [h] = await window.showOpenFilePicker({ id: 'tasks-file', multiple: false, types: [{ description: 'ملف متابعة المهام (Excel)', accept: { [XLSX]: ['.xlsx'] } }] }); }
    catch (e) { return; }   // أُغلقت النافذة
    const f = await h.getFile(), r = await send(f, id);
    if (!r.ok) return toast(r.error || 'تعذرت قراءة الملف', 1);
    await saveLink({ id, handle: h, name: f.name, lastModified: f.lastModified, readAt: stamp(), perm: 'granted', err: '' });
    toast(`رُبط الملف «${f.name}»`);
    await refreshAll();
  }

  // ═════════ البحث عن ملفات المدربين في مجلد
  const scanCard = $('#scanOut').closest('.card'), scanOut = $('#scanOut');
  const srow = el('div', 'row web-scan');
  if (DIRS) srow.innerHTML = '<button class="btn t" type="button">اختيار مجلد المدربين…</button>';
  else srow.innerHTML = '<label class="btn t">اختيار مجلد المدربين…<input type="file" webkitdirectory multiple hidden></label>';
  scanCard.insertBefore(srow, scanCard.querySelector('.hint'));
  scanCard.querySelector('.hint').textContent = 'يبحث في المجلد الذي تختاره وما تحته (حتى ستة مستويات) عن ملفات القالب، ويربط كل ملف بصاحبه حسب الاسم المكتوب داخله، ويضيف المدرب إن لم يكن مضافاً.'
    + (DIRS ? ' تبقى الملفات مربوطة، فتُقرأ تعديلاتها عند «↻ تحديث».' : ' متصفحك لا يدعم الربط المباشر، فتُحفظ نسخة من كل ملف؛ استخدم Edge أو Chrome للربط المباشر.');
  async function* walk(dir, depth, rel) {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('~$') || name.startsWith('.')) continue;
      if (h.kind === 'directory') { if (depth < 6) yield* walk(h, depth + 1, rel + name + '/'); }
      else if (/\.xlsx$/i.test(name)) yield [h, rel + name];
    }
  }
  function scanTable(rows, total) {
    if (!rows.length) { scanOut.innerHTML = `<div class="muted">لم يُعثر على ملفات من القالب${total ? ` (عدد ملفات Excel المفحوصة: ${total})` : ''}.</div>`; return; }
    scanOut.innerHTML = `<p class="hint">عدد ملفات Excel في المجلد: ${total}، والمربوط منها بأصحابه: ${rows.length}.</p>`
      + '<div class="wrap"><table class="t"><thead><tr><th class="r">الاسم داخل الملف</th><th class="r">المدرب في البرنامج</th><th class="r">الملف</th><th></th></tr></thead><tbody>'
      + rows.map(x => `<tr><td class="r"><b>${esc(x.name || '(فارغ)')}</b></td><td class="r">${esc(x.trainer)}</td><td class="r" style="direction:ltr;font-size:.78rem">${esc(x.rel)}</td>`
        + `<td>${x.created ? '<span class="badge mid">مدرب جديد</span>' : '<span class="badge ok">رُبط</span>'}${x.dup ? ' <span class="badge na">حلّ محل ملف سابق للمدرب نفسه</span>' : ''}</td></tr>`).join('')
      + '</tbody></table></div>';
  }
  async function scanEntries(entries, dirHandle) {
    const rows = [], seen = new Set(); let total = 0;
    for await (const [src, rel] of entries) {
      if (++total > 400) break;
      scanOut.innerHTML = `<div class="muted">جارٍ القراءة… ${esc(rel)}</div>`;
      let f; try { f = src.kind === 'file' ? await src.getFile() : src; } catch (e) { continue; }
      const r = await send(f, '');
      if (!r.ok) continue;   // ليس من القالب: يُتجاوز بهدوء
      const id = r.trainer.id;
      if (src.kind === 'file') await saveLink({ id, handle: src, name: f.name, lastModified: f.lastModified, readAt: stamp(), perm: 'granted', err: '' });
      rows.push({ name: r.file_name, trainer: r.trainer.name, rel, created: r.created, dup: seen.has(id) });
      seen.add(id);
    }
    if (dirHandle) { try { await tx('dirs', 'readwrite', s => s.put({ name: dirHandle.name, handle: dirHandle })); } catch (e) { /* */ } }
    scanTable(rows, Math.min(total, 400));
    toast(rows.length ? `رُبطت الملفات بأصحابها (${seen.size})` : 'لم يُعثر على ملفات من القالب', !rows.length);
    await refreshAll();
  }
  if (DIRS) srow.querySelector('button').onclick = async () => {
    let dir;
    try { dir = await window.showDirectoryPicker({ id: 'tasks-dir', mode: 'read' }); } catch (e) { return; }
    scanOut.innerHTML = '<div class="muted">جارٍ البحث…</div>';
    await scanEntries(walk(dir, 0, dir.name + '/'), dir);
  };
  else srow.querySelector('input').onchange = async ev => {
    const files = [...ev.target.files].filter(f => /\.xlsx$/i.test(f.name) && !f.name.startsWith('~$')
      && (f.webkitRelativePath || f.name).split('/').length <= 8);
    ev.target.value = '';
    await scanEntries(files.map(f => [f, f.webkitRelativePath || f.name]), null);
  };

  // ═════════ نصوص تناسب نسخة المتصفح
  const addHint = $('#bAdd').closest('.card').querySelector('.hint');
  if (addHint) addHint.textContent = FS
    ? 'بعد الإضافة اربط ملف المدرب من بطاقته: «ربط ملف من جهازك» لملف موجود، أو «تنزيل ملفه من القالب» لإرساله إليه، أو أفلت الملف على بطاقته.'
    : 'بعد الإضافة اختر ملف المدرب من بطاقته أو أفلته عليها، أو نزّل ملفه من القالب لإرساله إليه.';
  const dropNote = $('#drop .muted');
  if (dropNote) dropNote.textContent = 'تُقرأ داخل متصفحك وتُحفظ نسخة منها فيه، وتُربط بصاحبها حسب الاسم المكتوب داخل الملف. وللقراءة أولاً بأول اربط ملف المدرب من بطاقته.';

  // التقارير: لا PDF مباشر؛ التقرير يُفتح في صفحة مستقلة وفيها زر «طباعة / حفظ PDF»
  const rPdf = $('#rPdf'); if (rPdf) rPdf.checked = false;
  // الإصدار والقفل: لا مجلدات على الجهاز؛ النتيجة ملف zip يُنزَّل
  ['#lkBeside', '#isLink'].forEach(s => { const c = $(s); if (c) c.checked = false; });
  const repMsg = $('#repMsg');
  if (repMsg) {
    repMsg.before(el('p', 'hint', 'يُفتح كل تقرير في صفحة مستقلة على الورق الرسمي، وفيها زر «طباعة / حفظ PDF» لحفظه ملف PDF من المتصفح.'));
    new MutationObserver(() => { const m = repMsg.querySelector('.muted'); if (m && m.textContent.includes('PDF')) m.textContent = 'جارٍ الإصدار…'; })
      .observe(repMsg, { childList: true, subtree: true });
  }

  // الإعدادات: الخصوصية ومسح البيانات
  const cfgCard = $('#bCfg') && $('#bCfg').closest('.card');
  if (cfgCard) {
    cfgCard.appendChild(el('p', 'web-note', 'بياناتك محفوظة في <b>هذا المتصفح فقط</b> ولا تُرسل إلى أي خادم، وملفات المدربين تُقرأ من جهازك مباشرة. '
      + 'خذ <b>نسخة احتياطية</b> بانتظام (الزر أعلى الصفحة)، لأن مسح بيانات التصفح يمسحها، ولا تنتقل تلقائياً إلى جهاز أو متصفح آخر.'));
    const box = el('div', 'web-danger', '<button class="btn danger" type="button">مسح كل البيانات من هذا المتصفح</button><span class="muted">للأجهزة المشتركة: يحذف المدربين والنسخ المرفوعة والتقارير والإعدادات وروابط الملفات نهائياً، ولا يمس ملفات المدربين على جهازك.</span>');
    box.querySelector('button').onclick = async () => {
      if (!confirm('سيُحذف كل شيء من هذا المتصفح نهائياً. هل أخذت نسخة احتياطية؟')) return;
      const r = await post('/api/web/reset'); if (!r.ok) return toast(r.error || 'تعذر المسح', 1);
      await clearLinks(); location.reload();
    };
    cfgCard.appendChild(box);
  }

  // ═════════ البدء: بعد أن يحمّل app.js الحالة واللوحة تُقرأ الملفات المربوطة، ثم كلما عاد المستخدم إلى التبويب
  const until = (fn, ms = 30000) => new Promise(res => { const t0 = Date.now(); (function w() { if (fn() || Date.now() - t0 > ms) res(); else setTimeout(w, 100); })(); });
  (async () => {
    await until(() => STATE && DASH);
    subtitle();
    const r = await syncAll();
    if (r.changed) { await loadState(); await loadDash(); }
    renderTrainers(); renderDash();
  })();
  let lastFocus = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !LINKS.size || Date.now() - lastFocus < 10000) return;
    lastFocus = Date.now();
    const r = await syncAll();
    if (r.changed) { await loadDash(); renderTrainers(); toast(CHANGED(r.changed)); }
  });
})();
