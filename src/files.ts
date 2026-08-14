import { closeSync, constants, fstatSync, openSync, readSync, type Stats } from "node:fs"

export function readBoundedRegular(path: string, maximum: number): Uint8Array {
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const metadata: Stats = fstatSync(descriptor)
    if (!metadata.isFile()) throw new Error(`not a regular file: ${path}`)
    const buffer = Buffer.allocUnsafe(maximum + 1)
    let offset = 0
    while (offset < buffer.byteLength) {
      const count = readSync(descriptor, buffer, offset, buffer.byteLength - offset, null)
      if (count === 0) break
      offset += count
    }
    return buffer.subarray(0, offset)
  } finally {
    closeSync(descriptor)
  }
}
