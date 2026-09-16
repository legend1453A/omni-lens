import { z } from "zod";

// Güven Düzeyi Şeması
export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

// Kaynak Referansı Şeması (Hem obje hem doğrudan string URL destekler)
export const SourceCitationSchema = z.union([
  z.object({
    title: z.string().default("Kaynak"),
    url: z.string().default(""),
    snippet: z.string().nullable().optional()
  }),
  z.string().transform((str) => {
    let title = "Web Kaynağı";
    try {
      title = new URL(str).hostname.replace(/^www\./, "");
    } catch {
      title = str;
    }
    return {
      title,
      url: str,
      snippet: null
    };
  })
]);
export type SourceCitation = z.infer<typeof SourceCitationSchema>;

// Temel Özellik Çifti
export const AttributePairSchema = z.object({
  label: z.string().default(""),
  value: z.string().default("")
});
export type AttributePair = z.infer<typeof AttributePairSchema>;

// İçerik Bölümü Şeması
export const FactSectionSchema = z.object({
  id: z.string().default("bolum"),
  title: z.string().default("Detaylar"),
  type: z.enum(["attributes", "text", "bullets"]).default("text"),
  attributes: z.array(AttributePairSchema).nullable().optional(),
  content: z.string().nullable().optional(),
  bulletPoints: z.array(z.string()).nullable().optional()
});
export type FactSection = z.infer<typeof FactSectionSchema>;

// Nesne Tanımlama & Güvenlik Bilgisi
export const IdentificationSchema = z.object({
  name: z.string().default("Tanımlanamayan Nesne"),
  scientificOrOfficialName: z.string().nullable().optional(),
  category: z.string().nullable().optional().default("Genel"),
  confidenceLevel: ConfidenceLevelSchema.default("high"),
  confidenceNote: z.string().nullable().optional().default(""),
  isDangerousOrSensitive: z.boolean().default(false),
  safetyWarning: z.string().nullable().optional()
});
export type Identification = z.infer<typeof IdentificationSchema>;

// Tam Analiz Yanıtı
export const AnalysisResponseSchema = z.object({
  id: z.string().default(`omni_${Date.now()}`),
  identification: IdentificationSchema,
  shortDescription: z.string().nullable().optional().default(""),
  sections: z.array(FactSectionSchema).default([]),
  similarOrRelated: z.array(z.string()).nullable().optional(),
  suggestedQuestions: z.array(z.string()).default([]),
  sources: z.array(SourceCitationSchema).default([])
});
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

// Soru-Cevap (Chat) İstek ve Yanıt Şemaları
export const ChatMessageSchema = z.object({
  role: z.enum(["user", "model"]),
  content: z.string()
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatRequestSchema = z.object({
  context: z.object({
    objectName: z.string(),
    summary: z.string(),
    details: z.string().nullable().optional()
  }),
  history: z.array(ChatMessageSchema).default([]),
  question: z.string()
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(SourceCitationSchema).nullable().optional()
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

// Metin Arama İstek Şeması
export const SearchRequestSchema = z.object({
  query: z.string().min(1)
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
