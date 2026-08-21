import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const repository = "onnx-community/grounding-dino-tiny-ONNX";
const destination = path.resolve("models/grounding-dino-tiny-ONNX");
const files = ["config.json", "preprocessor_config.json", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "vocab.txt", "onnx/model_quantized.onnx"];
const modelSha256 = "70bf2d3310d1ae73769c96a71e00cbf2861eb33a1f4d97d84a108a7bf02c03c9";

const MAX_ATTEMPTS = 4;
const ATTEMPT_TIMEOUT_MS = 120000;

async function downloadWithRetry(url, temporary) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      const fileStream = fs.createWriteStream(temporary);
      await response.body.pipeTo(
        new WritableStream({
          write(chunk) {
            return new Promise((resolve, reject) => {
              fileStream.write(chunk, (error) => (error ? reject(error) : resolve()));
            });
          },
          close() {
            return new Promise((resolve, reject) => {
              fileStream.end((error) => (error ? reject(error) : resolve()));
            });
          },
        }),
      );
      return;
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      const isLastAttempt = attempt === MAX_ATTEMPTS;
      console.log(`  attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}${isLastAttempt ? "" : " (retrying)"}`);
      if (isLastAttempt) throw error;
      await sleep(1000 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
}

for (const file of files) {
  const output = path.join(destination, ...file.split("/"));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (fs.existsSync(output)) { console.log(`Already installed: ${file}`); continue; }
  const url = `https://huggingface.co/${repository}/resolve/main/${file}?download=true`;
  const temporary = `${output}.download`;
  console.log(`Downloading ${file}...`);
  await downloadWithRetry(url, temporary);
  fs.renameSync(temporary, output);
}

const modelFile = path.join(destination, "onnx", "model_quantized.onnx");
const actualHash = createHash("sha256").update(fs.readFileSync(modelFile)).digest("hex");
if (actualHash !== modelSha256) throw new Error(`Model SHA-256 mismatch: ${actualHash}`);
console.log(`Installed ${repository}`);
console.log(`${fs.statSync(modelFile).size} bytes; SHA-256 ${actualHash}`);
