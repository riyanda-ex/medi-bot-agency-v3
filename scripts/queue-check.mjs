const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@klinik.example";
const PASSWORD = process.env.E2E_PASSWORD;
if (!PASSWORD) {
  throw new Error("E2E_PASSWORD wajib diisi (tidak ada kata sandi uji bawaan).");
}

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
  if (!jar.has("authjs.session-token"))
    throw new Error(`Login admin gagal: ${await response.text()}`);
  // Browser mengirim Origin otomatis pada request mutasi; script harus menirunya.
  return { cookie: cookieHeader(jar), origin: BASE };
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
  // CI job verify-redis-queue menyetel QUEUE_MODE=redis + REDIS_URL dan menjalankan
  // worker terpisah. Mode sync (default lokal) tetap diverifikasi di sini agar
  // script bisa dipakai tanpa Redis, tetapi tidak boleh mengklaim queue terpisah.
  const queueMode = process.env.QUEUE_MODE === "redis" ? "redis" : "sync";

  const runResponse = await fetch(`${BASE}/api/orchestrator/run`, {
    method: "POST",
    headers: { Accept: "application/json", ...auth }
  });
  const run = await readJson(runResponse, "Manual Run");
  if (queueMode === "redis") {
    await check(
      "Manual Run masuk antrean (202)",
      runResponse.status === 202,
      `status=${runResponse.status} body=${JSON.stringify(run)}`
    );
    await check(
      "Manual Run memiliki jobId",
      typeof run?.jobId === "string" && run.jobId.length > 0,
      run?.jobId
    );
  } else {
    await check(
      "Manual Run selesai sinkron (200)",
      runResponse.status === 200 && typeof run?.runId === "string" && Array.isArray(run?.outcomes),
      `status=${runResponse.status} runId=${run?.runId ?? "-"}`
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
  if (queueMode === "redis") {
    await check(
      "Simulasi urgent masuk antrean (202)",
      simulateResponse.status === 202,
      `status=${simulateResponse.status} body=${JSON.stringify(simulated)}`
    );
    await check(
      "Simulasi urgent memiliki jobId",
      typeof simulated?.jobId === "string" && simulated.jobId.length > 0,
      simulated?.jobId
    );
  } else {
    await check(
      "Simulasi urgent selesai sinkron (200)",
      simulateResponse.status === 200 && simulated?.totalLogs === 4,
      `status=${simulateResponse.status} totalLogs=${simulated?.totalLogs ?? "-"}`
    );
  }

  console.log(
    queueMode === "redis"
      ? "\nQUEUE MODE OK: producer dan worker terpisah aktif."
      : "\nSYNC MODE OK: verifikasi producer/worker penuh memerlukan QUEUE_MODE=redis + REDIS_URL."
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
