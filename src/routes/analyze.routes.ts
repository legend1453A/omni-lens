import { Router, Request, Response } from "express";
import multer from "multer";
import { ImageService } from "../services/image.service.js";
import { GeminiService } from "../services/gemini.service.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024 // 25 MB max
  }
});

router.post("/", upload.single("image"), async (req: Request, res: Response): Promise<void> => {
  try {
    let buffer: Buffer | null = null;
    let mimeType = "image/jpeg";

    // 1. Multipart dosya yüklemesi kontrolü
    if (req.file) {
      buffer = req.file.buffer;
      mimeType = req.file.mimetype || "image/jpeg";
    }
    // 2. JSON Base64 yüklemesi kontrolü (Mobil cihazlar için %100 uyumlu)
    else if (req.body && req.body.imageBase64) {
      buffer = Buffer.from(req.body.imageBase64, "base64");
      mimeType = req.body.mimeType || "image/jpeg";
    }

    if (!buffer) {
      res.status(400).json({ error: "Lütfen analiz edilecek bir fotoğraf yükleyin (image alanı veya imageBase64)." });
      return;
    }

    // Görseli optimize et (yeniden boyutlandır ve sıkıştır)
    const optimized = await ImageService.optimizeImage(buffer, mimeType);

    // Gemini Multimodal ve Google Search ile analiz et
    const analysis = await GeminiService.analyzeImage(optimized.base64, optimized.mimeType);

    res.json(analysis);
  } catch (error: any) {
    console.error("Görsel analiz hatası:", error);
    res.status(500).json({
      error: error.message || "Görsel analiz edilirken beklenmeyen bir hata oluştu."
    });
  }
});

export default router;
