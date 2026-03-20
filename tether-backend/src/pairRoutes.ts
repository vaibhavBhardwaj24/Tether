import { Router, Request, Response } from "express";
import { getPair, setPair, getTTL, PairRecord } from "./redis";

const router = Router();

// Validate pairing code format: exactly 8 uppercase alphanumeric chars
function isValidCode(code: string): boolean {
  return /^[A-Z0-9]{8}$/.test(code);
}

// Generate a random 8-char uppercase alphanumeric code
function generateCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// POST /pair/generate
router.post("/generate", async (_req: Request, res: Response) => {
  try {
    // Ensure uniqueness — try up to 5 times
    let code = generateCode();
    for (let i = 0; i < 5; i++) {
      const existing = await getPair(code);
      if (!existing) break;
      code = generateCode();
    }

    const record: PairRecord = { status: "waiting", createdAt: Date.now() };
    const TTL = 300; // 5 minutes while waiting
    await setPair(code, record, TTL);

    console.log(`[Pair] Generated code: ${code}`);
    res.json({ code, expiresInSeconds: TTL });
  } catch (err) {
    console.error("[Pair] /generate error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /pair/status/:code
router.get("/status/:code", async (req: Request, res: Response) => {
  const { code } = req.params;

  if (!isValidCode(code)) {
    res.status(400).json({ error: "Invalid code format" });
    return;
  }

  try {
    const record = await getPair(code);
    if (!record) {
      res.json({ status: "expired", ttl: 0 });
      return;
    }

    const ttl = await getTTL(code);
    res.json({ status: record.status, ttl });
  } catch (err) {
    console.error("[Pair] /status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Export the validation helper so ws handler can reuse it
export { isValidCode };
export default router;
