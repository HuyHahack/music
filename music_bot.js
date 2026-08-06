const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { Riffy } = require('riffy');
const express = require('express');
const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
require('dotenv/config');

// ============ EXPRESS SERVER ============
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.json({ status: 'online' }));
app.get('/health', (req, res) => res.status(200).send('OK'));
const PORT = process.env.PORT || 3000;

// Thư mục chứa các bản mix tạm thời để Lavalink có thể tải và phát.
const MIX_OUTPUT_DIR = path.join(__dirname, 'mix-output');
fs.mkdirSync(MIX_OUTPUT_DIR, { recursive: true });
app.use('/mix', express.static(MIX_OUTPUT_DIR, {
  fallthrough: false,
  maxAge: '1h'
}));

app.listen(PORT, () => console.log(`🌐 Web server chạy tại cổng ${PORT}`));

// ============ DISCORD BOT CLIENT ============
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions
  ]
});

const PREFIX = 'm!';

// ============ Cấu hình Lavalink Node ============
const nodes = [
  // Ưu tiên gần VN / ổn định hơn
  {
    name: "Kasawa TH",
    host: "lava2.kasawa.pro",
    port: 2334,
    password: "youshallnotpass",
    secure: false
  },
  {
    name: "Serenetia v4 SSL",
    host: "lavalinkv4.serenetia.com",
    port: 443,
    password: "https://seretia.link/discord",
    secure: true
  },
  {
    name: "Serenetia v4 Non-SSL",
    host: "lavalinkv4.serenetia.com",
    port: 80,
    password: "https://seretia.link/discord",
    secure: false
  },
  {
    name: "Millohost ID SSL",
    host: "lava-v4.millohost.my.id",
    port: 443,
    password: "https://discord.gg/mjS5J2K3ep",
    secure: true
  },
  {
    name: "MineCuta",
    host: "lavav4.minecuta.com",
    port: 2333,
    password: "discord.gg/gKuXdHs",
    secure: false
  },
  {
    name: "NexCloud",
    host: "n3.nexcloud.in",
    port: 2026,
    password: "nexcloud",
    secure: false
  },
  {
    name: "G3V UK",
    host: "lava.g3v.co.uk",
    port: 9008,
    password: "lavalinklol",
    secure: false
  },
  {
    name: "Jirayu v4",
    host: "lavalink.jirayu.net",
    port: 13592,
    password: "youshallnotpass",
    secure: false
  },
  {
    name: "Jirayu v4 SSL",
    host: "lavalink.jirayu.net",
    port: 443,
    password: "youshallnotpass",
    secure: true
  },
  {
    name: "East112",
    host: "157.254.192.15",
    port: 2333,
    password: "youshallnotpass",
    secure: false
  },
  {
    name: "VexaNode Miami",
    host: "omega.vexanode.cloud",
    port: 2031,
    password: "https://discord.vexanode.cloud",
    secure: false
  },
  {
    name: "Trinium 4333",
    host: "lavalink.triniumhost.com",
    port: 4333,
    password: "free",
    secure: false
  },
  {
    name: "Trinium SSL",
    host: "lavalink-v4.triniumhost.com",
    port: 443,
    password: "free",
    secure: true
  }
];
client.riffy = new Riffy(client, nodes, {
  send: (payload) => {
    const guild = client.guilds.cache.get(payload.d.guild_id);
    if (guild) guild.shard.send(payload);
  },
  defaultSearchPlatform: "ytsearch", // Công cụ tìm kiếm YouTube thường
  restVersion: "v4",
  bypassChecks: {
    nodeFetchInfo: true
  }
});

// Bộ đếm thời gian chờ tránh spam tất cả các lệnh m! (Cooldown 3 giây)
const globalCooldowns = new Map();
// Khai báo đầy đủ các bộ nhớ đệm quản lý chống spam lệnh và tìm kiếm bài hát
const playCooldowns = new Map(); // Giới hạn thời gian chờ riêng cho lệnh phát nhạc (10 giây)
const tempSearchTracks = new Map(); // Lưu tạm kết quả tìm kiếm (Key: ID tin nhắn gửi đi - searchMsg.id)

// ============ HỆ THỐNG MIX NHIỀU BÀI PHÁT CÙNG LÚC ============
// Trên Railway có thể tự nhận domain. Với host khác, thêm PUBLIC_URL=https://domain-cua-bot.com
// Cookie YouTube được ưu tiên lấy từ biến YOUTUBE_COOKIES_BASE64 để không phải commit cookies.txt.
const YOUTUBE_COOKIE_FILE = path.join(__dirname, '.youtube-cookies.txt');

function logCookieFileStatus(cookiePath, sourceName) {
  try {
    const stat = fs.statSync(cookiePath);
    const content = fs.readFileSync(cookiePath, 'utf8');
    const nonCommentLines = content
      .split(/\r?\n/)
      .filter(line => line.trim() && !line.startsWith('#'));
    const youtubeLines = nonCommentLines.filter(line => /(^|\.)youtube\.com\t/i.test(line));

    console.log(`[MIX COOKIE] ✅ Nguồn: ${sourceName}`);
    console.log(`[MIX COOKIE] 📁 File: ${cookiePath}`);
    console.log(`[MIX COOKIE] 📦 Dung lượng: ${stat.size} bytes`);
    console.log(`[MIX COOKIE] 🍪 Tổng dòng cookie: ${nonCommentLines.length}`);
    console.log(`[MIX COOKIE] ▶️ Cookie YouTube: ${youtubeLines.length}`);
  } catch (error) {
    console.error('[MIX COOKIE] ❌ Không đọc được file cookie:', error.message);
  }
}

function prepareYouTubeCookies() {
  try {
    const customPath = (process.env.YOUTUBE_COOKIES_PATH || '').trim();
    if (customPath) {
      console.log(`[MIX COOKIE] YOUTUBE_COOKIES_PATH đã được đặt: ${customPath}`);
      if (fs.existsSync(customPath)) {
        logCookieFileStatus(customPath, 'YOUTUBE_COOKIES_PATH');
        return customPath;
      }
      console.warn('[MIX COOKIE] ⚠️ Đường dẫn YOUTUBE_COOKIES_PATH không tồn tại.');
    }

    const base64Cookies = (process.env.YOUTUBE_COOKIES_BASE64 || '').trim();
    console.log(`[MIX COOKIE] YOUTUBE_COOKIES_BASE64: ${base64Cookies ? `đã nhận (${base64Cookies.length} ký tự)` : 'KHÔNG CÓ'}`);
    if (base64Cookies) {
      const decodedBuffer = Buffer.from(base64Cookies, 'base64');
      const decoded = decodedBuffer.toString('utf8');
      console.log(`[MIX COOKIE] Base64 giải mã được: ${decodedBuffer.length} bytes`);

      if (!decoded.includes('Netscape HTTP Cookie File') && !decoded.includes('.youtube.com')) {
        throw new Error('YOUTUBE_COOKIES_BASE64 không phải cookies.txt hợp lệ.');
      }

      fs.writeFileSync(YOUTUBE_COOKIE_FILE, decoded, { mode: 0o600 });
      logCookieFileStatus(YOUTUBE_COOKIE_FILE, 'YOUTUBE_COOKIES_BASE64');
      return YOUTUBE_COOKIE_FILE;
    }

    const rawCookies = process.env.YOUTUBE_COOKIES;
    console.log(`[MIX COOKIE] YOUTUBE_COOKIES dạng text: ${rawCookies && rawCookies.trim() ? 'đã nhận' : 'KHÔNG CÓ'}`);
    if (rawCookies && rawCookies.trim()) {
      fs.writeFileSync(YOUTUBE_COOKIE_FILE, rawCookies.replace(/\n/g, '\n'), { mode: 0o600 });
      logCookieFileStatus(YOUTUBE_COOKIE_FILE, 'YOUTUBE_COOKIES');
      return YOUTUBE_COOKIE_FILE;
    }

    const localFile = path.join(__dirname, 'cookies.txt');
    if (fs.existsSync(localFile)) {
      logCookieFileStatus(localFile, 'cookies.txt cục bộ');
      return localFile;
    }

    console.warn('[MIX COOKIE] ⚠️ Không tìm thấy cookie nào. m!mix có thể bị YouTube chặn trên host.');
  } catch (error) {
    console.error('[MIX COOKIE ERROR]', error.message);
  }
  return null;
}

const youtubeCookiePath = prepareYouTubeCookies();
function getPublicBaseUrl() {
  const configured = (process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;

  const railwayDomain = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railwayDomain) return `https://${railwayDomain}`;

  return null;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function removeDirectorySafe(directory) {
  await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
}

// Tải đúng URL bài đã được người dùng chọn trong bảng tìm kiếm.
function mixLog(scope, message, extra) {
  const stamp = new Date().toISOString();
  if (extra === undefined) {
    console.log(`[${stamp}] [${scope}] ${message}`);
  } else {
    console.log(`[${stamp}] [${scope}] ${message}`, extra);
  }
}

function mixError(scope, message, extra) {
  const stamp = new Date().toISOString();
  if (extra === undefined) {
    console.error(`[${stamp}] [${scope}] ${message}`);
  } else {
    console.error(`[${stamp}] [${scope}] ${message}`, extra);
  }
}

function redactCommandArgs(args) {
  const redacted = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cookies') {
      redacted.push('--cookies', '[COOKIE_FILE_HIDDEN]');
      i++;
      continue;
    }
    redacted.push(args[i]);
  }
  return redacted;
}

function safeStat(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return { exists: true, size: stat.size, modified: stat.mtime.toISOString() };
  } catch (error) {
    return { exists: false, error: error.message };
  }
}

async function logMixRuntimeInfo() {
  mixLog('MIX DIAG', `Node.js: ${process.version}`);
  mixLog('MIX DIAG', `Platform: ${process.platform} ${process.arch}`);
  mixLog('MIX DIAG', `CWD: ${process.cwd()}`);
  mixLog('MIX DIAG', `__dirname: ${__dirname}`);
  mixLog('MIX DIAG', `PUBLIC_URL: ${getPublicBaseUrl() || 'KHÔNG CÓ'}`);
  mixLog('MIX DIAG', `Cookie path: ${youtubeCookiePath ? '[ĐÃ CÓ]' : 'KHÔNG CÓ'}`);

  for (const command of ['yt-dlp', 'ffmpeg']) {
    try {
      const versionArgs = command === 'ffmpeg' ? ['-version'] : ['--version'];
      const { stdout, stderr } = await execFileAsync(command, versionArgs, { timeout: 15000, maxBuffer: 1024 * 1024 });
      const firstLine = `${stdout || stderr || ''}`.split(/\r?\n/).find(Boolean) || 'không có output';
      mixLog('MIX DIAG', `${command}: ${firstLine}`);
    } catch (error) {
      mixError('MIX DIAG', `${command} không chạy được`, {
        message: error.message,
        code: error.code,
        signal: error.signal,
        stderr: String(error.stderr || '').slice(0, 2000)
      });
    }
  }
}

setTimeout(() => {
  logMixRuntimeInfo().catch(error => mixError('MIX DIAG', 'Không kiểm tra được runtime', error.message));
}, 1500);

async function downloadMixInput(query, workDir, index) {
  const startedAt = Date.now();
  const scope = `MIX DOWNLOAD #${index}`;
  const outputTemplate = path.join(workDir, `input-${index}.%(ext)s`);
  const source = isHttpUrl(query) ? query : `ytsearch1:${query}`;

  const args = [
    '--verbose',
    '--no-playlist',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
    '--restrict-filenames',
    '--retries', '3',
    '--fragment-retries', '3',
    '--extractor-retries', '3',
    '--socket-timeout', '30',
    '--sleep-requests', '1',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    '-f', 'bestaudio[ext=m4a]/bestaudio/best',
    '-o', outputTemplate,
    '--print', 'after_move:filepath'
  ];

  if (youtubeCookiePath) args.push('--cookies', youtubeCookiePath);
  args.push(source);

  mixLog(scope, 'Bắt đầu tải');
  mixLog(scope, `Query gốc: ${query}`);
  mixLog(scope, `Nguồn yt-dlp: ${source}`);
  mixLog(scope, `Thư mục làm việc: ${workDir}`);
  mixLog(scope, `Output template: ${outputTemplate}`);
  mixLog(scope, `Cookie: ${youtubeCookiePath ? 'CÓ' : 'KHÔNG'}`);
  mixLog(scope, `Lệnh: yt-dlp ${redactCommandArgs(args).map(v => JSON.stringify(v)).join(' ')}`);

  try {
    const result = await execFileAsync('yt-dlp', args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 300000,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    const stdout = String(result.stdout || '');
    const stderr = String(result.stderr || '');
    mixLog(scope, `Hoàn tất sau ${Date.now() - startedAt} ms`);
    mixLog(scope, `STDOUT (${Buffer.byteLength(stdout)} bytes):\n${stdout || '[trống]'}`);
    mixLog(scope, `STDERR (${Buffer.byteLength(stderr)} bytes):\n${stderr || '[trống]'}`);

    const downloadedPath = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    mixLog(scope, `Đường dẫn yt-dlp trả về: ${downloadedPath || '[trống]'}`);

    if (!downloadedPath || !fs.existsSync(downloadedPath)) {
      mixError(scope, 'yt-dlp kết thúc nhưng file không tồn tại', {
        downloadedPath,
        workDirFiles: fs.existsSync(workDir) ? fs.readdirSync(workDir) : []
      });
      throw new Error(`Không tải được bài số ${index}: yt-dlp không tạo file.`);
    }

    mixLog(scope, 'File đầu vào hợp lệ', safeStat(downloadedPath));
    return downloadedPath;
  } catch (error) {
    const stdout = String(error.stdout || '');
    const stderr = String(error.stderr || '');
    const detail = `${stderr}\n${stdout}\n${error.message || ''}`;

    mixError(scope, `THẤT BẠI sau ${Date.now() - startedAt} ms`);
    mixError(scope, 'Thông tin tiến trình', {
      message: error.message,
      name: error.name,
      code: error.code,
      exitCode: error.exitCode,
      killed: error.killed,
      signal: error.signal,
      cmd: error.cmd ? String(error.cmd).replace(youtubeCookiePath || '__NONE__', '[COOKIE_FILE_HIDDEN]') : undefined
    });
    mixError(scope, `STDOUT (${Buffer.byteLength(stdout)} bytes):\n${stdout || '[trống]'}`);
    mixError(scope, `STDERR (${Buffer.byteLength(stderr)} bytes):\n${stderr || '[trống]'}`);
    mixError(scope, 'File còn lại trong workDir', fs.existsSync(workDir) ? fs.readdirSync(workDir) : []);

    if (/confirm you.?re not a bot|sign in to confirm|login required|cookies/i.test(detail)) {
      throw new Error(`Bài ${index}: YouTube yêu cầu đăng nhập/xác minh hoặc cookie không được chấp nhận trên IP host. Xem [${scope}] STDERR.`);
    }
    if (/signature solving failed|challenge solving failed|only images are available|javascript runtime|ejs/i.test(detail)) {
      throw new Error(`Bài ${index}: yt-dlp không giải được JavaScript challenge. Xem [${scope}] STDERR.`);
    }
    if (/requested format is not available/i.test(detail)) {
      throw new Error(`Bài ${index}: YouTube không trả định dạng âm thanh phù hợp. Xem [${scope}] STDERR.`);
    }
    if (/timed?\s*out|ETIMEDOUT|socket timeout/i.test(detail)) {
      throw new Error(`Bài ${index}: kết nối YouTube bị timeout trên host. Xem [${scope}] STDERR.`);
    }
    throw new Error(`Không tải được bài ${index}: ${String(error.message || error).slice(0, 700)}`);
  }
}

async function createMixedAudio(queries, guildId) {
  const startedAt = Date.now();
  const jobId = `${guildId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const scope = `MIX JOB ${jobId}`;
  const workDir = path.join(MIX_OUTPUT_DIR, `.work-${jobId}`);
  const outputFileName = `mix-${jobId}.mp3`;
  const outputPath = path.join(MIX_OUTPUT_DIR, outputFileName);
  await fsp.mkdir(workDir, { recursive: true });

  mixLog(scope, '========== BẮT ĐẦU MIX ==========');
  mixLog(scope, `Guild: ${guildId}`);
  mixLog(scope, `Số bài: ${queries.length}`);
  mixLog(scope, 'Danh sách nguồn', queries.map((q, i) => ({ index: i + 1, query: q })));
  mixLog(scope, `WorkDir: ${workDir}`);
  mixLog(scope, `Output: ${outputPath}`);
  mixLog(scope, `Public base URL: ${getPublicBaseUrl() || 'KHÔNG CÓ'}`);

  try {
    const inputFiles = await Promise.all(
      queries.map((query, index) => downloadMixInput(query, workDir, index + 1))
    );

    mixLog(scope, 'Tải đủ toàn bộ bài', inputFiles.map((file, i) => ({ index: i + 1, file, stat: safeStat(file) })));

    const ffmpegArgs = ['-hide_banner', '-loglevel', 'info', '-y'];
    for (const inputFile of inputFiles) ffmpegArgs.push('-i', inputFile);

    const inputLabels = inputFiles.map((_, index) => `[${index}:a]`).join('');
    const filter = `${inputLabels}amix=inputs=${inputFiles.length}:duration=longest:dropout_transition=2:normalize=0,alimiter=limit=0.95[mixout]`;

    ffmpegArgs.push(
      '-filter_complex', filter,
      '-map', '[mixout]',
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      outputPath
    );

    mixLog(scope, `FFmpeg filter: ${filter}`);
    mixLog(scope, `FFmpeg command: ffmpeg ${ffmpegArgs.map(v => JSON.stringify(v)).join(' ')}`);
    const ffmpegStarted = Date.now();

    try {
      const ffmpegResult = await execFileAsync('ffmpeg', ffmpegArgs, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 420000
      });
      mixLog(scope, `FFmpeg hoàn tất sau ${Date.now() - ffmpegStarted} ms`);
      mixLog(scope, `FFmpeg STDOUT:\n${String(ffmpegResult.stdout || '[trống]')}`);
      mixLog(scope, `FFmpeg STDERR:\n${String(ffmpegResult.stderr || '[trống]')}`);
    } catch (error) {
      mixError(scope, `FFmpeg THẤT BẠI sau ${Date.now() - ffmpegStarted} ms`, {
        message: error.message,
        code: error.code,
        exitCode: error.exitCode,
        killed: error.killed,
        signal: error.signal
      });
      mixError(scope, `FFmpeg STDOUT:\n${String(error.stdout || '[trống]')}`);
      mixError(scope, `FFmpeg STDERR:\n${String(error.stderr || '[trống]')}`);
      throw error;
    }

    if (!fs.existsSync(outputPath)) throw new Error('FFmpeg không tạo được file mix.');
    mixLog(scope, 'File mix đã tạo', safeStat(outputPath));

    const cleanupTimer = setTimeout(() => {
      fsp.unlink(outputPath)
        .then(() => mixLog(scope, `Đã tự xóa file mix sau 6 giờ: ${outputPath}`))
        .catch(error => mixError(scope, `Không xóa được file mix: ${error.message}`));
    }, 6 * 60 * 60 * 1000);
    if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

    const publicBaseUrl = getPublicBaseUrl();
    if (!publicBaseUrl) {
      throw new Error('Thiếu PUBLIC_URL. Hãy đặt PUBLIC_URL=https://domain-cong-khai-cua-bot');
    }

    const publicUrl = `${publicBaseUrl}/mix-files/${encodeURIComponent(outputFileName)}`;
    mixLog(scope, `URL công khai: ${publicUrl}`);
    mixLog(scope, `Tổng thời gian job: ${Date.now() - startedAt} ms`);
    mixLog(scope, '========== MIX THÀNH CÔNG ==========');

    return { outputPath, outputFileName, publicUrl, jobId };
  } catch (error) {
    mixError(scope, `========== MIX THẤT BẠI sau ${Date.now() - startedAt} ms ==========`);
    mixError(scope, 'Lỗi cuối cùng', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    mixError(scope, 'Nội dung workDir lúc lỗi', fs.existsSync(workDir) ? fs.readdirSync(workDir).map(name => ({ name, stat: safeStat(path.join(workDir, name)) })) : []);
    await fsp.unlink(outputPath).catch(() => {});
    throw error;
  } finally {
    await removeDirectorySafe(workDir);
    mixLog(scope, `Đã dọn workDir: ${workDir}`);
  }
}

// Hàm hỗ trợ chuyển đổi mili-giây sang định dạng MM:SS
function formatTime(ms) {
  if (isNaN(ms)) return '00:00';
  const totalSecs = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSecs / 60);
  const seconds = totalSecs % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Hàm hỗ trợ vẽ Thanh tiến trình thời gian thực (Progress Bar)
function createProgressBar(position, duration, size = 15) {
  if (isNaN(position) || isNaN(duration)) return '🔘' + '▬'.repeat(size) + ' [00:00 / 00:00]';
  if (position > duration) position = duration;
  const progress = Math.round((size * position) / duration);
  const emptyProgress = size - progress;
  const progressText = '▬'.repeat(progress);
  const emptyProgressText = '▬'.repeat(emptyProgress);
  const bar = `${progressText}🔘${emptyProgressText}`;
  return `${bar} [${formatTime(position)} / ${formatTime(duration)}]`;
}

// Hàm trích xuất liên kết âm thanh trực tiếp bằng yt-dlp cho các nền tảng ngoài (TikTok, Facebook...)
async function getDirectAudioUrl(url) {
  console.log(`\n[yt-dlp] 🌐 Đang trích xuất Direct URL cho liên kết: ${url}`);
  try {
    // Ép yt-dlp lấy định dạng progressive HTTP stream (như mp3/aac) để phát nhạc mượt mà nhất
    const { stdout } = await execAsync(`yt-dlp -f "bestaudio[protocol^=http]/bestaudio" -g "${url}"`);
    const directUrl = stdout.trim().split('\n')[0];
    console.log(`[yt-dlp] ✅ Đã lấy được Direct URL tĩnh thành công.`);
    return directUrl;
  } catch (err) {
    console.error('⚠️ Lỗi trích xuất yt-dlp:', err.message);
    return null;
  }
}

// Hàm giám sát thông minh tự động phát hiện trình phát nhạc đang hoạt động trên Server
function getActivePlayer(guildId) {
  const lavalinkPlayer = client.riffy.players.get(guildId);
  if (lavalinkPlayer) {
    return { type: 'lavalink', player: lavalinkPlayer, requesterId: lavalinkPlayer.requesterId };
  }
  return null;
}

client.once('ready', () => {
  client.riffy.init(client.user.id);
  console.log(`\n🎵 Bot phát nhạc Lai Đám Mây (Hybrid) đã trực tuyến: ${client.user.tag}`);
});

// Sự kiện: Bắt đầu phát bài nhạc mới
client.riffy.on("trackStart", async (player, track) => {
  const channel = client.channels.cache.get(player.textChannel);
  if (channel) {
    const title = track.info.title.startsWith('http') ? 'Liên kết ngoài / SoundCloud' : track.info.title;
    const requesterMention = track.info.requester?.id ? `<@${track.info.requester.id}>` : 'Không rõ';
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🎵 Đang phát nhạc')
      .setDescription(`**Tác phẩm:** \`${title}\`\n**Yêu cầu bởi:** ${requesterMention}\n\n${createProgressBar(0, track.info.length)}`)
      .setFooter({ text: 'Chỉ người yêu cầu hoặc Admin mới có quyền sử dụng m!leave' })
      .setTimestamp();
    const msg = await channel.send({ embeds: [embed] }).catch(() => null);
    if (msg) {
      if (player.progressInterval) clearInterval(player.progressInterval);
      // Thiết lập bộ đếm tự động cập nhật lại embed thanh thời gian sau mỗi 10 giây
      player.progressInterval = setInterval(async () => {
        const activePlayer = client.riffy.players.get(player.guildId);
        if (!activePlayer || !activePlayer.playing || !activePlayer.current) {
          clearInterval(player.progressInterval);
          return;
        }
        const updatedEmbed = EmbedBuilder.from(embed)
          .setDescription(`**Tác phẩm:** \`${title}\`\n**Yêu cầu bởi:** ${requesterMention}\n\n${createProgressBar(activePlayer.position, track.info.length)}`);
        await msg.edit({ embeds: [updatedEmbed] }).catch(() => {
          clearInterval(player.progressInterval);
        });
      }, 10000);
    }
  }
});

// Sự kiện: Hết danh sách chờ nhạc của Lavalink
client.riffy.on("queueEnd", async (player) => {
  if (player.progressInterval) clearInterval(player.progressInterval);
  const channel = client.channels.cache.get(player.textChannel);
  player.destroy();
  if (channel) {
    channel.send("👋 Danh sách phát đã kết thúc. Bot đã rời phòng thoại.").catch(() => {});
  }
});

// ============ BỔ SUNG CÁC SỰ KIỆN LAVALINK TRỰC QUAN (DEBUG LOGS) [1.3.4, 2.2.1] ============
client.riffy.on("nodeConnect", node => {
  console.log(`[NODE CONNECT] ${node.name}`);
});

client.riffy.on("nodeDisconnect", (node, code, reason) => {
  console.log(`[NODE DISCONNECT] ${node.name}`);
  console.log("Code:", code);
  console.log("Reason:", reason);
});

client.riffy.on("nodeError", (node, error) => {
  console.log(`[NODE ERROR] ${node.name}`);
  console.error(error);
});

client.riffy.on("trackError", (player, track, error) => {
  console.log("[TRACK ERROR]");
  console.error(error);
});

client.riffy.on("playerError", (player, track, error) => {
  console.log("[PLAYER ERROR]");
  console.error(error);
});

// Trích xuất dữ liệu Gateway cập nhật Voice State cho Lavalink
client.on("raw", (d) => {
  if (!["VOICE_STATE_UPDATE", "VOICE_SERVER_UPDATE"].includes(d.t)) return;
  client.riffy.updateVoiceState(d);
});

// ============ XỬ LÝ LỰA CHỌN BÀI HÁT TỪ MENU TÌM KIẾM (SEARCH SELECTOR) ============
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId === 'search_select') {
    await interaction.deferReply({ ephemeral: true });
    const userId = interaction.user.id;
    const searchData = tempSearchTracks.get(interaction.message.id);
    if (!searchData) {
      return interaction.editReply({ content: '❌ Phiên tìm kiếm đã hết hạn hoặc không tồn tại!' });
    }
    if (interaction.user.id !== searchData.userId) {
      return interaction.editReply({ content: '❌ Bạn không phải là người thực hiện tìm kiếm này!' });
    }
    const selectedIndex = parseInt(interaction.values[0]);
    const chosenTrack = searchData.tracks[selectedIndex];

    // FIX LỖI: Lấy player hiện hữu trước, tránh gọi createConnection liên tiếp gây mất đồng bộ Voice State
    let player = client.riffy.players.get(interaction.guild.id);
    if (!player) {
      player = client.riffy.createConnection({
        guildId: interaction.guild.id,
        voiceChannel: searchData.voiceChannelId,
        textChannel: searchData.textChannelId,
        deaf: true
      });
    }

    // LOG THÔNG TIN NODE ĐANG ĐƯỢC CHỌN [1.3.4, 2.2.1]
    console.log("[NODE]", player.node?.name);

    player.requesterId = userId;
    chosenTrack.info.requester = interaction.user;

    // Thêm vào hàng chờ
    player.queue.add(chosenTrack);

    // Xóa tin nhắn bảng chọn tìm kiếm cho gọn kênh chat
    const channel = await client.channels.fetch(searchData.textChannelId).catch(() => null);
    if (channel) {
      const searchMsg = await channel.messages.fetch(searchData.searchMsgId).catch(() => null);
      if (searchMsg) await searchMsg.delete().catch(() => {});
    }

    // Xóa dữ liệu tạm trong bộ nhớ đệm
    tempSearchTracks.delete(interaction.message.id);

    // Chờ kết nối phòng thoại sẵn sàng
    let attempts = 0;
    while (!player.connected && attempts < 20) {
      await new Promise(r => setTimeout(r, 500));
      attempts++;
    }

    if (player.connected) {
      if (!player.playing && !player.paused) {
        // Log thông tin trước khi chạy player.play() cho Search Selector [1.3.4, 2.2.1]
        console.log("[TRACK INFO]", chosenTrack.info);
        console.log("[NODE USED]", player.node?.name);
        try {
          await player.play();
          console.log("[PLAY SUCCESS]");
        } catch (err) {
          console.error("[PLAY FAILED]", err);
        }
        await interaction.editReply({ content: '✅ Bắt đầu phát bài hát đã chọn!' });
      } else {
        await interaction.editReply({ content: `✅ Đã thêm vào hàng chờ: \`${chosenTrack.info.title}\`` });
        if (channel) {
          await channel.send(`✅ Đã thêm vào hàng chờ: \`${chosenTrack.info.title}\``).catch(() => {});
        }
      }
    } else {
      player.destroy();
      await interaction.editReply({ content: '❌ Lỗi kết nối tới phòng thoại!' });
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ============ CHỐNG SPAM TOÀN CỤC CHO TẤT CẢ CÁC LỆNH (M! COOLDOWN 3 GIÂY) ============
  const userId = message.author.id;
  const now = Date.now();
  const cooldownAmount = 3000;
  if (globalCooldowns.has(userId)) {
    const expirationTime = globalCooldowns.get(userId) + cooldownAmount;
    if (now < expirationTime) {
      const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
      return message.reply(`⚠️ Bạn đang thao tác quá nhanh! Vui lòng đợi **${timeLeft} giây**.`);
    }
  }
  globalCooldowns.set(userId, now);
  setTimeout(() => globalCooldowns.delete(userId), cooldownAmount);

  // ============ LỆNH m!mix <số lượng> ============
  // Ví dụ: m!mix 3 -> bot hỏi lần lượt 3 bài/link rồi phát cả 3 cùng lúc.
  if (command === 'mix') {
    const amount = Number.parseInt(args[0], 10);
    if (!Number.isInteger(amount) || amount < 2 || amount > 5) {
      return message.reply('❌ Dùng: `m!mix <số lượng>` với số lượng từ **2 đến 5**. Ví dụ: `m!mix 3`');
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('❌ Bạn cần vào phòng voice trước!');

    const permissions = voiceChannel.permissionsFor(client.user);
    if (!permissions?.has('Connect') || !permissions?.has('Speak')) {
      return message.reply('❌ Bot không có quyền Connect hoặc Speak trong phòng voice này!');
    }

    const publicBaseUrl = getPublicBaseUrl();
    if (!publicBaseUrl) {
      return message.reply('❌ Chưa có URL công khai để Lavalink lấy file mix. Hãy thêm biến môi trường `PUBLIC_URL=https://domain-cua-bot.com` rồi chạy lại bot.');
    }

    const setupEmbed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle(`🎛️ TẠO BẢN MIX ${amount} BÀI`)
      .setDescription([
        `Mình sẽ hỏi lần lượt **${amount} bài**.`,
        'Bạn có thể gửi **tên bài hát** hoặc **link YouTube/TikTok/Facebook/SoundCloud...**.',
        '',
        '📌 Gửi `hủy` bất cứ lúc nào để dừng.'
      ].join('\n'))
      .setFooter({ text: 'Mỗi bài có tối đa 60 giây để nhập.' })
      .setTimestamp();

    await message.reply({ embeds: [setupEmbed] });

    const queries = [];
    for (let index = 1; index <= amount; index++) {
      const promptEmbed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle(`🔎 Bài ${index}/${amount}`)
        .setDescription(`Hãy gửi **tên bài hát thứ ${index}** hoặc **link trực tiếp** để đưa vào bản mix.`)
        .setFooter({ text: `Đã chọn ${queries.length}/${amount} bài` });

      await message.channel.send({ embeds: [promptEmbed] });

      const collected = await message.channel.awaitMessages({
        filter: m => m.author.id === message.author.id && !m.author.bot,
        max: 1,
        time: 60000,
        errors: ['time']
      }).catch(() => null);

      const answer = collected?.first()?.content?.trim();
      if (!answer) {
        return message.channel.send('⌛ Hết thời gian nhập. Đã hủy tạo bản mix.');
      }
      if (answer.toLowerCase() === 'hủy' || answer.toLowerCase() === 'huy' || answer.toLowerCase() === 'cancel') {
        return message.channel.send('🛑 Đã hủy tạo bản mix.');
      }

      // Nếu người dùng gửi link thì nhận thẳng. Nếu gửi tên bài, hiện 5 kết quả để chọn.
      if (isHttpUrl(answer)) {
        queries.push({ query: answer, title: answer });
        await message.channel.send(`✅ Đã nhận link cho bài **${index}/${amount}**.`);
      } else {
        const searchResolve = await client.riffy.resolve({
          query: answer,
          requester: message.author
        }).catch(() => null);

        const searchTracks = searchResolve?.tracks?.slice(0, 5) || [];
        if (searchTracks.length === 0) {
          return message.channel.send(`❌ Không tìm thấy bài nào với từ khóa: \`${answer.slice(0, 150)}\`. Đã hủy bản mix.`);
        }

        const mixSelectId = `mix_select_${message.id}_${index}_${Date.now()}`;
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(mixSelectId)
          .setPlaceholder(`🎵 Chọn bài ${index}/${amount}...`)
          .addOptions(searchTracks.map((track, trackIndex) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`${trackIndex + 1}. ${track.info.title.slice(0, 80)}`)
              .setDescription(`${track.info.author.slice(0, 40)} | ${formatTime(track.info.length)}`)
              .setValue(String(trackIndex))
          ));

        const searchEmbed = new EmbedBuilder()
          .setColor(0x00BFFF)
          .setTitle(`🔍 Kết quả cho bài ${index}/${amount}`)
          .setDescription(searchTracks.map((track, trackIndex) =>
            `**${trackIndex + 1}.** \`${track.info.title.slice(0, 100)}\` — *${track.info.author}*`
          ).join('\n'))
          .setFooter({ text: 'Chọn một bài trong menu bên dưới. Tự hủy sau 60 giây.' });

        const selectMessage = await message.channel.send({
          embeds: [searchEmbed],
          components: [new ActionRowBuilder().addComponents(selectMenu)]
        });

        const selection = await selectMessage.awaitMessageComponent({
          filter: interaction => interaction.user.id === message.author.id && interaction.customId === mixSelectId,
          time: 60000
        }).catch(() => null);

        if (!selection) {
          await selectMessage.edit({ components: [] }).catch(() => {});
          return message.channel.send('⌛ Hết thời gian chọn bài. Đã hủy tạo bản mix.');
        }

        await selection.deferUpdate();
        const chosenTrack = searchTracks[Number.parseInt(selection.values[0], 10)];
        const chosenUrl = chosenTrack?.info?.uri;
        if (!chosenTrack || !chosenUrl) {
          await selectMessage.edit({ components: [] }).catch(() => {});
          return message.channel.send('❌ Không lấy được link của bài đã chọn. Đã hủy bản mix.');
        }

        queries.push({
          query: chosenUrl,
          title: chosenTrack.info.title,
          author: chosenTrack.info.author
        });

        const selectedEmbed = EmbedBuilder.from(searchEmbed)
          .setColor(0x00FF00)
          .setTitle(`✅ Đã chọn bài ${index}/${amount}`)
          .setDescription(`**${chosenTrack.info.title}**\nTác giả: *${chosenTrack.info.author}*`);
        await selectMessage.edit({ embeds: [selectedEmbed], components: [] }).catch(() => {});
      }
    }

    const listEmbed = new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle('🎚️ ĐANG XỬ LÝ BẢN MIX')
      .setDescription(queries.map((item, i) => `**${i + 1}.** \`${item.title.slice(0, 180)}\``).join('\n'))
      .setFooter({ text: 'Đang tải từng bài và ghép bằng FFmpeg...' });
    const statusMessage = await message.channel.send({ embeds: [listEmbed] });

    let generatedOutputPath = null;
    try {
      const mixed = await createMixedAudio(queries.map(item => item.query), message.guild.id);
      generatedOutputPath = mixed.outputPath;
      const mixedUrl = `${publicBaseUrl}/mix/${encodeURIComponent(mixed.outputFileName)}`;

      let player = client.riffy.players.get(message.guild.id);
      if (!player) {
        player = client.riffy.createConnection({
          guildId: message.guild.id,
          voiceChannel: voiceChannel.id,
          textChannel: message.channel.id,
          deaf: true
        });
      }

      player.requesterId = message.author.id;
      const resolve = await client.riffy.resolve({
        query: mixedUrl,
        requester: message.author
      });

      if (!resolve?.tracks?.length) {
        throw new Error('Lavalink không đọc được URL file mix. Kiểm tra PUBLIC_URL và firewall của host.');
      }

      const mixedTrack = resolve.tracks[0];
      mixedTrack.info.requester = message.author;
      mixedTrack.info.title = `Mix ${amount} bài của ${message.author.username}`;
      player.queue.add(mixedTrack);

      let attempts = 0;
      while (!player.connected && attempts < 20) {
        await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
        attempts++;
      }

      if (!player.connected) throw new Error('Không kết nối được phòng voice.');

      if (!player.playing && !player.paused) await player.play();

      const doneEmbed = EmbedBuilder.from(listEmbed)
        .setColor(0x00FF00)
        .setTitle('✅ ĐÃ TẠO XONG BẢN MIX')
        .setDescription(queries.map((item, i) => `**${i + 1}.** \`${item.title.slice(0, 180)}\``).join('\n'))
        .setFooter({ text: player.playing ? 'Bản mix đang phát hoặc đã được thêm vào hàng chờ.' : 'Đã thêm bản mix.' });
      await statusMessage.edit({ embeds: [doneEmbed] });
    } catch (error) {
      console.error('[MIX ERROR]', error);
      if (generatedOutputPath) await fsp.unlink(generatedOutputPath).catch(() => {});
      const errorEmbed = EmbedBuilder.from(listEmbed)
        .setColor(0xFF0000)
        .setTitle('❌ TẠO BẢN MIX THẤT BẠI')
        .setDescription(`Lỗi: \`${String(error.message || error).slice(0, 1500)}\``)
        .setFooter({ text: 'Cần yt-dlp mới + Node.js + FFmpeg + PUBLIC_URL và YOUTUBE_COOKIES_BASE64.' });
      await statusMessage.edit({ embeds: [errorEmbed] }).catch(() => {});
    }
    return;
  }

  // ============ LỆNH m!p <Link hoặc Từ khóa> ============
  if (command === 'p' || command === 'play') {
    const query = args.join(' ');
    if (!query) return message.reply('❌ Vui lòng nhập liên kết hoặc tên bài hát cần phát!');
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('❌ Bạn cần phải tham gia vào một phòng Voice Channel trước!');
    const permissions = voiceChannel.permissionsFor(client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
      return message.reply('❌ Bot không có quyền truy cập hoặc nói chuyện trong phòng voice của bạn!');
    }

    // Cooldown riêng cho lệnh phát nhạc (10 giây)
    const playCooldownAmount = 10000;
    if (playCooldowns.has(userId)) {
      const expirationTime = playCooldowns.get(userId) + playCooldownAmount;
      if (now < expirationTime) {
        const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
        return message.reply(`⚠️ Bạn đang thao tác tìm kiếm nhạc quá nhanh! Vui lòng đợi **${timeLeft} giây**.`);
      }
    }
    playCooldowns.set(userId, now);
    setTimeout(() => playCooldowns.delete(userId), playCooldownAmount);

    // Kích hoạt hiệu ứng đang gõ chữ kín đáo của Discord
    await message.channel.sendTyping().catch(() => {});

    try {
      let finalQuery = query;
      // Nhận diện liên kết để phân phối luồng phát phù hợp
      const isUrl = query.startsWith('http://') || query.startsWith('https://');
      const isYouTube = isUrl && (query.includes('youtube.com') || query.includes('youtu.be'));
      const isSpotify = isUrl && query.includes('spotify.com');

      // SoundCloud bắt buộc chạy qua yt-dlp [5]
      if (isUrl && !isYouTube && !isSpotify) {
        const directUrl = await getDirectAudioUrl(query);
        if (directUrl) {
          finalQuery = directUrl;
        }
      }

      // THÊM ĐOẠN LOG ĐỂ THEO DÕI ĐƯỜNG DẪN KHI RESOLVE [1.3.4]
      console.log("[SOURCE URL]", query);
      console.log("[FINAL QUERY]", finalQuery);

      // FIX LỖI: Lấy player hiện hữu trước, tránh gọi createConnection liên tiếp gây mất đồng bộ Voice State
      let player = client.riffy.players.get(message.guild.id);
      if (!player) {
        player = client.riffy.createConnection({
          guildId: message.guild.id,
          voiceChannel: voiceChannel.id,
          textChannel: message.channel.id,
          deaf: true
        });
      }

      // LOG THÔNG TIN NODE ĐANG ĐƯỢC CHỌN [1.3.4, 2.2.1]
      console.log("[NODE]", player.node?.name);

      player.requesterId = message.author.id;

      // PHÂN TÍCH LIÊN KẾT NHẠC KÈM HÀM LOG CHI TIẾT KHI GẶP LỖI [1.3.4, 2.2.1]
      const resolve = await client.riffy.resolve({
        query: finalQuery,
        requester: message.author
      }).catch(err => {
        console.error("[LAVALINK RESOLVE FAILED]");
        console.error({
          node: player.node?.name,
          query: finalQuery,
          error: err
        });
        return null;
      });
    
      // LOG KẾT QUẢ RESOLVE ĐẦY ĐỦ VÀ THÔNG SỐ LOADTYPE [1.3.4]
      console.log("[RESOLVE]", JSON.stringify(resolve, null, 2));
      console.log("[LOADTYPE]", resolve?.loadType);
      console.log("[TRACK COUNT]", resolve?.tracks?.length);

      if (!resolve || !resolve.tracks || resolve.tracks.length === 0) {
        player.destroy();
        return message.reply('❌ Không tìm thấy bài hát hoặc lỗi kết nối máy chủ giải mã!');
      }

      const { loadType, tracks, playlistInfo } = resolve;

      // ---------------- PHÂN LOẠI A: PLAYLIST DANH SÁCH ----------------
      if (loadType === 'playlist') {
        // VÁ LỖI: Nếu bot đang rảnh rỗi, dọn dẹp hàng chờ bị kẹt trước khi nạp Playlist mới [2.2.1]
        if (!player.playing && !player.paused) {
          player.queue.clear();
        }
        for (const track of tracks) {
          track.info.requester = message.author;
          player.queue.add(track);
        }
        let attempts = 0;
        while (!player.connected && attempts < 20) {
          await new Promise(r => setTimeout(r, 500));
          attempts++;
        }
        if (player.connected) {
          if (!player.playing && !player.paused) {
            // Log thông tin trước khi chạy player.play() cho Playlist [1.3.4, 2.2.1]
            const firstTrack = tracks[0];
            if (firstTrack) {
              console.log("[TRACK INFO]", firstTrack.info);
            }
            console.log("[NODE USED]", player.node?.name);
            try {
              await player.play();
              console.log("[PLAY SUCCESS]");
            } catch (err) {
              console.error("[PLAY FAILED]", err);
            }
          } else {
            return message.reply(`✅ Đã thêm danh sách phát **${playlistInfo.name}** (${tracks.length} bài) vào hàng chờ!`);
          }
        } else {
          player.destroy();
          return message.reply('❌ Kết nối tới phòng thoại thất bại do đường truyền Discord quá tải!');
        }
      }
      // ---------------- PHÂN LOẠI B: TÌM KIẾM TRÊN YOUTUBE MUSIC ----------------
      else if (loadType === 'search') {
        const topTracks = tracks.slice(0, 5); // Lấy 5 kết quả tốt nhất
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('search_select')
          .setPlaceholder('🎵 | Chọn bài hát bạn muốn phát...')
          .addOptions(
            topTracks.map((t, index) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`${index + 1}. ${t.info.title.slice(0, 80)}`)
                .setDescription(`Tác giả: ${t.info.author.slice(0, 40)} | Thời lượng: ${formatTime(t.info.length)}`)
                .setValue(`${index}`)
            )
          );
        const row = new ActionRowBuilder().addComponents(selectMenu);
        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('🔍 KẾT QUẢ TÌM KIẾM')
          .setDescription(topTracks.map((t, index) => `**${index + 1}.** \`${t.info.title}\` - *${t.info.author}*`).join('\n'))
          .setFooter({ text: 'Chọn bài hát bên dưới để phát. Bảng chọn tự hủy sau 1 phút.' })
          .setTimestamp();
        const searchMsg = await message.reply({ embeds: [embed], components: [row] });
        // Sử dụng ID tin nhắn làm khóa thay vì ID tài khoản người dùng để tránh ghi đè lỗi phát lộn bài
        tempSearchTracks.set(searchMsg.id, {
          tracks: topTracks,
          voiceChannelId: voiceChannel.id,
          textChannelId: message.channel.id,
          searchMsgId: searchMsg.id,
          userId: message.author.id // Lưu thêm ID người gọi lệnh để đối chiếu
        });
        setTimeout(() => {
          if (tempSearchTracks.has(searchMsg.id)) {
            tempSearchTracks.delete(searchMsg.id);
            searchMsg.delete().catch(() => {});
          }
        }, 60000);
      }
      // ---------------- PHÂN LOẠI C: PHÁT TRỰC TIẾP LINK DUY NHẤT ----------------
      else if (loadType === 'track') {
        // VÁ LỖI: Nếu bot đang rảnh rỗi, dọn dẹp hàng chờ bị kẹt trước khi nạp bài mới [2.2.1]
        if (!player.playing && !player.paused) {
          player.queue.clear();
        }
        const track = tracks.shift();
        track.info.requester = message.author;
        player.queue.add(track);
        let attempts = 0;
        while (!player.connected && attempts < 20) {
          await new Promise(r => setTimeout(r, 500));
          attempts++;
        }
        if (player.connected) {
          if (!player.playing && !player.paused) {
            // Log thông tin trước khi chạy player.play() cho Track [1.3.4, 2.2.1]
            console.log("[TRACK INFO]", track.info);
            console.log("[NODE USED]", player.node?.name);
            try {
              await player.play();
              console.log("[PLAY SUCCESS]");
            } catch (err) {
              console.error("[PLAY FAILED]", err);
            }
          } else {
            return message.reply(`✅ Đã thêm vào hàng chờ: \`${track.info.title}\``);
          }
        } else {
          player.destroy();
          return message.reply('❌ Kết nối tới phòng thoại thất bại do đường truyền Discord quá tải!');
        }
      }
      else {
        player.destroy();
        return message.reply('❌ Định dạng liên kết không khả dụng!');
      }
    } catch (error) {
      console.error(error);
      await message.reply(`❌ Lỗi kết nối luồng phát: ${error.message}`);
    }
  }

  // ============ LỆNH m!leave (Tắt nhạc & Rời phòng) ============
  if (command === 'leave' || command === 'stop') {
    const player = getActivePlayer(message.guild.id);
    if (!player) {
      return message.reply('❌ Bot hiện tại đang không kết nối phòng thoại!');
    }
    const requesterId = player.requesterId;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);
    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người yêu cầu phát nhạc** (<@${requesterId}>) hoặc **Quản trị viên** mới được dừng nhạc!`);
    }
    if (player.player.progressInterval) clearInterval(player.player.progressInterval); // Hủy bộ đếm thời gian dính
    player.player.destroy();
    await message.reply('👋 Đã dừng nhạc và rời khỏi phòng voice theo yêu cầu.');
  }

  // ============ LỆNH m!skip ============
  if (command === 'skip' || command === 's') {
    const player = getActivePlayer(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');
    const requesterId = player.requesterId;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);
    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người phát nhạc** (<@${requesterId}>) hoặc **Quản trị viên** mới được bỏ qua bài!`);
    }
    player.player.stop();
    await message.reply('⏭️ Đã bỏ qua bài hát hiện tại.');
  }

  // ============ LỆNH m!pause ============
  if (command === 'pause') {
    const player = getActivePlayer(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');
    player.player.pause(true);
    await message.reply('⏸️ Đã tạm dừng phát nhạc.');
  }

  // ============ LỆNH m!resume ============
  if (command === 'resume') {
    const player = getActivePlayer(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');
    player.player.pause(false);
    await message.reply('▶️ Tiếp tục phát nhạc.');
  }

  // ============ LỆNH m!queue (Xem danh sách chờ) ============
  if (command === 'queue' || command === 'q') {
    const player = getActivePlayer(message.guild.id);
    if (!player || player.player.queue.length === 0) return message.reply('❌ Danh sách hàng chờ hiện tại đang trống!');
    const queueList = player.player.queue.map((track, index) => `**#${index + 1}** | \`${track.info.title}\``).slice(0, 10).join('\n');
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('📋 DANH SÁCH CHỜ PHÁT (Tối đa 10 bài)')
      .setDescription(queueList)
      .setTimestamp();
    await message.reply({ embeds: [embed] });
  }

  // ============ LỆNH m!volume ============
  if (command === 'volume' || command === 'vol') {
    const player = getActivePlayer(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');
    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 1 || vol > 100) return message.reply('❌ Âm lượng hợp lệ phải nằm trong khoảng từ 1 đến 100!');
    player.player.setVolume(vol);
    await message.reply(`🔊 Đã thiết lập âm lượng thành: **${vol}%**`);
  }

  // ============ LỆNH m!repeat / m!loop (Chế độ phát lặp lại) ============
  if (command === 'repeat' || command === 'loop') {
    const player = getActivePlayer(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');
    const currentLoop = player.player.loop;
    let newLoop = "none";
    let statusText = "TẮT";
    if (currentLoop === "none") {
      newLoop = "track";
      statusText = "LẶP LẠI BÀI HÁT ĐANG PHÁT 🔂";
    } else if (currentLoop === "track") {
      newLoop = "queue";
      statusText = "LẶP LẠI TOÀN BỘ HÀNG CHỜ 🔁";
    } else {
      newLoop = "none";
      statusText = "TẮT LẶP LẠI ❌";
    }
    player.player.setLoop(newLoop);
    await message.reply(`✅ Đã thiết lập chế độ lặp nhạc thành: **${statusText}**`);
  }
});

// TRÌNH BẮT LỖI TOÀN CỤC CHỐNG SẬP BOT
process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));

client.login(process.env.DISCORD_TOKEN);
