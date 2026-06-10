const failureMap: Record<string, number> = {};
const statusMap: Record<string, "UP" | "DOWN"> = {};

const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT = 10000; // 10 sec

export const isServiceUp = (service: string) => {
  return statusMap[service] !== "DOWN";
};

export const recordFailure = (service: string) => {
  failureMap[service] = (failureMap[service] || 0) + 1;

  if (failureMap[service] >= FAILURE_THRESHOLD) {
    statusMap[service] = "DOWN";

    setTimeout(() => {
      statusMap[service] = "UP";
      failureMap[service] = 0;
    }, RESET_TIMEOUT);
  }
};

export const recordSuccess = (service: string) => {
  failureMap[service] = 0;
};
