import "dotenv/config";
import http from "http";
import express, { Request, Response } from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import pairRoutes from "./pairRoutes";
import { setupWebSocket } from "./wsHandler";

const PORT = parseInt(process.env.PORT || "3000", 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

// ── Express app ──────────────────────────────────────────────────
const app = express();

app.use(
  cors({
    origin: CORS_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json());

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Pair routes
app.use("/pair", pairRoutes);

// 404 fallback
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// ── HTTP + WebSocket server ───────────────────────────────────────
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/ws" });
setupWebSocket(wss);

server.listen(PORT, () => {
  console.log(`\n🚀 Tether Relay Server running on port ${PORT}`);
  console.log(`   HTTP  → http://localhost:${PORT}/health`);
  console.log(`   WS    → ws://localhost:${PORT}/ws`);
  console.log(`   CORS  → ${CORS_ORIGIN}\n`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[Server] SIGTERM received — shutting down gracefully");
  server.close(() => {
    console.log("[Server] HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("[Server] SIGINT received — shutting down gracefully");
  server.close(() => {
    console.log("[Server] HTTP server closed");
    process.exit(0);
  });
});
