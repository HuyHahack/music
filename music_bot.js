const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { Riffy } = require('riffy');
require('dotenv/config');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, // Bắt buộc để nhận diện người dùng ra vào phòng voice [1.1.5]
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
  defaultSearchPlatform: "ytmsearch", // Tìm kiếm mặc định trên Youtube Music
  restVersion: "v4" // Sử dụng chuẩn Rest API v4 của Lavalink
});

// Bộ nhớ đệm quản lý thời gian chờ (cooldown) cho lệnh phát nhạc (10 giây)
const playCooldowns = new Map();

client.once('ready', () => {
  // Khởi chạy kết nối tới hệ thống máy chủ Lavalink
  client.riffy.init(client.user.id);
  console.log(`\n🎵 Bot phát nhạc Lavalink đã trực tuyến: ${client.user.tag}`);
});

// Sự kiện: Kết nối thành công tới Lavalink Node
client.riffy.on("nodeConnect", (node) => {
  console.log(`✅ Kết nối thành công tới Lavalink Node: "${node.name}"`);
});

// Sự kiện: Node gặp sự cố
client.riffy.on("nodeError", (node, error) => {
  console.error(`❌ Máy chủ Lavalink "${node.name}" gặp lỗi:`, error.message);
});

// Sự kiện: Bắt đầu phát bài nhạc mới
client.riffy.on("trackStart", async (player, track) => {
  const channel = client.channels.cache.get(player.textChannel);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🎵 BẮT ĐẦU PHÁT NHẠC (LAVALINK)')
      .setDescription(`**Tác phẩm:** \`${track.info.title}\`\n**Tác giả:** \`${track.info.author}\`\n**Yêu cầu bởi:** <@${track.info.requester.id}>`)
      .setTimestamp();
    channel.send({ embeds: [embed] }).catch(() => {});
  }
});

// Sự kiện: Hết hàng chờ nhạc
client.riffy.on("queueEnd", async (player) => {
  const channel = client.channels.cache.get(player.textChannel);
  player.destroy(); // Ngắt kết nối phòng thoại
  if (channel) {
    channel.send("👋 Danh sách phát đã kết thúc. Bot đã rời phòng thoại.").catch(() => {});
  }
});

// Đọc dữ liệu thô từ Discord Gateway để cập nhật trạng thái voice cho Lavalink
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
      return message.reply('❌ Bot không có quyền kết nối hoặc nói chuyện trong phòng voice của bạn!');
    }

    // Cooldown check chống spam tìm kiếm
    const userId = message.author.id;
    const now = Date.now();
    const cooldownAmount = 10 * 1000; // 10 giây
    if (playCooldowns.has(userId)) {
      const expirationTime = playCooldowns.get(userId) + cooldownAmount;
      if (now < expirationTime) {
        const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
        return message.reply(`⚠️ Bạn đang thao tác quá nhanh! Vui lòng đợi **${timeLeft} giây**.`);
      }
    }
    playCooldowns.set(userId, now);
    setTimeout(() => playCooldowns.delete(userId), cooldownAmount);

    const replyMsg = await message.reply('🔄 Đang gửi truy vấn tìm kiếm tới hệ thống Lavalink...');

    try {
      // Khởi tạo player kết nối qua Lavalink
      const player = client.riffy.createConnection({
        guildId: message.guild.id,
        voiceChannel: voiceChannel.id,
        textChannel: message.channel.id,
        deaf: true
      });

      // Lưu trữ ID người phát để phục vụ phân quyền m!leave
      player.requesterId = message.author.id;

      // Tìm kiếm hoặc giải mã liên kết từ bất cứ nguồn nào (YouTube, Soundcloud, Spotify...)
      const resolve = await client.riffy.resolve({ query: query, requester: message.author });
      const { loadType, tracks, playlistInfo } = resolve;

      if (loadType === 'playlist') {
        for (const track of tracks) {
          track.info.requester = message.author;
          player.queue.add(track);
        }
        await replyMsg.edit(`✅ Đã thêm danh sách phát **${playlistInfo.name}** (${tracks.length} bài hát) vào danh sách chờ!`);
        if (!player.playing && !player.paused) return player.play();
      } 
      else if (loadType === 'search' || loadType === 'track') {
        const track = tracks.shift();
        track.info.requester = message.author;
        player.queue.add(track);
        await replyMsg.edit(`✅ Đã thêm vào hàng chờ: \`${track.info.title}\``);
        if (!player.playing && !player.paused) return player.play();
      } 
      else {
        player.destroy();
        return replyMsg.edit('❌ Không tìm thấy bài hát hoặc liên kết không hợp lệ!');
      }

    } catch (error) {
      console.error(error);
      await replyMsg.edit(`❌ Gặp sự cố kết nối Lavalink: ${error.message}`);
    }
  }

  // ============ LỆNH m!leave ============
  if (command === 'leave' || command === 'stop') {
    const player = client.riffy.players.get(message.guild.id);

    if (!player) {
      return message.reply('❌ Bot hiện tại đang không kết nối phòng thoại hoặc đang không phát nhạc!');
    }

    const requesterId = player.requesterId;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người yêu cầu phát nhạc** (<@${requesterId}>) hoặc **Quản trị viên** mới được quyền dừng nhạc!`);
    }

    if (player) {
      player.stop();
      queue.delete(message.guild.id);
    }
    player.destroy();
    await message.reply('👋 Đã dừng phát nhạc và rời khỏi phòng voice theo yêu cầu.');
  }
});

process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));

client.login(process.env.DISCORD_TOKEN);
