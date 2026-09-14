#!/data/data/com.termux/files/usr/bin/bash
ssh ubuntu@68.233.102.48 "cd garage && git pull && npm install && pm2 restart garage-api"
