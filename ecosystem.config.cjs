// 1547hrs on 2026/02/19

// module.exports = {
//   apps: [
//     // ─────────────────────────────────────────────────────────────────────────
//     // Consolidated Music API — 4-core cluster mode
//     // All shared state (activeDownloads) is in Redis, safe for multi-instance
//     // ─────────────────────────────────────────────────────────────────────────
//     {
//       name: "music",
//       cwd: "/home/ubuntu/Projects/oracle24hrs",
//       script: "dist/app/music/app.js",
//       interpreter: "node",
//       node_args: "-r ./doppler-production.cjs",
//       time: true,
//       merge_logs: true,
//       log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
//       out_file: "logs/music.log",
//       error_file: "logs/music.log",
//       instances: 4,
//       exec_mode: "cluster",
//       watch: false,
//     },
//     {
//       name: "demucs_worker",
//       cwd: "/home/ubuntu/Projects/oracle24hrs",
//       script: "dist/app/music/workers/demucs.worker.js",
//       interpreter: "node",
//       node_args: "-r ./doppler-production.cjs",
//       instances: 1,
//       exec_mode: "fork",
//       watch: false,
//       env: {
//         OMP_NUM_THREADS: "4",
//         MKL_NUM_THREADS: "4",
//         OPENBLAS_NUM_THREADS: "4",
//       },
//     },
//     {
//       name: "redis-gui",
//       cwd: "/home/ubuntu/Projects/oracle24hrs",
//       script: "scripts/run-redis-gui.cjs",
//       interpreter: "node",
//       node_args: "-r ./doppler-production.cjs",
//       instances: 1,
//       exec_mode: "fork",
//       watch: false,
//       env: { NODE_ENV: "production" },
//     },
//   ],
// };






module.exports = {
  apps: [
    // ─────────────────────────────────────────────────────────────────────────
    // Consolidated Music API — 4-core cluster mode
    // All shared state (activeDownloads) is in Redis, safe for multi-instance
    // ─────────────────────────────────────────────────────────────────────────
    {
      name: "music",
      cwd: "/home/ubuntu/Projects/oracle24hrs",
      script: "dist/app/music/app.js",
      interpreter: "node",
      node_args: "-r ./doppler-production.cjs",
      time: true,
      merge_logs: false,  // Separate logs per worker (music-out-0.log, music-out-1.log, etc.)
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      out_file: "logs/music-out.log",  // Base name for stdout logs (PM2 appends -ID.log for each worker)
      error_file: "logs/music-error.log",  // Base name for stderr logs (PM2 appends -ID.log for each worker)
      instances: 4,
      exec_mode: "cluster",
      watch: false,
    },
    {
      name: "demucs_worker",
      cwd: "/home/ubuntu/Projects/oracle24hrs",
      script: "dist/app/music/workers/demucs.worker.js",
      interpreter: "node",
      node_args: "-r ./doppler-production.cjs",
      time: true,
      merge_logs: false,  // No merging (single instance, so just one file each)
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      out_file: "logs/demucs_worker-out.log",  // Dedicated stdout log file
      error_file: "logs/demucs_worker-error.log",  // Dedicated stderr log file
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        OMP_NUM_THREADS: "4",
        MKL_NUM_THREADS: "4",
        OPENBLAS_NUM_THREADS: "4",
      },
    },
    {
      name: "redis-gui",
      cwd: "/home/ubuntu/Projects/oracle24hrs",
      script: "scripts/run-redis-gui.cjs",
      interpreter: "node",
      node_args: "-r ./doppler-production.cjs",
      time: true,
      merge_logs: false,  // No merging (single instance, so just one file each)
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      out_file: "logs/redis-gui-out.log",  // Dedicated stdout log file
      error_file: "logs/redis-gui-error.log",  // Dedicated stderr log file
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: { NODE_ENV: "production" },
    },
  ],
};