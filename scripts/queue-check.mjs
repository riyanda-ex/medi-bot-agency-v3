const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@klinik.example";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";

function storeCookies(response, jar) {
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(";")[0];
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function login() {
  const jar = new Map();
  const csrf = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookieHeader(jar) } });
  storeCookies(csrf, jar);
  const { csrfToken } = await csrf.json();
  const response = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(jar)
    },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: BASE, json: "true" }),
    redirect: "manual"
  });
  storeCookies(response, jar);
  if (!jar.has("next-auth.session-token")) throw new Error(`Login admin gagal: ${await response.text()}`);
  return { cookie: cookieHeader(jar) };
}

async function check(name, condition, detail = "") {
  if (!condition) throw new Error(`GAGAL ${name}${detail ? `: ${detail}` : ""}`);
  console.log(`OK   ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const auth = await login();

  const runResponse = await fetch(`${BASE}/api/orchestrator/run`, { method: "POST", headers: auth });
  const run = await runResponse.json();
  await check("Manual Run masuk antrean (202)", runResponse.status === 202, `status=${runResponse.status}`);
  await check("Manual Run memiliki jobId", typeof run.jobId === "string" && run.jobId.length > 0, run.jobId);

  const patientsResponse = await fetch(`${BASE}/api/patients`, { headers: auth });
  const { patients } = await patientsResponse.json();
  if (!Array.isArray(patients) || patients.length === 0) throw new Error("Tidak ada pasien untuk simulasi.");

  const simulateResponse = await fetch(`${BASE}/api/urgent/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ patientId: patients[0].id })
  });
  const simulated = await simulateResponse.json();
  await check("Simulasi urgent masuk antrean (202)", simulateResponse.status === 202, `status=${simulateResponse.status}`);
  await check("Simulasi urgent memiliki jobId", typeof simulated.jobId === "string" && simulated.jobId.length > 0, simulated.jobId);

  console.log("\nQUEUE MODE OK: producer dan worker terpisah aktif.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
