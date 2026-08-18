import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repository = "onnx-community/grounding-dino-tiny-ONNX";
const destination = path.resolve("models/grounding-dino-tiny-ONNX");
const files = ["config.json", "preprocessor_config.json", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "vocab.txt", "onnx/model_quantized.onnx"];
const modelSha256 = "70bf2d3310d1ae73769c96a71e00cbf2861eb33a1f4d97d84a108a7bf02c03c9";

for (const file of files) {
  const output = path.join(destination, ...file.split("/"));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (fs.existsSync(output)) { console.log(`Already installed: ${file}`); continue; }
  const url = `https://huggingface.co/${repository}/resolve/main/${file}?download=true`;
  console.log(`Downloading ${file}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const temporary = `${output}.download`;
  fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));
  fs.renameSync(temporary, output);
}

const modelFile = path.join(destination, "onnx", "model_quantized.onnx");
const actualHash = createHash("sha256").update(fs.readFileSync(modelFile)).digest("hex");
if (actualHash !== modelSha256) throw new Error(`Model SHA-256 mismatch: ${actualHash}`);
console.log(`Installed ${repository}`);
console.log(`${fs.statSync(modelFile).size} bytes; SHA-256 ${actualHash}`);
