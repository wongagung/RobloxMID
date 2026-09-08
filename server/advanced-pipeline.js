import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import path from "node:path";

const exec = promisify(execFile);

export async function processAudio(input, opt = {}) {
  const output = path.join("uploads", `${crypto.randomUUID()}.mp3`);
  const filters = [];
  if (opt.gain) filters.push(`volume=${opt.gain}dB`);
  if (opt.fadeIn) filters.push(`afade=t=in:d=${opt.fadeIn}`);
  if (opt.fadeOut) filters.push(`afade=t=out:d=${opt.fadeOut}`);
  if (opt.compressor) filters.push("acompressor");
  if (opt.limiter) filters.push("alimiter");

  const args = ["-y", "-i", input];
  if (filters.length) args.push("-af", filters.join(","));
  args.push(output);

  await exec("ffmpeg", args);
  return output;
}
