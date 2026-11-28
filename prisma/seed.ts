import { PrismaClient, type Doctor, type Patient } from "../generated/prisma/client";
import bcrypt from "bcryptjs";
import { encryptField, fieldHash, maskNik } from "../lib/crypto";
import { evaluateTriage } from "../lib/triageRules";
import { assertDestructiveSeedAllowed, resolveSeedAdminPassword } from "./seed-guard";
import { createPrismaAdapter } from "../lib/prisma-adapter";

const prisma = new PrismaClient({ adapter: createPrismaAdapter() });

interface Vitals {
  systolic: number;
  diastolic: number;
  glucose: number;
  saturation: number;
  pulse: number;
  temperature: number;
  potassium: number;
  hemoglobin: number;
  platelets: number;
}

interface DummyPatient {
  name: string;
  nik: string;
  birthDate: string;
  address: string;
  phone: string;
  allergies: string;
  pregnancy: boolean;
  group: "MERAH" | "KUNING" | "HIJAU";
  complaint: string;
  vitals: Vitals;
  daysSinceControl?: number;
  chronicDaysLeft?: number;
  mildLabAbnormal?: boolean;
}

const BASE_VITALS: Vitals = {
  systolic: 122,
  diastolic: 78,
  glucose: 96,
  saturation: 98,
  pulse: 74,
  temperature: 36.7,
  potassium: 4.1,
  hemoglobin: 13.2,
  platelets: 265_000
};

const names = [
  "Siti Nurhaliza",
  "Budi Santoso",
  "Rina Wijaya",
  "Agus Setiawan",
  "Dewi Kartika",
  "Hendra Gunawan",
  "Fitri Handayani",
  "Slamet Riyadi",
  "Maya Sari",
  "Joko Susilo",
  "Lina Marlina",
  "Rizky Pratama",
  "Nur Aini",
  "Arif Hidayat",
  "Sri Wahyuni",
  "Tono Kurniawan",
  "Eka Putri",
  "Wahyu Trianto",
  "Yanti Permata",
  "Dedi Mulyadi"
];

const addresses = [
  "Jl. Melati No. 12, Jakarta Selatan",
  "Jl. Mawar No. 45, Bandung",
  "Jl. Anggrek No. 8, Surabaya",
  "Jl. Kenanga No. 21, Yogyakarta",
  "Jl. Dahlia No. 7, Semarang"
];

const allergiesList = ["Tidak ada", "Penicillin", "Amoxicillin", "Debu", "Tidak ada"];

function makePatients(): DummyPatient[] {
  return names.map((name, index) => {
    const nik = `350101010101${String(index + 1).padStart(4, "0")}`;
    const base: DummyPatient = {
      name,
      nik,
      birthDate: `19${70 + (index % 25)}-0${(index % 9) + 1}-1${index % 9}`,
      address: addresses[index % addresses.length],
      phone: `0812${String(34560000 + index).padStart(8, "0")}`,
      allergies: allergiesList[index % allergiesList.length],
      pregnancy: false,
      group: "HIJAU",
      complaint: "Kontrol rutin, keluhan ringan.",
      vitals: { ...BASE_VITALS, pulse: BASE_VITALS.pulse + (index % 5) }
    };

    if (index === 0) {
      return {
        ...base,
        group: "MERAH",
        complaint: "Kontrol rutin tekanan darah.",
        vitals: { ...base.vitals, systolic: 190, diastolic: 120 }
      };
    }
    if (index === 1) {
      return {
        ...base,
        group: "MERAH",
        complaint: "Kontrol gula darah.",
        vitals: { ...base.vitals, glucose: 320 }
      };
    }
    if (index === 2) {
      return {
        ...base,
        group: "MERAH",
        complaint: "Sesak napas ringan saat istirahat.",
        vitals: { ...base.vitals, saturation: 88 }
      };
    }
    if (index >= 3 && index <= 7) {
      return {
        ...base,
        group: "KUNING",
        complaint: "Kontrol terjadwal.",
        daysSinceControl: 8 + (index % 5),
        chronicDaysLeft: index % 2 === 0 ? 2 : 10,
        mildLabAbnormal: index % 3 === 0
      };
    }
    return base;
  });
}

async function clearDummyData(): Promise<void> {
  // Pertahanan ganda: guard juga dipanggil di awal main(), tetapi fungsi ini
  // tetap menolak penghapusan bila dipanggil dari jalur lain.
  assertDestructiveSeedAllowed();
  console.log("[SEED] Membersihkan data dummy sebelumnya (development/test saja)...");
  await prisma.urgentCall.deleteMany();
  await prisma.triageLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.waitingList.deleteMany();
  await prisma.prescription.deleteMany();
  await prisma.labResult.deleteMany();
  await prisma.medicalRecord.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.visit.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.report.deleteMany();
  await prisma.agentLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.doctor.deleteMany();
  await prisma.medicineStock.deleteMany();
  await prisma.patient.deleteMany();
}

async function main(): Promise<void> {
  assertDestructiveSeedAllowed();
  await clearDummyData();

  const seedPassword = resolveSeedAdminPassword();
  const passwordHash = await bcrypt.hash(seedPassword, 12);

  const doctors: Doctor[] = [];
  for (const [name, specialty] of [
    ["dr. Andi Prasetyo, Sp.PD", "Penyakit Dalam"],
    ["dr. Ratna Kusuma, Sp.A", "Anak"],
    ["dr. Bambang Suryono, Sp.KJ", "Kesehatan Jiwa"]
  ] as const) {
    doctors.push(
      await prisma.doctor.create({
        data: { name, specialty, sip: `SIP-${doctors.length + 1}-2024` }
      })
    );
  }

  const patients = makePatients();
  const createdPatients: Patient[] = [];

  for (let index = 0; index < patients.length; index += 1) {
    const item = patients[index];
    const created = await prisma.patient.create({
      data: {
        nikEncrypted: encryptField(item.nik),
        nikHash: fieldHash(item.nik),
        nikMasked: maskNik(item.nik),
        name: item.name,
        birthDate: new Date(item.birthDate),
        address: item.address,
        phoneEncrypted: encryptField(item.phone),
        allergies: item.allergies,
        pregnancy: item.pregnancy,
        distanceKm: index % 4 === 0 ? 25 : 6 + (index % 10)
      }
    });
    createdPatients.push(created);
  }

  await prisma.user.createMany({
    data: [
      {
        email: "admin@klinik.example",
        passwordHash,
        name: "Administrator",
        role: "ADMIN"
      },
      {
        email: "dokter@klinik.example",
        passwordHash,
        name: doctors[0].name,
        role: "DOKTER",
        doctorId: doctors[0].id
      },
      {
        email: "perawat@klinik.example",
        passwordHash,
        name: "Perawat Jaga",
        role: "PERAWAT"
      },
      {
        email: "resepsionis@klinik.example",
        passwordHash,
        name: "Resepsionis",
        role: "RESEPSIONIS"
      },
      {
        email: "pasien@klinik.example",
        passwordHash,
        name: createdPatients[8].name,
        role: "PASIEN",
        patientId: createdPatients[8].id
      }
    ]
  });

  console.log("[SEED] Membuat kunjungan, rekam medis, dan log triage...");
  for (let index = 0; index < patients.length; index += 1) {
    const item = patients[index];
    const patient = createdPatients[index];
    const doctor = doctors[index % doctors.length];
    const visitDate = new Date(Date.now() - index * 86_400_000);

    const visit = await prisma.visit.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        visitDate,
        status: "COMPLETED",
        complaint: item.complaint,
        diagnosis: item.group === "MERAH" ? "Perlu tindak lanjut segera" : "Stabil",
        icd10: item.group === "MERAH" ? "R55" : "Z00.0",
        icd9: "89.29",
        vitalSystolic: item.vitals.systolic,
        vitalDiastolic: item.vitals.diastolic,
        glucose: item.vitals.glucose,
        saturation: item.vitals.saturation,
        pulse: item.vitals.pulse,
        temperature: item.vitals.temperature,
        potassium: item.vitals.potassium,
        hemoglobin: item.vitals.hemoglobin,
        platelets: item.vitals.platelets,
        daysSinceControl: item.daysSinceControl,
        chronicMedicationDaysLeft: item.chronicDaysLeft,
        mildLabAbnormal: item.mildLabAbnormal ?? false
      }
    });

    await prisma.medicalRecord.create({
      data: {
        visitId: visit.id,
        patientId: patient.id,
        doctorId: doctor.id,
        anamnesis: item.complaint,
        diagnosisIcd10: visit.icd10,
        actionIcd9: index % 5 === 0 ? null : visit.icd9,
        radiology: "Tidak dilakukan",
        vitalSigns: JSON.stringify(item.vitals),
        note: "Data dummy untuk pengujian analyzer."
      }
    });

    await prisma.labResult.create({
      data: {
        visitId: visit.id,
        patientId: patient.id,
        testName: "Hemoglobin",
        value: item.vitals.hemoglobin,
        unit: "g/dL",
        referenceRange: "12-16",
        abnormal: item.vitals.hemoglobin < 12
      }
    });

    await prisma.prescription.create({
      data: {
        visitId: visit.id,
        patientId: patient.id,
        medication: index % 4 === 0 ? "Amlodipin" : "Parasetamol",
        dose: "500 mg",
        frequency: "3x sehari",
        durationDays: 5,
        pregnancyCategory: item.pregnancy ? "X" : "B",
        isChronic: item.group === "KUNING"
      }
    });

    const evaluation = evaluateTriage({
      systolic: item.vitals.systolic,
      diastolic: item.vitals.diastolic,
      glucose: item.vitals.glucose,
      saturation: item.vitals.saturation,
      pulse: item.vitals.pulse,
      temperature: item.vitals.temperature,
      potassium: item.vitals.potassium,
      hemoglobin: item.vitals.hemoglobin,
      platelets: item.vitals.platelets,
      notes: item.complaint,
      daysSinceControl: item.daysSinceControl,
      chronicMedicationDaysLeft: item.chronicDaysLeft,
      mildLabAbnormal: item.mildLabAbnormal
    });

    const triageLog = await prisma.triageLog.create({
      data: {
        patientId: patient.id,
        visitId: visit.id,
        level: evaluation.level,
        reasons: JSON.stringify(evaluation.reasons),
        score: evaluation.score,
        dataComplete: evaluation.dataComplete,
        source: "SEED"
      }
    });

    await prisma.visit.update({
      where: { id: visit.id },
      data: { triageLevel: evaluation.level }
    });

    if (evaluation.level === "MERAH") {
      const stages = [
        {
          channel: "WHATSAPP",
          attempt: 1,
          status: "SIMULATED",
          detail: "T+10 detik: WA (tanpa diagnosis)"
        },
        { channel: "CALL", attempt: 1, status: "SIMULATED", detail: "T+2 menit: telepon ke-1" },
        { channel: "CALL", attempt: 2, status: "SIMULATED", detail: "T+5 menit: telepon ke-2" },
        {
          channel: "ESCALATION",
          attempt: 1,
          status: "SIMULATED",
          detail: "T+15 menit: eskalasi jaga"
        }
      ];
      for (const stage of stages) {
        await prisma.urgentCall.create({
          data: {
            patientId: patient.id,
            visitId: visit.id,
            triageLogId: triageLog.id,
            channel: stage.channel,
            attempt: stage.attempt,
            status: stage.status,
            provider: "mock",
            simulated: true,
            message: stage.detail,
            triggeredBy: "SEED"
          }
        });
      }
    }

    await prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        scheduledAt: new Date(Date.now() + (index + 1) * 86_400_000),
        status: "BOOKED",
        queueNumber: index + 1,
        noShowRisk: index % 6 === 0 ? 70 : 20
      }
    });

    await prisma.claim.create({
      data: {
        patientId: patient.id,
        visitId: visit.id,
        number: `BPJS-${String(index + 1).padStart(5, "0")}`,
        status: index % 3 === 0 ? "PENDING" : "APPROVED",
        amount: 125000 + index * 5000
      }
    });
  }

  await prisma.waitingList.createMany({
    data: patients.slice(8, 11).map((item, index) => ({
      patientId: createdPatients[8 + index].id,
      doctorId: doctors[index % doctors.length].id,
      status: "WAITING",
      preferredAt: new Date(Date.now() + (index + 2) * 86_400_000)
    }))
  });

  await prisma.medicineStock.createMany({
    data: [
      { name: "Parasetamol 500 mg", stock: 8, unit: "strip" },
      { name: "Amlodipin 5 mg", stock: 120, unit: "strip" },
      { name: "Amoxicillin 500 mg", stock: 45, unit: "kapsul" }
    ]
  });

  console.log("[SEED] Selesai: 20 pasien, 3 MERAH, 5 KUNING, 12 HIJAU.");
  console.log(
    "[SEED] Kata sandi akun uji berasal dari SEED_ADMIN_PASSWORD (atau nilai acak yang dicetak sekali di atas)."
  );
}

main()
  .catch((error) => {
    console.error("[SEED] Gagal:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
