import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const baseDir = import.meta.dirname;
  const distPath = path.resolve(baseDir, "public");

  console.log(`[static] Base directory: ${baseDir}`);
  console.log(`[static] Looking for public dir at: ${distPath}`);
  
  // List what's actually in the base directory
  try {
    const contents = fs.readdirSync(baseDir);
    console.log(`[static] Contents of ${baseDir}:`, contents);
  } catch (e) {
    console.log(`[static] Could not read ${baseDir}:`, e);
  }

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
