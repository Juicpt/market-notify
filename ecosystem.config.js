module.exports = {
  apps: [{
    name: 'market-notify',
    script: './src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    cron_restart: '0 */6 * * *', // 每6小时重启一次
    restart_delay: 4000, // 重启延迟4秒
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    min_uptime: '10s', // 运行至少10秒才算成功启动
    max_restarts: 10 // 在10次重启后停止
  }]
};
