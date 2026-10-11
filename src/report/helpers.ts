// Modified for the skilled TypeScript distribution.
import { open, writeFile } from "node:fs/promises";
import type { Writable } from "node:stream";
export const dirPerm = 0o755,
  filePerm = 0o644;
export function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&#34;");
}
export function goJSON(value: unknown, indent?: number): string {
  const text = JSON.stringify(
    value,
    (_key, v) => {
      if (_key === "judgeSession" || _key === "session") return undefined;
      if (typeof v === "number" && !Number.isFinite(v))
        throw new Error("json: unsupported value: " + v);
      return v;
    },
    indent,
  );
  if (text === undefined) throw new Error("json: unsupported value");
  return text
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
export async function writeToOutput(
  outputPath: string,
  desc: string,
  content: string | Uint8Array,
): Promise<void> {
  if (!outputPath) {
    try { await writeStream(process.stdout, content); }
    catch (e) { throw new Error(`write ${desc}: ${(e as Error).message}`, {cause: e}); }
    return;
  }
  let file;
  try { file = await open(outputPath, "w", 0o666); }
  catch (e) { throw new Error(`create ${desc} file: ${(e as Error).message}`, {cause: e}); }
  let failure: unknown;
  try { await file.writeFile(content); }
  catch (e) { failure = new Error(`write ${desc}: ${(e as Error).message}`, {cause: e}); }
  try { await file.close(); }
  catch (e) { failure ??= new Error(`close ${desc} file: ${(e as Error).message}`, {cause: e}); }
  if (failure) throw failure;
}
export function writeStream(
  writer: Writable,
  content: string | Uint8Array,
): Promise<void> {
  return new Promise((resolve, reject) =>
    writer.write(content, (e) => (e ? reject(e) : resolve())),
  );
}
export async function writeJSONFile(
  outputPath: string,
  value: unknown,
  desc: string,
): Promise<void> {
  let data;
  try {
    data = goJSON(value, 2) + "\n";
  } catch (e) {
    throw new Error(`marshal ${desc}: ${(e as Error).message}`, { cause: e });
  }
  try {
    await writeFile(outputPath, data, { mode: filePerm });
  } catch (e) {
    throw new Error(`write ${desc} ${outputPath}: ${(e as Error).message}`, {
      cause: e,
    });
  }
}
// Go fmt uses round-to-nearest, ties-to-even; toFixed uses the JS tie direction.
export function fixed(value: number, digits: number, signed = false): string {
  if (!Number.isFinite(value))
    return Number.isNaN(value) ? "NaN" : value < 0 ? "-Inf" : "+Inf";
  const negative = value < 0 || Object.is(value, -0),
    abs = Math.abs(value),
    view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, abs, false);
  const bits = view.getBigUint64(0, false),
    exp = Number((bits >> 52n) & 2047n);
  let mantissa = bits & ((1n << 52n) - 1n);
  if (exp) mantissa |= 1n << 52n;
  const power = (exp ? exp - 1023 : -1022) - 52;
  let numerator = mantissa * 10n ** BigInt(digits),
    denominator = 1n;
  if (power >= 0) numerator <<= BigInt(power);
  else denominator <<= BigInt(-power);
  let rounded = numerator / denominator;
  const rem = numerator % denominator;
  if (
    rem * 2n > denominator ||
    (rem * 2n === denominator && rounded % 2n === 1n)
  )
    rounded++;
  let text = rounded.toString().padStart(digits + 1, "0");
  if (digits) text = text.slice(0, -digits) + "." + text.slice(-digits);
  return (negative ? "-" : signed ? "+" : "") + text;
}
