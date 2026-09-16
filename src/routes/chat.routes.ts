import { Router, Request, Response } from "express";
import { GeminiService } from "../services/gemini.service.js";
import { ChatRequestSchema } from "../types/schema.js";

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = ChatRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Geçersiz istek formatı.",
        details: parseResult.error.format()
      });
      return;
    }

    const chatResponse = await GeminiService.askQuestion(parseResult.data);
    res.json(chatResponse);
  } catch (error: any) {
    console.error("Sohbet (Q&A) hatası:", error);
    res.status(500).json({
      error: error.message || "Soru yanıtlanırken bir hata oluştu."
    });
  }
});

export default router;
