import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.warn(
    "[Redis] REDIS_URL is not set — falling back to localhost:6379"
  );
}

export const redis = new Redis(REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on("connect", () => console.log("[Redis] Connected"));
redis.on("error", (err) => console.error("[Redis] Error:", err.message));

// ------- Key helpers -------

export const PAIR_KEY = (code: string) => `pair:${code}`;

export interface PairRecord {
  status: "waiting" | "extension_connected" | "paired" | "disconnected";
  createdAt: number;
}

export async function getPair(code: string): Promise<PairRecord | null> {
  const raw = await redis.get(PAIR_KEY(code));
  if (!raw) return null;
  return JSON.parse(raw) as PairRecord;
}

export async function setPair(
  code: string,
  data: PairRecord,
  ttl: number
): Promise<void> {
  await redis.set(PAIR_KEY(code), JSON.stringify(data), "EX", ttl);
}

export async function getTTL(code: string): Promise<number> {
  return redis.ttl(PAIR_KEY(code));
}
