import { AwsClient } from 'aws4fetch'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

export const R2_BUCKET = 'pule-frame-recordings'
export const PART_BYTES = 16 * 1024 * 1024
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024
export const SOURCE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4$/
const parser = new XMLParser({ processEntities: true, parseTagValue: false, isArray: name => name === 'Part' })
const xml = text => {
  if (text.length > 1048576 || /<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw Error('Invalid storage response')
  return parser.parse(text)
}
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')

/** Fixed private bucket/endpoint. No caller-supplied hosts, bucket names or object paths. */
export function recordingR2(env, transport = fetch) {
  if (!/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID ?? '') || env.R2_RECORDINGS_BUCKET !== R2_BUCKET
      || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) throw Error('R2 is not configured')
  const aws = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto', retries: 0 })
  const url = (key, query = {}) => {
    if (!SOURCE_KEY.test(key)) throw Error('Invalid source identity')
    const u = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`)
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v))
    return u
  }
  async function request(method, key, query = {}, headers = {}, body) {
    const signed = await aws.sign(url(key, query), { method, headers, body, redirect: 'manual' })
    return transport(signed, { signal: AbortSignal.timeout(25000), redirect: 'manual' })
  }
  async function text(response) {
    if (!response.ok) throw Error('Storage operation unavailable')
    const reader = response.body.getReader(); const chunks = []; let size = 0
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break
        size += value.length; if (size > 1048576) throw Error('Oversized storage response')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const bytes = new Uint8Array(size); let at = 0
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length }
    return new TextDecoder().decode(bytes)
  }
  return {
    async create(key, metadata) {
      const headers = { 'Content-Type': 'video/mp4', 'x-amz-meta-upload': metadata.upload_id, 'x-amz-meta-actor': metadata.actor_id, 'x-amz-meta-sha256': metadata.source_sha256 }
      const d = xml(await text(await request('POST', key, { uploads: '' }, headers)))
      const id = d.InitiateMultipartUploadResult?.UploadId
      if (typeof id !== 'string' || !id.length || id.length > 2048) throw Error('Invalid multipart response')
      return id
    },
    async head(key) {
      const r = await request('HEAD', key)
      if (r.status === 404) return null
      if (!r.ok) throw Error('Could not verify source')
      return { bytes: Number(r.headers.get('content-length')), type: r.headers.get('content-type'), etag: r.headers.get('etag'), upload: r.headers.get('x-amz-meta-upload'), actor: r.headers.get('x-amz-meta-actor'), sha256: r.headers.get('x-amz-meta-sha256') }
    },
    async parts(key, id) {
      const d = xml(await text(await request('GET', key, { uploadId: id, 'max-parts': 1000 }))).ListPartsResult
      if (!d || String(d.IsTruncated) === 'true') throw Error('Invalid multipart response')
        return (d.Part ?? []).map(p => {
          if (
            !Number.isSafeInteger(Number(p.PartNumber)) ||
            Number(p.PartNumber) < 1 ||
            !Number.isSafeInteger(Number(p.Size)) ||
            Number(p.Size) <= 0 ||
            typeof p.ETag !== 'string' ||
            !/^(?:"[A-Za-z0-9+/=]{24,128}"|[A-Za-z0-9+/=]{24,128})$/.test(p.ETag.trim())
          ) {
            console.error('Invalid R2 part fields', {
              partNumber: p.PartNumber,
              size: p.Size,
              etagType: typeof p.ETag,
              etagLength: typeof p.ETag === 'string' ? p.ETag.length : null,
              etagFormat: typeof p.ETag === 'string'
              ? {
                  quoted: p.ETag.startsWith('"') && p.ETag.endsWith('"'),
                  hex: /^[a-fA-F0-9]+$/.test(p.ETag.replaceAll('"', '')),
                  base64: /^[A-Za-z0-9+/]+={0,2}$/.test(p.ETag.replaceAll('"', '').trim()),
                  hasWhitespace: /\s/.test(p.ETag),
                  characterTypes: [...new Set([...p.ETag].filter(c => !/[A-Za-z0-9+/=]/.test(c)))].map(c => ({
                  code: c.charCodeAt(0)
                  }))
                }
              : null,
              etagMatches: typeof p.ETag === 'string'
                ? /^"?[a-fA-F0-9]{32}"?$/.test(p.ETag.trim())
                : false
            })
            throw Error('Invalid uploaded part')
          }

          return {
            number: Number(p.PartNumber),
            bytes: Number(p.Size),
            etag: p.ETag
          }
        })
    },
    async signPart(key, id, number, bytes) {
      const signed = await aws.sign(url(key, { uploadId: id, partNumber: number, 'X-Amz-Expires': 120 }), {
        method: 'PUT', headers: { 'Content-Length': String(bytes) }, aws: { signQuery: true, allHeaders: true },
      })
      if (!new URL(signed.url).searchParams.get('X-Amz-SignedHeaders')?.split(';').includes('content-length')) throw Error('Part length is not signed')
      return signed.url
    },
    async complete(key, id, parts) {
      const body = '<CompleteMultipartUpload>' + parts.map(p => `<Part><PartNumber>${p.number}</PartNumber><ETag>${escape(p.etag)}</ETag></Part>`).join('') + '</CompleteMultipartUpload>'
      const result = xml(await text(await request('POST', key, { uploadId: id }, { 'Content-Type': 'application/xml', 'If-None-Match': '*' }, body)))
      if (!result.CompleteMultipartUploadResult || result.Error) throw Error('Source completion unconfirmed')
    },
    async abort(key, id) {
      const r = await request('DELETE', key, { uploadId: id })
      if (!r.ok && r.status !== 404) throw Error('Could not abort multipart source')
    },
    async remove(key) {
      const r = await request('DELETE', key)
      if (!r.ok) throw Error('Could not remove expired source')
    },
  }
}
