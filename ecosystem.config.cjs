module.exports = {
  apps: [
    // ─────────────────────────────────────────────────────────────────────────
    // Consolidated Music API (replaces common_routes and scraper)
    // ─────────────────────────────────────────────────────────────────────────
    {
      name: "music",
      script: "dist/app/music/app.js",
      interpreter: "node",
      node_args: "-r ./doppler-production.cjs",
      time: true,
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      out_file: "logs/music.log",
      error_file: "logs/music.log",
      instances: 1,
      exec_mode: "fork",
      watch: false,
    },
    {
      name: "demucs_worker",
      script: "dist/app/music/workers/demucs.worker.js",
      interpreter: "node",
      node_args: "-r ./doppler-production.cjs",
      instances: 1,
      exec_mode: "fork",
      watch: false,
    },
    {
      name: "redis-gui",
      cwd: "/home/ubuntu/Projects/oracle24hrs",
      script: "scripts/run-redis-gui.cjs",
      interpreter: "node",
      node_args: "-r ./doppler-production.cjs",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: { NODE_ENV: "production" },
    },
  ],
};
