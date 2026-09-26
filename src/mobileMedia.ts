export function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches
}

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function canShareFile(file: File) {
  return typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
}

export async function shareFile(file: File) {
  if (!canShareFile(file)) throw new Error('File sharing is unavailable on this device. Use Save file instead.')
  try {
    await navigator.share({ files: [file], title: 'Faceveil edit' })
  } catch (error) {
    // Closing the Android share sheet is a choice, not an export failure.
    if (error instanceof DOMException && error.name === 'AbortError') return
    throw error
  }
}
