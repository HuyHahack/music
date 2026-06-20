const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { Riffy } = require('riffy');
const express = require('express'); // Bổ sung Express
const exec = require('util').promisify(require('child_process').exec);
require('dotenv/config');

// ============ EXPRESS SERVER (Bổ sung cho Render scan cổng) ============
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

// Cấu hình máy chủ Lavalink v4 công cộng miễn phí (Hỗ trợ SSL)
const nodes = [
  {
    host: "lavalinkv4.serenetia.com",
    port: 443,
    password: "https://dsc.gg/ajidevserver",
    secure: true
  }
];

client.riffy = new Riffy(client, nodes, {
  send: (payload) => {
    const guild = client.guilds.cache.get(payload.d.guild_id);
    if (guild) guild.shard.send(payload);
  },
  defaultSearchPlatform: "ytmsearch",
  restVersion: "v4"
});

// Bộ đếm thời gian chờ tìm kiếm tránh spam lệnh
const playCooldowns = new Map();

// Hàm trích xuất liên kết âm thanh trực tiếp bằng yt-dlp cho các nền tảng ngoài (TikTok, Facebook, SoundCloud...)
async function getDirectAudioUrl(url) {
  try {
    const { stdout } = await exec(`yt-dlp -f bestaudio -g "${url}"`);
    return stdout.trim().split('\n')[0];
  } catch (err) {
    console.error('⚠️ yt-dlp gặp sự cố khi giải mã liên kết:', err.message);
    return null;
  }
}

client.once('ready', () => {
  client.riffy.init(client.user.id);
  console.log(`\n🎵 Bot phát nhạc Lavalink đã trực tuyến: ${client.user.tag}`);
});

// Sự kiện: Bắt đầu phát bài nhạc mới (Tối giản hoàn toàn chữ thừa)
client.riffy.on("trackStart", async (player, track) => {
  const channel = client.channels.cache.get(player.textChannel);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🎵 Đang phát nhạc')
      .setDescription(`**Tác phẩm:** \`${track.info.title}\`\n**Yêu cầu bởi:** <@${player.requesterId}>`)
      .setFooter({ text: 'Chỉ người yêu cầu hoặc Admin mới có quyền sử dụng m!leave' })
      .setTimestamp();
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
});

// Sự kiện: Hết danh sách chờ nhạc
client.riffy.on("queueEnd", async (player) => {
  const channel = client.channels.cache.get(player.textChannel);
  player.destroy();
  if (channel) {
    channel.send("👋 Danh sách phát đã kết thúc. Bot đã rời phòng thoại.").catch(() => {});
  }
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

    // Gửi tín hiệu giả vờ đang gõ chữ thay vì hiện tin nhắn rác cản trở giao diện
    await message.channel.sendTyping().catch(() => {});

    try {
      let streamUrl = null;
      let finalQuery = query;

      // Nhận diện liên kết ngoài và phân phối luồng xử lý phù hợp
      if (query.startsWith('http://') || query.startsWith('https://')) {
        if (query.includes('youtube.com') || query.includes('youtu.be') || query.includes('spotify.com')) {
          finalQuery = query;
        } else {
          // SoundCloud, TikTok, Facebook... chuyển qua yt-dlp nội bộ để lấy link trực tiếp
          const directUrl = await getDirectAudioUrl(query);
          if (directUrl) {
            finalQuery = directUrl;
          } else {
            finalQuery = query;
          }
        }
      }

      // Khởi tạo player kết nối qua Lavalink
      const player = client.riffy.createConnection({
        guildId: message.guild.id,
        voiceChannel: voiceChannel.id,
        textChannel: message.channel.id,
        deaf: true
      });

      player.requesterId = message.author.id;

      // Phân tích liên kết nhạc qua Lavalink (Bọc catch để tránh sập bot)
      const resolve = await client.riffy.resolve({ query: finalQuery, requester: message.author }).catch(() => null);
      
      if (!resolve || !resolve.tracks || resolve.tracks.length === 0) {
        player.destroy();
        return message.reply('❌ Không tìm thấy bài hát hoặc lỗi kết nối máy chủ giải mã!');
      }

      const { loadType, tracks, playlistInfo } = resolve;

      if (loadType === 'playlist') {
        for (const track of tracks) {
          track.info.requester = message.author;
          player.queue.add(track);
        }

        // --- BỘ LỌC CHỜ KẾT NỐI HOÀN TẤT TRƯỚC KHI PHÁT ---
        const now = Date.now();
        let connectionReady = false;
        
        const inKey = `${interaction.guild.id}_${productType}`;
        
        // Hẹn giờ chờ cổng kết nối Voice sẵn sàng
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

        // --- BỘ LỌC CHỜ KẾT NỐI HOÀN TẤT TRƯỚC KHI PHÁT ---
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
    if (!player) return message.reply('❌ Bot hiện tại không có trong phòng thoại hoặc đang không phát nhạc!');

    const requesterId = player.requesterId;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người phát bài hát hiện tại** (<@${requesterId}>) hoặc **Quản trị viên** mới được quyền dừng nhạc!`);
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

  // ============ LỆNH m!queue ============
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
