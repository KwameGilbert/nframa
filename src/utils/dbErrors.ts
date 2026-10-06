export function isUniqueViolation(err: unknown, constraint: string) {
  const { code, constraint: name } = err as { code?: string; constraint?: string };
  return code === "23505" && name === constraint;
}
