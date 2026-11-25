/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bật standalone khi build Docker container hoặc khi có biến DOCKER_BUILD=1 / OUTPUT_STANDALONE=1
  output: process.env.DOCKER_BUILD === "1" || process.env.OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
  cleanDistDir: false,
  async rewrites() {
    const backendUrl =
      process.env.INTERNAL_BACKEND_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      "http://localhost:8080";
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendUrl}/api/v1/:path*`,
      },
      {
        source: "/api/video/:path*",
        destination: `${backendUrl}/api/video/:path*`,
      },
    ];
  },
};

export default nextConfig;
