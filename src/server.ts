import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import os from "os";
import analyzeRouter from "./routes/analyze.routes.js";
import chatRouter from "./routes/chat.routes.js";
import searchRouter from "./routes/search.routes.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// Middleware
app.use(cors());
app.use((req, _res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Sağlık kontrolü & API Durumu
app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    app: "Bilgi Ağacı Backend API",
    version: "1.0.0",
    geminiConfigured: !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here")
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    geminiConfigured: !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here")
  });
});

// Rotalar
app.use("/api/analyze", analyzeRouter);
app.use("/api/chat", chatRouter);
app.use("/api/search", searchRouter);

// Yerel IP adresini bulma yardımcısı
function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

app.listen(PORT, "0.0.0.0", () => {
  const localIp = getLocalIpAddress();
  console.log("=================================================");
  console.log(`🚀 Omni-Lens Backend Sunucusu Başlatıldı!`);
  console.log(`📡 Yerel Port:     http://localhost:${PORT}`);
  console.log(`📱 Mobil Cihaz IP: http://${localIp}:${PORT}`);
  console.log(
    `🔑 Gemini Durumu:  ${
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here"
        ? "✅ Aktif (API Anahtarı Tanımlı)"
        : "⚠️  Eksik (.env dosyasına GEMINI_API_KEY ekleyin)"
    }`
  );
  console.log("=================================================");
});
