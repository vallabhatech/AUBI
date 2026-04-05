const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["react-markdown", "remark-gfm"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "github.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" }
    ]
  },
};

export default nextConfig;
