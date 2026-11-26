const BASE = process.env.BASE_URL ?? "http://localhost:3000";

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

async function login(email, password) {
  const jar = new Map();
  const csrfResponse = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookieHeader(jar) } });
  storeCookies(csrfResponse, jar);
  const { csrfToken } = await csrfResponse.json();

  const body = new URLSearchParams({
    csrfToken,
    email,
    password,
    callbackUrl: BASE,
    json: "true"
  });
  const response = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(jar)
    },
    body,
    redirect: "manual"
  });
  storeCookies(response, jar);
  if (!jar.has("next-auth.session-token")) {
    throw new Error(`Login gagal untuk ${email}: ${await response.text()}`);
  }
  return jar;
}

async function check(name, condition, detail = "") {
  if (!condition) throw new Error(`GAGAL ${name}${detail ? `: ${detail}` : ""}`);
  console.log(`OK   ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const doctor = await login("dokter@klinik.example", "password123");
  const receptionist = await login("resepsionis@klinik.example", "password123");
  const admin = await login("admin@klinik.example", "password123");

  const doctorDashboard = await (await fetch(`${BASE}/dashboard`, { headers: { cookie: cookieHeader(doctor) } })).text();
  await check(
    "DOKTER melihat diagnosis",
    doctorDashboard.includes("Lihat diagnosis:") && doctorDashboard.includes(">IZIN<")
  );

  const receptionistDashboard = await (await fetch(`${BASE}/dashboard`, { headers: { cookie: cookieHeader(receptionist) } })).text();
  await check(
    "RESEPSIONIS tidak melihat diagnosis",
    receptionistDashboard.includes("Lihat diagnosis:") && receptionistDashboard.includes(">DITOLAK<")
  );

  const patientsResponse = await fetch(`${BASE}/api/patients`, { headers: { cookie: cookieHeader(doctor) } });
  const { patients } = await patientsResponse.json();
  await check("Daftar pasien tersedia", patients.length === 20, `${patients.length} pasien`);

  const startedAt = Date.now();
  const triageResponse = await fetch(`${BASE}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieHeader(doctor) },
    body: JSON.stringify({
      patientId: patients[0].id,
      complaint: "Uji end-to-end",
      vitals: { systolic: 190, diastolic: 120 }
    })
  });
  const triage = await triageResponse.json();
  await check("Input 190/120 → MERAH", triage.level === "MERAH", `latensi ${Date.now() - startedAt} ms`);
  await check("Latensi < 5 detik", Date.now() - startedAt < 5000);

  const simulateResponse = await fetch(`${BASE}/api/urgent/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieHeader(doctor) },
    body: JSON.stringify({
      patientId: patients[0].id,
      visitId: triage.visitId,
      triageLogId: triage.triageLogId
    })
  });
  const simulated = await simulateResponse.json();
  await check("Simulasi panggilan masuk log", simulated.totalLogs === 4, `${simulated.totalLogs} baris`);

  const pdfResponse = await fetch(`${BASE}/api/reports/download?type=pdf`, {
    headers: { cookie: cookieHeader(doctor) }
  });
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  await check(
    "Download PDF",
    pdfResponse.status === 200 && pdf.subarray(0, 4).toString() === "%PDF",
    `status=${pdfResponse.status}, header=${pdf.subarray(0, 8).toString()}, body=${pdf.subarray(0, 200).toString()}`
  );

  const excelResponse = await fetch(`${BASE}/api/reports/download?type=excel`, {
    headers: { cookie: cookieHeader(doctor) }
  });
  await check("Download Excel", excelResponse.status === 200);

  const forbiddenResponse = await fetch(`${BASE}/api/reports/download?type=pdf`, {
    headers: { cookie: cookieHeader(receptionist) }
  });
  await check("RESEPSIONIS diblokir laporan", forbiddenResponse.status === 403);

  const runResponse = await fetch(`${BASE}/api/orchestrator/run`, {
    method: "POST",
    headers: { cookie: cookieHeader(admin) }
  });
  const run = await runResponse.json();
  await check("Manual Run orchestrator", Array.isArray(run.outcomes) && run.outcomes.length === 6,
    `${run.outcomes?.filter((item) => item.status === "SUCCESS").length ?? 0}/6 sukses`);

  console.log("\nSEMUA CHECK END-TO-END LOLOS.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
