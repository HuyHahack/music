const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { Riffy } = require('riffy');
const exec = require('util').promisify(require('child_process').exec);
require('dotenv/config');

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

// Hàm trích xuất liên kết âm thanh trực tiếp bằng yt-dlp cho các nền tảng ngoài (TikTok, Facebook...)
async function getDirectAudioUrl(url) {
  try {
    const { stdout } = await exec(`yt-dlp -f bestaudio -g "${url}"`);
    return stdout.trim().split('\n')[0];
  } catch (err) {
    return null; // Trả về null nếu hệ thống không cài đặt yt-dlp hoặc gặp lỗi
  }
}

client.once('ready', () => {
  client.riffy.init(client.user.id);
  console.log(`\n🎵 Bot phát nhạc Lavalink đã trực tuyến: ${client.user.tag}`);
});

// Sự kiện: Bắt đầu phát bài nhạc mới (Tối giản chữ thừa theo yêu cầu)
client.riffy.on("trackStart", async (player, track) => {
  const channel = client.channels.cache.get(player.textChannel);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🎵 Đang phát nhạc')
      .setDescription(`**Tác phẩm:** \`${track.info.title}\`\n**Yêu cầu bởi:** <@${track.info.requester.id}>`)
      .setTimestamp();
    channel.send({ embeds: [embed] }).catch(() => {});
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

    // Cooldown chống spam tìm kiếm
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

    const replyMsg = await message.reply('🔄 Đang xử lý yêu cầu...');

    try {
      let finalQuery = query;

      // Xử lý các liên kết ngoài đặc biệt (như TikTok) bằng yt-dlp trước khi chuyển qua Lavalink [5]
      if (query.startsWith('http://') || query.startsWith('https://')) {
        if (!query.includes('youtube.com') && !query.includes('youtu.be') && !query.includes('soundcloud.com') && !query.includes('spotify.com')) {
          const directUrl = await getDirectAudioUrl(query);
          if (directUrl) {
            finalQuery = directUrl; // Chuyển đổi thành link luồng âm thanh trực tiếp
          }
        }
      }

      const player = client.riffy.createConnection({
        guildId: message.guild.id,
        voiceChannel: voiceChannel.id,
        textChannel: message.channel.id,
        deaf: true
      });

      player.requesterId = message.author.id;

      const resolve = await client.riffy.resolve({ query: finalQuery, requester: message.author });
      const { loadType, tracks, playlistInfo } = resolve;

      if (loadType === 'playlist') {
        for (const track of tracks) {
          track.info.requester = message.author;
          player.queue.add(track);
        }
        await replyMsg.delete().catch(() => {}); // Xóa tin nhắn rác "Đang xử lý"
        if (!player.playing && !player.paused) return player.play();
      } 
      else if (loadType === 'search' || loadType === 'track') {
        const track = tracks.shift();
        track.info.requester = message.author;
        player.queue.add(track);
        await replyMsg.delete().catch(() => {}); // Xóa tin nhắn rác "Đang xử lý"
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

  // ============ LỆNH m!leave (Tắt nhạc & Rời phòng) ============
  if (command === 'leave' || command === 'stop') {
    const player = client.riffy.players.get(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không kết nối phòng thoại!');

    const requesterId = player.requesterId;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người yêu cầu phát nhạc** (<@${requesterId}>) hoặc **Quản trị viên** mới được dừng nhạc!`);
    }

    player.destroy();
    await message.reply('👋 Đã dừng phát nhạc và rời khỏi phòng voice theo yêu cầu.');
  }

  // ============ LỆNH m!skip (Bỏ qua bài hát) ============
  if (command === 'skip' || command === 's') {
    const player = client.riffy.players.get(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');

    const requesterId = player.requesterId;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người yêu cầu phát nhạc** (<@${requesterId}>) hoặc **Quản trị viên** mới được bỏ qua bài!`);
    }

    player.stop();
    await message.reply('⏭️ Đã bỏ qua bài hát hiện tại.');
  }

  // ============ LỆNH m!pause (Tạm dừng) ============
  if (command === 'pause') {
    const player = client.riffy.players.get(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');
    player.pause(true);
    await message.reply('⏸️ Đã tạm dừng phát nhạc.');
  }

  // ============ LỆNH m!resume (Tiếp tục phát) ============
  if (command === 'resume') {
    const player = client.riffy.players.get(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');
    player.pause(false);
    await message.reply('▶️ Tiếp tục phát nhạc.');
  }

  // ============ LỆNH m!queue (Xem danh sách chờ) ============
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

  // ============ LỆNH m!volume (Chỉnh âm lượng) ============
  if (command === 'volume' || command === 'vol') {
    const player = client.riffy.players.get(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');

    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 1 || vol > 100) return message.reply('❌ Âm lượng hợp lệ phải nằm trong khoảng từ 1 đến 100!');

    player.setVolume(vol);
    await message.reply(`🔊 Đã thiết lập âm lượng thành: **${vol}%**`);
  }
});

process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));

client.login(process.env.DISCORD_TOKEN);
