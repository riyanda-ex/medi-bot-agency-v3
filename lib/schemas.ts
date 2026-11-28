import { z } from "zod";
import { orchestratorJobSchema, urgentFollowupJobSchema } from "@/lib/queue";

export { orchestratorJobSchema, urgentFollowupJobSchema };

export const triageVitalsSchema = z.object({
  systolic: z.number().int().min(0).max(300).nullable().optional(),
  diastolic: z.number().int().min(0).max(200).nullable().optional(),
  glucose: z.number().int().min(0).max(1000).nullable().optional(),
  saturation: z.number().int().min(0).max(100).nullable().optional(),
  pulse: z.number().int().min(0).max(250).nullable().optional(),
  temperature: z.number().min(30).max(45).nullable().optional(),
  potassium: z.number().min(0).max(15).nullable().optional(),
  hemoglobin: z.number().min(0).max(30).nullable().optional(),
  platelets: z.number().int().min(0).max(2000000).nullable().optional(),
  notes: z.string().max(1000).nullable().optional()
});

export const triageBodySchema = z.object({
  patientId: z.string().min(1),
  complaint: z.string().max(500).optional(),
  approvalId: z.string().min(1).optional(),
  vitals: triageVitalsSchema
});

export const urgentApproveBodySchema = z.object({
  scope: z.enum(["URGENT", "REPORT"]),
  resourceId: z.string().min(1),
  channels: z
    .array(z.enum(["WHATSAPP", "CALL", "EMAIL", "ESCALATION"]))
    .min(1)
    .max(4)
});

export const chatbotBodySchema = z.object({
  message: z.string().min(1).max(500)
});

export const reportGenerateBodySchema = z.object({
  approvalId: z.string().min(1).optional()
});

export const urgentSimulateBodySchema = z
  .object({
    patientId: z.string().min(1).optional(),
    visitId: z.string().min(1).optional(),
    triageLogId: z.string().min(1).optional()
  })
  .refine((data) => Boolean(data.patientId || data.visitId || data.triageLogId), {
    message: "Salah satu dari patientId, visitId, atau triageLogId wajib diisi."
  });
