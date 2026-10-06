import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The system prompt is read from disk at runtime; make sure it ships with
  // the chat function.
  outputFileTracingIncludes: {
    "/api/chat": ["./prompts/**/*"],
  },
  poweredByHeader: false,
};

export default nextConfig;
