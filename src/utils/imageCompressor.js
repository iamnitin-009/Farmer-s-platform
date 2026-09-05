// src/utils/imageCompressor.js
// Client-side canvas-based image resizing and compression
// Reduces uncompressed 3MB+ images to lightweight data URLs (< 800KB) for localStorage safety.

/**
 * Compresses and resizes an image Data URL to a lightweight size suitable for localStorage (< 800KB).
 * @param {string} dataUrl - The original image data URL.
 * @param {number} maxWidth - Maximum width in pixels (default 960px).
 * @param {number} maxHeight - Maximum height in pixels (default 960px).
 * @param {number} quality - JPEG compression quality 0.0 - 1.0 (default 0.78).
 * @returns {Promise<string>} - The compressed JPEG data URL.
 */
export async function compressImage(dataUrl, maxWidth = 960, maxHeight = 960, quality = 0.78) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return dataUrl
  }

  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      let width = img.width
      let height = img.height

      // Scale proportionally if dimensions exceed max
      if (width > maxWidth || height > maxHeight) {
        if (width / height > maxWidth / maxHeight) {
          height = Math.round((height * maxWidth) / width)
          width = maxWidth
        } else {
          width = Math.round((width * maxHeight) / height)
          height = maxHeight
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }

      // White background fill (for PNG transparent areas converted to JPEG)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)

      // Export as compressed JPEG
      const compressedDataUrl = canvas.toDataURL('image/jpeg', quality)
      resolve(compressedDataUrl)
    }

    img.onerror = () => {
      resolve(dataUrl)
    }

    img.src = dataUrl
  })
}
