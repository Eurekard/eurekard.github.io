const MAX_IMAGE_DIMENSION = 2048;
const TARGET_MAX_BYTES = 3 * 1024 * 1024;
const AVIF_QUALITY = 0.62;
const WEBP_QUALITY = 0.78;

type CompressionResult = {
  blob: Blob;
  mimeType: 'image/avif' | 'image/webp';
  extension: 'avif' | 'webp';
};

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('無法讀取圖片內容'));
    image.src = URL.createObjectURL(file);
  });
}

function resizeDimensions(width: number, height: number) {
  if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
    return { width, height };
  }

  const scale = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function compressImageForWeb(file: File): Promise<CompressionResult> {
  const image = await loadImage(file);

  try {
    let { width, height } = resizeDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height);

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('瀏覽器不支援圖片壓縮');

    const tryEncode = async (mimeType: 'image/webp' | 'image/avif', startQuality: number) => {
      let q = startQuality;
      let scale = 1;
      for (let attempt = 0; attempt < 12; attempt++) {
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));
        canvas.width = w;
        canvas.height = h;
        context.clearRect(0, 0, w, h);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, w, h);

        const blob = await canvasToBlob(canvas, mimeType, q);
        if (blob && blob.size > 0 && blob.size <= TARGET_MAX_BYTES) {
          return blob;
        }

        // If too large, first reduce quality a bit, then reduce dimensions.
        if (q > 0.5) {
          q -= 0.1;
        } else {
          scale *= 0.7;
        }
      }
      return null;
    };

    const webp = await tryEncode('image/webp', WEBP_QUALITY);
    if (webp) return { blob: webp, mimeType: 'image/webp', extension: 'webp' };
    
    const avif = await tryEncode('image/avif', AVIF_QUALITY);
    if (avif) return { blob: avif, mimeType: 'image/avif', extension: 'avif' };

    throw new Error('圖片壓縮後仍過大，請改用較小的圖片');
  } finally {
    URL.revokeObjectURL(image.src);
  }
}
