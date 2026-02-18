export function errorMiddleware(error, _req, res, _next) {
  const message = error instanceof Error ? error.message : "Unknown internal error";
  res.status(500).json({ error: message });
}
