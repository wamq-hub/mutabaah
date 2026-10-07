/* عامل بايثون: يحمّل Pyodide والتطبيق، ويخزّن البيانات في IndexedDB على جهاز المستخدم. */
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";
importScripts(PYODIDE + "pyodide.js");
const VERSION = "20261007202606";
const WHEELS = ["blinker-1.9.0-py3-none-any.whl", "et_xmlfile-2.0.0-py3-none-any.whl", "flask-3.1.0-py3-none-any.whl", "hijridate-2.3.0-py3-none-any.whl", "itsdangerous-2.2.0-py3-none-any.whl", "openpyxl-3.1.5-py2.py3-none-any.whl", "werkzeug-3.1.3-py3-none-any.whl"];
let py = null, handle = null, ready = null, syncing = Promise.resolve();

const say = (text) => postMessage({ type: "progress", text });

async function boot() {
  say("تحميل محرك بايثون…");
  py = await loadPyodide({ indexURL: PYODIDE });
  say("تحميل المكتبات (Excel)…");
  await py.loadPackage(["micropip", "lxml", "pillow", "jinja2", "markupsafe", "click", "typing-extensions"]);
  const micropip = py.pyimport("micropip");
  await micropip.install(WHEELS.map(w => new URL("/wheels/" + w, self.location.origin).href), { deps: false });
  say("تجهيز التخزين على جهازك…");
  py.FS.mkdirTree("/data");
  py.FS.mount(py.FS.filesystems.IDBFS, {}, "/data");
  await sync(true);
  say("تحميل البرنامج…");
  const zip = await (await fetch("/py/app.zip?v=" + VERSION)).arrayBuffer();
  py.unpackArchive(zip, "zip", { extractDir: "/app" });
  py.runPython(`
import sys, os
sys.path[:0] = ["/app", "/app/src", "/app/web"]
os.chdir("/app")
import web_shim
`);
  handle = py.pyimport("web_shim").handle;
  await sync(false);
}

function sync(populate) {
  syncing = syncing.then(() => new Promise((res, rej) => py.FS.syncfs(populate, err => err ? rej(err) : res())));
  return syncing;
}

async function serve(id, m) {
  try {
    await ready;
    const body = m.body ? new Uint8Array(m.body) : undefined;   // undefined ← None في بايثون (null يصل JsNull)
    const r = handle(m.method, m.path, py.toPy(m.headers || {}), body);
    const [status, hdrs, data] = r.toJs({ create_proxies: false });
    r.destroy();
    const out = data instanceof Uint8Array ? data : new Uint8Array(data);
    const headers = {};
    for (const [k, v] of hdrs) headers[k] = v;
    if (m.method !== "GET" && m.method !== "HEAD") await sync(false);
    const buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    postMessage({ type: "res", id, status, headers, body: buf }, [buf]);
  } catch (err) {
    const msg = String((err && err.message) || err).split("\n").filter(Boolean).slice(-1)[0] || "خطأ غير معروف";
    const buf = new TextEncoder().encode(JSON.stringify({ error: "خطأ داخلي في الأداة: " + msg })).buffer;
    postMessage({ type: "res", id, status: 500, headers: { "Content-Type": "application/json; charset=utf-8" }, body: buf }, [buf]);
  }
}

onmessage = ev => {
  const d = ev.data;
  if (d.type === "req") serve(d.id, d.msg);
};

ready = boot().then(() => postMessage({ type: "ready" }), err => postMessage({ type: "fail", text: String((err && err.message) || err) }));
