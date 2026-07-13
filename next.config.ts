import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["172.16.100.225"],
  output: "standalone"
};

export default nextConfig;
