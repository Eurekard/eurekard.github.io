const MAX_IMAGE_DIMENSION = 1920;
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
    const { width, height } = resizeDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('瀏覽器不支援圖片壓縮');
    }

    context.drawImage(image, 0, 0, width, height);

    const avifBlob = await canvasToBlob(canvas, 'image/avif', AVIF_QUALITY);
    if (avifBlob && avifBlob.size > 0) {
      return {
        blob: avifBlob,
        mimeType: 'image/avif',
        extension: 'avif',
      };
    }

    const webpBlob = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY);
    if (webpBlob && webpBlob.size > 0) {
      return {
        blob: webpBlob,
        mimeType: 'image/webp',
        extension: 'webp',
      };
    }

    throw new Error('無法轉換成 AVIF 或 WebP 格式');
  } finally {
    URL.revokeObjectURL(image.src);
  }
}
