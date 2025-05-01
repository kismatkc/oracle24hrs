import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Recreate __filename and __dirname in ES modules:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function processFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  // Replace any import/export statement ending with ".ts" to use ".js"
  const newContent = content.replace(
    /(from\s+["'][^"']+)(\.ts)(["'])/g,
    "$1.js$3"
  );

  if (newContent !== content) {
    fs.writeFileSync(filePath, newContent, "utf8");
    console.log(`Updated: ${filePath}`);
  }
}

function traverseDir(dir) {
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      traverseDir(fullPath);
    } else if (
      stats.isFile() &&
      (fullPath.endsWith(".js") || fullPath.endsWith(".mjs"))
    ) {
      processFile(fullPath);
    }
  }
}

// Change the path below if your dist folder is in a different location
const distFolder = path.join(__dirname, "dist");
traverseDir(distFolder);
