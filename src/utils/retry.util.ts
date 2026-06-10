const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const retryRequest = async (fn: () => Promise<any>) => {
  let delay = 100;

  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (err) {
      const jitter = Math.random() * 100;

      await sleep(delay + jitter);
      delay *= 2;
    }
  }

  throw new Error("Retries failed");
};
