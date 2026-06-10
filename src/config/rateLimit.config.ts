export type UserRole = "free" | "premium";

export const rateLimitConfig: Record<
  UserRole,
  {
    maxTokens: number;
    refillRate: number;
  }
> = {
  free: {
    maxTokens: 10,
    refillRate: 1,
  },
  premium: {
    maxTokens: 100,
    refillRate: 10,
  },
};
