import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const outDir = path.join(process.cwd(), "docs", "assets", "screenshots");
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withPage(fn) {
  const port = 9228;
  const proc = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      "--window-size=1280,800",
      "about:blank"
    ],
    { stdio: "ignore" }
  );
  await sleep(2500);
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const page = list.find((t) => t.type === "page") ?? list[0];
  if (!page?.webSocketDebuggerUrl) throw new Error("No page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => {
        if (pending.has(i)) {
          pending.delete(i);
          reject(new Error(`timeout ${method}`));
        }
      }, 20000);
    });
  try {
    await fn(send);
  } finally {
    try {
      ws.close();
    } catch {}
    try {
      proc.kill();
    } catch {}
  }
}

async function screenshot(send, name) {
  const file = path.join(outDir, name);
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log("saved", name, fs.statSync(file).size);
}

async function setValue(send, selector, value) {
  const expr = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'missing';
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, ${JSON.stringify(value)});
    else el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`;
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  console.log(selector, r.result?.value);
}

(async () => {
  await withPage(async (send) => {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");

    await send("Page.navigate", { url: `${BASE}/login` });
    await sleep(3500);
    await screenshot(send, "login.png");

    const screenshotPassword = process.env.E2E_PASSWORD;
    if (!screenshotPassword) {
      throw new Error("E2E_PASSWORD wajib diisi untuk capture-screenshots.");
    }
    await setValue(
      send,
      'input[name="email"], input[type="email"]',
      process.env.E2E_DOCTOR_EMAIL ?? "dokter@klinik.example"
    );
    await setValue(send, 'input[name="password"], input[type="password"]', screenshotPassword);
    await send("Runtime.evaluate", {
      expression: `document.querySelector('button[type="submit"]')?.click(); 'clicked'`,
      returnByValue: true
    });
    await sleep(5000);
    await screenshot(send, "dashboard.png");

    await send("Page.navigate", { url: `${BASE}/triage` });
    await sleep(3500);
    await screenshot(send, "triage.png");

    await send("Page.navigate", { url: `${BASE}/reports` });
    await sleep(3500);
    await screenshot(send, "reports.png");

    await send("Page.navigate", { url: `${BASE}/audit` });
    await sleep(3500);
    await screenshot(send, "audit.png");
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
