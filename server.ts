import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "storage.json");

// 初始化数据文件
async function initStorage() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({ accounts: [], records: {} }, null, 2));
  }
}

async function startServer() {
  await initStorage();
  
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API 路由: 获取所有同步数据
  app.get("/api/data", async (req, res) => {
    try {
      const content = await fs.readFile(DATA_FILE, "utf-8");
      res.json(JSON.parse(content));
    } catch (error) {
      res.status(500).json({ error: "Failed to read data" });
    }
  });

  // API 路由: 保存所有同步数据
  app.post("/api/data", async (req, res) => {
    try {
      await fs.writeFile(DATA_FILE, JSON.stringify(req.body, null, 2));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save data" });
    }
  });

  // Vite 开发中间件
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
