import { GoogleGenAI } from "@google/genai";
import {
  AnalysisResponse,
  AnalysisResponseSchema,
  ChatRequest,
  ChatResponse,
  SourceCitation
} from "../types/schema.js";

export class GeminiService {
  private static ai: GoogleGenAI | null = null;
  private static readonly SEARCH_MODELS = [
    "gemini-2.5-flash"
  ];
  private static readonly FALLBACK_MODELS = [
    "gemini-2.5-flash",
    "gemini-3.5-flash"
  ];

  private static getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your_gemini_api_key_here") {
      throw new Error(
        "GEMINI_API_KEY bulunamadı veya ayarlanmadı. Lütfen backend/.env dosyasında geçerli bir Google AI Studio API anahtarı tanımlayın."
      );
    }

    if (!this.ai) {
      this.ai = new GoogleGenAI({ apiKey });
    }
    return this.ai;
  }

  /**
   * Google Search Grounding ile güncel araştırma yapar;
   * Arama aracı kotası veya hatası durumunda kesintisiz doğrudan Gemini modeline fallback yapar.
   * thinkingBudget: 0 ile mobil bekleme süresini 2-5 saniyeye düşürür.
   */
  private static async generateWithFallback(params: {
    contents: any[];
    config?: any;
    forceJson?: boolean;
  }): Promise<any> {
    const ai = this.getClient();
    let lastError: any = null;

    // thinkingBudget: 0 ile aşırı bekleme sürelerini önle (2-5 saniyede hızlı yanıt)
    const baseConfig: any = {
      ...(params.config || {}),
      thinkingConfig: { thinkingBudget: 0 }
    };

    // 1. Google Search Grounding aracı tanımlıysa önce bununla dene (gemini-2.5-flash)
    if (baseConfig.tools?.length) {
      for (const model of this.SEARCH_MODELS) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: params.contents,
            config: baseConfig
          });
          const candidate = response?.candidates?.[0];
          const text = response?.text || candidate?.content?.parts?.map((p: any) => p.text || "").join("").trim() || "";
          if (text.length > 0) {
            return response;
          }
          console.warn(`[GeminiService] Model ${model} arama aracıyla boş metin döndürdü, fallback'e geçiliyor...`);
        } catch (error: any) {
          lastError = error;
          const msg = error?.message || "";
          console.warn(`[GeminiService] Model ${model} arama aracıyla hata verdi: ${msg.slice(0, 120)}`);
        }
      }
      console.warn("[GeminiService] Arama aracı kullanılamadı, doğrudan Gemini modeline geçiliyor...");
    }

    // 2. Arama kotası bittiyse veya araçsız çalışılacaksa:
    // Doğrudan stabil Gemini modeline geç ve JSON çıktısı zorunluysa responseMimeType ekle
    const fallbackConfig: any = { ...baseConfig };
    delete fallbackConfig.tools;
    if (params.forceJson) {
      fallbackConfig.responseMimeType = "application/json";
    }

    for (const model of this.FALLBACK_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: fallbackConfig
        });
        const candidate = response?.candidates?.[0];
        const text = response?.text || candidate?.content?.parts?.map((p: any) => p.text || "").join("").trim() || "";
        if (text.length > 0) {
          return response;
        }
        console.warn(`[GeminiService] Model ${model} doğrudan yanıtta boş metin döndürdü...`);
      } catch (error: any) {
        lastError = error;
        console.warn(
          `[GeminiService] Model ${model} doğrudan yanıt üretiminde hata verdi (${error?.message?.slice(0, 100)}), sıradaki modele geçiliyor...`
        );
      }
    }

    throw lastError || new Error("Yapay zekâ servisine şu anda ulaşılamıyor, lütfen tekrar deneyin.");
  }

  /**
   * JSON stringleri içindeki kontrol karakterlerini (kaçışsız satır sonları vb.) temizler
   */
  private static sanitizeJsonString(str: string): string {
    let inString = false;
    let escaped = false;
    let result = "";

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];

      if (ch === '"' && !escaped) {
        inString = !inString;
        result += ch;
      } else if (inString) {
        if (ch === "\\") {
          escaped = !escaped;
          result += ch;
        } else {
          escaped = false;
          if (ch === "\n") {
            result += "\\n";
          } else if (ch === "\r") {
            result += "\\r";
          } else if (ch === "\t") {
            result += "\\t";
          } else if (ch.charCodeAt(0) < 32) {
            // Kontrol karakterini atla
          } else {
            result += ch;
          }
        }
      } else {
        result += ch;
      }
    }
    return result;
  }

  /**
   * JSON temizleme ve parse yardımcısı
   */
  private static cleanAndParseJSON(rawText: string): any {
    let cleaned = rawText.trim();

    if (cleaned.startsWith("```")) {
      const firstLineEnd = cleaned.indexOf("\n");
      const lastFence = cleaned.lastIndexOf("```");
      if (firstLineEnd !== -1 && lastFence > firstLineEnd) {
        cleaned = cleaned.substring(firstLineEnd + 1, lastFence).trim();
      }
    }

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    try {
      return JSON.parse(cleaned);
    } catch (e1) {
      try {
        const sanitized = this.sanitizeJsonString(cleaned);
        return JSON.parse(sanitized);
      } catch (e2) {
        console.error("HAM YANIT UZUNLUĞU:", rawText.length);
        console.error("HAM YANIT:", rawText);
        throw new Error(`JSON ayrıştırma hatası: ${(e1 as Error).message}`);
      }
    }
  }

  /**
   * Ham markdown yıldızlarını (**kalın**, *italik*) ve bozuk liste işaretlerini temizler
   */
  private static cleanMarkdown(text?: string | null): string {
    if (!text) return "";
    return text
      .replace(/\*\*([^*]+?)\*\*/g, "$1")
      .replace(/\*([^*]+?)\*/g, "$1")
      .replace(/^(\*|-)\s+/gm, "• ")
      .replace(/\*\*/g, "")
      .trim();
  }

  /**
   * Gemini'den gelen JSON verisini Zod şemasıyla %100 uyumlu hale getirmek için normalize eder
   */
  private static normalizeAnalysisResponse(parsedJson: any): any {
    if (!parsedJson || typeof parsedJson !== "object") {
      parsedJson = {};
    }

    if (!parsedJson.identification || typeof parsedJson.identification !== "object") {
      parsedJson.identification = { name: "Tanımlanamayan Nesne" };
    }

    // 1. İsim, Açıklama ve Güvenlik Uyarılarının Markdown Temizliği
    if (parsedJson.identification.name) {
      parsedJson.identification.name = this.cleanMarkdown(parsedJson.identification.name);
    }
    if (parsedJson.identification.confidenceNote) {
      parsedJson.identification.confidenceNote = this.cleanMarkdown(parsedJson.identification.confidenceNote);
    }
    if (parsedJson.identification.safetyWarning) {
      parsedJson.identification.safetyWarning = this.cleanMarkdown(parsedJson.identification.safetyWarning);
    }
    if (parsedJson.shortDescription) {
      parsedJson.shortDescription = this.cleanMarkdown(parsedJson.shortDescription);
    }

    // 2. Google Play Politikası / Veterinerlik & Tıbbi terim normalizasyonu
    if (parsedJson.identification?.category) {
      const catLower = String(parsedJson.identification.category).toLowerCase().trim();
      if (catLower.includes("veteriner")) {
        if (catLower.includes("evcil") || catLower.includes("kedi") || catLower.includes("köpek") || catLower.includes("kuş") || catLower.includes("pet")) {
          parsedJson.identification.category = "Evcil Hayvan Rehberi";
        } else {
          parsedJson.identification.category = "Doğa Rehberi";
        }
      } else if (catLower.includes("tıbbi") || catLower.includes("tedavi") || catLower.includes("reçete") || catLower.includes("teşhis")) {
        parsedJson.identification.category = "Doğa & Bilgi Rehberi";
      }
    }

    // Sources normalizasyonu (string veya obje)
    if (Array.isArray(parsedJson.sources)) {
      parsedJson.sources = parsedJson.sources.map((src: any) => {
        if (typeof src === "string") {
          let title = "Web Kaynağı";
          try {
            title = new URL(src).hostname.replace(/^www\./, "");
          } catch {
            title = src;
          }
          return { title, url: src, snippet: null };
        }
        return {
          title: src?.title || "Kaynak",
          url: src?.url || "",
          snippet: src?.snippet || null
        };
      });
    } else {
      parsedJson.sources = [];
    }

    // Similar normalizasyonu
    if (Array.isArray(parsedJson.similarOrRelated)) {
      parsedJson.similarOrRelated = parsedJson.similarOrRelated.map((item: any) =>
        typeof item === "string" ? this.cleanMarkdown(item) : this.cleanMarkdown(String(item?.name || item?.title || item))
      );
    } else {
      parsedJson.similarOrRelated = [];
    }

    // Suggested questions normalizasyonu
    if (Array.isArray(parsedJson.suggestedQuestions)) {
      parsedJson.suggestedQuestions = parsedJson.suggestedQuestions.map((q: any) =>
        typeof q === "string" ? this.cleanMarkdown(q) : this.cleanMarkdown(String(q?.question || q?.text || q))
      );
    } else {
      parsedJson.suggestedQuestions = [];
    }

    // 3. Sections normalizasyonu (Başlık, Markdown temizliği, Hap Bilgi ve Yasal Uyarı)
    let hasHapBilgi = false;
    let extractedHap = "";

    if (Array.isArray(parsedJson.sections)) {
      parsedJson.sections = parsedJson.sections.map((sec: any, idx: number) => {
        if (!sec || typeof sec !== "object") {
          return { id: `sec_${idx}`, title: "Bilgi", type: "text", content: this.cleanMarkdown(String(sec)) };
        }
        let title = sec.title || "Bilgi";
        const tLower = title.toLowerCase().trim();
        if (tLower.includes("tedavi") || tLower.includes("tıbbi müdahale")) {
          title = "İlk Önlem / Öneri";
        } else if (tLower.includes("ilaç") || tLower.includes("reçete")) {
          title = "Bakım & Önlem Tavsiyeleri";
        } else if (tLower.includes("veteriner")) {
          title = "Uzman Görüşü / İlk Önlemler";
        }

        if (tLower.includes("hap bilgi")) {
          hasHapBilgi = true;
        }

        const normalizedSec: any = { ...sec, title };

        if (normalizedSec.content) {
          normalizedSec.content = this.cleanMarkdown(normalizedSec.content);
          if (!hasHapBilgi && !extractedHap && normalizedSec.content.length > 120) {
            const sentenceMatch = normalizedSec.content.match(/^([^\.!?]+[\.!?])/);
            if (sentenceMatch && sentenceMatch[1]) {
              extractedHap = sentenceMatch[1].trim();
            }
          }
        }

        if (Array.isArray(normalizedSec.bulletPoints)) {
          normalizedSec.bulletPoints = normalizedSec.bulletPoints.map((p: any) => this.cleanMarkdown(String(p)));
        }

        if (Array.isArray(normalizedSec.attributes)) {
          normalizedSec.attributes = normalizedSec.attributes.map((attr: any) => ({
            label: this.cleanMarkdown(attr?.label),
            value: this.cleanMarkdown(attr?.value)
          }));
        }

        return normalizedSec;
      });
    } else {
      parsedJson.sections = [];
    }

    // Hap Bilgi kartını en başa yerleştir
    if (!hasHapBilgi && extractedHap) {
      parsedJson.sections.unshift({
        id: "hap_bilgi",
        title: "💡 Hap Bilgi",
        type: "text",
        content: extractedHap
      });
    }

    // Google Play Politikası: Sabit Yasal Uyarı kartı ekle
    const hasDisclaimer = parsedJson.sections.some((s: any) =>
      s.content?.includes("kesin teşhis niteliği taşımaz") || s.title?.includes("Bilgilendirme Uyarısı")
    );
    if (!hasDisclaimer) {
      parsedJson.sections.push({
        id: "yasal_uyari",
        title: "ℹ️ Bilgilendirme Uyarısı",
        type: "text",
        content: "Bu bilgiler genel bilgilendirme amaçlıdır, kesin teşhis niteliği taşımaz."
      });
    }

    return parsedJson;
  }

  /**
   * Gemini'nin Grounding Metadata'sından (Google Search) gerçek web kaynaklarını ayıklar
   */
  private static extractGroundingSources(response: any): SourceCitation[] {
    const sources: SourceCitation[] = [];
    try {
      const candidate = response?.candidates?.[0];
      const metadata = candidate?.groundingMetadata;

      if (metadata?.groundingChunks) {
        for (const chunk of metadata.groundingChunks) {
          if (chunk.web?.uri) {
            sources.push({
              title: chunk.web.title || new URL(chunk.web.uri).hostname,
              url: chunk.web.uri,
              snippet: chunk.web.title
            });
          }
        }
      }
    } catch {
      // Grounding metadata ayıklanamazsa sessizce devam et
    }
    return sources;
  }

  /**
   * Fotoğrafı analiz et, internette araştır ve yapılandırılmış yanıt üret
   */
  static async analyzeImage(imageBase64: string, mimeType: string = "image/jpeg"): Promise<AnalysisResponse> {
    const systemPrompt = `
Sen dünyanın en kapsamlı ve güvenilir Görsel Keşif ve Araştırma Uzmanısın.
Görevin fotoğraftaki nesneyi, canlıyı, yapıyı, eseri veya ürünü tespit etmek, internetteki güvenilir kaynaklardan doğrulamak ve kullanıcıya Türkçe, düzenli, kategorize bir bilgi kartı sunmaktır.

ÖNEMLİ KURALLAR:
1. GÜVENİLİRLİK: Fotoğraftaki şeyi kesin olarak tanımlayamıyorsan kesinmiş gibi davranma. 'confidenceLevel' değerini 'high', 'medium' veya 'low' yap ve 'confidenceNote' içinde kullanıcıya dürüstçe açıkla.
2. GÜVENLİK & TEHLİKE UYARISI: Eğer nesne zehirli bir bitki/mantar, tehlikeli bir hayvan, ilaç veya kimyasal içeriyorsa 'isDangerousOrSensitive' değerini true yap ve 'safetyWarning' kısmında net bir uyarı yaz.
3. BİLGİ DÜZENİ: Bilgileri net kategorilere ayır (Temel Bilgiler, Özellikleri, Kullanım Alanları/Tarihçe, İlginç Bilgiler).
4. SADE VE ANLAŞILIR: Merak uyandıran, akıcı bir Türkçe kullan.
5. İLGİNÇ BİLGİLER: 2-4 şaşırtıcı gerçek ekle.
6. TAKİP SORULARI: 3 mantıklı devam sorusu öner ('suggestedQuestions').
7. KAYNAKLAR: Güvenilir internet sitelerini ('sources') listele.
8. POLİTİKA UYUMLULUĞU: Kategori ('category') olarak ASLA 'Veterinerlik' veya 'Tıbbi Teşhis' yazma. Hayvanlar için 'Evcil Hayvan Rehberi' veya 'Doğa Rehberi' kullan. Bölüm başlığı olarak ASLA 'Tedavi' veya 'Reçete' yazma; 'İlk Önlem / Öneri' veya 'Bakım & Tavsiyeler' kullan. Asla tıbbi reçete yazma.

YANITINI SADECE VE SADECE AŞAĞIDAKİ JSON FORMATINDA DÖNDÜR (BAŞKA HİÇBİR AÇIKLAMA METNİ EKLEME):
{
  "id": "benzersiz_id",
  "identification": {
    "name": "Nesnenin/Canlının Yaygın Adı",
    "scientificOrOfficialName": "Bilimsel / Resmi Adı veya null",
    "category": "Bitki / Hayvan / Tarihi Eser / vb.",
    "confidenceLevel": "high" | "medium" | "low",
    "confidenceNote": "Açıklama",
    "isDangerousOrSensitive": false,
    "safetyWarning": null
  },
  "shortDescription": "1-2 cümlelik özet",
  "sections": [
    {
      "id": "temel_bilgiler",
      "title": "Temel Bilgiler",
      "type": "attributes",
      "attributes": [
        { "label": "Etiket", "value": "Değer" }
      ]
    },
    {
      "id": "ozellikler",
      "title": "Özellikleri",
      "type": "text",
      "content": "Açıklama..."
    },
    {
      "id": "ilginc_bilgiler",
      "title": "İlginç Bilgiler",
      "type": "bullets",
      "bulletPoints": [
        "İlginç bilgi 1"
      ]
    }
  ],
  "similarOrRelated": ["Benzer 1"],
  "suggestedQuestions": ["Soru 1"],
  "sources": [
    { "title": "Kaynak", "url": "https://...", "snippet": "Açıklama" }
  ]
}
`;

    const response = await this.generateWithFallback({
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: imageBase64,
                mimeType: mimeType
              }
            },
            {
              text: systemPrompt
            }
          ]
        }
      ],
      config: {
        tools: [{ googleSearch: {} }]
      },
      forceJson: true
    });

    const candidate = response.candidates?.[0];
    const text = response.text || candidate?.content?.parts?.map((p: any) => p.text || "").join("") || "";
    let parsedJson: any;
    try {
      parsedJson = this.cleanAndParseJSON(text);
    } catch (e) {
      console.warn("[GeminiService] Görsel analizi JSON parse edilemedi, acil durum bilgi kartı oluşturuluyor...");
      parsedJson = {
        id: `omni_${Date.now()}`,
        identification: {
          name: "Tespit Edilen Nesne",
          scientificOrOfficialName: null,
          category: "Genel",
          confidenceLevel: "medium",
          confidenceNote: "Görsel analizi yapay zekâ tarafından incelendi.",
          isDangerousOrSensitive: false,
          safetyWarning: null
        },
        shortDescription: text.slice(0, 180).replace(/```json|```/g, "").trim() || "Görseldeki nesne incelendi.",
        sections: [
          {
            id: "bilgi",
            title: "Görsel Bilgisi",
            type: "text",
            content: text.replace(/```json|```/g, "").trim() || "Görsel başarıyla analiz edildi."
          }
        ],
        similarOrRelated: [],
        suggestedQuestions: ["Bu nesne hakkında daha fazla bilgi alabilir miyim?"],
        sources: []
      };
    }

    const liveSources = this.extractGroundingSources(response);
    if (liveSources.length > 0) {
      const existingUrls = new Set((parsedJson.sources || []).map((s: any) => s.url));
      for (const src of liveSources) {
        if (!existingUrls.has(src.url)) {
          parsedJson.sources = parsedJson.sources || [];
          parsedJson.sources.push(src);
          existingUrls.add(src.url);
        }
      }
    }

    if (!parsedJson.id) {
      parsedJson.id = `omni_${Date.now()}`;
    }

    const normalized = this.normalizeAnalysisResponse(parsedJson);
    return AnalysisResponseSchema.parse(normalized);
  }

  /**
   * Takip sorusu sorma (Chat)
   */
  static async askQuestion(request: ChatRequest): Promise<ChatResponse> {
    const conversationPrompt = `
Kullanıcı daha önce analiz edilmiş şu nesne hakkında sana soru soruyor:
NESNE: ${request.context.objectName}
ÖZET: ${request.context.summary}
${request.context.details ? `DETAYLAR: ${request.context.details}` : ""}

KULLANICININ SORUSU:
"${request.question}"

TALİMATLAR:
- Önceki analiz bağlamını koruyarak net, doğrudan, faydalı ve güvenilir bir Türkçe cevap ver.
- Gerekirse güncel bilgileri Google'da araştır.
`;

    const response = await this.generateWithFallback({
      contents: [
        ...request.history.map((h) => ({
          role: h.role,
          parts: [{ text: h.content }]
        })),
        {
          role: "user",
          parts: [{ text: conversationPrompt }]
        }
      ],
      config: {
        tools: [{ googleSearch: {} }]
      },
      forceJson: false
    });

    const candidate = response.candidates?.[0];
    const answerRaw = response.text || candidate?.content?.parts?.map((p: any) => p.text || "").join("").trim() || "Cevap üretilemedi.";
    const answer = this.cleanMarkdown(answerRaw);
    const sources = this.extractGroundingSources(response);

    return {
      answer,
      sources
    };
  }

  /**
   * Doğrudan metin ile ansiklopedik arama yapma
   */
  static async searchByText(query: string): Promise<AnalysisResponse> {
    const systemPrompt = `
Sen dünyanın en kapsamlı ve güvenilir Görsel & Kavramsal Araştırma Uzmanısın.
Kullanıcı sana doğrudan bir metin sorgusu verdi: "${query}"

Görevin bu konu/nesne/kavram hakkında internetteki en güncel ve güvenilir kaynakları Google'da araştırmak ve kullanıcıya yapılandırılmış, kategorize edilmiş Türkçe bir bilgi kartı hazırlamaktır.

Kurallar:
- 'identification.name' kısmına sorgulanan şeyin tam adını yaz.
- 'identification.category' (örn: Doğa Rehberi, Astrofizik, Tarih, Biyoloji, Teknoloji, vb.) belirle. ASLA 'Veterinerlik' veya 'Tıbbi Teşhis' yazma; hayvanlar için 'Evcil Hayvan Rehberi' veya 'Doğa Rehberi' kullan.
- Bölüm başlıklarında ASLA 'Tedavi' veya 'Reçete' yazma, 'İlk Önlem / Öneri' veya 'Bakım Tavsiyeleri' kullan.
- 'identification.confidenceLevel' genelde 'high' olmalı.
- Yanıtı SADECE ve KESİNLİKLE aşağıdaki JSON şemasında döndür.

{
  "id": "search_${Date.now()}",
  "identification": {
    "name": "Konu / Nesne Adı",
    "scientificOrOfficialName": null,
    "category": "Kategori",
    "confidenceLevel": "high",
    "confidenceNote": "Güvenilir kaynaklar taranarak doğrulandı.",
    "isDangerousOrSensitive": false,
    "safetyWarning": null
  },
  "shortDescription": "1-2 cümlelik anlaşılır özet",
  "sections": [
    {
      "id": "temel_bilgiler",
      "title": "Temel Bilgiler",
      "type": "attributes",
      "attributes": [
        { "label": "Tür / Alan", "value": "..." }
      ]
    },
    {
      "id": "detaylar",
      "title": "Detaylı Bilgiler",
      "type": "text",
      "content": "Açıklama metni..."
    },
    {
      "id": "ilginc_bilgiler",
      "title": "İlginç Bilgiler",
      "type": "bullets",
      "bulletPoints": [
        "İlginç bilgi 1"
      ]
    }
  ],
  "similarOrRelated": ["İlişkili Konu 1"],
  "suggestedQuestions": ["Devam Sorusu 1"],
  "sources": []
}
`;

    const response = await this.generateWithFallback({
      contents: [
        {
          role: "user",
          parts: [{ text: systemPrompt }]
        }
      ],
      config: {
        tools: [{ googleSearch: {} }]
      },
      forceJson: true
    });

    const candidate = response.candidates?.[0];
    const text = response.text || candidate?.content?.parts?.map((p: any) => p.text || "").join("") || "";
    
    let parsedJson: any;
    try {
      parsedJson = this.cleanAndParseJSON(text);
    } catch (e) {
      console.warn("[GeminiService] Arama yanıtı JSON parse edilemedi, acil durum bilgi kartı oluşturuluyor...");
      parsedJson = {
        id: `search_${Date.now()}`,
        identification: {
          name: query,
          scientificOrOfficialName: null,
          category: "Araştırma",
          confidenceLevel: "high",
          confidenceNote: "Bilgi Ağacı yapay zekâsı tarafından derlendi.",
          isDangerousOrSensitive: false,
          safetyWarning: null
        },
        shortDescription: text.slice(0, 180).replace(/```json|```/g, "").trim() || `${query} hakkında araştırma tamamlandı.`,
        sections: [
          {
            id: "bilgi",
            title: "Araştırma Özeti",
            type: "text",
            content: text.replace(/```json|```/g, "").trim() || `${query} ile ilgili detaylı bilgiler derlendi.`
          }
        ],
        similarOrRelated: [],
        suggestedQuestions: [`${query} hakkında daha detaylı bilgi alabilir miyim?`],
        sources: []
      };
    }

    const liveSources = this.extractGroundingSources(response);
    if (liveSources.length > 0) {
      parsedJson.sources = liveSources;
    }

    if (!parsedJson.id) {
      parsedJson.id = `search_${Date.now()}`;
    }

    const normalized = this.normalizeAnalysisResponse(parsedJson);
    return AnalysisResponseSchema.parse(normalized);
  }
}
