const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.E2E_PASSWORD;
if (!PASSWORD) {
  throw new Error("E2E_PASSWORD wajib diisi (tidak ada kata sandi uji bawaan).");
}
const EXPECTED_DIAGNOSIS = process.env.E2E_EXPECTED_DIAGNOSIS ?? "Perlu tindak lanjut segera";

const accounts = {
  doctor: process.env.E2E_DOCTOR_EMAIL ?? "dokter@klinik.example",
  receptionist: process.env.E2E_RECEPTIONIST_EMAIL ?? "resepsionis@klinik.example",
  admin: process.env.E2E_ADMIN_EMAIL ?? "admin@klinik.example",
  patient: process.env.E2E_PATIENT_EMAIL ?? "pasien@klinik.example"
};

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

async function login(email, password = PASSWORD) {
  const jar = new Map();
  const csrfResponse = await fetch(`${BASE}/api/auth/csrf`, {
    headers: { cookie: cookieHeader(jar) }
  });
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
  if (!jar.has("authjs.session-token")) {
    throw new Error(`Login gagal untuk ${email}: ${await response.text()}`);
  }
  return jar;
}

async function check(name, condition, detail = "") {
  if (!condition) throw new Error(`GAGAL ${name}${detail ? `: ${detail}` : ""}`);
  console.log(`OK   ${name}${detail ? ` — ${detail}` : ""}`);
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  return { response, body: await response.json().catch(() => ({})) };
}

async function main() {
  const doctor = await login(accounts.doctor);
  const receptionist = await login(accounts.receptionist);
  const admin = await login(accounts.admin);
  const patient = await login(accounts.patient);
  // Browser mengirim Origin otomatis pada request mutasi; script harus menirunya
  // karena enforceSameOrigin kini aktif untuk semua endpoint cookie-auth.
  const doctorAuth = { cookie: cookieHeader(doctor), origin: BASE };
  const receptionistAuth = { cookie: cookieHeader(receptionist), origin: BASE };
  const adminAuth = { cookie: cookieHeader(admin), origin: BASE };
  const patientAuth = { cookie: cookieHeader(patient), origin: BASE };

  const doctorDashboard = await (await fetch(`${BASE}/dashboard`, { headers: doctorAuth })).text();
  const receptionistDashboard = await (
    await fetch(`${BASE}/dashboard`, { headers: receptionistAuth })
  ).text();
  await check(
    "DOKTER melihat diagnosis nyata di dashboard",
    doctorDashboard.includes("Lihat diagnosis:") &&
      doctorDashboard.includes(">IZIN<") &&
      doctorDashboard.includes(EXPECTED_DIAGNOSIS)
  );
  await check(
    "RESEPSIONIS tidak melihat diagnosis di dashboard",
    receptionistDashboard.includes(">DITOLAK<") &&
      !receptionistDashboard.includes(EXPECTED_DIAGNOSIS)
  );

  const { body: patientsBody } = await jsonFetch(`${BASE}/api/patients`, { headers: doctorAuth });
  const patients = patientsBody.patients ?? [];
  await check("Daftar pasien tersedia", patients.length === 20, `${patients.length} pasien`);

  // Cari pasien yang rekam medisnya memuat diagnosis MERAH dari seed.
  // Urutan daftar pasien alphabetical, jadi tidak bisa mengasumsikan patients[0].
  let diagnosisPatientId = "";
  for (const patient of patients) {
    const { body: record } = await jsonFetch(`${BASE}/api/patients/${patient.id}/record`, {
      headers: doctorAuth
    });
    if (record.diagnosis === EXPECTED_DIAGNOSIS) {
      diagnosisPatientId = patient.id;
      break;
    }
  }
  await check(
    "Rekam medis DOKTER memuat diagnosis nyata",
    Boolean(diagnosisPatientId),
    diagnosisPatientId
  );

  const receptionistRecordResponse = await fetch(
    `${BASE}/api/patients/${diagnosisPatientId}/record`,
    { headers: receptionistAuth }
  );
  const receptionistRecordText = await receptionistRecordResponse.text();
  await check(
    "RESEPSIONIS diblokir endpoint diagnosis",
    receptionistRecordResponse.status === 403 &&
      !receptionistRecordText.includes(EXPECTED_DIAGNOSIS)
  );

  const { body: ownData } = await jsonFetch(`${BASE}/api/me`, { headers: patientAuth });
  await check(
    "PASIEN melihat data sendiri dengan NIK termasker",
    Boolean(ownData.patient?.id) && /\*/.test(ownData.patient?.nikMasked ?? "")
  );
  const { body: chat } = await jsonFetch(`${BASE}/api/chatbot`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...patientAuth },
    body: JSON.stringify({ message: "Kapan pengingat obat dikirim?" })
  });
  await check(
    "Chatbot edukasi merespons",
    typeof chat.reply === "string" && chat.reply.length > 10
  );

  // Object-level RBAC: DOKTER hanya boleh triase pasien yang ditangani dokter
  // tersebut. diagnosisPatientId sudah terbukti berada dalam scope sesi dokter.
  const triagePatientId = diagnosisPatientId;
  const startedAt = Date.now();
  const { body: triage } = await jsonFetch(`${BASE}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...doctorAuth },
    body: JSON.stringify({
      patientId: triagePatientId,
      complaint: "Uji end-to-end",
      vitals: { systolic: 190, diastolic: 120 }
    })
  });
  const triageLatency = Date.now() - startedAt;
  await check("Input 190/120 → MERAH", triage.level === "MERAH", `latensi ${triageLatency} ms`);
  await check("Latensi < 5 detik", triageLatency < 5000);

  const { body: simulated } = await jsonFetch(`${BASE}/api/urgent/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...doctorAuth },
    body: JSON.stringify({
      patientId: triagePatientId,
      visitId: triage.visitId,
      triageLogId: triage.triageLogId
    })
  });
  await check(
    "Simulasi panggilan masuk log",
    simulated.totalLogs === 4,
    `${simulated.totalLogs} baris`
  );

  // Buat laporan lebih dulu: dari database kosong pun unduhan tetap berhasil.
  const { response: generateResponse, body: generated } = await jsonFetch(
    `${BASE}/api/reports/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuth },
      body: JSON.stringify({})
    }
  );
  await check(
    "Generate laporan mengembalikan metrik nyata",
    generateResponse.status === 200 &&
      typeof generated.summary?.newPatients === "number" &&
      typeof generated.summary?.visits7Days?.length === "number",
    `newPatients=${generated.summary?.newPatients}`
  );

  const pdfResponse = await fetch(`${BASE}/api/reports/download?type=pdf`, { headers: doctorAuth });
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  await check(
    "Download PDF",
    pdfResponse.status === 200 && pdf.subarray(0, 4).toString() === "%PDF",
    `status=${pdfResponse.status}`
  );

  const excelResponse = await fetch(`${BASE}/api/reports/download?type=excel`, {
    headers: doctorAuth
  });
  const excel = Buffer.from(await excelResponse.arrayBuffer());
  await check(
    "Download Excel",
    excelResponse.status === 200 && excel.subarray(0, 2).toString() === "PK",
    `status=${excelResponse.status}`
  );

  const forbiddenResponse = await fetch(`${BASE}/api/reports/download?type=pdf`, {
    headers: receptionistAuth
  });
  await check("RESEPSIONIS diblokir laporan", forbiddenResponse.status === 403);

  const { body: run } = await jsonFetch(`${BASE}/api/orchestrator/run`, {
    method: "POST",
    headers: adminAuth
  });
  const outcomes = run.outcomes ?? [];
  await check(
    "Manual Run orchestrator: semua agent sukses",
    outcomes.length === 6 && outcomes.every((item) => item.status === "SUCCESS"),
    `${outcomes.filter((item) => item.status === "SUCCESS").length}/${outcomes.length} sukses`
  );

  console.log("\nSEMUA CHECK END-TO-END LOLOS.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
