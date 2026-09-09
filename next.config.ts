import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./assets/videos/how-to-get.mp4"],
  },
};
export default nextConfig;
