/* عامل الخدمة: يحوّل طلبات الأداة (/api و/img و/reports و/issued و/locked) إلى صفحة الأداة المفتوحة، وهي تشغّلها ببايثون داخل المتصفح.
   لا يُرسل أي طلب إلى خادم: البيانات تبقى في متصفح المستخدم. */
const VERSION = "20261007224642";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

const APP_PATHS = ["/api/", "/img/", "/reports/", "/issued/", "/locked/"];
const isApp = u => u.origin === self.location.origin && APP_PATHS.some(p => u.pathname.startsWith(p));
const isHost = c => { try { const p = new URL(c.url).pathname; return p === "/" || p === "/index.html"; } catch (e) { return false; } };

self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (isApp(u)) e.respondWith(relay(e.request, u));
});

async function relay(req, u) {
  const body = (req.method === "GET" || req.method === "HEAD") ? null : await req.arrayBuffer();
  const headers = {}; req.headers.forEach((v, k) => { headers[k] = v; });
  const msg = { method: req.method, path: u.pathname + u.search, headers, body };
  const hosts = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter(isHost);
  for (const c of hosts) {
    const r = await ask(c, msg);
    if (r) return new Response(r.status === 204 ? null : r.body, { status: r.status, headers: r.headers });
  }
  return new Response(JSON.stringify({ error: "صفحة البرنامج الرئيسية غير مفتوحة. افتحها في تبويب ثم أعد المحاولة." }),
    { status: 503, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function ask(client, msg) {
  return new Promise(res => {
    const ch = new MessageChannel();
    const t = setTimeout(() => res(null), 15 * 60 * 1000);
    ch.port1.onmessage = ev => { clearTimeout(t); res(ev.data); };
    const copy = { ...msg, body: msg.body ? msg.body.slice(0) : null };
    client.postMessage({ type: "tasks-req", msg: copy }, [ch.port2].concat(copy.body ? [copy.body] : []));
  });
}
