type UploadPayload = {
  fileName: string;
  contentType: string;
  dataBase64: string;
};

type UploadResponse = {
  url: string;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('讀取圖片資料失敗'));
        return;
      }

      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new Error('圖片轉換失敗'));
        return;
      }

      resolve(base64);
    };
    reader.onerror = () => reject(new Error('圖片讀取失敗'));
    reader.readAsDataURL(blob);
  });
}

export async function uploadImageToR2(params: {
  blob: Blob;
  fileName: string;
  contentType: string;
  onProgress?: (percentage: number) => void;
}): Promise<string> {
  const { blob, fileName, contentType, onProgress } = params;
  const dataBase64 = await blobToBase64(blob);

  const payload: UploadPayload = {
    fileName,
    contentType,
    dataBase64,
  };

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload-image');
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      const percentage = Math.round((event.loaded / event.total) * 100);
      onProgress(Math.min(100, Math.max(0, percentage)));
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`上傳失敗 (${xhr.status})`));
        return;
      }

      try {
        const parsed = JSON.parse(xhr.responseText) as UploadResponse;
        if (!parsed.url) {
          reject(new Error('伺服器未回傳圖片網址'));
          return;
        }
        resolve(parsed.url);
      } catch (error) {
        reject(error);
      }
    };

    xhr.onerror = () => reject(new Error('網路錯誤，無法上傳圖片'));
    xhr.send(JSON.stringify(payload));
  });
}
