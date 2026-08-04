# Sử dụng Node.js 22 để yt-dlp nhận JS runtime
FROM node:22-slim

# Cài đặt các gói hệ thống bắt buộc
RUN apt-get update && apt-get install -y \
    python3 \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Tải yt-dlp mới nhất
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Thư mục làm việc
WORKDIR /usr/src/app

# Cài thư viện Node
COPY package*.json ./
RUN npm install

# Sao chép mã nguồn bot
COPY . .

# Render sẽ truyền PORT qua biến môi trường
EXPOSE 3000

# Kiểm tra phiên bản lúc build để dễ xem log
RUN node --version \
    && npm --version \
    && yt-dlp --version \
    && ffmpeg -version | head -n 1

# Khởi chạy bot
CMD ["npm", "start"]
