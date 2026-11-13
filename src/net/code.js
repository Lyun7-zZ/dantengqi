/**
 * 连接码编解码：把 SDP 压成一段可粘贴的文本。
 *
 * 优先 gzip（CompressionStream），环境不支持时退回明文 base64。
 * 文本统一加 DTQ1- 前缀，方便识别与后续版本演进。
 */

const CODE_PREFIX = "DTQ1-";

function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function packCode(obj) {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream === "function") {
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
      const buf = new Uint8Array(await new Response(stream).arrayBuffer());
      return CODE_PREFIX + "Z" + bytesToBase64(buf);
    } catch {
      /* 回退到明文 */
    }
  }
  return CODE_PREFIX + "P" + bytesToBase64(new TextEncoder().encode(json));
}

export async function unpackCode(code) {
  const raw = String(code).trim().replace(/\s+/g, "");
  if (!raw.startsWith(CODE_PREFIX)) throw new Error("连接码格式不正确");
  const kind = raw[CODE_PREFIX.length];
  const body = raw.slice(CODE_PREFIX.length + 1);
  const bytes = base64ToBytes(body);

  let json;
  if (kind === "Z") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    json = await new Response(stream).text();
  } else {
    json = new TextDecoder().decode(bytes);
  }
  return JSON.parse(json);
}

/** 供界面显示用：多长、大概多少字。 */
export function codeStats(code) {
  return { chars: code.length, bytes: new TextEncoder().encode(code).length };
}
