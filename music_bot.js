const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const play = require('play-dl');
const exec = require('util').promisify(require('child_process').exec);
require('dotenv/config');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates // Bắt buộc phải có intent này để đọc trạng thái phòng thoại
  ]
});

const PREFIX = 'm!';
const queue = new Map(); // Lưu vết trạng thái: Key là guildId, Value là { connection, player, requesterId, title, url }

// Hàm phân tích và trích xuất link âm thanh trực tiếp cho TikTok và các trang web khác bằng yt-dlp
async function getDirectAudioUrl(url) {
  try {
    const { stdout } = await exec(`yt-dlp -f bestaudio -g "${url}"`);
    return stdout.trim().split('\n')[0];
  } catch (err) {
    console.error('⚠️ yt-dlp không khả dụng hoặc gặp lỗi giải mã:', err.message);
    return null;
  }
}

client.once('ready', async () => {
  console.log(`\n🎵 Bot phát nhạc đã sẵn sàng: ${client.user.tag}`);

  // TỰ ĐỘNG NẠP YOUTUBE COOKIE VÀ GIẢ LẬP TRÌNH DUYỆT CHỐNG CHẶN 429
  if (process.env.YOUTUBE_COOKIE) {
    try {
      await play.setToken({
        youtube: {
          cookie: process.env.YOUTUBE_COOKIE.trim()
        },
        useragent: [
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        ]
      });
      console.log('✅ Đã nạp thành công YouTube Cookie và User-Agent để bypass lỗi chặn 429!');
    } catch (err) {
      console.error('❌ Lỗi khi nạp cấu hình YouTube Cookie:', err.message);
    }
  } else {
    console.log('⚠️ Cảnh báo: Chưa cấu hình biến môi trường YOUTUBE_COOKIE trên Render.');
  }
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

    const replyMsg = await message.reply('🔄 Đang xử lý giải mã liên kết âm thanh...');

    try {
      let streamUrl = null;
      let title = "Đang phát nhạc";
      let inputType = null;
      let stream = null;

      // Kiểm tra nếu là một liên kết ngoài
      if (query.startsWith('http://') || query.startsWith('https://')) {
        if (query.includes('youtube.com') || query.includes('youtu.be') || query.includes('soundcloud.com') || query.includes('spotify.com')) {
          const streamInfo = await play.stream(query);
          stream = streamInfo.stream;
          inputType = streamInfo.type;
          title = query;
        } else {
          streamUrl = await getDirectAudioUrl(query);
          if (!streamUrl) {
            return replyMsg.edit('❌ Định dạng liên kết ngoài này chưa được hỗ trợ hoặc không thể trích xuất âm thanh!');
          }
          title = `Liên kết ngoài (${new URL(query).hostname})`;
        }
      } else {
        const yt_info = await play.search(query, { limit: 1 });
        if (yt_info.length === 0) return replyMsg.edit('❌ Không tìm thấy bài hát nào khớp với từ khóa!');
        const streamInfo = await play.stream(yt_info[0].url);
        stream = streamInfo.stream;
        inputType = streamInfo.type;
        title = yt_info[0].title;
      }

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      const player = createAudioPlayer();
      
      let resource;
      if (stream) {
        resource = createAudioResource(stream, { inputType });
      } else {
        resource = createAudioResource(streamUrl);
      }

      player.play(resource);
      connection.subscribe(player);

      queue.set(message.guild.id, {
        connection,
        player,
        requesterId: message.author.id,
        title,
        url: query
      });

      player.on(AudioPlayerStatus.Idle, () => {
        connection.destroy();
        queue.delete(message.guild.id);
      });

      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎵 BẮT ĐẦU PHÁT NHẠC')
        .setDescription(`**Tác phẩm:** \`${title}\`\n**Yêu cầu bởi:** <@${message.author.id}>`)
        .setFooter({ text: 'Chỉ người yêu cầu hoặc Admin mới có quyền sử dụng m!leave' })
        .setTimestamp();

      await replyMsg.edit({ content: null, embeds: [embed] });

    } catch (error) {
      console.error(error);
      await replyMsg.edit(`❌ Thất bại khi giải mã luồng phát: ${error.message}`);
    }
  }

  // ============ LỆNH m!leave ============
  if (command === 'leave' || command === 'stop') {
    const serverQueue = queue.get(message.guild.id);
    const connection = getVoiceConnection(message.guild.id);

    if (!connection && !serverQueue) {
      return message.reply('❌ Bot hiện tại không có trong phòng thoại hoặc đang không phát nhạc!');
    }

    const requesterId = serverQueue ? serverQueue.requesterId : null;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người phát bài hát hiện tại** (<@${requesterId}>) hoặc **Quản trị viên** mới được quyền dừng nhạc!`);
    }

    if (serverQueue) {
      serverQueue.player.stop();
      queue.delete(message.guild.id);
    }
    connection.destroy();

    await message.reply('👋 Đã dừng nhạc và rời khỏi phòng voice theo yêu cầu.');
  }
});

process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));

client.login(process.env.DISCORD_TOKEN);
