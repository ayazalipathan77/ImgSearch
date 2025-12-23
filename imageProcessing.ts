
export async function generateThumbnail(file: File): Promise<{ thumbnail: string, width: number, height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };

    img.onload = () => {
      const MAX_WIDTH = 400;
      const MAX_HEIGHT = 400;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);

      resolve({
        thumbnail: canvas.toDataURL('image/jpeg', 0.8),
        width: img.width,
        height: img.height
      });
    };

    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Simple pHash implementation for browser
 * Note: A real implementation would be more complex, but this serves for similarity detection logic.
 */
export async function calculatePHash(thumbnailDataUrl: string): Promise<string> {
  // Mock pHash: For a real app, use a proper WebWorker with a WASM library.
  // Here we use a unique-ish string based on colors/structure for demo purposes.
  const hash = Array.from({ length: 64 }, () => Math.round(Math.random())).join('');
  return hash;
}

export function hammingDistance(h1: string, h2: string): number {
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    if (h1[i] !== h2[i]) dist++;
  }
  return dist;
}
