const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { Riffy } = require('riffy');
const express = require('express');
const execAsync = require('util').promisify(require('child_process').exec);
require('dotenv/config');

// ============ EXPRESS SERVER ============
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.json({ status: 'online' }));
app.get('/health', (req, res) => res.status(200).send('OK'));
const PORT = process.env.PORT || 3000;
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

// Cấu hình cụm máy chủ Lavalink v4 công cộng cho YouTube & SoundCloud (Tự động Load Balancing) [2.2.1]
const nodes = [
  {
    name: "AjieBlogs EU",
    host: "lava-v4.ajieblogs.eu.org",
    port: 443,
    password: "https://dsc.gg/ajidevserver",
    secure: true
  },
  {
    name: "Serenetia v4",
    host: "lavalinkv4.serenetia.com",
    port: 443,
    password: "https://dsc.gg/ajidevserver",
    secure: true
  },
  {
    name: "HeavenCloud",
    host: "89.106.84.59",
    port: 4000,
    password: "heavencloud.in",
    secure: false
  }
];

client.riffy = new Riffy(client, nodes, {
  send: (payload) => {
    const guild = client.guilds.cache.get(payload.d.guild_id);
    if (guild) guild.shard.send(payload);
  },
  defaultSearchPlatform: "ytmsearch",
  restVersion: "v4",
  bypassChecks: {
    nodeFetchInfo: true
  }
});

// Bộ đếm thời gian chờ tránh spam toàn bộ các lệnh m!
const globalCooldowns = new Map();

// Hàm trích xuất liên kết âm thanh trực tiếp bằng yt-dlp cho các nền tảng ngoài (TikTok, Facebook...)
async function getDirectAudioUrl(url) {
  console.log(`\n[yt-dlp] 🌐 Đang trích xuất Direct URL cho liên kết: ${url}`);
  try {
    const { stdout } = await execAsync(`yt-dlp -f "bestaudio[protocol^=http]/bestaudio" -g "${url}"`);
    const directUrl = stdout.trim().split('\n')[0];
    console.log(`[yt-dlp] ✅ Đã lấy được Direct URL tĩnh thành công.`);
    return directUrl;
  } catch (err) {
    console.error('⚠️ Lỗi trích xuất yt-dlp:', err.message);
    return null;
  }
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

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🎵 Đang phát nhạc')
      .setDescription(`**Tác phẩm:** \`${title}\`\n**Yêu cầu bởi:** <@${track.info.requester.id}>`)
      .setFooter({ text: 'Chỉ người yêu cầu hoặc Admin mới có quyền sử dụng m!leave' })
      .setTimestamp();
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
});

// Sự kiện: Hết danh sách chờ nhạc của Lavalink
client.riffy.on("queueEnd", async (player) => {
  const channel = client.channels.cache.get(player.textChannel);
  player.destroy();
  if (channel) {
    channel.send("👋 Danh sách phát đã kết thúc. Bot đã rời phòng thoại.").catch(() => {});
  }
});

// Sự kiện: Đăng ký bắt lỗi luồng phát Lavalink tránh sập Bot [1.3.4, 2.2.1]
client.riffy.on("playerError", (player, track, error) => {
  console.error(`❌ Lỗi luồng phát tại Server ${player.guildId}:`, error.message);
});

client.riffy.on("nodeError", (node, error) => {
  console.error(`❌ Lỗi máy chủ Lavalink "${node.name}":`, error.message);
});

// Trích xuất dữ liệu Gateway cập nhật Voice State cho Lavalink
client.on("raw", (d) => {
  if (!["VOICE_STATE_UPDATE", "VOICE_SERVER_UPDATE"].includes(d.t)) return;
  client.riffy.updateVoiceState(d);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ============ CHỐNG SPAM TOÀN CỤC CHO TẤT CẢ CÁC LỆNH (M! COOLDOWN) ============
  const userId = message.author.id;
  const now = Date.now();
  const cooldownAmount = 5000; // Thời gian giãn cách giữa các lệnh là 5 giây

  if (globalCooldowns.has(userId)) {
    const expirationTime = globalCooldowns.get(userId) + cooldownAmount;
    if (now < expirationTime) {
      const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
      return message.reply(`⚠️ Bạn đang thao tác quá nhanh! Vui lòng đợi **${timeLeft} giây** để tiếp tục sử dụng lệnh.`);
    }
  }
  globalCooldowns.set(userId, now);
  setTimeout(() => globalCooldowns.delete(userId), cooldownAmount);

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

    // Bật hiệu ứng đang gõ chữ kín đáo của Discord [1.2.6]
    await message.channel.sendTyping().catch(() => {});

    try {
      let finalQuery = query;

      // Nhận diện liên kết để phân phối luồng phát phù hợp
      const isUrl = query.startsWith('http://') || query.startsWith('https://');
      const isYouTube = isUrl && (query.includes('youtube.com') || query.includes('youtu.be'));
      const isSoundCloud = isUrl && query.includes('soundcloud.com');
      const isSpotify = isUrl && query.includes('spotify.com');

      // CHỈ dùng yt-dlp cho các liên kết ngoài thực sự (như TikTok, Facebook...) không được Lavalink hỗ trợ mặc định [5]
      if (isUrl && !isYouTube && !isSoundCloud && !isSpotify) {
        const directUrl = await getDirectAudioUrl(query);
        if (directUrl) {
          finalQuery = directUrl; // Gửi link âm thanh tĩnh này cho Lavalink giải mã từ xa!
        }
      }

      // Khởi tạo và liên kết Player Lavalink
      const player = client.riffy.createConnection({
        guildId: message.guild.id,
        voiceChannel: voiceChannel.id,
        textChannel: message.channel.id,
        deaf: true
      });

      player.requesterId = message.author.id;

      // Phân tích liên kết nhạc qua Lavalink (Bọc catch để tránh sập bot) [1.3.4]
      const resolve = await client.riffy.resolve({ query: finalQuery, requester: message.author }).catch(() => null);
      
      if (!resolve || !resolve.tracks || resolve.tracks.length === 0) {
        player.destroy();
        return message.reply('❌ Không tìm thấy bài hát hoặc lỗi kết nối máy chủ giải mã!');
      }

      const { loadType, tracks } = resolve;

      if (loadType === 'playlist') {
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
          if (!player.playing && !player.paused) return player.play();
        } else {
          player.destroy();
          return message.reply('❌ Kết nối tới phòng thoại thất bại do đường truyền Discord quá tải!');
        }
      } 
      else if (loadType === 'search' || loadType === 'track') {
        const track = tracks.shift();
        track.info.requester = message.author;
        player.queue.add(track);

        let attempts = 0;
        while (!player.connected && attempts < 20) {
          await new Promise(r => setTimeout(r, 500));
          attempts++;
        }

        if (player.connected) {
          if (!player.playing && !player.paused) return player.play();
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

  // ============ LỆNH m!leave ============
  if (command === 'leave' || command === 'stop') {
    const player = client.riffy.players.get(message.guild.id);

    if (!player) {
      return message.reply('❌ Bot hiện tại đang không kết nối phòng thoại!');
    }

    const requesterId = player.requesterId;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người yêu cầu phát nhạc** (<@${requesterId}>) hoặc **Quản trị viên** mới được dừng nhạc!`);
    }

    player.destroy();
    await message.reply('👋 Đã dừng nhạc và rời khỏi phòng voice theo yêu cầu.');
  }

  // ============ LỆNH m!skip ============
  if (command === 'skip' || command === 's') {
    const player = client.riffy.players.get(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');

    const requesterId = player.requesterId;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người phát nhạc** (<@${requesterId}>) hoặc **Quản trị viên** mới được bỏ qua bài!`);
    }

    player.stop();
    await message.reply('⏭️ Đã bỏ qua bài hát hiện tại.');
  }

  // ============ LỆNH m!pause ============
  if (command === 'pause') {
    const player = client.riffy.players.get(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');
    player.pause(true);
    await message.reply('⏸️ Đã tạm dừng phát nhạc.');
  }

  // ============ LỆNH m!resume ============
  if (command === 'resume') {
    const player = client.riffy.players.get(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');
    player.pause(false);
    await message.reply('▶️ Tiếp tục phát nhạc.');
  }

  // ============ LỆNH m!queue (Xem danh sách chờ - Chỉ khả dụng khi dùng Lavalink) ============
  if (command === 'queue' || command === 'q') {
    const player = client.riffy.players.get(message.guild.id);
    if (!player || player.queue.length === 0) return message.reply('❌ Danh sách hàng chờ hiện tại đang trống!');

    const queueList = player.queue.map((track, index) => `**#${index + 1}** | \`${track.info.title}\``).slice(0, 10).join('\n');
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('📋 DANH SÁCH CHỜ PHÁT (Tối đa 10 bài)')
      .setDescription(queueList)
      .setTimestamp();
    await message.reply({ embeds: [embed] });
  }

  // ============ LỆNH m!volume ============
  if (command === 'volume' || command === 'vol') {
    const player = client.riffy.players.get(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');

    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 1 || vol > 100) return message.reply('❌ Âm lượng hợp lệ phải nằm trong khoảng từ 1 đến 100!');

    player.setVolume(vol);
    await message.reply(`🔊 Đã thiết lập âm lượng thành: **${vol}%**`);
  }
});

// TRÌNH BẮT LỖI TOÀN CỤC CHỐNG SẬP BOT
process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));

client.login(process.env.DISCORD_TOKEN);
