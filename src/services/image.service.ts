import sharp from "sharp";

export interface ProcessedImage {
  buffer: Buffer;
  mimeType: string;
  base64: string;
  width?: number;
  height?: number;
}

export class ImageService {
  /**
   * Mobil cihazdan gelen yüksek çözünürlüklü fotoğrafı
   * Gemini'nin en iyi algılayacağı ve ağ bant genişliğini yormayacak
   * optimum boyuta (maksimum 1600px, JPEG %85 kalite) dönüştürür.
   * Herhangi bir dönüşüm hatasında orijinal görseli kullanarak kesintiyi önler.
   */
  static async optimizeImage(inputBuffer: Buffer, fallbackMime: string = "image/jpeg"): Promise<ProcessedImage> {
    try {
      const pipeline = sharp(inputBuffer)
        .rotate() // Cihazın EXIF oryantasyonunu otomatik düzeltir (dik/yatay)
        .resize({
          width: 1600,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true
        })
        .jpeg({ quality: 85 });

      const buffer = await pipeline.toBuffer();
      const metadata = await sharp(buffer).metadata();

      return {
        buffer,
        mimeType: "image/jpeg",
        base64: buffer.toString("base64"),
        width: metadata.width,
        height: metadata.height
      };
    } catch (sharpError) {
      console.warn("[ImageService] Sharp optimizasyonu atlandı, orijinal görsel ile devam ediliyor:", sharpError);
      return {
        buffer: inputBuffer,
        mimeType: fallbackMime || "image/jpeg",
        base64: inputBuffer.toString("base64")
      };
    }
  }
}
