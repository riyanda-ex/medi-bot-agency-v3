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
    body: new URLSearchParams({
      csrfToken,
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: BASE,
      json: "true"
    }),
    redirect: "manual"
  });
  storeCookies(response, jar);
  if (!jar.has("next-auth.session-token"))
    throw new Error(`Login admin gagal: ${await response.text()}`);
  return { cookie: cookieHeader(jar) };
}

async function check(name, condition, detail = "") {
  if (!condition) throw new Error(`GAGAL ${name}${detail ? `: ${detail}` : ""}`);
  console.log(`OK   ${name}${detail ? ` — ${detail}` : ""}`);
}

async function readJson(response, label) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `${label} mengembalikan JSON tidak valid (status=${response.status}): ${text.slice(0, 200)}`
    );
  }
}

async function main() {
  const auth = await login();

  const runResponse = await fetch(`${BASE}/api/orchestrator/run`, {
    method: "POST",
    headers: { Accept: "application/json", ...auth }
  });
  const run = await readJson(runResponse, "Manual Run");
  const runQueued = run?.queued === true;
  await check(
    "Manual Run diterima (202 redis / 200 sync)",
    runQueued ? runResponse.status === 202 : runResponse.status === 200,
    `status=${runResponse.status} body=${JSON.stringify(run).slice(0, 200)}`
  );
  if (runQueued) {
    await check(
      "Manual Run memiliki jobId",
      typeof run.jobId === "string" && run.jobId.length > 0,
      run.jobId
    );
  } else {
    const outcomes = run?.outcomes ?? [];
    await check(
      "Manual Run sync: semua agent sukses",
      outcomes.length === 6 && outcomes.every((item) => item.status === "SUCCESS"),
      `${outcomes.length} agent`
    );
  }

  const patientsResponse = await fetch(`${BASE}/api/patients`, {
    headers: { Accept: "application/json", ...auth }
  });
  const patientsBody = await readJson(patientsResponse, "Daftar pasien");
  const patients = patientsBody?.patients;
  if (!Array.isArray(patients) || patients.length === 0)
    throw new Error(
      `Tidak ada pasien untuk simulasi (status=${patientsResponse.status}): ${JSON.stringify(patientsBody)}`
    );

  const simulateResponse = await fetch(`${BASE}/api/urgent/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...auth },
    body: JSON.stringify({ patientId: patients[0].id })
  });
  const simulated = await readJson(simulateResponse, "Simulasi urgent");
  const simulateQueued = simulated?.queued === true;
  await check(
    "Simulasi urgent diterima (202 redis / 200 sync)",
    simulateQueued ? simulateResponse.status === 202 : simulateResponse.status === 200,
    `status=${simulateResponse.status} body=${JSON.stringify(simulated).slice(0, 200)}`
  );
  if (simulateQueued) {
    await check(
      "Simulasi urgent memiliki jobId",
      typeof simulated.jobId === "string" && simulated.jobId.length > 0,
      simulated.jobId
    );
  } else {
    await check(
      "Simulasi urgent sync: log dibuat",
      typeof simulated?.totalLogs === "number" && simulated.totalLogs > 0,
      `${simulated?.totalLogs} log`
    );
  }

  console.log("\nQUEUE MODE OK: antrean redis atau mode sinkron aktif.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
