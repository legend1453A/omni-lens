import { Router, Request, Response } from "express";
import { GeminiService } from "../services/gemini.service.js";
import { SearchRequestSchema } from "../types/schema.js";

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = SearchRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Lütfen geçerli bir arama metni girin.",
        details: parseResult.error.format()
      });
      return;
    }

    const searchResponse = await GeminiService.searchByText(parseResult.data.query);
    res.json(searchResponse);
  } catch (error: any) {
    console.error("Metin arama hatası:", error);
    res.status(500).json({
      error: error.message || "Arama yapılırken bir hata oluştu."
    });
  }
});

export default router;
