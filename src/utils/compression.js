/*
 * Copyright 2026 Joe Meszaros
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Compress a string to a gzip Blob using the Compression Streams API.
 * @param {string} text - The text to compress
 * @returns {Promise<Blob>} The compressed gzip blob
 */
export async function compressToGzip(text) {
  const blob = new Blob([text]);
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

/**
 * Decompress a gzip Blob to a string using the Compression Streams API.
 * @param {Blob} blob - The gzip compressed blob
 * @returns {Promise<string>} The decompressed text
 */
export async function decompressGzip(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * Check if a Blob/File is gzip compressed by checking magic bytes (1f 8b).
 * @param {Blob|File} blob - The blob to check
 * @returns {Promise<boolean>} True if gzip compressed
 */
export async function isGzipped(blob) {
  const header = await blob.slice(0, 2).arrayBuffer();
  const bytes = new Uint8Array(header);
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Convert a Blob to a base64 string.
 * @param {Blob} blob - The blob to convert
 * @returns {Promise<string>} The base64 encoded string
 */
export async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert a base64 string to a Blob.
 * @param {string} base64 - The base64 encoded string
 * @param {string} mimeType - The MIME type of the blob
 * @returns {Blob} The decoded blob
 */
export function base64ToBlob(base64, mimeType = 'application/octet-stream') {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}
