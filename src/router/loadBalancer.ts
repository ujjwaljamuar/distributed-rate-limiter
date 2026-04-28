let index = 0;

export const getNextService = (services: string[]) => {
  index = (index + 1) % services.length;
  return services[index];
};
