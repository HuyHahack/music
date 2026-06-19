# Sử dụng phiên bản Node.js gọn nhẹ
FROM node:20-slim

# Cài đặt các gói hệ thống bắt buộc bao gồm Python 3 và FFmpeg
RUN apt-get update && apt-get install -y \
    python3 \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Tải và cài đặt trực tiếp phiên bản yt-dlp mới nhất từ Github vào hệ thống
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Thiết lập thư mục làm việc trong container
WORKDIR /usr/src/app

# Sao chép tệp cấu hình và cài đặt thư viện node
COPY package*.json ./
RUN npm install

# Sao chép toàn bộ mã nguồn bot vào trong container
COPY . .

# Mở cổng port cho Render health check
EXPOSE 3000

# Lệnh khởi chạy bot
CMD [ "npm", "start" ]